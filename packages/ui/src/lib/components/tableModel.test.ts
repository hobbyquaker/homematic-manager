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
    groupSpans,
    hasActiveFilter,
    layoutWidths,
    sizedTemplate,
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

    it('matches the global filter against every filterable column', () => {
        expect(matchesFilters(rows[0]!, columns, 'küche', {})).toBe(true);
        expect(matchesFilters(rows[0]!, columns, 'MEQ', {})).toBe(true);
        expect(matchesFilters(rows[0]!, columns, 'nothing', {})).toBe(false);
        expect(matchesFilters(rows[0]!, columns, '   ', {})).toBe(true);
    });

    it('applies every per-column filter, hidden columns included', () => {
        expect(matchesFilters(rows[0]!, columns, '', {address: 'MEQ'})).toBe(true);
        expect(matchesFilters(rows[0]!, columns, '', {address: 'JEQ'})).toBe(false);
        expect(matchesFilters(rows[0]!, columns, '', {address: ''})).toBe(true);
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

    it('applies a column filter and finds nothing when it does not match', () => {
        const flat = buildRows({
            rows,
            columns,
            getId,
            children: subRows,
            expanded: new Set(),
            columnFilters: {address: 'ZZZ'},
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

    it('names the tracks only the sub-grid has, and no shared or hidden one (task 42)', () => {
        expect(tableLayout(parent, child, true).subKeys).toEqual(['direction']);
        expect(
            tableLayout(parent, [...child, {key: 'aes', label: 'AES', width: 10, hidden: true}], false).subKeys,
        ).toEqual(['direction']);
        expect(tableLayout(parent, undefined, false).subKeys).toEqual([]);
    });
});

/**
 * Task 42: the sub-grid's own columns are sized in the sub-grid and kept under its own table id;
 * the one template draws both sets. A width stored for the wrong side is ignored, so a hand-edited
 * or stale entry cannot size a device column from the sub-grid or the other way round.
 */
describe('layoutWidths', () => {
    const parent: DataTableColumn<Row>[] = [
        {key: 'name', label: 'Name', width: 200},
        {key: 'type', label: 'TYPE', width: 150},
    ];
    const child: DataTableColumn<Row>[] = [
        {key: 'name', label: 'Name'},
        {key: 'direction', label: 'DIRECTION', width: 100},
        {key: 'type', label: 'TYPE'},
    ];
    const layout = tableLayout(parent, child, false);

    it('takes the sub-grid widths for its own tracks and the table widths for the rest', () => {
        expect(layoutWidths(layout, {name: 260, type: 90}, {direction: 140})).toEqual({
            name: 260,
            type: 90,
            direction: 140,
        });
    });

    it('ignores a sub-grid width for a shared column and a table width for a sub-grid column', () => {
        expect(layoutWidths(layout, {direction: 300}, {name: 50, type: 60})).toEqual({});
    });

    it('draws both on the one template', () => {
        const widths = layoutWidths(layout, {type: 90}, {direction: 140});
        expect(sizedTemplate(layout, widths).template).toBe('minmax(56px, 200fr) 140px 90px');
    });
});

/**
 * Task 40 (#157): a dragged column is pixels, the others keep sharing the rest by weight, and the
 * fixed ones keep their pixels whatever is stored for them.
 */
describe('sizedTemplate', () => {
    const parent: DataTableColumn<Row>[] = [
        {key: 'icon', label: '', width: 24, fixed: true},
        {key: 'name', label: 'Name', width: 200},
        {key: 'address', label: 'ADDRESS', width: 40},
        {key: 'type', label: 'TYPE'},
    ];

    it('is the designed template without widths', () => {
        const layout = tableLayout(parent, undefined, true);
        expect(sizedTemplate(layout).template).toBe(layout.template);
        // 22 expander + 24 fixed + 56 + 40 (a declared width below the minimum) + 56
        expect(sizedTemplate(layout).minWidth).toBe(198);
    });

    it('draws a user width as pixels and leaves the other columns proportional', () => {
        const layout = tableLayout(parent, undefined, false);
        const sized = sizedTemplate(layout, {name: 310, type: 90});
        expect(sized.template).toBe('24px 310px minmax(40px, 40fr) 90px');
        expect(sized.minWidth).toBe(24 + 310 + 40 + 90);
    });

    it('ignores a width for a fixed column and for a column that is not there', () => {
        const layout = tableLayout(parent, undefined, false);
        expect(sizedTemplate(layout, {icon: 300, gone: 500}).template).toBe(layout.template);
    });

    it('sizes a shared track once, for the device and the channel column alike', () => {
        const layout = tableLayout(parent, [{key: 'name', label: 'Name', width: 90}], false);
        expect(sizedTemplate(layout, {name: 250}).template).toBe('24px 250px minmax(40px, 40fr) minmax(56px, 120fr)');
    });

    /**
     * B-34 gave a column its own minimum: a narrow window must not squeeze it to the grid's 56 px. On
     * its own that minimum is the window's only; a dragged width still wins.
     */
    it('keeps a column with its own minimum at that minimum, and a dragged width still wins', () => {
        const layout = tableLayout(
            [
                {key: 'marks', label: 'Marks', width: 84, minWidth: 84},
                {key: 'name', label: 'Name', width: 200},
            ],
            undefined,
            false,
        );
        expect(layout.template).toBe('minmax(84px, 84fr) minmax(56px, 200fr)');
        expect(sizedTemplate(layout).minWidth).toBe(84 + 56);
        expect(sizedTemplate(layout, {marks: 50})).toEqual({template: '50px minmax(56px, 200fr)', minWidth: 50 + 56});
    });

    /**
     * B-35 (#157): the PARAMSETS buttons. A width the user dragged or that is stored does not win below
     * the minimum: a squeezed button lands under the next cell (task 25).
     */
    it('draws a user width below the minimum of a column that keeps it at that minimum, and a wider one as it is', () => {
        const paramsets: DataTableColumn<Row> = {
            key: 'PARAMSETS',
            label: 'PARAMSETS',
            width: 150,
            minWidth: 150,
            keepMinWidth: true,
        };
        const layout = tableLayout([paramsets, {key: 'name', label: 'Name', width: 200}], [paramsets], false);
        expect(layout.template).toBe('minmax(150px, 150fr) minmax(56px, 200fr)');
        expect(sizedTemplate(layout, {PARAMSETS: 90})).toEqual({
            template: '150px minmax(56px, 200fr)',
            minWidth: 150 + 56,
        });
        expect(sizedTemplate(layout, {PARAMSETS: 210}).template).toBe('210px minmax(56px, 200fr)');
        // without a minimum there is nothing to keep
        const plain = tableLayout([{key: 'links', label: 'Links', width: 60, keepMinWidth: true}], undefined, false);
        expect(sizedTemplate(plain, {links: 40}).template).toBe('40px');
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

    it('filters a channel through the sub-columns, not through the device columns', () => {
        // `version` is a device column only; the channel matches through the sub-columns' ADDRESS.
        const flat = buildRows({
            rows,
            columns,
            getId,
            children: subRows,
            expanded: new Set(),
            subColumns,
            columnFilters: {address: 'MEQ0000002:1'},
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

describe('groupSpans', () => {
    // the Funk grid: fixed device columns, then per interface a rx / tx / set triple
    const columns: DataTableColumn<Record<string, unknown>>[] = [
        {key: 'name', label: 'Name', width: 100},
        {key: 'rx:A', label: '← dBm', width: 60},
        {key: 'tx:A', label: '→ dBm', width: 60},
        {key: 'set:A', label: '', width: 30, fixed: true},
        {key: 'rx:B', label: '← dBm', width: 60},
        {key: 'tx:B', label: '→ dBm', width: 60},
        {key: 'set:B', label: '', width: 30, fixed: true, hidden: true},
    ];
    const groups = [
        {key: 'A', label: 'PEQ1098001', sublabel: '(CCU2-Coprocessor)', columns: ['rx:A', 'tx:A', 'set:A']},
        {key: 'B', label: 'OEQ0328853', columns: ['rx:B', 'tx:B', 'set:B']},
        {key: 'C', label: 'gone', columns: ['rx:C', 'tx:C']},
    ];

    it('spans each group from its first visible column to its last, on the layout tracks', () => {
        const layout = tableLayout(columns, undefined, true);
        expect(groupSpans(groups, columns, layout)).toEqual([
            // the expander is track 1, Name track 2, so A starts at 3 and ends before 6
            {key: 'A', label: 'PEQ1098001', sublabel: '(CCU2-Coprocessor)', start: 3, end: 6},
            // set:B is hidden: the span stops at tx:B
            {key: 'B', label: 'OEQ0328853', sublabel: undefined, start: 6, end: 8},
        ]);
    });

    it('drops a group with no visible column and copes with no groups at all', () => {
        const layout = tableLayout(columns, undefined, false);
        expect(groupSpans(groups, columns, layout).map((span) => span.key)).toEqual(['A', 'B']);
        expect(groupSpans([], columns, layout)).toEqual([]);
    });
});

describe('hasActiveFilter', () => {
    it('sees the outside needle and any non-blank column field', () => {
        expect(hasActiveFilter('', {})).toBe(false);
        expect(hasActiveFilter('', {name: '', address: '  '})).toBe(false);
        expect(hasActiveFilter('x', {})).toBe(true);
        expect(hasActiveFilter('', {address: 'LEQ'})).toBe(true);
    });
});
