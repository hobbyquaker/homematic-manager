import {describe, expect, it} from 'vitest';

import {
    buildRows,
    cellText,
    cellValue,
    compareCells,
    gridTemplate,
    isFilterable,
    isSortable,
    matchesFilters,
    matchesText,
    nextSelection,
    rangeIds,
    tableLayout,
    visibleWindow,
    type DataTableColumn,
} from './tableModel.js';

interface Row {
    address: string;
    name: string;
    version: number;
    channels?: Row[];
}

const columns: DataTableColumn<Row>[] = [
    {key: 'name', label: 'Name'},
    {key: 'address', label: 'ADDRESS', mono: true},
    {key: 'version', label: 'VERSION'},
    {key: 'secret', label: 'Secret', hidden: true},
    {key: 'actions', label: '', sortable: false, filterable: false},
];

const rows: Row[] = [
    {
        address: 'MEQ0000002',
        name: 'Licht Küche',
        version: 8,
        channels: [{address: 'MEQ0000002:1', name: 'Licht Küche:1', version: 8}],
    },
    {address: 'MEQ0000001', name: '', version: 34, channels: []},
    {
        address: 'JEQ0000003',
        name: 'Taster Flur',
        version: 15,
        channels: [{address: 'JEQ0000003:1', name: 'Taster Flur:1', version: 15}],
    },
];

const subRows = (row: Row) => row.channels ?? [];
const getId = (row: Row) => row.address;

describe('cell values', () => {
    it('reads the column key, a custom accessor and nothing at all', () => {
        expect(cellValue(rows[0]!, columns[0]!)).toBe('Licht Küche');
        expect(cellValue(rows[0]!, {key: 'x', label: 'x', value: (row) => row.version * 2})).toBe(16);
        expect(cellValue(rows[0]!, {key: 'missing', label: 'missing'})).toBeUndefined();
        expect(cellText(rows[0]!, {key: 'missing', label: 'missing'})).toBe('');
        expect(cellText(rows[0]!, columns[2]!)).toBe('8');
    });

    it('stringifies anything that is not a scalar', () => {
        expect(cellValue({v: {a: 1}} as never, {key: 'v', label: 'v'})).toBe('[object Object]');
        expect(cellValue({v: true} as never, {key: 'v', label: 'v'})).toBe(true);
        expect(cellValue({v: null} as never, {key: 'v', label: 'v'})).toBeUndefined();
    });

    it('knows which columns can be sorted and filtered', () => {
        expect(isSortable(columns[0]!)).toBe(true);
        expect(isSortable(columns[3]!)).toBe(false);
        expect(isSortable(columns[4]!)).toBe(false);
        expect(isFilterable(columns[1]!)).toBe(true);
        expect(isFilterable(columns[4]!)).toBe(false);
    });
});

describe('filtering', () => {
    it('is a case-insensitive contains, like the 2.x "cn" default', () => {
        expect(matchesText('HM-LC-Sw1', 'lc-sw')).toBe(true);
        expect(matchesText('HM-LC-Sw1', 'dim')).toBe(false);
    });

    it("matches the table's one filter box against every filterable column", () => {
        expect(matchesFilters(rows[0]!, columns, 'küche')).toBe(true);
        expect(matchesFilters(rows[0]!, columns, 'MEQ')).toBe(true);
        expect(matchesFilters(rows[0]!, columns, 'nothing')).toBe(false);
        expect(matchesFilters(rows[0]!, columns, '   ')).toBe(true);
    });

    /**
     * Task 20 removed the per-column inputs; `filterable: false` still means "the box does not
     * search this column", which is what keeps an action column out of every result.
     */
    it('never searches a column that opted out of the filter', () => {
        const row = {...rows[0]!, actions: 'delete'} as unknown as Row;
        expect(matchesFilters(row, columns, 'delete')).toBe(false);
        expect(matchesFilters(row, columns, 'Küche')).toBe(true);
    });
});

describe('compareCells', () => {
    it('sorts numbers numerically, text naturally and empty cells last', () => {
        expect(compareCells(2, 10)).toBeLessThan(0);
        expect(compareCells('Kanal 2', 'Kanal 10')).toBeLessThan(0);
        expect(compareCells(false, true)).toBeLessThan(0);
        expect(compareCells('', 'a')).toBeGreaterThan(0);
        expect(compareCells('a', undefined)).toBeLessThan(0);
        expect(compareCells(undefined, '')).toBe(0);
    });
});

describe('buildRows', () => {
    it('flattens only the expanded rows', () => {
        const collapsed = buildRows({rows, columns, getId, children: subRows, expanded: new Set()});
        expect(collapsed).toHaveLength(3);
        expect(collapsed[0]).toMatchObject({id: 'MEQ0000002', depth: 0, hasChildren: true, expanded: false});
        expect(collapsed[1]).toMatchObject({id: 'MEQ0000001', hasChildren: false});

        const expanded = buildRows({rows, columns, getId, children: subRows, expanded: new Set(['MEQ0000002'])});
        expect(expanded.map((row) => row.id)).toEqual(['MEQ0000002', 'MEQ0000002:1', 'MEQ0000001', 'JEQ0000003']);
        expect(expanded[1]).toMatchObject({depth: 1, rootId: 'MEQ0000002', hasChildren: false});
    });

    it('works without sub-rows at all', () => {
        expect(buildRows({rows, columns, getId, expanded: new Set(['MEQ0000002'])})).toHaveLength(3);
    });

    it('keeps a parent whose child matches the filter', () => {
        const flat = buildRows({
            rows,
            columns,
            getId,
            children: subRows,
            expanded: new Set(),
            globalFilter: 'Taster Flur:1',
        });
        expect(flat.map((row) => row.id)).toEqual(['JEQ0000003']);
    });

    it('finds nothing when neither a row nor one of its children matches', () => {
        const flat = buildRows({
            rows,
            columns,
            getId,
            children: subRows,
            expanded: new Set(),
            globalFilter: 'ZZZ',
        });
        expect(flat).toEqual([]);
    });

    it('sorts ascending and descending, and ignores a sort on an unsortable column', () => {
        const byName = buildRows({rows, columns, getId, expanded: new Set(), sort: {key: 'name', direction: 'asc'}});
        expect(byName.map((row) => row.row.name)).toEqual(['Licht Küche', 'Taster Flur', '']);

        const desc = buildRows({rows, columns, getId, expanded: new Set(), sort: {key: 'name', direction: 'desc'}});
        expect(desc.map((row) => row.row.name)).toEqual(['', 'Taster Flur', 'Licht Küche']);

        const untouched = buildRows({
            rows,
            columns,
            getId,
            expanded: new Set(),
            sort: {key: 'actions', direction: 'asc'},
        });
        expect(untouched.map((row) => row.id)).toEqual(['MEQ0000002', 'MEQ0000001', 'JEQ0000003']);

        const unknown = buildRows({rows, columns, getId, expanded: new Set(), sort: {key: 'nope', direction: 'asc'}});
        expect(unknown.map((row) => row.id)).toEqual(['MEQ0000002', 'MEQ0000001', 'JEQ0000003']);
    });

    it('does not mutate the rows it was given', () => {
        const original = [...rows];
        buildRows({rows, columns, getId, expanded: new Set(), sort: {key: 'address', direction: 'asc'}});
        expect(rows).toEqual(original);
    });
});

describe('visibleWindow', () => {
    it('renders a window around the scroll position with overscan', () => {
        expect(visibleWindow(1000, 0, 230, 23, 6)).toEqual({start: 0, end: 22});
        expect(visibleWindow(1000, 2300, 230, 23, 6)).toEqual({start: 94, end: 116});
        // Scrolled far past the end - the window is clamped to the last row, never empty.
        expect(visibleWindow(1000, 100_000, 230, 23, 6)).toEqual({start: 999, end: 1000});
    });

    it('handles an empty table and a body that has not been measured yet', () => {
        expect(visibleWindow(0, 0, 230, 23)).toEqual({start: 0, end: 0});
        expect(visibleWindow(10, 0, 0, 23, 2)).toEqual({start: 0, end: 5});
        expect(visibleWindow(10, 0, 230, 0)).toEqual({start: 0, end: 0});
    });
});

describe('gridTemplate', () => {
    it('turns widths into a grid template and skips hidden columns', () => {
        expect(gridTemplate(columns, false)).toBe(
            'minmax(56px, 120fr) minmax(56px, 120fr) minmax(56px, 120fr) minmax(56px, 120fr)',
        );
        // A width is a weight, so the grid fills its container exactly (D-34, `she`'s tables) -
        // unless the column says it is not to be stretched.
        expect(gridTemplate([{key: 'a', label: 'a', width: 120}], true)).toBe('22px minmax(56px, 120fr)');
        expect(gridTemplate([{key: 'a', label: 'a', width: 24, fixed: true}], false)).toBe('24px');
        // The minimum never exceeds the declared width: a 24 px column stays 24 px wide.
        expect(gridTemplate([{key: 'a', label: 'a', width: 40}], false)).toBe('minmax(40px, 40fr)');
    });
});

/**
 * D-34: the channel sub-grid used to get a template of its own, so none of its columns stood under
 * the column it belongs to, and expanding a device turned the grid ragged.
 */
describe('tableLayout', () => {
    const parent: DataTableColumn<Row>[] = [
        {key: 'icon', label: '', width: 24, fixed: true},
        {key: 'name', label: 'Name', width: 200},
        {key: 'address', label: 'ADDRESS', width: 160},
        {key: 'firmware', label: 'FIRMWARE', width: 150},
    ];
    const child: DataTableColumn<Row>[] = [
        {key: 'name', label: 'Name', width: 90},
        {key: 'address', label: 'ADDRESS', width: 90},
        {key: 'direction', label: 'DIRECTION', width: 100},
    ];

    it('merges the two column sets into one track list, by key', () => {
        const layout = tableLayout(parent, child, true);
        // `direction` is new and follows `address`; `name` and `address` keep the parent's width,
        // so a device column can never move when a device is expanded.
        expect(layout.template).toBe(
            '22px 24px minmax(56px, 200fr) minmax(56px, 160fr) minmax(56px, 100fr) minmax(56px, 150fr)',
        );
        expect(layout.track).toEqual({icon: 2, name: 3, address: 4, direction: 5, firmware: 6});
    });

    it('puts a sub column that matches nothing in front when it comes first', () => {
        const layout = tableLayout(parent, [{key: 'flag', label: 'F', width: 30}], false);
        expect(layout.track['flag']).toBe(1);
        expect(layout.track['icon']).toBe(2);
    });

    it('skips hidden columns on both sides', () => {
        const layout = tableLayout(
            [...parent, {key: 'gone', label: '', width: 10, hidden: true}],
            [...child, {key: 'alsogone', label: '', width: 10, hidden: true}],
            false,
        );
        expect(Object.keys(layout.track)).toEqual(['icon', 'name', 'address', 'direction', 'firmware']);
    });

    it('is the plain column template when there is no sub-grid', () => {
        expect(tableLayout(parent, undefined, false).template).toBe(gridTemplate(parent, false));
    });
});

describe('selection', () => {
    const flat = buildRows({rows, columns, getId: (row) => row.address, expanded: new Set()});

    it('replaces the selection on a plain click', () => {
        expect(nextSelection(flat, ['MEQ0000001'], 'MEQ0000001', 'JEQ0000003', {})).toEqual({
            selected: ['JEQ0000003'],
            anchorId: 'JEQ0000003',
        });
    });

    it('toggles on ctrl-click', () => {
        expect(nextSelection(flat, ['MEQ0000002'], 'MEQ0000002', 'JEQ0000003', {ctrl: true}).selected).toEqual([
            'MEQ0000002',
            'JEQ0000003',
        ]);
        expect(nextSelection(flat, ['MEQ0000002'], 'MEQ0000002', 'MEQ0000002', {ctrl: true}).selected).toEqual([]);
    });

    it('extends from the anchor on shift-click, in both directions', () => {
        expect(nextSelection(flat, [], 'MEQ0000002', 'JEQ0000003', {shift: true}).selected).toEqual([
            'MEQ0000002',
            'MEQ0000001',
            'JEQ0000003',
        ]);
        expect(nextSelection(flat, [], 'JEQ0000003', 'MEQ0000002', {shift: true}).selected).toEqual([
            'MEQ0000002',
            'MEQ0000001',
            'JEQ0000003',
        ]);
    });

    it('shift without an anchor is a plain click, and an unknown row selects itself', () => {
        expect(nextSelection(flat, [], undefined, 'MEQ0000001', {shift: true}).selected).toEqual(['MEQ0000001']);
        expect(rangeIds(flat, 'gone', 'MEQ0000001')).toEqual(['MEQ0000001']);
        expect(rangeIds(flat, 'MEQ0000001', 'gone')).toEqual([]);
    });
});

describe('per-depth columns', () => {
    const subColumns: DataTableColumn<Row>[] = [
        {key: 'address', label: 'ADDRESS', mono: true},
        {key: 'name', label: 'Name'},
    ];

    it("puts a label row above a device's channels when the sub-grid has its own columns", () => {
        const flat = buildRows({
            rows,
            columns,
            getId,
            children: subRows,
            expanded: new Set(['MEQ0000002']),
            subColumns,
            subHeader: true,
        });

        expect(flat.map((row) => [row.id, row.depth, row.kind])).toEqual([
            ['MEQ0000002', 0, 'row'],
            ['MEQ0000002::header', 1, 'header'],
            ['MEQ0000002:1', 1, 'row'],
            ['MEQ0000001', 0, 'row'],
            ['JEQ0000003', 0, 'row'],
        ]);
    });

    it("adds no label row without `subHeader`, so task 7's grids are unchanged", () => {
        const flat = buildRows({rows, columns, getId, children: subRows, expanded: new Set(['MEQ0000002'])});
        expect(flat.every((row) => row.kind === 'row')).toBe(true);
        expect(flat).toHaveLength(4);
    });

    it('adds no label row for a device without channels', () => {
        const flat = buildRows({
            rows,
            columns,
            getId,
            children: subRows,
            expanded: new Set(['MEQ0000001']),
            subColumns,
            subHeader: true,
        });
        expect(flat.map((row) => row.id)).toEqual(['MEQ0000002', 'MEQ0000001', 'JEQ0000003']);
    });

    it('filters a channel through the sub-columns', () => {
        // The channel matches through the sub-grid's own ADDRESS column; its device matches
        // nothing, and is kept because a child of it does.
        const flat = buildRows({
            rows,
            columns,
            getId,
            children: subRows,
            expanded: new Set(),
            subColumns,
            globalFilter: 'MEQ0000002:1',
        });
        expect(flat.map((row) => row.id)).toEqual(['MEQ0000002']);
    });

    it('never selects a label row in a shift-range', () => {
        const flat = buildRows({
            rows,
            columns,
            getId,
            children: subRows,
            expanded: new Set(['MEQ0000002']),
            subColumns,
            subHeader: true,
        });
        expect(rangeIds(flat, 'MEQ0000002', 'MEQ0000002:1')).toEqual(['MEQ0000002', 'MEQ0000002:1']);
    });
});
