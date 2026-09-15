<script lang="ts">
    import {parentPath, slugId, type MetaEnum, type MetaObjectView} from '@homematic-manager/core';

    import DataTable from '../../lib/components/DataTable.svelte';
    import type {DataTableColumn} from '../../lib/components/tableModel.js';
    import ToolbarButton from '../../lib/components/ToolbarButton.svelte';
    import {
        deletionMembers,
        enumNameAfterRename,
        enumRows,
        indentOf,
        moveTargets,
        nodeRows,
        rowIndex,
        type MetadataActions,
        type MetaRow,
        type Translate,
    } from '../../lib/util/metaTree.js';

    import DeleteDialog from './DeleteDialog.svelte';
    import MoveDialog from './MoveDialog.svelte';
    import NameDialog from './NameDialog.svelte';

    /**
     * The editor of the metadata store's pages (the maintainer, 2026-09-10): the same grid as the
     * device tab, one row per node, the toolbar above it, and every write as a small dialog.
     *
     * Two shapes from one component. With `enumId` it is one taxonomy as a list - the "Rooms" and
     * "Functions" tabs of ReGaHSS, whose lists are flat. Without it every taxonomy is a top-level
     * row and its nodes sit under it, to any depth, with the depth drawn as indentation - the
     * "Metadata" tab of occulited.
     *
     * It is deliberately self-contained: the trees, the objects and the store's state come in as
     * props, every write goes out through `actions`, and the words come from the `t` it is
     * handed. That is what lets the same editor be carried into occulited's own web UI, which has
     * its own API client and its own translator. The pure parts - what a row is, where a node may
     * go, whom a deletion touches - are `lib/util/metaTree.ts`.
     *
     * No optimistic update anywhere: a write answers with the backend's events and the rows are
     * built from those. On a box somebody else may be editing at the same time, and the event is
     * what says what really happened.
     */
    interface Props {
        enums: Readonly<Record<string, MetaEnum>>;
        objects: Readonly<Record<string, MetaObjectView>>;
        /** Only this taxonomy, as a list; every taxonomy as a tree when absent. */
        enumId?: string | undefined;
        /** The store's taxonomies are flat lists: no node below another, nothing to move. */
        flat?: boolean;
        /** A store answered at all. */
        available?: boolean;
        /** The store takes writes. */
        writable?: boolean;
        /** For the taxonomy names, and the language a renamed taxonomy is written in. */
        language?: string;
        t: Translate;
        actions: MetadataActions;
        /** A member's name for the delete dialog; the ref when absent. */
        labelOf?: ((ref: string) => string) | undefined;
        emptyText?: string | undefined;
        /** "4 rooms", "3 taxonomies" - the caller knows what the rows are called. */
        countText?: ((count: number) => string) | undefined;
        /** Task 40: what the grid's column widths are kept under - one per store page. */
        tableId?: string | undefined;
        testId?: string;
    }

    let {
        enums,
        objects,
        enumId = undefined,
        flat = false,
        available = true,
        writable = true,
        language = 'en',
        t,
        actions,
        labelOf = undefined,
        emptyText = undefined,
        countText = undefined,
        tableId = undefined,
        testId = 'meta-table',
    }: Props = $props();

    let selected = $state<string[]>([]);
    let expanded = $state<string[]>([]);
    let busy = $state(false);

    type NameMode = 'enum' | 'add' | 'add-below' | 'rename';
    let nameOpen = $state(false);
    let nameMode = $state<NameMode>('add');
    let nameTitle = $state('');
    let nameLabel = $state('');
    let nameInitial = $state('');
    let moveOpen = $state(false);
    let deleteOpen = $state(false);
    /** The row a dialog works on, fixed when it opened - the selection may change under it. */
    let subject = $state<MetaRow | undefined>(undefined);

    const treeMode = $derived(enumId === undefined);
    const nested = $derived(!flat);

    const rows = $derived(enumId === undefined ? enumRows(enums, objects, language) : nodeRows(enums, objects, enumId));
    const index = $derived(rowIndex(rows));
    const selectedRow = $derived(selected.length === 1 ? index.get(selected[0] ?? '') : undefined);
    const selectedNode = $derived(selectedRow?.kind === 'node' ? selectedRow : undefined);

    /** The taxonomies open when they arrive; one the user closed stays closed on the next event. */
    const seenEnums: string[] = [];
    $effect(() => {
        if (!treeMode) {
            return;
        }
        const fresh = Object.keys(enums).filter((id) => !seenEnums.includes(id));
        if (fresh.length > 0) {
            seenEnums.push(...fresh);
            expanded = [...expanded, ...fresh];
        }
    });

    $effect(() => {
        // a row that vanished under the selection - deleted here or elsewhere
        if (selected.some((id) => !index.has(id))) {
            selected = selected.filter((id) => index.has(id));
        }
    });

    const reason = $derived(
        !available ? t('No store connected') : !writable ? t('The store does not take writes') : t('Select a row'),
    );
    const canWrite = $derived(available && writable && !busy);
    /** "Add" puts a node at the root of a taxonomy: the given one, or the one of the selected row. */
    const addEnumId = $derived(enumId ?? selectedRow?.enumId);
    const canAdd = $derived(canWrite && addEnumId !== undefined);
    const addReason = $derived(canWrite && treeMode ? t('Select a taxonomy or a node') : reason);
    const nodeReason = $derived(canWrite ? t('Select a node') : reason);

    const columns = $derived<DataTableColumn<MetaRow>[]>([
        // a tree is not sorted: a parent sorted away from its children is not a tree any more
        {key: 'name', label: t('Name'), width: 240, sortable: !treeMode, value: (row) => row.name},
        {
            // B-35: resizable like any text column; a count fits the grid's own minimum
            key: 'devices',
            label: t('Devices'),
            width: 96,
            align: 'right',
            filterable: false,
            sortable: !treeMode,
            value: (row) => (row.devices === 0 ? '' : row.devices),
        },
        {
            key: 'channels',
            label: t('Channels'),
            width: 96,
            align: 'right',
            filterable: false,
            sortable: !treeMode,
            value: (row) => (row.channels === 0 ? '' : row.channels),
        },
        {
            key: 'path',
            label: t('Path'),
            width: 220,
            mono: true,
            sortable: !treeMode,
            value: (row) => row.path ?? row.enumId,
        },
    ]);

    function subRowsOf(row: MetaRow): readonly MetaRow[] {
        return row.nodes ?? [];
    }

    // ---------------------------------------------------------------- the writes

    function openName(mode: NameMode, row: MetaRow | undefined): void {
        nameMode = mode;
        subject = row;
        switch (mode) {
            case 'enum':
                nameTitle = t('New taxonomy');
                nameLabel = t('Name');
                nameInitial = '';
                break;
            case 'add':
                nameTitle = t('Add');
                nameLabel = t('Name');
                nameInitial = '';
                break;
            case 'add-below':
                nameTitle = t('Add below');
                nameLabel = `${t('Add below')}: ${row?.name ?? ''}`;
                nameInitial = '';
                break;
            case 'rename':
                nameTitle = t('Rename');
                nameLabel = t('New name');
                nameInitial = row?.name ?? '';
                break;
        }
        nameOpen = true;
    }

    async function applyName(name: string): Promise<boolean> {
        busy = true;
        try {
            switch (nameMode) {
                case 'enum':
                    return await actions.createEnum(
                        slugId(name, Object.keys(enums)),
                        enumNameAfterRename(undefined, name, language),
                    );
                case 'add': {
                    if (addEnumId === undefined) {
                        return false;
                    }
                    return (await actions.createNode(addEnumId, undefined, name)) !== undefined;
                }
                case 'add-below': {
                    const row = subject;
                    if (row?.path === undefined) {
                        return false;
                    }
                    return (await actions.createNode(row.enumId, row.path, name)) !== undefined;
                }
                case 'rename': {
                    const row = subject;
                    if (row === undefined) {
                        return false;
                    }
                    if (row.kind === 'enum') {
                        return await actions.renameEnum(
                            row.enumId,
                            enumNameAfterRename(enums[row.enumId]?.name, name, language),
                        );
                    }
                    return await actions.renameNode(row.path ?? '', name);
                }
            }
        } finally {
            busy = false;
        }
    }

    function openMove(row: MetaRow | undefined): void {
        if (row?.path === undefined) {
            return;
        }
        subject = row;
        moveOpen = true;
    }

    async function applyMove(parent: string | null): Promise<boolean> {
        const row = subject;
        if (row?.path === undefined) {
            return false;
        }
        busy = true;
        try {
            return await actions.moveNode(row.path, parent);
        } finally {
            busy = false;
        }
    }

    function openDelete(row: MetaRow | undefined): void {
        if (row === undefined) {
            return;
        }
        subject = row;
        deleteOpen = true;
    }

    async function applyDelete(detach: boolean): Promise<boolean> {
        const row = subject;
        if (row === undefined) {
            return false;
        }
        busy = true;
        try {
            return row.kind === 'enum'
                ? await actions.deleteEnum(row.enumId, detach)
                : await actions.deleteNode(row.path ?? '', detach);
        } finally {
            busy = false;
        }
    }

    async function refresh(): Promise<void> {
        busy = true;
        await actions.refresh();
        busy = false;
    }

    /** Enter or a double click on a row renames it, as the grids do elsewhere. */
    function activate(row: MetaRow): void {
        if (canWrite) {
            openName('rename', row);
        }
    }

    const moveSubject = $derived(subject?.path === undefined ? undefined : subject);
    const deleteMembers = $derived(subject === undefined ? [] : deletionMembers(objects, subject));
</script>

<div class="hmm-page">
    <div class="hmm-page-grid">
        <DataTable
            {rows}
            {columns}
            getId={(row) => row.id}
            subRows={treeMode ? subRowsOf : undefined}
            bind:selected
            bind:expanded
            scope={enumId ?? 'metadata'}
            caption={enumId === undefined ? t('Metadata') : enumId === 'room' ? t('Rooms') : t('Functions')}
            filterLabel={t('Filter')}
            emptyText={!available ? t('No store connected') : (emptyText ?? '')}
            noMatchText={t('No row matches the filter')}
            clearFilterLabel={t('Clear filter')}
            showingText={(shown, total) => t('Showing {shown} of {total}', {shown, total})}
            countText={countText === undefined ? undefined : countText(rows.length)}
            onactivate={activate}
            {tableId}
            {testId}
        >
            {#snippet toolbar()}
                {#if treeMode}
                    <ToolbarButton
                        title={t('New taxonomy')}
                        icon="⊞"
                        disabled={!canWrite}
                        {reason}
                        testId="meta-new-enum"
                        onclick={() => openName('enum', undefined)}
                    />
                {/if}
                <ToolbarButton
                    title={t('Add')}
                    icon="+"
                    disabled={!canAdd}
                    reason={addReason}
                    testId="meta-add"
                    onclick={() => openName('add', selectedRow)}
                />
                {#if nested}
                    <ToolbarButton
                        title={t('Add below')}
                        icon="⊕"
                        disabled={!canWrite || selectedNode === undefined}
                        reason={nodeReason}
                        testId="meta-add-below"
                        onclick={() => openName('add-below', selectedNode)}
                    />
                {/if}
                <ToolbarButton
                    title={t('Rename')}
                    icon="✎"
                    disabled={!canWrite || selectedRow === undefined}
                    {reason}
                    testId="meta-rename"
                    onclick={() => openName('rename', selectedRow)}
                />
                {#if nested}
                    <ToolbarButton
                        title={t('Move')}
                        icon="⤴"
                        disabled={!canWrite || selectedNode === undefined}
                        reason={nodeReason}
                        testId="meta-move"
                        onclick={() => openMove(selectedNode)}
                    />
                {/if}
                <ToolbarButton
                    title={t('Delete')}
                    icon="🗑"
                    disabled={!canWrite || selectedRow === undefined}
                    {reason}
                    testId="meta-delete"
                    onclick={() => openDelete(selectedRow)}
                />
                <!-- task 27: ReGaHSS has no change stream, so a room made in the WebUI arrives on request -->
                <ToolbarButton
                    title={t('Refresh')}
                    icon="⟳"
                    disabled={!available}
                    {busy}
                    testId="meta-refresh"
                    onclick={() => void refresh()}
                />
            {/snippet}

            {#snippet cell(row, column)}
                {#if column.key === 'name'}
                    <!-- the depth of a node as indentation: `DataTable` nests one level, a taxonomy eight -->
                    <span
                        class="hmm-meta-name"
                        class:hmm-meta-name-enum={row.kind === 'enum'}
                        style:padding-left={`${String(indentOf(row.depth))}px`}
                        data-depth={row.depth}>{row.name}</span
                    >
                {:else if column.key === 'path'}
                    <span class="hmm-meta-path">{row.path ?? row.enumId}</span>
                {:else}
                    {column.value ? (column.value(row) ?? '') : ''}
                {/if}
            {/snippet}
        </DataTable>
    </div>
</div>

<NameDialog
    bind:open={nameOpen}
    title={nameTitle}
    label={nameLabel}
    initial={nameInitial}
    {t}
    onapply={applyName}
    testId="meta-name"
/>
<MoveDialog
    bind:open={moveOpen}
    title={t('Move')}
    subject={moveSubject?.name ?? ''}
    targets={moveSubject?.path === undefined ? [] : moveTargets(enums, moveSubject.path)}
    current={moveSubject?.path === undefined ? '' : (parentPath(moveSubject.path) ?? '')}
    {t}
    onapply={applyMove}
    testId="meta-move"
/>
<DeleteDialog
    bind:open={deleteOpen}
    title={t('Delete')}
    subject={subject?.name ?? ''}
    members={deleteMembers}
    {labelOf}
    {t}
    onapply={applyDelete}
    testId="meta-delete"
/>

<style>
    .hmm-page {
        display: flex;
        flex-direction: column;
        gap: 6px;
        height: 100%;
        min-height: 0;
    }

    .hmm-page-grid {
        flex: 1 1 auto;
        min-height: 0;
    }

    .hmm-meta-name {
        display: inline-block;
    }

    .hmm-meta-name-enum {
        font-weight: 600;
    }

    .hmm-meta-path {
        color: var(--hmm-fg-muted);
        font-size: var(--hmm-font-size-small);
    }
</style>
