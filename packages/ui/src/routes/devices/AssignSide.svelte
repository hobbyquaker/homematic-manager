<script lang="ts">
    import {tick} from 'svelte';

    import {getStores} from '../../lib/stores/context.js';
    import {FILTER_THRESHOLD, filterOptions, nextState, type CheckState} from '../../lib/util/assignment.js';
    import type {TaxonomyId} from '../../lib/util/taxonomy.js';

    /**
     * Task 86: one half of the rooms-and-functions dialog - the checkbox list of one taxonomy with
     * its filter and its "New room…" row, as task 49's dialog drew it for one taxonomy at a time. The
     * dialog owns what the boxes were and what the user made of them, and saves both halves in one
     * go; this half only shows and toggles.
     */

    interface Props {
        enumId: TaxonomyId;
        /** Every box as it was when the dialog opened - and, for a node whose save went through, since. */
        initial: Readonly<Record<string, CheckState>>;
        /** What the user made of each box. */
        desired: Record<string, CheckState>;
        /** The store's refusal of a node's last save, by path. */
        failures: Record<string, string>;
        saving: boolean;
        /** Enter on a box: the dialog saves everything. */
        onsave: () => void;
    }

    let {enumId, initial, desired = $bindable(), failures = $bindable(), saving, onsave}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;
    const taxonomy = stores.taxonomy;

    let query = $state('');
    let naming = $state(false);
    let newName = $state('');
    let creatingNode = $state(false);
    let listElement = $state<HTMLElement | undefined>(undefined);
    let filterElement = $state<HTMLInputElement | undefined>(undefined);
    let nameInput = $state<HTMLInputElement | undefined>(undefined);
    /** The list's height when the filter was first used: a filtered list does not shrink the dialog (D-34). */
    let lockedHeight = $state<number | undefined>(undefined);

    const options = $derived(taxonomy.options(enumId));
    const visible = $derived(filterOptions(options, query));
    const showFilter = $derived(options.length > FILTER_THRESHOLD);
    const isRoom = $derived(enumId === 'room');

    /** Back to how the dialog opens: no filter, no new name being typed. */
    export function reset(): void {
        query = '';
        lockedHeight = undefined;
        naming = false;
        newName = '';
    }

    /** The filter when there is one, else the first box: where the pointer or the key came from. */
    export function focus(): void {
        if (filterElement !== undefined) {
            filterElement.focus();
            return;
        }
        listElement?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus();
    }

    function stateOf(path: string): CheckState {
        return desired[path] ?? initial[path] ?? 'off';
    }

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

    /** Enter on a box saves; Space stays the browser's toggle. */
    function onCheckKeydown(event: KeyboardEvent): void {
        if (event.key === 'Enter') {
            event.preventDefault();
            onsave();
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

<section
    class="hmm-assign-side"
    aria-label={isRoom ? t('Rooms') : t('Functions')}
    data-testid={`assign-side-${enumId}`}
>
    <h3 class="hmm-assign-heading">{isRoom ? t('Rooms') : t('Functions')}</h3>

    {#if showFilter}
        <input
            type="text"
            class="hmm-input hmm-assign-filter"
            value={query}
            placeholder={isRoom ? t('Filter rooms') : t('Filter functions')}
            aria-label={isRoom ? t('Filter rooms') : t('Filter functions')}
            data-testid={`assign-filter-${enumId}`}
            bind:this={filterElement}
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
        data-testid={`assign-list-${enumId}`}
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
            <p class="hmm-assign-empty" data-testid={`assign-empty-${enumId}`}>
                {options.length > 0 ? t('No match') : isRoom ? t('No rooms yet') : t('No functions yet')}
            </p>
        {/each}
    </div>

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
                data-testid={`assign-new-name-${enumId}`}
                onkeydown={onNameKeydown}
            />
            <button
                type="button"
                class="hmm-button"
                disabled={creatingNode || newName.trim() === ''}
                data-testid={`assign-create-${enumId}`}
                onclick={() => void createNode()}>{t('Create')}</button
            >
        {:else}
            <button
                type="button"
                class="hmm-button"
                data-testid={`assign-new-${enumId}`}
                onclick={() => void startNaming()}>{isRoom ? t('New room…') : t('New function…')}</button
            >
        {/if}
    </div>
</section>

<style>
    /* One half: as wide as half the dialog, and a whole line of its own when the dialog is too narrow
       for two (a phone), where the halves stack - rooms above functions, in source order. */
    .hmm-assign-side {
        display: flex;
        flex: 1 1 260px;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
    }

    .hmm-assign-heading {
        margin: 0 0 4px;
        font-size: inherit;
        font-weight: 600;
    }

    .hmm-assign-filter {
        box-sizing: border-box;
        width: 100%;
        margin-bottom: 6px;
    }

    /* The one part that scrolls, and only when the window is too short for every node. */
    .hmm-assign-list {
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
