<script lang="ts">
    import type {ParamsetValue} from '@homematic-manager/core';
    import {fromDisplayValue, toDisplayValue} from '@homematic-manager/core';

    import {getStores} from '../../lib/stores/context.js';
    import type {FormField} from '../../lib/util/paramsetForm.js';

    interface Props {
        field: FormField;
        /** The value as the device stores it - not the displayed one. */
        value: unknown;
        label: string;
        /** Help text of the CCU's own string table, already stripped of its markup. */
        help?: string | undefined;
        /** Translates one enum name. */
        valueLabel?: ((value: string) => string) | undefined;
        /**
         * Translates a preset's `labelKey`, a WebUI label key (`Translations.uiLabels`) - not an enum
         * name, so `valueLabel` would not find it and show the key itself.
         */
        presetLabel?: ((key: string) => string) | undefined;
        /** A `setValue` button next to the control - the VALUES paramset has one per datapoint. */
        onset?: (() => void) | undefined;
        onchange: (value: ParamsetValue) => void;
        /** Marked when the value differs from what the device answered with. */
        changed?: boolean;
        disabled?: boolean;
        /**
         * Task 26: on channel 0 of an HmIP interface a service datapoint has a "suppressed"
         * checkbox at the right of its row - `getSuppressedServiceMessages` says what it holds,
         * and the dialog's Apply button sends the change. Absent on every other row.
         */
        suppressed?: boolean | undefined;
        onsuppress?: ((suppressed: boolean) => void) | undefined;
        /** The checkbox text and its tooltip, translated by the dialog. */
        suppressLabel?: string;
        suppressTitle?: string | undefined;
        /** The checkbox differs from what the interface reports - not yet applied. */
        suppressChanged?: boolean;
    }

    let {
        field,
        value,
        label,
        help = undefined,
        valueLabel = undefined,
        presetLabel = undefined,
        onset = undefined,
        onchange,
        changed = false,
        disabled = false,
        suppressed = undefined,
        onsuppress = undefined,
        suppressLabel = '',
        suppressTitle = undefined,
        suppressChanged = false,
    }: Props = $props();

    const t = getStores().i18n.t;

    const readOnly = $derived(disabled || !field.writable);
    const numeric = $derived(field.kind === 'integer' || field.kind === 'float');
    const shown = $derived(numeric ? toDisplayValue(asNumber(value), field.description) : value);
    const text = $derived(shown === undefined || shown === null ? '' : String(shown));
    const enumIndex = $derived(asNumber(value) ?? -1);
    /** `NOT_USED` and friends: a value outside MIN..MAX that means something (#96). */
    const activeSpecial = $derived(field.special.find((special) => special.VALUE === asNumber(value)));
    /**
     * B-75: a parameter nobody translated has its name as the label - then the name is printed
     * once, not as label and identifier both.
     */
    const translated = $derived(label !== field.name);

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

<!--
    Task 77: a row of the parameter table (`.hmm-param-table` in app.css) - a subgrid, its cells
    placed by column so a row without a setValue button or a range leaves that column empty
    rather than shifting the cells after it. The help text is a second line under all of them.
-->
<div
    class="hmm-param hmm-param-table-row"
    class:hmm-param-changed={changed || suppressChanged}
    data-testid={`param-${field.name}`}
>
    <div class="hmm-param-label">
        <span title={field.name}>{label}</span>
        {#if translated}<span class="hmm-param-id">{field.name}</span>{/if}
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
                class="hmm-select hmm-param-enum"
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
                        <option value={String(entry.value)}
                            >{entry.label ?? (presetLabel ?? labelOf)(entry.labelKey ?? '')}</option
                        >
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
    </div>

    {#if onset}
        <div class="hmm-param-set">
            <button
                type="button"
                class="hmm-button"
                disabled={readOnly}
                data-testid={`set-${field.name}`}
                onclick={() => onset()}>setValue</button
            >
        </div>
    {/if}

    {#if onsuppress}
        <label class="hmm-param-suppress" title={suppressTitle}>
            <input
                type="checkbox"
                checked={suppressed === true}
                data-testid={`suppress-${field.name}`}
                onchange={(event) => onsuppress(event.currentTarget.checked)}
            />
            <span>{suppressLabel}</span>
        </label>
    {/if}

    {#if !field.writable}
        <div class="hmm-param-flag"><span class="hmm-param-ro" title={t('Read-only')}>{t('ro')}</span></div>
    {/if}
    {#if field.min !== undefined || field.max !== undefined}
        <div class="hmm-param-range">{field.min ?? '−∞'} … {field.max ?? '∞'}</div>
    {/if}
    {#if field.description.DEFAULT !== undefined}
        <div class="hmm-param-default">{t('default {value}', {value: String(field.description.DEFAULT)})}</div>
    {/if}

    {#if help}
        <p class="hmm-param-help hmm-param-table-wide">{help}</p>
    {/if}
</div>

<style>
    .hmm-param {
        align-items: center;
        padding: 2px 4px;
        border-bottom: 1px solid var(--hmm-border-muted);
    }

    .hmm-param-changed {
        background: var(--hmm-accent-bg);
    }

    .hmm-param-label {
        display: flex;
        grid-column: 1;
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
        grid-column: 2;
        align-items: center;
        gap: 6px;
        min-width: 0;
        padding-left: 8px;
    }

    /* One width per kind of control, not per content: the rows read as columns. */
    .hmm-param-enum {
        width: 220px;
        max-width: 100%;
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
        width: 130px;
        max-width: 100%;
    }

    .hmm-param-unit {
        color: var(--hmm-fg-muted);
    }

    .hmm-param-set {
        grid-column: 3;
        padding-left: 8px;
    }

    .hmm-param-suppress {
        display: flex;
        grid-column: 4;
        align-items: center;
        gap: 4px;
        padding-left: 10px;
        font-size: var(--hmm-font-size-small);
        white-space: nowrap;
    }

    .hmm-param-flag {
        grid-column: 5;
        padding-left: 10px;
    }

    .hmm-param-range,
    .hmm-param-default {
        padding-left: 10px;
        color: var(--hmm-fg-muted);
        font-size: var(--hmm-font-size-small);
        font-variant-numeric: tabular-nums;
        text-align: right;
        white-space: nowrap;
    }

    .hmm-param-range {
        grid-column: 6;
    }

    .hmm-param-default {
        grid-column: 7;
    }

    .hmm-param-help {
        margin: 0 0 4px;
        color: var(--hmm-fg-muted);
        font-size: var(--hmm-font-size-small);
    }

    /* The narrow layout of app.css: B-63's wrapping line - the name, then the control, then the rest. */
    @container hmm-param-table (max-width: 599px) {
        .hmm-param {
            gap: 2px 0;
        }

        .hmm-param-label {
            flex: 0 1 240px;
        }

        .hmm-param-control {
            flex: 1 1 160px;
        }

        .hmm-param-set,
        .hmm-param-suppress,
        .hmm-param-flag,
        .hmm-param-range,
        .hmm-param-default {
            flex: 0 0 auto;
        }

        .hmm-param-flag {
            margin-left: auto;
        }

        .hmm-param-help {
            flex: 1 0 100%;
        }
    }
</style>
