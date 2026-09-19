<script lang="ts">
    import type {MasterView, Paramset, ParamsetDescription, ParamsetValue, WriteResult} from '@homematic-manager/core';
    import {easyFormOf, easyFormParams, multiApplyEligibility} from '@homematic-manager/core';
    import {untrack} from 'svelte';

    import Dialog from '../../lib/components/Dialog.svelte';
    import MultiSelect from '../../lib/components/MultiSelect.svelte';
    import type {MultiSelectOption} from '../../lib/components/multiSelect.js';
    import {getStores} from '../../lib/stores/context.js';
    import {isHmipInterface} from '../../lib/stores/suppression.js';
    import {coveredParameters, detectDeviceEditors, type EditorContext} from '../../lib/util/editors/index.js';
    import {
        buildPreview,
        buildSuppressPreview,
        formFields,
        readBack as computeReadBack,
        serviceMessageParameters,
        type FormField,
        type ReadBackEntry,
        type WritePreview,
    } from '../../lib/util/paramsetForm.js';

    import EasyForm from './EasyForm.svelte';
    import DeviceEditors from './editors/DeviceEditors.svelte';
    import ParameterRow from './ParameterRow.svelte';
    import RoutingTable from './RoutingTable.svelte';
    import SuppressRow from './SuppressRow.svelte';
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
    /** Task 63 (D-55): every parameter raw instead of the CCU's form. */
    let expertView = $state(false);
    let previewOpen = $state(false);
    let preview = $state<WritePreview | undefined>(undefined);
    let results = $state<WriteResult[]>([]);
    let readBack = $state<ReadBackEntry[]>([]);
    let loadToken = 0;
    /**
     * Task 26 (openccu-lite 28.9): which service messages of channel 0 the HmIP server suppresses.
     * Read on its own, not with the paramset: the method exists on HmIP only, and the datapoints
     * concerned (UNREACH, LOWBAT, CONFIG_PENDING, SABOTAGE, ERROR*...) live in the VALUES paramset
     * of the maintenance channel. The MASTER dialog of that channel shows them as rows of their
     * own under the parameters, the VALUES dialog as a checkbox on their rows; both edit a local
     * map and send nothing until Apply, whose preview lists every call. `undefined` = not offered
     * here (BidCos, Homegear, a channel other than 0), and nothing of this appears.
     */
    let suppressed = $state<string[] | undefined>(undefined);
    /** The checkboxes as the user left them, by parameter; only what differs from `suppressed` counts. */
    let suppressEdits = $state<Record<string, boolean>>({});
    /** The VALUES description of channel 0, fetched for the MASTER dialog's rows (cached in the store). */
    let valuesDescription = $state<ParamsetDescription | undefined>(undefined);
    let suppressPreviewOpen = $state(false);
    let suppressPreview = $state<WritePreview | undefined>(undefined);
    let suppressBusy = $state(false);
    const hmip = $derived(isHmipInterface(interfaceName, stores.interfaces.typeOf(interfaceName)));
    const suppressible = $derived(
        open && hmip && /:0$/.test(address) && (paramset === 'MASTER' || paramset === 'VALUES'),
    );
    $effect(() => {
        if (!suppressible) {
            suppressed = undefined;
            suppressEdits = {};
            valuesDescription = undefined;
            return;
        }
        const request = {interfaceName, address, paramset};
        suppressEdits = {};
        // untracked: `describe` reads the store's description cache, and the effect must not run
        // again when that cache fills - it would ask the interface a second time for nothing
        untrack(() => {
            void stores.paramsets.suppressedServiceMessages(request.interfaceName, request.address).then((list) => {
                if (request.address === address && request.interfaceName === interfaceName) {
                    suppressed = list;
                }
            });
            if (request.paramset === 'MASTER') {
                void stores.paramsets.describe(request.interfaceName, request.address, 'VALUES').then((found) => {
                    if (request.address === address && request.interfaceName === interfaceName) {
                        valuesDescription = found;
                    }
                });
            }
        });
    });
    /** The service parameters with a suppression checkbox, in the dialog's order. */
    const serviceNames = $derived.by(() => {
        if (suppressed === undefined) {
            return [];
        }
        const source = paramset === 'VALUES' ? description : valuesDescription;
        return source ? serviceMessageParameters(source) : [];
    });
    /** The rows of the MASTER dialog: every service parameter, since none of them is in that paramset. */
    const suppressRows = $derived(paramset === 'MASTER' ? serviceNames : []);
    function isSuppressed(name: string): boolean {
        return suppressEdits[name] ?? suppressed?.includes(name) === true;
    }
    function suppressChanged(name: string): boolean {
        return name in suppressEdits && suppressEdits[name] !== (suppressed?.includes(name) === true);
    }
    const suppressDirty = $derived(serviceNames.some((name) => suppressChanged(name)));
    /** A checkbox; nothing is sent here - Apply opens the preview, and the preview sends. */
    function editSuppress(name: string, value: boolean): void {
        suppressEdits = {...suppressEdits, [name]: value};
    }
    function editSuppressAll(value: boolean): void {
        suppressEdits = Object.fromEntries(serviceNames.map((name) => [name, value]));
    }
    function openSuppressPreview(): void {
        suppressPreview = buildSuppressPreview({
            address,
            suppressed: suppressed ?? [],
            edits: suppressEdits,
            labels: {suppressed: t('suppressed'), unsuppressed: t('not suppressed')},
        });
        suppressPreviewOpen = true;
    }
    /** The confirmed calls, one per changed checkbox, then `getSuppressedServiceMessages` again. */
    async function applySuppression(): Promise<void> {
        const payload = suppressPreview;
        if (!payload) {
            return;
        }
        suppressBusy = true;
        try {
            for (const entry of payload.entries) {
                await stores.paramsets.suppressServiceMessages(
                    interfaceName,
                    address,
                    entry.param,
                    suppressEdits[entry.param] === true,
                );
            }
            suppressed = await stores.paramsets.suppressedServiceMessages(interfaceName, address);
            suppressEdits = {};
        } finally {
            suppressBusy = false;
            suppressPreviewOpen = false;
        }
    }

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
    // the expert view of task 63 shows every parameter raw, the ones an editor covers as well
    const covered = $derived(showCovered || expertView ? new Set<string>() : coveredParameters(editors));
    const shownFields = $derived(fields.filter((field) => (showHidden || field.visible) && !covered.has(field.name)));

    /**
     * Task 63 (D-55): the CCU's MASTER form of this channel type, where the data has one. Without
     * the expert view only its controls are shown; with it every parameter, raw, the form's ones
     * marked. The device editors of task 10 stay above either.
     */
    const masterForm = $derived(
        paramset === 'MASTER' && description ? easyFormOf(view?.controls, description) : undefined,
    );
    const form = $derived(expertView ? undefined : masterForm);
    const easyParams = $derived(expertView ? easyFormParams(masterForm) : new Set<string>());
    const fieldsByName = $derived(new Map(fields.map((field) => [field.name, field])));
    /**
     * The device editors of task 10 in the easy mode: one whose parameters the CCU's form already
     * edits is left out there (the duration pairs of a button channel, say, are the form's time
     * selector); the expert view shows every editor, as before.
     */
    const formParams = $derived(easyFormParams(masterForm));
    const shownEditors = $derived(
        form ? editors.filter((spec) => !spec.covers.every((param) => formParams.has(param))) : editors,
    );
    $effect(() => {
        if (open && paramset === 'MASTER') {
            void stores.meta.loadPresets();
        }
    });
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
            expertView = false;
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

<!--
    A fixed box (D-34): 900 x 720, bounded by the viewport, so the dialog is the same size whether
    the channel has three parameters or ninety, and the only thing that scrolls is the parameter
    list. It used to be as tall as its content with three nested scrolling boxes - the dialog, its
    body and the list - which is what the maintainer saw at 1280x800.
-->
<Dialog
    bind:open
    {title}
    width="900px"
    height="min(640px, calc(100vh - 32px))"
    minWidth={520}
    minHeight={320}
    testId="paramset-dialog"
>
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
            {#if masterForm}
                <label class="hmm-paramset-option">
                    <input type="checkbox" bind:checked={expertView} data-testid="paramset-expert" />
                    <span>{t('Expert view')}</span>
                </label>
            {/if}
            {#if editors.length > 0 && !form}
                <label class="hmm-paramset-option">
                    <input type="checkbox" bind:checked={showCovered} data-testid="paramset-show-covered" />
                    <span>{t('Show the raw parameters as well')}</span>
                </label>
            {/if}
            {#if fields.some((field) => !field.visible) && !form}
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

        <DeviceEditors specs={shownEditors} values={merged()} {channelType} onchange={changeMany} />

        {#if paramset === 'ROUTING_TABLE'}
            <!-- task 26: an HmIP router's table is read-only and numbered; a graph says more than rows -->
            <RoutingTable values={original} self={address.split(':')[0] ?? address} />
        {/if}
        {#if expertView && easyParams.size > 0}
            <p class="hmm-paramset-legend" data-testid="paramset-easy-legend">
                <span class="hmm-paramset-easy-swatch" aria-hidden="true"></span>{t(
                    'Marked: the parameters the easy mode of this channel shows',
                )}
            </p>
        {/if}
        <div class="hmm-paramset-list" class:hmm-paramset-raw={paramset === 'ROUTING_TABLE'}>
            {#if form && description}
                <EasyForm
                    {form}
                    fields={fieldsByName}
                    values={merged()}
                    changed={(param) => Object.prototype.hasOwnProperty.call(edited, param)}
                    {description}
                    {channelType}
                    presets={stores.meta.presets}
                    timeSelectors={stores.meta.timeSelectors}
                    onchange={changeMany}
                    testId="paramset-easy-form"
                />
            {/if}
            {#each form ? [] : shownFields as field (field.name)}
                {@const withSuppress = serviceNames.includes(field.name)}
                <div class="hmm-paramset-easy-mark" class:hmm-paramset-easy-marked={easyParams.has(field.name)}>
                    <ParameterRow
                        {field}
                        value={valueOf(field)}
                        label={labelOf(field)}
                        help={helpOf(field)}
                        changed={isChanged(field)}
                        valueLabel={(entry) => stores.meta.valueLabel(field.name, entry, channelType)}
                        onchange={(value) => change(field, value)}
                        onset={perDatapoint && field.writable ? () => void setOne(field) : undefined}
                        suppressed={withSuppress ? isSuppressed(field.name) : undefined}
                        onsuppress={withSuppress ? (value) => editSuppress(field.name, value) : undefined}
                        suppressLabel={t('suppressed')}
                        suppressTitle={t(
                            'A suppressed one reports a value that raises no message; the CCU shows it as inactive.',
                        )}
                        suppressChanged={withSuppress && suppressChanged(field.name)}
                    />
                </div>
            {/each}
            <!--
                Task 26: in the MASTER dialog of channel 0 the service datapoints are not part of
                the paramset, so their suppression gets rows of its own at the end of the table.
            -->
            {#each suppressRows as name (name)}
                <SuppressRow
                    {name}
                    suppressed={isSuppressed(name)}
                    changed={suppressChanged(name)}
                    label={t('suppressed')}
                    title={t('A suppressed one reports a value that raises no message; the CCU shows it as inactive.')}
                    onchange={(value) => editSuppress(name, value)}
                />
            {/each}
        </div>

        {#if serviceNames.length > 0}
            <!-- Task 26: the suppression is applied from here, never from a checkbox - preview first. -->
            <div class="hmm-paramset-suppress" data-testid="paramset-service-messages">
                <span class="hmm-paramset-suppress-hint"
                    >{t('Service message suppression')} — {t(
                        'Nothing is sent until Apply; the preview lists every call first.',
                    )}</span
                >
                <button
                    type="button"
                    class="hmm-button"
                    data-testid="suppress-all"
                    onclick={() => editSuppressAll(true)}>{t('Suppress all')}</button
                >
                <button
                    type="button"
                    class="hmm-button"
                    data-testid="unsuppress-all"
                    onclick={() => editSuppressAll(false)}>{t('Unsuppress all')}</button
                >
                <button
                    type="button"
                    class="hmm-button"
                    disabled={!suppressDirty || suppressBusy}
                    data-testid="suppress-apply"
                    onclick={openSuppressPreview}>{t('Apply')}</button
                >
            </div>
        {/if}

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

<!--
    Task 26: the suppression changes, previewed as the exact calls and sent only on confirmation.
    Mounted while it is open only, so the dialog has one write preview in the DOM at a time.
-->
{#if suppressPreviewOpen}
    <WritePreviewDialog
        bind:open={suppressPreviewOpen}
        preview={suppressPreview}
        paramset="VALUES"
        writing={suppressBusy}
        confirmLabel={t('Apply')}
        countText={t('{count} calls will be made', {}, suppressPreview?.entries.length ?? 0)}
        onconfirm={() => void applySuppression()}
    />
{/if}

<style>
    /* Task 63: in the expert view, the rows the easy mode shows - as in the link dialog */
    .hmm-paramset-easy-marked {
        background: var(--hmm-bg-sunken);
        box-shadow: inset 3px 0 0 var(--hmm-accent);
    }

    .hmm-paramset-legend {
        margin: 4px 0;
        font-size: var(--hmm-font-size-small);
        color: var(--hmm-fg-muted);
    }

    .hmm-paramset-easy-swatch {
        display: inline-block;
        width: 12px;
        height: 12px;
        margin-right: 6px;
        vertical-align: -1px;
        background: var(--hmm-bg-sunken);
        box-shadow: inset 3px 0 0 var(--hmm-accent);
        border: 1px solid var(--hmm-border-muted);
    }

    .hmm-paramset-top {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
        padding-bottom: 6px;
        border-bottom: 1px solid var(--hmm-border);
    }

    /* task 26: the Apply row under the table, for the suppression checkboxes above it */
    .hmm-paramset-suppress {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        padding-top: 6px;
        border-top: 1px solid var(--hmm-border);
    }

    .hmm-paramset-suppress-hint {
        flex: 1 1 auto;
        color: var(--hmm-fg-muted);
        font-size: var(--hmm-font-size-small);
    }

    /* task 26: under the routing graph the raw numbered rows stay reachable, but folded away */
    .hmm-paramset-raw {
        display: none;
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
        flex: 1 1 auto;
        /* Shrinks, but never away: a tall device editor above it makes the body scroll
           instead of squeezing the list to nothing. */
        min-height: 120px;
        overflow-y: auto;
        overflow-x: hidden;
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
