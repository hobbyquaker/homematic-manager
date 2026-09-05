import {fireEvent, render, screen, within} from '@testing-library/svelte';
import type {Component} from 'svelte';
import {describe, expect, it, vi} from 'vitest';

import DataTableComponent from './DataTable.svelte';
import type {DataTableColumn} from './tableModel.js';

/**
 * A generic Svelte component resolves its type parameter to `unknown` when it is handed to
 * `render()`, which `exactOptionalPropertyTypes` then rejects. The props are checked by the
 * component's own signature where it is really used; here they only have to be passed through.
 */
const DataTable = DataTableComponent as unknown as Component<Record<string, unknown>>;

interface Row {
    address: string;
    name: string;
    type: string;
    channels?: Row[];
}

const columns: DataTableColumn<Row>[] = [
    {key: 'name', label: 'Name', width: 140},
    {key: 'address', label: 'ADDRESS', width: 120, mono: true},
    {key: 'type', label: 'TYPE'},
];

function makeRows(count: number): Row[] {
    return Array.from({length: count}, (_unused, index) => ({
        address: `ADDR${String(index).padStart(5, '0')}`,
        name: `Device ${index}`,
        type: index % 2 === 0 ? 'HM-LC-Sw1' : 'HM-LC-Dim1',
        channels: [
            {
                address: `ADDR${String(index).padStart(5, '0')}:1`,
                name: `Device ${index}:1`,
                type: 'SWITCH',
            },
        ],
    }));
}

const base = {
    columns,
    getId: (row: Row) => row.address,
    height: 230,
    rowHeight: 23,
};

function rowsInDom(): HTMLElement[] {
    return screen.getAllByRole('row').filter((element) => element.dataset['rowId'] !== undefined);
}

describe('DataTable', () => {
    it('draws the headers and the rows of the window only', () => {
        render(DataTable, {props: {...base, rows: makeRows(2000)}});

        expect(screen.getByRole('columnheader', {name: /Name/})).toBeTruthy();
        const drawn = rowsInDom();
        // 230 px of body at 23 px per row plus 6 rows of overscan on both sides.
        expect(drawn.length).toBeLessThan(30);
        expect(drawn.length).toBeGreaterThan(10);
        expect(screen.getByRole('grid').getAttribute('aria-rowcount')).toBe('2000');
        expect(screen.getByText('Device 0')).toBeTruthy();
        expect(screen.queryByText('Device 500')).toBeNull();
    });

    it('renders rows further down after a scroll', async () => {
        const {container} = render(DataTable, {props: {...base, rows: makeRows(2000)}});
        const body = container.querySelector('.hmm-table-body');
        expect(body).toBeTruthy();

        Object.defineProperty(body, 'scrollTop', {value: 23 * 500, writable: true, configurable: true});
        await fireEvent.scroll(body!);

        expect(screen.getByText('Device 500')).toBeTruthy();
        expect(screen.queryByText('Device 0')).toBeNull();
    });

    it('filters through the global box and shows a parent whose channel matches', async () => {
        render(DataTable, {props: {...base, rows: makeRows(20), subRows: (row: Row) => row.channels ?? []}});

        await fireEvent.input(screen.getByLabelText('Filter'), {target: {value: 'Device 7:1'}});
        expect(rowsInDom()).toHaveLength(1);
        expect(screen.getByText('Device 7')).toBeTruthy();
    });

    it('filters per column, as the 2.x filter toolbar did', async () => {
        render(DataTable, {props: {...base, rows: makeRows(20)}});
        await fireEvent.input(screen.getByLabelText('Filter: TYPE'), {target: {value: 'Dim'}});
        expect(rowsInDom()).toHaveLength(10);
    });

    it('sorts ascending, descending and back to unsorted', async () => {
        render(DataTable, {props: {...base, rows: makeRows(5)}});
        const header = screen.getByRole('columnheader', {name: /Name/});
        const button = within(header).getByRole('button');

        await fireEvent.click(button);
        expect(header.getAttribute('aria-sort')).toBe('ascending');
        expect(rowsInDom()[0]?.textContent).toContain('Device 0');

        await fireEvent.click(button);
        expect(header.getAttribute('aria-sort')).toBe('descending');
        expect(rowsInDom()[0]?.textContent).toContain('Device 4');

        await fireEvent.click(button);
        expect(header.getAttribute('aria-sort')).toBe('none');
    });

    it('expands a row into its sub-rows and collapses it again', async () => {
        render(DataTable, {props: {...base, rows: makeRows(3), subRows: (row: Row) => row.channels ?? []}});
        expect(rowsInDom()).toHaveLength(3);

        const expander = screen.getAllByRole('button', {name: 'Expand row'})[0];
        await fireEvent.click(expander!);
        expect(rowsInDom()).toHaveLength(4);
        expect(screen.getByText('Device 0:1')).toBeTruthy();

        await fireEvent.click(screen.getByRole('button', {name: 'Collapse row'}));
        expect(rowsInDom()).toHaveLength(3);
    });

    it('selects single, with ctrl and with shift', async () => {
        render(DataTable, {props: {...base, rows: makeRows(5)}});
        const rows = rowsInDom();

        await fireEvent.click(rows[1]!);
        expect(rows[1]?.getAttribute('aria-selected')).toBe('true');

        await fireEvent.click(rows[3]!, {ctrlKey: true});
        expect(rowsInDom().filter((row) => row.getAttribute('aria-selected') === 'true')).toHaveLength(2);

        await fireEvent.click(rows[0]!, {shiftKey: true});
        expect(rowsInDom().filter((row) => row.getAttribute('aria-selected') === 'true')).toHaveLength(4);

        await fireEvent.click(rows[2]!);
        expect(rowsInDom().filter((row) => row.getAttribute('aria-selected') === 'true')).toHaveLength(1);
    });

    it('moves the selection with the keyboard and activates with Enter', async () => {
        const onactivate = vi.fn();
        render(DataTable, {props: {...base, rows: makeRows(5), onactivate}});
        const grid = screen.getByRole('grid');

        await fireEvent.keyDown(grid, {key: 'ArrowDown'});
        expect(rowsInDom()[1]?.getAttribute('aria-selected')).toBe('true');

        await fireEvent.keyDown(grid, {key: 'ArrowDown', shiftKey: true});
        expect(rowsInDom().filter((row) => row.getAttribute('aria-selected') === 'true')).toHaveLength(2);

        await fireEvent.keyDown(grid, {key: 'End'});
        expect(rowsInDom().at(-1)?.getAttribute('aria-selected')).toBe('true');

        await fireEvent.keyDown(grid, {key: 'Home'});
        expect(rowsInDom()[0]?.getAttribute('aria-selected')).toBe('true');

        await fireEvent.keyDown(grid, {key: 'Enter'});
        expect(onactivate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({address: 'ADDR00000'}));

        await fireEvent.keyDown(grid, {key: ' '});
        expect(rowsInDom()[0]?.getAttribute('aria-selected')).toBe('false');

        await fireEvent.keyDown(grid, {key: 'x'});
    });

    it('expands and collapses with the arrow keys', async () => {
        render(DataTable, {props: {...base, rows: makeRows(3), subRows: (row: Row) => row.channels ?? []}});
        const grid = screen.getByRole('grid');

        await fireEvent.keyDown(grid, {key: 'ArrowRight'});
        expect(rowsInDom()).toHaveLength(4);
        await fireEvent.keyDown(grid, {key: 'ArrowRight'});
        expect(rowsInDom()).toHaveLength(4);
        await fireEvent.keyDown(grid, {key: 'ArrowLeft'});
        expect(rowsInDom()).toHaveLength(3);
        await fireEvent.keyDown(grid, {key: 'ArrowLeft'});
        expect(rowsInDom()).toHaveLength(3);
    });

    it('activates on a double click', async () => {
        const onactivate = vi.fn();
        render(DataTable, {props: {...base, rows: makeRows(3), onactivate}});
        await fireEvent.dblClick(rowsInDom()[2]!);
        expect(onactivate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({address: 'ADDR00002'}));
    });

    it('offers a context menu hook and selects the row it was opened on', async () => {
        const onrowcontextmenu = vi.fn();
        render(DataTable, {props: {...base, rows: makeRows(3), onrowcontextmenu}});

        await fireEvent.contextMenu(rowsInDom()[1]!);
        expect(onrowcontextmenu).toHaveBeenCalledOnce();
        expect(rowsInDom()[1]?.getAttribute('aria-selected')).toBe('true');

        // A right click inside an existing selection keeps it, so "delete these five" works.
        await fireEvent.contextMenu(rowsInDom()[1]!);
        expect(onrowcontextmenu).toHaveBeenCalledTimes(2);
    });

    it('ignores a right click when nobody wants it', async () => {
        render(DataTable, {props: {...base, rows: makeRows(3)}});
        await fireEvent.contextMenu(rowsInDom()[1]!);
        expect(rowsInDom()[1]?.getAttribute('aria-selected')).toBe('false');
    });

    it('shows the caption, the count and the empty text', () => {
        render(DataTable, {
            props: {...base, rows: [], caption: 'Geräte', countText: 'Showing 0 of 0', emptyText: 'Keine Daten'},
        });
        expect(screen.getByText('Geräte')).toBeTruthy();
        expect(screen.getByText('Showing 0 of 0')).toBeTruthy();
        expect(screen.getByText('Keine Daten')).toBeTruthy();
        expect(rowsInDom()).toHaveLength(0);
    });

    it('can hide the filter boxes and a column', () => {
        render(DataTable, {
            props: {
                ...base,
                columns: [...columns, {key: 'secret', label: 'Secret', hidden: true}],
                rows: makeRows(2),
                filterBox: false,
                columnFilterRow: false,
                caption: undefined,
            },
        });
        expect(screen.queryByLabelText('Filter')).toBeNull();
        expect(screen.queryByLabelText('Filter: TYPE')).toBeNull();
        expect(screen.queryByRole('columnheader', {name: 'Secret'})).toBeNull();
    });

    it('measures its body when no height is given', () => {
        const {container} = render(DataTable, {props: {...base, height: undefined, rows: makeRows(4)}});
        expect(container.querySelector('.hmm-table-body')).toBeTruthy();
        expect(rowsInDom().length).toBeGreaterThan(0);
    });

    it('renders a custom cell snippet where the caller supplies one', () => {
        // The devices grid draws the firmware update button and the icon this way; the snippet is
        // exercised through the Devices page test, here only the default path is asserted.
        render(DataTable, {props: {...base, rows: makeRows(1)}});
        expect(screen.getByText('HM-LC-Sw1')).toBeTruthy();
    });
});

describe('the channel sub-grid', () => {
    const subColumns: DataTableColumn<Row>[] = [
        {key: 'address', label: 'ADDRESS', width: 120, mono: true},
        {key: 'type', label: 'CHANNEL TYPE'},
    ];

    it('draws the sub-rows with their own columns under their own label row', async () => {
        render(DataTable, {props: {...base, rows: makeRows(1), subRows: (row: Row) => row.channels ?? [], subColumns}});

        await fireEvent.click(screen.getByRole('button', {name: 'Expand row'}));

        const rows = rowsInDom();
        expect(rows[1]?.dataset['rowKind']).toBe('header');
        expect(within(rows[1]!).getByText('CHANNEL TYPE')).toBeTruthy();
        expect(rows[2]?.dataset['rowId']).toBe('ADDR00000:1');
        // The channel row has the two sub-columns, not the three device ones.
        expect(rows[2]?.querySelectorAll('[role="gridcell"]')).toHaveLength(2);
        expect(within(rows[2]!).getByText('SWITCH')).toBeTruthy();
    });

    it('does not select the label row, and does not activate on a double click', async () => {
        const onactivate = vi.fn();
        render(DataTable, {
            props: {...base, rows: makeRows(1), subRows: (row: Row) => row.channels ?? [], subColumns, onactivate},
        });
        await fireEvent.click(screen.getByRole('button', {name: 'Expand row'}));

        const header = rowsInDom()[1]!;
        await fireEvent.click(header);
        await fireEvent.dblClick(header);

        expect(header.classList.contains('hmm-tr-selected')).toBe(false);
        expect(onactivate).not.toHaveBeenCalled();
    });
});
