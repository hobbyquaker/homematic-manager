<script lang="ts">
    import type {InterfaceState} from '@homematic-manager/core';

    import DataTable from '../lib/components/DataTable.svelte';
    import Toolbar from '../lib/components/Toolbar.svelte';
    import ToolbarButton from '../lib/components/ToolbarButton.svelte';
    import type {DataTableColumn} from '../lib/components/tableModel.js';
    import {getStores} from '../lib/stores/context.js';
    import {formatTime} from '../lib/util/format.js';

    const stores = getStores();
    const t = stores.i18n.t;

    let selected = $state<string[]>([]);

    const states = $derived(stores.interfaces.states);
    const todo = $derived(t('Comes with task 8'));

    const columns = $derived<DataTableColumn<InterfaceState>[]>([
        {key: 'name', label: t('Interface'), width: 140},
        {key: 'type', label: 'TYPE', width: 130},
        {key: 'protocol', label: 'PROTOCOL', width: 90},
        {key: 'host', label: 'HOST', width: 180, mono: true},
        {key: 'port', label: 'PORT', width: 70, align: 'right'},
        {
            key: 'connected',
            label: 'CONNECTED',
            width: 110,
            align: 'center',
            value: (state) => (state.connected ? '✔' : '✕'),
        },
        {
            key: 'lastEvent',
            label: t('Timestamp'),
            width: 110,
            value: (state) => (state.lastEvent === undefined ? '' : formatTime(state.lastEvent)),
        },
        {key: 'error', label: t('Message')},
    ]);
</script>

<div class="hmm-page">
    <Toolbar label={t('RSSI')}>
        <ToolbarButton
            title={t('Refresh')}
            icon="⟳"
            testId="radio-refresh"
            onclick={() => void stores.interfaces.load()}
        />
        <ToolbarButton title="setBidcosInterface" icon="⇄" disabled reason={todo} />
    </Toolbar>

    <div class="hmm-page-grid">
        <DataTable
            rows={states}
            {columns}
            getId={(state) => state.name}
            bind:selected
            caption={t('Interfaces')}
            filterLabel={t('Filter')}
            emptyText={t('No data')}
            testId="radio-table"
        />
    </div>

    <!--
        The RSSI matrix with its colour scale and the per-device sub-grid of peers (hmm2.png) is
        task 8: it needs `rssi.get`, the peer roles and the colour mapping from core's RSSI model.
    -->
    <p class="hmm-placeholder">RSSI: {todo}</p>
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

    .hmm-placeholder {
        margin: 0;
        padding: 6px;
        border: 1px dashed var(--hmm-border);
        border-radius: var(--hmm-radius);
        color: var(--hmm-fg-muted);
    }
</style>
