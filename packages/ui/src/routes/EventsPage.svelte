<script lang="ts">
    import DataTable from '../lib/components/DataTable.svelte';
    import Toolbar from '../lib/components/Toolbar.svelte';
    import ToolbarButton from '../lib/components/ToolbarButton.svelte';
    import type {DataTableColumn} from '../lib/components/tableModel.js';
    import {getStores} from '../lib/stores/context.js';
    import type {IndexedEvent} from '../lib/stores/EventsStore.svelte.js';
    import {formatRpcValue, formatTime} from '../lib/util/format.js';

    const stores = getStores();
    const t = stores.i18n.t;

    let selected = $state<string[]>([]);

    const interfaceName = $derived(stores.app.selectedInterface);
    /**
     * The events of the selected interface, newest first - the buffer is core's, the filter is
     * core's, and both are live: a `rpc.event` from the backend bumps the store's version and this
     * list is recomputed. 2.x reloaded the whole grid on a one-second timer instead.
     */
    const events = $derived(stores.events.filtered({interfaceName}));

    const columns: DataTableColumn<IndexedEvent>[] = [
        {key: 'timestamp', label: t('Timestamp'), width: 110, value: (event) => formatTime(event.timestamp)},
        {
            key: 'name',
            label: t('Name'),
            width: 220,
            value: (event) => (event.address ? stores.nameOf(event.address) : ''),
        },
        {key: 'address', label: 'ADDRESS', width: 160, mono: true},
        {key: 'datapoint', label: 'PARAM', width: 200},
        {key: 'value', label: 'VALUE', value: (event) => formatRpcValue(event.value ?? event.payload)},
    ];
</script>

<div class="hmm-page">
    <Toolbar label={t('Events')}>
        <ToolbarButton title={t('Clear')} icon="⌫" testId="events-clear" onclick={() => void stores.events.clear()} />
        {#snippet trailing()}
            <span>{t('{count} events', {}, events.length)}</span>
        {/snippet}
    </Toolbar>

    <div class="hmm-page-grid">
        <DataTable
            rows={events}
            {columns}
            getId={(event) => String(event.seq)}
            bind:selected
            caption={t('Events')}
            filterLabel={t('Filter')}
            emptyText={t('No data')}
            testId="events-table"
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
