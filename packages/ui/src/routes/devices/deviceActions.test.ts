import {fireEvent, screen, waitFor, within} from '@testing-library/svelte';
import {beforeEach, describe, expect, it} from 'vitest';

import {DEMO_DEVICES, DEMO_NAMES} from '../../lib/transport/demoData.js';
import {MockTransport} from '../../lib/transport/MockTransport.js';
import {mountApp} from '../../testHarness.js';

function rowOf(address: string): HTMLElement {
    const row = document.querySelector<HTMLElement>(`[data-row-id="${address}"]`);
    expect(row, `no row for ${address}`).not.toBeNull();
    return row!;
}

/** Clicks a row the way the grid expects, and opens the channels of its device first if needed. */
async function select(address: string): Promise<void> {
    const [device] = address.split(':');
    if (address.includes(':') && device !== undefined) {
        const parent = rowOf(device);
        const expander = within(parent).queryByRole('button', {name: 'Expand row'});
        if (expander) {
            await fireEvent.click(expander);
        }
    }
    await fireEvent.click(rowOf(address));
}

describe('the devices toolbar', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
    });

    /**
     * #145: what the button would say when the pointer rests on it. Since 3.0.0-beta.9 that is
     * the app's own tooltip, not the browser's `title` - a disabled button never got one of those.
     */
    function tooltipOf(id: string): string {
        return screen.getByTestId(`${id}-tooltip`).getAttribute('data-tooltip') ?? '';
    }

    it('disables everything while nothing is selected, and says why', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        for (const id of ['devices-rename', 'devices-delete', 'devices-replace', 'devices-usage-1']) {
            expect(screen.getByTestId<HTMLButtonElement>(id).disabled, id).toBe(true);
        }
        expect(tooltipOf('devices-delete')).toContain('Gerät auswählen');
    });

    it('enables the device actions for a device, but not reportValueUsage', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await select('MEQ0123456');

        expect(screen.getByTestId<HTMLButtonElement>('devices-rename').disabled).toBe(false);
        expect(screen.getByTestId<HTMLButtonElement>('devices-delete').disabled).toBe(false);
        expect(screen.getByTestId<HTMLButtonElement>('devices-restore').disabled).toBe(false);
        expect(screen.getByTestId<HTMLButtonElement>('devices-usage-1').disabled).toBe(true);
    });

    it('keeps delete and replace off a DontDelete device and explains the flag', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await select('BidCoS-RF');

        expect(screen.getByTestId<HTMLButtonElement>('devices-delete').disabled).toBe(true);
        expect(tooltipOf('devices-delete')).toContain('DontDelete');
        // Renaming the CCU's own device is still allowed, as it was in 2.x.
        expect(screen.getByTestId<HTMLButtonElement>('devices-rename').disabled).toBe(false);
    });

    it('enables reportValueUsage for a channel, but never for the :0 maintenance channel', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await select('MEQ0123456:1');
        expect(screen.getByTestId<HTMLButtonElement>('devices-usage-1').disabled).toBe(false);

        await fireEvent.click(rowOf('MEQ0123456:0'));
        expect(screen.getByTestId<HTMLButtonElement>('devices-usage-1').disabled).toBe(true);
        expect(screen.getByTestId<HTMLButtonElement>('devices-rename').disabled).toBe(true);
    });

    it('greys restore and clearConfigCache out on an interface that has neither', async () => {
        const {stores} = await mountApp({transport, hash: '#/HmIP-RF/devices'});
        await waitFor(() => {
            expect(stores.devices.devices('HmIP-RF').length).toBeGreaterThan(0);
        });
        await select('0011D3C9A1B2C3');

        expect(screen.getByTestId<HTMLButtonElement>('devices-restore').disabled).toBe(true);
        expect(tooltipOf('devices-restore')).toContain('BidCos');
    });

    it('sends restoreConfigToDevice and clearConfigCache for the selected device', async () => {
        transport.result('devices.restoreConfig', null).result('devices.clearConfigCache', null);
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await select('MEQ0123456');

        await fireEvent.click(screen.getByTestId('devices-restore'));
        await fireEvent.click(screen.getByTestId('devices-clear'));

        expect(transport.lastCall('devices.restoreConfig')).toEqual(['BidCos-RF', 'MEQ0123456']);
        expect(transport.lastCall('devices.clearConfigCache')).toEqual(['BidCos-RF', 'MEQ0123456']);
    });
});

describe('reportValueUsage', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
        transport.result('paramset.description', {
            STATE: {TYPE: 'BOOL', OPERATIONS: 7},
            WORKING: {TYPE: 'BOOL', OPERATIONS: 5},
        });
        transport.result('devices.reportValueUsage', 1);
    });

    it('walks every VALUES parameter of every selected channel (#18, PR #138)', async () => {
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await select('JEQ0234567:1');
        await fireEvent.click(rowOf('JEQ0234567:2'), {ctrlKey: true});

        await fireEvent.click(screen.getByTestId('devices-usage-1'));

        await waitFor(() => {
            expect(transport.countOf('devices.reportValueUsage')).toBe(4);
        });
        expect(
            transport.calls.filter((call) => call.method === 'devices.reportValueUsage').map((c) => c.params),
        ).toEqual([
            ['BidCos-RF', 'JEQ0234567:1', 'STATE', 1],
            ['BidCos-RF', 'JEQ0234567:1', 'WORKING', 1],
            ['BidCos-RF', 'JEQ0234567:2', 'STATE', 1],
            ['BidCos-RF', 'JEQ0234567:2', 'WORKING', 1],
        ]);
        expect(stores.notices.items.at(-1)?.message).toContain('4');
    });

    it('reports a failure per channel and carries on with the next one', async () => {
        let calls = 0;
        transport.respond('devices.reportValueUsage', (_interfaceName, address) => {
            calls += 1;
            if (address === 'JEQ0234567:1') {
                throw new Error('device unreachable');
            }
            return 1;
        });
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await select('JEQ0234567:1');
        await fireEvent.click(rowOf('JEQ0234567:2'), {ctrlKey: true});
        await fireEvent.click(screen.getByTestId('devices-usage-0'));

        // one failing call on the first channel, then both parameters of the second
        await waitFor(() => {
            expect(calls).toBe(3);
        });
        expect(stores.notices.items.some((notice) => notice.message.includes('device unreachable'))).toBe(true);
    });
});

describe('the rename dialog', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
    });

    // task 65: the box is ticked at every opening, so a device renames its channels by default
    it('renames a device, its :0 channel and every channel, with the box ticked from the start', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await select('MEQ0123456');
        await fireEvent.click(screen.getByTestId('devices-rename'));

        const input = screen.getByTestId<HTMLInputElement>('rename-input');
        expect(input.value).toBe('Licht Küche');
        expect(screen.getByTestId<HTMLInputElement>('rename-children').checked).toBe(true);
        await fireEvent.input(input, {target: {value: 'Küche Decke'}});
        await fireEvent.click(screen.getByTestId('rename-save'));

        await waitFor(() => {
            expect(transport.lastCall('names.set')).toEqual([
                [
                    {address: 'MEQ0123456', name: 'Küche Decke'},
                    {address: 'MEQ0123456:0', name: 'Küche Decke:0'},
                    {address: 'MEQ0123456:1', name: 'Küche Decke:1'},
                ],
            ]);
        });
        expect(screen.queryByTestId('rename-dialog')?.hasAttribute('open')).toBe(false);
    });

    it('leaves the other channels alone when the box is unticked, and ticks it again at the next opening', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await select('MEQ0123456');
        await fireEvent.click(screen.getByTestId('devices-rename'));
        await fireEvent.input(screen.getByTestId('rename-input'), {target: {value: 'X'}});
        await fireEvent.click(screen.getByTestId('rename-children'));
        await fireEvent.click(screen.getByTestId('rename-save'));

        await waitFor(() => {
            expect(transport.lastCall('names.set')).toEqual([
                [
                    {address: 'MEQ0123456', name: 'X'},
                    {address: 'MEQ0123456:0', name: 'X:0'},
                ],
            ]);
        });
        await waitFor(() => {
            expect(screen.queryByTestId('rename-dialog')?.hasAttribute('open')).toBe(false);
        });
        await fireEvent.click(screen.getByTestId('devices-rename'));
        await waitFor(() => {
            expect(screen.getByTestId<HTMLInputElement>('rename-children').checked).toBe(true);
        });
    });

    it('offers no channel checkbox for a channel, and renames only it', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await select('MEQ0123456:1');
        await fireEvent.click(screen.getByTestId('devices-rename'));

        expect(screen.queryByTestId('rename-children')).toBeNull();
        await fireEvent.input(screen.getByTestId('rename-input'), {target: {value: 'Kanal'}});
        await fireEvent.click(screen.getByTestId('rename-save'));

        await waitFor(() => {
            expect(transport.lastCall('names.set')).toEqual([[{address: 'MEQ0123456:1', name: 'Kanal'}]]);
        });
    });

    it('refuses an empty name, so a rename cannot wipe one out by accident', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await select('MEQ0123456');
        await fireEvent.click(screen.getByTestId('devices-rename'));
        await fireEvent.input(screen.getByTestId('rename-input'), {target: {value: '   '}});
        expect(screen.getByTestId<HTMLButtonElement>('rename-save').disabled).toBe(true);
    });

    it('starts empty for an address ReGa never named', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        expect(DEMO_NAMES['JEQ0234567:0']).toBeUndefined();
        await select('JEQ0234567:0');
        // `:0` cannot be renamed at all - the toolbar button stays off, as in 2.x.
        expect(screen.getByTestId<HTMLButtonElement>('devices-rename').disabled).toBe(true);
    });
});

describe('the rename dialog from the name cell (task 46)', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
    });

    function nameCellOf(address: string): HTMLElement {
        const cell = rowOf(address).querySelector<HTMLElement>('[data-column-key="name"]');
        expect(cell, `no name cell for ${address}`).not.toBeNull();
        return cell!;
    }

    function dialogOpen(): boolean {
        return screen.queryByTestId('rename-dialog')?.hasAttribute('open') === true;
    }

    /** The address the dialog says it renames. */
    function dialogAddress(): string {
        return screen.getByTestId('rename-dialog').querySelector('.hmm-rename-address')?.textContent ?? '';
    }

    function grid(): HTMLElement {
        return screen.getByTestId('devices-table').querySelector<HTMLElement>('[role="grid"]')!;
    }

    it('selects on a click and opens for the device on a double click on its name', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await fireEvent.click(nameCellOf('MEQ0123456'));
        expect(rowOf('MEQ0123456').getAttribute('aria-selected')).toBe('true');
        expect(dialogOpen()).toBe(false);

        await fireEvent.dblClick(nameCellOf('MEQ0123456'));
        expect(dialogOpen()).toBe(true);
        expect(dialogAddress()).toBe('MEQ0123456');
        expect(screen.getByTestId<HTMLInputElement>('rename-input').value).toBe('Licht Küche');
        expect(screen.queryByTestId('rename-children')).not.toBeNull();
    });

    it('opens for the channel on a double click on its name, and the device stays expanded', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await select('MEQ0123456:1');
        await fireEvent.dblClick(nameCellOf('MEQ0123456:1'));

        expect(dialogOpen()).toBe(true);
        expect(dialogAddress()).toBe('MEQ0123456:1');
        expect(screen.queryByTestId('rename-children')).toBeNull();
        expect(within(rowOf('MEQ0123456')).getByRole('button', {name: 'Collapse row'})).toBeTruthy();

        await fireEvent.input(screen.getByTestId('rename-input'), {target: {value: 'Kanal'}});
        await fireEvent.click(screen.getByTestId('rename-save'));
        await waitFor(() => {
            expect(transport.lastCall('names.set')).toEqual([[{address: 'MEQ0123456:1', name: 'Kanal'}]]);
        });
    });

    it('opens nothing on the :0 channel, on another cell or on the expander', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await select('MEQ0123456:0');
        await fireEvent.dblClick(nameCellOf('MEQ0123456:0'));
        await fireEvent.keyDown(grid(), {key: 'F2'});
        await fireEvent.keyDown(grid(), {key: 'Enter'});
        expect(dialogOpen()).toBe(false);

        await fireEvent.dblClick(rowOf('MEQ0123456').querySelector<HTMLElement>('[data-column-key="ADDRESS"]')!);
        await fireEvent.dblClick(within(rowOf('MEQ0123456')).getByRole('button', {name: 'Collapse row'}));
        expect(dialogOpen()).toBe(false);
    });

    it('opens for the selected row on F2', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await fireEvent.keyDown(grid(), {key: 'F2'});
        expect(dialogOpen()).toBe(false);

        await select('JEQ0234567');
        await fireEvent.keyDown(grid(), {key: 'F2'});
        expect(dialogOpen()).toBe(true);
        expect(dialogAddress()).toBe('JEQ0234567');
    });

    it('opens for the selected row on Enter, but not on an Enter typed into a column filter', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await select('MEQ0123456:1');
        await fireEvent.keyDown(within(grid()).getAllByRole('searchbox')[0]!, {key: 'Enter'});
        expect(dialogOpen()).toBe(false);

        await fireEvent.keyDown(grid(), {key: 'Enter'});
        expect(dialogOpen()).toBe(true);
        expect(dialogAddress()).toBe('MEQ0123456:1');
    });
});

describe('the delete dialog', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
        transport.result('devices.delete', null);
    });

    it('adds the two dropdowns into one flag word, the way 2.7 did', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await select('MEQ0123456');
        await fireEvent.click(screen.getByTestId('devices-delete'));

        const dialog = screen.getByTestId('delete-device-dialog');
        expect(dialog.textContent).toContain('FLAGS = 5');

        const [reset, unreachable] = within(dialog).getAllByRole('combobox') as HTMLSelectElement[];
        await fireEvent.change(reset!, {target: {value: '0'}});
        await fireEvent.change(unreachable!, {target: {value: '2'}});
        expect(dialog.textContent).toContain('FLAGS = 2');

        await fireEvent.click(screen.getByTestId('delete-device-confirm'));
        await waitFor(() => {
            expect(transport.lastCall('devices.delete')).toEqual(['BidCos-RF', 'MEQ0123456', 2]);
        });
    });

    it('names the device it is about', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await select('MEQ0123456');
        await fireEvent.click(screen.getByTestId('devices-delete'));
        expect(screen.getByTestId('delete-device-dialog').textContent).toContain('Licht Küche');
    });

    it('stays open and shows the fault when the interface refuses', async () => {
        transport.fail('devices.delete', {message: 'Failure', kind: 'rpc', faultCode: -2});
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await select('MEQ0123456');
        await fireEvent.click(screen.getByTestId('devices-delete'));
        await fireEvent.click(screen.getByTestId('delete-device-confirm'));

        await waitFor(() => {
            expect(stores.notices.items.at(-1)?.message).toContain('Failure');
        });
        expect(screen.getByTestId('delete-device-dialog').hasAttribute('open')).toBe(true);
    });
});

describe('the replace dialog', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
        transport.result('devices.replace', true);
    });

    it('offers the devices listReplaceableDevices named, and replaces the old by the new', async () => {
        const byAddress = (address: string) => DEMO_DEVICES['BidCos-RF'].find((device) => device.ADDRESS === address)!;
        transport.result('devices.replaceable', [
            byAddress('MEQ0123456'),
            byAddress('JEQ0234567'),
            // a channel in the answer is filtered out, as 2.7 did
            byAddress('MEQ0123456:1'),
        ]);
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await select('GEQ0567890');
        await fireEvent.click(screen.getByTestId('devices-replace'));

        const dialog = await waitFor(() => screen.getByTestId('replace-device-dialog'));
        const options = within(dialog).getAllByRole('option') as HTMLOptionElement[];
        expect(options.map((option) => option.value)).toEqual(['MEQ0123456', 'JEQ0234567']);

        await fireEvent.change(within(dialog).getByRole('combobox'), {target: {value: 'JEQ0234567'}});
        await fireEvent.click(screen.getByTestId('replace-device-confirm'));

        await waitFor(() => {
            expect(transport.lastCall('devices.replace')).toEqual(['BidCos-RF', 'JEQ0234567', 'GEQ0567890']);
        });
    });

    it('says so when nothing can be replaced', async () => {
        transport.result('devices.replaceable', []);
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await select('GEQ0567890');
        await fireEvent.click(screen.getByTestId('devices-replace'));

        await waitFor(() => {
            expect(screen.getByTestId('replace-none')).toBeTruthy();
        });
        expect(screen.getByTestId<HTMLButtonElement>('replace-device-confirm').disabled).toBe(true);
    });
});

describe('the context menu', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
    });

    it('offers the device entries on a device row', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await fireEvent.contextMenu(rowOf('MEQ0123456'));

        const menu = screen.getByTestId('devices-menu');
        // B-33: the paramsets the device offers - no greyed SERVICE entry for a device without one
        await waitFor(() => {
            expect(within(menu).getAllByRole('menuitem')[1]?.textContent.trim()).toBe('MASTER Paramset');
        });
        expect(
            within(menu)
                .getAllByRole('menuitem')
                .map((item) => item.textContent.trim()),
        ).toEqual([
            'Umbenennen',
            'MASTER Paramset',
            'restoreConfigToDevice',
            'clearConfigCache',
            'Konfiguration reparieren',
            'Raum zuordnen…',
            'Gewerk zuordnen…',
            'Gerät tauschen',
            'Löschen',
        ]);
    });

    it('offers the channel entries on a channel row, greyed out on :0', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await select('MEQ0123456:1');
        await fireEvent.contextMenu(rowOf('MEQ0123456:0'));

        const menu = screen.getByTestId('devices-menu');
        await waitFor(() => {
            expect(within(menu).getAllByRole('menuitem')[3]?.textContent.trim()).toBe('VALUES Paramset');
        });
        const items = within(menu).getAllByRole('menuitem') as HTMLButtonElement[];
        // B-33: the demo describes MASTER of a BidCos MAINTENANCE channel as empty, like rfd does for
        // HM-CC-TC:0 and HM-Sec-SC:0 in the lab, so only VALUES is offered - and no greyed MASTER
        expect(items.map((item) => item.textContent.trim())).toEqual([
            'Umbenennen',
            'reportValueUsage 1',
            'reportValueUsage 0',
            'VALUES Paramset',
            'Raum zuordnen…',
            'Gewerk zuordnen…',
            'Verknüpfung als Sender anlegen',
            'Verknüpfung als Empfänger anlegen',
            'Verknüpfungen anzeigen (0)',
            'Team',
        ]);
        // The three that act on the channel are off for :0; the paramsets of :0 are readable.
        expect(items.slice(0, 3).every((item) => item.disabled)).toBe(true);
        expect(items[3]?.disabled).toBe(false);
        // task 25: the store of the demo takes writes, so a :0 channel may be put into a room
        expect(items.slice(4, 6).some((item) => item.disabled)).toBe(false);
        // MAINTENANCE has no link roles and no TEAM_TAG, so the link and team entries are off
        expect(items.slice(6).every((item) => item.disabled)).toBe(true);
    });

    it('puts a smoke detector back into a team of its own (#97)', async () => {
        // "Im Moment hat jeder Melder seine eigene Gruppe": each detector starts in a team of its
        // own, and moving one is `setTeam(channel, teamAddress)` - the detectors are never linked.
        // The demo's two detectors share one team (task 58); the empty address leaves it.
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await select('NEQ1000002:1');
        await fireEvent.contextMenu(rowOf('NEQ1000002:1'));

        const team = (within(screen.getByTestId('devices-menu')).getAllByRole('menuitem') as HTMLButtonElement[]).find(
            (item) => item.textContent.trim() === 'Team',
        );
        expect(team?.disabled).toBe(false);
        await fireEvent.click(team as HTMLButtonElement);

        const select_ = (await screen.findByTestId('team-select')) as HTMLSelectElement;
        // its team is preselected, and the members of that team are named
        expect(select_.value).toBe('*NEQ1000001:1');
        expect([...select_.options].map((option) => option.value)).toEqual(['', '*NEQ1000001:1']);
        expect(screen.getByTestId('team-members').textContent).toContain('Rauchmelder Küche:1');

        await fireEvent.change(select_, {target: {value: ''}});
        await fireEvent.click(screen.getByTestId('team-apply'));
        await waitFor(() => {
            expect(transport.lastCall('teams.set')).toEqual(['BidCos-RF', 'NEQ1000002:1', '']);
        });
    });

    it('says so on a channel that cannot be in a team at all (#97)', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await select('MEQ0123456:1');
        await fireEvent.contextMenu(rowOf('MEQ0123456:1'));
        const team = (within(screen.getByTestId('devices-menu')).getAllByRole('menuitem') as HTMLButtonElement[]).find(
            (item) => item.textContent.trim() === 'Team',
        );
        // a switch actuator has no TEAM_TAG: the entry is there and off, as the others are
        expect(team?.disabled).toBe(true);
    });

    it('creates a link from the Devices tab with the channel already chosen (#25)', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await select('MEQ0123456:1');
        await fireEvent.contextMenu(rowOf('MEQ0123456:1'));

        // MEQ0123456:1 is a SWITCH receiver: it can only be the receiver of a link
        const items = within(screen.getByTestId('devices-menu')).getAllByRole('menuitem') as HTMLButtonElement[];
        const asSender = items.find((item) => item.textContent.includes('als Sender'));
        const asReceiver = items.find((item) => item.textContent.includes('als Empfänger'));
        expect(asSender?.disabled).toBe(true);
        expect(asReceiver?.disabled).toBe(false);

        await fireEvent.click(asReceiver as HTMLButtonElement);
        const dialog = await screen.findByTestId('add-link-dialog');
        expect(dialog.hasAttribute('open')).toBe(true);
        // the channel is already in the receiver selection, so nothing has to be found again
        expect(within(screen.getByTestId('add-link-receivers')).getByRole('button').textContent).toContain('1');
    });

    it('hands the address over to the Links tab (#25)', async () => {
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await waitFor(() => {
            expect(stores.links.of('BidCos-RF').length).toBeGreaterThan(0);
        });
        const linked = stores.links.of('BidCos-RF')[0]!.RECEIVER;
        await select(linked);
        await fireEvent.contextMenu(rowOf(linked));

        const show = (within(screen.getByTestId('devices-menu')).getAllByRole('menuitem') as HTMLButtonElement[]).find(
            (item) => item.textContent.includes('Verknüpfungen anzeigen'),
        );
        expect(show?.disabled).toBe(false);
        await fireEvent.click(show as HTMLButtonElement);

        expect(stores.app.tab).toBe('links');
        await waitFor(() => {
            expect(screen.getByTestId('links-table')).toBeTruthy();
        });
        // The links grid is narrowed to that channel, and the store's hand-over is clear again.
        expect(stores.app.linksFilter).toBe('');

        // Task 20 took the tab-wide filter box away, so the hand-over shows itself as a chip in
        // the header band - a filter nobody can see and nobody can undo would be a trap.
        const chip = await waitFor(() => screen.getByTestId('links-filter-handover'));
        expect(chip.textContent).toContain(linked);
        await fireEvent.click(chip);
        expect(screen.queryByTestId('links-filter-handover')).toBeNull();
    });

    it('opens the delete dialog from the menu', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await fireEvent.contextMenu(rowOf('MEQ0123456'));
        await fireEvent.click(within(screen.getByTestId('devices-menu')).getByRole('menuitem', {name: 'Löschen'}));

        await waitFor(() => {
            expect(screen.getByTestId('delete-device-dialog').hasAttribute('open')).toBe(true);
        });
    });

    it('greys the BidCos-only entries out on HmIP', async () => {
        const {stores} = await mountApp({transport, hash: '#/HmIP-RF/devices'});
        await waitFor(() => {
            expect(stores.devices.devices('HmIP-RF').length).toBeGreaterThan(0);
        });
        await fireEvent.contextMenu(rowOf('0011D3C9A1B2C3'));

        const menu = screen.getByTestId('devices-menu');
        expect((within(menu).getByRole('menuitem', {name: 'clearConfigCache'}) as HTMLButtonElement).disabled).toBe(
            true,
        );
    });
});
