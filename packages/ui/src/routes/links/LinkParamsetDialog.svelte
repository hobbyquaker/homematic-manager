<script lang="ts">
    import type {
        LinkProfile,
        LinkSenderMetadata,
        LinkTemplate,
        Paramset,
        ParamsetDescription,
        ParamsetValue,
        WriteResult,
    } from '@homematic-manager/core';
    import {EXPERT_PROFILE_ID, paramsetIdentity} from '@homematic-manager/core';

    import Dialog from '../../lib/components/Dialog.svelte';
    import MultiSelect from '../../lib/components/MultiSelect.svelte';
    import type {MultiSelectOption} from '../../lib/components/multiSelect.js';
    import {getStores} from '../../lib/stores/context.js';
    import {linkFields, profileDescription, profileLabel, type LinkField} from '../../lib/util/linkForm.js';
    import {
        buildPreview,
        readBack as computeReadBack,
        type ReadBackEntry,
        type WritePreview,
    } from '../../lib/util/paramsetForm.js';
    import ParameterRow from '../paramset/ParameterRow.svelte';
    import WritePreviewDialog from '../paramset/WritePreviewDialog.svelte';

    interface Props {
        open?: boolean;
        sender?: string;
        receiver?: string;
    }

    let {open = $bindable(false), sender = '', receiver = ''}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;

    let receiverDescription = $state<ParamsetDescription | undefined>(undefined);
    let receiverValues = $state<Paramset>({});
    let senderDescription = $state<ParamsetDescription | undefined>(undefined);
    let senderValues = $state<Paramset>({});
    let edited = $state<Record<string, unknown>>({});
    let senderEdited = $state<Record<string, unknown>>({});
    let profiles = $state<LinkProfile[]>([]);
    let metadata = $state<LinkSenderMetadata | undefined>(undefined);
    let profileId = $state(EXPERT_PROFILE_ID);
    let expert = $state(false);
    let senderOpen = $state(false);
    let linkName = $state('');
    let linkDescription = $state('');
    let targets = $state<string[]>([]);
    let previewOpen = $state(false);
    let preview = $state<WritePreview | undefined>(undefined);
    let results = $state<WriteResult[]>([]);
    let readBack = $state<ReadBackEntry[]>([]);
    let loading = $state(false);
    let loadToken = 0;
    /** Issue #21: the name the current values would be saved under, and the chosen template. */
    let templateName = $state('');
    let templateChoice = $state('');

    const interfaceName = $derived(stores.app.selectedInterface);
    const index = $derived(stores.devices.index(interfaceName));
    const senderType = $derived(index?.get(sender)?.TYPE ?? '');
    const receiverType = $derived(index?.get(receiver)?.TYPE ?? '');
    const title = $derived(`${stores.nameOf(sender)} → ${stores.nameOf(receiver)} (${sender} ${receiver})`);
    const profile = $derived(profiles.find((entry) => entry.id === profileId));

    /**
     * Issue #21: what makes two links interchangeable.
     *
     * Both `LINK` paramset identities, joined - device type, firmware, version and channel type on
     * each side. A template may only be applied where this matches, for the same reason multi-apply
     * is limited that way (task 6, item 3): the same parameter can mean something else on another
     * firmware, and `putParamset` takes both without a word.
     */
    const templateIdentity = $derived.by(() => {
        const current = index;
        const receiverChannel = current?.get(receiver);
        const senderChannel = current?.get(sender);
        if (!current || !receiverChannel || !senderChannel) {
            return '';
        }
        const receiverDevice = current.get(receiverChannel.PARENT ?? '');
        const senderDevice = current.get(senderChannel.PARENT ?? '');
        if (!receiverDevice || !senderDevice) {
            return '';
        }
        return [
            paramsetIdentity(interfaceName, receiverChannel, 'LINK', receiverDevice),
            paramsetIdentity(interfaceName, senderChannel, 'LINK', senderDevice),
        ].join('|');
    });

    const templates = $derived(stores.links.templates.filter((entry) => entry.identity === templateIdentity));

    const fields = $derived<LinkField[]>(
        receiverDescription
            ? linkFields(receiverDescription, {metadata, presets: stores.meta.presets, profile, expert})
            : [],
    );
    const senderFields = $derived<LinkField[]>(senderDescription ? linkFields(senderDescription, {expert: true}) : []);

    /** Other links of the same sender and receiver channel types - the 2.x multi-select. */
    const targetOptions = $derived<MultiSelectOption[]>(
        stores.links
            .of(interfaceName)
            .filter(
                (link) =>
                    !(link.SENDER === sender && link.RECEIVER === receiver) &&
                    (index?.get(link.SENDER)?.TYPE ?? '') === senderType &&
                    (index?.get(link.RECEIVER)?.TYPE ?? '') === receiverType,
            )
            .map((link) => ({
                value: `${link.SENDER};${link.RECEIVER}`,
                label: `${stores.nameOf(link.SENDER)} → ${stores.nameOf(link.RECEIVER)}`,
            })),
    );

    $effect(() => {
        if (!open || interfaceName === '' || sender === '' || receiver === '') {
            return;
        }
        const token = (loadToken += 1);
        const request = {interfaceName, sender, receiver};
        loading = true;
        void (async () => {
            const [receiverDesc, receiverParamset, senderDesc, senderParamset, info] = await Promise.all([
                stores.paramsets.describe(request.interfaceName, request.receiver, 'LINK'),
                // A LINK paramset is read with the peer address in place of the paramset name.
                stores.paramsets.read(request.interfaceName, request.receiver, request.sender),
                stores.paramsets.describe(request.interfaceName, request.sender, 'LINK'),
                stores.paramsets.read(request.interfaceName, request.sender, request.receiver),
                stores.links.info(request.interfaceName, request.sender, request.receiver),
            ]);
            if (token !== loadToken) {
                return;
            }
            receiverDescription = receiverDesc;
            receiverValues = receiverParamset ?? {};
            senderDescription = senderDesc;
            senderValues = senderParamset ?? {};
            linkName = info?.NAME ?? '';
            linkDescription = info?.DESCRIPTION ?? '';
            edited = {};
            senderEdited = {};
            targets = [];
            results = [];
            readBack = [];
            loading = false;
        })();
    });

    /** The profiles of this receiver/sender pair, plus the metadata that orders the easy mode. */
    $effect(() => {
        if (!open || receiverType === '' || senderType === '') {
            return;
        }
        void Promise.all([
            stores.meta.profilesFor(receiverType, senderType),
            stores.meta.linkMetadataFor(receiverType, senderType),
            stores.meta.loadPresets(),
        ]).then(([list, meta]) => {
            profiles = list;
            metadata = meta;
        });
    });

    /**
     * Which profile the stored values follow: `UI_HINT` first, then the fixed parameters.
     *
     * Once per link, and never again - `detectedFor` is a plain variable on purpose, so that the
     * effect neither depends on it nor detects a second time after the user has picked a profile
     * (which would put the dropdown straight back to where it was).
     */
    let detectedFor = '';
    $effect(() => {
        const key = `${sender}|${receiver}|${String(profiles.length)}`;
        if (profiles.length === 0 || receiverDescription === undefined || detectedFor === key) {
            return;
        }
        detectedFor = key;
        const detected = stores.meta.engine.detectProfile(receiverValues, profiles);
        profileId = detected?.id ?? EXPERT_PROFILE_ID;
        expert = profileId === EXPERT_PROFILE_ID;
    });

    /** #21: the templates that fit this link, re-read whenever the link changes. */
    $effect(() => {
        const identity = templateIdentity;
        if (open && identity !== '') {
            void stores.links.loadTemplates(identity);
        }
    });

    /**
     * Saves the profile and the values as they stand right now - what is on screen, which is the
     * receiver's stored values with the edits on top, plus the sender's where it has any. The
     * profile id goes along so the dialog can show which easy mode a template belongs to.
     */
    async function saveTemplate(): Promise<void> {
        const name = templateName.trim();
        if (name === '' || templateIdentity === '' || !receiverDescription) {
            return;
        }
        const receiverPayload = buildPreview(receiverValues, edited, receiverDescription, {
            interfaceName,
            targets: [receiver],
            writeAll: true,
        }).values;
        const senderPayload = senderDescription
            ? buildPreview(senderValues, senderEdited, senderDescription, {
                  interfaceName,
                  targets: [sender],
                  writeAll: true,
              }).values
            : {};
        const template: LinkTemplate = {
            name,
            identity: templateIdentity,
            ...(profile === undefined
                ? {}
                : {profileId: profile.id, profileName: profileLabel(profile, stores.i18n.language)}),
            receiver: receiverPayload,
            ...(Object.keys(senderPayload).length > 0 ? {sender: senderPayload} : {}),
            createdAt: Date.now(),
        };
        if (await stores.links.saveTemplate(template)) {
            templateName = '';
            templateChoice = name;
            stores.notices.push('info', `${t('Save as template')}: ${name}`);
        }
    }

    /**
     * Applies a template: its values become edits, exactly as if they had been typed in. Nothing is
     * written - the preview and the Write button are still what sends anything, and the change set
     * of #124 can take it instead.
     */
    function applyTemplate(name: string): void {
        const chosen = templates.find((entry) => entry.name === name);
        if (!chosen) {
            return;
        }
        if (chosen.profileId !== undefined && profiles.some((entry) => entry.id === chosen.profileId)) {
            profileId = chosen.profileId;
            expert = profileId === EXPERT_PROFILE_ID;
        }
        edited = {...edited, ...chosen.receiver};
        if (chosen.sender) {
            senderEdited = {...senderEdited, ...chosen.sender};
        }
    }

    function chooseProfile(id: number): void {
        profileId = id;
        expert = id === EXPERT_PROFILE_ID;
        const chosen = profiles.find((entry) => entry.id === id);
        if (!chosen || !receiverDescription) {
            return;
        }
        // `applyProfile` also sets UI_HINT, which is what makes the CCU's WebUI recognise the
        // profile afterwards instead of calling the link "expert" (task 6, item 5a).
        const applied = stores.meta.engine.applyProfile(chosen, merged(), receiverDescription);
        edited = {...edited, ...applied.values};
        for (const problem of applied.problems) {
            stores.notices.push('warn', `${problem.param}: ${problem.message}`);
        }
    }

    function merged(): Paramset {
        const values: Record<string, ParamsetValue> = {...receiverValues};
        for (const [param, value] of Object.entries(edited)) {
            if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
                values[param] = value;
            }
        }
        return values;
    }

    function valueOf(field: LinkField, values: Paramset, changes: Record<string, unknown>): unknown {
        if (Object.prototype.hasOwnProperty.call(changes, field.name)) {
            return changes[field.name];
        }
        return values[field.name] ?? field.description.DEFAULT;
    }

    async function saveInfo(): Promise<void> {
        await stores.links.setInfo(interfaceName, sender, receiver, linkName, linkDescription);
    }

    function links(): Array<{sender: string; receiver: string}> {
        const chosen = targets.map((entry) => {
            const [s, r] = entry.split(';');
            return {sender: s ?? '', receiver: r ?? ''};
        });
        return [{sender, receiver}, ...chosen];
    }

    function openPreview(): void {
        if (!receiverDescription) {
            return;
        }
        results = [];
        preview = buildPreview(receiverValues, edited, receiverDescription, {
            interfaceName,
            targets: links().map((link) => `${link.receiver}←${link.sender}`),
        });
        previewOpen = true;
    }

    /**
     * Issue #124 for a link paramset. The user's complaint was about links specifically - three
     * direct links meant three waits - so this is the entry point that matters most: the payload
     * of both directions goes into the change set and nothing is sent.
     */
    function stage(): void {
        const payload = preview;
        if (!payload) {
            return;
        }
        const senderPayload = senderDescription
            ? buildPreview(senderValues, senderEdited, senderDescription, {interfaceName, targets: [sender]}).values
            : {};
        const values = {
            receiverToSender: payload.values,
            ...(Object.keys(senderPayload).length > 0 ? {senderToReceiver: senderPayload} : {}),
        };
        if (Object.keys(payload.values).length === 0 && Object.keys(senderPayload).length === 0) {
            return;
        }
        const pairs = links();
        stores.changeSet.stage({
            kind: 'linkParamset',
            interfaceName,
            title: `LINK — ${stores.nameOf(sender)} → ${stores.nameOf(receiver)}`,
            links: pairs,
            values,
            calls: pairs.map(
                (pair) => `putParamset(${pair.receiver}, ${pair.sender}, ${JSON.stringify(values.receiverToSender)})`,
            ),
            lines: payload.entries.map((entry) => ({label: entry.param, from: entry.from, to: entry.to})),
        });
        previewOpen = false;
        open = false;
    }

    async function write(): Promise<void> {
        const payload = preview;
        if (!payload) {
            return;
        }
        const senderPayload = senderDescription
            ? buildPreview(senderValues, senderEdited, senderDescription, {interfaceName, targets: [sender]}).values
            : {};
        const written = await stores.paramsets.putLink(interfaceName, links(), {
            receiverToSender: payload.values,
            ...(Object.keys(senderPayload).length > 0 ? {senderToReceiver: senderPayload} : {}),
        });
        results = written;
        // `ok` means nothing on BidCos: read back what the interface really stored (task 6).
        const reread = await stores.paramsets.read(interfaceName, receiver, sender);
        if (reread && receiverDescription) {
            readBack = computeReadBack(payload.values, reread, receiverDescription);
            receiverValues = reread;
            edited = {};
            senderEdited = {};
        }
        if (written.length > 0 && written.every((result) => result.ok) && !readBack.some((entry) => entry.differs)) {
            previewOpen = false;
        }
    }
</script>

<Dialog
    bind:open
    {title}
    width="960px"
    height="min(640px, calc(100vh - 32px))"
    minWidth={560}
    minHeight={320}
    testId="link-paramset-dialog"
>
    {#if loading && !receiverDescription}
        <p>{t('Loading Homematic Manager...')}</p>
    {:else if !receiverDescription}
        <p data-testid="link-paramset-failed">{t('No data')}</p>
    {:else}
        <div class="hmm-link-info">
            <label>
                <span>{t('Name')}</span>
                <input class="hmm-input" bind:value={linkName} data-testid="link-name" />
            </label>
            <label>
                <span>DESCRIPTION</span>
                <input class="hmm-input" bind:value={linkDescription} data-testid="link-description" />
            </label>
            <button type="button" class="hmm-button" data-testid="link-info-save" onclick={() => void saveInfo()}
                >{t('Apply')}</button
            >
        </div>

        {#if targetOptions.length > 0}
            <div class="hmm-link-targets">
                <MultiSelect
                    options={targetOptions}
                    bind:selected={targets}
                    label={t('Please choose one or more links')}
                    placeholder={t('Please choose one or more links')}
                    filterLabel={t('Filter')}
                    checkAllLabel={t('Check all')}
                    uncheckAllLabel={t('Uncheck all')}
                    summary={(chosen) => t('{count} links', {}, chosen.length)}
                    testId="link-targets"
                />
            </div>
        {/if}

        <section class="hmm-link-section">
            <h4>
                <button
                    type="button"
                    class="hmm-link-toggle"
                    aria-expanded={senderOpen}
                    data-testid="link-sender-toggle"
                    onclick={() => (senderOpen = !senderOpen)}>{senderOpen ? '−' : '+'}</button
                >
                {t('Sender')}: {stores.nameOf(sender)} ({sender})
            </h4>
            {#if senderOpen}
                <div class="hmm-link-list" data-testid="link-sender-params">
                    {#each senderFields as field (field.name)}
                        <ParameterRow
                            {field}
                            value={valueOf(field, senderValues, senderEdited)}
                            label={stores.meta.parameterLabel(field.name, senderType)}
                            help={stores.meta.parameterHelp(field.name, senderType)}
                            changed={Object.prototype.hasOwnProperty.call(senderEdited, field.name)}
                            valueLabel={(entry) => stores.meta.valueLabel(field.name, entry, senderType)}
                            onchange={(value) => (senderEdited = {...senderEdited, [field.name]: value})}
                        />
                    {/each}
                </div>
            {/if}
        </section>

        <section class="hmm-link-section">
            <h4>{t('Receiver')}: {stores.nameOf(receiver)} ({receiver})</h4>

            <!--
                Three stacked blocks, not one long flex row (D-34): the profile picker, the
                profile's description *underneath* the picker it explains, and the template
                controls. As one row the description sat to the right of the selector and the last
                two buttons were pushed out of the dialog.
            -->
            <div class="hmm-link-profile">
                <div class="hmm-link-row">
                    <label>
                        <span>{t('Profile')}</span>
                        <select
                            class="hmm-select"
                            data-testid="link-profile"
                            value={String(profileId)}
                            onchange={(event) => chooseProfile(Number(event.currentTarget.value))}
                        >
                            {#each profiles as entry (entry.id)}
                                <option value={String(entry.id)}>{profileLabel(entry, stores.i18n.language)}</option>
                            {/each}
                        </select>
                    </label>
                    <label class="hmm-link-expert">
                        <input type="checkbox" bind:checked={expert} data-testid="link-expert" />
                        <span>{t('Expert view')}</span>
                    </label>
                </div>

                {#if profile && !expert}
                    <p class="hmm-link-profile-text" data-testid="link-profile-description">
                        {profileDescription(profile, stores.i18n.language)}
                    </p>
                {/if}

                <div class="hmm-link-row">
                    <!--
                    Issue #21: the profile of the metadata plus the values it was tuned to, under a
                    name. Only templates of the same description identity are offered; applying one
                    fills the form and writes nothing.
                -->
                    <label>
                        <span>{t('Template')}</span>
                        <select
                            class="hmm-select"
                            data-testid="link-template"
                            disabled={templates.length === 0}
                            value={templateChoice}
                            onchange={(event) => {
                                templateChoice = event.currentTarget.value;
                                applyTemplate(templateChoice);
                            }}
                        >
                            <option value=""
                                >{templates.length === 0
                                    ? t('No template for this pair of channel types')
                                    : t('Apply template')}</option
                            >
                            {#each templates as entry (entry.name)}
                                <option value={entry.name}
                                    >{entry.name}{entry.profileName === undefined
                                        ? ''
                                        : ` — ${entry.profileName}`}</option
                                >
                            {/each}
                        </select>
                    </label>
                    <label>
                        <span>{t('Template name')}</span>
                        <input class="hmm-input" bind:value={templateName} data-testid="link-template-name" />
                    </label>
                    <button
                        type="button"
                        class="hmm-button"
                        disabled={templateName.trim() === '' || templateIdentity === ''}
                        data-testid="link-template-save"
                        onclick={() => void saveTemplate()}>{t('Save as template')}</button
                    >
                    <button
                        type="button"
                        class="hmm-button"
                        disabled={templateChoice === ''}
                        data-testid="link-template-delete"
                        onclick={() => {
                            const name = templateChoice;
                            templateChoice = '';
                            void stores.links.removeTemplate(name, templateIdentity);
                        }}>{t('Delete template')}</button
                    >
                </div>
            </div>

            <div class="hmm-link-list" data-testid="link-receiver-params">
                {#each fields as field (field.name)}
                    <ParameterRow
                        {field}
                        value={valueOf(field, receiverValues, edited)}
                        label={stores.meta.parameterLabel(field.name, receiverType)}
                        help={stores.meta.parameterHelp(field.name, receiverType)}
                        changed={Object.prototype.hasOwnProperty.call(edited, field.name)}
                        disabled={field.fixedByProfile}
                        valueLabel={(entry) => stores.meta.valueLabel(field.name, entry, receiverType)}
                        onchange={(value) => (edited = {...edited, [field.name]: value})}
                    />
                {/each}
            </div>
        </section>

        {#if results.length > 0}
            <ul class="hmm-link-results" data-testid="link-results">
                {#each results as result (`${result.address}-${result.peer ?? ''}`)}
                    <li class:hmm-link-failed={!result.ok}>
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
            disabled={!receiverDescription}
            data-testid="link-preview"
            onclick={openPreview}>{t('Preview')}</button
        >
    {/snippet}
</Dialog>

<WritePreviewDialog
    bind:open={previewOpen}
    {preview}
    paramset="LINK"
    {results}
    {readBack}
    writing={stores.paramsets.writing}
    onstage={stage}
    onconfirm={() => void write()}
/>

<style>
    .hmm-link-info {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: flex-end;
        padding-bottom: 6px;
        border-bottom: 1px solid var(--hmm-border);
    }

    .hmm-link-info label {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1 1 auto;
    }

    .hmm-link-targets {
        padding: 6px 0;
    }

    .hmm-link-section h4 {
        margin: 8px 0 4px;
    }

    .hmm-link-toggle {
        width: 18px;
        height: 18px;
        padding: 0;
        border: 1px solid var(--hmm-border);
        border-radius: 2px;
        background: var(--hmm-bg);
        cursor: pointer;
        line-height: 1;
    }

    .hmm-link-profile {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding-bottom: 6px;
    }

    .hmm-link-row {
        display: flex;
        align-items: center;
        gap: 12px;
        /* Nothing leaves the dialog sideways: a narrow window puts the template controls on a
           second line instead of pushing the last button past the right edge. */
        flex-wrap: wrap;
        min-width: 0;
    }

    .hmm-link-row label {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .hmm-link-expert {
        white-space: nowrap;
    }

    .hmm-link-profile-text {
        margin: 0;
        color: var(--hmm-fg-muted);
    }

    .hmm-link-list {
        flex: 1 1 auto;
        /* Shrinks, but never away: a tall device editor above it makes the body scroll
           instead of squeezing the list to nothing. */
        min-height: 120px;
        overflow-y: auto;
        overflow-x: hidden;
    }

    .hmm-link-results {
        margin: 6px 0 0;
        padding-left: 18px;
        color: var(--hmm-ok);
    }

    .hmm-link-failed {
        color: var(--hmm-error);
    }
</style>
