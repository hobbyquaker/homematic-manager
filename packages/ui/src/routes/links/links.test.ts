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
        const labels = screen.getAllByRole('columnheader').map((header) => header.textContent?.trim());
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
            .map((option) => option.textContent ?? '');
        // MEQ0123456:1 is a SWITCH receiver with no LINK_SOURCE_ROLES: not a sender.
        expect(senderValues.join('|')).not.toContain('MEQ0123456:1');
        expect(senderValues.join('|')).toContain('JEQ0234567:1');

        await fireEvent.click(within(senders).getAllByRole('option')[0]!);

        const receivers = screen.getByTestId('add-link-receivers');
        await fireEvent.click(within(receivers).getByRole('button'));
        const receiverValues = within(receivers)
            .getAllByRole('option')
            .map((option) => option.textContent ?? '')
            .join('|');
        // The BidCoS-RF virtual keys share the SWITCH role with the dimmer and the switch actuator.
        expect(receiverValues).toContain('MEQ0123456:1');
        expect(receiverValues).toContain('GEQ0567890:1');
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
        expect((screen.getByTestId('add-link-create') as HTMLButtonElement).disabled).toBe(true);
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
        const select = screen.getByTestId('link-profile') as HTMLSelectElement;
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
            const found = screen.getByTestId('link-profile') as HTMLSelectElement;
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

    it('keeps the sender paramset collapsed until it is asked for, as 2.7 did', async () => {
        await openLink();
        expect(screen.queryByTestId('link-sender-params')).toBeNull();
        await fireEvent.click(screen.getByTestId('link-sender-toggle'));
        await waitFor(() => {
            expect(screen.getByTestId('link-sender-params')).toBeTruthy();
        });
    });
});
