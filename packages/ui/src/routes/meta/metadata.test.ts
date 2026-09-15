import type {MetaState} from '@homematic-manager/core';
import {fireEvent, screen, waitFor, within} from '@testing-library/svelte';
import {beforeEach, describe, expect, it} from 'vitest';

import {STORE_INTERFACE} from '../../lib/stores/routing.js';
import {MockTransport} from '../../lib/transport/MockTransport.js';
import {mountApp} from '../../testHarness.js';

/**
 * The metadata store as a selection of the interface picker with pages of its own (the
 * maintainer, 2026-09-10) - against the demo store, which is core's `MetaStore` and answers every
 * write with a revision and the three events. The demo store is a tree, so the Metadata page is
 * what the demo shows; the flat pages of ReGaHSS are made by telling the app the store is flat.
 */

const REGA: MetaState = {provider: 'rega', reachable: true, writable: true, revision: 2, objects: 6, flat: true};

function rowIds(table = 'meta-table'): string[] {
    return [...screen.getByTestId(table).querySelectorAll<HTMLElement>('[data-row-id][data-row-kind="row"]')].map(
        (row) => row.getAttribute('data-row-id') ?? '',
    );
}

function row(id: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(`[data-row-id="${id}"]`);
    expect(element, `no row ${id}`).not.toBeNull();
    return element!;
}

function cells(id: string): string[] {
    return [...row(id).querySelectorAll('[role=gridcell]')].map((cell) => cell.textContent.trim());
}

function tabLabels(): string[] {
    return screen.getAllByRole('tab').map((tab) => tab.textContent.replace(/\s+/g, ' ').trim());
}

async function openStore(): Promise<void> {
    await fireEvent.click(screen.getByTestId('interface-select-trigger'));
    await fireEvent.click(screen.getByTestId('meta-indicator'));
}

describe('the store as a selection', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
    });

    it('opens the Metadata tab from the picker, says its name in the trigger and loads no interface', async () => {
        const {stores, router} = await mountApp({transport, hash: '#/BidCos-RF/links'});
        transport.reset();
        await openStore();

        await waitFor(() => expect(stores.app.selectedInterface).toBe(STORE_INTERFACE));
        expect(tabLabels()).toEqual(['Metadaten']);
        expect(router.location.hash).toBe('#/%23store/metadata');
        expect(screen.getByTestId('interface-select-trigger').textContent).toContain('Dieses Profil');
        expect(screen.getByTestId('meta-table')).toBeTruthy();
        expect(screen.queryByTestId('devices-table')).toBeNull();
        expect(transport.countOf('devices.list')).toBe(0);

        // and the way back gives the interface its tab
        await fireEvent.click(screen.getByTestId('interface-select-trigger'));
        expect(screen.getByTestId('meta-indicator').getAttribute('aria-selected')).toBe('true');
        await fireEvent.click(screen.getByTestId('interface-item-HmIP-RF'));
        await waitFor(() => expect(stores.app.selectedInterface).toBe('HmIP-RF'));
        expect(stores.app.tab).toBe('links');
        expect(screen.getByTestId('links-table')).toBeTruthy();
    });

    it('has Rooms and Functions on a flat store, and the device grid button goes there', async () => {
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/devices'});
        transport.emit('meta.changed', REGA);
        await fireEvent.click(screen.getByTestId('devices-taxonomy'));
        await waitFor(() => expect(stores.app.selectedInterface).toBe(STORE_INTERFACE));
        expect(tabLabels()).toEqual(['Räume', 'Gewerke']);
        expect(stores.app.tab).toBe('rooms');
        expect(screen.getByTestId('meta-table-room')).toBeTruthy();

        await fireEvent.click(screen.getByRole('tab', {name: 'Gewerke'}));
        await waitFor(() => expect(screen.getByTestId('meta-table-function')).toBeTruthy());
        expect(rowIds('meta-table-function')).toEqual(['function/licht', 'function/heizung', 'function/sicherheit']);
    });

    it('starts on the store from a bookmark', async () => {
        const {stores} = await mountApp({transport, hash: '#/%23store/metadata'});
        expect(stores.app.selectedInterface).toBe(STORE_INTERFACE);
        expect(screen.getByTestId('meta-table')).toBeTruthy();
        expect(screen.getByTestId('interface-select-trigger').textContent).toContain('Dieses Profil');
    });

    it('has no entry and no tabs of its own without a store', async () => {
        const {stores} = await mountApp({transport: new MockTransport(), hash: ''});
        await fireEvent.click(screen.getByTestId('interface-select-trigger'));
        expect(screen.queryByTestId('meta-indicator')).toBeNull();
        expect(stores.tabs).not.toContain('metadata');
    });
});

describe('the Rooms page of a flat store', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
    });

    async function open(): Promise<Awaited<ReturnType<typeof mountApp>>> {
        const mounted = await mountApp({transport, hash: '#/BidCos-RF/devices'});
        transport.emit('meta.changed', REGA);
        await mounted.stores.selectInterface(STORE_INTERFACE);
        await waitFor(() => expect(screen.getByTestId('meta-table-room')).toBeTruthy());
        return mounted;
    }

    it('is the device grid look: one row per node with its members and path, the count on the right', async () => {
        await open();
        // the demo tree is drawn as the list ReGa would give: every node, floors included
        expect(rowIds('meta-table-room')).toEqual([
            'room/eg',
            'room/eg/kueche',
            'room/eg/wohnzimmer',
            'room/eg/flur',
            'room/og',
            'room/og/bad',
            'room/og/schlafzimmer',
            'room/aussen',
        ]);
        expect(cells('room/eg/kueche')).toEqual(['Küche', '', '1', 'room/eg/kueche']);
        expect(cells('room/eg')).toEqual(['Erdgeschoss', '', '3', 'room/eg']);
        expect(screen.getByTestId('meta-table-room-count').textContent).toBe('8 Räume');
        expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent.trim())).toEqual([
            'Name',
            'Geräte',
            'Kanäle',
            'Pfad',
        ]);
        // flat: no "add below", no "move", and no expander column
        expect(screen.queryByTestId('meta-add-below')).toBeNull();
        expect(screen.queryByTestId('meta-move')).toBeNull();
        expect(screen.queryByTestId('meta-new-enum')).toBeNull();
        expect(within(screen.getByTestId('meta-table-room')).queryByRole('button', {name: 'Expand row'})).toBeNull();
    });

    it('adds a room at the root through the dialog, and the event draws it', async () => {
        await open();
        await fireEvent.click(screen.getByTestId('meta-add'));
        await waitFor(() => expect(screen.getByTestId('meta-name-dialog').hasAttribute('open')).toBe(true));
        await fireEvent.input(screen.getByTestId('meta-name-input'), {target: {value: 'Keller'}});
        await fireEvent.keyDown(screen.getByTestId('meta-name-input'), {key: 'Enter'});
        await waitFor(() => expect(transport.lastCall('meta.node.create')).toEqual(['room', undefined, 'Keller']));
        await waitFor(() => expect(rowIds('meta-table-room')).toContain('room/keller'));
        expect(screen.getByTestId('meta-name-dialog').hasAttribute('open')).toBe(false);
    });

    it('renames the selected row with the button and with Enter', async () => {
        await open();
        await fireEvent.click(row('room/aussen'));
        await fireEvent.click(screen.getByTestId('meta-rename'));
        await waitFor(() => expect(screen.getByTestId('meta-name-dialog').hasAttribute('open')).toBe(true));
        expect(screen.getByTestId<HTMLInputElement>('meta-name-input').value).toBe('Außen');
        await fireEvent.input(screen.getByTestId('meta-name-input'), {target: {value: 'Garten'}});
        await fireEvent.click(screen.getByTestId('meta-name-apply'));
        await waitFor(() => expect(transport.lastCall('meta.node.update')).toEqual(['room/aussen', {name: 'Garten'}]));
        await waitFor(() => expect(cells('room/aussen')[0]).toBe('Garten'));

        // Enter on the focused row, as the grids do elsewhere
        await fireEvent.keyDown(screen.getByTestId('meta-table-room').querySelector('[role=grid]')!, {key: 'Enter'});
        await waitFor(() => expect(screen.getByTestId('meta-name-dialog').hasAttribute('open')).toBe(true));
        expect(screen.getByTestId<HTMLInputElement>('meta-name-input').value).toBe('Garten');
    });

    it('asks before a deletion, names the members and detaches them', async () => {
        const {stores} = await open();
        await fireEvent.click(row('room/eg/kueche'));
        await fireEvent.click(screen.getByTestId('meta-delete'));
        await waitFor(() => expect(screen.getByTestId('meta-delete-dialog').hasAttribute('open')).toBe(true));
        expect(screen.getByTestId('meta-delete-members').textContent).toContain('Licht Küche:1 (MEQ0123456:1)');
        expect(screen.getByTestId('meta-delete-apply').textContent).toBe('Löschen und Zuordnungen entfernen');
        await fireEvent.click(screen.getByTestId('meta-delete-apply'));
        await waitFor(() => expect(transport.lastCall('meta.node.delete')).toEqual(['room/eg/kueche', true]));
        await waitFor(() => expect(rowIds('meta-table-room')).not.toContain('room/eg/kueche'));
        expect(stores.taxonomy.view('BidCos-RF.MEQ0123456:1')?.enums).not.toContain('room/eg/kueche');

        // an empty node goes without the detach - every demo room has members, so make one
        await stores.taxonomy.createNode('room', undefined, 'Keller');
        await waitFor(() => expect(rowIds('meta-table-room')).toContain('room/keller'));
        await fireEvent.click(row('room/keller'));
        await fireEvent.click(screen.getByTestId('meta-delete'));
        await waitFor(() => expect(screen.getByTestId('meta-delete-dialog').hasAttribute('open')).toBe(true));
        expect(screen.getByTestId('meta-delete-apply').textContent).toBe('Löschen');
    });

    it('reads the store again from the refresh button', async () => {
        await open();
        await fireEvent.click(screen.getByTestId('meta-refresh'));
        await waitFor(() => expect(transport.countOf('meta.refresh')).toBe(1));
    });

    it('greys every write out with the reason when the store is read-only', async () => {
        await open();
        transport.emit('meta.changed', {...REGA, writable: false});
        await waitFor(() => expect(screen.getByTestId<HTMLButtonElement>('meta-add').disabled).toBe(true));
        expect(screen.getByTestId('meta-add-tooltip').getAttribute('data-tooltip')).toContain('keine Änderungen');
        await fireEvent.click(row('room/aussen'));
        expect(screen.getByTestId<HTMLButtonElement>('meta-rename').disabled).toBe(true);
        expect(screen.getByTestId<HTMLButtonElement>('meta-delete').disabled).toBe(true);
        expect(screen.getByTestId<HTMLButtonElement>('meta-refresh').disabled).toBe(false);
    });
});

describe('the Metadata page of a tree store', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
    });

    async function open(): Promise<Awaited<ReturnType<typeof mountApp>>> {
        const mounted = await mountApp({transport, hash: '#/%23store/metadata'});
        await waitFor(() => expect(screen.getByTestId('meta-table')).toBeTruthy());
        return mounted;
    }

    function depthOf(id: string): string {
        return row(id).querySelector('[data-depth]')?.getAttribute('data-depth') ?? '';
    }

    it('lets the Devices and Channels counts be resized like any text column (B-35, #157)', async () => {
        await open();
        expect(screen.getByTestId('meta-table-resize-devices')).toBeTruthy();
        expect(screen.getByTestId('meta-table-resize-channels')).toBeTruthy();
        const counts = screen.getByTestId('meta-table').querySelectorAll('.hmm-td[data-column-key="devices"]');
        expect(counts.length).toBeGreaterThan(0);
        expect([...counts].some((cell) => cell.classList.contains('hmm-td-fixed'))).toBe(false);
    });

    it('draws every taxonomy as a row with its nodes under it, opened, indented by depth', async () => {
        await open();
        expect(rowIds()).toEqual([
            'room',
            'room/eg',
            'room/eg/kueche',
            'room/eg/wohnzimmer',
            'room/eg/flur',
            'room/og',
            'room/og/bad',
            'room/og/schlafzimmer',
            'room/aussen',
            'function',
            'function/licht',
            'function/heizung',
            'function/sicherheit',
            'floor',
        ]);
        // the expander is no cell, so the name is the first one on both levels
        expect(cells('room')).toEqual(['Räume', '', '6', 'room']);
        expect(cells('room/eg/kueche')).toEqual(['Küche', '', '1', 'room/eg/kueche']);
        expect(depthOf('room')).toBe('0');
        expect(depthOf('room/eg')).toBe('1');
        expect(depthOf('room/eg/kueche')).toBe('2');
        expect(row('room/eg/kueche').querySelector<HTMLElement>('[data-depth]')?.style.paddingLeft).toBe('14px');
        expect(screen.getByTestId('meta-table-count').textContent).toBe('3 Taxonomien');
        // an empty taxonomy has no expander
        expect(within(row('floor')).queryByRole('button', {name: 'Expand row'})).toBeNull();
        expect(within(row('room')).getByRole('button', {name: 'Collapse row'})).toBeTruthy();
    });

    it('makes a new taxonomy from a name, with the id derived from it', async () => {
        await open();
        await fireEvent.click(screen.getByTestId('meta-new-enum'));
        await waitFor(() => expect(screen.getByTestId('meta-name-dialog').hasAttribute('open')).toBe(true));
        await fireEvent.input(screen.getByTestId('meta-name-input'), {target: {value: 'Zonen'}});
        await fireEvent.click(screen.getByTestId('meta-name-apply'));
        await waitFor(() =>
            expect(transport.lastCall('meta.enum.create')).toEqual(['zonen', {en: 'Zonen', de: 'Zonen'}]),
        );
        await waitFor(() => expect(rowIds()).toContain('zonen'));
        expect(cells('zonen')[0]).toBe('Zonen');
    });

    it('renames a taxonomy in the UI language and in English, and deletes it with its members', async () => {
        await open();
        await fireEvent.click(row('floor'));
        await fireEvent.click(screen.getByTestId('meta-rename'));
        await waitFor(() => expect(screen.getByTestId('meta-name-dialog').hasAttribute('open')).toBe(true));
        await fireEvent.input(screen.getByTestId('meta-name-input'), {target: {value: 'Ebenen'}});
        await fireEvent.click(screen.getByTestId('meta-name-apply'));
        await waitFor(() =>
            expect(transport.lastCall('meta.enum.update')).toEqual(['floor', {de: 'Ebenen', en: 'Ebenen'}]),
        );
        await waitFor(() => expect(cells('floor')[0]).toBe('Ebenen'));

        await fireEvent.click(row('function'));
        await fireEvent.click(screen.getByTestId('meta-delete'));
        await waitFor(() => expect(screen.getByTestId('meta-delete-dialog').hasAttribute('open')).toBe(true));
        expect(screen.getByTestId('meta-delete-members').querySelectorAll('li')).toHaveLength(5);
        await fireEvent.click(screen.getByTestId('meta-delete-apply'));
        await waitFor(() => expect(transport.lastCall('meta.enum.delete')).toEqual(['function', true]));
        await waitFor(() => expect(rowIds()).not.toContain('function'));
    });

    it('adds a node at the root of the selected taxonomy, and below the selected node', async () => {
        await open();
        // nothing selected: "add" has nothing to add to
        expect(screen.getByTestId<HTMLButtonElement>('meta-add').disabled).toBe(true);
        expect(screen.getByTestId('meta-add-tooltip').getAttribute('data-tooltip')).toContain('Taxonomie oder');

        await fireEvent.click(row('room'));
        await fireEvent.click(screen.getByTestId('meta-add'));
        await waitFor(() => expect(screen.getByTestId('meta-name-dialog').hasAttribute('open')).toBe(true));
        await fireEvent.input(screen.getByTestId('meta-name-input'), {target: {value: 'Keller'}});
        await fireEvent.click(screen.getByTestId('meta-name-apply'));
        await waitFor(() => expect(transport.lastCall('meta.node.create')).toEqual(['room', undefined, 'Keller']));
        await waitFor(() => expect(rowIds()).toContain('room/keller'));

        await fireEvent.click(row('room/keller'));
        expect(screen.getByTestId<HTMLButtonElement>('meta-add-below').disabled).toBe(false);
        await fireEvent.click(screen.getByTestId('meta-add-below'));
        await waitFor(() => expect(screen.getByTestId('meta-name-dialog').hasAttribute('open')).toBe(true));
        expect(screen.getByTestId('meta-name-dialog').textContent).toContain('Keller');
        await fireEvent.input(screen.getByTestId('meta-name-input'), {target: {value: 'Werkstatt'}});
        await fireEvent.click(screen.getByTestId('meta-name-apply'));
        await waitFor(() =>
            expect(transport.lastCall('meta.node.create')).toEqual(['room', 'room/keller', 'Werkstatt']),
        );
        await waitFor(() => expect(rowIds()).toContain('room/keller/werkstatt'));
        expect(depthOf('room/keller/werkstatt')).toBe('2');
    });

    it('moves a node under a parent picked in the dialog; the members follow', async () => {
        const {stores} = await open();
        // a taxonomy row cannot be moved
        await fireEvent.click(row('room'));
        expect(screen.getByTestId<HTMLButtonElement>('meta-move').disabled).toBe(true);

        await fireEvent.click(row('room/eg/kueche'));
        await fireEvent.click(screen.getByTestId('meta-move'));
        await waitFor(() => expect(screen.getByTestId('meta-move-dialog').hasAttribute('open')).toBe(true));
        const parent = screen.getByTestId<HTMLSelectElement>('meta-move-parent');
        // the top level first, then every room that is not the node or below it; its parent preselected
        expect([...parent.options].map((option) => option.value)).toEqual([
            '',
            'room/eg',
            'room/eg/wohnzimmer',
            'room/eg/flur',
            'room/og',
            'room/og/bad',
            'room/og/schlafzimmer',
            'room/aussen',
        ]);
        expect(parent.value).toBe('room/eg');
        await fireEvent.change(parent, {target: {value: 'room/og'}});
        await fireEvent.click(screen.getByTestId('meta-move-apply'));
        await waitFor(() =>
            expect(transport.lastCall('meta.node.update')).toEqual(['room/eg/kueche', {parent: 'room/og'}]),
        );
        await waitFor(() => expect(rowIds()).toContain('room/og/kueche'));
        expect(stores.taxonomy.view('BidCos-RF.MEQ0123456:1')?.enums).toContain('room/og/kueche');
    });

    it('reports a refused write and keeps the dialog open', async () => {
        transport.fail('meta.node.update', {message: 'forbidden', kind: 'validation'});
        const {stores} = await open();
        await fireEvent.click(row('room/aussen'));
        await fireEvent.click(screen.getByTestId('meta-rename'));
        await waitFor(() => expect(screen.getByTestId('meta-name-dialog').hasAttribute('open')).toBe(true));
        await fireEvent.input(screen.getByTestId('meta-name-input'), {target: {value: 'Garten'}});
        await fireEvent.click(screen.getByTestId('meta-name-apply'));
        await waitFor(() => expect(stores.notices.items.at(-1)?.message).toContain('forbidden'));
        expect(screen.getByTestId('meta-name-dialog').hasAttribute('open')).toBe(true);
        expect(cells('room/aussen')[0]).toBe('Außen');
    });

    it('drops a selection whose row was deleted elsewhere', async () => {
        const {stores} = await open();
        await fireEvent.click(row('room/aussen'));
        expect(screen.getByTestId<HTMLButtonElement>('meta-rename').disabled).toBe(false);
        transport.emit('meta.enums.changed', {
            ...stores.taxonomy.enums,
            room: {name: {en: 'Rooms'}, tree: []},
        });
        await waitFor(() => expect(rowIds()).not.toContain('room/aussen'));
        expect(screen.getByTestId<HTMLButtonElement>('meta-rename').disabled).toBe(true);
    });
});
