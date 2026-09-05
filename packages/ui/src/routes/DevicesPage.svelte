<script lang="ts">
    import type {DeviceDescription} from '@homematic-manager/core';
    import {decodeDeviceFlags, decodeRxMode, deviceAddress} from '@homematic-manager/core';

    import DataTable from '../lib/components/DataTable.svelte';
    import Toolbar from '../lib/components/Toolbar.svelte';
    import ToolbarButton from '../lib/components/ToolbarButton.svelte';
    import type {DataTableColumn} from '../lib/components/tableModel.js';
    import {getStores} from '../lib/stores/context.js';

    const stores = getStores();
    const t = stores.i18n.t;

    let selected = $state<string[]>([]);
    let expanded = $state<string[]>([]);

    const interfaceName = $derived(stores.app.selectedInterface);
    const interfaceType = $derived(stores.interfaces.typeOf(interfaceName));
    const devices = $derived(stores.devices.devices(interfaceName));
    const todo = $derived(t('Comes with task 8'));

    /**
     * The columns of the 2.7 device grid, in its order: icon, Name, ADDRESS, Msgs, TYPE, SUBTYPE,
     * FIRMWARE, PARAMSETS, FLAGS, RX_MODE. `initDaemon` hid SUBTYPE for everything but HmIP and
     * RX_MODE for BidCos-Wired; the same rules apply here.
     */
    const columns = $derived<DataTableColumn<DeviceDescription>[]>([
        {key: 'icon', label: '', width: 22, sortable: false, filterable: false, align: 'center', value: () => ''},
        {key: 'name', label: t('Name'), width: 200, value: (device) => stores.nameOf(device.ADDRESS)},
        {key: 'ADDRESS', label: 'ADDRESS', width: 160, mono: true},
        {
            key: 'msgs',
            label: 'Msgs',
            width: 48,
            align: 'center',
            filterable: false,
            value: (device) => serviceMessageCount(device.ADDRESS) || '',
        },
        {key: 'TYPE', label: 'TYPE', width: 170},
        {key: 'SUBTYPE', label: 'SUBTYPE', width: 90, hidden: interfaceType !== 'HmIP-RF'},
        {key: 'FIRMWARE', label: 'FIRMWARE', width: 90},
        {key: 'PARAMSETS', label: 'PARAMSETS', width: 130, value: (device) => (device.PARAMSETS ?? []).join(' ')},
        {
            key: 'FLAGS',
            label: 'FLAGS',
            width: 140,
            value: (device) => decodeDeviceFlags(device.FLAGS).labels.join(' '),
        },
        {
            key: 'RX_MODE',
            label: 'RX_MODE',
            width: 150,
            hidden: interfaceType === 'BidCos-Wired',
            value: (device) => decodeRxMode(device.RX_MODE).join(' '),
        },
    ]);

    function serviceMessageCount(address: string): number {
        const device = deviceAddress(address);
        return stores.serviceMessages.of(interfaceName).filter((message) => deviceAddress(message.address) === device)
            .length;
    }

    function channelsOf(device: DeviceDescription): DeviceDescription[] {
        return stores.devices.channels(interfaceName, device.ADDRESS);
    }
</script>

<div class="hmm-page">
    <Toolbar label={t('Devices')}>
        <ToolbarButton title={t('Add device')} icon="+" disabled reason={todo} />
        <ToolbarButton title={t('Rename device')} icon="✎" disabled reason={todo} />
        <ToolbarButton title="reportValueUsage 1" icon="⇩" disabled reason={todo} />
        <ToolbarButton title="reportValueUsage 0" icon="⇧" disabled reason={todo} />
        <ToolbarButton title={t('restoreConfigToDevice')} icon="⟲" disabled reason={todo} />
        <ToolbarButton title={t('clearConfigCache')} icon="⌫" disabled reason={todo} />
        <ToolbarButton title={t('Replace device')} icon="⇄" disabled reason={todo} />
        <ToolbarButton title={t('Delete device')} icon="🗑" disabled reason={todo} />
        <ToolbarButton
            title={t('Refresh')}
            icon="⟳"
            testId="devices-refresh"
            onclick={() => void stores.devices.load(interfaceName, {refresh: true})}
        />
        {#snippet trailing()}
            <span>{t('{count} devices', {}, devices.length)}</span>
        {/snippet}
    </Toolbar>

    <div class="hmm-page-grid">
        <DataTable
            rows={devices}
            {columns}
            getId={(device) => device.ADDRESS}
            subRows={channelsOf}
            bind:selected
            bind:expanded
            caption={t('Devices')}
            filterLabel={t('Filter')}
            emptyText={t('No data')}
            testId="devices-table"
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
