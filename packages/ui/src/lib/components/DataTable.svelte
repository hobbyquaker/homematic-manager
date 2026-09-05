<script lang="ts" generics="T">
    import type {Snippet} from 'svelte';

    import {
        buildRows,
        cellText,
        gridTemplate,
        isFilterable,
        isSortable,
        nextSelection,
        visibleWindow,
        type DataTableColumn,
        type FlatRow,
        type SortState,
    } from './tableModel.js';

    interface Props {
        rows: T[];
        columns: DataTableColumn<T>[];
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
        /** Row height in pixels; the virtualiser needs it to be uniform. */
        rowHeight?: number;
        /** Fixed body height. Without one the body fills its parent and is measured. */
        height?: number | undefined;
        overscan?: number;
        /** Show the global filter box above the grid. */
        filterBox?: boolean;
        /** Show the per-column filter row, as the 2.x filter toolbar did. */
        columnFilterRow?: boolean;
        caption?: string | undefined;
        emptyText?: string;
        filterLabel?: string;
        countText?: string | undefined;
        selected?: string[];
        expanded?: string[];
        filter?: string;
        sort?: SortState | undefined;
        /** Double click, or Enter on the focused row. */
        onactivate?: ((row: T) => void) | undefined;
        /** Right click on a row; the table has already called `preventDefault()`. */
        onrowcontextmenu?: ((row: T, event: MouseEvent) => void) | undefined;
        /** Draws one cell; without it the cell is the column's text value. */
        cell?: Snippet<[T, DataTableColumn<T>, FlatRow<T>]> | undefined;
        testId?: string | undefined;
    }

    let {
        rows,
        columns,
        getId,
        subRows = undefined,
        subColumns = undefined,
        rowHeight = 23,
        height = undefined,
        overscan = 6,
        filterBox = true,
        columnFilterRow = true,
        caption = undefined,
        emptyText = '',
        filterLabel = 'Filter',
        countText = undefined,
        selected = $bindable([]),
        expanded = $bindable([]),
        filter = $bindable(''),
        sort = $bindable(undefined),
        onactivate = undefined,
        onrowcontextmenu = undefined,
        cell = undefined,
        testId = undefined,
    }: Props = $props();

    let columnFilters = $state<Record<string, string>>({});
    let scrollTop = $state(0);
    let measuredHeight = $state(0);
    let focusIndex = $state(0);
    let anchorId = $state<string | undefined>(undefined);
    let viewport = $state<HTMLDivElement | undefined>(undefined);

    const visibleColumns = $derived(columns.filter((column) => column.hidden !== true));
    const visibleSubColumns = $derived((subColumns ?? columns).filter((column) => column.hidden !== true));
    const hasExpander = $derived(subRows !== undefined);
    const template = $derived(gridTemplate(columns, hasExpander));
    const subTemplate = $derived(gridTemplate(subColumns ?? columns, hasExpander));
    const expandedSet = $derived(new Set(expanded));
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

    $effect(() => {
        const element = viewport;
        if (!element || height !== undefined) {
            return;
        }
        measuredHeight = element.clientHeight;
        const observer = new ResizeObserver(() => {
            measuredHeight = element.clientHeight;
        });
        observer.observe(element);
        return () => {
            observer.disconnect();
        };
    });

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
            default:
                break;
        }
    }
</script>

<div class="hmm-table" data-testid={testId}>
    {#if caption !== undefined || filterBox}
        <div class="hmm-table-toolbar">
            {#if caption !== undefined}<span class="hmm-table-caption">{caption}</span>{/if}
            {#if filterBox}
                <input
                    class="hmm-input hmm-table-filter"
                    type="search"
                    bind:value={filter}
                    placeholder={filterLabel}
                    aria-label={filterLabel}
                />
            {/if}
            {#if countText !== undefined}<span class="hmm-table-count">{countText}</span>{/if}
        </div>
    {/if}

    <div
        class="hmm-table-grid"
        role="grid"
        aria-rowcount={flat.length}
        aria-colcount={visibleColumns.length}
        tabindex="0"
        onkeydown={onKeyDown}
    >
        <div class="hmm-table-head" role="row" style:grid-template-columns={template}>
            {#if hasExpander}<div class="hmm-th hmm-th-expander" role="columnheader"></div>{/if}
            {#each visibleColumns as column (column.key)}
                <div
                    class="hmm-th"
                    role="columnheader"
                    aria-sort={sort?.key === column.key
                        ? sort.direction === 'asc'
                            ? 'ascending'
                            : 'descending'
                        : 'none'}
                    style:text-align={column.align ?? 'left'}
                >
                    {#if isSortable(column)}
                        <button type="button" class="hmm-th-button" onclick={() => toggleSort(column)}>
                            <span>{column.label}</span>
                            {#if sort?.key === column.key}
                                <span class="hmm-th-sort" aria-hidden="true"
                                    >{sort.direction === 'asc' ? '▲' : '▼'}</span
                                >
                            {/if}
                        </button>
                    {:else}
                        <span>{column.label}</span>
                    {/if}
                </div>
            {/each}
        </div>

        {#if columnFilterRow}
            <div class="hmm-table-filters" style:grid-template-columns={template}>
                {#if hasExpander}<div class="hmm-tf-spacer"></div>{/if}
                {#each visibleColumns as column (column.key)}
                    <div class="hmm-tf">
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
            onscroll={(event) => (scrollTop = event.currentTarget.scrollTop)}
            style:height={height === undefined ? undefined : `${height}px`}
        >
            {#if flat.length === 0}
                <div class="hmm-table-empty">{emptyText}</div>
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
                                style:grid-template-columns={flatRow.depth > 0 ? subTemplate : template}
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
                                        class:hmm-mono={column.mono === true && flatRow.kind === 'row'}
                                        role="gridcell"
                                        style:text-align={column.align ?? 'left'}
                                    >
                                        {#if flatRow.kind === 'header'}
                                            {column.label}
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
</div>

<style>
    .hmm-table {
        display: flex;
        flex-direction: column;
        min-height: 0;
        height: 100%;
        border: 1px solid var(--hmm-border);
        border-radius: var(--hmm-radius);
        background: var(--hmm-bg);
        overflow: hidden;
    }

    .hmm-table-toolbar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 3px 6px;
        background: var(--hmm-header-bg);
        border-bottom: 1px solid var(--hmm-border);
    }

    .hmm-table-caption {
        font-weight: bold;
    }

    .hmm-table-filter {
        margin-left: auto;
        width: 220px;
    }

    .hmm-table-count {
        color: var(--hmm-fg-muted);
        white-space: nowrap;
    }

    .hmm-table-grid {
        display: flex;
        flex-direction: column;
        min-height: 0;
        flex: 1 1 auto;
        outline-offset: -2px;
    }

    .hmm-table-head,
    .hmm-table-filters {
        display: grid;
        background: var(--hmm-header-bg);
        border-bottom: 1px solid var(--hmm-border);
    }

    .hmm-th {
        padding: 3px 4px;
        font-weight: bold;
        border-right: 1px solid var(--hmm-border-muted);
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
        font-weight: bold;
        cursor: pointer;
        justify-content: inherit;
    }

    .hmm-th-sort {
        font-size: var(--hmm-font-size-small);
    }

    .hmm-tf {
        padding: 2px 3px;
        border-right: 1px solid var(--hmm-border-muted);
        min-width: 0;
    }

    .hmm-tf-input {
        width: 100%;
        height: 18px;
    }

    .hmm-table-body {
        flex: 1 1 auto;
        min-height: 0;
        overflow: auto;
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
        will-change: transform;
    }

    .hmm-tr {
        display: grid;
        align-items: center;
        border-bottom: 1px solid var(--hmm-border-muted);
        background: var(--hmm-row-odd);
        cursor: default;
    }

    /* Striping follows the absolute row index, not the rendered window, so it does not
       flicker while the virtualiser scrolls. */
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
        padding: 0 4px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .hmm-td-expander,
    .hmm-th-expander {
        padding: 0;
        text-align: center;
    }

    .hmm-expander {
        width: 16px;
        height: 16px;
        padding: 0;
        line-height: 1;
        border: 1px solid var(--hmm-border);
        border-radius: 2px;
        background: var(--hmm-bg);
        cursor: pointer;
    }

    .hmm-table-empty {
        padding: 8px;
        color: var(--hmm-fg-muted);
    }
</style>
