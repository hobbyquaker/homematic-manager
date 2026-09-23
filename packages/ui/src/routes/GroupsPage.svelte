<script lang="ts">
    import type {HeatingGroup, HeatingGroupMember} from '@homematic-manager/core';

    import DataTable from '../lib/components/DataTable.svelte';
    import ToolbarButton from '../lib/components/ToolbarButton.svelte';
    import Tooltip from '../lib/components/Tooltip.svelte';
    import type {DataTableColumn} from '../lib/components/tableModel.js';
    import {getStores} from '../lib/stores/context.js';

    import DeleteGroupDialog from './groups/DeleteGroupDialog.svelte';
    import GroupDialog from './groups/GroupDialog.svelte';

    /**
     * Task 57: the heating groups of the `VirtualDevices` interface - the tab the CCU's WebUI has
     * under *Settings → Groups* and 2.7 never had, because the group process offers no RPC for it.
     * On openccu-lite the system's API does, and this is its editor: the groups as a grid with their
     * members, and New, Edit and Delete as small dialogs. Everything goes through the system's API;
     * the group devices themselves stay what the Devices tab of this interface shows.
     */
    const stores = getStores();
    const t = stores.i18n.t;
    const groups = $derived(stores.groups);

    let selected = $state<string[]>([]);
    let editorOpen = $state(false);
    /** The group the editor works on; `undefined` is a new one. */
    let editing = $state<HeatingGroup | undefined>(undefined);
    let deleteOpen = $state(false);
    let deleting = $state<HeatingGroup | undefined>(undefined);

    const selectedGroup = $derived(groups.groups.find((group) => String(group.id) === selected[0]));

    /**
     * Only an administrator changes groups on the system; where the host knows who is looking at
     * the page (the addon), the buttons say so instead of letting the API refuse. Off the system
     * there is no session and the token decides - the API's answer is then the notice.
     */
    const readOnly = $derived(stores.app.session !== null && stores.app.session.level < 8);
    const readOnlyReason = $derived(readOnly ? t('Needs the administrator role on the system') : undefined);

    /** Read when the tab opens; the store keeps the list, the changes read it again. */
    $effect(() => {
        if (groups.offered) {
            void groups.load();
        }
    });

    /** A member as a person reads it: the name where one is known, the address always. */
    function memberLabel(member: HeatingGroupMember): string {
        const name = stores.names.name(member.id);
        return name === undefined ? member.id : `${name} (${member.id})`;
    }

    function membersText(group: HeatingGroup): string {
        return group.members.map(memberLabel).join(', ');
    }

    /** The type labels come from the system as the WebUI's keys; the catalogue knows the two. */
    function typeLabel(group: HeatingGroup): string {
        return t(group.typeLabel);
    }

    function openNew(): void {
        editing = undefined;
        editorOpen = true;
    }

    function openEdit(group: HeatingGroup | undefined): void {
        if (group === undefined) {
            return;
        }
        editing = group;
        editorOpen = true;
    }

    function openDelete(group: HeatingGroup | undefined): void {
        if (group === undefined) {
            return;
        }
        deleting = group;
        deleteOpen = true;
    }

    const pendingText = $derived(
        groups.devicesToConfigure.length === 0
            ? ''
            : t('Configuration pending: {list}', {list: groups.devicesToConfigure.map(memberLabel).join(', ')}),
    );

    const columns = $derived<DataTableColumn<HeatingGroup>[]>([
        {key: 'name', label: t('Group name'), width: 220, copy: 'name'},
        {key: 'type', label: t('Group type'), width: 180, value: typeLabel},
        {key: 'device', label: t('Virtual device'), width: 140, mono: true, copy: 'address'},
        {
            key: 'members',
            label: t('Members'),
            width: 420,
            sortable: false,
            value: membersText,
        },
    ]);
</script>

<div class="hmm-page">
    <div class="hmm-page-grid">
        {#if !groups.offered}
            <!-- the tab is shown only while the API is there; this is the moment it went away -->
            <p class="hmm-groups-unavailable" data-testid="groups-unavailable">
                {t('Heating groups are not available here')}{groups.state?.message === undefined
                    ? ''
                    : `: ${groups.state.message}`}
            </p>
        {:else}
            <DataTable
                rows={groups.groups}
                scope={stores.app.selectedInterface}
                {columns}
                getId={(group) => String(group.id)}
                bind:selected
                caption={t('Heating groups')}
                filterLabel={t('Filter')}
                emptyText={groups.loaded ? t('No groups yet') : t('Loading')}
                toolbarLabel={t('Heating groups')}
                countText={t('{count} groups', {}, groups.groups.length)}
                onactivate={(group) => (readOnly ? undefined : openEdit(group))}
                tableId="groups"
                testId="groups-table"
            >
                {#snippet toolbar()}
                    <ToolbarButton
                        title={t('Refresh')}
                        icon="⟳"
                        busy={groups.loading}
                        testId="groups-refresh"
                        onclick={() => void groups.load()}
                    />
                    <ToolbarButton
                        title={t('New group')}
                        icon="+"
                        disabled={readOnly}
                        reason={readOnlyReason}
                        testId="groups-new"
                        onclick={openNew}
                    />
                    <ToolbarButton
                        title={t('Edit group')}
                        icon="✎"
                        disabled={readOnly || selectedGroup === undefined}
                        reason={readOnlyReason ?? t('Select a group')}
                        testId="groups-edit"
                        onclick={() => openEdit(selectedGroup)}
                    />
                    <ToolbarButton
                        title={t('Delete group')}
                        icon="✕"
                        disabled={readOnly || selectedGroup === undefined}
                        reason={readOnlyReason ?? t('Select a group')}
                        testId="groups-delete"
                        onclick={() => openDelete(selectedGroup)}
                    />
                {/snippet}

                {#snippet status()}
                    {#if pendingText !== ''}
                        <!--
                            What the WebUI shows as its "configure devices" popup after a change: the
                            members whose direct connections the group process is still writing. A
                            hint, not a question - there is nothing to answer.
                        -->
                        <Tooltip
                            text={t('The direct device connections of these devices are still being configured')}
                            testId="groups-pending-tooltip"
                        >
                            <span class="hmm-groups-pending" data-testid="groups-pending">{pendingText}</span>
                        </Tooltip>
                    {/if}
                {/snippet}

                {#snippet cell(row, column)}
                    {#if column.key === 'members'}
                        <span data-testid={`group-members-${String(row.id)}`}>
                            {#if row.members.length === 0}
                                <span class="hmm-groups-none">{t('There are no devices in the group')}</span>
                            {:else}
                                {membersText(row)}
                            {/if}
                        </span>
                    {:else if column.value}
                        {column.value(row) ?? ''}
                    {:else}
                        {(row as unknown as Record<string, string>)[column.key] ?? ''}
                    {/if}
                {/snippet}
            </DataTable>
        {/if}
    </div>
</div>

<GroupDialog bind:open={editorOpen} group={editing} />
<DeleteGroupDialog bind:open={deleteOpen} group={deleting} />

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

    .hmm-groups-unavailable {
        margin: 24px;
        color: var(--hmm-fg-muted);
    }

    .hmm-groups-pending {
        color: var(--hmm-warn);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 40vw;
        display: inline-block;
        vertical-align: bottom;
    }

    .hmm-groups-none {
        color: var(--hmm-fg-muted);
    }
</style>
