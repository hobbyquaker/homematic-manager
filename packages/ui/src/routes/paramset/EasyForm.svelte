<script lang="ts">
    import type {
        EasyFormControl,
        LinkParameterSubset,
        OptionPreset,
        ParamsetDescription,
        ParamsetValue,
        TimeSelectorOption,
    } from '@homematic-manager/core';

    import {getStores} from '../../lib/stores/context.js';
    import {
        localizedText,
        presetIndex,
        subsetChoices,
        subsetIndex,
        subsetValues,
        timeOptionIndex,
        timeOptionLabel,
        timeOptionValues,
    } from '../../lib/util/linkEasyForm.js';
    import type {FormField} from '../../lib/util/paramsetForm.js';

    import ParameterRow from './ParameterRow.svelte';

    /**
     * Tasks 62 and 63 (D-54, D-55): the CCU easy mode's form - of a link profile in the link
     * dialog, of a channel type's MASTER paramset in the paramset dialog. Only the controls the
     * WebUI draws, in its order, in its shape: a time is one selector over the duration pair (its
     * presets, "not active", "permanent" and "enter value", which opens the raw pair), a level is
     * a combo box with the WebUI's option set, a subset is one choice. The expert view of either
     * dialog shows every parameter raw instead.
     */
    interface Props {
        form: readonly EasyFormControl[];
        /** Every field of the paramset, by name - the rows are drawn from these. */
        fields: ReadonlyMap<string, FormField & {readonly fixedByProfile?: boolean}>;
        /** The stored values with the edits on top. */
        values: Readonly<Record<string, ParamsetValue>>;
        /** Which parameters differ from what the device answered. */
        changed: (param: string) => boolean;
        description: ParamsetDescription;
        /** The channel type the labels and value names are looked up for. */
        channelType: string;
        subsets?: readonly LinkParameterSubset[] | undefined;
        presets: Readonly<Record<string, OptionPreset>>;
        timeSelectors: Readonly<Record<string, readonly TimeSelectorOption[]>>;
        onchange: (changes: Record<string, ParamsetValue>) => void;
        testId?: string;
    }

    let {
        form,
        fields,
        values,
        changed,
        description,
        channelType,
        subsets = [],
        presets,
        timeSelectors,
        onchange,
        testId = 'easy-form',
    }: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;
    const language = $derived(stores.i18n.language);

    /** The time pairs whose raw base and factor are open ("enter value" chosen, or no preset fits). */
    let entering = $state<Record<string, boolean>>({});

    /** The key press a control belongs to - a heading goes where it changes, as in the WebUI. */
    function pressOf(control: EasyFormControl | undefined): 'SHORT' | 'LONG' | undefined {
        const name =
            control === undefined
                ? ''
                : control.kind === 'time'
                  ? control.pair.unitParam
                  : control.kind === 'param'
                    ? control.param
                    : '';
        return name.startsWith('SHORT_') ? 'SHORT' : name.startsWith('LONG_') ? 'LONG' : undefined;
    }
    const bothPresses = $derived(form.some((c) => pressOf(c) === 'SHORT') && form.some((c) => pressOf(c) === 'LONG'));
    function headingBefore(index: number): string | undefined {
        if (!bothPresses) return undefined;
        const press = pressOf(form[index]);
        const previous = index === 0 ? undefined : pressOf(form[index - 1]);
        if (press === undefined || press === previous) return undefined;
        return press === 'SHORT' ? t('Short key press') : t('Long key press');
    }

    function labelOf(control: EasyFormControl, fallbackParam: string): string {
        return localizedText(control.label, language) ?? stores.meta.parameterLabel(fallbackParam, channelType);
    }

    /** The combo box's option set, where the WebUI names one and the data has it. */
    function presetOf(control: Extract<EasyFormControl, {kind: 'param'}>): OptionPreset | undefined {
        return control.option === undefined ? undefined : presets[control.option];
    }

    /** The parameters whose free entry is open ("enter value" chosen, or a value no preset matches). */
    let enteringValue = $state<Record<string, boolean>>({});

    function choosePreset(
        control: Extract<EasyFormControl, {kind: 'param'}>,
        preset: OptionPreset,
        index: number,
    ): void {
        const entry = preset.presets[index];
        enteringValue = {...enteringValue, [control.param]: entry === undefined};
        if (entry !== undefined) changeParam(control, entry.value);
    }

    function changeParam(control: Extract<EasyFormControl, {kind: 'param'}>, value: ParamsetValue): void {
        onchange(Object.fromEntries([control.param, ...control.also].map((param) => [param, value])));
    }

    function chooseTime(control: Extract<EasyFormControl, {kind: 'time'}>, index: number): void {
        const option = (timeSelectors[control.selector] ?? [])[index];
        if (option === undefined) return;
        const written = timeOptionValues(option, control.pair);
        entering = {...entering, [control.pair.name]: written === undefined};
        if (written !== undefined) onchange(written);
    }
</script>

<div class="hmm-link-easy" data-testid={testId}>
    {#each form as control, index (control.kind === 'time' ? control.pair.name : control.kind === 'param' ? control.param : `subset-${String(control.subsets)}`)}
        {@const heading = headingBefore(index)}
        {#if heading}
            <h5 class="hmm-link-press" data-testid="link-easy-press">{heading}</h5>
        {/if}
        {#if control.kind === 'time'}
            {@const options = timeSelectors[control.selector] ?? []}
            {@const current = timeOptionIndex(options, values, control.pair)}
            {@const enterIndex = options.findIndex((o) => 'special' in o && o.special === 'enterValue')}
            {@const raw =
                entering[control.pair.name] === true ||
                (current >= 0 && current === enterIndex) ||
                options.length === 0}
            {@const label = labelOf(control, control.pair.countParam)}
            <div
                class="hmm-link-easy-row"
                class:hmm-param-changed={changed(control.pair.unitParam) || changed(control.pair.countParam)}
                data-testid={`easy-time-${control.pair.name}`}
            >
                <span class="hmm-link-easy-label">{label}</span>
                {#if options.length > 0}
                    <select
                        class="hmm-select"
                        aria-label={label}
                        data-testid={`easy-time-select-${control.pair.name}`}
                        value={String(raw && enterIndex >= 0 ? enterIndex : current)}
                        onchange={(event) => chooseTime(control, Number(event.currentTarget.value))}
                    >
                        {#if current < 0}
                            <option value="-1" disabled>—</option>
                        {/if}
                        {#each options as option, optionIndex (optionIndex)}
                            <option value={String(optionIndex)}>{timeOptionLabel(option, language, t)}</option>
                        {/each}
                    </select>
                {/if}
            </div>
            {#if raw}
                {#each [control.pair.unitParam, control.pair.countParam] as param (param)}
                    {@const field = fields.get(param)}
                    {#if field}
                        <ParameterRow
                            {field}
                            value={values[param] ?? field.description.DEFAULT}
                            label={stores.meta.parameterLabel(param, channelType)}
                            help={stores.meta.parameterHelp(param, channelType)}
                            changed={changed(param)}
                            valueLabel={(entry) => stores.meta.valueLabel(param, entry, channelType)}
                            presetLabel={(key) => stores.meta.uiLabel(key)}
                            onchange={(value) => onchange({[param]: value})}
                        />
                    {/if}
                {/each}
            {/if}
        {:else if control.kind === 'param'}
            {@const field = fields.get(control.param)}
            {@const preset = presetOf(control)}
            {#if field && preset && field.fixedByProfile !== true}
                <!-- the WebUI's combo box: the current preset, or "enter value" and the free field -->
                {@const value = values[control.param] ?? field.description.DEFAULT}
                {@const current = presetIndex(preset, value)}
                {@const free = enteringValue[control.param] === true || current < 0}
                {@const label = labelOf(control, control.param)}
                <div
                    class="hmm-link-easy-row"
                    class:hmm-param-changed={changed(control.param)}
                    data-testid={`easy-preset-${control.param}`}
                >
                    <span class="hmm-link-easy-label">{label}</span>
                    <select
                        class="hmm-select"
                        aria-label={label}
                        data-testid={`easy-preset-select-${control.param}`}
                        value={String(free ? -1 : current)}
                        onchange={(event) => choosePreset(control, preset, Number(event.currentTarget.value))}
                    >
                        {#each preset.presets as entry, entryIndex (entryIndex)}
                            <option value={String(entryIndex)}
                                >{entry.label ?? stores.meta.uiLabel(entry.labelKey ?? '')}</option
                            >
                        {/each}
                        <option value="-1">{t('Enter value')}</option>
                    </select>
                </div>
                {#if free}
                    <ParameterRow
                        {field}
                        {value}
                        label={stores.meta.parameterLabel(control.param, channelType)}
                        help={stores.meta.parameterHelp(control.param, channelType)}
                        changed={changed(control.param)}
                        valueLabel={(entry) => stores.meta.valueLabel(control.param, entry, channelType)}
                        presetLabel={(key) => stores.meta.uiLabel(key)}
                        onchange={(changedValue) => changeParam(control, changedValue)}
                    />
                {/if}
            {:else if field}
                <ParameterRow
                    {field}
                    value={values[control.param] ?? field.description.DEFAULT}
                    label={labelOf(control, control.param)}
                    help={stores.meta.parameterHelp(control.param, channelType)}
                    changed={changed(control.param)}
                    disabled={field.fixedByProfile === true}
                    valueLabel={(entry) => stores.meta.valueLabel(control.param, entry, channelType)}
                    presetLabel={(key) => stores.meta.uiLabel(key)}
                    onchange={(changedValue) => changeParam(control, changedValue)}
                />
            {/if}
        {:else}
            {@const choices = subsetChoices(control.subsets, subsets)}
            {#if choices.length > 0}
                {@const current = subsetIndex(choices, values, description)}
                {@const label = localizedText(control.label, language) ?? t('Mode')}
                <div class="hmm-link-easy-row" data-testid="easy-subset">
                    <span class="hmm-link-easy-label">{label}</span>
                    <select
                        class="hmm-select"
                        aria-label={label}
                        value={String(current)}
                        onchange={(event) => {
                            const chosen = choices[Number(event.currentTarget.value)];
                            if (chosen) onchange(subsetValues(chosen, description));
                        }}
                    >
                        {#if current < 0}
                            <option value="-1" disabled>—</option>
                        {/if}
                        {#each choices as subset, choiceIndex (subset.id)}
                            <option value={String(choiceIndex)}
                                >{localizedText(control.names?.[control.subsets.indexOf(subset.id)], language) ??
                                    stores.meta.parameterLabel(subset.key, channelType)}</option
                            >
                        {/each}
                    </select>
                </div>
            {/if}
        {/if}
    {/each}
</div>

<style>
    .hmm-link-press {
        margin: 10px 0 2px;
        padding: 0 4px;
        font-size: var(--hmm-font-size-small);
        font-weight: 600;
        color: var(--hmm-fg-muted);
    }

    /* the grid of ParameterRow, so a selector row lines up with the parameter rows around it */
    .hmm-link-easy-row {
        display: grid;
        grid-template-columns: 240px minmax(0, 1fr) 200px;
        gap: 8px;
        align-items: center;
        padding: 2px 4px;
        border-bottom: 1px solid var(--hmm-border-muted);
    }

    .hmm-link-easy-row select {
        justify-self: start;
        min-width: 12em;
        max-width: 100%;
    }

    .hmm-link-easy-label {
        overflow-wrap: anywhere;
    }

    .hmm-link-easy-row.hmm-param-changed {
        background: var(--hmm-accent-bg);
    }
</style>
