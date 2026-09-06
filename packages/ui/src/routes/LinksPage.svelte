<script lang="ts">
    import type {LinkRecord} from '@homematic-manager/core';
    import {decodeLinkFlags} from '@homematic-manager/core';

    import ContextMenu from '../lib/components/ContextMenu.svelte';
    import type {ContextMenuItem} from '../lib/components/contextMenu.js';
    import DataTable from '../lib/components/DataTable.svelte';
    import DeviceImage from '../lib/components/DeviceImage.svelte';
    import ToolbarButton from '../lib/components/ToolbarButton.svelte';
    import type {DataTableColumn} from '../lib/components/tableModel.js';
    import {getStores} from '../lib/stores/context.js';

    import AddLinkDialog from './links/AddLinkDialog.svelte';
    import LinkParamsetDialog from './links/LinkParamsetDialog.svelte';
    import RemoveLinkDialog from './links/RemoveLinkDialog.svelte';

    const stores = getStores();
    const t = stores.i18n.t;

    let selected = $state<string[]>([]);
    let menuOpen = $state(false);
    let menuX = $state(0);
    let menuY = $state(0);
    let menuLink = $state<{sender: string; receiver: string} | undefined>(undefined);

    let tableFilter = $state('');
    let addOpen = $state(false);
    let removeOpen = $state(false);
    let editOpen = $state(false);
    let editSender = $state('');
    let editReceiver = $state('');

    const interfaceName = $derived(stores.app.selectedInterface);
    const interfaceType = $derived(stores.interfaces.typeOf(interfaceName));

    /** #25: "show the links of this channel" hands the address over through the app store. */
    $effect(() => {
        const handover = stores.app.linksFilter;
        if (handover !== '') {
            tableFilter = handover;
            stores.app.linksFilter = '';
        }
    });
    const links = $derived(stores.links.of(interfaceName));
    const defective = $derived(stores.links.defective(interfaceName).length);
    /** 2.x offered "play" only on BidCos-RF: only there does `activateLinkParamset` exist. */
    const canActivate = $derived(interfaceType === 'BidCos-RF');

    const selectedLinks = $derived(
        selected
            .map((id) => {
                const [sender, receiver] = id.split('->');
                return sender === undefined || receiver === undefined ? undefined : {sender, receiver};
            })
            .filter((link): link is {sender: string; receiver: string} => link !== undefined),
    );
    const one = $derived(selectedLinks.length === 1 ? selectedLinks[0] : undefined);

    /** The 2.7 link grid: sender image and name, SENDER, TYPE, receiver image and name, RECEIVER, TYPE, NAME, DESCRIPTION. */
    const columns = $derived<DataTableColumn<LinkRecord>[]>([
        {
            key: 'senderIcon',
            label: '',
            width: 24,
            fixed: true,
            sortable: false,
            filterable: false,
            align: 'center',
            value: () => '',
        },
        {
            key: 'senderName',
            label: `${t('Sender')} ${t('Name')}`,
            width: 170,
            value: (link) => stores.nameOf(link.SENDER),
        },
        {key: 'SENDER', label: 'SENDER', width: 140, mono: true},
        {
            key: 'senderType',
            label: 'TYPE',
            width: 130,
            value: (link) => stores.devices.index(interfaceName)?.get(link.SENDER)?.TYPE ?? '',
        },
        {
            key: 'receiverIcon',
            label: '',
            width: 24,
            fixed: true,
            sortable: false,
            filterable: false,
            align: 'center',
            value: () => '',
        },
        {
            key: 'receiverName',
            label: `${t('Receiver')} ${t('Name')}`,
            width: 170,
            value: (link) => stores.nameOf(link.RECEIVER),
        },
        {key: 'RECEIVER', label: 'RECEIVER', width: 140, mono: true},
        {
            key: 'receiverType',
            label: 'TYPE',
            width: 130,
            value: (link) => stores.devices.index(interfaceName)?.get(link.RECEIVER)?.TYPE ?? '',
        },
        {
            key: 'FLAGS',
            label: 'FLAGS',
            width: 48,
            fixed: true,
            align: 'center',
            sortable: false,
            value: (link) => (decodeLinkFlags(link.FLAGS).broken ? 'broken' : ''),
        },
        {key: 'NAME', label: 'NAME', width: 180},
        {key: 'DESCRIPTION', label: 'DESCRIPTION'},
    ]);

    function deviceTypeOf(address: string): string {
        const index = stores.devices.index(interfaceName);
        return index?.parentOf(address)?.TYPE ?? index?.get(address)?.TYPE ?? '';
    }

    function openEdit(link: {sender: string; receiver: string}): void {
        editSender = link.sender;
        editReceiver = link.receiver;
        editOpen = true;
    }

    function openMenu(link: LinkRecord, event: MouseEvent): void {
        menuLink = {sender: link.SENDER, receiver: link.RECEIVER};
        menuX = event.clientX;
        menuY = event.clientY;
        menuOpen = true;
    }

    const menuItems = $derived<ContextMenuItem[]>([
        {id: 'edit', label: t('Edit link')},
        {id: 'short', label: t('Activate short'), disabled: !canActivate},
        {id: 'long', label: t('Activate long'), disabled: !canActivate},
        {id: 'sep', separator: true},
        {id: 'delete', label: t('Delete link'), danger: true},
    ]);

    async function onMenuSelect(id: string): Promise<void> {
        const link = menuLink;
        if (!link) {
            return;
        }
        switch (id) {
            case 'edit':
                openEdit(link);
                break;
            case 'short':
                await stores.links.activate(interfaceName, link.receiver, link.sender, false);
                break;
            case 'long':
                await stores.links.activate(interfaceName, link.receiver, link.sender, true);
                break;
            case 'delete':
                selected = [`${link.sender}->${link.receiver}`];
                removeOpen = true;
                break;
            default:
                break;
        }
    }
</script>

<div class="hmm-page">
    <div class="hmm-page-grid">
        <DataTable
            rows={links}
            {columns}
            getId={(link) => `${link.SENDER}->${link.RECEIVER}`}
            bind:selected
            bind:filter={tableFilter}
            caption={t('Links')}
            filterLabel={t('Filter')}
            emptyText={t('No data')}
            onactivate={(link) => openEdit({sender: link.SENDER, receiver: link.RECEIVER})}
            onrowcontextmenu={openMenu}
            toolbarLabel={t('Links')}
            countText={t('{count} links', {}, links.length)}
            testId="links-table"
        >
            {#snippet toolbar()}
                <ToolbarButton title={t('Create link')} icon="+" testId="links-add" onclick={() => (addOpen = true)} />
                <ToolbarButton
                    title={t('Edit link')}
                    icon="⚙"
                    disabled={one === undefined}
                    reason={t('Select one link')}
                    testId="links-edit"
                    onclick={() => one && openEdit(one)}
                />
                {#if canActivate}
                    <ToolbarButton
                        title={t('Activate short')}
                        icon="▸"
                        disabled={one === undefined}
                        reason={t('Select one link')}
                        testId="links-play-short"
                        onclick={() =>
                            one && void stores.links.activate(interfaceName, one.receiver, one.sender, false)}
                    />
                    <ToolbarButton
                        title={t('Activate long')}
                        icon="▸▸"
                        disabled={one === undefined}
                        reason={t('Select one link')}
                        testId="links-play-long"
                        onclick={() => one && void stores.links.activate(interfaceName, one.receiver, one.sender, true)}
                    />
                {/if}
                <ToolbarButton
                    title={t('Delete link')}
                    icon="🗑"
                    disabled={selectedLinks.length === 0}
                    reason={t('Please choose one or more links')}
                    testId="links-delete"
                    onclick={() => (removeOpen = true)}
                />
                <ToolbarButton
                    title={t('Refresh')}
                    icon="⟳"
                    testId="links-refresh"
                    onclick={() => void stores.links.load(interfaceName)}
                />
            {/snippet}

            {#snippet status()}
                {#if defective > 0}
                    <span class="hmm-links-defective" data-testid="links-defective"
                        >{t('{count} defective links', {}, defective)}</span
                    >
                {/if}
            {/snippet}

            {#snippet cell(row, column)}
                {#if column.key === 'senderIcon'}
                    <DeviceImage
                        deviceType={deviceTypeOf(row.SENDER)}
                        src={stores.host.deviceImageUrl(deviceTypeOf(row.SENDER))}
                    />
                {:else if column.key === 'receiverIcon'}
                    <DeviceImage
                        deviceType={deviceTypeOf(row.RECEIVER)}
                        src={stores.host.deviceImageUrl(deviceTypeOf(row.RECEIVER))}
                    />
                {:else if column.key === 'FLAGS'}
                    {@const flags = decodeLinkFlags(row.FLAGS)}
                    {#if flags.broken}
                        <span
                            class="hmm-link-broken"
                            role="img"
                            aria-label={t('Defective link')}
                            title={`${flags.senderBroken ? 'SENDER_BROKEN ' : ''}${
                                flags.receiverBroken ? 'RECEIVER_BROKEN' : ''
                            }`.trim()}>⚠</span
                        >
                    {/if}
                {:else}
                    {column.value
                        ? (column.value(row) ?? '')
                        : ((row as unknown as Record<string, string>)[column.key] ?? '')}
                {/if}
            {/snippet}
        </DataTable>
    </div>
</div>

<ContextMenu
    bind:open={menuOpen}
    items={menuItems}
    x={menuX}
    y={menuY}
    label={t('Links')}
    testId="links-menu"
    onselect={(id) => void onMenuSelect(id)}
/>

<AddLinkDialog bind:open={addOpen} onedit={(link) => openEdit(link)} />
<RemoveLinkDialog bind:open={removeOpen} links={selectedLinks} />
<LinkParamsetDialog bind:open={editOpen} sender={editSender} receiver={editReceiver} />

<style>
    .hmm-page {
        display: flex;
        flex-direction: column;
        gap: 6px;
        height: 100%;
        min-height: 0;
    }

    .hmm-page-grid {
        flex: 1 1 auto;
        min-height: 0;
    }

    .hmm-links-defective {
        color: var(--hmm-error);
    }

    .hmm-link-broken {
        color: var(--hmm-error);
    }
</style>
