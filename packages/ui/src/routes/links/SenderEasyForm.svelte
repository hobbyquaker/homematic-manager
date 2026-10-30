<!--
    Task 109: the form the CCU's WebUI draws for the sender side of a link, where the sender's LINK
    paramset id names one (`ic_setprofiles.cgi` sources `<paramid>.tcl` for the sender part): the
    weather stations' storm thresholds on a Beaufort scale, the filling level sensor's thresholds as
    percentages. The dialog shows the sender's parameters raw where there is none, and in the storm
    form's expert profile.
-->
<script lang="ts">
    import type {Paramset, ParamsetDescription, ParamsetValue} from '@homematic-manager/core';
    import {
        STORM_TEXTS,
        WIND_DESCRIPTION,
        WIND_FORCE,
        adjustFillLevels,
        fillLevelPercent,
        fillLevelRaw,
        type FillLevelForm,
        type SenderText,
        type StormForm,
    } from '@homematic-manager/core';

    import {getStores} from '../../lib/stores/context.js';

    interface Props {
        form: StormForm | FillLevelForm;
        /** The sender's device type: the HM-WDS100-C6-O-2's grade 4 is 20, the others' 25. */
        senderDeviceType: string;
        /** The sender's channel type, for the parameter names (`CAPACITIVE_FILLING_LEVEL_SENSOR|…`). */
        channelType: string;
        description: ParamsetDescription;
        /** The sender's stored values with the edits on top. */
        values: Paramset;
        /** Which parameters were edited, for the changed marking. */
        changed: (param: string) => boolean;
        onchange: (changes: Record<string, ParamsetValue>) => void;
    }

    let {form, senderDeviceType, channelType, description, values, changed, onchange}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;
    const text = (entry: SenderText | undefined): string =>
        entry === undefined ? '' : stores.i18n.language === 'de' ? entry.de : entry.en;

    const stormOptions = $derived(form.kind === 'storm' ? form.options(senderDeviceType) : []);
    const STORM_ROWS = [
        {param: 'STORM_UPPER_THRESHOLD', label: 'upperStormThreshold', tip: 'toolTip0'},
        {param: 'STORM_LOWER_THRESHOLD', label: 'lowerStormThreshold', tip: 'toolTip1'},
    ] as const;

    function forceOf(value: ParamsetValue | undefined): number | undefined {
        return stormOptions.find((option) => option.value === Number(value))?.force;
    }

    /** The filling level form: its BOOL parameters as checkboxes, its INTEGER ones as percentages. */
    const fillRows = $derived(
        Object.keys(description)
            .sort()
            .filter((name) => description[name]?.TYPE === 'INTEGER'),
    );
    const fillChecks = $derived(
        Object.keys(description)
            .sort()
            .filter((name) => description[name]?.TYPE === 'BOOL'),
    );

    function fillValue(name: string): {percent: number; active: boolean} {
        return fillLevelPercent(form as FillLevelForm, values[name]);
    }

    /** One threshold changed: written raw, and the other one moved as the WebUI's form moves it. */
    function setFill(name: string, percent: number, active: boolean): void {
        const fill = form as FillLevelForm;
        const upper = fillRows.find((row) => row.includes('UPPER'));
        const lower = fillRows.find((row) => row.includes('LOWER'));
        const changes: Record<string, ParamsetValue> = {[name]: fillLevelRaw(fill, percent, active)};
        if (active && upper !== undefined && lower !== undefined && (name === upper || name === lower)) {
            const current = (row: string): number | undefined => {
                if (row === name) return percent;
                const entry = fillValue(row);
                return entry.active ? entry.percent : undefined;
            };
            const adjusted = adjustFillLevels(name === lower ? 'lower' : 'upper', current(upper), current(lower));
            for (const [row, value] of [
                [upper, adjusted.upper],
                [lower, adjusted.lower],
            ] as const) {
                if (row !== name && value !== undefined && value !== current(row)) {
                    changes[row] = fillLevelRaw(fill, value, true);
                }
            }
            changes[name] = fillLevelRaw(
                fill,
                name === upper ? (adjusted.upper ?? percent) : (adjusted.lower ?? percent),
                true,
            );
        }
        onchange(changes);
    }
</script>

{#if form.kind === 'storm'}
    <div class="hmm-sender-form" data-testid="link-sender-form">
        <p class="hmm-sender-hint">{text(STORM_TEXTS['windInBeaufort'])}</p>
        {#each STORM_ROWS as row (row.param)}
            {#if row.param in description}
                {@const force = forceOf(values[row.param])}
                <label class="hmm-sender-row" class:hmm-sender-changed={changed(row.param)}>
                    <span>{text(STORM_TEXTS[row.label])}</span>
                    <select
                        class="hmm-select"
                        title={text(STORM_TEXTS[row.tip])}
                        data-testid={`link-sender-${row.param}`}
                        value={String(values[row.param] ?? '')}
                        onchange={(event) => onchange({[row.param]: Number(event.currentTarget.value)})}
                    >
                        {#if force === undefined}
                            <!-- a value the WebUI's list does not offer (15, or one set in the expert view) -->
                            <option value={String(values[row.param] ?? '')}>{String(values[row.param] ?? '')}</option>
                        {/if}
                        {#each stormOptions as option (option.value)}
                            <option value={String(option.value)}>{text(WIND_FORCE[option.force])}</option>
                        {/each}
                    </select>
                </label>
                <p class="hmm-sender-description" data-testid={`link-sender-${row.param}-description`}>
                    {force === undefined ? '' : text(WIND_DESCRIPTION[force])}
                </p>
            {/if}
        {/each}
    </div>
{:else}
    <div class="hmm-sender-form" data-testid="link-sender-form">
        {#each fillChecks as name (name)}
            <label class="hmm-sender-row" class:hmm-sender-changed={changed(name)}>
                <span>{stores.meta.parameterLabel(name, channelType)}</span>
                <input
                    type="checkbox"
                    data-testid={`link-sender-${name}`}
                    checked={values[name] === true || values[name] === 1}
                    onchange={(event) => onchange({[name]: event.currentTarget.checked})}
                />
            </label>
        {/each}
        {#each fillRows as name (name)}
            {@const entry = fillValue(name)}
            <div class="hmm-sender-row" class:hmm-sender-changed={changed(name)}>
                <span>{stores.meta.parameterLabel(name, channelType)}</span>
                <span class="hmm-sender-percent">
                    <input
                        class="hmm-input"
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        disabled={!entry.active}
                        data-testid={`link-sender-${name}`}
                        value={entry.percent}
                        onchange={(event) => setFill(name, Number(event.currentTarget.value), true)}
                    />
                    <span>%</span>
                </span>
                <label class="hmm-sender-active">
                    <input
                        type="checkbox"
                        data-testid={`link-sender-${name}-active`}
                        checked={entry.active}
                        onchange={(event) => setFill(name, entry.percent, event.currentTarget.checked)}
                    />
                    <span>{t('Threshold active')}</span>
                </label>
            </div>
        {/each}
    </div>
{/if}

<style>
    .hmm-sender-form {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 4px 0;
    }

    .hmm-sender-hint {
        margin: 0;
        color: var(--hmm-fg-muted);
    }

    .hmm-sender-row {
        display: grid;
        grid-template-columns: minmax(160px, 240px) minmax(0, 1fr) auto;
        align-items: center;
        gap: 8px;
        padding: 2px 4px;
    }

    .hmm-sender-row > :global(select) {
        min-width: 0;
        max-width: 100%;
    }

    .hmm-sender-changed {
        background: var(--hmm-accent-bg);
    }

    /* the description under a threshold keeps its place while the value changes (two lines) */
    .hmm-sender-description {
        margin: 0 4px 4px;
        min-height: 2.6em;
        font-size: var(--hmm-font-size-small);
        color: var(--hmm-fg-muted);
    }

    .hmm-sender-percent {
        display: inline-flex;
        align-items: center;
        gap: 4px;
    }

    .hmm-sender-percent input {
        width: 7ch;
    }

    .hmm-sender-active {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        white-space: nowrap;
    }
</style>
