<script lang="ts">
    import type {EventFilter} from '@homematic-manager/core';

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
    let addressFilter = $state('');
    let datapointFilter = $state('');
    let paused = $state(false);
    /** The rows as they were when the pause started, so a busy CCU stops scrolling them away. */
    let frozen = $state<IndexedEvent[]>([]);

    const interfaceName = $derived(stores.app.selectedInterface);

    /**
     * The filter is core's, so "which events match" is the same rule everywhere. The two boxes are
     * the ones 2.x had in its filter toolbar; the counter column is issue #129.
     */
    const filter = $derived<EventFilter>({
        interfaceName,
        ...(addressFilter.trim() === '' ? {} : {address: addressFilter.trim()}),
        ...(datapointFilter.trim() === '' ? {} : {datapoint: datapointFilter.trim()}),
    });

    const live = $derived(stores.events.filtered(filter));
    const events = $derived(paused ? frozen : live);

    const columns = $derived<DataTableColumn<IndexedEvent>[]>([
        {key: 'timestamp', label: t('Timestamp'), width: 110, value: (event) => formatTime(event.timestamp)},
        {key: 'method', label: t('Method'), width: 110},
        {
            key: 'name',
            label: t('Name'),
            width: 200,
            value: (event) => (event.address === undefined ? '' : stores.nameOf(event.address)),
        },
        {key: 'address', label: 'ADDRESS', width: 150, mono: true},
        {key: 'datapoint', label: 'PARAM', width: 180},
        {key: 'value', label: 'VALUE', width: 140, value: (event) => formatRpcValue(event.value ?? event.payload)},
        {
            key: 'count',
            label: t('Events per device'),
            width: 120,
            align: 'right',
            filterable: false,
            // #129: how often this address has spoken since the buffer was cleared - the column
            // that makes a chattering device visible without exporting the log.
            value: (event) => (event.address === undefined ? '' : stores.events.countFor(event.address)),
        },
    ]);

    function togglePause(): void {
        frozen = paused ? [] : [...live];
        paused = !paused;
    }
</script>

<div class="hmm-page">
    <Toolbar label={t('Events')}>
        <ToolbarButton
            title={t('Pause')}
            icon="⏸"
            pressed={paused}
            testId="events-pause"
            onclick={() => togglePause()}
        />
        <ToolbarButton title={t('Clear')} icon="⌫" testId="events-clear" onclick={() => void stores.events.clear()} />
        <input
            class="hmm-input hmm-events-filter"
            type="search"
            bind:value={addressFilter}
            placeholder="ADDRESS"
            aria-label={`${t('Filter')} ADDRESS`}
            data-testid="events-filter-address"
        />
        <input
            class="hmm-input hmm-events-filter"
            type="search"
            bind:value={datapointFilter}
            placeholder="PARAM"
            aria-label={`${t('Filter')} PARAM`}
            data-testid="events-filter-datapoint"
        />
        {#snippet trailing()}
            {#if paused}<span data-testid="events-paused">{t('Pause')}</span>{/if}
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

    .hmm-events-filter {
        width: 150px;
    }
</style>
