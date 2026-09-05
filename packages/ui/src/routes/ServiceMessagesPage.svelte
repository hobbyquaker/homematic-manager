<script lang="ts">
    import type {ServiceMessage} from '@homematic-manager/core';

    import DataTable from '../lib/components/DataTable.svelte';
    import Toolbar from '../lib/components/Toolbar.svelte';
    import ToolbarButton from '../lib/components/ToolbarButton.svelte';
    import type {DataTableColumn} from '../lib/components/tableModel.js';
    import {getStores} from '../lib/stores/context.js';
    import {formatDateTime, formatRpcValue} from '../lib/util/format.js';

    const stores = getStores();
    const t = stores.i18n.t;

    let selected = $state<string[]>([]);

    const interfaceName = $derived(stores.app.selectedInterface);
    const messages = $derived(stores.serviceMessages.of(interfaceName));
    const todo = $derived(t('Comes with task 8'));

    const columns = $derived<DataTableColumn<ServiceMessage>[]>([
        {key: 'name', label: t('Name'), width: 220, value: (message) => stores.nameOf(message.address)},
        {key: 'address', label: 'ADDRESS', width: 160, mono: true},
        {key: 'datapoint', label: t('Message'), width: 200},
        {key: 'value', label: t('Value'), width: 100, value: (message) => formatRpcValue(message.value)},
        {key: 'since', label: t('Since'), value: (message) => formatDateTime(message.since)},
    ]);
</script>

<div class="hmm-page">
    <Toolbar label={t('Service messages')}>
        <ToolbarButton
            title={t('Refresh')}
            icon="⟳"
            testId="messages-refresh"
            onclick={() => void stores.serviceMessages.load()}
        />
        <ToolbarButton title={t('Acknowledge service messages')} icon="✔" disabled reason={todo} />
        <ToolbarButton title={t('Acknowledge all service messages')} icon="✔✔" disabled reason={todo} />
        {#snippet trailing()}
            <span>{t('{count} service messages', {}, messages.length)}</span>
        {/snippet}
    </Toolbar>

    <div class="hmm-page-grid">
        <DataTable
            rows={messages}
            {columns}
            getId={(message) => `${message.address}/${message.datapoint}`}
            bind:selected
            caption={t('Service messages')}
            filterLabel={t('Filter')}
            emptyText={t('No data')}
            testId="messages-table"
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
