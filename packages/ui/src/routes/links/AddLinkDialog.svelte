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
    }

    let {open = $bindable(false), onedit = undefined}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;

    let senders = $state<string[]>([]);
    let receivers = $state<string[]>([]);
    let busy = $state(false);

    const interfaceName = $derived(stores.app.selectedInterface);
    const index = $derived(stores.devices.index(interfaceName));

    $effect(() => {
        if (open) {
            senders = [];
            receivers = [];
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

    async function create(thenEdit: boolean): Promise<void> {
        busy = true;
        const created = await stores.links.add(interfaceName, senders, receivers);
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

        {#if senders.length > 0 && receiverOptions.length === 0}
            <span></span>
            <span class="hmm-add-link-empty" data-testid="add-link-none"
                >{t('No channel can receive from this sender')}</span
            >
            <span></span>
        {/if}
    </div>

    {#snippet buttons()}
        <button type="button" class="hmm-button" onclick={() => (open = false)}>{t('Cancel')}</button>
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
</style>
