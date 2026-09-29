<script lang="ts">
    import type {DeviceDescription} from '@homematic-manager/core';
    import {canLink, linkSenders, parseRoles} from '@homematic-manager/core';

    import Dialog from '../../lib/components/Dialog.svelte';
    import MultiSelect from '../../lib/components/MultiSelect.svelte';
    import type {MultiSelectOption} from '../../lib/components/multiSelect.js';
    import {getStores} from '../../lib/stores/context.js';
    import {channelOption} from '../../lib/util/linkChannels.js';

    interface Props {
        open?: boolean;
        /** Called with the first created link when "Create and edit" was used. */
        onedit?: ((link: {sender: string; receiver: string}) => void) | undefined;
        /**
         * Issue #25: the channel the dialog was opened on, already chosen. Opening this from the
         * Devices tab is only an improvement if the user does not have to find the same channel
         * again in a list of two hundred.
         */
        presetSenders?: readonly string[];
        presetReceivers?: readonly string[];
    }

    let {open = $bindable(false), onedit = undefined, presetSenders = [], presetReceivers = []}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;

    let senders = $state<string[]>([]);
    let receivers = $state<string[]>([]);
    let busy = $state(false);
    /**
     * Issue #87: a name and a description **per pair**, keyed by `sender>receiver`.
     *
     * 2.7 had one name field for the whole dialog, so one wall switch against six blinds produced
     * six links with the same name and the user had to open each of them afterwards to tell them
     * apart. The two boxes below fill every empty row at once, which is what that single field was
     * good for; anything typed into a row wins over them.
     */
    let pairNames = $state<Record<string, {name: string; description: string}>>({});
    let nameForAll = $state('');
    let descriptionForAll = $state('');

    const interfaceName = $derived(stores.app.selectedInterface);
    const index = $derived(stores.devices.index(interfaceName));

    $effect(() => {
        if (open) {
            senders = [...presetSenders];
            receivers = [...presetReceivers];
            pairNames = {};
            nameForAll = '';
            descriptionForAll = '';
        }
    });

    /** Every channel that can be the sender of a link: a channel, not `:0`, with source roles. */
    const senderOptions = $derived<MultiSelectOption[]>(
        index ? linkSenders(index).map((channel) => option(channel)) : [],
    );

    /**
     * The role matrix, live: a receiver is offered when it shares a `LINK_TARGET_ROLE` with every
     * chosen sender. 2.x rebuilt two global role indexes and read the selection back out of the
     * DOM; here it is `canLink()` from core over the device index.
     */
    const receiverOptions = $derived.by<MultiSelectOption[]>(() => {
        const current = index;
        if (!current || senders.length === 0) {
            return [];
        }
        const chosen = senders
            .map((address) => current.get(address))
            .filter((channel): channel is DeviceDescription => channel !== undefined);
        return current
            .channels()
            .filter((channel) => chosen.every((entry) => canLink(entry, channel)))
            .map((channel) => option(channel));
    });

    const sourceRoles = $derived(
        [...new Set(senders.flatMap((address) => parseRoles(index?.get(address)?.LINK_SOURCE_ROLES)))].join(' '),
    );
    const targetRoles = $derived(
        [...new Set(receivers.flatMap((address) => parseRoles(index?.get(address)?.LINK_TARGET_ROLES)))].join(' '),
    );

    /** Task 31: channel name, device name, `index: TYPE` - see `channelOption`. */
    function option(channel: DeviceDescription): MultiSelectOption {
        return channelOption(channel, (address) => stores.names.name(address));
    }

    /** Every sender/receiver combination, in the order 2.x created them, with its own name. */
    function pairs(): Array<{sender: string; receiver: string; name?: string; description?: string}> {
        return senders.flatMap((sender) =>
            receivers.map((receiver) => {
                const entry = pairNames[pairKey(sender, receiver)];
                const name = entry?.name.trim() === '' || entry === undefined ? nameForAll.trim() : entry.name.trim();
                const description =
                    entry?.description.trim() === '' || entry === undefined
                        ? descriptionForAll.trim()
                        : entry.description.trim();
                return {
                    sender,
                    receiver,
                    ...(name === '' ? {} : {name}),
                    ...(description === '' ? {} : {description}),
                };
            }),
        );
    }

    function pairKey(sender: string, receiver: string): string {
        return `${sender}>${receiver}`;
    }

    function setPair(sender: string, receiver: string, field: 'name' | 'description', value: string): void {
        const key = pairKey(sender, receiver);
        const current = pairNames[key] ?? {name: '', description: ''};
        pairNames = {...pairNames, [key]: {...current, [field]: value}};
    }

    /**
     * Issue #124, in the words of the report: "ich erstelle 3 Direktverknüpfungen, und erst mit
     * einem Button Apply wird dann alles wirklich auf die Komponenten verteilt". The links are
     * remembered here and created when the change set is applied - so a user can plan a whole
     * evening's worth of links and wait for the radio once.
     */
    function stage(): void {
        const combinations = pairs();
        if (combinations.length === 0) {
            return;
        }
        stores.changeSet.stage({
            kind: 'linkAdd',
            interfaceName,
            title: t('{count} links', {}, combinations.length),
            pairs: combinations,
            calls: combinations.map(
                (pair) => `addLink(${pair.sender}, ${pair.receiver}, ${JSON.stringify(pair.name ?? '')})`,
            ),
            lines: combinations.map((pair) => ({
                label: `${stores.nameOf(pair.sender)} → ${stores.nameOf(pair.receiver)}`,
                to: pair.name ?? '',
            })),
        });
        open = false;
    }

    async function create(thenEdit: boolean): Promise<void> {
        busy = true;
        const created = await stores.links.addPairs(interfaceName, pairs());
        busy = false;
        if (created === 0) {
            return;
        }
        open = false;
        const sender = senders[0];
        const receiver = receivers[0];
        if (thenEdit && sender !== undefined && receiver !== undefined) {
            onedit?.({sender, receiver});
        }
    }
</script>

<!--
    Task 30: 650 px tall at least, so the channel lists open inside a dialog rather than in a box a
    few rows high, and wide enough for the two lists and the pair table. The window still bounds
    both, so a phone gets a dialog that fits.
-->
<!--
    Task 81: as tall as its content - it grows while a channel list is open (the lists are inline) or
    the pair table is shown, and scrolls inside past the window - and as wide as a form, with the
    name and the description taking the row's free width. Task 30's fixed 650 px floor and 920 px
    left an empty dialog down to the buttons. Its top edge stays put, so it grows downwards only.
-->
<Dialog bind:open title={t('Create link')} width="720px" top="min(12vh, 96px)" testId="add-link-dialog">
    <div class="hmm-add-link">
        <span class="hmm-add-link-label">{t('Sender')}</span>
        <div class="hmm-add-link-field">
            <MultiSelect
                options={senderOptions}
                bind:selected={senders}
                label={t('Sender')}
                placeholder={t('Select')}
                filterLabel={t('Filter')}
                checkAllLabel={t('Check all')}
                uncheckAllLabel={t('Uncheck all')}
                summary={(chosen) => t('{count} channels selected', {}, chosen.length)}
                testId="add-link-senders"
                inline
            />
            <span class="hmm-add-link-roles">LINK_SOURCE_ROLES: {sourceRoles}</span>
        </div>

        <span class="hmm-add-link-label">{t('Receiver')}</span>
        <div class="hmm-add-link-field">
            <MultiSelect
                options={receiverOptions}
                bind:selected={receivers}
                disabled={senders.length === 0}
                label={t('Receiver')}
                placeholder={senders.length === 0 ? t('Sender') : t('Select')}
                filterLabel={t('Filter')}
                checkAllLabel={t('Check all')}
                uncheckAllLabel={t('Uncheck all')}
                summary={(chosen) => t('{count} channels selected', {}, chosen.length)}
                testId="add-link-receivers"
                inline
            />
            <span class="hmm-add-link-roles">LINK_TARGET_ROLES: {targetRoles}</span>
        </div>

        {#if pairs().length > 0}
            <span class="hmm-add-link-label">{t('Name')}</span>
            <div class="hmm-add-link-field">
                <input
                    class="hmm-input hmm-add-link-input"
                    aria-label={t('Name')}
                    bind:value={nameForAll}
                    data-testid="add-link-name-all"
                />
                <span class="hmm-add-link-roles hmm-add-link-under"
                    >{t('Used for every pair without its own name')}</span
                >
            </div>

            <span class="hmm-add-link-label">{t('Description')}</span>
            <div class="hmm-add-link-field">
                <input
                    class="hmm-input hmm-add-link-input"
                    aria-label={t('Description')}
                    bind:value={descriptionForAll}
                    data-testid="add-link-description-all"
                />
            </div>
        {/if}

        {#if senders.length > 0 && receiverOptions.length === 0}
            <span></span>
            <span class="hmm-add-link-empty" data-testid="add-link-none"
                >{t('No channel can receive from this sender')}</span
            >
        {/if}
    </div>

    <!--
        Issue #87: one row per pair, so a wall switch against six blinds gives six links that can be
        told apart in the grid without opening any of them.
    -->
    {#if pairs().length > 1}
        <table class="hmm-pair-names" data-testid="add-link-pairs">
            <thead>
                <tr>
                    <th>{t('Sender')}</th>
                    <th>{t('Receiver')}</th>
                    <th>{t('Name')}</th>
                    <th>{t('Description')}</th>
                </tr>
            </thead>
            <tbody>
                {#each pairs() as pair (pairKey(pair.sender, pair.receiver))}
                    <tr data-testid={`add-link-pair-${pairKey(pair.sender, pair.receiver)}`}>
                        <td class="hmm-mono">{stores.nameOf(pair.sender)}</td>
                        <td class="hmm-mono">{stores.nameOf(pair.receiver)}</td>
                        <td>
                            <input
                                class="hmm-input"
                                aria-label={`${t('Name')} ${pair.sender} ${pair.receiver}`}
                                value={pairNames[pairKey(pair.sender, pair.receiver)]?.name ?? ''}
                                placeholder={nameForAll}
                                oninput={(event) =>
                                    setPair(pair.sender, pair.receiver, 'name', event.currentTarget.value)}
                            />
                        </td>
                        <td>
                            <input
                                class="hmm-input"
                                aria-label={`${t('Description')} ${pair.sender} ${pair.receiver}`}
                                value={pairNames[pairKey(pair.sender, pair.receiver)]?.description ?? ''}
                                placeholder={descriptionForAll}
                                oninput={(event) =>
                                    setPair(pair.sender, pair.receiver, 'description', event.currentTarget.value)}
                            />
                        </td>
                    </tr>
                {/each}
            </tbody>
        </table>
    {/if}

    {#snippet buttons()}
        <button type="button" class="hmm-button" onclick={() => (open = false)}>{t('Cancel')}</button>
        <button
            type="button"
            class="hmm-button"
            disabled={busy || receivers.length === 0}
            data-testid="add-link-stage"
            onclick={stage}>{t('Add to pending changes')}</button
        >
        <button
            type="button"
            class="hmm-button"
            disabled={busy || receivers.length === 0}
            data-testid="add-link-create"
            onclick={() => void create(false)}>{t('Create')}</button
        >
        <button
            type="button"
            class="hmm-button"
            disabled={busy || receivers.length === 0}
            data-testid="add-link-create-edit"
            onclick={() => void create(true)}>{t('Create and edit')}</button
        >
    {/snippet}
</Dialog>

<style>
    .hmm-add-link {
        display: grid;
        grid-template-columns: max-content minmax(0, 1fr);
        gap: 8px;
        align-items: start;
        /* the extra height is for the lists: more rows open than the widget's default 260 px */
        --hmm-multiselect-list-height: 400px;
        /* task 31: a channel name and a device name side by side on the first line; never wider
           than a phone leaves next to the label column */
        --hmm-multiselect-menu-min-width: min(480px, calc(100vw - 160px));
        --hmm-multiselect-menu-max-width: min(640px, calc(100vw - 160px));
    }

    /* the label on the line of the button or the input next to it, not at the top of an open list */
    .hmm-add-link-label {
        line-height: 24px;
    }

    /* Task 81: the control, then its hint beside it - or under it where the row is too narrow - and
       an open channel list on a line of its own below both. */
    .hmm-add-link-field {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        /* the first line keeps its place when a list opens under it */
        align-content: flex-start;
        gap: 4px 8px;
        min-width: 0;
    }

    .hmm-add-link-input {
        flex: 1 1 260px;
        min-width: 0;
    }

    .hmm-add-link-roles {
        min-width: 0;
        max-width: 100%;
        font-family: var(--hmm-font-mono);
        font-size: var(--hmm-font-size-small);
        color: var(--hmm-fg-muted);
        overflow-wrap: anywhere;
    }

    /* the name's hint under it, so the name is as wide as the description */
    .hmm-add-link-under {
        flex-basis: 100%;
    }

    .hmm-add-link-empty {
        color: var(--hmm-warn);
    }

    .hmm-pair-names {
        width: 100%;
        border-collapse: collapse;
        margin-top: 10px;
    }

    .hmm-pair-names th {
        text-align: left;
        font-size: var(--hmm-font-size-small);
        color: var(--hmm-fg-muted);
    }

    .hmm-pair-names td {
        padding: 2px 4px 2px 0;
    }

    .hmm-pair-names input {
        width: 100%;
    }
</style>
