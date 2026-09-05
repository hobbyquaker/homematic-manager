<script lang="ts">
    import type {BidcosInterfaceInfo, DeviceDescription} from '@homematic-manager/core';

    import DataTable from '../lib/components/DataTable.svelte';
    import DeviceImage from '../lib/components/DeviceImage.svelte';
    import RssiCell from '../lib/components/RssiCell.svelte';
    import Toolbar from '../lib/components/Toolbar.svelte';
    import ToolbarButton from '../lib/components/ToolbarButton.svelte';
    import type {DataTableColumn} from '../lib/components/tableModel.js';
    import {getStores} from '../lib/stores/context.js';

    import SetInterfaceDialog from './radio/SetInterfaceDialog.svelte';

    const stores = getStores();
    const t = stores.i18n.t;

    let selectedGateway = $state<string[]>([]);
    let selected = $state<string[]>([]);
    let expanded = $state<string[]>([]);
    let setInterfaceOpen = $state(false);
    let setInterfaceAddress = $state('');

    const interfaceName = $derived(stores.app.selectedInterface);
    const gateways = $derived(stores.radio.gateways(interfaceName));
    /** The RSSI grid has one row per device; a channel has no radio of its own. */
    const devices = $derived(stores.devices.devices(interfaceName));
    const one = $derived(selected.length === 1 ? (selected[0] ?? '') : '');

    /** The 2.7 `grid-interfaces`: the LAN gateways and the built-in coprocessor of the CCU. */
    const gatewayColumns: DataTableColumn<BidcosInterfaceInfo>[] = [
        {key: 'ADDRESS', label: 'ADDRESS', width: 180, mono: true},
        {key: 'DESCRIPTION', label: 'DESCRIPTION', width: 220},
        {key: 'TYPE', label: 'TYPE', width: 130},
        {key: 'FIRMWARE_VERSION', label: 'FIRMWARE_VERSION', width: 150},
        {
            key: 'CONNECTED',
            label: 'CONNECTED',
            width: 110,
            align: 'center',
            value: (gateway) => (gateway.CONNECTED === true ? '✔' : '✕'),
        },
        {
            key: 'DEFAULT',
            label: 'DEFAULT',
            width: 90,
            align: 'center',
            value: (gateway) => (gateway.DEFAULT === true ? '✔' : ''),
        },
        {
            key: 'DUTY_CYCLE',
            label: 'DUTY_CYCLE',
            width: 100,
            align: 'right',
            value: (gateway) => (gateway.DUTY_CYCLE === undefined ? '' : `${gateway.DUTY_CYCLE} %`),
        },
        {key: 'CARRIER_SENSE_LEVEL', label: 'CARRIER_SENSE_LEVEL', align: 'right'},
    ];

    /**
     * The 2.7 RSSI grid: the device columns, then a receive/send pair per gateway. 2.x drew one
     * `<- dBm` / `-> dBm` pair for the default interface and one further column per additional one;
     * here every gateway gets its pair, which is what a CCU with two LAN gateways needs.
     */
    const rssiColumns = $derived<DataTableColumn<DeviceDescription>[]>([
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
        {key: 'name', label: t('Name'), width: 180, value: (device) => stores.nameOf(device.ADDRESS)},
        {key: 'ADDRESS', label: 'ADDRESS', width: 140, mono: true},
        {key: 'TYPE', label: 'TYPE', width: 150},
        {key: 'INTERFACE', label: 'INTERFACE', width: 140, mono: true},
        {
            key: 'RF_ADDRESS',
            label: 'RF_ADDRESS',
            width: 100,
            align: 'right',
            value: (device) => (device.RF_ADDRESS === undefined ? '' : device.RF_ADDRESS.toString(16).toUpperCase()),
        },
        {
            key: 'ROAMING',
            label: 'ROAMING',
            width: 90,
            align: 'center',
            value: (device) => (device.ROAMING === true || device.ROAMING === 1 ? '✔' : ''),
        },
        {
            // Issue #26 asked for the unreach counter "im Tab Funk", next to the receive levels:
            // a device with a bad link is a device that keeps dropping out, and that is the number
            // that says so. The value survives restarts and the auto-acknowledge.
            key: 'unreach',
            label: t('Unreach'),
            width: 90,
            align: 'right',
            filterable: false,
            value: (device) => {
                const count = stores.unreach.countOf(interfaceName, device.ADDRESS);
                return count === 0 ? '' : count;
            },
        },
        ...gateways.flatMap((gateway) => [
            {
                key: `rx:${gateway.ADDRESS}`,
                label: `← dBm ${gateway.ADDRESS}`,
                width: 120,
                align: 'right' as const,
                filterable: false,
                value: (device: DeviceDescription) =>
                    stores.radio.pair(interfaceName, device.ADDRESS, gateway.ADDRESS)?.rx ?? '',
            },
            {
                key: `tx:${gateway.ADDRESS}`,
                label: `→ dBm ${gateway.ADDRESS}`,
                width: 120,
                align: 'right' as const,
                filterable: false,
                value: (device: DeviceDescription) =>
                    stores.radio.pair(interfaceName, device.ADDRESS, gateway.ADDRESS)?.tx ?? '',
            },
        ]),
    ]);

    /** The 2.7 RSSI sub-grid: every peer this device measures, not only the gateways. */
    const peerColumns = $derived<DataTableColumn<DeviceDescription>[]>([
        {key: 'name', label: t('Name'), width: 180, value: (peer) => stores.nameOf(peer.ADDRESS)},
        {key: 'ADDRESS', label: t('Peer'), width: 200, mono: true},
        {key: 'rx', label: '← dBm', width: 120, align: 'right', filterable: false, value: () => ''},
        {key: 'tx', label: '→ dBm', width: 120, align: 'right', filterable: false, value: () => ''},
    ]);

    /**
     * The peers of a device, as pseudo rows: `peersOf` answers with addresses, and the ones that
     * are not in the device index (a gateway, a device of another interface) are still shown.
     */
    function peersOf(device: DeviceDescription): DeviceDescription[] {
        const index = stores.devices.index(interfaceName);
        return stores.radio
            .peersOf(interfaceName, device.ADDRESS)
            .map((peer) => index?.get(peer) ?? {ADDRESS: peer, TYPE: '', PARENT: device.ADDRESS})
            .map((peer) => ({...peer, PARENT: device.ADDRESS}));
    }

    function rootOf(address: string): string {
        // A sub-row's parent, so the peer cell knows which device measured it.
        return stores.devices.index(interfaceName)?.get(address)?.ADDRESS ?? address;
    }

    async function refresh(): Promise<void> {
        await Promise.all([stores.radio.load(interfaceName), stores.interfaces.load(), stores.unreach.load()]);
    }

    $effect(() => {
        const name = interfaceName;
        if (name !== '' && stores.radio.gateways(name).length === 0 && !stores.radio.loading) {
            void stores.radio.load(name);
        }
    });

    /** The counters of #26 are per CCU, so they are read once and then kept by the event. */
    $effect(() => {
        if (stores.unreach.counters.length === 0) {
            void stores.unreach.load();
        }
    });
</script>

<div class="hmm-page">
    <Toolbar label={t('RSSI')}>
        <ToolbarButton title={t('Refresh')} icon="⟳" testId="radio-refresh" onclick={() => void refresh()} />
        <ToolbarButton
            title="setBidcosInterface"
            icon="⇄"
            disabled={one === ''}
            reason={t('Select a device')}
            testId="radio-set-interface"
            onclick={() => {
                setInterfaceAddress = one;
                setInterfaceOpen = true;
            }}
        />
        <ToolbarButton
            title={t('Reset the unreach counters')}
            icon="⟲"
            disabled={stores.unreach.of(interfaceName).length === 0}
            reason={t('No data')}
            testId="radio-reset-unreach"
            onclick={() => void stores.unreach.reset(interfaceName)}
        />
        {#snippet trailing()}
            <span>{t('{count} devices', {}, devices.length)}</span>
        {/snippet}
    </Toolbar>

    <div class="hmm-radio-gateways">
        <DataTable
            rows={gateways}
            columns={gatewayColumns}
            getId={(gateway) => gateway.ADDRESS}
            bind:selected={selectedGateway}
            height={110}
            columnFilterRow={false}
            caption={t('Interfaces')}
            filterLabel={t('Filter')}
            emptyText={t('No data')}
            testId="radio-gateways"
        />
    </div>

    <div class="hmm-page-grid">
        <DataTable
            rows={devices}
            columns={rssiColumns}
            subColumns={peerColumns}
            getId={(device) => device.ADDRESS}
            subRows={peersOf}
            bind:selected
            bind:expanded
            caption={t('RSSI')}
            filterLabel={t('Filter')}
            emptyText={t('No data')}
            onactivate={(device) => {
                setInterfaceAddress = device.ADDRESS;
                setInterfaceOpen = true;
            }}
            testId="radio-table"
        >
            {#snippet cell(row, column, flatRow)}
                {#if column.key === 'icon'}
                    <DeviceImage deviceType={row.TYPE} src={stores.host.deviceImageUrl(row.TYPE)} />
                {:else if flatRow.depth > 0 && (column.key === 'rx' || column.key === 'tx')}
                    {@const measured = stores.radio.pair(interfaceName, rootOf(flatRow.rootId), row.ADDRESS)}
                    <RssiCell
                        value={column.key === 'rx' ? measured?.rx : measured?.tx}
                        testId={`rssi-${flatRow.rootId}-${row.ADDRESS}-${column.key}`}
                    />
                {:else if column.key.startsWith('rx:') || column.key.startsWith('tx:')}
                    {@const gateway = column.key.slice(3)}
                    {@const measured = stores.radio.pair(interfaceName, row.ADDRESS, gateway)}
                    <RssiCell
                        value={column.key.startsWith('rx:') ? measured?.rx : measured?.tx}
                        testId={`rssi-${row.ADDRESS}-${gateway}-${column.key.slice(0, 2)}`}
                    />
                {:else}
                    {column.value
                        ? (column.value(row) ?? '')
                        : ((row as unknown as Record<string, string>)[column.key] ?? '')}
                {/if}
            {/snippet}
        </DataTable>
    </div>
</div>

<SetInterfaceDialog bind:open={setInterfaceOpen} address={setInterfaceAddress} />

<style>
    .hmm-page {
        display: flex;
        flex-direction: column;
        gap: 6px;
        height: 100%;
        min-height: 0;
    }

    .hmm-radio-gateways {
        flex: 0 0 auto;
        height: 150px;
    }

    .hmm-page-grid {
        flex: 1 1 auto;
        min-height: 0;
    }
</style>
