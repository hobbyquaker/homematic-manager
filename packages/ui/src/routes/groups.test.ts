/**
 * Task 57: the Groups tab of VirtualDevices - the heating groups of openccu-lite.
 *
 * The tab exists only where the metadata store is the system's and the backend says the groups
 * API answers; it is never there on a CCU. Against a scripted transport whose `groups.*` answers
 * are a small in-memory group store, the tests walk the three dialogs the way a person does: a new
 * group with a type and a member, a member removed from an existing one, a group deleted - and
 * check what went over the wire, because the members go as a whole and a name that did not change
 * is not sent.
 */

import type {
    HeatingGroup,
    HeatingGroupChange,
    HeatingGroupDetail,
    HeatingGroupMember,
    HeatingGroupType,
    MetaState,
} from '@homematic-manager/core';
import {fireEvent, screen, waitFor, within} from '@testing-library/svelte';
import {beforeEach, describe, expect, it} from 'vitest';

import {MockTransport} from '../lib/transport/MockTransport.js';
import {mountApp} from '../testHarness.js';

const BOX: MetaState = {
    provider: 'occulite',
    reachable: true,
    writable: true,
    revision: 3,
    objects: 2,
    url: 'http://box',
};

const SEC_SC: HeatingGroupMember = {id: 'KEQ0165114', serial: 'KEQ0165114', type: 'HM-Sec-SC'};
const RT_DN: HeatingGroupMember = {id: 'LEQ0987654', serial: 'LEQ0987654', type: 'HM-CC-RT-DN'};
const WRC2: HeatingGroupMember = {id: '000193C9951175:1', serial: '000193C9951175:1', type: 'REMOTE_CONTROL'};

const TYPES: Array<{id: string; label: string}> = [
    {id: 'HomeMatic.heating', label: 'Heating_Control'},
    {id: 'hmip.heating.group', label: 'HmIP-Heizungssteuerung'},
];

interface FakeStore {
    groups: HeatingGroup[];
    /** Every `groups.*` change request, oldest first. */
    changes: string[];
}

/** A transport with the system's store, the groups API and one heating group in it. */
function boxTransport(options: {state?: MetaState; groups?: boolean} = {}): {
    transport: MockTransport;
    store: FakeStore;
} {
    const transport = new MockTransport({demo: true});
    const state = options.state ?? BOX;
    transport.respond('meta.state', () => state);
    transport.respond('meta.get', () => ({state, enums: {}, objects: {}}));
    const store: FakeStore = {
        groups: [
            {
                id: 1,
                name: 'Bad',
                type: 'HomeMatic.heating',
                typeLabel: 'Heating_Control',
                device: 'INT0000001',
                ref: 'VirtualDevices.INT0000001',
                members: [SEC_SC],
            },
        ],
        changes: [],
    };
    if (options.groups === false) {
        transport.result('groups.state', {available: false, reason: 'unsupported', message: 'no group process'});
        return {transport, store};
    }
    let nextId = 2;
    const assignable = (): HeatingGroupMember[] => {
        const taken = new Set(store.groups.flatMap((group) => group.members.map((member) => member.id)));
        return [SEC_SC, RT_DN].filter((member) => !taken.has(member.id));
    };
    const detail = (group: HeatingGroup): HeatingGroupDetail => ({
        ...group,
        deviceName: '',
        forbidSingleOperation: false,
        assignable: assignable(),
        leftover: [WRC2],
        types: TYPES,
    });
    const change = (group: HeatingGroup): HeatingGroupChange => ({...detail(group), devicesToConfigure: group.members});
    const find = (id: number): HeatingGroup => {
        const group = store.groups.find((entry) => entry.id === id);
        if (group === undefined) {
            throw new Error(`there is no group ${String(id)}`);
        }
        return group;
    };
    transport.result('groups.state', {available: true});
    transport.respond('groups.list', () => ({groups: store.groups, devicesToConfigure: []}));
    transport.respond('groups.types', (): HeatingGroupType[] => [
        {...TYPES[0]!, assignable: assignable(), leftover: []},
        {...TYPES[1]!, assignable: [], leftover: [WRC2]},
    ]);
    transport.respond('groups.get', (id) => detail(find(id)));
    transport.respond('groups.create', (name, type, members) => {
        store.changes.push(`create ${name} ${type} ${members.join(',')}`);
        const group: HeatingGroup = {
            id: nextId,
            name,
            type,
            typeLabel: TYPES.find((entry) => entry.id === type)?.label ?? type,
            device: `INT${String(nextId).padStart(7, '0')}`,
            ref: `VirtualDevices.INT${String(nextId).padStart(7, '0')}`,
            members: [SEC_SC, RT_DN].filter((member) => members.includes(member.id)),
        };
        nextId += 1;
        store.groups = [...store.groups, group];
        return change(group);
    });
    transport.respond('groups.update', (id, name, members) => {
        store.changes.push(`update ${String(id)} ${name ?? '-'} ${members === undefined ? '-' : members.join(',')}`);
        const group = find(id);
        const updated: HeatingGroup = {
            ...group,
            ...(name === undefined ? {} : {name}),
            ...(members === undefined
                ? {}
                : {members: [SEC_SC, RT_DN].filter((member) => members.includes(member.id))}),
        };
        store.groups = store.groups.map((entry) => (entry.id === id ? updated : entry));
        return change(updated);
    });
    transport.respond('groups.delete', (id) => {
        store.changes.push(`delete ${String(id)}`);
        const group = find(id);
        store.groups = store.groups.filter((entry) => entry.id !== id);
        return group.members;
    });
    return {transport, store};
}

function tabLabels(): string[] {
    return screen.getAllByRole('tab').map((tab) => tab.textContent.replace(/\s+/g, ' ').trim());
}

function row(id: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(`[data-row-id="${id}"]`);
    expect(element, `no row ${id}`).not.toBeNull();
    return element!;
}

describe('where the Groups tab exists', () => {
    it('is on VirtualDevices when the store is the system’s and the groups API answers, and nowhere else', async () => {
        const {transport} = boxTransport();
        const {stores} = await mountApp({transport, hash: '#/VirtualDevices/devices'});
        await waitFor(() => expect(stores.groups.offered).toBe(true));
        expect(tabLabels()).toContain('Gruppen');
        // right after the devices, where the WebUI's own Groups page sits in the mind of a CCU user
        expect(tabLabels().slice(0, 2)).toEqual(['Geräte', 'Gruppen']);
        // the probe ran once, not once per meta event
        expect(transport.countOf('groups.state')).toBe(1);

        await stores.selectInterface('BidCos-RF');
        await waitFor(() => expect(tabLabels()).not.toContain('Gruppen'));
        await stores.selectInterface('HmIP-RF');
        expect(tabLabels()).not.toContain('Gruppen');
    });

    it('is not there on a CCU, whose store is the profile’s or ReGa’s, and asks the backend nothing', async () => {
        // the demo transport's store is `local`: exactly what every CCU, Homegear and desktop has
        const transport = new MockTransport({demo: true});
        transport.result('groups.state', {available: true});
        const {stores} = await mountApp({transport, hash: '#/VirtualDevices/devices'});
        expect(stores.groups.state).toEqual({available: false, reason: 'no-box'});
        expect(tabLabels()).not.toContain('Gruppen');
        expect(transport.countOf('groups.state')).toBe(0);
    });

    it('is not there when the system has no groups API, and a bookmark of the tab lands on the devices', async () => {
        const {transport} = boxTransport({groups: false});
        const {stores} = await mountApp({transport, hash: '#/VirtualDevices/groups'});
        expect(stores.groups.state).toMatchObject({available: false, reason: 'unsupported'});
        expect(tabLabels()).not.toContain('Gruppen');
        expect(stores.app.tab).toBe('devices');
    });

    it('opens on the tab from a bookmark when the API is there', async () => {
        const {transport} = boxTransport();
        const {stores} = await mountApp({transport, hash: '#/VirtualDevices/groups'});
        expect(stores.app.tab).toBe('groups');
        await waitFor(() => expect(screen.getByTestId('groups-table')).toBeTruthy());
    });

    it('follows the store: a system that comes back is probed again, one that goes away drops the tab', async () => {
        const {transport} = boxTransport();
        const {stores} = await mountApp({transport, hash: '#/VirtualDevices/devices'});
        await waitFor(() => expect(stores.groups.offered).toBe(true));

        transport.emit('meta.changed', {...BOX, reachable: false});
        await waitFor(() => expect(stores.groups.offered).toBe(false));
        expect(tabLabels()).not.toContain('Gruppen');

        // a revision tick is not a reason to probe
        transport.emit('meta.changed', {...BOX, reachable: false, revision: 4});
        expect(transport.countOf('groups.state')).toBe(1);

        transport.emit('meta.changed', {...BOX, revision: 5});
        await waitFor(() => expect(stores.groups.offered).toBe(true));
        expect(transport.countOf('groups.state')).toBe(2);
        expect(tabLabels()).toContain('Gruppen');
    });
});

describe('the Groups tab', () => {
    let transport: MockTransport;
    let store: FakeStore;

    beforeEach(() => {
        ({transport, store} = boxTransport());
    });

    it('lists the groups with type, virtual device and members by name', async () => {
        transport.respond('names.get', () => ({KEQ0165114: 'Fenster Bad'}));
        await mountApp({transport, hash: '#/VirtualDevices/groups'});
        await waitFor(() => expect(row('1')).toBeTruthy());
        const text = row('1').textContent;
        expect(text).toContain('Bad');
        // the system's label key, in the UI's language
        expect(text).toContain('Heizungssteuerung');
        expect(text).toContain('INT0000001');
        expect(screen.getByTestId('group-members-1').textContent).toContain('Fenster Bad (KEQ0165114)');
        expect(screen.getByTestId('groups-table-count').textContent).toBe('1 Gruppe');
        expect(transport.countOf('groups.list')).toBe(1);
    });

    it('creates a group with a name, a type and a ticked member, and lists it', async () => {
        await mountApp({transport, hash: '#/VirtualDevices/groups'});
        await waitFor(() => expect(row('1')).toBeTruthy());

        await fireEvent.click(screen.getByTestId('groups-new'));
        const dialog = screen.getByTestId('group-dialog');
        await waitFor(() => expect(dialog.hasAttribute('open')).toBe(true));
        // the types come from the system; the first is chosen, its candidates are offered
        await waitFor(() =>
            expect(screen.getByTestId<HTMLSelectElement>('group-type').value).toBe('HomeMatic.heating'),
        );
        const options = [...screen.getByTestId<HTMLSelectElement>('group-type').options].map((option) => option.text);
        expect(options).toEqual(['Heizungssteuerung', 'HmIP-Heizungssteuerung']);
        // the member of the existing group is not offered again; the free thermostat is
        expect(screen.queryByTestId('group-member-KEQ0165114')).toBeNull();
        expect(screen.getByTestId('group-member-LEQ0987654')).toBeTruthy();
        // nothing to save without a name
        expect(screen.getByTestId<HTMLButtonElement>('group-save').disabled).toBe(true);

        await fireEvent.input(screen.getByTestId('group-name'), {target: {value: ' Küche '}});
        await fireEvent.click(screen.getByTestId('group-member-LEQ0987654'));
        expect(screen.getByTestId<HTMLButtonElement>('group-save').disabled).toBe(false);
        await fireEvent.click(screen.getByTestId('group-save'));

        await waitFor(() => expect(dialog.hasAttribute('open')).toBe(false));
        expect(store.changes).toEqual(['create Küche HomeMatic.heating LEQ0987654']);
        await waitFor(() => expect(row('2').textContent).toContain('Küche'));
        expect(screen.getByTestId('groups-table-count').textContent).toBe('2 Gruppen');
        // the change's devices to configure are shown as the hint the WebUI's popup was
        expect(screen.getByTestId('groups-pending').textContent).toContain('LEQ0987654');
    });

    it('switching the type of a new group offers that type’s devices and drops the ticks', async () => {
        await mountApp({transport, hash: '#/VirtualDevices/groups'});
        await waitFor(() => expect(row('1')).toBeTruthy());
        await fireEvent.click(screen.getByTestId('groups-new'));
        await waitFor(() => expect(screen.getByTestId('group-member-LEQ0987654')).toBeTruthy());
        await fireEvent.click(screen.getByTestId('group-member-LEQ0987654'));

        await fireEvent.change(screen.getByTestId('group-type'), {target: {value: 'hmip.heating.group'}});
        // the HmIP type has nothing to take, and the WRC2 channels are already connected elsewhere
        await waitFor(() => expect(screen.getByTestId('group-no-candidates')).toBeTruthy());
        expect(screen.getByTestId('group-connected').textContent).toContain('000193C9951175:1');

        await fireEvent.change(screen.getByTestId('group-type'), {target: {value: 'HomeMatic.heating'}});
        await waitFor(() =>
            expect(screen.getByTestId<HTMLInputElement>('group-member-LEQ0987654').checked).toBe(false),
        );
    });

    it('edits a group: the members go as a whole, an unchanged name is not sent', async () => {
        await mountApp({transport, hash: '#/VirtualDevices/groups'});
        await waitFor(() => expect(row('1')).toBeTruthy());
        await fireEvent.click(row('1'));
        await waitFor(() => expect(screen.getByTestId<HTMLButtonElement>('groups-edit').disabled).toBe(false));
        await fireEvent.click(screen.getByTestId('groups-edit'));

        const dialog = screen.getByTestId('group-dialog');
        await waitFor(() => expect(screen.getByTestId<HTMLInputElement>('group-name').value).toBe('Bad'));
        // the type is fixed once a group exists; the virtual device is named
        expect(screen.getByTestId('group-type').tagName).toBe('SPAN');
        expect(screen.getByTestId('group-device').textContent).toBe('INT0000001');
        // its member is ticked and first, the free thermostat is offered after it
        const candidates = within(screen.getByTestId('group-candidates'));
        expect(candidates.getByTestId<HTMLInputElement>('group-member-KEQ0165114').checked).toBe(true);
        expect(candidates.getByTestId<HTMLInputElement>('group-member-LEQ0987654').checked).toBe(false);
        // nothing changed yet
        expect(screen.getByTestId<HTMLButtonElement>('group-save').disabled).toBe(true);

        await fireEvent.click(candidates.getByTestId('group-member-KEQ0165114'));
        await fireEvent.click(candidates.getByTestId('group-member-LEQ0987654'));
        await fireEvent.click(screen.getByTestId('group-save'));
        await waitFor(() => expect(dialog.hasAttribute('open')).toBe(false));
        expect(store.changes).toEqual(['update 1 - LEQ0987654']);
        await waitFor(() => expect(screen.getByTestId('group-members-1').textContent).toContain('LEQ0987654'));
        expect(screen.getByTestId('group-members-1').textContent).not.toContain('KEQ0165114');
    });

    it('renames a group without touching its members', async () => {
        await mountApp({transport, hash: '#/VirtualDevices/groups'});
        await waitFor(() => expect(row('1')).toBeTruthy());
        await fireEvent.dblClick(row('1'));
        await waitFor(() => expect(screen.getByTestId<HTMLInputElement>('group-name').value).toBe('Bad'));
        await fireEvent.input(screen.getByTestId('group-name'), {target: {value: 'Bad oben'}});
        await fireEvent.click(screen.getByTestId('group-save'));
        await waitFor(() => expect(store.changes).toEqual(['update 1 Bad oben -']));
        await waitFor(() => expect(row('1').textContent).toContain('Bad oben'));
    });

    it('deletes a group after naming its members, and the list follows', async () => {
        await mountApp({transport, hash: '#/VirtualDevices/groups'});
        await waitFor(() => expect(row('1')).toBeTruthy());
        await fireEvent.click(row('1'));
        await waitFor(() => expect(screen.getByTestId<HTMLButtonElement>('groups-delete').disabled).toBe(false));
        await fireEvent.click(screen.getByTestId('groups-delete'));

        const dialog = screen.getByTestId('group-delete-dialog');
        await waitFor(() => expect(dialog.hasAttribute('open')).toBe(true));
        expect(screen.getByTestId('group-delete-subject').textContent).toBe('Bad');
        expect(screen.getByTestId('group-delete-members').textContent).toContain('KEQ0165114');
        expect(dialog.textContent).toContain('INT0000001');

        await fireEvent.click(screen.getByTestId('group-delete-apply'));
        await waitFor(() => expect(dialog.hasAttribute('open')).toBe(false));
        expect(store.changes).toEqual(['delete 1']);
        await waitFor(() => expect(document.querySelector('[data-row-id="1"]')).toBeNull());
        expect(screen.getByTestId('groups-table-count').textContent).toBe('0 Gruppen');
        // the former members are the ones whose configuration is pending now
        expect(screen.getByTestId('groups-pending').textContent).toContain('KEQ0165114');
    });

    it('shows a refusal as a notice and keeps the dialog open', async () => {
        transport.fail('groups.create', {message: 'name: 1 to 64 characters on one line', kind: 'validation'});
        const {stores} = await mountApp({transport, hash: '#/VirtualDevices/groups'});
        await waitFor(() => expect(row('1')).toBeTruthy());
        await fireEvent.click(screen.getByTestId('groups-new'));
        await waitFor(() => expect(screen.getByTestId('group-member-LEQ0987654')).toBeTruthy());
        await fireEvent.input(screen.getByTestId('group-name'), {target: {value: 'x'}});
        await fireEvent.click(screen.getByTestId('group-save'));
        await waitFor(() =>
            expect(stores.notices.items.some((notice) => notice.message.includes('1 to 64 characters'))).toBe(true),
        );
        expect(screen.getByTestId('group-dialog').hasAttribute('open')).toBe(true);
        expect(store.changes).toEqual([]);
    });

    it('keeps the buttons from a user without the administrator role, and says why', async () => {
        transport.result('session.info', {user: 'gast', level: 2});
        await mountApp({transport, hash: '#/VirtualDevices/groups'});
        await waitFor(() => expect(row('1')).toBeTruthy());
        expect(screen.getByTestId<HTMLButtonElement>('groups-new').disabled).toBe(true);
        await fireEvent.click(row('1'));
        expect(screen.getByTestId<HTMLButtonElement>('groups-edit').disabled).toBe(true);
        expect(screen.getByTestId<HTMLButtonElement>('groups-delete').disabled).toBe(true);
        expect(screen.getByTestId('groups-new-tooltip').getAttribute('data-tooltip')).toContain(
            'Erfordert die Administratorrolle auf dem System',
        );
    });
});
