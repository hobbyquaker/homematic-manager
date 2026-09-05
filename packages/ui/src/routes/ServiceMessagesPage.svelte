<script lang="ts">
    import type {ServiceMessage} from '@homematic-manager/core';
    import {deviceAddress, isAcknowledgeable} from '@homematic-manager/core';

    import DataTable from '../lib/components/DataTable.svelte';
    import DeviceImage from '../lib/components/DeviceImage.svelte';
    import Toolbar from '../lib/components/Toolbar.svelte';
    import ToolbarButton from '../lib/components/ToolbarButton.svelte';
    import type {DataTableColumn} from '../lib/components/tableModel.js';
    import {getStores} from '../lib/stores/context.js';
    import {serviceMessageExplanation} from '../lib/util/deviceGrid.js';
    import {formatDateTime, formatRpcValue} from '../lib/util/format.js';

    const stores = getStores();
    const t = stores.i18n.t;

    let selected = $state<string[]>([]);
    let busy = $state(false);

    const interfaceName = $derived(stores.app.selectedInterface);
    const isBidcos = $derived(stores.interfaces.typeOf(interfaceName).startsWith('BidCos'));
    const messages = $derived(stores.serviceMessages.of(interfaceName));
    const acknowledgeable = $derived(stores.serviceMessages.acknowledgeable(interfaceName));
    const selectedMessages = $derived(messages.filter((message) => selected.includes(idOf(message))));
    const selectedAckable = $derived(selectedMessages.filter((message) => isAcknowledgeable(message.datapoint)));

    function idOf(message: ServiceMessage): string {
        return `${message.address}/${message.datapoint}`;
    }

    function deviceTypeOf(address: string): string {
        return stores.devices.index(interfaceName)?.get(deviceAddress(address))?.TYPE ?? '';
    }

    const columns = $derived<DataTableColumn<ServiceMessage>[]>([
        {
            key: 'icon',
            label: '',
            width: 24,
            fixed: true,
            sortable: false,
            filterable: false,
            align: 'center',
            value: () => '',
        },
        {key: 'name', label: t('Name'), width: 220, value: (message) => stores.nameOf(message.address)},
        {key: 'address', label: 'ADDRESS', width: 160, mono: true},
        {
            key: 'device',
            label: `${t('Device')} ADDRESS`,
            width: 140,
            mono: true,
            value: (message) => deviceAddress(message.address),
        },
        {key: 'datapoint', label: t('Message'), width: 180},
        {key: 'value', label: t('Value'), width: 90, value: (message) => formatRpcValue(message.value)},
        {
            key: 'explanation',
            label: '',
            sortable: false,
            value: (message) => {
                const key = serviceMessageExplanation(message.datapoint, !isBidcos);
                return key === undefined ? '' : t(key);
            },
        },
        {key: 'since', label: t('Since'), width: 170, value: (message) => formatDateTime(message.since)},
    ]);

    async function acknowledge(list: readonly ServiceMessage[]): Promise<void> {
        busy = true;
        const done = await stores.serviceMessages.acknowledgeMany(list);
        busy = false;
        stores.notices.push('info', t('{count} service messages', {}, done));
    }
</script>

<div class="hmm-page">
    <Toolbar label={t('Service messages')}>
        <ToolbarButton
            title={t('Refresh')}
            icon="⟳"
            testId="messages-refresh"
            onclick={() => void stores.serviceMessages.load()}
        />
        <ToolbarButton
            title={t('Acknowledge service messages')}
            icon="✔"
            disabled={busy || selectedAckable.length === 0}
            reason={t('Only STICKY_UNREACH and SABOTAGE can be acknowledged')}
            testId="messages-ack"
            onclick={() => void acknowledge(selectedAckable)}
        />
        <ToolbarButton
            title={t('Acknowledge all service messages')}
            icon="✔✔"
            disabled={busy || acknowledgeable.length === 0}
            reason={t('Only STICKY_UNREACH and SABOTAGE can be acknowledged')}
            testId="messages-ack-all"
            onclick={() => void acknowledge(acknowledgeable)}
        />
        <ToolbarButton
            title={t('Quiet mode')}
            icon="🔕"
            pressed={stores.serviceMessages.quiet}
            testId="messages-quiet"
            onclick={() => stores.serviceMessages.setQuiet(!stores.serviceMessages.quiet)}
        />
        {#snippet trailing()}
            {#if stores.serviceMessages.quiet}
                <span data-testid="messages-quiet-hint">{t('Quiet mode')}</span>
            {/if}
            <span>{t('{count} service messages', {}, messages.length)}</span>
        {/snippet}
    </Toolbar>

    <div class="hmm-page-grid">
        <DataTable
            rows={messages}
            {columns}
            getId={idOf}
            bind:selected
            caption={t('Service messages')}
            filterLabel={t('Filter')}
            emptyText={t('No data')}
            testId="messages-table"
        >
            {#snippet cell(row, column)}
                {#if column.key === 'icon'}
                    <DeviceImage
                        deviceType={deviceTypeOf(row.address)}
                        src={stores.host.deviceImageUrl(deviceTypeOf(row.address))}
                    />
                {:else if column.key === 'datapoint'}
                    <span
                        class="hmm-msg-name"
                        class:hmm-msg-ackable={isAcknowledgeable(row.datapoint)}
                        data-testid={`message-${row.address}-${row.datapoint}`}>{row.datapoint}</span
                    >
                {:else}
                    {column.value
                        ? (column.value(row) ?? '')
                        : ((row as unknown as Record<string, string>)[column.key] ?? '')}
                {/if}
            {/snippet}
        </DataTable>
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

    .hmm-msg-name {
        font-family: var(--hmm-font-mono);
    }

    /* The two the CCU lets an application clear; the rest go away when their cause does. */
    .hmm-msg-ackable {
        color: var(--hmm-accent);
    }
</style>
