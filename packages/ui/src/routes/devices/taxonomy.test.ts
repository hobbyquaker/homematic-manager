import {fireEvent, screen, waitFor, within} from '@testing-library/svelte';
import {beforeEach, describe, expect, it} from 'vitest';

import {ApiRequestError} from '../../lib/transport/error.js';
import {MockTransport} from '../../lib/transport/MockTransport.js';
import {mountApp} from '../../testHarness.js';

/**
 * Task 25: the rooms-and-functions UI against the demo store - the same core `MetaStore` the
 * backend's local provider runs, so every write here is a real write with a revision, and every
 * assertion reads what the event brought back rather than what the dialog believed.
 */

function rowOf(address: string): HTMLElement {
    const row = document.querySelector<HTMLElement>(`[data-row-id="${address}"]`);
    expect(row, `no row for ${address}`).not.toBeNull();
    return row!;
}

function rowIds(): string[] {
    return [...document.querySelectorAll<HTMLElement>('[data-row-id][data-row-kind="row"]')].map(
        (row) => row.getAttribute('data-row-id') ?? '',
    );
}

/** The texts of a row's cells; a device row starts with the icon cell, a channel row with the name. */
function cells(address: string): string[] {
    return [...rowOf(address).querySelectorAll('[role=gridcell]')].map((cell) => cell.textContent.trim());
}

/** The rooms and functions cells of a row, whichever kind of row it is. */
function taxonomyCells(address: string): {rooms: string; functions: string} {
    const texts = cells(address);
    const offset = address.includes(':') ? 2 : 3;
    return {rooms: texts[offset] ?? '', functions: texts[offset + 1] ?? ''};
}

async function expand(address: string): Promise<void> {
    const expander = within(rowOf(address)).queryByRole('button', {name: 'Expand row'});
    if (expander) {
        await fireEvent.click(expander);
    }
}

async function select(address: string, ctrl = false): Promise<void> {
    await fireEvent.click(rowOf(address), {ctrlKey: ctrl});
}

function assignDialog(): HTMLElement {
    return screen.getByTestId('assign-dialog');
}

async function openAssign(button: 'devices-assign-room' | 'devices-assign-function'): Promise<void> {
    await fireEvent.click(screen.getByTestId(button));
    await waitFor(() => expect(assignDialog().hasAttribute('open')).toBe(true));
}

/** A node's row in the assignment dialog (task 49). */
function assignRow(path: string): HTMLElement {
    const row = assignDialog().querySelector<HTMLElement>(`[data-testid="assign-row"][data-path="${path}"]`);
    expect(row, `no row for ${path}`).not.toBeNull();
    return row!;
}

function checkOf(path: string): HTMLInputElement {
    return assignRow(path).querySelector<HTMLInputElement>('input[type="checkbox"]')!;
}

function rowState(path: string): string | undefined {
    return assignRow(path).dataset['state'];
}

/** Every `meta.assign` since the last reset, the refs sorted: the grid's selection order is not the point. */
function assignCalls(transport: MockTransport): unknown[][] {
    return transport.calls
        .filter((call) => call.method === 'meta.assign')
        .map((call) => {
            const [refs, path, on] = call.params as [string[], string, boolean];
            return [[...refs].sort(), path, on];
        });
}

describe('the rooms and functions columns', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
    });

    it('prints the leaf names of a channel, and the union of its channels on the device row', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        // the floor is not printed: the column shows the leaf, the filter knows the tree
        expect(taxonomyCells('MEQ0123456')).toEqual({rooms: 'Küche', functions: 'Licht'});
        expect(taxonomyCells('KEQ0345678')).toEqual({rooms: 'Bad', functions: 'Heizung'});
        expect(taxonomyCells('NEQ1000001')).toEqual({rooms: '', functions: ''});
        await expand('MEQ0123456');
        expect(taxonomyCells('MEQ0123456:1')).toEqual({rooms: 'Küche', functions: 'Licht'});
        expect(taxonomyCells('MEQ0123456:0')).toEqual({rooms: '', functions: ''});
    });

    it('follows a change that arrives as an event', async () => {
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/devices'});
        transport.emit('meta.objects.changed', {
            ...stores.taxonomy.objects,
            'BidCos-RF.MEQ0123456:1': {name: 'x', enums: ['room/aussen'], rooms: ['Außen'], functions: []},
        });
        await waitFor(() => expect(taxonomyCells('MEQ0123456')).toEqual({rooms: 'Außen', functions: ''}));
    });
});

describe('the filter above the grid', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
    });

    it('narrows the grid to a room, and a floor matches every room below it', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        const room = screen.getByTestId<HTMLSelectElement>('devices-filter-room');
        expect([...room.options].map((option) => option.textContent)).toEqual([
            'Alle Räume',
            'Erdgeschoss',
            ' Küche',
            ' Wohnzimmer',
            ' Flur',
            'Obergeschoss',
            ' Bad',
            ' Schlafzimmer',
            'Außen',
        ]);

        await fireEvent.change(room, {target: {value: 'room/eg'}});
        await waitFor(() => expect(rowIds()).toEqual(['GEQ0567890', 'JEQ0234567', 'MEQ0123456']));

        await fireEvent.change(room, {target: {value: 'room/eg/kueche'}});
        await waitFor(() => expect(rowIds()).toEqual(['MEQ0123456']));
        // under a filtered device only the channels in the room are shown
        await expand('MEQ0123456');
        expect(rowIds()).toEqual(['MEQ0123456', 'MEQ0123456:1']);

        await fireEvent.change(room, {target: {value: ''}});
        await waitFor(() => expect(rowIds().length).toBeGreaterThan(5));
    });

    it('combines the room and the function filter', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await fireEvent.change(screen.getByTestId('devices-filter-function'), {target: {value: 'function/licht'}});
        await waitFor(() => expect(rowIds()).toEqual(['GEQ0567890', 'MEQ0123456']));
        await fireEvent.change(screen.getByTestId('devices-filter-room'), {target: {value: 'room/eg/wohnzimmer'}});
        await waitFor(() => expect(rowIds()).toEqual(['GEQ0567890']));
    });

    it('falls back to everything when the filtered node is deleted elsewhere', async () => {
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await fireEvent.change(screen.getByTestId('devices-filter-room'), {target: {value: 'room/aussen'}});
        await waitFor(() => expect(rowIds()).toEqual([]));
        transport.emit('meta.enums.changed', {
            ...stores.taxonomy.enums,
            room: {name: {en: 'Rooms'}, tree: []},
        });
        await waitFor(() => expect(rowIds().length).toBeGreaterThan(5));
        expect(screen.getByTestId<HTMLSelectElement>('devices-filter-room').value).toBe('');
    });
});

describe('assigning the selection', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
    });

    it('is off without a selection and says so; off with a reason when the store is read-only', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        const button = screen.getByTestId<HTMLButtonElement>('devices-assign-room');
        // #145: the app draws the tooltip now, so the text is on the anchor, not on the button
        const tip = (): string => screen.getByTestId('devices-assign-room-tooltip').getAttribute('data-tooltip') ?? '';
        expect(button.disabled).toBe(true);
        expect(tip()).toContain('Zeilen auswählen');

        await select('MEQ0123456');
        expect(button.disabled).toBe(false);

        transport.emit('meta.changed', {
            provider: 'occulite',
            reachable: true,
            writable: false,
            revision: 1,
            objects: 0,
        });
        await waitFor(() => expect(button.disabled).toBe(true));
        expect(tip()).toContain('keine Änderungen');
    });

    it('puts a multi-selection into a room with one request, and the rows follow', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await select('KEQ0345678');
        await select('LEQ0456789', true);
        await openAssign('devices-assign-room');
        expect(screen.getByTestId('assign-count').textContent).toBe('2 Zeilen ausgewählt');

        await fireEvent.click(checkOf('room/aussen'));
        await fireEvent.click(screen.getByTestId('assign-apply'));

        await waitFor(() => expect(assignDialog().hasAttribute('open')).toBe(false));
        expect(assignCalls(transport)).toEqual([
            [['BidCos-RF.KEQ0345678', 'BidCos-RF.LEQ0456789'], 'room/aussen', true],
        ]);
        await waitFor(() => expect(taxonomyCells('KEQ0345678').rooms).toBe('Außen'));
    });

    it('takes the selection out of a function again', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await expand('MEQ0123456');
        await select('MEQ0123456:1');
        await openAssign('devices-assign-function');
        expect(rowState('function/licht')).toBe('on');

        await fireEvent.click(checkOf('function/licht'));
        await fireEvent.click(screen.getByTestId('assign-apply'));

        await waitFor(() =>
            expect(assignCalls(transport)).toEqual([[['BidCos-RF.MEQ0123456:1'], 'function/licht', false]]),
        );
        await waitFor(() => expect(taxonomyCells('MEQ0123456:1').functions).toBe(''));
    });

    /*
     * Task 49: the list of checkboxes that replaced the add/remove radios and the select.
     */

    it('shows one row as checked boxes without radios, and saves only what changed, one request per node', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await expand('MEQ0123456');
        await select('MEQ0123456:1');
        await openAssign('devices-assign-room');

        const dialog = assignDialog();
        expect(dialog.querySelectorAll('input[type="radio"]')).toHaveLength(0);
        expect(dialog.querySelector('select')).toBeNull();
        expect(screen.getByTestId('assign-count').textContent).toBe('Eine Zeile ausgewählt');
        // every node of the tree in tree order, the floors too; eight of them need no filter
        expect(screen.getAllByTestId('assign-row').map((row) => [row.dataset['path'], row.dataset['state']])).toEqual([
            ['room/eg', 'off'],
            ['room/eg/kueche', 'on'],
            ['room/eg/wohnzimmer', 'off'],
            ['room/eg/flur', 'off'],
            ['room/og', 'off'],
            ['room/og/bad', 'off'],
            ['room/og/schlafzimmer', 'off'],
            ['room/aussen', 'off'],
        ]);
        expect(screen.queryByTestId('assign-filter')).toBeNull();
        expect(checkOf('room/eg/kueche').checked).toBe(true);
        expect(checkOf('room/aussen').checked).toBe(false);

        await fireEvent.click(checkOf('room/eg/kueche'));
        await fireEvent.click(checkOf('room/aussen'));
        // a box toggled twice is back where it was and sends nothing
        await fireEvent.click(checkOf('room/og/bad'));
        await fireEvent.click(checkOf('room/og/bad'));
        expect(rowState('room/og/bad')).toBe('off');
        transport.reset();
        await fireEvent.click(screen.getByTestId('assign-apply'));

        await waitFor(() => expect(dialog.hasAttribute('open')).toBe(false));
        expect(assignCalls(transport)).toEqual([
            [['BidCos-RF.MEQ0123456:1'], 'room/eg/kueche', false],
            [['BidCos-RF.MEQ0123456:1'], 'room/aussen', true],
        ]);
        await waitFor(() => expect(taxonomyCells('MEQ0123456:1').rooms).toBe('Außen'));
    });

    it('shows a mixed selection as indeterminate, cycles it all - none - as it was, and leaves it alone then', async () => {
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await expand('MEQ0123456');
        await expand('GEQ0567890');
        await select('MEQ0123456:1');
        await select('GEQ0567890:1', true);
        await openAssign('devices-assign-room');

        // one of the two is in the kitchen, the other in the living room, neither outside
        const kueche = checkOf('room/eg/kueche');
        expect([rowState('room/eg/kueche'), kueche.checked, kueche.indeterminate]).toEqual(['mixed', false, true]);
        expect(rowState('room/eg/wohnzimmer')).toBe('mixed');
        expect(rowState('room/aussen')).toBe('off');

        const seen: string[] = [];
        for (let click = 0; click < 3; click += 1) {
            await fireEvent.click(kueche);
            seen.push(`${rowState('room/eg/kueche') ?? ''} ${String(kueche.checked)} ${String(kueche.indeterminate)}`);
        }
        expect(seen).toEqual(['on true false', 'off false false', 'mixed false true']);

        // the kitchen for both, outside for both, the living room left as it was
        await fireEvent.click(kueche);
        await fireEvent.click(checkOf('room/aussen'));
        transport.reset();
        await fireEvent.click(screen.getByTestId('assign-apply'));

        await waitFor(() => expect(assignDialog().hasAttribute('open')).toBe(false));
        expect(assignCalls(transport)).toEqual([
            [['BidCos-RF.GEQ0567890:1'], 'room/eg/kueche', true],
            [['BidCos-RF.GEQ0567890:1', 'BidCos-RF.MEQ0123456:1'], 'room/aussen', true],
        ]);
        await waitFor(() =>
            expect([...(stores.taxonomy.objects['BidCos-RF.GEQ0567890:1']?.enums ?? [])].sort()).toEqual([
                'function/licht',
                'room/aussen',
                'room/eg/kueche',
                'room/eg/wohnzimmer',
            ]),
        );
        expect([...(stores.taxonomy.objects['BidCos-RF.MEQ0123456:1']?.enums ?? [])].sort()).toEqual([
            'function/licht',
            'room/aussen',
            'room/eg/kueche',
        ]);
    });

    it('counts a device row as in a room through its channels, and takes the channels out with it', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        // JEQ0234567: :1 is in the hall, :2 is not - one device, some of it
        await select('JEQ0234567');
        await openAssign('devices-assign-room');
        expect(rowState('room/eg/flur')).toBe('mixed');
        await fireEvent.click(within(assignDialog()).getByText('Abbrechen'));
        await waitFor(() => expect(assignDialog().hasAttribute('open')).toBe(false));

        // MEQ0123456: its one channel but :0 is in the kitchen, so the device is
        await select('MEQ0123456');
        await openAssign('devices-assign-room');
        expect(rowState('room/eg/kueche')).toBe('on');
        await fireEvent.click(checkOf('room/eg/kueche'));
        transport.reset();
        await fireEvent.click(screen.getByTestId('assign-apply'));

        await waitFor(() => expect(assignDialog().hasAttribute('open')).toBe(false));
        expect(assignCalls(transport)).toEqual([[['BidCos-RF.MEQ0123456:1'], 'room/eg/kueche', false]]);
        await waitFor(() => expect(taxonomyCells('MEQ0123456').rooms).toBe(''));
    });

    it('filters a long list; Enter in the filter neither saves nor toggles, Enter on a box saves', async () => {
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/devices'});
        const names = ['Arbeitszimmer', 'Bad', 'Büro', 'Dachboden', 'Esszimmer', 'Flur', 'Garage', 'Gäste-WC'];
        transport.emit('meta.enums.changed', {
            ...stores.taxonomy.enums,
            room: {
                name: {de: 'Räume', en: 'Rooms'},
                tree: [...names, 'Keller', 'Küche', 'Schlafzimmer'].map((name, index) => ({
                    id: `r${String(index)}`,
                    name,
                })),
            },
        });
        // the store is scripted here: the demo store does not know these rooms
        transport.respond('meta.assign', () => null);
        await expand('MEQ0123456');
        await select('MEQ0123456:1');
        await openAssign('devices-assign-room');

        const filter = screen.getByTestId<HTMLInputElement>('assign-filter');
        expect(screen.getAllByTestId('assign-row')).toHaveLength(11);
        await fireEvent.input(filter, {target: {value: 'kuche'}});
        expect(screen.getAllByTestId('assign-row').map((row) => row.dataset['path'])).toEqual(['room/r9']);

        await fireEvent.keyDown(filter, {key: 'Enter'});
        expect(assignDialog().hasAttribute('open')).toBe(true);
        expect(document.activeElement).toBe(checkOf('room/r9'));
        expect(rowState('room/r9')).toBe('off');
        expect(transport.countOf('meta.assign')).toBe(0);

        await fireEvent.input(filter, {target: {value: 'zzz'}});
        expect(screen.getByTestId('assign-list').textContent).toContain('Kein Treffer');
        await fireEvent.input(filter, {target: {value: 'Küche'}});
        await fireEvent.click(checkOf('room/r9'));
        await fireEvent.keyDown(checkOf('room/r9'), {key: 'Enter'});

        await waitFor(() => expect(assignDialog().hasAttribute('open')).toBe(false));
        expect(assignCalls(transport)).toEqual([[['BidCos-RF.MEQ0123456:1'], 'room/r9', true]]);
    });

    it('makes a new room at the root, checks it, and assigns it only with Apply', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await expand('MEQ0123456');
        await select('MEQ0123456:1');
        await openAssign('devices-assign-room');

        await fireEvent.click(screen.getByTestId('assign-new'));
        const name = await waitFor(() => screen.getByTestId<HTMLInputElement>('assign-new-name'));
        expect(document.activeElement).toBe(name);
        await fireEvent.input(name, {target: {value: 'Keller'}});
        transport.reset();
        await fireEvent.keyDown(name, {key: 'Enter'});

        await waitFor(() => expect(rowState('room/keller')).toBe('on'));
        expect(transport.lastCall('meta.node.create')).toEqual(['room', undefined, 'Keller']);
        expect(transport.countOf('meta.assign')).toBe(0);
        expect(assignDialog().hasAttribute('open')).toBe(true);

        await fireEvent.click(screen.getByTestId('assign-apply'));
        await waitFor(() => expect(assignDialog().hasAttribute('open')).toBe(false));
        expect(assignCalls(transport)).toEqual([[['BidCos-RF.MEQ0123456:1'], 'room/keller', true]]);
        await waitFor(() => expect(taxonomyCells('MEQ0123456:1').rooms).toContain('Keller'));
    });

    it('opens from the context menu on the row it was opened on, or on the selection it is part of', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await fireEvent.contextMenu(rowOf('JEQ0234567'));
        await fireEvent.click(within(screen.getByTestId('devices-menu')).getByText('Raum zuordnen…'));
        await waitFor(() => expect(screen.getByTestId('assign-count').textContent).toBe('Eine Zeile ausgewählt'));
        await fireEvent.click(within(screen.getByTestId('assign-dialog')).getByText('Abbrechen'));

        await select('MEQ0123456');
        await select('JEQ0234567', true);
        await fireEvent.contextMenu(rowOf('JEQ0234567'));
        await fireEvent.click(within(screen.getByTestId('devices-menu')).getByText('Gewerk zuordnen…'));
        await waitFor(() => expect(screen.getByTestId('assign-count').textContent).toBe('2 Zeilen ausgewählt'));
    });

    it('keeps a node the store refused, with its reason, and Apply sends only that one again', async () => {
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await expand('MEQ0123456');
        await select('MEQ0123456:1');
        await openAssign('devices-assign-room');
        // the kitchen goes through, outside is refused
        transport.respond('meta.assign', (_refs, path) => {
            if (path === 'room/aussen') {
                throw new ApiRequestError({message: 'forbidden', kind: 'validation'});
            }
            return null;
        });
        const notices = stores.notices.items.length;

        await fireEvent.click(checkOf('room/eg/kueche'));
        await fireEvent.click(checkOf('room/aussen'));
        transport.reset();
        await fireEvent.click(screen.getByTestId('assign-apply'));

        await waitFor(() =>
            expect(screen.getByTestId('assign-summary').textContent).toContain('Eine Änderung wurde nicht gespeichert'),
        );
        expect(assignCalls(transport)).toEqual([
            [['BidCos-RF.MEQ0123456:1'], 'room/eg/kueche', false],
            [['BidCos-RF.MEQ0123456:1'], 'room/aussen', true],
        ]);
        expect(assignDialog().hasAttribute('open')).toBe(true);
        expect(within(assignRow('room/aussen')).getByTestId('assign-error').textContent).toContain(
            'Nicht gespeichert: forbidden',
        );
        expect(within(assignRow('room/eg/kueche')).queryByTestId('assign-error')).toBeNull();
        // the user's choice stays on the refused node; no toast on top of the dialog
        expect(rowState('room/aussen')).toBe('on');
        expect(rowState('room/eg/kueche')).toBe('off');
        expect(stores.notices.items).toHaveLength(notices);

        transport.respond('meta.assign', () => null);
        transport.reset();
        await fireEvent.click(screen.getByTestId('assign-apply'));
        await waitFor(() => expect(assignDialog().hasAttribute('open')).toBe(false));
        expect(assignCalls(transport)).toEqual([[['BidCos-RF.MEQ0123456:1'], 'room/aussen', true]]);
    });
});

describe('the store indicator and the settings section', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
    });

    it('names the provider in the interface popup and colours its state', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        // 2026-09-10: the store is an entry of the interface picker, under the host
        expect(screen.queryByTestId('meta-indicator')).toBeNull();
        await fireEvent.click(screen.getByTestId('interface-select-trigger'));
        let indicator = screen.getByTestId('meta-indicator');
        // a selectable entry, like an interface, with the state in its title
        expect(indicator.tagName).toBe('BUTTON');
        expect(indicator.getAttribute('role')).toBe('option');
        expect(indicator.getAttribute('aria-selected')).toBe('false');
        expect(indicator.textContent.trim()).toBe('Dieses Profil');
        expect(indicator.dataset['mark']).toBe('ok');
        expect(indicator.title).toContain('Revision 7, 6 Objekte');

        transport.emit('meta.changed', {
            provider: 'occulite',
            reachable: true,
            writable: false,
            revision: 3,
            objects: 12,
            implementation: 'occulited 0.1.0',
        });
        await waitFor(() => expect(indicator.dataset['mark']).toBe('readonly'));
        expect(indicator.textContent.trim()).toBe('occulited');
        expect(indicator.title).toContain('occulited 0.1.0');
        expect(indicator.title).toContain('Nur lesen');

        transport.emit('meta.changed', {
            provider: 'occulite',
            reachable: false,
            writable: false,
            revision: 3,
            objects: 12,
            error: 'box off',
        });
        // unreachable: still there, no longer a button, the reason in its title
        await waitFor(() => expect(screen.getByTestId('meta-indicator').tagName).toBe('DIV'));
        indicator = screen.getByTestId('meta-indicator');
        expect(indicator.dataset['mark']).toBe('bad');
        expect(indicator.getAttribute('aria-disabled')).toBe('true');
        expect(indicator.title).toContain('box off');

        transport.emit('meta.changed', {
            provider: 'rega',
            reachable: true,
            writable: true,
            revision: 2,
            objects: 40,
            flat: true,
        });
        await waitFor(() => expect(screen.getByTestId('meta-indicator').textContent.trim()).toBe('ReGaHSS'));
        expect(screen.getByTestId('meta-indicator').dataset['mark']).toBe('ok');
    });

    it('is not drawn at all without a store', async () => {
        await mountApp({transport: new MockTransport(), hash: ''});
        await fireEvent.click(screen.getByTestId('interface-select-trigger'));
        expect(screen.queryByTestId('meta-indicator')).toBeNull();
    });

    it('has its section in the settings, which stores the provider choice and the token', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await fireEvent.click(screen.getByTestId('settings-button'));
        await waitFor(() => expect(screen.getByTestId('config-dialog')).toBeTruthy());
        expect(screen.getByTestId('config-meta-state').textContent).toContain('Erreichbar');
        expect(screen.getByTestId('config-meta-state').textContent).toContain('Schreibbar');

        const provider = screen.getByTestId<HTMLSelectElement>('config-meta-provider');
        expect(provider.value).toBe('auto');
        expect([...provider.options].map((option) => option.textContent)).toEqual([
            'Automatisch',
            'Dieses Profil',
            'occulited',
            'ReGaHSS',
        ]);
        await fireEvent.change(provider, {target: {value: 'occulite'}});
        await fireEvent.input(screen.getByTestId('config-meta-token'), {target: {value: 'olt_secret'}});
        await fireEvent.click(screen.getByTestId('config-save'));
        await waitFor(() => expect(transport.lastCall('config.set')?.[0]?.metaProvider).toBe('occulite'));
        expect(transport.lastCall('config.set')?.[0]?.metaToken).toBe('olt_secret');
    });
});
