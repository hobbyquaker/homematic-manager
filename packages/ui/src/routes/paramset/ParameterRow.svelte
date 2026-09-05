<script lang="ts">
    import type {ParamsetValue} from '@homematic-manager/core';
    import {fromDisplayValue, toDisplayValue} from '@homematic-manager/core';

    import type {FormField} from '../../lib/util/paramsetForm.js';

    interface Props {
        field: FormField;
        /** The value as the device stores it - not the displayed one. */
        value: unknown;
        label: string;
        /** Help text of the CCU's own string table, already stripped of its markup. */
        help?: string | undefined;
        /** Translates one enum name or preset label. */
        valueLabel?: ((value: string) => string) | undefined;
        /** A `setValue` button next to the control - the VALUES paramset has one per datapoint. */
        onset?: (() => void) | undefined;
        onchange: (value: ParamsetValue) => void;
        /** Marked when the value differs from what the device answered with. */
        changed?: boolean;
        disabled?: boolean;
    }

    let {
        field,
        value,
        label,
        help = undefined,
        valueLabel = undefined,
        onset = undefined,
        onchange,
        changed = false,
        disabled = false,
    }: Props = $props();

    const readOnly = $derived(disabled || !field.writable);
    const numeric = $derived(field.kind === 'integer' || field.kind === 'float');
    const shown = $derived(numeric ? toDisplayValue(asNumber(value), field.description) : value);
    const text = $derived(shown === undefined || shown === null ? '' : String(shown));
    const enumIndex = $derived(asNumber(value) ?? -1);
    /** `NOT_USED` and friends: a value outside MIN..MAX that means something (#96). */
    const activeSpecial = $derived(field.special.find((special) => special.VALUE === asNumber(value)));

    function asNumber(input: unknown): number | undefined {
        if (typeof input === 'number') {
            return input;
        }
        if (typeof input === 'string' && input.trim() !== '' && Number.isFinite(Number(input))) {
            return Number(input);
        }
        return undefined;
    }

    function changeNumber(raw: string): void {
        if (raw === '') {
            return;
        }
        const stored = fromDisplayValue(Number(raw), field.description);
        if (stored !== undefined && Number.isFinite(stored)) {
            onchange(stored);
        }
    }

    function labelOf(entry: string): string {
        return valueLabel ? valueLabel(entry) : entry;
    }
</script>

<div class="hmm-param" class:hmm-param-changed={changed} data-testid={`param-${field.name}`}>
    <div class="hmm-param-label">
        <span title={field.name}>{label}</span>
        <span class="hmm-param-id">{field.name}</span>
    </div>

    <div class="hmm-param-control">
        {#if field.kind === 'bool' || field.kind === 'action'}
            <input
                type="checkbox"
                checked={value === true || value === 'true' || value === 1}
                disabled={readOnly}
                aria-label={label}
                onchange={(event) => onchange(event.currentTarget.checked)}
            />
        {:else if field.kind === 'enum'}
            <select
                class="hmm-select"
                disabled={readOnly}
                aria-label={label}
                value={String(enumIndex)}
                onchange={(event) => onchange(Number(event.currentTarget.value))}
            >
                {#each field.valueList ?? [] as entry, index (entry)}
                    <option value={String(index)}>{labelOf(entry)}</option>
                {/each}
            </select>
        {:else if numeric}
            <input
                class="hmm-input hmm-param-number"
                type="number"
                min={field.min}
                max={field.max}
                step={field.step}
                disabled={readOnly || activeSpecial !== undefined}
                aria-label={label}
                value={text}
                oninput={(event) => changeNumber(event.currentTarget.value)}
            />
            {#if field.special.length > 0}
                <select
                    class="hmm-select hmm-param-special"
                    disabled={readOnly}
                    aria-label={`${label} SPECIAL`}
                    value={activeSpecial?.ID ?? ''}
                    onchange={(event) => {
                        const chosen = field.special.find((special) => special.ID === event.currentTarget.value);
                        onchange(chosen ? chosen.VALUE : (field.min ?? 0));
                    }}
                >
                    <option value="">—</option>
                    {#each field.special as special (special.ID)}
                        <option value={special.ID}>{labelOf(special.ID)}</option>
                    {/each}
                </select>
            {/if}
            {#if field.preset}
                <select
                    class="hmm-select hmm-param-preset"
                    disabled={readOnly}
                    aria-label={`${label} presets`}
                    value=""
                    onchange={(event) => {
                        const entry = field.preset?.presets.find(
                            (candidate) => String(candidate.value) === event.currentTarget.value,
                        );
                        if (entry !== undefined) {
                            onchange(entry.value);
                        }
                    }}
                >
                    <option value="">…</option>
                    {#each field.preset.presets as entry (String(entry.value))}
                        <option value={String(entry.value)}>{entry.label ?? labelOf(entry.labelKey ?? '')}</option>
                    {/each}
                </select>
            {/if}
        {:else}
            <input
                class="hmm-input hmm-param-text"
                type="text"
                disabled={readOnly}
                aria-label={label}
                value={text}
                oninput={(event) => onchange(event.currentTarget.value)}
            />
        {/if}

        {#if field.unit !== ''}<span class="hmm-param-unit">{field.unit}</span>{/if}

        {#if onset}
            <button
                type="button"
                class="hmm-button hmm-param-set"
                disabled={readOnly}
                data-testid={`set-${field.name}`}
                onclick={() => onset()}>setValue</button
            >
        {/if}
    </div>

    <div class="hmm-param-meta">
        {#if !field.writable}<span class="hmm-param-flag">read-only</span>{/if}
        {#if field.min !== undefined || field.max !== undefined}
            <span>{field.min ?? '−∞'} … {field.max ?? '∞'}</span>
        {/if}
        {#if field.description.DEFAULT !== undefined}
            <span>default {String(field.description.DEFAULT)}</span>
        {/if}
    </div>

    {#if help}
        <p class="hmm-param-help">{help}</p>
    {/if}
</div>

<style>
    .hmm-param {
        display: grid;
        grid-template-columns: 240px minmax(0, 1fr) 200px;
        gap: 8px;
        align-items: center;
        padding: 2px 4px;
        border-bottom: 1px solid var(--hmm-border-muted);
    }

    .hmm-param-changed {
        background: var(--hmm-accent-bg);
    }

    .hmm-param-label {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }

    .hmm-param-id {
        font-family: var(--hmm-font-mono);
        font-size: var(--hmm-font-size-small);
        color: var(--hmm-fg-faint);
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .hmm-param-control {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
    }

    .hmm-param-number {
        width: 110px;
    }

    .hmm-param-text {
        flex: 1 1 auto;
        min-width: 0;
    }

    .hmm-param-special,
    .hmm-param-preset {
        max-width: 130px;
    }

    .hmm-param-unit {
        color: var(--hmm-fg-muted);
    }

    .hmm-param-set {
        margin-left: auto;
    }

    .hmm-param-meta {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        color: var(--hmm-fg-muted);
        font-size: var(--hmm-font-size-small);
        white-space: nowrap;
    }

    .hmm-param-flag {
        color: var(--hmm-warn);
    }

    .hmm-param-help {
        grid-column: 1 / -1;
        margin: 0 0 4px;
        color: var(--hmm-fg-muted);
        font-size: var(--hmm-font-size-small);
    }
</style>
