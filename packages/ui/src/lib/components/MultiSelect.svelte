<script lang="ts">
    import {filterOptions, type MultiSelectOption} from './multiSelect.js';

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
    }: Props = $props();

    let open = $state(false);
    let filter = $state('');
    let root = $state<HTMLDivElement | undefined>(undefined);

    const selectedSet = $derived(new Set(selected));
    const shown = $derived(filterOptions(options, filter));
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

    function toggle(option: MultiSelectOption): void {
        if (option.disabled === true) {
            return;
        }
        if (!multiple) {
            apply([option.value]);
            open = false;
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
</script>

<svelte:window onmousedown={onWindowPointerDown} />

<div class="hmm-multiselect" bind:this={root} data-testid={testId}>
    <button
        type="button"
        class="hmm-button hmm-multiselect-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        {disabled}
        onclick={() => (open = !open)}
    >
        <span class="hmm-multiselect-text">{buttonText}</span>
        <span class="hmm-multiselect-arrow" aria-hidden="true">▾</span>
    </button>

    {#if open}
        <div class="hmm-multiselect-menu" role="listbox" aria-multiselectable={multiple}>
            <div class="hmm-multiselect-head">
                <input
                    class="hmm-input hmm-multiselect-filter"
                    type="search"
                    bind:value={filter}
                    placeholder={filterLabel}
                    aria-label={filterLabel}
                />
                {#if multiple}
                    <button type="button" class="hmm-multiselect-link" onclick={checkAll}>{checkAllLabel}</button>
                    <button type="button" class="hmm-multiselect-link" onclick={uncheckAll}>{uncheckAllLabel}</button>
                {/if}
            </div>
            <ul class="hmm-multiselect-list">
                {#each shown as option (option.value)}
                    <li>
                        <button
                            type="button"
                            class="hmm-multiselect-option"
                            class:hmm-multiselect-selected={selectedSet.has(option.value)}
                            role="option"
                            aria-selected={selectedSet.has(option.value)}
                            disabled={option.disabled === true}
                            onclick={() => toggle(option)}
                        >
                            {#if multiple}
                                <span class="hmm-multiselect-check" aria-hidden="true"
                                    >{selectedSet.has(option.value) ? '☑' : '☐'}</span
                                >
                            {/if}
                            <span>{option.label}</span>
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
    }

    .hmm-multiselect-button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-width: 120px;
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
        min-width: 220px;
        max-width: 360px;
        border: 1px solid var(--hmm-border-strong);
        border-radius: var(--hmm-radius);
        background: var(--hmm-bg);
        box-shadow: var(--hmm-shadow-menu);
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
        max-height: 260px;
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

    .hmm-multiselect-option:hover:not(:disabled) {
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
