<script lang="ts">
    import type {ParamsetValue} from '@homematic-manager/core';
    import {numericBound} from '@homematic-manager/core';

    import {
        blindRawValue,
        blindSeconds,
        formatSeconds,
        setBlindSeconds,
        type BlindCalibrationSpec,
        type BlindParameter,
        type BlindRunningTime,
        type EditorChange,
        type EditorValues,
    } from '../../../lib/util/editors/index.js';
    import {getStores} from '../../../lib/stores/context.js';

    interface Props {
        spec: BlindCalibrationSpec;
        values: EditorValues;
        channelType: string;
        onchange: EditorChange;
    }

    let {spec, values, channelType, onchange}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;

    /** The running times the encoding had to round; the row then says what the device will do. */
    let inexact = $state<Record<string, number>>({});

    function label(param: string): string {
        return stores.meta.parameterLabel(param, channelType);
    }

    function changeSeconds(entry: BlindRunningTime, raw: string): void {
        if (raw === '') {
            return;
        }
        const result = setBlindSeconds(entry, Number(raw));
        if (!result) {
            return;
        }
        inexact =
            result.exact || result.seconds === Number(raw)
                ? Object.fromEntries(Object.entries(inexact).filter(([key]) => key !== entry.id))
                : {...inexact, [entry.id]: result.seconds};
        onchange(result.values);
    }

    function changeNumber(entry: BlindParameter, raw: string): void {
        if (raw === '' || !Number.isFinite(Number(raw))) {
            return;
        }
        change(entry.param, Number(raw));
    }

    function change(param: string, value: ParamsetValue): void {
        onchange({[param]: value});
    }
</script>

<div class="hmm-editor" data-testid="editor-blind-calibration">
    <h3>{t('Blind calibration')}</h3>
    <p class="hmm-editor-hint">
        {t('The running times of a reference run, in plain seconds next to the value the device stores.')}
    </p>

    {#each spec.runningTimes as entry (entry.id)}
        {@const current = blindSeconds(entry, values)}
        <div class="hmm-blind-row" data-testid={`blind-${entry.id}`}>
            <div class="hmm-blind-label">
                <span>{label(entry.id)}</span>
                <span class="hmm-blind-id">{entry.id}</span>
            </div>
            <div class="hmm-blind-control">
                <input
                    class="hmm-input hmm-blind-number"
                    type="number"
                    min="0"
                    step="0.01"
                    disabled={!entry.writable}
                    aria-label={label(entry.id)}
                    data-testid={`blind-${entry.id}-seconds`}
                    value={current ?? ''}
                    oninput={(event) => changeSeconds(entry, event.currentTarget.value)}
                />
                <span class="hmm-blind-unit">s</span>
                <span class="hmm-blind-raw" data-testid={`blind-${entry.id}-raw`}>{blindRawValue(entry, values)}</span>
            </div>
            <div class="hmm-blind-meta">
                <span>{current === undefined ? '—' : formatSeconds(current)}</span>
                {#if inexact[entry.id] !== undefined}
                    <span class="hmm-blind-warn" data-testid={`blind-${entry.id}-inexact`}
                        >{t('The device can only do {seconds}', {seconds: formatSeconds(inexact[entry.id] ?? 0)})}</span
                    >
                {/if}
            </div>
        </div>
    {/each}

    {#each spec.delays as entry (entry.param)}
        <div class="hmm-blind-row" data-testid={`blind-${entry.param}`}>
            <div class="hmm-blind-label">
                <span>{label(entry.param)}</span>
                <span class="hmm-blind-id">{entry.param}</span>
            </div>
            <div class="hmm-blind-control">
                <input
                    class="hmm-input hmm-blind-number"
                    type="number"
                    min={numericBound(entry.description, 'MIN')}
                    max={numericBound(entry.description, 'MAX')}
                    step="0.1"
                    aria-label={label(entry.param)}
                    data-testid={`blind-${entry.param}-value`}
                    value={values[entry.param] ?? ''}
                    oninput={(event) => changeNumber(entry, event.currentTarget.value)}
                />
                <span class="hmm-blind-unit">s</span>
            </div>
            <div class="hmm-blind-meta">
                <span
                    >{numericBound(entry.description, 'MIN') ?? '−∞'} … {numericBound(entry.description, 'MAX') ??
                        '∞'}</span
                >
            </div>
        </div>
    {/each}

    {#each spec.extras as entry (entry.param)}
        <div class="hmm-blind-row" data-testid={`blind-${entry.param}`}>
            <div class="hmm-blind-label">
                <span>{label(entry.param)}</span>
                <span class="hmm-blind-id">{entry.param}</span>
            </div>
            <div class="hmm-blind-control">
                {#if entry.description.TYPE === 'BOOL'}
                    <input
                        type="checkbox"
                        aria-label={label(entry.param)}
                        data-testid={`blind-${entry.param}-value`}
                        checked={values[entry.param] === true}
                        onchange={(event) => change(entry.param, event.currentTarget.checked)}
                    />
                {:else}
                    <input
                        class="hmm-input hmm-blind-number"
                        type="number"
                        min={numericBound(entry.description, 'MIN')}
                        max={numericBound(entry.description, 'MAX')}
                        step="1"
                        aria-label={label(entry.param)}
                        data-testid={`blind-${entry.param}-value`}
                        value={values[entry.param] ?? ''}
                        oninput={(event) => changeNumber(entry, event.currentTarget.value)}
                    />
                {/if}
            </div>
            <div class="hmm-blind-meta"></div>
        </div>
    {/each}
</div>

<style>
    .hmm-editor {
        padding: 4px;
        border-bottom: 1px solid var(--hmm-border);
    }

    .hmm-editor h3 {
        margin: 4px 0;
        font-size: var(--hmm-font-size);
    }

    .hmm-editor-hint {
        margin: 0 0 6px;
        color: var(--hmm-fg-muted);
        font-size: var(--hmm-font-size-small);
    }

    .hmm-blind-row {
        display: grid;
        grid-template-columns: 240px minmax(0, 1fr) 200px;
        gap: 8px;
        align-items: center;
        padding: 2px 4px;
        border-bottom: 1px solid var(--hmm-border-muted);
    }

    .hmm-blind-label {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }

    .hmm-blind-id {
        font-family: var(--hmm-font-mono);
        font-size: var(--hmm-font-size-small);
        color: var(--hmm-fg-faint);
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .hmm-blind-control {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
    }

    .hmm-blind-number {
        width: 110px;
    }

    .hmm-blind-unit {
        color: var(--hmm-fg-muted);
    }

    .hmm-blind-raw {
        font-family: var(--hmm-font-mono);
        font-size: var(--hmm-font-size-small);
        color: var(--hmm-fg-faint);
    }

    .hmm-blind-meta {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        color: var(--hmm-fg-muted);
        font-size: var(--hmm-font-size-small);
    }

    .hmm-blind-warn {
        color: var(--hmm-warn);
    }
</style>
