<script lang="ts">
    import {filterOptions, step, type MultiSelectOption} from './multiSelect.js';

    interface Props {
        options: MultiSelectOption[];
        selected?: string[];
        /** Single selection, which is what the 2.x interface picker used the widget for. */
        multiple?: boolean;
        placeholder?: string;
        filterLabel?: string;
        checkAllLabel?: string;
        uncheckAllLabel?: string;
        /** `{count} channels selected` - a message key is not assumed, the caller formats it. */
        summary?: ((selected: string[], options: MultiSelectOption[]) => string) | undefined;
        disabled?: boolean;
        label?: string | undefined;
        onchange?: ((selected: string[]) => void) | undefined;
        testId?: string | undefined;
        /**
         * Task 81: the open list takes its place in the page instead of floating over it, so a dialog
         * that is as tall as its content grows while the list is open rather than scrolling it away.
         * The widget's box dissolves into its parent (`display: contents`): the parent is a wrapping
         * flex row, the trigger sits in it with whatever follows, and the list claims a line of its
         * own under them.
         */
        inline?: boolean;
    }

    let {
        options,
        selected = $bindable([]),
        multiple = true,
        placeholder = '',
        filterLabel = 'Filter',
        checkAllLabel = 'Check all',
        uncheckAllLabel = 'Uncheck all',
        summary = undefined,
        disabled = false,
        label = undefined,
        onchange = undefined,
        testId = undefined,
        inline = false,
    }: Props = $props();

    let open = $state(false);
    let filter = $state('');
    let root = $state<HTMLDivElement | undefined>(undefined);
    let trigger = $state<HTMLButtonElement | undefined>(undefined);
    let list = $state<HTMLUListElement | undefined>(undefined);
    // the keyboard's row (openccu-lite's port of this widget brought it back, one kit): ↑/↓ move
    // it, Enter chooses it, aria-activedescendant names it
    let highlight = $state(0);
    const uid = `hmm-multiselect-${Math.random().toString(36).slice(2, 8)}`;

    const selectedSet = $derived(new Set(selected));
    const shown = $derived(filterOptions(options, filter));
    const activeId = $derived(open && shown[highlight] ? `${uid}-${highlight}` : undefined);
    const buttonText = $derived.by(() => {
        if (selected.length === 0) {
            return placeholder;
        }
        if (summary) {
            return summary(selected, options);
        }
        if (selected.length === 1) {
            return options.find((option) => option.value === selected[0])?.label ?? selected[0] ?? '';
        }
        return `${selected.length}`;
    });

    function apply(next: string[]): void {
        selected = next;
        onchange?.(next);
    }

    function show(): void {
        const first = shown.findIndex((option) => selectedSet.has(option.value));
        highlight = first < 0 ? 0 : first;
        open = true;
    }

    /** Closes; `refocus` puts the focus back on the trigger (Escape, a choice). */
    function hide(refocus: boolean): void {
        open = false;
        if (refocus) {
            trigger?.focus();
        }
    }

    function toggle(option: MultiSelectOption): void {
        if (option.disabled === true) {
            return;
        }
        if (!multiple) {
            apply([option.value]);
            hide(true);
            return;
        }
        apply(
            selectedSet.has(option.value)
                ? selected.filter((value) => value !== option.value)
                : [...selected, option.value],
        );
    }

    function checkAll(): void {
        apply(shown.filter((option) => option.disabled !== true).map((option) => option.value));
    }

    function uncheckAll(): void {
        apply([]);
    }

    /**
     * Replaces jquery-ui-multiselect-widget, which is unmaintained since 2018 and was the reason
     * the interface picker and the "which channels do I write to" list needed jQuery UI at all.
     * Same three affordances: a filter box, check all / uncheck all, and a summary on the button.
     */
    function onWindowPointerDown(event: MouseEvent): void {
        if (open && root && event.target instanceof Node && !root.contains(event.target)) {
            open = false;
        }
    }

    // the filter narrows the list; the highlight goes back to its top
    $effect(() => {
        void filter;
        highlight = 0;
    });
    // the highlighted row stays in view while the arrow keys walk a long list
    $effect(() => {
        if (!open || !list) {
            return;
        }
        const row = list.querySelector<HTMLElement>(`#${uid}-${highlight}`);
        if (typeof row?.scrollIntoView === 'function') {
            row.scrollIntoView({block: 'nearest'});
        }
    });

    /** Keys on the filter input: ↑/↓ move the highlight, Enter chooses, Escape closes without
     *  choosing and returns the focus to the trigger, Tab closes. */
    function onKey(event: KeyboardEvent): void {
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                highlight = step(shown, highlight, 1);
                break;
            case 'ArrowUp':
                event.preventDefault();
                highlight = step(shown, highlight, -1);
                break;
            case 'Enter': {
                event.preventDefault();
                const option = shown[highlight];
                if (option) {
                    toggle(option);
                }
                break;
            }
            case 'Escape':
                event.preventDefault();
                event.stopPropagation();
                hide(true);
                break;
            case 'Tab':
                hide(false);
                break;
            default:
        }
    }

    // ↓ on the closed trigger opens, as a native select does
    function onTriggerKey(event: KeyboardEvent): void {
        if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            show();
        }
    }

    function onWindowKey(event: KeyboardEvent): void {
        if (event.key === 'Escape' && open) {
            hide(true);
        }
    }

    /** Task 31: only an entry that brings a hint or a description is drawn on two lines. */
    function twoLines(option: MultiSelectOption): boolean {
        return Boolean(option.hint) || Boolean(option.description);
    }

    function autofocus(element: HTMLInputElement): void {
        element.focus();
    }
</script>

<svelte:window onmousedown={onWindowPointerDown} onkeydown={onWindowKey} />

<div class="hmm-multiselect" class:hmm-multiselect-inline={inline} bind:this={root} data-testid={testId}>
    <button
        type="button"
        class="hmm-button hmm-multiselect-button"
        bind:this={trigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${uid}-list`}
        aria-label={label}
        {disabled}
        onclick={() => (open ? hide(true) : show())}
        onkeydown={onTriggerKey}
    >
        <span class="hmm-multiselect-text">{buttonText}</span>
        <span class="hmm-multiselect-arrow" aria-hidden="true">▾</span>
    </button>

    {#if open}
        <div class="hmm-multiselect-menu">
            <div class="hmm-multiselect-head">
                <input
                    class="hmm-input hmm-multiselect-filter"
                    type="search"
                    bind:value={filter}
                    placeholder={filterLabel}
                    aria-label={filterLabel}
                    aria-controls={`${uid}-list`}
                    aria-activedescendant={activeId}
                    autocomplete="off"
                    use:autofocus
                    onkeydown={onKey}
                />
                {#if multiple}
                    <button type="button" class="hmm-multiselect-link" onclick={checkAll}>{checkAllLabel}</button>
                    <button type="button" class="hmm-multiselect-link" onclick={uncheckAll}>{uncheckAllLabel}</button>
                {/if}
            </div>
            <ul
                class="hmm-multiselect-list"
                role="listbox"
                aria-multiselectable={multiple}
                id={`${uid}-list`}
                aria-label={label}
                bind:this={list}
            >
                {#each shown as option, i (option.value)}
                    <li>
                        <button
                            type="button"
                            id={`${uid}-${i}`}
                            class="hmm-multiselect-option"
                            class:hmm-multiselect-two-lines={twoLines(option)}
                            class:hmm-multiselect-selected={selectedSet.has(option.value)}
                            class:hmm-multiselect-highlight={i === highlight}
                            role="option"
                            aria-selected={selectedSet.has(option.value)}
                            disabled={option.disabled === true}
                            tabindex="-1"
                            onmousedown={(event) => event.preventDefault()}
                            onmousemove={() => (highlight = i)}
                            onclick={() => toggle(option)}
                        >
                            {#if multiple}
                                <span class="hmm-multiselect-check" aria-hidden="true"
                                    >{selectedSet.has(option.value) ? '☑' : '☐'}</span
                                >
                            {/if}
                            {#if twoLines(option)}
                                <span class="hmm-multiselect-lines">
                                    <span
                                        class="hmm-multiselect-line"
                                        title={[option.label, option.hint].filter(Boolean).join(' ')}
                                    >
                                        <span class="hmm-multiselect-label">{option.label}</span>
                                        {#if option.hint}
                                            <span class="hmm-multiselect-hint">{option.hint}</span>
                                        {/if}
                                    </span>
                                    {#if option.description}
                                        <span class="hmm-multiselect-description" title={option.description}
                                            >{option.description}</span
                                        >
                                    {/if}
                                </span>
                            {:else}
                                <span>{option.label}</span>
                            {/if}
                        </button>
                    </li>
                {/each}
                {#if shown.length === 0}
                    <li class="hmm-multiselect-empty">—</li>
                {/if}
            </ul>
        </div>
    {/if}
</div>

<style>
    .hmm-multiselect {
        position: relative;
        display: inline-block;
        max-width: 100%;
    }

    /* The summary can be arbitrarily long (it is a list of names); the button ellipsises it
       instead of widening the row it sits in. */
    .hmm-multiselect-button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-width: 120px;
        max-width: 100%;
        justify-content: space-between;
    }

    .hmm-multiselect-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .hmm-multiselect-menu {
        position: absolute;
        z-index: 50;
        top: calc(100% + 2px);
        left: 0;
        /* a caller whose entries need more room says so through the properties (task 31) */
        min-width: var(--hmm-multiselect-menu-min-width, 220px);
        max-width: var(--hmm-multiselect-menu-max-width, 360px);
        border: 1px solid var(--hmm-border-strong);
        border-radius: var(--hmm-radius);
        background: var(--hmm-bg);
        box-shadow: var(--hmm-shadow-menu);
    }

    /* Task 81: see the `inline` property. The trigger and the list become items of the parent's
       wrapping flex row; the list comes last and fills a line of its own. */
    .hmm-multiselect-inline {
        display: contents;
    }

    .hmm-multiselect-inline .hmm-multiselect-menu {
        position: static;
        order: 1;
        flex: 1 0 100%;
        box-shadow: none;
    }

    .hmm-multiselect-head {
        display: flex;
        gap: 4px;
        align-items: center;
        padding: 4px;
        border-bottom: 1px solid var(--hmm-border-muted);
    }

    .hmm-multiselect-filter {
        flex: 1 1 auto;
        min-width: 60px;
    }

    .hmm-multiselect-link {
        border: none;
        background: none;
        color: var(--hmm-link);
        cursor: pointer;
        text-decoration: underline;
        font-size: var(--hmm-font-size-small);
        padding: 0 2px;
    }

    .hmm-multiselect-list {
        list-style: none;
        margin: 0;
        padding: 0;
        /* a dialog with room for more rows says so through the property (task 30) */
        max-height: var(--hmm-multiselect-list-height, 260px);
        overflow: auto;
    }

    .hmm-multiselect-option {
        display: flex;
        gap: 6px;
        align-items: center;
        width: 100%;
        padding: 2px 6px;
        border: none;
        background: none;
        font: inherit;
        text-align: left;
        cursor: pointer;
    }

    /* Task 31: label and hint on the first line, the description under them. The checkbox stays
       centred on both lines through the row's own `align-items`. Every line is cut with an
       ellipsis rather than wrapped, and the hint gives way before the label does. */
    .hmm-multiselect-two-lines {
        padding: 4px 8px;
    }

    .hmm-multiselect-lines {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-width: 0;
    }

    .hmm-multiselect-line {
        display: flex;
        align-items: baseline;
        gap: 6px;
        min-width: 0;
        white-space: nowrap;
    }

    .hmm-multiselect-label {
        flex: 0 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    /* The hint only gets what the label leaves: a basis of 0 means the channel name is cut only
       when it alone is wider than the line. */
    .hmm-multiselect-hint {
        flex: 1 1 0;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: var(--hmm-font-size-small);
        color: var(--hmm-fg-muted);
    }

    .hmm-multiselect-description {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: var(--hmm-font-mono);
        font-size: var(--hmm-font-size-small);
        color: var(--hmm-fg-muted);
    }

    .hmm-multiselect-option:hover:not(:disabled),
    .hmm-multiselect-highlight:not(:disabled) {
        background: var(--hmm-row-hover);
    }

    .hmm-multiselect-selected {
        background: var(--hmm-row-selected);
        color: var(--hmm-row-selected-text);
    }

    .hmm-multiselect-option:disabled {
        opacity: 0.45;
        cursor: default;
    }

    .hmm-multiselect-empty {
        padding: 4px 6px;
        color: var(--hmm-fg-muted);
    }
</style>
