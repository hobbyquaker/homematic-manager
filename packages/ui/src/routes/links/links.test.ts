import type {LinkProfile, ParamsetDescription} from '@homematic-manager/core';
import {fireEvent, screen, waitFor, within} from '@testing-library/svelte';
import {beforeEach, describe, expect, it} from 'vitest';

import {MockTransport} from '../../lib/transport/MockTransport.js';
import {linkFields, profileDescription, profileLabel} from '../../lib/util/linkForm.js';
import {mountApp} from '../../testHarness.js';

const description: ParamsetDescription = {
    SHORT_ON_TIME: {TYPE: 'FLOAT', OPERATIONS: 3, MIN: 0, MAX: 8590, UNIT: 's', TAB_ORDER: 3},
    SHORT_ON_LEVEL: {TYPE: 'FLOAT', OPERATIONS: 3, MIN: 0, MAX: 1, UNIT: '100%', TAB_ORDER: 2},
    SHORT_ACTION_TYPE: {TYPE: 'ENUM', OPERATIONS: 3, VALUE_LIST: ['INACTIVE', 'JUMP_TO_TARGET'], TAB_ORDER: 1},
    UI_HINT: {TYPE: 'STRING', OPERATIONS: 3},
    UI_TEMPLATE: {TYPE: 'STRING', OPERATIONS: 3},
};

const profile: LinkProfile = {
    id: 2,
    key: 'staircase',
    name: {de: 'Treppenhauslicht', en: 'Staircase light'},
    description: {de: 'Schaltet für eine Zeit ein', en: 'Switches on for a while'},
    params: {
        SHORT_ACTION_TYPE: {kind: 'fixed', value: 1},
        SHORT_ON_LEVEL: {kind: 'list', values: [0.5, 1]},
        SHORT_ON_TIME: {kind: 'range', min: 0, max: 8590, default: 60},
    },
};

describe('linkFields', () => {
    it('never offers the CCU bookkeeping parameters as editable rows', () => {
        const names = linkFields(description).map((field) => field.name);
        expect(names).not.toContain('UI_HINT');
        expect(names).not.toContain('UI_TEMPLATE');
    });

    it('follows the senderMetadata order in easy mode and TAB_ORDER in expert view', () => {
        const metadata = {parameterOrder: ['SHORT_ON_TIME', 'SHORT_ACTION_TYPE']};
        expect(linkFields(description, {metadata}).map((field) => field.name)).toEqual([
            'SHORT_ON_TIME',
            'SHORT_ACTION_TYPE',
            'SHORT_ON_LEVEL',
        ]);
        expect(linkFields(description, {metadata, expert: true}).map((field) => field.name)).toEqual([
            'SHORT_ACTION_TYPE',
            'SHORT_ON_LEVEL',
            'SHORT_ON_TIME',
        ]);
    });

    it('shows the sender’s full option list and greys out only what the profile fixes', () => {
        const fields = linkFields(description, {profile});
        const byName = new Map(fields.map((field) => [field.name, field]));

        // Every parameter is still on screen - 2.x hid what the profile did not mention.
        expect(fields).toHaveLength(3);
        expect(byName.get('SHORT_ACTION_TYPE')?.fixedByProfile).toBe(true);
        expect(byName.get('SHORT_ON_LEVEL')?.fixedByProfile).toBe(false);
        expect(byName.get('SHORT_ON_LEVEL')?.allowed).toEqual([0.5, 1]);
        expect(byName.get('SHORT_ON_TIME')?.range).toEqual({min: 0, max: 8590});
    });

    it('greys nothing out in the expert view - that is what profile 0 means', () => {
        expect(linkFields(description, {profile, expert: true}).every((field) => !field.fixedByProfile)).toBe(true);
    });

    it('attaches the option preset the metadata names', () => {
        const fields = linkFields(description, {
            metadata: {optionPresets: {SHORT_ON_TIME: 'duration'}},
            presets: {duration: {id: 'duration', allowCustom: true, presets: [{label: '5s', value: 5}]}},
        });
        expect(fields.find((field) => field.name === 'SHORT_ON_TIME')?.preset?.id).toBe('duration');
    });

    it('picks the profile label of the language, falling back to en and de', () => {
        expect(profileLabel(profile, 'de')).toBe('Treppenhauslicht');
        expect(profileLabel(profile, 'tr')).toBe('Staircase light');
        expect(profileDescription(profile, 'en')).toBe('Switches on for a while');
        expect(profileLabel({...profile, name: {}}, 'de')).toBe('staircase');
        expect(profileDescription({...profile, description: {}}, 'de')).toBe('');
    });
});

describe('the links grid', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
    });

    it('shows the 2.7 link columns and both device images', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/links'});
        const labels = screen.getAllByRole('columnheader').map((header) => header.textContent.trim());
        expect(labels).toEqual([
            '',
            'Sender Name',
            'SENDER',
            'TYPE',
            '',
            'Empfänger Name',
            'RECEIVER',
            'TYPE',
            'FLAGS',
            'NAME',
            'DESCRIPTION',
        ]);
        const row = document.querySelector('[data-row-id="JEQ0234567:1->MEQ0123456:1"]');
        expect(row?.textContent).toContain('Taster Flur:1');
        expect(row?.textContent).toContain('Licht Küche:1');
    });

    it('marks a defective link and counts them in the toolbar (#79)', async () => {
        transport.respond('links.list', () => [
            {SENDER: 'A:1', RECEIVER: 'B:1', NAME: 'broken', FLAGS: 1},
            {SENDER: 'A:2', RECEIVER: 'B:1', NAME: 'fine', FLAGS: 0},
        ]);
        await mountApp({transport, hash: '#/BidCos-RF/links'});

        await waitFor(() => {
            expect(screen.getByTestId('links-defective')).toBeTruthy();
        });
        expect(screen.getByTestId('links-defective').textContent).toContain('1');
        const broken = within(document.querySelector<HTMLElement>('[data-row-id="A:1->B:1"]')!).getByRole('img');
        expect(broken.getAttribute('title')).toContain('SENDER_BROKEN');
        // B-35 (#157): the FLAGS column is resizable like any text column, and the mark fits its designed width
        expect(screen.getByTestId('links-table-resize-FLAGS')).toBeTruthy();
        const cell = broken.closest<HTMLElement>('.hmm-td')!;
        expect(cell.classList.contains('hmm-td-fixed')).toBe(false);
        expect(cell.scrollWidth).toBeLessThanOrEqual(cell.clientWidth);
    });

    it('hides the two play buttons on an interface without activateLinkParamset', async () => {
        const {stores} = await mountApp({transport, hash: '#/HmIP-RF/links'});
        await waitFor(() => {
            expect(stores.links.of('HmIP-RF').length).toBeGreaterThan(0);
        });
        expect(screen.queryByTestId('links-play-short')).toBeNull();
    });

    it('activates a link short and long from the toolbar (BidCos-RF only)', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/links'});
        await fireEvent.click(document.querySelector('[data-row-id="JEQ0234567:1->MEQ0123456:1"]')!);

        await fireEvent.click(screen.getByTestId('links-play-short'));
        expect(transport.lastCall('links.activate')).toEqual(['BidCos-RF', 'MEQ0123456:1', 'JEQ0234567:1', false]);

        await fireEvent.click(screen.getByTestId('links-play-long'));
        expect(transport.lastCall('links.activate')).toEqual(['BidCos-RF', 'MEQ0123456:1', 'JEQ0234567:1', true]);
    });

    it('opens the create-link dialog from the captioned "Add link" button (task 33)', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/links'});
        const button = screen.getByRole('button', {name: 'Verknüpfung anlegen'});
        expect(button.getAttribute('data-testid')).toBe('links-add');
        expect(button.classList.contains('hmm-primary-button')).toBe(true);

        await waitFor(() => {
            expect(screen.getByTestId('links-add-caption').textContent).toBe('Verknüpfung anlegen');
            expect(screen.getByTestId<HTMLButtonElement>('links-add').disabled).toBe(false);
        });
        await fireEvent.click(button);
        await waitFor(() => {
            expect(screen.getByTestId('add-link-dialog').hasAttribute('open')).toBe(true);
        });
    });

    it('disables "Add link" and says why where no channel can send (task 33)', async () => {
        transport.result('devices.list', []);
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/links'});
        await waitFor(() => {
            expect(stores.devices.index('BidCos-RF')).toBeDefined();
        });

        await waitFor(() => {
            expect(screen.getByTestId<HTMLButtonElement>('links-add').disabled).toBe(true);
        });
        expect(screen.getByTestId('links-add-tooltip').getAttribute('data-tooltip')).toBe(
            'Verknüpfung anlegen — Kein Kanal dieser Schnittstelle kann Sender einer Verknüpfung sein',
        );
    });
});

describe('the add-link dialog', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
    });

    it('offers only channels that can send, and only receivers the role matrix allows', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/links'});
        await fireEvent.click(screen.getByTestId('links-add'));

        const senders = screen.getByTestId('add-link-senders');
        await fireEvent.click(within(senders).getByRole('button'));
        const senderValues = within(senders)
            .getAllByRole('option')
            .map((option) => option.textContent);
        // MEQ0123456:1 ("Licht Küche:1") is a SWITCH receiver with no LINK_SOURCE_ROLES: not a sender.
        expect(senderValues.join('|')).not.toContain('Licht Küche:1');
        expect(senderValues.join('|')).toContain('Taster Flur:1');

        await fireEvent.click(within(senders).getAllByRole('option')[0]!);

        const receivers = screen.getByTestId('add-link-receivers');
        await fireEvent.click(within(receivers).getByRole('button'));
        const receiverValues = within(receivers)
            .getAllByRole('option')
            .map((option) => option.textContent)
            .join('|');
        // The BidCoS-RF virtual keys share the SWITCH role with the dimmer and the switch actuator.
        expect(receiverValues).toContain('Licht Küche:1');
        expect(receiverValues).toContain('Dimmer Wohnzimmer:1');
    });

    /**
     * Task 31: an entry is the channel name, the device name after it and `index: TYPE` under it.
     * The address is not printed any more - it is what the filter still finds.
     */
    it('lists channel name, device name and index: TYPE, and finds a channel by its address', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/links'});
        await fireEvent.click(screen.getByTestId('links-add'));

        const senders = screen.getByTestId('add-link-senders');
        await fireEvent.click(within(senders).getByRole('button'));
        await fireEvent.input(within(senders).getByLabelText('Filter'), {target: {value: 'jeq0234567:1'}});
        const [entry, ...rest] = within(senders).getAllByRole('option');
        expect(rest).toHaveLength(0);
        expect(entry!.classList.contains('hmm-multiselect-two-lines')).toBe(true);
        expect(entry!.querySelector('.hmm-multiselect-label')?.textContent).toBe('Taster Flur:1');
        expect(entry!.querySelector('.hmm-multiselect-hint')?.textContent).toBe('Taster Flur');
        expect(entry!.querySelector('.hmm-multiselect-description')?.textContent).toMatch(/^1: [A-Z_]+$/);
        expect(entry!.textContent).not.toContain('JEQ0234567');

        // part of a device name and part of a type find it as well
        await fireEvent.input(within(senders).getByLabelText('Filter'), {target: {value: 'taster flur'}});
        expect(within(senders).getAllByRole('option').length).toBeGreaterThanOrEqual(2);
    });

    it('creates one link per sender/receiver combination and reloads the grid', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/links'});
        await fireEvent.click(screen.getByTestId('links-add'));

        const senders = screen.getByTestId('add-link-senders');
        await fireEvent.click(within(senders).getByRole('button'));
        await fireEvent.click(within(senders).getAllByRole('option')[0]!);
        await fireEvent.click(within(senders).getAllByRole('option')[1]!);

        const receivers = screen.getByTestId('add-link-receivers');
        await fireEvent.click(within(receivers).getByRole('button'));
        await fireEvent.click(within(receivers).getAllByRole('option')[0]!);

        await fireEvent.click(screen.getByTestId('add-link-create'));

        await waitFor(() => {
            expect(transport.countOf('links.add')).toBe(2);
        });
    });

    it('gives every pair its own name and description (#87)', async () => {
        // 2.7 had one name field for the whole dialog: one switch against two actuators produced
        // two links with the same name, and telling them apart meant opening each one afterwards.
        await mountApp({transport, hash: '#/BidCos-RF/links'});
        await fireEvent.click(screen.getByTestId('links-add'));

        const senders = screen.getByTestId('add-link-senders');
        await fireEvent.click(within(senders).getByRole('button'));
        await fireEvent.click(within(senders).getAllByRole('option')[0]!);

        const receivers = screen.getByTestId('add-link-receivers');
        await fireEvent.click(within(receivers).getByRole('button'));
        const first = within(receivers).getAllByRole('option')[0]!;
        const second = within(receivers).getAllByRole('option')[1]!;
        await fireEvent.click(first);
        await fireEvent.click(second);

        const rows = await screen.findByTestId('add-link-pairs');
        const inputs = within(rows).getAllByRole('textbox');
        // one row per pair, four inputs each pair: name and description
        expect(inputs).toHaveLength(4);

        await fireEvent.input(screen.getByTestId('add-link-name-all'), {target: {value: 'Hallway'}});
        await fireEvent.input(inputs[2] as HTMLInputElement, {target: {value: 'Second blind'}});

        await fireEvent.click(screen.getByTestId('add-link-create'));
        await waitFor(() => {
            expect(transport.countOf('links.add')).toBe(2);
        });
        const calls = transport.calls.filter((call) => call.method === 'links.add').map((call) => call.params);
        // the shared box fills the row that was left empty, the row that was typed into wins
        expect(calls[0]?.[3]).toBe('Hallway');
        expect(calls[1]?.[3]).toBe('Second blind');
    });

    it('offers no pair table for a single link, where one name is the whole story', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/links'});
        await fireEvent.click(screen.getByTestId('links-add'));
        const senders = screen.getByTestId('add-link-senders');
        await fireEvent.click(within(senders).getByRole('button'));
        await fireEvent.click(within(senders).getAllByRole('option')[0]!);
        const receivers = screen.getByTestId('add-link-receivers');
        await fireEvent.click(within(receivers).getByRole('button'));
        await fireEvent.click(within(receivers).getAllByRole('option')[0]!);

        expect(screen.queryByTestId('add-link-pairs')).toBeNull();
        await fireEvent.input(screen.getByTestId('add-link-name-all'), {target: {value: 'Kitchen'}});
        await fireEvent.click(screen.getByTestId('add-link-create'));
        await waitFor(() => {
            expect(transport.lastCall('links.add')?.[3]).toBe('Kitchen');
        });
    });

    it('says so when the chosen sender has no possible receiver', async () => {
        transport.respond('devices.list', () => [
            {ADDRESS: 'A', TYPE: 'HM-X', PARENT: '', CHILDREN: ['A:1']},
            {ADDRESS: 'A:1', TYPE: 'KEY', PARENT: 'A', LINK_SOURCE_ROLES: 'NOBODY_HAS_THIS'},
        ]);
        await mountApp({transport, hash: '#/BidCos-RF/links'});
        await fireEvent.click(screen.getByTestId('links-add'));

        const senders = screen.getByTestId('add-link-senders');
        await fireEvent.click(within(senders).getByRole('button'));
        await fireEvent.click(within(senders).getAllByRole('option')[0]!);

        await waitFor(() => {
            expect(screen.getByTestId('add-link-none')).toBeTruthy();
        });
        expect(screen.getByTestId<HTMLButtonElement>('add-link-create').disabled).toBe(true);
    });
});

describe('removing links', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
    });

    it('removes the whole selection in one dialog (#80)', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/links'});
        await fireEvent.click(document.querySelector('[data-row-id="JEQ0234567:1->MEQ0123456:1"]')!);
        await fireEvent.click(document.querySelector('[data-row-id="JEQ0234567:2->GEQ0567890:1"]')!, {ctrlKey: true});
        await fireEvent.click(screen.getByTestId('links-delete'));

        const dialog = screen.getByTestId('remove-link-dialog');
        expect(dialog.textContent).toContain('JEQ0234567:1');
        expect(dialog.textContent).toContain('JEQ0234567:2');

        await fireEvent.click(screen.getByTestId('remove-link-confirm'));
        await waitFor(() => {
            expect(transport.countOf('links.remove')).toBe(2);
        });
    });

    it('keeps the dialog open when one removal failed', async () => {
        transport.respond('links.remove', (_interfaceName, sender) => {
            if (sender === 'JEQ0234567:2') {
                throw new Error('Unknown instance');
            }
            return null;
        });
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/links'});
        await fireEvent.click(document.querySelector('[data-row-id="JEQ0234567:1->MEQ0123456:1"]')!);
        await fireEvent.click(document.querySelector('[data-row-id="JEQ0234567:2->GEQ0567890:1"]')!, {ctrlKey: true});
        await fireEvent.click(screen.getByTestId('links-delete'));
        await fireEvent.click(screen.getByTestId('remove-link-confirm'));

        await waitFor(() => {
            expect(stores.notices.items.at(-1)?.message).toContain('Unknown instance');
        });
        expect(screen.getByTestId('remove-link-dialog').hasAttribute('open')).toBe(true);
    });
});

describe('the link paramset dialog', () => {
    let transport: MockTransport;

    async function openLink(): Promise<void> {
        const {stores} = await mountApp({transport, hash: '#/HmIP-RF/links'});
        await waitFor(() => {
            expect(stores.links.of('HmIP-RF').length).toBeGreaterThan(0);
        });
        await fireEvent.dblClick(document.querySelector('[data-row-id="0001D8A9B7C6D5:1->000A1B2C3D4E5F:4"]')!);
        await waitFor(() => {
            expect(screen.getByTestId('param-SHORT_ACTION_TYPE')).toBeTruthy();
        });
    }

    beforeEach(() => {
        transport = new MockTransport({demo: true});
    });

    it('reads the LINK paramset with the peer address in place of the paramset name', async () => {
        await openLink();
        const reads = transport.calls.filter((call) => call.method === 'paramset.get').map((call) => call.params);
        expect(reads).toContainEqual(['HmIP-RF', '000A1B2C3D4E5F:4', '0001D8A9B7C6D5:1']);
        expect(reads).toContainEqual(['HmIP-RF', '0001D8A9B7C6D5:1', '000A1B2C3D4E5F:4']);
    });

    it('offers the profiles of the data set, expert first', async () => {
        await openLink();
        const select = screen.getByTestId<HTMLSelectElement>('link-profile');
        await waitFor(() => {
            expect([...select.options].map((option) => option.textContent)).toEqual([
                'Experte',
                'Einschalten',
                'Treppenhauslicht',
            ]);
        });
    });

    it('applies a profile, greys out what it fixes and sets UI_HINT', async () => {
        await openLink();
        const select = await waitFor(() => {
            const found = screen.getByTestId<HTMLSelectElement>('link-profile');
            expect(found.options.length).toBe(3);
            return found;
        });
        await fireEvent.change(select, {target: {value: '2'}});

        await waitFor(() => {
            const row = screen.getByTestId('param-SHORT_ACTION_TYPE');
            expect((within(row).getByRole('combobox') as HTMLSelectElement).disabled).toBe(true);
        });
        // SHORT_ON_TIME is a range in this profile: still editable.
        expect(
            (within(screen.getByTestId('param-SHORT_ON_TIME')).getByRole('spinbutton') as HTMLInputElement).disabled,
        ).toBe(false);

        await fireEvent.click(screen.getByTestId('link-preview'));
        await waitFor(() => {
            expect(screen.getByTestId('write-preview')).toBeTruthy();
        });
        // The profile id goes out as UI_HINT so the CCU WebUI does not call the link "expert".
        expect(screen.getByTestId('preview-UI_HINT').textContent).toContain('2');
    });

    it('shows every LINK parameter and greys nothing out in the expert view', async () => {
        await openLink();
        await fireEvent.click(screen.getByTestId('link-expert'));
        await waitFor(() => {
            const row = screen.getByTestId('param-SHORT_ACTION_TYPE');
            expect((within(row).getByRole('combobox') as HTMLSelectElement).disabled).toBe(false);
        });
    });

    it('writes the link paramset through putParamset with the peer', async () => {
        await openLink();
        const input = within(screen.getByTestId('param-SHORT_ON_LEVEL')).getByRole('spinbutton');
        await fireEvent.input(input, {target: {value: '50'}});

        await fireEvent.click(screen.getByTestId('link-preview'));
        await fireEvent.click(screen.getByTestId('write-confirm'));

        await waitFor(() => {
            const call = transport.lastCall('paramset.putLink');
            expect(call?.[1]).toEqual([{sender: '0001D8A9B7C6D5:1', receiver: '000A1B2C3D4E5F:4'}]);
            expect(call?.[2]).toEqual({receiverToSender: {SHORT_ON_LEVEL: {explicitDouble: 0.5}}});
        });
    });

    it('saves name and description through setLinkInfo', async () => {
        await openLink();
        await fireEvent.input(screen.getByTestId('link-name'), {target: {value: 'Flurlicht'}});
        await fireEvent.input(screen.getByTestId('link-description'), {target: {value: 'kurz an'}});
        await fireEvent.click(screen.getByTestId('link-info-save'));

        await waitFor(() => {
            expect(transport.lastCall('links.info.set')).toEqual([
                'HmIP-RF',
                '0001D8A9B7C6D5:1',
                '000A1B2C3D4E5F:4',
                'Flurlicht',
                'kurz an',
            ]);
        });
    });

    it('detects each link’s profile from its own values, even when they arrive late (B-58)', async () => {
        // Two buttons of one remote linked to the same actuator channel: same sender and receiver
        // types, so the same profile list, but each link follows another profile. HmIP writes no
        // UI_HINT, so the profile is detected from the values alone.
        const first = {SENDER: '0001D8A9B7C6D5:1', RECEIVER: '000A1B2C3D4E5F:4', NAME: '', DESCRIPTION: '', FLAGS: 0};
        const second = {SENDER: '0001D8A9B7C6D5:2', RECEIVER: '000A1B2C3D4E5F:4', NAME: '', DESCRIPTION: '', FLAGS: 0};
        transport.respond('links.list', (interfaceName) => (interfaceName === 'HmIP-RF' ? [first, second] : []));
        let releaseSecond: () => void = () => undefined;
        transport.respond('paramset.get', async (_interfaceName, address, paramset) => {
            if (address !== '000A1B2C3D4E5F:4') {
                return {LONG_PRESS_TIME: 0.4};
            }
            if (paramset === second.SENDER) {
                // The second link's values answer only when the test says so.
                await new Promise<void>((resolve) => {
                    releaseSecond = resolve;
                });
                return {SHORT_ACTION_TYPE: 1, SHORT_ON_LEVEL: 1, SHORT_ON_TIME: 60};
            }
            return {SHORT_ACTION_TYPE: 1, SHORT_ON_LEVEL: 1, SHORT_ON_TIME: 111_600};
        });
        const {stores} = await mountApp({transport, hash: '#/HmIP-RF/links'});
        await waitFor(() => {
            expect(stores.links.of('HmIP-RF').length).toBe(2);
        });
        const select = (): HTMLSelectElement => screen.getByTestId<HTMLSelectElement>('link-profile');

        await fireEvent.dblClick(document.querySelector(`[data-row-id="${first.SENDER}->${first.RECEIVER}"]`)!);
        await waitFor(() => {
            expect(select().value).toBe('1');
        });
        await fireEvent.click(screen.getByTestId('link-paramset-dialog').querySelector('.hmm-dialog-close')!);

        await fireEvent.dblClick(document.querySelector(`[data-row-id="${second.SENDER}->${second.RECEIVER}"]`)!);
        // Not the first link's profile while the second link's values are still on their way.
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(screen.queryByTestId<HTMLSelectElement>('link-profile')?.value).not.toBe('1');
        releaseSecond();
        await waitFor(() => {
            expect(select().value).toBe('2');
        });
        expect(screen.queryByTestId('param-SHORT_ON_TIME')).toBeTruthy();
    });

    it('keeps the sender paramset collapsed until it is asked for, as 2.7 did', async () => {
        await openLink();
        expect(screen.queryByTestId('link-sender-params')).toBeNull();
        await fireEvent.click(screen.getByTestId('link-sender-toggle'));
        await waitFor(() => {
            expect(screen.getByTestId('link-sender-params')).toBeTruthy();
        });
    });
});

describe('the CCU easy mode form (task 62, D-54)', () => {
    // An HmIP link as the WebUI sees it: no UI_HINT, the on time as a base/factor pair, and a
    // profile whose extracted form shows the on time and the level - nothing of the jump table.
    const RECEIVER = '000A1B2C3D4E5F:4';
    const SENDER = '0001D8A9B7C6D5:1';
    const baseList = [
        'BASE_100_MS',
        'BASE_1_S',
        'BASE_5_S',
        'BASE_10_S',
        'BASE_1_M',
        'BASE_5_M',
        'BASE_10_M',
        'BASE_1_H',
    ];
    const linkDescription: ParamsetDescription = {
        SHORT_ACTION_TYPE: {TYPE: 'ENUM', OPERATIONS: 3, VALUE_LIST: ['INACTIVE', 'JUMP_TO_TARGET'], TAB_ORDER: 1},
        SHORT_JT_ON: {TYPE: 'ENUM', OPERATIONS: 3, VALUE_LIST: ['NOP', 'ON_DELAY', 'RAMP_ON', 'ON'], TAB_ORDER: 2},
        SHORT_ON_LEVEL: {TYPE: 'FLOAT', OPERATIONS: 3, MIN: 0, MAX: 1, UNIT: '100%', TAB_ORDER: 3},
        SHORT_ON_TIME_BASE: {TYPE: 'ENUM', OPERATIONS: 3, VALUE_LIST: baseList, TAB_ORDER: 4},
        SHORT_ON_TIME_FACTOR: {TYPE: 'INTEGER', OPERATIONS: 3, MIN: 0, MAX: 31, TAB_ORDER: 5},
    };
    const profiles = {
        receiverType: 'SWITCH_VIRTUAL_RECEIVER',
        senders: {
            KEY_TRANSCEIVER: [
                {
                    id: 1,
                    key: 'switch_on',
                    name: {de: 'Einschalten', en: 'Switch on'},
                    description: {de: 'Schaltet ein', en: 'Switches on'},
                    params: {
                        SHORT_ACTION_TYPE: {kind: 'fixed', value: 1},
                        SHORT_JT_ON: {kind: 'fixed', value: 3},
                        SHORT_ON_LEVEL: {kind: 'range', min: 0, max: 1, default: 1},
                        SHORT_ON_TIME_BASE: {kind: 'range', min: 0, max: 7, default: 7},
                        SHORT_ON_TIME_FACTOR: {kind: 'range', min: 0, max: 31, default: 31},
                    },
                    controls: [
                        {kind: 'time', prefix: 'SHORT_ON_TIME', selector: 'timeOnOff', label: {de: 'Einschaltdauer'}},
                        {kind: 'param', param: 'SHORT_ON_LEVEL', option: 'DIM_ONLEVEL'},
                        // an optical-signal control: not on this device's form
                        {kind: 'param', param: 'SHORT_OPTICAL_SIGNAL_COLOR', requires: ['SHORT_OPTICAL_SIGNAL_COLOR']},
                    ],
                },
                {
                    id: 2,
                    key: 'switch_off',
                    name: {de: 'Ausschalten', en: 'Switch off'},
                    description: {de: 'Schaltet aus', en: 'Switches off'},
                    params: {SHORT_ACTION_TYPE: {kind: 'fixed', value: 1}, SHORT_JT_ON: {kind: 'fixed', value: 0}},
                },
            ],
        },
    };
    const timeSelectors = {
        source: 'test',
        types: {
            timeOnOff: [
                {special: 'notActive', label: {de: 'Nicht aktiv'}},
                {seconds: 60, label: {de: '1 Minute'}},
                {special: 'permanent', label: {de: 'dauerhaft'}},
                {special: 'enterValue', label: {de: 'Wert eingeben'}},
            ],
        },
    };
    let transport: MockTransport;

    async function openLink(): Promise<void> {
        const {stores} = await mountApp({transport, hash: '#/HmIP-RF/links'});
        await waitFor(() => {
            expect(stores.links.of('HmIP-RF').length).toBeGreaterThan(0);
        });
        await fireEvent.dblClick(document.querySelector(`[data-row-id="${SENDER}->${RECEIVER}"]`)!);
        await waitFor(() => {
            expect(screen.getByTestId<HTMLSelectElement>('link-profile').value).toBe('1');
        });
    }

    beforeEach(() => {
        transport = new MockTransport({demo: true});
        const demoFile = transport.handlerFor('data.file');
        transport.respond('data.file', (path) => {
            if (path === 'data/profiles/SWITCH_VIRTUAL_RECEIVER.json') return profiles;
            if (path === 'data/easymode-time-selectors.json') return timeSelectors;
            if (path === 'data/option-presets.json') {
                return {
                    ...(demoFile(path) as object),
                    DIM_ONLEVEL: {
                        id: 'DIM_ONLEVEL',
                        allowCustom: true,
                        presets: [
                            {label: '50%', value: 0.5},
                            {label: '100%', value: 1},
                        ],
                    },
                };
            }
            return demoFile(path);
        });
        const demoDescription = transport.handlerFor('paramset.description');
        transport.respond('paramset.description', (interfaceName, address, paramset) =>
            address === RECEIVER && paramset === 'LINK'
                ? linkDescription
                : demoDescription(interfaceName, address, paramset),
        );
        const demoGet = transport.handlerFor('paramset.get');
        transport.respond('paramset.get', (interfaceName, address, paramset) =>
            address === RECEIVER
                ? {
                      SHORT_ACTION_TYPE: 1,
                      SHORT_JT_ON: 3,
                      SHORT_ON_LEVEL: 1,
                      SHORT_ON_TIME_BASE: 7,
                      SHORT_ON_TIME_FACTOR: 31,
                  }
                : demoGet(interfaceName, address, paramset),
        );
    });

    it('shows only the controls of the CCU form, the time as one selector', async () => {
        await openLink();
        const form = await waitFor(() => screen.getByTestId('link-easy-form'));
        expect(within(form).getByTestId('easy-time-SHORT_ON')).toBeTruthy();
        // the level as the WebUI's combo box, on its current preset; no free field
        expect(
            within(form).getByTestId<HTMLSelectElement>('easy-preset-select-SHORT_ON_LEVEL').selectedOptions[0]
                ?.textContent,
        ).toBe('100%');
        expect(screen.queryByTestId('param-SHORT_ON_LEVEL')).toBeNull();
        // what the profile writes by itself, and what this device lacks, are not on the form
        expect(screen.queryByTestId('param-SHORT_ACTION_TYPE')).toBeNull();
        expect(screen.queryByTestId('param-SHORT_JT_ON')).toBeNull();
        expect(screen.queryByTestId('param-SHORT_ON_TIME_BASE')).toBeNull();
        expect(screen.queryByTestId('param-SHORT_OPTICAL_SIGNAL_COLOR')).toBeNull();
        // BASE_1_H x 31 is "for ever"
        const select = screen.getByTestId<HTMLSelectElement>('easy-time-select-SHORT_ON');
        expect(select.selectedOptions[0]?.textContent).toBe('dauerhaft');
        expect(within(screen.getByTestId('easy-time-SHORT_ON')).getByText('Einschaltdauer')).toBeTruthy();
    });

    it('writes a preset as base and factor, and "enter value" opens the raw pair', async () => {
        await openLink();
        const select = await waitFor(() => screen.getByTestId<HTMLSelectElement>('easy-time-select-SHORT_ON'));
        await fireEvent.change(select, {target: {value: '1'}});
        await fireEvent.click(screen.getByTestId('link-preview'));
        await waitFor(() => {
            expect(screen.getByTestId('write-preview')).toBeTruthy();
        });
        // 60 s = BASE_5_S (index 2) x 12, the smallest base that hits it exactly
        expect(screen.getByTestId('preview-SHORT_ON_TIME_FACTOR').textContent).toContain('12');
        expect(screen.getByTestId('preview-SHORT_ON_TIME_BASE').textContent).toContain('BASE_5_S');
    });

    it('opens the free field of a combo box for "enter value", and a preset writes its value', async () => {
        await openLink();
        const select = await waitFor(() => screen.getByTestId<HTMLSelectElement>('easy-preset-select-SHORT_ON_LEVEL'));
        await fireEvent.change(select, {target: {value: '0'}});
        await fireEvent.change(select, {target: {value: '-1'}});
        await waitFor(() => {
            expect(screen.getByTestId('param-SHORT_ON_LEVEL')).toBeTruthy();
        });
        await fireEvent.click(screen.getByTestId('link-preview'));
        await waitFor(() => {
            expect(screen.getByTestId('preview-SHORT_ON_LEVEL').textContent).toContain('0.5');
        });
    });

    it('opens base and factor raw for "enter value"', async () => {
        await openLink();
        const select = await waitFor(() => screen.getByTestId<HTMLSelectElement>('easy-time-select-SHORT_ON'));
        expect(screen.queryByTestId('param-SHORT_ON_TIME_BASE')).toBeNull();
        await fireEvent.change(select, {target: {value: '3'}});
        await waitFor(() => {
            expect(screen.getByTestId('param-SHORT_ON_TIME_BASE')).toBeTruthy();
            expect(screen.getByTestId('param-SHORT_ON_TIME_FACTOR')).toBeTruthy();
        });
    });

    it('shows every parameter raw in the expert view, the easy-mode ones marked', async () => {
        await openLink();
        await waitFor(() => screen.getByTestId('link-easy-form'));
        await fireEvent.click(screen.getByTestId('link-expert'));
        await waitFor(() => {
            expect(screen.getByTestId('param-SHORT_ACTION_TYPE')).toBeTruthy();
        });
        expect(screen.queryByTestId('link-easy-form')).toBeNull();
        expect(screen.getByTestId('link-easy-legend')).toBeTruthy();
        const marked = (param: string): boolean =>
            screen.getByTestId(`param-${param}`).parentElement?.classList.contains('hmm-link-easy-marked') ?? false;
        expect(marked('SHORT_ON_TIME_BASE')).toBe(true);
        expect(marked('SHORT_ON_TIME_FACTOR')).toBe(true);
        expect(marked('SHORT_ON_LEVEL')).toBe(true);
        expect(marked('SHORT_ACTION_TYPE')).toBe(false);
        expect(marked('SHORT_JT_ON')).toBe(false);
        // raw: the time is two fields again, nothing greyed out
        expect(
            (within(screen.getByTestId('param-SHORT_ACTION_TYPE')).getByRole('combobox') as HTMLSelectElement).disabled,
        ).toBe(false);
    });

    it('falls back to every parameter, with a hint, for a profile without a form', async () => {
        await openLink();
        await fireEvent.change(screen.getByTestId('link-profile'), {target: {value: '2'}});
        await waitFor(() => {
            expect(screen.getByTestId('link-easy-unknown')).toBeTruthy();
        });
        expect(screen.queryByTestId('link-easy-form')).toBeNull();
        expect(screen.getByTestId('param-SHORT_ACTION_TYPE')).toBeTruthy();
    });
});

describe('link profile templates (#21)', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
    });

    /** Opens the link paramset dialog on the first link of the demo. */
    async function openEditor(): Promise<void> {
        await mountApp({transport, hash: '#/HmIP-RF/links'});
        await waitFor(() => {
            expect(document.querySelector('[data-row-id]')).toBeTruthy();
        });
        await fireEvent.dblClick(document.querySelector('[data-row-id]')!);
        await waitFor(() => {
            expect(screen.getByTestId('link-profile')).toBeTruthy();
        });
    }

    it('saves the profile and its values under a name, and offers it again', async () => {
        await openEditor();
        // nothing saved yet: the dropdown says so and is disabled
        const select = screen.getByTestId<HTMLSelectElement>('link-template');
        expect(select.disabled).toBe(true);
        expect(select.textContent).toContain('Keine Vorlage');

        await fireEvent.input(screen.getByTestId('link-template-name'), {target: {value: 'Flur kurz'}});
        await fireEvent.click(screen.getByTestId('link-template-save'));

        await waitFor(() => {
            expect(transport.countOf('linkTemplates.save')).toBe(1);
        });
        const saved = transport.lastCall('linkTemplates.save')?.[0];
        expect(saved?.name).toBe('Flur kurz');
        // the identity carries both sides, so it cannot be applied to a different pair of types
        expect(saved?.identity).toContain('|');
        expect(Object.keys(saved?.receiver ?? {}).length).toBeGreaterThan(0);

        await waitFor(() => {
            expect(screen.getByTestId<HTMLSelectElement>('link-template').disabled).toBe(false);
        });
        expect(screen.getByTestId('link-template').textContent).toContain('Flur kurz');
    });

    it('applies a template into the form and writes nothing on its own', async () => {
        await openEditor();
        await fireEvent.input(screen.getByTestId('link-template-name'), {target: {value: 'Vorlage'}});
        await fireEvent.click(screen.getByTestId('link-template-save'));
        await waitFor(() => {
            expect(screen.getByTestId<HTMLSelectElement>('link-template').disabled).toBe(false);
        });

        const before = transport.countOf('paramset.putLink');
        await fireEvent.change(screen.getByTestId('link-template'), {target: {value: 'Vorlage'}});
        // applying fills the form; the preview and the Write button are still what sends anything
        expect(transport.countOf('paramset.putLink')).toBe(before);

        await fireEvent.click(screen.getByTestId('link-template-delete'));
        await waitFor(() => {
            expect(transport.lastCall('linkTemplates.remove')?.[0]).toBe('Vorlage');
        });
    });

    it('only asks for the templates of this link identity', async () => {
        await openEditor();
        await waitFor(() => {
            expect(transport.countOf('linkTemplates.list')).toBeGreaterThan(0);
        });
        expect(transport.lastCall('linkTemplates.list')?.[0]).toContain('HmIP-RF/');
    });
});

describe('staging link work instead of sending it (#124)', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
    });

    it('stages a removal rather than removing it now', async () => {
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/links'});
        await waitFor(() => {
            expect(document.querySelector('[data-row-id]')).toBeTruthy();
        });
        await fireEvent.click(document.querySelector('[data-row-id]')!);
        await fireEvent.click(screen.getByTestId('links-delete'));

        await fireEvent.click(await screen.findByTestId('remove-link-stage'));
        expect(transport.countOf('links.remove')).toBe(0);
        expect(stores.changeSet.count).toBe(1);
        const staged = stores.changeSet.changes[0];
        expect(staged?.kind).toBe('linkRemove');
        expect(staged?.calls[0]).toContain('removeLink(');
    });

    it('stages a link paramset write with both directions', async () => {
        const {stores} = await mountApp({transport, hash: '#/HmIP-RF/links'});
        await waitFor(() => {
            expect(document.querySelector('[data-row-id]')).toBeTruthy();
        });
        await fireEvent.dblClick(document.querySelector('[data-row-id]')!);
        await waitFor(() => {
            expect(screen.getByTestId('link-profile')).toBeTruthy();
        });

        const before = transport.countOf('paramset.putLink');
        await fireEvent.click(screen.getByTestId('link-preview'));
        await waitFor(() => {
            expect(screen.getByTestId('write-preview')).toBeTruthy();
        });
        // nothing changed yet, so there is nothing to stage and the button says so
        expect(screen.getByTestId<HTMLButtonElement>('write-stage').disabled).toBe(true);
        expect(transport.countOf('paramset.putLink')).toBe(before);
        expect(stores.changeSet.count).toBe(0);
    });
});
