<script lang="ts">
    import type {ParamsetValue} from '@homematic-manager/core';
    import {fromDisplayValue, presetLabel as presetText, toDisplayValue} from '@homematic-manager/core';

    import {tick} from 'svelte';

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
         * Translates the `${key}`s of a preset's template, WebUI label keys (`Translations.uiLabels`) -
         * not enum names, so `valueLabel` would not find them and show the key itself (B-82).
         */
        presetLabel?: ((key: string) => string) | undefined;
        /** A `setValue` button next to the control - the VALUES paramset has one per datapoint. */
        onset?: (() => void) | undefined;
        onchange: (value: ParamsetValue) => void;
        /** Marked when the value differs from what the device answered with. */
        changed?: boolean;
        disabled?: boolean;
        /**
         * B-80/B-81: the row is the free entry of an easy-mode combo box whose "Enter value" was
         * chosen - a special value then opens as a number too, prefilled like the row's own "Enter
         * value", instead of showing its select alone.
         */
        entry?: boolean;
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
        entry = false,
        suppressed = undefined,
        onsuppress = undefined,
        suppressLabel = '',
        suppressTitle = undefined,
        suppressChanged = false,
    }: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;

    const readOnly = $derived(disabled || !field.writable);
    const numeric = $derived(field.kind === 'integer' || field.kind === 'float');
    const shown = $derived(numeric ? toDisplayValue(asNumber(value), field.description) : value);
    const text = $derived(shown === undefined || shown === null ? '' : String(shown));
    const enumIndex = $derived(asNumber(value) ?? -1);
    /** `NOT_USED` and friends: a value outside MIN..MAX that means something (#96). */
    const activeSpecial = $derived(field.special.find((special) => special.VALUE === asNumber(value)));

    /**
     * B-81: "Enter value" chosen while a special is set. The number opens, prefilled, and nothing is
     * written until the user types - choosing it used to write `MIN` at once, which for "lock
     * automatically" meant "lock immediately". Bound to the value it was chosen on, so a value that
     * changes under it (another link, a profile) is shown as what it is.
     */
    let entering = $state<{on: unknown; draft: number} | undefined>(undefined);
    /** B-80: while a special is chosen, only its select shows - the number and the range are hidden, as in the WebUI. */
    const showSpecial = $derived(
        activeSpecial !== undefined && !entry && (entering === undefined || entering.on !== value),
    );
    let numberInput = $state<HTMLInputElement | undefined>(undefined);
    /** The last plain value this row showed: the prefill when the default is itself a special. */
    let lastPlain: number | undefined;
    $effect(() => {
        const plain = asNumber(value);
        if (plain !== undefined && activeSpecial === undefined) lastPlain = plain;
    });
    /** B-81 (refined): the preset the value is one of, so the dropdown shows it instead of `…`. */
    const matchingPreset = $derived(field.preset?.presets.find((entry) => entry.value === asNumber(value)));
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

    /** B-80: a special's id as the CCU names it - the parameter's own value label, else the bare key. */
    function specialText(id: string): string {
        const own = labelOf(id);
        return own !== id ? own : stores.meta.specialLabel(field.name, id);
    }

    /** A number the free field may start from: not a special, inside the range. */
    function plainInRange(candidate: number | undefined): candidate is number {
        if (candidate === undefined || field.special.some((special) => special.VALUE === candidate)) return false;
        const shown = toDisplayValue(candidate, field.description);
        return (
            typeof shown === 'number' &&
            (field.min === undefined || shown >= field.min) &&
            (field.max === undefined || shown <= field.max)
        );
    }

    /** Where the free number starts: the default if it is a plain number in range, the last plain value, `MIN`. */
    function prefill(): number {
        const fallback = asNumber(field.description.DEFAULT);
        if (plainInRange(fallback)) return fallback;
        if (plainInRange(lastPlain)) return lastPlain;
        return fromDisplayValue(field.min ?? 0, field.description) ?? 0;
    }

    async function chooseSpecial(id: string): Promise<void> {
        const chosen = field.special.find((special) => special.ID === id);
        if (chosen) {
            entering = undefined;
            onchange(chosen.VALUE);
            return;
        }
        entering = {on: value, draft: prefill()};
        await tick();
        numberInput?.focus();
        numberInput?.select();
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
            {#if !showSpecial}
                <input
                    class="hmm-input hmm-param-number"
                    type="number"
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    disabled={readOnly}
                    aria-label={label}
                    bind:this={numberInput}
                    value={activeSpecial === undefined
                        ? text
                        : String(
                              toDisplayValue(
                                  entering !== undefined && entering.on === value ? entering.draft : prefill(),
                                  field.description,
                              ),
                          )}
                    oninput={(event) => changeNumber(event.currentTarget.value)}
                />
            {/if}
            {#if field.special.length > 0}
                <select
                    class="hmm-select hmm-param-special"
                    disabled={readOnly}
                    aria-label={`${label} SPECIAL`}
                    value={showSpecial ? (activeSpecial?.ID ?? '') : ''}
                    onchange={(event) => void chooseSpecial(event.currentTarget.value)}
                >
                    <option value="">{t('Enter value')}</option>
                    {#each field.special as special (special.ID)}
                        <option value={special.ID}>{specialText(special.ID)}</option>
                    {/each}
                </select>
            {/if}
            {#if field.preset}
                <select
                    class="hmm-select hmm-param-preset"
                    disabled={readOnly}
                    aria-label={`${label} presets`}
                    value={matchingPreset === undefined ? '' : String(matchingPreset.value)}
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
                        <option value={String(entry.value)}>{presetText(entry, presetLabel ?? labelOf)}</option>
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

        {#if field.unit !== '' && !showSpecial}<span class="hmm-param-unit">{field.unit}</span>{/if}
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
    {#if (field.min !== undefined || field.max !== undefined) && !showSpecial}
        <div class="hmm-param-range">{field.min ?? '−∞'} … {field.max ?? '∞'}</div>
    {/if}
    {#if field.description.DEFAULT !== undefined}
        {@const defaultSpecial = field.special.find((special) => special.VALUE === asNumber(field.description.DEFAULT))}
        <div class="hmm-param-default">
            {t('default {value}', {
                value: defaultSpecial ? specialText(defaultSpecial.ID) : String(field.description.DEFAULT),
            })}
        </div>
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
