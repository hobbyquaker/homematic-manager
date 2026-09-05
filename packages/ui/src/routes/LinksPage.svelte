<script lang="ts">
    import type {LinkRecord} from '@homematic-manager/core';

    import DataTable from '../lib/components/DataTable.svelte';
    import Toolbar from '../lib/components/Toolbar.svelte';
    import ToolbarButton from '../lib/components/ToolbarButton.svelte';
    import type {DataTableColumn} from '../lib/components/tableModel.js';
    import {getStores} from '../lib/stores/context.js';

    const stores = getStores();
    const t = stores.i18n.t;

    let selected = $state<string[]>([]);

    const interfaceName = $derived(stores.app.selectedInterface);
    const interfaceType = $derived(stores.interfaces.typeOf(interfaceName));
    const links = $derived(stores.links.of(interfaceName));
    const todo = $derived(t('Comes with task 8'));

    /** The 2.7 link grid: sender name, sender, type, receiver name, receiver, type, name, description. */
    const columns = $derived<DataTableColumn<LinkRecord>[]>([
        {
            key: 'senderName',
            label: `${t('Sender')} ${t('Name')}`,
            width: 180,
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
            key: 'receiverName',
            label: `${t('Receiver')} ${t('Name')}`,
            width: 180,
            value: (link) => stores.nameOf(link.RECEIVER),
        },
        {key: 'RECEIVER', label: 'RECEIVER', width: 140, mono: true},
        {
            key: 'receiverType',
            label: 'TYPE',
            width: 130,
            value: (link) => stores.devices.index(interfaceName)?.get(link.RECEIVER)?.TYPE ?? '',
        },
        {key: 'NAME', label: 'NAME', width: 200},
        {key: 'DESCRIPTION', label: 'DESCRIPTION'},
    ]);
</script>

<div class="hmm-page">
    <Toolbar label={t('Links')}>
        <ToolbarButton title={t('Create link')} icon="+" disabled reason={todo} />
        <ToolbarButton title={t('Edit link')} icon="⚙" disabled reason={todo} />
        <!-- 2.x hid "play" for everything but BidCos-RF: only there does activateLinkParamset exist. -->
        {#if interfaceType === 'BidCos-RF'}
            <ToolbarButton title={t('Activate short')} icon="▸" disabled reason={todo} />
            <ToolbarButton title={t('Activate long')} icon="▸▸" disabled reason={todo} />
        {/if}
        <ToolbarButton title={t('Delete link')} icon="🗑" disabled reason={todo} />
        <ToolbarButton
            title={t('Refresh')}
            icon="⟳"
            testId="links-refresh"
            onclick={() => void stores.links.load(interfaceName)}
        />
        {#snippet trailing()}
            <span>{t('{count} links', {}, links.length)}</span>
        {/snippet}
    </Toolbar>

    <div class="hmm-page-grid">
        <DataTable
            rows={links}
            {columns}
            getId={(link) => `${link.SENDER}->${link.RECEIVER}`}
            bind:selected
            caption={t('Links')}
            filterLabel={t('Filter')}
            emptyText={t('No data')}
            testId="links-table"
        />
    </div>
</div>

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
</style>
