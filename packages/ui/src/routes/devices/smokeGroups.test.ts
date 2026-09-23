/**
 * Task 58: smoke groups in the device list. The demo has both kinds - a BidCos team `*NEQ1000001`
 * that rfd lists as a device with the two detectors in its `:1` channel's TEAM_CHANNELS, and three
 * HmIP-SWSD whose smoke channel's MASTER carries GROUP_1 … GROUP_8, two of them in group 1.
 *
 * The rows, their members, the Group column and the members dialog are checked from the outside,
 * and what goes over the wire: `teams.set` per moved detector on BidCos, and on HmIP one MASTER
 * write of exactly the changed `GROUP_n` per detector - never the whole paramset.
 */

import type {Paramset} from '@homematic-manager/core';
import {fireEvent, screen, waitFor, within} from '@testing-library/svelte';
import {beforeEach, describe, expect, it} from 'vitest';

import {demoParamset} from '../../lib/transport/demoData.js';
import {MockTransport} from '../../lib/transport/MockTransport.js';
import {mountApp} from '../../testHarness.js';

const SWSD_1 = '0001D3C9000001';
const SWSD_2 = '0001D3C9000002';
const SWSD_3 = '0001D3C9000003';

function rowOf(address: string): HTMLElement {
    const row = document.querySelector<HTMLElement>(`[data-row-id="${address}"]`);
    expect(row, `no row for ${address}`).not.toBeNull();
    return row!;
}

function rowsOf(address: string): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>(`[data-row-id="${address}"]`)];
}

async function expand(address: string): Promise<void> {
    await fireEvent.click(within(rowOf(address)).getByRole('button', {name: 'Expand row'}));
}

/**
 * The text of the Smoke group column of a row: the sixth cell of a device row (icon, name,
 * address, rooms, functions, group) and the fifth of a channel row, which has no icon.
 */
function groupCellOf(address: string): string {
    const cells = [...rowOf(address).querySelectorAll('[role=gridcell]')];
    const cell = cells[address.includes(':') ? 4 : 5];
    expect(cell, `no group cell in ${address}`).toBeDefined();
    return cell!.textContent.trim();
}

function menuItems(): HTMLButtonElement[] {
    return within(screen.getByTestId('devices-menu')).getAllByRole('menuitem') as HTMLButtonElement[];
}

function tooltipOf(id: string): string {
    return screen.getByTestId(`${id}-tooltip`).getAttribute('data-tooltip') ?? '';
}

/**
 * A transport whose HmIP MASTER paramsets remember what was written, so the rows follow a change
 * the way they follow hmipserver: the store reads the channel again and draws what came back.
 */
function rememberingTransport(): {transport: MockTransport; masters: Map<string, Paramset>} {
    const transport = new MockTransport({demo: true});
    const masters = new Map<string, Paramset>();
    const masterOf = (address: string): Paramset => masters.get(address) ?? demoParamset(address, 'MASTER');
    transport.respond('paramset.get', (_interfaceName, address, paramset) =>
        paramset === 'MASTER' ? masterOf(address) : demoParamset(address, paramset),
    );
    transport.respond('paramset.put', (interfaceName, addresses, paramset, values) =>
        addresses.map((address) => {
            if (paramset === 'MASTER') {
                masters.set(address, {...masterOf(address), ...(values as Paramset)});
            }
            return {interfaceName, address, paramset, sent: values, ok: true, problems: [], durationMs: 1};
        }),
    );
    return {transport, masters};
}

describe('BidCos smoke detector teams in the device list', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
    });

    it('shows the team row with its detector count, and the detectors name their team', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        expect(rowOf('*NEQ1000001').textContent).toContain('Rauchmelder Gruppe');
        expect(rowOf('*NEQ1000001').textContent).toContain('HM-Sec-SD-2-Team');
        expect(groupCellOf('*NEQ1000001')).toContain('2 Melder');
        // the detectors' rows say which team they are in
        expect(groupCellOf('NEQ1000001')).toBe('Rauchmelder Gruppe');
        expect(groupCellOf('NEQ1000002')).toBe('Rauchmelder Gruppe');
        // a device that is in no team says nothing
        expect(groupCellOf('MEQ0123456')).toBe('');
        // `listTeams` is not needed: the members come with the device list
        expect(transport.countOf('teams.list')).toBe(0);
    });

    it('expands the team to its own channels and then its member detectors', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await expand('*NEQ1000001');
        expect(rowOf('*NEQ1000001:0').textContent).toContain('MAINTENANCE');
        expect(rowOf('*NEQ1000001:1').textContent).toContain('SMOKE_DETECTOR_TEAM_V2');
        expect(rowOf('NEQ1000001:1').textContent).toContain('Rauchmelder Flur:1');
        expect(rowOf('NEQ1000002:1').textContent).toContain('Rauchmelder Küche:1');
        // and the detector's own device still lists its channel - the same channel twice is fine
        await expand('NEQ1000002');
        expect(rowsOf('NEQ1000002:1')).toHaveLength(2);
    });

    it('takes a detector out of the team from the team row, with setTeam and an empty team', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await fireEvent.click(screen.getByTestId('smoke-group-members-*NEQ1000001'));

        const dialog = await screen.findByTestId('smoke-group-dialog');
        expect(dialog.textContent).toContain('Team: Rauchmelder Gruppe');
        const first = screen.getByTestId<HTMLInputElement>('smoke-group-member-NEQ1000001:1');
        const second = screen.getByTestId<HTMLInputElement>('smoke-group-member-NEQ1000002:1');
        expect(first.checked).toBe(true);
        expect(second.checked).toBe(true);
        // nothing changed yet: nothing to apply
        expect(screen.getByTestId<HTMLButtonElement>('smoke-group-apply').disabled).toBe(true);

        await fireEvent.click(second);
        await fireEvent.click(screen.getByTestId('smoke-group-apply'));
        await waitFor(() => {
            expect(transport.lastCall('teams.set')).toEqual(['BidCos-RF', 'NEQ1000002:1', '']);
        });
        expect(transport.countOf('teams.set')).toBe(1);
        // the list is read again: the team rows and the detectors' TEAM come from listDevices
        await waitFor(() => {
            expect(transport.countOf('devices.list')).toBeGreaterThan(1);
        });
    });

    it('offers the members first in the team row’s context menu, and the team is still a device', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await fireEvent.contextMenu(rowOf('*NEQ1000001'));
        const labels = menuItems().map((item) => item.textContent.trim());
        expect(labels[0]).toBe('Mitglieder…');
        expect(labels).toContain('Umbenennen');
        expect(labels).toContain('Löschen');
        await fireEvent.click(menuItems()[0]!);
        await screen.findByTestId('smoke-group-dialog');
        expect(screen.getByTestId('smoke-group-candidates').textContent).toContain('NEQ1000001:1');
    });

    it('has no New button on BidCos - rfd makes the teams itself', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        expect(screen.getByTestId<HTMLButtonElement>('devices-smoke-group-new').disabled).toBe(true);
        expect(tooltipOf('devices-smoke-group-new')).toContain('HmIP');
    });
});

describe('HmIP smoke groups in the device list', () => {
    it('reads each smoke channel’s MASTER once and draws a row per group in use', async () => {
        const {transport} = rememberingTransport();
        await mountApp({transport, hash: '#/HmIP-RF/devices'});
        await waitFor(() => {
            expect(rowsOf('*GROUP_1')).toHaveLength(1);
        });
        const row = rowOf('*GROUP_1');
        expect(row.textContent).toContain('Rauchmeldergruppe 1');
        expect(row.textContent).toContain('HmIP-SWSD-Group');
        expect(groupCellOf('*GROUP_1')).toContain('2 Melder');
        // no row for a group nobody is in
        expect(rowsOf('*GROUP_2')).toHaveLength(0);
        // the detectors name their group; the third is in none
        expect(groupCellOf(SWSD_1)).toBe('Rauchmeldergruppe 1');
        expect(groupCellOf(SWSD_2)).toBe('Rauchmeldergruppe 1');
        expect(groupCellOf(SWSD_3)).toBe('');
        // one getParamset per smoke channel, none for the other channels of the interface
        const reads = transport.countOf('paramset.get');
        expect(reads).toBe(3);
        // the group expands to its detectors' smoke channels
        await expand('*GROUP_1');
        expect(rowOf(`${SWSD_1}:1`).textContent).toContain('Rauchmelder Schlafzimmer:1');
        expect(rowOf(`${SWSD_2}:1`).textContent).toContain('Rauchmelder Kinderzimmer:1');
        expect(rowsOf(`${SWSD_3}:1`)).toHaveLength(0);
        // expanding read nothing more
        expect(transport.countOf('paramset.get')).toBe(reads);
    });

    it('keeps the device actions off a synthesised row and its menu to the members', async () => {
        const {transport} = rememberingTransport();
        await mountApp({transport, hash: '#/HmIP-RF/devices'});
        await waitFor(() => {
            expect(rowsOf('*GROUP_1')).toHaveLength(1);
        });
        await fireEvent.click(rowOf('*GROUP_1'));
        for (const id of ['devices-rename', 'devices-delete', 'devices-replace', 'devices-repair']) {
            expect(screen.getByTestId<HTMLButtonElement>(id).disabled, id).toBe(true);
        }
        await fireEvent.contextMenu(rowOf('*GROUP_1'));
        expect(menuItems().map((item) => item.textContent.trim())).toEqual(['Mitglieder…']);
    });

    it('creates a new group with the lowest free number, writing only that GROUP_n', async () => {
        const {transport} = rememberingTransport();
        await mountApp({transport, hash: '#/HmIP-RF/devices'});
        await waitFor(() => {
            expect(rowsOf('*GROUP_1')).toHaveLength(1);
        });
        const newButton = screen.getByTestId<HTMLButtonElement>('devices-smoke-group-new');
        expect(newButton.disabled).toBe(false);
        await fireEvent.click(newButton);

        const dialog = await screen.findByTestId('smoke-group-dialog');
        // group 1 is in use, so the new one is 2
        expect(dialog.textContent).toContain('Rauchmeldergruppe 2');
        for (const serial of [SWSD_1, SWSD_2, SWSD_3]) {
            expect(screen.getByTestId<HTMLInputElement>(`smoke-group-member-${serial}:1`).checked).toBe(false);
        }
        // the ones already in group 1 say so
        expect(dialog.textContent).toContain('auch in Rauchmeldergruppe 1');

        await fireEvent.click(screen.getByTestId(`smoke-group-member-${SWSD_3}:1`));
        await fireEvent.click(screen.getByTestId('smoke-group-apply'));
        await waitFor(() => {
            expect(transport.lastCall('paramset.put')).toEqual(['HmIP-RF', [`${SWSD_3}:1`], 'MASTER', {GROUP_2: true}]);
        });
        // the channel is read again, and the new row appears with what the interface holds
        await waitFor(() => {
            expect(rowsOf('*GROUP_2')).toHaveLength(1);
        });
        expect(groupCellOf('*GROUP_2')).toContain('1 Melder');
        expect(groupCellOf(SWSD_3)).toBe('Rauchmeldergruppe 2');
        expect(transport.countOf('paramset.put')).toBe(1);
    });

    it('removes a member from the group row; the last one takes the row with it', async () => {
        const {transport} = rememberingTransport();
        await mountApp({transport, hash: '#/HmIP-RF/devices'});
        await waitFor(() => {
            expect(rowsOf('*GROUP_1')).toHaveLength(1);
        });
        await fireEvent.click(screen.getByTestId('smoke-group-members-*GROUP_1'));
        await screen.findByTestId('smoke-group-dialog');
        await fireEvent.click(screen.getByTestId(`smoke-group-member-${SWSD_1}:1`));
        await fireEvent.click(screen.getByTestId(`smoke-group-member-${SWSD_2}:1`));
        await fireEvent.click(screen.getByTestId('smoke-group-apply'));
        await waitFor(() => {
            expect(transport.countOf('paramset.put')).toBe(2);
        });
        expect(transport.lastCall('paramset.put')).toEqual(['HmIP-RF', [`${SWSD_2}:1`], 'MASTER', {GROUP_1: false}]);
        await waitFor(() => {
            expect(rowsOf('*GROUP_1')).toHaveLength(0);
        });
        // the writes went through: the dialog closed, although the group's members changed under it
        await waitFor(() => {
            expect(screen.getByTestId('smoke-group-dialog').hasAttribute('open')).toBe(false);
        });
        expect(groupCellOf(SWSD_1)).toBe('');
    });

    it('lists a detector without GROUP_n, but does not let it be ticked', async () => {
        const {transport, masters} = rememberingTransport();
        // the older channel type: REPEAT_ENABLE and nothing else
        masters.set(`${SWSD_3}:1`, {REPEAT_ENABLE: true});
        await mountApp({transport, hash: '#/HmIP-RF/devices'});
        await waitFor(() => {
            expect(rowsOf('*GROUP_1')).toHaveLength(1);
        });
        await fireEvent.click(screen.getByTestId('smoke-group-members-*GROUP_1'));
        await screen.findByTestId('smoke-group-dialog');
        const third = screen.getByTestId<HTMLInputElement>(`smoke-group-member-${SWSD_3}:1`);
        expect(third.disabled).toBe(true);
        expect(third.closest('label')?.textContent).toContain('nicht gruppierbar');
    });

    it('reports a refused write and leaves the dialog open', async () => {
        const {transport} = rememberingTransport();
        transport.respond('paramset.put', (interfaceName, addresses, paramset) =>
            addresses.map((address) => ({
                interfaceName,
                address,
                paramset,
                sent: {},
                ok: false,
                problems: [{parameter: 'GROUP_2', message: 'unknown parameter GROUP_2'}],
            })),
        );
        await mountApp({transport, hash: '#/HmIP-RF/devices'});
        await waitFor(() => {
            expect(rowsOf('*GROUP_1')).toHaveLength(1);
        });
        await fireEvent.click(screen.getByTestId('devices-smoke-group-new'));
        await screen.findByTestId('smoke-group-dialog');
        await fireEvent.click(screen.getByTestId(`smoke-group-member-${SWSD_3}:1`));
        await fireEvent.click(screen.getByTestId('smoke-group-apply'));
        await waitFor(() => {
            expect(screen.getByTestId('notices').textContent).toContain('unknown parameter GROUP_2');
        });
        expect(screen.getByTestId('smoke-group-dialog')).toBeTruthy();
        expect(rowsOf('*GROUP_2')).toHaveLength(0);
    });
});
