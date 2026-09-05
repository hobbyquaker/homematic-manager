<script lang="ts">
    import type {ParamsetValue} from '@homematic-manager/core';

    import {
        durationOf,
        formatSeconds,
        isNotUsedDuration,
        setDuration,
        type DurationPairsSpec,
        type DurationPairView,
        type EditorChange,
        type EditorValues,
    } from '../../../lib/util/editors/index.js';
    import {getStores} from '../../../lib/stores/context.js';

    interface Props {
        spec: DurationPairsSpec;
        values: EditorValues;
        channelType: string;
        onchange: EditorChange;
    }

    let {spec, values, channelType, onchange}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;

    /** Set when the encoding had to round; cleared as soon as an exact value is entered. */
    let inexact = $state<Record<string, number>>({});

    function label(view: DurationPairView): string {
        // The pair's own name is not a parameter, so the label comes from the unit half - which is
        // what the CCU's string table has an entry for.
        return stores.meta.parameterLabel(view.pair.unitParam, channelType);
    }

    function seconds(view: DurationPairView): number | undefined {
        return durationOf(view, values);
    }

    function apply(view: DurationPairView, wanted: number): void {
        const result = setDuration(view, wanted);
        if (!result) {
            return;
        }
        inexact = result.exact
            ? Object.fromEntries(Object.entries(inexact).filter(([key]) => key !== view.pair.name))
            : {...inexact, [view.pair.name]: result.seconds};
        onchange(result.values);
    }

    function changeSeconds(view: DurationPairView, raw: string): void {
        const wanted = Number(raw);
        if (raw === '' || !Number.isFinite(wanted)) {
            return;
        }
        apply(view, wanted);
    }

    function changeUnit(view: DurationPairView, raw: string): void {
        const index = Number(raw);
        const current = seconds(view);
        const unit = view.pair.units[index];
        if (unit === undefined || current === undefined) {
            return;
        }
        // Keep the duration, change the resolution: the count follows from the new unit.
        const count = Math.min(view.pair.maxCount, Math.max(0, Math.round(current / unit.seconds)));
        change({[view.pair.unitParam]: index, [view.pair.countParam]: count});
    }

    function changeCount(view: DurationPairView, raw: string): void {
        const count = Number(raw);
        if (raw === '' || !Number.isInteger(count)) {
            return;
        }
        change({[view.pair.countParam]: count});
    }

    function change(update: Record<string, ParamsetValue>): void {
        onchange(update);
    }

    function unitIndex(view: DurationPairView): number {
        const raw = values[view.pair.unitParam];
        if (typeof raw === 'number') {
            return raw;
        }
        return view.pair.units.findIndex((unit) => unit.name === raw);
    }
</script>

<div class="hmm-editor" data-testid="editor-duration-pairs">
    <h3>{t('Durations')}</h3>
    <p class="hmm-editor-hint">
        {t('A duration is stored as a unit and a count; both are shown next to the seconds.')}
    </p>

    {#each spec.pairs as view (view.pair.name)}
        {@const current = seconds(view)}
        {@const notUsed = isNotUsedDuration(view, values)}
        <div class="hmm-duration" data-testid={`duration-${view.pair.name}`}>
            <div class="hmm-duration-label">
                <span>{label(view)}</span>
                <span class="hmm-duration-id">{view.pair.unitParam} / {view.pair.countParam}</span>
            </div>

            <div class="hmm-duration-control">
                <input
                    class="hmm-input hmm-duration-seconds"
                    type="number"
                    min="0"
                    step="0.1"
                    disabled={!view.writable || notUsed}
                    aria-label={`${label(view)} ${t('seconds')}`}
                    data-testid={`duration-${view.pair.name}-seconds`}
                    value={current ?? ''}
                    oninput={(event) => changeSeconds(view, event.currentTarget.value)}
                />
                <span class="hmm-duration-unit">s</span>

                <select
                    class="hmm-select"
                    disabled={!view.writable}
                    aria-label={`${label(view)} ${t('unit')}`}
                    data-testid={`duration-${view.pair.name}-unit`}
                    value={String(unitIndex(view))}
                    onchange={(event) => changeUnit(view, event.currentTarget.value)}
                >
                    {#each view.pair.units as unit, index (unit.name)}
                        <option value={String(index)}>{unit.name}</option>
                    {/each}
                </select>
                <input
                    class="hmm-input hmm-duration-count"
                    type="number"
                    min="0"
                    max={view.pair.maxCount}
                    step="1"
                    disabled={!view.writable}
                    aria-label={`${label(view)} ${t('count')}`}
                    data-testid={`duration-${view.pair.name}-count`}
                    value={values[view.pair.countParam] ?? ''}
                    oninput={(event) => changeCount(view, event.currentTarget.value)}
                />

                <label class="hmm-duration-notused">
                    <input
                        type="checkbox"
                        disabled={!view.writable}
                        checked={notUsed}
                        data-testid={`duration-${view.pair.name}-not-used`}
                        onchange={(event) => apply(view, event.currentTarget.checked ? view.notUsedSeconds : 0)}
                    />
                    <span>{t('Not used / for ever')}</span>
                </label>
            </div>

            <div class="hmm-duration-meta" data-testid={`duration-${view.pair.name}-result`}>
                {#if current === undefined}
                    <span class="hmm-duration-broken">{t('The device holds a value this pair cannot express')}</span>
                {:else}
                    <span>{formatSeconds(current)}</span>
                {/if}
                {#if inexact[view.pair.name] !== undefined}
                    <span class="hmm-duration-broken" data-testid={`duration-${view.pair.name}-inexact`}
                        >{t('The device can only do {seconds}', {
                            seconds: formatSeconds(inexact[view.pair.name] ?? 0),
                        })}</span
                    >
                {/if}
            </div>
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

    .hmm-duration {
        display: grid;
        grid-template-columns: 240px minmax(0, 1fr) 200px;
        gap: 8px;
        align-items: center;
        padding: 2px 4px;
        border-bottom: 1px solid var(--hmm-border-muted);
    }

    .hmm-duration-label {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }

    .hmm-duration-id {
        font-family: var(--hmm-font-mono);
        font-size: var(--hmm-font-size-small);
        color: var(--hmm-fg-faint);
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .hmm-duration-control {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        flex-wrap: wrap;
    }

    .hmm-duration-seconds,
    .hmm-duration-count {
        width: 110px;
    }

    .hmm-duration-unit {
        color: var(--hmm-fg-muted);
    }

    .hmm-duration-notused {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .hmm-duration-meta {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        color: var(--hmm-fg-muted);
        font-size: var(--hmm-font-size-small);
    }

    .hmm-duration-broken {
        color: var(--hmm-warn);
    }
</style>
