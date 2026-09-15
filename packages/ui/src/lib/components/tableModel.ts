/**
 * The pure part of the data table: what a column is, how a cell value is read, and how rows are
 * filtered, sorted and flattened into what the virtualiser draws. It has no DOM in it, so all of
 * this is tested directly rather than through a rendered grid.
 */

export type CellValue = string | number | boolean | undefined;

export interface DataTableColumn<T> {
    /** Identifies the column; also the property read from the row when `value` is absent. */
    readonly key: string;
    readonly label: string;
    /**
     * The column's share of the width, in pixels at the size the grid was designed for. It is a
     * *weight*, not a pixel width (see {@link tableLayout}); a column without one shares whatever
     * is left. Use {@link fixed} for the ones that must keep their pixels.
     */
    readonly width?: number;
    /**
     * Never proportional: an icon, a badge or a count that has no more to say when it is wider.
     * Requires {@link width}.
     */
    readonly fixed?: boolean;
    /**
     * The narrowest a proportional column is drawn, in pixels, when its content needs more than the
     * grid's minimum track - three marks and a button (B-34). Below it the grid scrolls sideways.
     * A width the user dragged still wins.
     */
    readonly minWidth?: number;
    /**
     * B-35: the user cannot make the column narrower than {@link minWidth} either - a drag, the
     * arrow keys, a fit and a stored width all stop there. For a cell of buttons: one squeezed below
     * its size lands under the next cell, where a click never arrives (task 25), and a tooltip of it
     * cannot be clicked. A column of text or marks leaves it out and is cut off, with its tooltip.
     * Requires {@link minWidth}.
     */
    readonly keepMinWidth?: boolean;
    readonly align?: 'left' | 'center' | 'right';
    /** Sortable by default. */
    readonly sortable?: boolean;
    /** Part of the filter by default. */
    readonly filterable?: boolean;
    /** Not drawn - the 2.x grid hid SUBTYPE for BidCos and the name columns on request. */
    readonly hidden?: boolean;
    /** Draw in the address font. */
    readonly mono?: boolean;
    /**
     * Task 47: a small copy button at the end of every cell of the column, which puts the column's
     * full value on the clipboard - never the cut-off text the cell draws. What it copies names its
     * label: "Copy name" or "Copy address". Only on a real row with a value.
     */
    readonly copy?: 'name' | 'address';
    /** Reads the value; defaults to `row[key]`. */
    readonly value?: (row: T) => CellValue;
}

export type SortDirection = 'asc' | 'desc';

export interface SortState {
    readonly key: string;
    readonly direction: SortDirection;
}

/**
 * One line of the rendered grid: a top-level row, one of its sub-rows, or the label row of a
 * sub-grid.
 *
 * 2.x drew the channels of a device in a jqGrid *subgrid* - its own table with its own headers
 * inside the expanded device row. Reproducing that as a nested grid would cost the virtualiser, so
 * the label row is a line of the same flat list, marked `kind: 'header'`, and the renderer draws
 * the sub-column labels instead of cell values for it.
 */
export interface FlatRow<T> {
    readonly id: string;
    readonly row: T;
    /** 0 for a device, 1 for one of its channels. */
    readonly depth: number;
    readonly hasChildren: boolean;
    readonly expanded: boolean;
    /** The id of the top-level row this belongs to. */
    readonly rootId: string;
    /** `header` is the sub-grid's label row; everything else is a real row. */
    readonly kind: 'row' | 'header';
    /**
     * Unique per rendered line, which `id` is not: the RSSI sub-grid lists a device's peers, and a
     * peer can be a device that has its own top-level row. Selection still works on `id`; this is
     * only what the keyed `{#each}` uses.
     */
    readonly key: string;
}

export function cellValue<T>(row: T, column: DataTableColumn<T>): CellValue {
    if (column.value) {
        return column.value(row);
    }
    const value = (row as Record<string, unknown>)[column.key];
    if (value === undefined || value === null) {
        return undefined;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }
    // "[object Object]" for an array or a struct, which is what 2.x put in the cell and what
    // `tableModel.test.ts` pins down. Every real column has a `value` function, so this is the
    // fallback for a column that was configured by key alone.
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- deliberate, see above
    return String(value);
}

export function cellText<T>(row: T, column: DataTableColumn<T>): string {
    const value = cellValue(row, column);
    return value === undefined ? '' : String(value);
}

export function isSortable<T>(column: DataTableColumn<T>): boolean {
    return column.sortable !== false && column.hidden !== true;
}

export function isFilterable<T>(column: DataTableColumn<T>): boolean {
    return column.filterable !== false && column.hidden !== true;
}

/** Case-insensitive "contains", which is the `cn` default search of the 2.x filter toolbar. */
export function matchesText(haystack: string, needle: string): boolean {
    return haystack.toLowerCase().includes(needle.toLowerCase());
}

/** Does a row match the global filter box and every per-column filter? */
export function matchesFilters<T>(
    row: T,
    columns: readonly DataTableColumn<T>[],
    globalFilter: string,
    columnFilters: Readonly<Record<string, string>>,
): boolean {
    for (const column of columns) {
        const needle = columnFilters[column.key];
        if (needle !== undefined && needle !== '' && !matchesText(cellText(row, column), needle)) {
            return false;
        }
    }
    if (globalFilter.trim() === '') {
        return true;
    }
    return columns
        .filter((column) => isFilterable(column))
        .some((column) => matchesText(cellText(row, column), globalFilter));
}

/**
 * Compares two cell values. Numbers compare numerically, everything else compares as text with
 * `localeCompare`, and an empty cell always sorts last - the 2.x grid put the nameless devices at
 * the end, not at the top.
 */
export function compareCells(a: CellValue, b: CellValue): number {
    const aEmpty = a === undefined || a === '';
    const bEmpty = b === undefined || b === '';
    if (aEmpty || bEmpty) {
        return aEmpty && bEmpty ? 0 : aEmpty ? 1 : -1;
    }
    if (typeof a === 'number' && typeof b === 'number') {
        return a - b;
    }
    if (typeof a === 'boolean' && typeof b === 'boolean') {
        return Number(a) - Number(b);
    }
    return String(a).localeCompare(String(b), undefined, {numeric: true, sensitivity: 'base'});
}

export interface BuildRowsOptions<T> {
    readonly rows: readonly T[];
    readonly columns: readonly DataTableColumn<T>[];
    readonly getId: (row: T) => string;
    readonly children?: ((row: T) => readonly T[]) | undefined;
    readonly expanded: ReadonlySet<string>;
    readonly globalFilter?: string;
    readonly columnFilters?: Readonly<Record<string, string>>;
    readonly sort?: SortState | undefined;
    /**
     * The columns the sub-rows have of their own. Without them a channel is drawn with the device
     * columns (task 7's behaviour); with them the filter also reads a channel through its own
     * columns, so filtering for a channel TYPE finds the device whose channel matches.
     */
    readonly subColumns?: readonly DataTableColumn<T>[] | undefined;
    /** Put a label row above each expanded row's children, the way the 2.x subgrid had one. */
    readonly subHeader?: boolean;
}

/**
 * Filters, sorts and flattens. A parent survives the filter when it matches itself or when one of
 * its children does, so filtering for a channel type still shows the device it belongs to.
 */
export function buildRows<T>(options: BuildRowsOptions<T>): FlatRow<T>[] {
    const {rows, columns, getId, children, expanded} = options;
    const globalFilter = options.globalFilter ?? '';
    const columnFilters = options.columnFilters ?? {};
    const childColumns = options.subColumns ?? columns;
    const hasFilter = globalFilter.trim() !== '' || Object.values(columnFilters).some((value) => value !== '');

    const kept = hasFilter
        ? rows.filter(
              (row) =>
                  matchesFilters(row, columns, globalFilter, columnFilters) ||
                  (children?.(row) ?? []).some((child) =>
                      matchesFilters(child, childColumns, globalFilter, columnFilters),
                  ),
          )
        : [...rows];

    const sort = options.sort;
    if (sort) {
        const column = columns.find((candidate) => candidate.key === sort.key);
        if (column && isSortable(column)) {
            const factor = sort.direction === 'asc' ? 1 : -1;
            kept.sort((a, b) => factor * compareCells(cellValue(a, column), cellValue(b, column)));
        }
    }

    const flat: FlatRow<T>[] = [];
    for (const row of kept) {
        const id = getId(row);
        const subRows = children?.(row) ?? [];
        const isExpanded = expanded.has(id);
        flat.push({
            id,
            key: id,
            row,
            depth: 0,
            hasChildren: subRows.length > 0,
            expanded: isExpanded,
            rootId: id,
            kind: 'row',
        });
        if (!isExpanded) {
            continue;
        }
        if (options.subHeader === true && subRows.length > 0) {
            flat.push({
                id: `${id}::header`,
                key: `${id}::header`,
                row,
                depth: 1,
                hasChildren: false,
                expanded: false,
                rootId: id,
                kind: 'header',
            });
        }
        for (const child of subRows) {
            flat.push({
                id: getId(child),
                key: `${id}/${getId(child)}`,
                row: child,
                depth: 1,
                hasChildren: false,
                expanded: false,
                rootId: id,
                kind: 'row',
            });
        }
    }
    return flat;
}

export interface Window {
    readonly start: number;
    readonly end: number;
}

/**
 * The slice of rows to draw for a scroll position. `overscan` rows above and below keep the fast
 * scroll from showing gaps.
 */
export function visibleWindow(
    total: number,
    scrollTop: number,
    viewportHeight: number,
    rowHeight: number,
    overscan = 6,
): Window {
    if (total === 0 || rowHeight <= 0) {
        return {start: 0, end: 0};
    }
    const visible = Math.max(1, Math.ceil((viewportHeight <= 0 ? rowHeight : viewportHeight) / rowHeight));
    // Clamped to the last row: a viewport that is still scrolled far down after the rows shrank
    // (a filter was typed, an interface was switched) must not render an empty window.
    const first = Math.max(0, Math.min(total - 1, Math.floor(scrollTop / rowHeight) - overscan));
    const last = Math.min(total, first + visible + overscan * 2);
    return {start: first, end: last};
}

/** The narrowest a proportional column may become before the grid starts to scroll sideways. */
const MIN_TRACK_PX = 56;

/** The weight of a column that declares no width: as much as an ordinary text column. */
const DEFAULT_WEIGHT = 120;

/** The track of the expand button in front of every row of a table with sub-rows. */
const EXPANDER_PX = 22;

/** One column track of the grid: the merged width of everything that is drawn in that column. */
export interface TableTrack {
    readonly key: string;
    readonly width: number | undefined;
    readonly fixed: boolean;
    /** B-34: the column's own minimum, where its content needs more than {@link MIN_TRACK_PX}. */
    readonly minWidth?: number | undefined;
    /** B-35: a user width below {@link minWidth} is drawn at {@link minWidth}. */
    readonly keepMinWidth?: boolean | undefined;
}

/** Where each column of a depth sits, and the template every row of the table uses. */
export interface TableLayout {
    /**
     * The `grid-template-columns` of the head, the filter row and **every** row, at any depth - as
     * designed, before a user dragged any column ({@link sizedTemplate} adds those widths).
     */
    readonly template: string;
    /** 1-based grid track of a column, by key. Shared keys share a track. */
    readonly track: Readonly<Record<string, number>>;
    /** The tracks in order, without the expander. */
    readonly tracks: readonly TableTrack[];
    readonly expander: boolean;
    /**
     * The keys of the tracks only the sub-grid has - the channel's DIRECTION, a peer's dBm pair
     * (task 42). Their widths belong to the sub-grid and are kept apart from the table's own; a
     * key both depths share is the parent's column, sized from the head.
     */
    readonly subKeys: readonly string[];
}

/**
 * `minmax(<min>px, <width>fr)` unless the column asked to stay fixed, or the user gave it pixels.
 *
 * The declared width is a weight, the way `she`'s tables give their `<col>`s a percentage under
 * `table-layout: fixed`: the grid then fills its container exactly, whatever the window is, so
 * there is no ragged strip on the right at one size and no horizontal scrollbar at another. The
 * minimum keeps a text column readable; below it the grid scrolls, which is what it did before.
 *
 * Task 40: a width the user dragged or fitted is pixels, and the columns nobody touched share what
 * is left by their weights - so widening one column takes the room from the others, not from the
 * window, until they are at their minimum and the grid scrolls sideways.
 */
function trackSize(track: TableTrack, userWidth: number | undefined): string {
    if (track.width === undefined && userWidth === undefined) {
        return `minmax(${MIN_TRACK_PX}px, ${DEFAULT_WEIGHT}fr)`;
    }
    if (track.fixed && track.width !== undefined) {
        return `${track.width}px`;
    }
    if (userWidth !== undefined) {
        return `${userWidth}px`;
    }
    const width = track.width ?? DEFAULT_WEIGHT;
    return `minmax(${proportionalMinimum(track)}px, ${width}fr)`;
}

/**
 * The narrowest a proportional track is drawn: the grid's minimum, or less for a column designed
 * narrower than that - unless the column names its own (B-34: the Msgs column's two marks and
 * button, which a shared minimum of 56 px cut off in a narrow window).
 */
function proportionalMinimum(track: TableTrack): number {
    if (track.minWidth !== undefined) {
        return track.minWidth;
    }
    return Math.min(track.width ?? MIN_TRACK_PX, MIN_TRACK_PX);
}

/** The narrowest a track can be drawn: what the grid needs before it scrolls sideways. */
function trackMinimum(track: TableTrack, userWidth: number | undefined): number {
    if (track.fixed && track.width !== undefined) {
        return track.width;
    }
    if (userWidth !== undefined) {
        return userWidth;
    }
    return proportionalMinimum(track);
}

function trackOf<T>(column: DataTableColumn<T>): TableTrack {
    return {
        key: column.key,
        width: column.width,
        fixed: column.fixed === true,
        ...(column.minWidth === undefined ? {} : {minWidth: column.minWidth}),
        ...(column.keepMinWidth === true && column.minWidth !== undefined ? {keepMinWidth: true} : {}),
    };
}

/**
 * B-35: the user's width as it is drawn. A column of buttons stops at its own minimum whatever is
 * stored - a hand-edited `localStorage`, or a width from before the column had a minimum - so the
 * drag in `DataTable` is not the only lock on that door.
 */
function drawnUserWidth(track: TableTrack, userWidth: number | undefined): number | undefined {
    if (userWidth === undefined || track.keepMinWidth !== true || track.minWidth === undefined) {
        return userWidth;
    }
    return Math.max(userWidth, track.minWidth);
}

/** The template with the user's widths in it, and the width below which the grid scrolls sideways. */
export interface SizedTemplate {
    readonly template: string;
    readonly minWidth: number;
}

/**
 * The layout's template with the widths a user gave some of its columns (task 40).
 *
 * Fixed columns ignore a width - they keep their pixels. `minWidth` is what every row, the head and
 * the filter row are drawn at least as wide as: when the pixels add up to more than the window, the
 * body scrolls sideways, and a row whose box stopped at the window's edge would leave its hover and
 * selection background behind while its cells scroll on.
 */
export function sizedTemplate(
    layout: Pick<TableLayout, 'tracks' | 'expander'>,
    widths: Readonly<Record<string, number>> = {},
): SizedTemplate {
    const parts: string[] = layout.expander ? [`${EXPANDER_PX}px`] : [];
    let minWidth = layout.expander ? EXPANDER_PX : 0;
    for (const track of layout.tracks) {
        const userWidth = track.fixed ? undefined : drawnUserWidth(track, widths[track.key]);
        parts.push(trackSize(track, userWidth));
        minWidth += trackMinimum(track, userWidth);
    }
    return {template: parts.join(' '), minWidth};
}

/**
 * The one grid the whole table is drawn on - the device rows, the channel sub-grid and the head.
 *
 * The sub-grid used to get a template of its own (task 8), so a channel's Name started where the
 * device's icon did and no column of the sub-grid stood under the column it belongs to. D-34 after
 * the first look: "table columns are not regularly sized when the channel sub-grid is expanded".
 *
 * Columns are therefore merged **by key** into one track list: a key both depths know shares one
 * track and keeps the parent's width, so expanding a device can never move a device column; a key
 * only the sub-grid has gets a track of its own, inserted after the track its predecessor sits in,
 * so the sub-grid keeps its reading order. A depth that has nothing for a track leaves it empty -
 * which is why every cell is placed explicitly rather than by auto-flow.
 */
export function tableLayout<T>(
    columns: readonly DataTableColumn<T>[],
    subColumns: readonly DataTableColumn<T>[] | undefined,
    expander: boolean,
): TableLayout {
    const tracks: TableTrack[] = columns.filter((column) => column.hidden !== true).map((column) => trackOf(column));
    const subKeys: string[] = [];
    let next = 0;
    for (const column of subColumns ?? []) {
        if (column.hidden === true) {
            continue;
        }
        const found = tracks.findIndex((track) => track.key === column.key);
        if (found >= 0) {
            next = found + 1;
            continue;
        }
        tracks.splice(next, 0, trackOf(column));
        subKeys.push(column.key);
        next += 1;
    }
    const offset = expander ? 2 : 1;
    const track: Record<string, number> = {};
    for (const [index, entry] of tracks.entries()) {
        track[entry.key] = index + offset;
    }
    return {template: sizedTemplate({tracks, expander}).template, track, tracks, expander, subKeys};
}

/**
 * The widths the one template is drawn with (task 42): the table's own for the columns of its
 * rows, the sub-grid's for the columns only the sub-grid has. Each side is kept under its own table
 * id, so an entry for a column the other side owns - a stale or hand-edited one - is left out
 * rather than sizing that column from the wrong place.
 */
export function layoutWidths(
    layout: Pick<TableLayout, 'subKeys'>,
    parentWidths: Readonly<Record<string, number>>,
    subWidths: Readonly<Record<string, number>>,
): Record<string, number> {
    const subKeys = new Set(layout.subKeys);
    const widths: Record<string, number> = {};
    for (const [key, width] of Object.entries(parentWidths)) {
        if (!subKeys.has(key)) {
            widths[key] = width;
        }
    }
    for (const [key, width] of Object.entries(subWidths)) {
        if (subKeys.has(key)) {
            widths[key] = width;
        }
    }
    return widths;
}

/**
 * A header cell over several columns, drawn in a row of its own above the column labels - what
 * jqGrid's `setGroupHeaders` did for the 2.x Funk grid, where every BidCos interface got its serial
 * (and its description in small print) over its `<- dBm` / `-> dBm` / set columns.
 */
export interface DataTableColumnGroup {
    readonly key: string;
    readonly label: string;
    /** A second, smaller line under the label. */
    readonly sublabel?: string | undefined;
    /** The keys of the columns it spans. Hidden columns do not count; a group with none left is not drawn. */
    readonly columns: readonly string[];
}

/** Where a group header sits on the grid: 1-based track of its first column, exclusive end. */
export interface GroupSpan {
    readonly key: string;
    readonly label: string;
    readonly sublabel?: string | undefined;
    readonly start: number;
    readonly end: number;
}

/**
 * The spans of the group headers, on the same tracks the layout gives the columns. A group spans
 * from its leftmost visible column to its rightmost one; a group whose columns are all hidden or
 * unknown is dropped.
 */
export function groupSpans<T>(
    groups: readonly DataTableColumnGroup[],
    columns: readonly DataTableColumn<T>[],
    layout: TableLayout,
): GroupSpan[] {
    const visible = new Set(columns.filter((column) => column.hidden !== true).map((column) => column.key));
    const spans: GroupSpan[] = [];
    for (const group of groups) {
        const tracks = group.columns
            .filter((key) => visible.has(key))
            .map((key) => layout.track[key])
            .filter((track): track is number => track !== undefined);
        if (tracks.length === 0) {
            continue;
        }
        spans.push({
            key: group.key,
            label: group.label,
            sublabel: group.sublabel,
            start: Math.min(...tracks),
            end: Math.max(...tracks) + 1,
        });
    }
    return spans;
}

/** Is any filter - the outside needle or a column field - narrowing the rows? */
export function hasActiveFilter(globalFilter: string, columnFilters: Readonly<Record<string, string>>): boolean {
    return globalFilter.trim() !== '' || Object.values(columnFilters).some((value) => value.trim() !== '');
}

/** The `grid-template-columns` for a set of columns, plus the leading expander when there is one. */
export function gridTemplate<T>(columns: readonly DataTableColumn<T>[], expander: boolean): string {
    return tableLayout(columns, undefined, expander).template;
}

/**
 * The ids a shift-click selects: everything between the anchor and the clicked row, in the order
 * the grid currently shows them.
 */
export function rangeIds<T>(rows: readonly FlatRow<T>[], anchorId: string, targetId: string): string[] {
    const anchor = rows.findIndex((row) => row.id === anchorId);
    const target = rows.findIndex((row) => row.id === targetId);
    if (anchor === -1 || target === -1) {
        return target === -1 ? [] : [targetId];
    }
    const [from, to] = anchor <= target ? [anchor, target] : [target, anchor];
    return rows
        .slice(from, to + 1)
        .filter((row) => row.kind !== 'header')
        .map((row) => row.id);
}

/** Click, ctrl/meta-click and shift-click, as every grid in 2.7 behaved. */
export function nextSelection<T>(
    rows: readonly FlatRow<T>[],
    selected: readonly string[],
    anchorId: string | undefined,
    targetId: string,
    modifiers: {readonly ctrl?: boolean; readonly shift?: boolean},
): {selected: string[]; anchorId: string} {
    if (modifiers.shift === true && anchorId !== undefined) {
        return {selected: rangeIds(rows, anchorId, targetId), anchorId};
    }
    if (modifiers.ctrl === true) {
        const set = new Set(selected);
        if (set.has(targetId)) {
            set.delete(targetId);
        } else {
            set.add(targetId);
        }
        return {selected: [...set], anchorId: targetId};
    }
    return {selected: [targetId], anchorId: targetId};
}
