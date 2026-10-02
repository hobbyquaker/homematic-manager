<script lang="ts">
    import {isDeviceAddress, renameEntries} from '@homematic-manager/core';
    import {tick, untrack} from 'svelte';

    import Dialog from '../../lib/components/Dialog.svelte';
    import {getStores} from '../../lib/stores/context.js';
    import {
        assignRequests,
        changedPaths,
        membershipStates,
        type AssignRequest,
        type AssignTarget,
        type CheckState,
    } from '../../lib/util/assignment.js';
    import type {TaxonomyId} from '../../lib/util/taxonomy.js';
    import AssignSide from './AssignSide.svelte';

    /**
     * Task 49's "Assign to room" / "Assign to function" - since task 86 one dialog for both: rooms on
     * the left, functions on the right (a channel filed into a room usually wants a function too) and,
     * for one row, its name above them (the maintainer, 2026-10-02). One Apply saves all three. What
     * the store refuses stays marked and the dialog open, so Apply can send just that again.
     */

    type States = Record<TaxonomyId, Record<string, CheckState>>;
    type Failures = Record<TaxonomyId, Record<string, string>>;
    const SIDES: readonly TaxonomyId[] = ['room', 'function'];

    interface Props {
        open?: boolean;
        /** The selected rows: the ref of each, and the channel refs of a device row. */
        targets?: readonly AssignTarget[];
        /** The one row's address when exactly one is selected - the name field is its; `''` otherwise. */
        address?: string;
        /** Whether that row can be renamed at all - the grid's rule: not `:0`, not a smoke group row. */
        canRename?: boolean;
        /** Where the focus goes when the dialog opens: the side that was asked for, or the name. */
        focus?: TaxonomyId | 'name';
    }

    let {open = $bindable(false), targets = [], address = '', canRename = false, focus = 'room'}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;
    const taxonomy = stores.taxonomy;

    const none = (): States => ({room: {}, function: {}});
    /** Every box as it was when the dialog opened - and, for a node whose save went through, since. */
    let initial = $state<States>(none());
    /** What the user made of each box. */
    let desired = $state<States>(none());
    /** The store's refusal of a node's last save, by path. */
    let failures = $state<Failures>({room: {}, function: {}});
    let name = $state('');
    /** Task 65: ticked at every opening - renaming a device names its channels too, unless unticked. */
    let renameChildren = $state(true);
    let nameFailed = $state(false);
    let saving = $state(false);
    let nameInput = $state<HTMLInputElement | undefined>(undefined);
    let roomSide = $state<AssignSide | undefined>(undefined);
    let functionSide = $state<AssignSide | undefined>(undefined);
    let wasOpen = false;

    const showName = $derived(address !== '' && canRename);
    const isDevice = $derived(address !== '' && isDeviceAddress(address));
    const children = $derived(
        isDevice ? stores.devices.channels(stores.app.selectedInterface, address).map((c) => c.ADDRESS) : [],
    );
    const failedCount = $derived(SIDES.reduce((sum, id) => sum + Object.keys(failures[id]).length, 0));

    const lookup = (ref: string) => taxonomy.view(ref);

    function listedPaths(id: TaxonomyId): string[] {
        return taxonomy.options(id).map((option) => option.path);
    }

    /** The nodes of the list plus one made in the dialog whose tree has not arrived yet. */
    function allPaths(id: TaxonomyId): string[] {
        const listed = listedPaths(id);
        return [...listed, ...Object.keys(desired[id]).filter((path) => !listed.includes(path))];
    }

    function stateOf(id: TaxonomyId, path: string): CheckState {
        return desired[id][path] ?? initial[id][path] ?? 'off';
    }

    $effect(() => {
        if (open && !wasOpen) {
            // what the selection is in right now; later changes of the store do not move the boxes
            untrack(() => {
                const opened = none();
                for (const id of SIDES) {
                    opened[id] = membershipStates(targets, listedPaths(id), lookup);
                }
                initial = opened;
                desired = {room: {...opened.room}, function: {...opened.function}};
                failures = {room: {}, function: {}};
                name = address === '' ? '' : (stores.names.name(address) ?? '');
                renameChildren = true;
                nameFailed = false;
                roomSide?.reset();
                functionSide?.reset();
                void focusOpened();
            });
        }
        wasOpen = open;
    });

    /** After the native dialog has opened and put the focus on its first control: the part that was asked for. */
    async function focusOpened(): Promise<void> {
        await tick();
        if (focus === 'name' && showName) {
            nameInput?.focus();
            return;
        }
        (focus === 'function' ? functionSide : roomSide)?.focus();
    }

    /**
     * The name, only when it was changed: the 2.x rule with the `:0` convention (task 65), in core so
     * the rename dialog writes the same - a device renames its `:0` with it and, "overwrite channels"
     * ticked, every other child to `<name>:<channel index>`.
     */
    function plannedRename(): Array<{address: string; name: string}> {
        const next = name.trim();
        if (!showName || next === '' || next === (stores.names.name(address) ?? '')) {
            return [];
        }
        return renameEntries(address, next, children, {channels: renameChildren});
    }

    /**
     * Only the differences: the name through the names store (which reports its own refusal), then one
     * `meta.assign` per changed node of either side. What went through is done; a node the store
     * refused keeps the user's choice and its reason, and the dialog stays open so Apply can send just
     * those again.
     */
    async function save(): Promise<void> {
        if (saving) {
            return;
        }
        saving = true;
        try {
            const rename = plannedRename();
            const nameOk = rename.length === 0 ? true : await stores.names.rename(rename);
            nameFailed = !nameOk;

            const changed: Record<TaxonomyId, string[]> = {room: [], function: []};
            const requests: AssignRequest[] = [];
            for (const id of SIDES) {
                changed[id] = changedPaths(allPaths(id), initial[id], desired[id]);
                requests.push(...assignRequests(targets, changed[id], desired[id], lookup));
            }
            const outcomes = requests.length === 0 ? [] : await taxonomy.assignEach(requests);
            const nextInitial: States = {room: {...initial.room}, function: {...initial.function}};
            const nextFailures: Failures = {room: {}, function: {}};
            for (const id of SIDES) {
                for (const path of changed[id]) {
                    const outcome = outcomes.find((entry) => entry.path === path);
                    if (outcome !== undefined && !outcome.ok) {
                        nextFailures[id][path] = outcome.message;
                    } else {
                        nextInitial[id][path] = stateOf(id, path);
                    }
                }
            }
            initial = nextInitial;
            failures = nextFailures;
            if (nameOk && SIDES.every((id) => Object.keys(nextFailures[id]).length === 0)) {
                open = false;
            }
        } finally {
            saving = false;
        }
    }

    function onNameKeydown(event: KeyboardEvent): void {
        if (event.key === 'Enter') {
            event.preventDefault();
            void save();
        }
    }
</script>

<Dialog
    bind:open
    title={t('Rooms and functions')}
    width="760px"
    minWidth={320}
    closable={!saving}
    closeLabel={t('Close')}
    testId="assign-dialog"
>
    {#if address !== ''}
        <p class="hmm-assign-address" data-testid="assign-address">{address}</p>
    {/if}
    {#if showName}
        <div class="hmm-assign-name-row">
            <label class="hmm-assign-name-field">
                <span>{t('Name')}</span>
                <input
                    class="hmm-input"
                    bind:this={nameInput}
                    bind:value={name}
                    disabled={saving}
                    data-testid="assign-name"
                    onkeydown={onNameKeydown}
                />
            </label>
            {#if isDevice}
                <label class="hmm-assign-children">
                    <input
                        type="checkbox"
                        bind:checked={renameChildren}
                        disabled={saving}
                        data-testid="assign-rename-children"
                    />
                    <span>{t('Overwrite channel names')}</span>
                </label>
            {/if}
        </div>
        {#if nameFailed}
            <p class="hmm-assign-summary hmm-assign-name-error" role="alert" data-testid="assign-name-error">
                {t('The name was not saved')}
            </p>
        {/if}
    {/if}
    <p class="hmm-assign-count" data-testid="assign-count">{t('{count} rows selected', {}, targets.length)}</p>

    <div class="hmm-assign-sides">
        <AssignSide
            bind:this={roomSide}
            enumId="room"
            initial={initial.room}
            bind:desired={desired.room}
            bind:failures={failures.room}
            {saving}
            onsave={() => void save()}
        />
        <AssignSide
            bind:this={functionSide}
            enumId="function"
            initial={initial.function}
            bind:desired={desired.function}
            bind:failures={failures.function}
            {saving}
            onsave={() => void save()}
        />
    </div>

    {#if failedCount > 0}
        <p class="hmm-assign-summary" role="alert" data-testid="assign-summary">
            {t('{count} changes were not saved', {}, failedCount)}
        </p>
    {/if}

    {#snippet buttons()}
        <button type="button" class="hmm-button" disabled={saving} onclick={() => (open = false)}>{t('Cancel')}</button>
        <button
            type="button"
            class="hmm-button"
            disabled={saving || targets.length === 0}
            data-testid="assign-apply"
            onclick={() => void save()}>{t('Apply')}</button
        >
    {/snippet}
</Dialog>

<style>
    .hmm-assign-address {
        margin: 0 0 6px;
        font-family: var(--hmm-font-mono);
        color: var(--hmm-fg-muted);
    }

    .hmm-assign-name-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px 12px;
        margin-bottom: 8px;
    }

    .hmm-assign-name-field {
        display: flex;
        flex: 1 1 240px;
        align-items: center;
        gap: 8px;
        min-width: 0;
    }

    .hmm-assign-name-field input {
        flex: 1 1 auto;
        min-width: 0;
    }

    .hmm-assign-children {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .hmm-assign-count {
        margin: 0 0 8px;
        color: var(--hmm-fg-muted);
    }

    /* The two halves side by side, each at least 260 px wide, and one above the other when the dialog
       is too narrow for both - a phone (the halves wrap in source order: rooms, then functions). They
       shrink with a short window so their lists scroll; the element in the selector outweighs the
       dialog body's "children keep their height" rule. */
    div.hmm-assign-sides {
        display: flex;
        flex: 0 1 auto;
        flex-wrap: wrap;
        gap: 10px 12px;
        min-height: 0;
    }

    .hmm-assign-summary {
        margin: 8px 0 0;
        color: var(--hmm-error);
    }

    .hmm-assign-name-error {
        margin: 0 0 8px;
    }
</style>
