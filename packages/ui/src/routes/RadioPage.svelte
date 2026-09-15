<script lang="ts">
    import type {BidcosInterfaceInfo, DeviceDescription} from '@homematic-manager/core';
    import {bidcosInterfaceLabel, isRoaming} from '@homematic-manager/core';

    import DataTable from '../lib/components/DataTable.svelte';
    import DeviceImage from '../lib/components/DeviceImage.svelte';
    import {ICON_COLUMN_WIDTH, MARK_COLUMN_WIDTH} from '../lib/components/metrics.js';
    import RssiCell from '../lib/components/RssiCell.svelte';
    import ToolbarButton from '../lib/components/ToolbarButton.svelte';
    import type {DataTableColumn, DataTableColumnGroup} from '../lib/components/tableModel.js';
    import {getStores} from '../lib/stores/context.js';

    import BestReceiverDialog from './radio/BestReceiverDialog.svelte';
    import SetInterfaceDialog from './radio/SetInterfaceDialog.svelte';

    const stores = getStores();
    const t = stores.i18n.t;

    let selectedGateway = $state<string[]>([]);
    let selected = $state<string[]>([]);
    let expanded = $state<string[]>([]);
    let setInterfaceOpen = $state(false);
    let bestReceiverOpen = $state(false);
    let setInterfaceAddress = $state('');
    /** The gateway the dialog opens on when a marker in the grid was clicked; `''` for the device's own. */
    let setInterfacePreset = $state('');

    const interfaceName = $derived(stores.app.selectedInterface);
    const gateways = $derived(stores.radio.gateways(interfaceName));
    /**
     * #155: the tab is HmIP's as well now, and there `setBidcosInterface` does not exist - an HmIP
     * device is bound to the one access point and has neither a receiver to choose nor roaming.
     * The levels, the duty cycle and the unreach counters are the same on both.
     */
    const isBidcos = $derived(stores.interfaces.typeOf(interfaceName).startsWith('BidCos'));

    function openSetInterface(address: string, preset = ''): void {
        setInterfaceAddress = address;
        setInterfacePreset = preset;
        setInterfaceOpen = true;
    }
    /** The RSSI grid has one row per device; a channel has no radio of its own. */
    const devices = $derived(stores.devices.devices(interfaceName));
    const one = $derived(selected.length === 1 ? (selected[0] ?? '') : '');

    /** The 2.7 `grid-interfaces`: the LAN gateways and the built-in coprocessor of the CCU. */
    const gatewayColumns: DataTableColumn<BidcosInterfaceInfo>[] = [
        // Task 47: a gateway's serial carries the copy button like every address
        {key: 'ADDRESS', label: 'ADDRESS', width: 180, mono: true, copy: 'address'},
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
     * The 2.7 RSSI grid: the device columns, then per gateway a receive/send pair and - on BidCos -
     * the marker of the configured receiver, under a group header that names the gateway (its
     * serial, its description in small print: jqGrid's `setGroupHeaders` in 2.x). Forum report
     * against beta.5 (BUGS.md B-2, #142): with the serial in every dBm label the labels were cut
     * off, and nothing in the grid said which receiver a device was configured for.
     */
    const rssiColumns = $derived<DataTableColumn<DeviceDescription>[]>([
        {
            key: 'icon',
            label: '',
            width: ICON_COLUMN_WIDTH,
            fixed: true,
            sortable: false,
            filterable: false,
            align: 'center',
            value: () => '',
        },
        {key: 'name', label: t('Name'), width: 180, copy: 'name', value: (device) => stores.nameOf(device.ADDRESS)},
        {key: 'ADDRESS', label: 'ADDRESS', width: 140, mono: true, copy: 'address'},
        {key: 'TYPE', label: 'TYPE', width: 150},
        {key: 'INTERFACE', label: 'INTERFACE', width: 140, mono: true, hidden: !isBidcos},
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
            hidden: !isBidcos,
            value: (device) => (isRoaming(device) ? '✔' : ''),
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
                label: '← dBm',
                width: 90,
                align: 'right' as const,
                filterable: false,
                value: (device: DeviceDescription) =>
                    stores.radio.pair(interfaceName, device.ADDRESS, gateway.ADDRESS)?.rx ?? '',
            },
            {
                key: `tx:${gateway.ADDRESS}`,
                label: '→ dBm',
                width: 90,
                align: 'right' as const,
                filterable: false,
                value: (device: DeviceDescription) =>
                    stores.radio.pair(interfaceName, device.ADDRESS, gateway.ADDRESS)?.tx ?? '',
            },
            {
                // 2.x: a radio button per interface, checked for the configured one; here a marker
                // that opens the setBidcosInterface dialog on that gateway. (2.x left it out on
                // HmIP; in 3.0 the Funk tab is BidCos-RF's alone, see `tabsForInterface`.)
                key: `set:${gateway.ADDRESS}`,
                label: '',
                hidden: !isBidcos,
                // The mark is 22 px wide and a cell has 6 px of padding on each side (#148: at
                // 30 px the button overflowed its track and the browser drew an ellipsis next to
                // it), the same arithmetic as `ICON_COLUMN_WIDTH`.
                width: MARK_COLUMN_WIDTH,
                fixed: true,
                align: 'center' as const,
                sortable: false,
                filterable: false,
                value: (device: DeviceDescription) => (device.INTERFACE === gateway.ADDRESS ? '◉' : ''),
            },
        ]),
    ]);

    /** One header per gateway over its three columns, as the 2.x Funk grid drew them. */
    const columnGroups = $derived<DataTableColumnGroup[]>(
        gateways.map((gateway) => ({
            key: gateway.ADDRESS,
            label: gateway.ADDRESS,
            sublabel:
                bidcosInterfaceLabel(gateway) === gateway.ADDRESS ? undefined : `(${bidcosInterfaceLabel(gateway)})`,
            columns: isBidcos
                ? [`rx:${gateway.ADDRESS}`, `tx:${gateway.ADDRESS}`, `set:${gateway.ADDRESS}`]
                : [`rx:${gateway.ADDRESS}`, `tx:${gateway.ADDRESS}`],
        })),
    );

    /** The 2.7 RSSI sub-grid: every peer this device measures, not only the gateways. */
    const peerColumns = $derived<DataTableColumn<DeviceDescription>[]>([
        {key: 'name', label: t('Name'), width: 180, copy: 'name', value: (peer) => stores.nameOf(peer.ADDRESS)},
        {key: 'ADDRESS', label: t('Peer'), width: 200, mono: true, copy: 'address'},
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

    /**
     * #146: the levels, the gateway list, the interface states and the unreach counters - and the
     * device list, because `INTERFACE` (which receiver a device is configured for) is part of the
     * description and changes outside this app too.
     */
    async function refresh(): Promise<void> {
        await Promise.all([
            stores.radio.load(interfaceName),
            stores.devices.load(interfaceName, {refresh: true}),
            stores.interfaces.load(),
            stores.unreach.load(),
        ]);
    }

    /**
     * #151: read the matrix once per interface. Asking whether the gateway list is empty was the
     * wrong question - the Devices tab fills that list without the matrix, so opening Funk after
     * it showed a grid with no dBm values until Refresh was pressed.
     */
    $effect(() => {
        const name = interfaceName;
        if (name !== '') {
            void stores.radio.ensureMatrix(name);
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
            tableId="radio-interfaces"
            testId="radio-gateways"
        />
    </div>

    <div class="hmm-page-grid">
        <DataTable
            rows={devices}
            columns={rssiColumns}
            {columnGroups}
            subColumns={peerColumns}
            scope={interfaceName}
            getId={(device) => device.ADDRESS}
            subRows={peersOf}
            bind:selected
            bind:expanded
            caption={t('RSSI')}
            filterLabel={t('Filter')}
            emptyText={t('No data')}
            noMatchText={t('No row matches the filter')}
            clearFilterLabel={t('Clear filter')}
            showingText={(shown, total) => t('Showing {shown} of {total}', {shown, total})}
            onactivate={(device) => openSetInterface(device.ADDRESS)}
            toolbarLabel={t('RSSI')}
            countText={t('{count} devices', {}, devices.length)}
            tableId="radio"
            subTableId="radio-peers"
            testId="radio-table"
        >
            {#snippet toolbar()}
                <!-- #146: the button turns while `rssiInfo` and the device list are being read. -->
                <ToolbarButton
                    title={t('Refresh')}
                    icon="⟳"
                    busy={stores.radio.loading || stores.devices.isLoading(interfaceName)}
                    testId="radio-refresh"
                    onclick={() => void refresh()}
                />
                {#if isBidcos}
                    <ToolbarButton
                        title="setBidcosInterface"
                        icon="⇄"
                        disabled={one === ''}
                        reason={t('Select a device')}
                        testId="radio-set-interface"
                        onclick={() => openSetInterface(one)}
                    />
                    <ToolbarButton
                        title={t('Assign the best receiver')}
                        icon="⇶"
                        disabled={gateways.length < 2}
                        reason={t('Only one interface')}
                        testId="radio-best-receivers"
                        onclick={() => (bestReceiverOpen = true)}
                    />
                {/if}
                <ToolbarButton
                    title={t('Reset the unreach counters')}
                    icon="⟲"
                    disabled={stores.unreach.of(interfaceName).length === 0}
                    reason={t('No data')}
                    testId="radio-reset-unreach"
                    onclick={() => void stores.unreach.reset(interfaceName)}
                />
            {/snippet}

            {#snippet cell(row, column, flatRow)}
                {#if column.key === 'icon'}
                    <DeviceImage deviceType={row.TYPE} src={stores.host.deviceImageUrl(row.TYPE)} />
                {:else if flatRow.depth > 0 && (column.key === 'rx' || column.key === 'tx')}
                    {@const measured = stores.radio.pair(interfaceName, rootOf(flatRow.rootId), row.ADDRESS)}
                    <RssiCell
                        value={column.key === 'rx' ? measured?.rx : measured?.tx}
                        labelOf={(band) => t(band.label)}
                        testId={`rssi-${flatRow.rootId}-${row.ADDRESS}-${column.key}`}
                    />
                {:else if column.key.startsWith('set:') && flatRow.depth === 0}
                    {@const gateway = column.key.slice(4)}
                    {@const configured = row.INTERFACE === gateway}
                    <button
                        type="button"
                        class="hmm-receiver-mark"
                        class:hmm-receiver-configured={configured}
                        aria-pressed={configured}
                        title={configured
                            ? `${t('Configured')}: ${gateway}`
                            : t('Use {interface} as receiver', {interface: gateway})}
                        data-testid={`receiver-${row.ADDRESS}-${gateway}`}
                        onclick={(event) => {
                            event.stopPropagation();
                            openSetInterface(row.ADDRESS, gateway);
                        }}>{configured ? '◉' : '○'}</button
                    >
                {:else if column.key.startsWith('rx:') || column.key.startsWith('tx:')}
                    {@const gateway = column.key.slice(3)}
                    {@const measured = stores.radio.pair(interfaceName, row.ADDRESS, gateway)}
                    <RssiCell
                        value={column.key.startsWith('rx:') ? measured?.rx : measured?.tx}
                        labelOf={(band) => t(band.label)}
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

<SetInterfaceDialog bind:open={setInterfaceOpen} address={setInterfaceAddress} preset={setInterfacePreset} />
<BestReceiverDialog bind:open={bestReceiverOpen} />

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

    /* The 2.x radio button, drawn as a glyph: filled for the configured receiver. */
    .hmm-receiver-mark {
        width: var(--hmm-mark-size);
        height: 18px;
        padding: 0;
        border: none;
        background: none;
        color: var(--hmm-fg-faint);
        font: inherit;
        line-height: 1;
        cursor: pointer;
    }

    .hmm-receiver-mark:hover {
        color: var(--hmm-fg);
    }

    .hmm-receiver-configured {
        color: var(--hmm-fg);
    }
</style>
