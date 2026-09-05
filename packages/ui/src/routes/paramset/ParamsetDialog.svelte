<script lang="ts">
    import type {MasterView, Paramset, ParamsetDescription, ParamsetValue, WriteResult} from '@homematic-manager/core';
    import {multiApplyEligibility} from '@homematic-manager/core';

    import Dialog from '../../lib/components/Dialog.svelte';
    import MultiSelect from '../../lib/components/MultiSelect.svelte';
    import type {MultiSelectOption} from '../../lib/components/multiSelect.js';
    import {getStores} from '../../lib/stores/context.js';
    import {coveredParameters, detectDeviceEditors, type EditorContext} from '../../lib/util/editors/index.js';
    import {
        buildPreview,
        formFields,
        readBack as computeReadBack,
        type FormField,
        type ReadBackEntry,
        type WritePreview,
    } from '../../lib/util/paramsetForm.js';

    import DeviceEditors from './editors/DeviceEditors.svelte';
    import ParameterRow from './ParameterRow.svelte';
    import WritePreviewDialog from './WritePreviewDialog.svelte';

    interface Props {
        open?: boolean;
        interfaceName?: string;
        address?: string;
        paramset?: string;
    }

    let {open = $bindable(false), interfaceName = '', address = '', paramset = 'MASTER'}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;

    let description = $state<ParamsetDescription | undefined>(undefined);
    let original = $state<Paramset>({});
    let edited = $state<Record<string, unknown>>({});
    let view = $state<MasterView | undefined>(undefined);
    let targets = $state<string[]>([]);
    let writeAll = $state(false);
    let showHidden = $state(false);
    let showCovered = $state(false);
    let previewOpen = $state(false);
    let preview = $state<WritePreview | undefined>(undefined);
    let results = $state<WriteResult[]>([]);
    let readBack = $state<ReadBackEntry[]>([]);
    let loadToken = 0;

    const index = $derived(stores.devices.index(interfaceName));
    const channelType = $derived(index?.get(address)?.TYPE ?? '');
    const title = $derived(`${paramset} — ${stores.nameOf(address)} (${address})`);
    const fields = $derived(description ? formFields(description, view) : []);
    /**
     * The device-specific editors of task 10. They are plug-ins on top of this dialog: whatever
     * they recognise they draw themselves, and exactly those rows leave the generic list - the
     * rest of the paramset is untouched, so a firmware with one parameter more still shows it.
     * `showCovered` puts the raw rows back, because nothing may ever become unreachable.
     */
    const editorContext = $derived<EditorContext>({
        optionByName: (param, name) => stores.meta.valueLabelIfKnown(param, name, channelType),
        optionByIndex: (param, index) => stores.meta.valueLabelIfKnown(param, String(index), channelType),
        preset: (param) => view?.parameters.find((entry) => entry.name === param)?.preset,
        uiLabel: (key) => stores.meta.uiLabel(key),
    });
    const editors = $derived(
        description
            ? detectDeviceEditors({interfaceName, address, channelType, paramset, description}, editorContext)
            : [],
    );
    const covered = $derived(showCovered ? new Set<string>() : coveredParameters(editors));
    const shownFields = $derived(fields.filter((field) => (showHidden || field.visible) && !covered.has(field.name)));
    /** VALUES is the only paramset whose datapoints can be written one at a time. */
    const perDatapoint = $derived(paramset === 'VALUES');
    /** Multi-apply is a MASTER affair; 2.x offered its channel picker only there. */
    const multiApply = $derived(paramset === 'MASTER');

    /**
     * Which other channels this paramset may be written to in one go: the ones whose paramset
     * description is literally the same (core's identity key, task 6 item 3). 2.x offered every
     * channel with the same `TYPE` and never compared the descriptions, which is how one careless
     * multi-select put a hundred devices into CONFIG_PENDING (#98). Candidates are still narrowed
     * to the same channel type first, so the list stays the length it used to be - the difference
     * is that the ones with a different firmware or device type are now disabled, with the reason.
     */
    const eligibility = $derived.by(() => {
        if (!multiApply || !index || address === '' || !index.has(address)) {
            return undefined;
        }
        const candidates = index
            .all()
            .filter((entry) => entry.TYPE === channelType && entry.ADDRESS !== address)
            .map((entry) => entry.ADDRESS);
        return multiApplyEligibility(index, address, paramset, candidates);
    });

    const targetOptions = $derived<MultiSelectOption[]>(
        eligibility
            ? [
                  ...eligibility.eligible.map((entry) => ({
                      value: entry,
                      label: `${stores.nameOf(entry)} (${entry})`,
                  })),
                  ...eligibility.ineligible
                      .filter((entry) => entry.reason === 'different-identity')
                      .map((entry) => ({
                          value: entry.address,
                          label: `${stores.nameOf(entry.address)} (${entry.address}) — ${t('other firmware or device type')}`,
                          disabled: true,
                      })),
              ]
            : [],
    );

    const warnings = $derived(
        (view?.problems ?? []).map(
            (problem) => `${problem.params.join(', ')}: ${stores.meta.uiLabel(problem.errorKey)}`,
        ),
    );

    /** Loads description and values whenever the dialog is opened on another address or paramset. */
    $effect(() => {
        if (!open || interfaceName === '' || address === '') {
            return;
        }
        const token = (loadToken += 1);
        const request = {interfaceName, address, paramset};
        void stores.paramsets.open(request.interfaceName, request.address, request.paramset).then((loaded) => {
            if (token !== loadToken) {
                return;
            }
            description = loaded?.description;
            original = loaded?.values ?? {};
            edited = {};
            results = [];
            readBack = [];
            targets = [];
            writeAll = false;
        });
    });

    /**
     * The MASTER metadata of task 9 - order, conditional visibility, option presets and the
     * cross-validation rules - recomputed as the values change, because a rule that hides a
     * parameter depends on what another one holds right now.
     */
    $effect(() => {
        const current = description;
        if (!open || !current || paramset !== 'MASTER' || channelType === '') {
            view = undefined;
            return;
        }
        const values = merged();
        void stores.meta.masterView(channelType, current, values).then((result) => {
            view = result;
        });
    });

    /** The values as they stand: what the device answered, with the edits on top. */
    function merged(): Paramset {
        const values: Record<string, ParamsetValue> = {...original};
        for (const [param, value] of Object.entries(edited)) {
            if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
                values[param] = value;
            }
        }
        return values;
    }

    function valueOf(field: FormField): unknown {
        if (Object.prototype.hasOwnProperty.call(edited, field.name)) {
            return edited[field.name];
        }
        return original[field.name] ?? field.description.DEFAULT;
    }

    function isChanged(field: FormField): boolean {
        return Object.prototype.hasOwnProperty.call(edited, field.name);
    }

    function change(field: FormField, value: ParamsetValue): void {
        edited = {...edited, [field.name]: value};
    }

    /** What a device editor writes: several parameters at once, into the very same map. */
    function changeMany(values: Readonly<Record<string, ParamsetValue>>): void {
        edited = {...edited, ...values};
    }

    function labelOf(field: FormField): string {
        return stores.meta.parameterLabel(field.name, channelType);
    }

    /** The CCU's help texts carry a little markup; the dialog shows them as plain text. */
    function helpOf(field: FormField): string | undefined {
        const help = stores.meta.parameterHelp(field.name, channelType);
        return help === undefined
            ? undefined
            : help
                  .replace(/<[^>]*>/g, ' ')
                  .replace(/\s+/g, ' ')
                  .trim();
    }

    function openPreview(): void {
        if (!description) {
            return;
        }
        results = [];
        readBack = [];
        preview = buildPreview(original, edited, description, {
            interfaceName,
            targets: [address, ...targets],
            writeAll,
        });
        previewOpen = true;
    }

    async function write(): Promise<void> {
        const payload = preview;
        if (!payload || !description) {
            return;
        }
        const written = await stores.paramsets.put(
            interfaceName,
            [...payload.targets],
            paramset,
            payload.values,
            writeAll ? {writeAll: true} : undefined,
        );
        results = written;
        // Always read back: `ok` means nothing on BidCos, where rfd silently drops, coerces and
        // clamps what it does not like (task 6, measured). The preview stays open while the two
        // disagree, because that is the only place the difference is visible.
        const reread = await stores.paramsets.read(interfaceName, address, paramset);
        if (reread) {
            readBack = computeReadBack(payload.values, reread, description);
            original = reread;
            edited = {};
        }
        if (written.length > 0 && written.every((result) => result.ok) && !readBack.some((entry) => entry.differs)) {
            previewOpen = false;
        }
    }

    /**
     * Issue #124: the same payload the Write button would send, put into the change set instead.
     * The dialog is closed afterwards, because the values it shows are now a plan and not the
     * device's state any more - leaving it open would invite a second, contradictory stage.
     */
    function stage(): void {
        const payload = preview;
        if (!payload || payload.entries.length === 0) {
            return;
        }
        stores.changeSet.stage({
            kind: 'paramset',
            interfaceName,
            title: `${paramset} — ${stores.nameOf(address)} (${address})`,
            targets: [...payload.targets],
            paramset,
            values: payload.values,
            writeAll,
            calls: payload.targets.map(
                (target) => `putParamset(${target}, ${paramset}, ${JSON.stringify(payload.values)})`,
            ),
            lines: payload.entries.map((entry) => ({label: entry.param, from: entry.from, to: entry.to})),
        });
        previewOpen = false;
        open = false;
    }

    /** How a written value reads in the toast: an enum by its label, everything else as it is. */
    function shownValue(field: FormField, value: ParamsetValue): string {
        if (field.kind === 'enum' && typeof value === 'number') {
            const entry = field.valueList?.[value];
            if (entry !== undefined) {
                return `${stores.meta.valueLabel(field.name, entry, channelType)} (${value})`;
            }
        }
        return String(value);
    }

    /**
     * The per-datapoint `setValue` of the VALUES paramset.
     *
     * The value goes out **uncast**. Casting it here as well used to break every `FLOAT`: the core
     * wraps a float in `{explicitDouble}` for the XML-RPC encoder, the backend cast the wrapper a
     * second time, `parseFloat('[object Object]')` is `NaN` and `NaN` becomes `0` - so the dimmer
     * the maintainer tried went to zero instead of to the level he typed, which looks like nothing
     * happening at all. The backend owns the cast: it has the authoritative `VALUES` description,
     * it validates against it, and it is the only place that knows what goes on the wire.
     */
    async function setOne(field: FormField): Promise<void> {
        const raw = valueOf(field);
        const value: ParamsetValue =
            typeof raw === 'boolean' || typeof raw === 'number' || typeof raw === 'string' ? raw : false;
        const ok = await stores.paramsets.setValue(interfaceName, address, field.name, value);
        if (!ok) {
            return;
        }
        // The device holds it now, so the row is no longer "changed" and the dialog agrees again.
        edited = Object.fromEntries(Object.entries(edited).filter(([name]) => name !== field.name));
        original = {...original, [field.name]: value};
        stores.notices.push(
            'info',
            `setValue ${stores.nameOf(address)} (${address}) ${field.name} = ${shownValue(field, value)}`,
        );
    }
</script>

<Dialog bind:open {title} width="900px" testId="paramset-dialog">
    {#if stores.paramsets.loading && !description}
        <p>{t('Loading Homematic Manager...')}</p>
    {:else if !description}
        <p data-testid="paramset-failed">{t('No data')}</p>
    {:else}
        <div class="hmm-paramset-top">
            {#if multiApply && targetOptions.length > 0}
                <MultiSelect
                    options={targetOptions}
                    bind:selected={targets}
                    label={t('Please choose one or more channels')}
                    placeholder={t('Please choose one or more channels')}
                    filterLabel={t('Filter')}
                    checkAllLabel={t('Check all')}
                    uncheckAllLabel={t('Uncheck all')}
                    summary={(chosen) => t('{count} channels selected', {}, chosen.length)}
                    testId="paramset-targets"
                />
            {/if}
            <label class="hmm-paramset-option">
                <input type="checkbox" bind:checked={writeAll} data-testid="paramset-write-all" />
                <span>{t('Write every parameter, not only the changed ones')}</span>
            </label>
            {#if editors.length > 0}
                <label class="hmm-paramset-option">
                    <input type="checkbox" bind:checked={showCovered} data-testid="paramset-show-covered" />
                    <span>{t('Show the raw parameters as well')}</span>
                </label>
            {/if}
            {#if fields.some((field) => !field.visible)}
                <label class="hmm-paramset-option">
                    <input type="checkbox" bind:checked={showHidden} data-testid="paramset-show-hidden" />
                    <span>{t('Show hidden parameters')}</span>
                </label>
            {/if}
        </div>

        {#if warnings.length > 0}
            <ul class="hmm-paramset-warnings" data-testid="paramset-warnings">
                {#each warnings as warning (warning)}
                    <li>{warning}</li>
                {/each}
            </ul>
        {/if}

        <DeviceEditors specs={editors} values={merged()} {channelType} onchange={changeMany} />

        <div class="hmm-paramset-list">
            {#each shownFields as field (field.name)}
                <ParameterRow
                    {field}
                    value={valueOf(field)}
                    label={labelOf(field)}
                    help={helpOf(field)}
                    changed={isChanged(field)}
                    valueLabel={(entry) => stores.meta.valueLabel(field.name, entry, channelType)}
                    onchange={(value) => change(field, value)}
                    onset={perDatapoint && field.writable ? () => void setOne(field) : undefined}
                />
            {/each}
        </div>

        {#if results.length > 0}
            <ul class="hmm-paramset-results" data-testid="paramset-results">
                {#each results as result (`${result.address}-${result.paramset}`)}
                    <li class:hmm-paramset-failed={!result.ok}>
                        <span class="hmm-mono">{result.address}</span>
                        {result.ok ? '✔' : `✕ ${result.faultString ?? ''}`}
                    </li>
                {/each}
            </ul>
        {/if}
    {/if}

    {#snippet buttons()}
        <button type="button" class="hmm-button" onclick={() => (open = false)}>{t('Close')}</button>
        <button
            type="button"
            class="hmm-button"
            disabled={!description}
            data-testid="paramset-preview"
            onclick={openPreview}>{t('Preview')}</button
        >
    {/snippet}
</Dialog>

<WritePreviewDialog
    bind:open={previewOpen}
    {preview}
    {paramset}
    {warnings}
    {results}
    {readBack}
    writing={stores.paramsets.writing}
    onstage={stage}
    onconfirm={() => void write()}
/>

<style>
    .hmm-paramset-top {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
        padding-bottom: 6px;
        border-bottom: 1px solid var(--hmm-border);
    }

    .hmm-paramset-option {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .hmm-paramset-warnings {
        margin: 6px 0;
        padding-left: 18px;
        color: var(--hmm-warn);
    }

    .hmm-paramset-list {
        max-height: 52vh;
        overflow: auto;
    }

    .hmm-paramset-results {
        margin: 6px 0 0;
        padding-left: 18px;
        color: var(--hmm-ok);
    }

    .hmm-paramset-failed {
        color: var(--hmm-error);
    }
</style>
