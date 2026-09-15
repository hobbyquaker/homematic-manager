<script lang="ts">
    import {tick, untrack} from 'svelte';

    import Dialog from '../../lib/components/Dialog.svelte';
    import {getStores} from '../../lib/stores/context.js';
    import {
        FILTER_THRESHOLD,
        assignRequests,
        changedPaths,
        filterOptions,
        membershipStates,
        nextState,
        type AssignTarget,
        type CheckState,
    } from '../../lib/util/assignment.js';
    import type {TaxonomyId} from '../../lib/util/taxonomy.js';

    interface Props {
        open?: boolean;
        /** Which taxonomy the dialog assigns to; the title and the list follow it. */
        enumId?: TaxonomyId;
        /** The selected rows: the ref of each, and the channel refs of a device row. */
        targets?: readonly AssignTarget[];
    }

    let {open = $bindable(false), enumId = 'room', targets = []}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;
    const taxonomy = stores.taxonomy;

    /** Every box as it was when the dialog opened - and, for a node whose save went through, since. */
    let initial = $state<Record<string, CheckState>>({});
    /** What the user made of each box. */
    let desired = $state<Record<string, CheckState>>({});
    /** The store's refusal of a node's last save, by path. */
    let failures = $state<Record<string, string>>({});
    let query = $state('');
    let saving = $state(false);
    let naming = $state(false);
    let newName = $state('');
    let creatingNode = $state(false);
    let listElement = $state<HTMLElement | undefined>(undefined);
    let nameInput = $state<HTMLInputElement | undefined>(undefined);
    /** The list's height when the filter was first used: a filtered list does not shrink the dialog (D-34). */
    let lockedHeight = $state<number | undefined>(undefined);
    let wasOpen = false;

    const options = $derived(taxonomy.options(enumId));
    const visible = $derived(filterOptions(options, query));
    const showFilter = $derived(options.length > FILTER_THRESHOLD);
    const failedCount = $derived(Object.keys(failures).length);
    const isRoom = $derived(enumId === 'room');
    const title = $derived(isRoom ? t('Assign to room') : t('Assign to function'));

    const lookup = (ref: string) => taxonomy.view(ref);

    /** The nodes of the list plus one made in the dialog whose tree has not arrived yet. */
    function allPaths(): string[] {
        const listed = options.map((option) => option.path);
        return [...listed, ...Object.keys(desired).filter((path) => !listed.includes(path))];
    }

    function stateOf(path: string): CheckState {
        return desired[path] ?? initial[path] ?? 'off';
    }

    $effect(() => {
        if (open && !wasOpen) {
            // what the selection is in right now; later changes of the store do not move the boxes
            untrack(() => {
                initial = membershipStates(
                    targets,
                    options.map((option) => option.path),
                    lookup,
                );
                desired = {...initial};
                failures = {};
                query = '';
                lockedHeight = undefined;
                naming = false;
                newName = '';
            });
        }
        wasOpen = open;
    });

    /** `checked` and `indeterminate` from the state: the second is a property, never an attribute. */
    function checkState(node: HTMLInputElement, state: CheckState): {update: (state: CheckState) => void} {
        const apply = (value: CheckState): void => {
            node.checked = value === 'on';
            node.indeterminate = value === 'mixed';
        };
        apply(state);
        return {update: apply};
    }

    /** A click or Space: the browser has flipped the box already, the cycle decides what it shows. */
    function toggle(path: string, input: HTMLInputElement): void {
        const next = nextState(initial[path] ?? 'off', stateOf(path));
        desired = {...desired, [path]: next};
        if (failures[path] !== undefined) {
            failures = Object.fromEntries(Object.entries(failures).filter(([key]) => key !== path));
        }
        input.checked = next === 'on';
        input.indeterminate = next === 'mixed';
    }

    /**
     * Only the difference, one `meta.assign` per changed node. What went through is done; a node the
     * store refused keeps the user's choice and its reason, and the dialog stays open so Apply can
     * send just those again.
     */
    async function save(): Promise<void> {
        if (saving) {
            return;
        }
        const changed = changedPaths(allPaths(), initial, desired);
        const requests = assignRequests(targets, changed, desired, lookup);
        const outcomes = requests.length === 0 ? [] : await runSave(requests);
        const nextInitial = {...initial};
        const nextFailures: Record<string, string> = {};
        for (const path of changed) {
            const outcome = outcomes.find((entry) => entry.path === path);
            if (outcome !== undefined && !outcome.ok) {
                nextFailures[path] = outcome.message;
            } else {
                nextInitial[path] = stateOf(path);
            }
        }
        initial = nextInitial;
        failures = nextFailures;
        if (Object.keys(nextFailures).length === 0) {
            open = false;
        }
    }

    async function runSave(requests: Parameters<typeof taxonomy.assignEach>[0]) {
        saving = true;
        try {
            return await taxonomy.assignEach(requests);
        } finally {
            saving = false;
        }
    }

    /** Enter on a box saves; Space stays the browser's toggle. */
    function onCheckKeydown(event: KeyboardEvent): void {
        if (event.key === 'Enter') {
            event.preventDefault();
            void save();
        }
    }

    function onFilterInput(event: Event): void {
        // measured before the list changes, so the dialog keeps its height while filtering
        if (lockedHeight === undefined && listElement !== undefined && listElement.offsetHeight > 0) {
            lockedHeight = listElement.offsetHeight;
        }
        query = (event.currentTarget as HTMLInputElement).value;
    }

    /** Enter in the filter never saves and never toggles: it hands the focus to the first box shown. */
    function onFilterKeydown(event: KeyboardEvent): void {
        if (event.key === 'Enter') {
            event.preventDefault();
            listElement?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus();
        }
    }

    async function startNaming(): Promise<void> {
        naming = true;
        await tick();
        nameInput?.focus();
    }

    /** A node at the root, made at once like the metadata editor's; the dialog checks it for Apply. */
    async function createNode(): Promise<void> {
        const name = newName.trim();
        if (name === '' || creatingNode) {
            return;
        }
        creatingNode = true;
        const path = await taxonomy.createNode(enumId, undefined, name);
        creatingNode = false;
        if (path === undefined) {
            return;
        }
        desired = {...desired, [path]: 'on'};
        newName = '';
        naming = false;
        await tick();
        listElement?.querySelector<HTMLInputElement>(`[data-path="${CSS.escape(path)}"] input`)?.focus();
    }

    function onNameKeydown(event: KeyboardEvent): void {
        if (event.key === 'Enter') {
            event.preventDefault();
            void createNode();
        }
    }
</script>

<Dialog bind:open {title} width="560px" closable={!saving} closeLabel={t('Close')} testId="assign-dialog">
    <p class="hmm-assign-count" data-testid="assign-count">{t('{count} rows selected', {}, targets.length)}</p>

    {#if showFilter}
        <input
            type="text"
            class="hmm-input hmm-assign-filter"
            value={query}
            placeholder={isRoom ? t('Filter rooms') : t('Filter functions')}
            aria-label={isRoom ? t('Filter rooms') : t('Filter functions')}
            data-testid="assign-filter"
            oninput={onFilterInput}
            onkeydown={onFilterKeydown}
        />
    {/if}

    <div
        class="hmm-assign-list"
        role="group"
        aria-label={isRoom ? t('Rooms') : t('Functions')}
        style:min-height={lockedHeight === undefined ? undefined : `${String(lockedHeight)}px`}
        bind:this={listElement}
        data-testid="assign-list"
    >
        {#each visible as option (option.path)}
            {@const state = stateOf(option.path)}
            {@const failure = failures[option.path]}
            <label
                class="hmm-assign-row"
                class:hmm-assign-row-failed={failure !== undefined}
                style:padding-inline-start={`${String(6 + (option.depth - 1) * 18)}px`}
                data-testid="assign-row"
                data-path={option.path}
                data-state={state}
            >
                <input
                    type="checkbox"
                    use:checkState={state}
                    disabled={saving}
                    data-testid="assign-check"
                    onchange={(event) => toggle(option.path, event.currentTarget)}
                    onkeydown={onCheckKeydown}
                />
                <span class="hmm-assign-name">{option.label}</span>
                {#if failure !== undefined}
                    <span class="hmm-assign-error" data-testid="assign-error">
                        {t('Not saved: {message}', {message: failure})}
                    </span>
                {/if}
            </label>
        {:else}
            <p class="hmm-assign-empty">
                {options.length > 0 ? t('No match') : isRoom ? t('No rooms yet') : t('No functions yet')}
            </p>
        {/each}
    </div>

    {#if failedCount > 0}
        <p class="hmm-assign-summary" role="alert" data-testid="assign-summary">
            {t('{count} changes were not saved', {}, failedCount)}
        </p>
    {/if}

    <div class="hmm-assign-new">
        {#if naming}
            <input
                type="text"
                class="hmm-input"
                bind:this={nameInput}
                bind:value={newName}
                aria-label={isRoom ? t('Name of the new room') : t('Name of the new function')}
                placeholder={isRoom ? t('Name of the new room') : t('Name of the new function')}
                disabled={creatingNode}
                data-testid="assign-new-name"
                onkeydown={onNameKeydown}
            />
            <button
                type="button"
                class="hmm-button"
                disabled={creatingNode || newName.trim() === ''}
                data-testid="assign-create"
                onclick={() => void createNode()}>{t('Create')}</button
            >
        {:else}
            <button type="button" class="hmm-button" data-testid="assign-new" onclick={() => void startNaming()}
                >{isRoom ? t('New room…') : t('New function…')}</button
            >
        {/if}
    </div>

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
    .hmm-assign-count {
        margin: 0 0 8px;
        color: var(--hmm-fg-muted);
    }

    .hmm-assign-filter {
        box-sizing: border-box;
        width: 100%;
        margin-bottom: 6px;
    }

    /* The one part that scrolls, and only when the window is too short for every node: the element
       in the selector outweighs the dialog body's "children keep their height" rule. */
    div.hmm-assign-list {
        flex: 0 1 auto;
        min-height: 0;
        overflow-y: auto;
        padding: 2px 0;
        border: 1px solid var(--hmm-border);
        border-radius: var(--hmm-radius);
        background: var(--hmm-input-bg);
    }

    .hmm-assign-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 2px 6px;
        padding-block: 2px;
        padding-inline-end: 6px;
        cursor: pointer;
    }

    .hmm-assign-row:hover {
        background: var(--hmm-accent-bg);
    }

    .hmm-assign-row input {
        flex: 0 0 auto;
        margin: 0;
    }

    /* A long name wraps rather than widening the dialog or being cut off. */
    .hmm-assign-name {
        flex: 1 1 0;
        min-width: 0;
        overflow-wrap: anywhere;
    }

    .hmm-assign-error {
        flex: 1 0 100%;
        padding-inline-start: 19px;
        color: var(--hmm-error);
    }

    .hmm-assign-summary {
        margin: 8px 0 0;
        color: var(--hmm-error);
    }

    .hmm-assign-empty {
        margin: 4px 6px;
        color: var(--hmm-fg-muted);
    }

    .hmm-assign-new {
        display: flex;
        gap: 6px;
        margin-top: 8px;
    }

    .hmm-assign-new input {
        flex: 1 1 auto;
        min-width: 0;
    }
</style>
