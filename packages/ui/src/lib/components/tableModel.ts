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
    readonly align?: 'left' | 'center' | 'right';
    /** Sortable by default. */
    readonly sortable?: boolean;
    /** Part of the filter by default. */
    readonly filterable?: boolean;
    /** Not drawn - the 2.x grid hid SUBTYPE for BidCos and the name columns on request. */
    readonly hidden?: boolean;
    /** Draw in the address font. */
    readonly mono?: boolean;
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

/** One column track of the grid: the merged width of everything that is drawn in that column. */
interface Track {
    readonly key: string;
    readonly width: number | undefined;
    readonly fixed: boolean;
}

/** Where each column of a depth sits, and the template every row of the table uses. */
export interface TableLayout {
    /** The `grid-template-columns` of the head, the filter row and **every** row, at any depth. */
    readonly template: string;
    /** 1-based grid track of a column, by key. Shared keys share a track. */
    readonly track: Readonly<Record<string, number>>;
}

/**
 * `minmax(<min>px, <width>fr)` unless the column asked to stay fixed.
 *
 * The declared width is a weight, the way `she`'s tables give their `<col>`s a percentage under
 * `table-layout: fixed`: the grid then fills its container exactly, whatever the window is, so
 * there is no ragged strip on the right at one size and no horizontal scrollbar at another. The
 * minimum keeps a text column readable; below it the grid scrolls, which is what it did before.
 */
function trackSize(track: Track): string {
    if (track.width === undefined) {
        return `minmax(${MIN_TRACK_PX}px, ${DEFAULT_WEIGHT}fr)`;
    }
    if (track.fixed) {
        return `${track.width}px`;
    }
    return `minmax(${Math.min(track.width, MIN_TRACK_PX)}px, ${track.width}fr)`;
}

function trackOf<T>(column: DataTableColumn<T>): Track {
    return {key: column.key, width: column.width, fixed: column.fixed === true};
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
    const tracks: Track[] = columns.filter((column) => column.hidden !== true).map((column) => trackOf(column));
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
        next += 1;
    }
    const offset = expander ? 2 : 1;
    const track: Record<string, number> = {};
    for (const [index, entry] of tracks.entries()) {
        track[entry.key] = index + offset;
    }
    const parts = tracks.map((entry) => trackSize(entry));
    return {template: expander ? `22px ${parts.join(' ')}` : parts.join(' '), track};
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
