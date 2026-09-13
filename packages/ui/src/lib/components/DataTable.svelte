<script lang="ts" generics="T">
    import type {MessageParams} from '@homematic-manager/core';
    import {untrack, type Snippet} from 'svelte';

    import {fullText, isTruncated, measureNaturalWidths} from './columnMeasure.js';
    import {clampColumnWidth, fitColumnWidth, isResizable, RESIZE_KEY_STEP, type ColumnWidths} from './columnWidths.js';
    import ContextMenu from './ContextMenu.svelte';
    import type {ContextMenuItem} from './contextMenu.js';
    import {getDataTableEnvironment, untranslated} from './dataTableContext.js';
    import {ROW_HEIGHT} from './metrics.js';
    import {
        buildRows,
        cellText,
        groupSpans,
        hasActiveFilter,
        isFilterable,
        isSortable,
        layoutWidths,
        nextSelection,
        sizedTemplate,
        tableLayout,
        visibleWindow,
        type DataTableColumn,
        type DataTableColumnGroup,
        type FlatRow,
        type SortState,
    } from './tableModel.js';
    import {TOOLTIP_DELAY_MS, type TooltipAnchor} from './tooltip.js';
    import TooltipBubble from './TooltipBubble.svelte';

    interface Props {
        rows: T[];
        columns: DataTableColumn<T>[];
        /**
         * Header cells spanning several columns, in a row above the column labels (jqGrid's
         * `setGroupHeaders`): the Funk grid puts every BidCos interface over its own columns.
         */
        columnGroups?: DataTableColumnGroup[] | undefined;
        /**
         * What the rows belong to - the interface, in every grid of this app. When it changes the
         * column filters are cleared and the body scrolls to the top: a filter typed for one
         * interface's addresses hid every device of the next one while the count still said how
         * many there were (BUGS.md B-1).
         */
        scope?: string | undefined;
        /** Stable identity of a row - the address, in every grid of this app. */
        getId: (row: T) => string;
        /** Sub-rows of a row; a device's channels. Absent means no expander column. */
        subRows?: ((row: T) => readonly T[]) | undefined;
        /**
         * The columns of the sub-rows, when they differ from the parent's - the channel sub-grid of
         * 2.x had its own (INDEX, TYPE, DIRECTION, roles, ...). Given, the sub-rows are drawn with
         * these columns under their own label row; absent, a channel shares the device columns.
         */
        subColumns?: DataTableColumn<T>[] | undefined;
        /** Row height in pixels; the virtualiser needs it to be uniform. `--hmm-row-height`. */
        rowHeight?: number;
        /** Fixed body height. Without one the body fills its parent and is measured. */
        height?: number | undefined;
        overscan?: number;
        /** Show the per-column filter row under the column labels, as the 2.x filter toolbar did. */
        columnFilterRow?: boolean;
        caption?: string | undefined;
        /** What the body says when there are no rows at all. */
        emptyText?: string;
        /** What the body says when there are rows but the filters hide every one of them. */
        noMatchText?: string;
        /** The button under that text; it empties the column filters. */
        clearFilterLabel?: string;
        /** Replaces `countText` while a filter is active: "Showing 0 of 31". */
        showingText?: ((shown: number, total: number) => string) | undefined;
        filterLabel?: string;
        /**
         * The tab's actions - buttons, selection controls - drawn at the left of the header band.
         * Task 20: a tab has no toolbar strip of its own above the grid any more.
         */
        toolbar?: Snippet | undefined;
        /** Accessible name of that group of actions; the caption when none is given. */
        toolbarLabel?: string | undefined;
        /** Right of the band, before the count: what a tab has to say about its own state. */
        status?: Snippet | undefined;
        /** Right of the band: "4 Geräte". */
        countText?: string | undefined;
        selected?: string[];
        expanded?: string[];
        /**
         * The needle every filterable column is searched for, on top of the per-column fields.
         *
         * No control draws it any more (task 20: the maintainer's second look removed the tab-wide
         * "filter everything" box). It stays because one workflow sets it from outside: #25 opens
         * the Links tab already narrowed to a channel, and there is no per-column field that means
         * "sender **or** receiver".
         */
        filter?: string;
        sort?: SortState | undefined;
        /** Double click, or Enter on the focused row. */
        onactivate?: ((row: T) => void) | undefined;
        /** Right click on a row; the table has already called `preventDefault()`. */
        onrowcontextmenu?: ((row: T, event: MouseEvent) => void) | undefined;
        /** Draws one cell; without it the cell is the column's text value. */
        cell?: Snippet<[T, DataTableColumn<T>, FlatRow<T>]> | undefined;
        /**
         * Task 40 (#157): the name the column widths of this table are kept under, per profile.
         * A storage key rather than a test id, so it stays the same when a test id is renamed.
         * Without one - or outside the app - the widths last as long as the table does.
         */
        tableId?: string | undefined;
        /**
         * Task 42: the name the widths of the columns only the sub-grid has are kept under -
         * `devices-channels`, `radio-peers`. Every expanded sub-grid of the table is drawn on the
         * one template, so one width applies to all of them. Without one they last as long as the
         * table does.
         */
        subTableId?: string | undefined;
        testId?: string | undefined;
    }

    let {
        rows,
        columns,
        columnGroups = undefined,
        scope = undefined,
        getId,
        subRows = undefined,
        subColumns = undefined,
        rowHeight = ROW_HEIGHT,
        height = undefined,
        overscan = 6,
        columnFilterRow = true,
        caption = undefined,
        emptyText = '',
        noMatchText = 'No row matches the filter',
        clearFilterLabel = 'Clear filter',
        showingText = undefined,
        filterLabel = 'Filter',
        toolbar = undefined,
        toolbarLabel = undefined,
        status = undefined,
        countText = undefined,
        selected = $bindable([]),
        expanded = $bindable([]),
        filter = $bindable(''),
        sort = $bindable(undefined),
        onactivate = undefined,
        onrowcontextmenu = undefined,
        cell = undefined,
        tableId = undefined,
        subTableId = undefined,
        testId = undefined,
    }: Props = $props();

    /** The app's column-width store and translation (task 40); absent in a bare component test. */
    const environment = getDataTableEnvironment();

    function t(key: string, params: MessageParams = {}): string {
        return environment?.t === undefined ? untranslated(key, params) : environment.t(key, params);
    }

    let columnFilters = $state<Record<string, string>>({});
    let scrollTop = $state(0);
    let measuredHeight = $state(0);
    let focusIndex = $state(0);
    /**
     * Width of the body's vertical scrollbar. The head and the filter row are siblings of the
     * scrolling body, so without this the proportional columns of the head would be a scrollbar
     * wider than the columns of the rows as soon as a device is expanded and the body scrolls.
     */
    let gutter = $state(0);
    let anchorId = $state<string | undefined>(undefined);
    let viewport = $state<HTMLDivElement | undefined>(undefined);
    let root = $state<HTMLDivElement | undefined>(undefined);
    let groupStrip = $state<HTMLDivElement | undefined>(undefined);
    let headStrip = $state<HTMLDivElement | undefined>(undefined);
    let filterStrip = $state<HTMLDivElement | undefined>(undefined);

    const visibleColumns = $derived(columns.filter((column) => column.hidden !== true));
    const visibleSubColumns = $derived((subColumns ?? columns).filter((column) => column.hidden !== true));
    const hasExpander = $derived(subRows !== undefined);
    /**
     * One template for the whole table (D-34). The head, the filter row, the device rows and the
     * channel sub-grid all sit on the same tracks, so a column never moves when a device is
     * expanded and the sub-grid stands under the columns it belongs to.
     *
     * The layout - which column sits on which track - does not depend on the widths, so a drag
     * never re-runs anything in a cell; only the template below changes.
     */
    const layout = $derived(tableLayout(columns, subColumns, hasExpander));

    /** The widths the user gave this table and kept (task 40). */
    let localWidths = $state.raw<ColumnWidths>({});
    /** Task 42: the same for the columns only the sub-grid has, when there is no store for them. */
    let localSubWidths = $state.raw<ColumnWidths>({});
    /** The width of the column under the pointer while it is dragged; stored when it is let go. */
    let draft = $state.raw<{key: string; width: number} | undefined>(undefined);
    const storedWidths = $derived.by((): ColumnWidths => {
        const store = environment?.columnWidths;
        return tableId === undefined || store === undefined ? localWidths : store.widths(tableId);
    });
    const storedSubWidths = $derived.by((): ColumnWidths => {
        const store = environment?.columnWidths;
        return subTableId === undefined || store === undefined ? localSubWidths : store.widths(subTableId);
    });
    const hasUserWidths = $derived(Object.keys(storedWidths).length > 0);
    const hasSubWidths = $derived(Object.keys(storedSubWidths).length > 0);
    /**
     * Task 42: the tracks only the sub-grid has. Their handles are in the sub-grid's label rows and
     * their widths are kept under `subTableId`; every other column is sized from the head.
     */
    const subKeys = $derived(new Set(layout.subKeys));
    /**
     * #157: those columns leave a gap in the head (the Funk tab's ← dBm / → dBm between ADDRESS and
     * TYPE). The head gets their handle as well, over the gap, so they can be sized while no row is
     * expanded; the width is the sub-grid's, whichever of the two handles set it.
     */
    const subOnlyColumns = $derived(
        visibleSubColumns.filter((column) => subKeys.has(column.key) && isResizable(column)),
    );
    /**
     * The template with the user's widths in it. It is set once, as a custom property on the grid,
     * and every row reads it from CSS: a pointer move during a drag changes one style attribute,
     * not one per rendered row - a sub-grid's label row included.
     */
    const sized = $derived.by(() => {
        const widths = layoutWidths(layout, storedWidths, storedSubWidths);
        return sizedTemplate(layout, draft === undefined ? widths : {...widths, [draft.key]: draft.width});
    });
    const spans = $derived(groupSpans(columnGroups ?? [], columns, layout));
    const expandedSet = $derived(new Set(expanded));
    /**
     * One header band per table (task 20, the maintainer's second look): the actions and the filter
     * box on the left, what the tab has to say and the row count on the right, the column labels in
     * the row underneath. It is part of the head, so it stays put while the body scrolls.
     */
    const hasBand = $derived(
        caption !== undefined || toolbar !== undefined || status !== undefined || countText !== undefined,
    );
    const selectedSet = $derived(new Set(selected));

    const flat = $derived(
        buildRows<T>({
            rows,
            columns,
            getId,
            children: subRows,
            expanded: expandedSet,
            globalFilter: filter,
            columnFilters,
            sort,
            subColumns,
            subHeader: subColumns !== undefined,
        }),
    );

    const bodyHeight = $derived(height ?? measuredHeight);
    const window_ = $derived(visibleWindow(flat.length, scrollTop, bodyHeight, rowHeight, overscan));
    const windowRows = $derived(flat.slice(window_.start, window_.end));

    const filterActive = $derived(hasActiveFilter(filter, columnFilters));
    /** Top-level rows left after the filters - what "Showing n of m" counts. */
    const shownCount = $derived(flat.filter((entry) => entry.depth === 0).length);
    /** Rows exist, the filters hide all of them: the count and the empty text must say so. */
    const hiddenByFilter = $derived(filterActive && rows.length > 0);

    function clearFilters(): void {
        columnFilters = {};
    }

    // The scope is the interface; a filter belongs to the rows it was typed for.
    let lastScope = untrack(() => scope);
    $effect(() => {
        if (scope === lastScope) {
            return;
        }
        lastScope = scope;
        clearFilters();
        // #143: the filter set from outside is the one #25 uses to open the Links tab on a
        // channel. It names an address of the interface it was set for, so it hides every row of
        // the next one - the same trap as the column filters of B-1, one prop further out.
        filter = '';
        if (viewport) {
            viewport.scrollTop = 0;
            scrollTop = 0;
        }
    });

    $effect(() => {
        const element = viewport;
        if (!element) {
            return;
        }
        const measure = (): void => {
            if (height === undefined) {
                measuredHeight = element.clientHeight;
            }
            gutter = element.offsetWidth - element.clientWidth;
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => {
            observer.disconnect();
        };
    });

    /**
     * The body is the only part that scrolls. When the widths add up to more than the window it
     * scrolls sideways too, and the group row, the labels and the filter fields have to follow it
     * or they would stand over the wrong columns - moved by a transform on those three elements
     * alone, and only while there is something to move.
     */
    function onBodyScroll(element: HTMLDivElement): void {
        scrollTop = element.scrollTop;
        const shift = element.scrollLeft === 0 ? '' : `translateX(${String(-element.scrollLeft)}px)`;
        for (const strip of [groupStrip, headStrip, filterStrip]) {
            if (strip && strip.style.transform !== shift) {
                strip.style.transform = shift;
            }
        }
        forgetTooltip();
    }

    function toggleSort(column: DataTableColumn<T>): void {
        if (!isSortable(column)) {
            return;
        }
        if (sort?.key !== column.key) {
            sort = {key: column.key, direction: 'asc'};
        } else if (sort.direction === 'asc') {
            sort = {key: column.key, direction: 'desc'};
        } else {
            sort = undefined;
        }
    }

    function toggleExpanded(id: string): void {
        expanded = expandedSet.has(id) ? expanded.filter((entry) => entry !== id) : [...expanded, id];
    }

    function selectRow(row: FlatRow<T>, modifiers: {ctrl?: boolean; shift?: boolean}): void {
        if (row.kind === 'header') {
            return;
        }
        const next = nextSelection(flat, selected, anchorId, row.id, modifiers);
        selected = next.selected;
        anchorId = next.anchorId;
        focusIndex = flat.findIndex((entry) => entry.id === row.id);
    }

    function onRowClick(row: FlatRow<T>, event: MouseEvent): void {
        selectRow(row, {ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey});
    }

    function onRowContextMenu(row: FlatRow<T>, event: MouseEvent): void {
        if (!onrowcontextmenu || row.kind === 'header') {
            return;
        }
        event.preventDefault();
        if (!selectedSet.has(row.id)) {
            selectRow(row, {});
        }
        onrowcontextmenu(row.row, event);
    }

    function scrollFocusIntoView(): void {
        const element = viewport;
        if (!element) {
            return;
        }
        const top = focusIndex * rowHeight;
        const view = bodyHeight === 0 ? element.clientHeight : bodyHeight;
        if (top < element.scrollTop) {
            element.scrollTop = top;
        } else if (top + rowHeight > element.scrollTop + view) {
            element.scrollTop = top + rowHeight - view;
        }
    }

    function moveFocus(delta: number, shift: boolean): void {
        if (flat.length === 0) {
            return;
        }
        const next = Math.min(flat.length - 1, Math.max(0, focusIndex + delta));
        const row = flat[next];
        if (!row) {
            return;
        }
        focusIndex = next;
        selectRow(row, {shift});
        scrollFocusIntoView();
    }

    function onKeyDown(event: KeyboardEvent): void {
        const row = flat[focusIndex];
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                moveFocus(1, event.shiftKey);
                break;
            case 'ArrowUp':
                event.preventDefault();
                moveFocus(-1, event.shiftKey);
                break;
            case 'Home':
                event.preventDefault();
                moveFocus(-flat.length, event.shiftKey);
                break;
            case 'End':
                event.preventDefault();
                moveFocus(flat.length, event.shiftKey);
                break;
            case 'ArrowRight':
                if (row?.hasChildren === true && !row.expanded) {
                    event.preventDefault();
                    toggleExpanded(row.id);
                }
                break;
            case 'ArrowLeft':
                if (row?.hasChildren === true && row.expanded) {
                    event.preventDefault();
                    toggleExpanded(row.id);
                }
                break;
            case 'Enter':
                if (row && onactivate) {
                    event.preventDefault();
                    onactivate(row.row);
                }
                break;
            case ' ':
                if (row) {
                    event.preventDefault();
                    selectRow(row, {ctrl: true});
                }
                break;
            case 'Escape':
                // Task 42: the tooltip of a cut-off cell goes; the key itself is left to whoever else wants it
                hideTooltip();
                break;
            default:
                break;
        }
    }

    // ------------------------------------------------------------------ column widths (task 40)

    /** A pointer that moved less than this between down and up clicked - half a double click. */
    const DRAG_THRESHOLD_PX = 2;
    /**
     * B-29: a finger wobbles more than a mouse. Under this, a touch on the handle is a tap, and a tap
     * sorts like one on the rest of the label: task 42 widened the handle to 24 px for a finger, so a
     * tap near the right edge of a label landed on the handle and did nothing a user could see.
     */
    const TAP_SLOP_PX = 4;
    /** Room for the ▲ of a sorted label, so fitting a column and then sorting it cuts nothing off. */
    const SORT_MARK_PX = 14;

    /**
     * Task 42: where a width is sized and kept - the table's columns from the head under `tableId`,
     * the columns only the sub-grid has from its label rows under `subTableId`.
     */
    type WidthScope = 'table' | 'sub';

    function scopeOf(key: string): WidthScope {
        return subKeys.has(key) ? 'sub' : 'table';
    }

    function saveWidth(key: string, width: number): void {
        const store = environment?.columnWidths;
        const scope = scopeOf(key);
        const id = scope === 'sub' ? subTableId : tableId;
        if (id !== undefined && store !== undefined) {
            store.set(id, key, width);
        } else if (scope === 'sub') {
            localSubWidths = {...localSubWidths, [key]: clampColumnWidth(width)};
        } else {
            localWidths = {...localWidths, [key]: clampColumnWidth(width)};
        }
    }

    /** Back to the designed widths: the table's columns, or the sub-grid's own alone. */
    function resetWidths(scope: WidthScope): void {
        const store = environment?.columnWidths;
        const id = scope === 'sub' ? subTableId : tableId;
        if (id !== undefined && store !== undefined) {
            store.reset(id);
        } else if (scope === 'sub') {
            localSubWidths = {};
        } else {
            localWidths = {};
        }
    }

    /**
     * A column that can be sized from where the user is: a column of the head from the head, a
     * column only the sub-grid has from the sub-grid's label row. A column both depths share is the
     * table's; its sub-grid label has no handle.
     */
    function resizableColumn(key: string | undefined, scope: WidthScope): DataTableColumn<T> | undefined {
        if (key === undefined || scopeOf(key) !== scope) {
            return undefined;
        }
        const column = (scope === 'sub' ? visibleSubColumns : visibleColumns).find(
            (candidate) => candidate.key === key,
        );
        return column !== undefined && isResizable(column) ? column : undefined;
    }

    /** The label of a column: its cell in the head, or in the first rendered label row of a sub-grid. */
    function labelCell(key: string): HTMLElement | undefined {
        const selector = `[data-column-key="${CSS.escape(key)}"]`;
        const cell =
            scopeOf(key) === 'sub'
                ? viewport?.querySelector<HTMLElement>(`.hmm-tr-subhead ${selector}`)
                : headStrip?.querySelector<HTMLElement>(selector);
        return cell ?? undefined;
    }

    /**
     * Double click on the handle: as wide as the label and the widest of the cells that are
     * rendered - the window of rows, never every row of a list of a thousand devices - up to
     * `FIT_MAX_WIDTH`.
     */
    function fitColumn(key: string): void {
        const scope = scopeOf(key);
        const column = resizableColumn(key, scope);
        const header = labelCell(key);
        if (!root || !column || !header) {
            return;
        }
        const cells = viewport
            ? [...viewport.querySelectorAll<HTMLElement>(`.hmm-td[data-column-key="${CSS.escape(key)}"]`)]
            : [];
        const [label = 0, ...values] = measureNaturalWidths(root, [header, ...cells]);
        // a label of the head can get the sort mark; a label row of a sub-grid is not sorted
        const labelWidth = scope === 'table' && isSortable(column) && sort?.key !== key ? label + SORT_MARK_PX : label;
        const width = fitColumnWidth([labelWidth, ...values]);
        if (width !== undefined) {
            saveWidth(key, width);
        }
    }

    interface Resize {
        readonly key: string;
        readonly pointerId: number;
        readonly startX: number;
        /** The column's width when the handle was pressed, as drawn - a proportional one included. */
        readonly startWidth: number;
        /** B-29: pressed by a finger or a pen, where only a drag resizes and a tap sorts. */
        readonly touch: boolean;
        moved: boolean;
    }

    /** Plain state: nothing is drawn from it but the one class below. */
    let resize: Resize | undefined;
    /** B-29: the last press on a handle was a finger's, so the double click that follows two taps fits nothing. */
    let pressedByTouch = false;
    let resizingKey = $state<string | undefined>(undefined);

    /** The cell a handle sits in: a label of the head, or of the sub-grid row whose handle was used. */
    function cellOfHandle(event: Event): HTMLElement | null {
        return (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-column-key]');
    }

    function onResizeStart(event: PointerEvent, key: string): void {
        const cell = cellOfHandle(event);
        if (event.button !== 0 || !cell) {
            return;
        }
        event.preventDefault();
        try {
            // the moves keep arriving here when the pointer leaves the 7 px of the handle
            (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        } catch {
            // a pointer that is already gone, or a DOM without capture: the drag works while over the handle
        }
        pressedByTouch = event.pointerType === 'touch' || event.pointerType === 'pen';
        resize = {
            key,
            pointerId: event.pointerId,
            startX: event.clientX,
            startWidth: cell.getBoundingClientRect().width,
            touch: pressedByTouch,
            moved: false,
        };
        hideTooltip();
    }

    /**
     * The column is as much wider as the pointer moved. The columns nobody sized share what is left,
     * those in front of it too, so the handle of a column further right trails the pointer a little;
     * a width that kept the edge under the pointer would have to grow by more than the pointer
     * moved - without bound for the last column, whose right edge is the window's.
     *
     * A move changes the draft and with it the one template on the grid; the browser lays the
     * rendered rows out once per frame, however many pointer events arrive in it.
     */
    function onResizeMove(event: PointerEvent): void {
        const current = resize;
        if (current?.pointerId !== event.pointerId) {
            return;
        }
        const dx = event.clientX - current.startX;
        if (!current.moved && Math.abs(dx) < (current.touch ? TAP_SLOP_PX : DRAG_THRESHOLD_PX)) {
            return;
        }
        if (!current.moved) {
            current.moved = true;
            resizingKey = current.key;
        }
        const width = clampColumnWidth(current.startWidth + dx);
        if (draft?.key !== current.key || draft.width !== width) {
            draft = {key: current.key, width};
        }
    }

    /** Stores what is drawn: the last move's width, not whatever position the release reports. */
    function onResizeEnd(event: PointerEvent): void {
        const current = resize;
        if (current?.pointerId !== event.pointerId) {
            return;
        }
        resize = undefined;
        resizingKey = undefined;
        if (current.moved && draft?.key === current.key) {
            saveWidth(current.key, draft.width);
        }
        draft = undefined;
    }

    /**
     * B-29: the finger let go. A drag was a resize and is stored like a mouse's; a tap that never
     * moved past {@link TAP_SLOP_PX} sorts the column, because the press was meant for its label.
     * The handle holds the pointer capture, so the click that follows lands on the handle and not on
     * the label's button - the sort has to happen here. A sub-grid's label row is not sorted.
     */
    function onResizeUp(event: PointerEvent, column: DataTableColumn<T>): void {
        const current = resize;
        onResizeEnd(event);
        if (
            current?.pointerId === event.pointerId &&
            current.touch &&
            !current.moved &&
            scopeOf(column.key) === 'table'
        ) {
            toggleSort(column);
        }
    }

    function onResizeKey(event: KeyboardEvent, key: string): void {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            const cell = cellOfHandle(event);
            if (cell) {
                const step = event.key === 'ArrowRight' ? RESIZE_KEY_STEP : -RESIZE_KEY_STEP;
                saveWidth(key, cell.getBoundingClientRect().width + step);
            }
        } else if (event.key === 'Enter') {
            fitColumn(key);
        } else if (event.key !== 'Tab') {
            return;
        }
        if (event.key !== 'Tab') {
            // the grid around the head moves the row selection on the same keys
            event.preventDefault();
            event.stopPropagation();
        }
    }

    let headMenuOpen = $state(false);
    let headMenuX = $state(0);
    let headMenuY = $state(0);
    let headMenuKey = $state<string | undefined>(undefined);
    /** Task 42: the menu of a sub-grid's label row fits and resets the sub-grid's own columns. */
    let headMenuScope = $state<WidthScope>('table');
    const headMenuItems = $derived.by((): ContextMenuItem[] => [
        {
            id: 'fit',
            label: t('Fit column to content'),
            disabled: resizableColumn(headMenuKey, headMenuScope) === undefined,
        },
        {
            id: 'reset',
            label: t('Reset column widths'),
            disabled: headMenuScope === 'sub' ? !hasSubWidths : !hasUserWidths,
        },
    ]);

    /**
     * Right click on the column labels: fit the column under the pointer, or reset them all. One
     * listener on the grid; a right click on a row is the row's own menu and is left alone. The
     * label row of an expanded sub-grid is not a row anybody selects, and has the same menu for
     * the sub-grid's columns (task 42).
     */
    function onGridContextMenu(event: MouseEvent): void {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) {
            return;
        }
        const inHead = headStrip?.contains(target) === true || groupStrip?.contains(target) === true;
        if (!inHead && target.closest('.hmm-tr-subhead') === null) {
            return;
        }
        event.preventDefault();
        const cell = target.closest<HTMLElement>('[data-column-key]');
        headMenuKey = cell?.dataset['columnKey'];
        // #157: the head's cell over a sub-grid-only column is the sub-grid's
        headMenuScope = inHead && (headMenuKey === undefined || !subKeys.has(headMenuKey)) ? 'table' : 'sub';
        headMenuX = event.clientX;
        headMenuY = event.clientY;
        headMenuOpen = true;
        hideTooltip();
    }

    function onHeadMenuSelect(id: string): void {
        if (id === 'fit' && headMenuKey !== undefined) {
            fitColumn(headMenuKey);
        } else if (id === 'reset') {
            resetWidths(headMenuScope);
        }
    }

    // ------------------------------------------------------- the full text of a cut-off cell (#157)

    let tooltip = $state.raw<{text: string; anchor: TooltipAnchor} | undefined>(undefined);
    /** The cell under the pointer; plain, because only the handlers read it. */
    let hovered: HTMLElement | undefined;
    /**
     * Task 42: the cell the tooltip that is shown - or on its way - belongs to, and what brought it
     * there. The pointer and the keyboard share the one bubble, so a cell they meet on shows it once.
     */
    let tipCell: HTMLElement | undefined;
    let tipSource: 'pointer' | 'focus' | undefined;
    let tooltipTimer: ReturnType<typeof setTimeout> | undefined;

    /**
     * Whether a cell gets a tooltip: its text is cut off. Asked when the cell is reached, for this
     * cell only - two numbers the browser has at hand - never for every cell up front. Fixed columns
     * clip on purpose.
     */
    function wantsTooltip(cell: HTMLElement): boolean {
        return resize === undefined && !cell.classList.contains('hmm-td-fixed') && isTruncated(cell);
    }

    /** The bubble after the app's tooltip delay, unless the cell is left before. */
    function scheduleTooltip(cell: HTMLElement, source: 'pointer' | 'focus'): void {
        hideTooltip();
        tipCell = cell;
        tipSource = source;
        tooltipTimer = setTimeout(() => {
            tooltipTimer = undefined;
            showTooltip(cell);
        }, TOOLTIP_DELAY_MS);
    }

    /** The pointer entered a cell (delegated: one listener for the whole grid, not one per cell). */
    function onGridPointerOver(event: PointerEvent): void {
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>('.hmm-td, .hmm-th') : null;
        const cell = target ?? undefined;
        if (cell === hovered) {
            return;
        }
        hovered = cell;
        if (cell !== undefined && cell === tipCell) {
            // the keyboard has brought this cell's tooltip already, or is about to
            return;
        }
        if (cell !== undefined && wantsTooltip(cell)) {
            scheduleTooltip(cell, 'pointer');
        } else if (tipSource === 'pointer') {
            hideTooltip();
        }
    }

    /**
     * `:focus-visible` is the browser's own answer to "did this focus come from the keyboard". A
     * focus that came with a click belongs to the pointer: that press has just hidden the tooltip,
     * and the focus must not bring it back a second time.
     */
    function isKeyboardFocus(element: HTMLElement): boolean {
        try {
            return element.matches(':focus-visible');
        } catch {
            return false;
        }
    }

    /**
     * Task 42: keyboard focus arrived in a cell - the sort button of a cut-off column label, a
     * button in a row. The same bubble after the same delay as on hover. A resize handle names
     * itself and gets none.
     */
    function onGridFocusIn(event: FocusEvent): void {
        const target = event.target instanceof HTMLElement ? event.target : undefined;
        const cell = target?.closest<HTMLElement>('.hmm-td, .hmm-th') ?? undefined;
        if (
            target === undefined ||
            cell === undefined ||
            cell === tipCell ||
            target.classList.contains('hmm-th-resize') ||
            !isKeyboardFocus(target)
        ) {
            return;
        }
        if (wantsTooltip(cell)) {
            scheduleTooltip(cell, 'focus');
        }
    }

    /** The focus moved on, or left the grid: a tooltip it brought goes with it. */
    function onGridFocusOut(): void {
        if (tipSource === 'focus') {
            hideTooltip();
        }
    }

    function showTooltip(cell: HTMLElement): void {
        if (tipCell !== cell || !cell.isConnected) {
            return;
        }
        const text = fullText(cell.querySelector<HTMLElement>('.hmm-th-label') ?? cell);
        if (text === '') {
            return;
        }
        const {left, top, bottom} = cell.getBoundingClientRect();
        tooltip = {text, anchor: {left, top, bottom}};
    }

    function hideTooltip(): void {
        if (tooltipTimer !== undefined) {
            clearTimeout(tooltipTimer);
            tooltipTimer = undefined;
        }
        tipCell = undefined;
        tipSource = undefined;
        if (tooltip !== undefined) {
            tooltip = undefined;
        }
    }

    /** Hidden, and the next cell the pointer is over counts as entered again. */
    function forgetTooltip(): void {
        hideTooltip();
        hovered = undefined;
    }

    /** The pointer left the grid: its own tooltip goes; one the keyboard brought stays with the focus. */
    function onGridPointerLeave(): void {
        if (tipSource === 'pointer') {
            hideTooltip();
        }
        hovered = undefined;
    }

    $effect(() => () => {
        if (tooltipTimer !== undefined) {
            clearTimeout(tooltipTimer);
        }
    });
</script>

<!--
    Task 40 (#157): drag to resize, double click to fit, arrow keys and Enter from the keyboard.
    `data-measure-skip` keeps it out of the fit. A focusable separator is a widget in WAI-ARIA (the
    window splitter pattern); Svelte's role table counts every separator as static. Task 42: the same
    handle sits in the label row of an expanded sub-grid, on the columns only the sub-grid has.
-->
{#snippet resizeHandle(column: DataTableColumn<T>, handleTestId: string | undefined)}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
        class="hmm-th-resize"
        class:hmm-th-resize-active={resizingKey === column.key}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('Resize column {column}', {column: column.label})}
        tabindex="0"
        data-measure-skip
        data-testid={handleTestId}
        onpointerdown={(event) => onResizeStart(event, column.key)}
        onpointermove={onResizeMove}
        onpointerup={(event) => onResizeUp(event, column)}
        onpointercancel={onResizeEnd}
        onlostpointercapture={onResizeEnd}
        ondblclick={(event) => {
            event.preventDefault();
            // B-29: two taps sorted twice; under a finger only a drag changes a width
            if (!pressedByTouch) {
                fitColumn(column.key);
            }
        }}
        onkeydown={(event) => onResizeKey(event, column.key)}
    ></div>
{/snippet}

<div class="hmm-table" data-testid={testId} bind:this={root}>
    {#if hasBand}
        <div class="hmm-table-band">
            {#if caption !== undefined}<span class="hmm-table-caption">{caption}</span>{/if}
            {#if toolbar}
                <div class="hmm-table-actions" role="toolbar" aria-label={toolbarLabel ?? caption ?? filterLabel}>
                    {@render toolbar()}
                </div>
            {/if}
            <div class="hmm-table-trailing">
                {#if status}{@render status()}{/if}
                {#if hiddenByFilter && showingText !== undefined}
                    <span class="hmm-table-count" data-testid={testId === undefined ? undefined : `${testId}-count`}
                        >{showingText(shownCount, rows.length)}</span
                    >
                {:else if countText !== undefined}
                    <span class="hmm-table-count" data-testid={testId === undefined ? undefined : `${testId}-count`}
                        >{countText}</span
                    >
                {/if}
            </div>
        </div>
    {/if}

    <div
        class="hmm-table-grid"
        class:hmm-table-resizing={resizingKey !== undefined}
        role="grid"
        aria-rowcount={flat.length}
        aria-colcount={visibleColumns.length}
        tabindex="0"
        style:--hmm-table-columns={sized.template}
        style:--hmm-table-min-width={`${String(sized.minWidth)}px`}
        style:--hmm-table-gutter={`${String(gutter)}px`}
        onkeydown={onKeyDown}
        oncontextmenu={onGridContextMenu}
        onpointerover={onGridPointerOver}
        onpointerleave={onGridPointerLeave}
        onpointerdown={hideTooltip}
        onfocusin={onGridFocusIn}
        onfocusout={onGridFocusOut}
    >
        {#if spans.length > 0}
            <!-- The 2.x Funk grid's second header row: one cell per interface over its columns. -->
            <div class="hmm-table-groups" role="row" bind:this={groupStrip}>
                {#each spans as span (span.key)}
                    <div
                        class="hmm-th hmm-th-group"
                        role="columnheader"
                        aria-colspan={span.end - span.start}
                        style:grid-column={`${String(span.start)} / ${String(span.end)}`}
                        data-testid={testId === undefined ? undefined : `${testId}-group-${span.key}`}
                    >
                        <span class="hmm-th-group-label">{span.label}</span>
                        {#if span.sublabel !== undefined && span.sublabel !== ''}
                            <span class="hmm-th-group-sub">{span.sublabel}</span>
                        {/if}
                    </div>
                {/each}
            </div>
        {/if}

        <div class="hmm-table-head" role="row" bind:this={headStrip}>
            {#if hasExpander}<div class="hmm-th hmm-th-expander" role="columnheader"></div>{/if}
            {#each visibleColumns as column (column.key)}
                <!--
                    Task 40: the label is the header's name - without it the resize handle's own
                    label would be read as part of every column header.
                -->
                <div
                    class="hmm-th"
                    role="columnheader"
                    aria-label={column.label === '' ? undefined : column.label}
                    data-column-key={column.key}
                    style:grid-column={layout.track[column.key]}
                    aria-sort={sort?.key === column.key
                        ? sort.direction === 'asc'
                            ? 'ascending'
                            : 'descending'
                        : 'none'}
                    style:text-align={column.align ?? 'left'}
                >
                    {#if isSortable(column)}
                        <!--
                            #152: the label of a right- or centre-aligned column has to follow the
                            values. `justify-content: inherit` took `normal` from the grid cell, so
                            every sortable label sat on the left while its values sat on the right -
                            "CONNECTED" over one column, its tick over the next.
                        -->
                        <button
                            type="button"
                            class="hmm-th-button"
                            style:justify-content={column.align === 'right'
                                ? 'flex-end'
                                : column.align === 'center'
                                  ? 'center'
                                  : 'flex-start'}
                            onclick={() => toggleSort(column)}
                        >
                            <span class="hmm-th-label">{column.label}</span>
                            {#if sort?.key === column.key}
                                <span class="hmm-th-sort" aria-hidden="true"
                                    >{sort.direction === 'asc' ? '▲' : '▼'}</span
                                >
                            {/if}
                        </button>
                    {:else}
                        <span class="hmm-th-label">{column.label}</span>
                    {/if}
                    {#if isResizable(column)}
                        {@render resizeHandle(
                            column,
                            testId === undefined ? undefined : `${testId}-resize-${column.key}`,
                        )}
                    {/if}
                </div>
            {/each}
            <!--
                #157: the gap a sub-grid-only column leaves in the head, with that column's handle. No
                label and no column header role: no row of the table has a cell there. `grid-row: 1`,
                because these come after the labels in the DOM and auto-placement would otherwise put
                a column that lies before the last label into a second head row.
            -->
            {#each subOnlyColumns as column (column.key)}
                <div
                    class="hmm-th hmm-th-sub-only"
                    data-column-key={column.key}
                    style:grid-column={layout.track[column.key]}
                    style:grid-row="1"
                >
                    {@render resizeHandle(column, testId === undefined ? undefined : `${testId}-resize-${column.key}`)}
                </div>
            {/each}
        </div>

        {#if columnFilterRow}
            <div class="hmm-table-filters" bind:this={filterStrip}>
                {#if hasExpander}<div class="hmm-tf-spacer"></div>{/if}
                {#each visibleColumns as column (column.key)}
                    <div class="hmm-tf" style:grid-column={layout.track[column.key]}>
                        {#if isFilterable(column)}
                            <input
                                class="hmm-input hmm-tf-input"
                                type="search"
                                aria-label={`${filterLabel}: ${column.label}`}
                                value={columnFilters[column.key] ?? ''}
                                oninput={(event) => {
                                    columnFilters = {
                                        ...columnFilters,
                                        [column.key]: event.currentTarget.value,
                                    };
                                }}
                            />
                        {/if}
                    </div>
                {/each}
            </div>
        {/if}

        <div
            class="hmm-table-body"
            bind:this={viewport}
            onscroll={(event) => onBodyScroll(event.currentTarget)}
            style:height={height === undefined ? undefined : `${height}px`}
        >
            {#if flat.length === 0}
                <div class="hmm-table-empty">
                    {#if hiddenByFilter}
                        <span>{noMatchText}</span>
                        <button
                            type="button"
                            class="hmm-button hmm-table-clear"
                            data-testid={testId === undefined ? undefined : `${testId}-clear-filter`}
                            onclick={clearFilters}>{clearFilterLabel}</button
                        >
                    {:else}
                        {emptyText}
                    {/if}
                </div>
            {:else}
                <div class="hmm-table-spacer" style:height={`${flat.length * rowHeight}px`}>
                    <div class="hmm-table-rows" style:transform={`translateY(${window_.start * rowHeight}px)`}>
                        {#each windowRows as flatRow, index (flatRow.key)}
                            <!-- The grid itself carries the keyboard handling; a row is a plain
                                 target for the pointer, which is what every 2.x grid row was. -->
                            <!-- svelte-ignore a11y_click_events_have_key_events -->
                            <div
                                class="hmm-tr"
                                class:hmm-tr-even={(window_.start + index) % 2 === 1}
                                class:hmm-tr-selected={selectedSet.has(flatRow.id)}
                                class:hmm-tr-child={flatRow.depth > 0 && flatRow.kind === 'row'}
                                class:hmm-tr-subhead={flatRow.kind === 'header'}
                                role="row"
                                tabindex="-1"
                                aria-selected={flatRow.kind === 'header' ? undefined : selectedSet.has(flatRow.id)}
                                data-row-id={flatRow.id}
                                data-row-kind={flatRow.kind}
                                style:height={`${rowHeight}px`}
                                onclick={(event) => onRowClick(flatRow, event)}
                                ondblclick={() => {
                                    if (flatRow.kind === 'row') {
                                        onactivate?.(flatRow.row);
                                    }
                                }}
                                oncontextmenu={(event) => onRowContextMenu(flatRow, event)}
                            >
                                {#if hasExpander}
                                    <div class="hmm-td hmm-td-expander">
                                        {#if flatRow.hasChildren}
                                            <button
                                                type="button"
                                                class="hmm-expander"
                                                aria-expanded={flatRow.expanded}
                                                aria-label={flatRow.expanded ? 'Collapse row' : 'Expand row'}
                                                onclick={(event) => {
                                                    event.stopPropagation();
                                                    toggleExpanded(flatRow.id);
                                                }}>{flatRow.expanded ? '−' : '+'}</button
                                            >
                                        {/if}
                                    </div>
                                {/if}
                                {#each flatRow.depth > 0 ? visibleSubColumns : visibleColumns as column (column.key)}
                                    <div
                                        class="hmm-td"
                                        class:hmm-td-fixed={column.fixed === true}
                                        class:hmm-mono={column.mono === true && flatRow.kind === 'row'}
                                        role="gridcell"
                                        data-column-key={column.key}
                                        style:grid-column={layout.track[column.key]}
                                        style:text-align={column.align ?? 'left'}
                                    >
                                        {#if flatRow.kind === 'header'}
                                            {column.label}
                                            {#if subKeys.has(column.key) && isResizable(column)}
                                                {@render resizeHandle(
                                                    column,
                                                    testId === undefined
                                                        ? undefined
                                                        : `${testId}-sub-resize-${column.key}`,
                                                )}
                                            {/if}
                                        {:else if cell}
                                            {@render cell(flatRow.row, column, flatRow)}
                                        {:else}
                                            {cellText(flatRow.row, column)}
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                        {/each}
                    </div>
                </div>
            {/if}
        </div>
    </div>

    <!--
        Outside the grid on purpose: the row window has a transform, and a `position: fixed` bubble
        inside it would be placed against the rows instead of the window.
    -->
    {#if tooltip !== undefined}
        <TooltipBubble
            text={tooltip.text}
            anchor={tooltip.anchor}
            testId={testId === undefined ? undefined : `${testId}-tooltip`}
        />
    {/if}
    {#if headMenuOpen}
        <ContextMenu
            bind:open={headMenuOpen}
            items={headMenuItems}
            x={headMenuX}
            y={headMenuY}
            label={t('Column widths')}
            testId={testId === undefined ? undefined : `${testId}-columns-menu`}
            onselect={onHeadMenuSelect}
        />
    {/if}
</div>

<style>
    .hmm-table {
        display: flex;
        flex-direction: column;
        font-size: var(--hmm-font-size-grid);
        min-height: 0;
        height: 100%;
        border: 1px solid var(--hmm-border);
        border-radius: var(--hmm-radius);
        background: var(--hmm-bg);
        overflow: hidden;
    }

    /* The header band and the column labels under it are one block on the same ground, so the
       grid reads as a table with a head rather than as a strip with a table under it. */
    .hmm-table-band {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 3px 6px;
        background: var(--hmm-header-bg);
        border-bottom: 1px solid var(--hmm-border-muted);
    }

    .hmm-table-caption {
        font-weight: bold;
    }

    /* Tasks 28 and 33: the actions take the free space of the band, so a tab's main action
       (`PrimaryToolbarButton`) has room for its caption when there is some, and is the one thing
       that gives way - down to its icon - when there is not. */
    .hmm-table-actions {
        display: flex;
        align-items: center;
        gap: 2px;
        flex: 1 1 auto;
    }

    /* `margin-left: auto` rather than a spacer: the count sits on the right edge of the band
       whatever the actions on the left add up to. */
    .hmm-table-trailing {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-left: auto;
        padding-left: 8px;
        color: var(--hmm-fg-muted);
        white-space: nowrap;
    }

    .hmm-table-count {
        white-space: nowrap;
    }

    .hmm-table-grid {
        display: flex;
        flex-direction: column;
        min-height: 0;
        flex: 1 1 auto;
        outline-offset: -2px;
    }

    /* A drag keeps its cursor and selects no text, wherever the pointer strays to. */
    .hmm-table-resizing {
        cursor: col-resize;
        user-select: none;
    }

    /*
     * Every strip of the grid is drawn on the one template (D-34) that the grid element carries as
     * `--hmm-table-columns`, and is at least as wide as the columns need (task 40): a row whose box
     * stopped at the window would leave its background behind when the body scrolls sideways. The
     * head strips carry the body's scrollbar gutter as padding, hence the sum.
     */
    .hmm-table-head,
    .hmm-table-filters,
    .hmm-table-groups {
        display: grid;
        grid-template-columns: var(--hmm-table-columns);
        /* not left to app.css: the padding has to be inside the minimum wherever the table is drawn */
        box-sizing: border-box;
        min-width: calc(var(--hmm-table-min-width) + var(--hmm-table-gutter));
        padding-right: var(--hmm-table-gutter);
        background: var(--hmm-header-bg);
    }

    .hmm-table-head,
    .hmm-table-filters {
        border-bottom: 1px solid var(--hmm-border);
    }

    .hmm-table-groups {
        border-bottom: 1px solid var(--hmm-border-muted);
    }

    /* Two lines, centred over the columns the group spans, with a rule on its left so the eye
       can tell where one interface's columns end and the next one's begin. */
    .hmm-th-group {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 3px 6px 2px;
        border-left: 1px solid var(--hmm-border-muted);
        line-height: 1.2;
        text-align: center;
    }

    .hmm-th-group-sub {
        font-weight: normal;
        color: var(--hmm-fg-faint);
    }

    /* D-34: a column label the way the she UI writes one - small, semibold, muted, and with no vertical
       rule between the columns. The 2.x grid drew a full lattice; the header line alone is enough. */
    .hmm-th {
        position: relative;
        padding: 6px 6px;
        font-size: var(--hmm-font-size-small);
        font-weight: 600;
        letter-spacing: 0.02em;
        color: var(--hmm-fg-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .hmm-th-button {
        display: inline-flex;
        gap: 4px;
        align-items: center;
        width: 100%;
        padding: 0;
        border: none;
        background: none;
        font: inherit;
        color: inherit;
        cursor: pointer;
        justify-content: inherit;
    }

    .hmm-th-button:hover {
        color: var(--hmm-fg);
    }

    .hmm-th-sort {
        font-size: var(--hmm-font-size-small);
    }

    /*
     * Task 40: the handle is the label's right padding. D-34 has no rule between the columns, so
     * the edge only shows while the pointer is over the labels - a faint line where a column can be
     * dragged - and turns into the accent under the pointer, on focus and during a drag.
     */
    /*
     * B-34: above its neighbours. The cells of the head that stand over a sub-grid-only column
     * (issue 157) come after the labels in the DOM and so paint over them; a finger is hit-tested with an
     * area rather than a point, and 3 px inside TYPE's handle it landed on the DIRECTION cell next
     * to it - found when the Msgs column became resizable and moved the columns by a few pixels.
     */
    .hmm-th-resize {
        position: absolute;
        z-index: 1;
        top: 0;
        right: 0;
        bottom: 0;
        width: 7px;
        cursor: col-resize;
        touch-action: none;
        outline: none;
    }

    .hmm-th-resize::after {
        content: '';
        position: absolute;
        top: 5px;
        bottom: 5px;
        right: 0;
        width: 1px;
        background: transparent;
    }

    /*
     * Task 42: 7 px is a mouse's target, not a finger's - the addon is opened on tablets. Under a
     * coarse pointer the handle keeps its box and its line, and an invisible extension of it reaches
     * 24 px into the label, where a press still lands on the handle. Towards the left only: the cell
     * clips at its right edge, so anything past it could not be hit anyway. `touch-action: none`
     * above keeps the page from scrolling while a finger drags.
     */
    @media (pointer: coarse) {
        .hmm-th-resize::before {
            content: '';
            position: absolute;
            top: 0;
            bottom: 0;
            right: 0;
            width: 24px;
        }
    }

    /* Task 42: a sub-grid's label row carries the handles of the columns only the sub-grid has. */
    .hmm-tr-subhead .hmm-td {
        position: relative;
    }

    .hmm-table-head:hover .hmm-th-resize::after,
    .hmm-tr-subhead:hover .hmm-th-resize::after {
        background: var(--hmm-border);
    }

    .hmm-table-head .hmm-th-resize:hover::after,
    .hmm-tr-subhead .hmm-th-resize:hover::after,
    .hmm-th-resize:focus-visible::after,
    .hmm-table-head .hmm-th-resize-active::after,
    .hmm-tr-subhead .hmm-th-resize-active::after {
        top: 2px;
        bottom: 2px;
        width: 3px;
        background: var(--hmm-accent);
    }

    .hmm-tf {
        padding: 3px 4px;
        min-width: 0;
    }

    .hmm-tf-input {
        width: 100%;
        height: 20px;
    }

    .hmm-table-body {
        flex: 1 1 auto;
        min-height: 0;
        overflow: auto;
        /* The head is a sibling and does not scroll; a gutter that appears and disappears with the
           row count would move every proportional column under it. */
        scrollbar-gutter: stable;
        position: relative;
    }

    .hmm-table-spacer {
        position: relative;
    }

    .hmm-table-rows {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        min-width: var(--hmm-table-min-width);
        will-change: transform;
    }

    .hmm-tr {
        display: grid;
        grid-template-columns: var(--hmm-table-columns);
        align-items: center;
        border-bottom: 1px solid var(--hmm-border-muted);
        background: var(--hmm-row-odd);
        cursor: default;
    }

    /* The she UI gives its tables no zebra; the row separator carries the eye instead. The class stays
       and follows the absolute row index, so bringing the stripes back is one token. */
    .hmm-tr-even {
        background: var(--hmm-row-even);
    }

    .hmm-tr:hover {
        background: var(--hmm-row-hover);
    }

    .hmm-tr-child {
        background: var(--hmm-bg-sunken);
    }

    /* The 2.x subgrid drew its own header line above a device's channels. */
    .hmm-tr-subhead,
    .hmm-tr-subhead:hover {
        background: var(--hmm-header-solid);
        font-weight: bold;
        cursor: default;
    }

    .hmm-tr-selected,
    .hmm-tr-selected:hover {
        background: var(--hmm-row-selected);
        color: var(--hmm-row-selected-text);
    }

    .hmm-td {
        padding: 0 6px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    /*
     * Issue 148: a fixed column holds a picture, a glyph or a control, never running text, and a
     * control a pixel wider than its track made the browser draw the ellipsis of `text-overflow`
     * beside it - the "überflüssiger Punkt" behind every receiver marker of the Funk grid, in
     * every row. There is nothing to abbreviate in such a cell, so it clips instead.
     */
    .hmm-td-fixed {
        text-overflow: clip;
    }

    .hmm-td-expander,
    .hmm-th-expander {
        padding: 0;
        text-align: center;
    }

    .hmm-expander {
        width: 18px;
        height: 18px;
        padding: 0;
        line-height: 1;
        border: 1px solid var(--hmm-border);
        border-radius: 2px;
        background: none;
        color: var(--hmm-fg-muted);
        cursor: pointer;
    }

    .hmm-expander:hover {
        background: var(--hmm-control-bg-hover);
        color: var(--hmm-fg);
    }

    .hmm-table-empty {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px;
        color: var(--hmm-fg-muted);
    }

    .hmm-table-clear {
        height: 22px;
        padding: 0 8px;
        font-size: var(--hmm-font-size-small);
    }
</style>
