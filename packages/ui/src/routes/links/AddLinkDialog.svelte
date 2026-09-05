<script lang="ts">
    import type {DeviceDescription} from '@homematic-manager/core';
    import {canLink, linkSenders, parseRoles} from '@homematic-manager/core';

    import Dialog from '../../lib/components/Dialog.svelte';
    import MultiSelect from '../../lib/components/MultiSelect.svelte';
    import type {MultiSelectOption} from '../../lib/components/multiSelect.js';
    import {getStores} from '../../lib/stores/context.js';

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

    function option(channel: DeviceDescription): MultiSelectOption {
        const name = stores.names.name(channel.ADDRESS);
        return {
            value: channel.ADDRESS,
            label: name === undefined ? `${channel.ADDRESS} (${channel.TYPE})` : `${name} — ${channel.ADDRESS}`,
        };
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

<Dialog bind:open title={t('Create link')} width="760px" testId="add-link-dialog">
    <div class="hmm-add-link">
        <span>{t('Sender')}</span>
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
        />
        <span class="hmm-add-link-roles">LINK_SOURCE_ROLES: {sourceRoles}</span>

        <span>{t('Receiver')}</span>
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
        />
        <span class="hmm-add-link-roles">LINK_TARGET_ROLES: {targetRoles}</span>

        {#if pairs().length > 0}
            <span>{t('Name')}</span>
            <input class="hmm-input" bind:value={nameForAll} data-testid="add-link-name-all" />
            <span class="hmm-add-link-roles">{t('Used for every pair without its own name')}</span>

            <span>{t('Description')}</span>
            <input class="hmm-input" bind:value={descriptionForAll} data-testid="add-link-description-all" />
            <span></span>
        {/if}

        {#if senders.length > 0 && receiverOptions.length === 0}
            <span></span>
            <span class="hmm-add-link-empty" data-testid="add-link-none"
                >{t('No channel can receive from this sender')}</span
            >
            <span></span>
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
        grid-template-columns: 90px auto 1fr;
        gap: 8px;
        align-items: center;
    }

    .hmm-add-link-roles {
        font-family: var(--hmm-font-mono);
        font-size: var(--hmm-font-size-small);
        color: var(--hmm-fg-muted);
        overflow: hidden;
        text-overflow: ellipsis;
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
