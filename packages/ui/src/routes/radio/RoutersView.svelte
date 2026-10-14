<script lang="ts">
    import type {DeviceDescription} from '@homematic-manager/core';
    import {untrack} from 'svelte';

    import DataTable from '../../lib/components/DataTable.svelte';
    import DeviceImage from '../../lib/components/DeviceImage.svelte';
    import {ICON_COLUMN_WIDTH} from '../../lib/components/metrics.js';
    import RssiCell from '../../lib/components/RssiCell.svelte';
    import ToolbarButton from '../../lib/components/ToolbarButton.svelte';
    import type {DataTableColumn} from '../../lib/components/tableModel.js';
    import {getStores} from '../../lib/stores/context.js';
    import {
        maintenanceAddress,
        routerCount,
        routingTableAddress,
        ROUTING_TABLE_PARAMSET,
    } from '../../lib/util/routers.js';
    import {deviceNames} from '../../lib/util/taxonomy.js';

    import ParamsetDialog from '../paramset/ParamsetDialog.svelte';
    import RoutingSwitchDialog from './RoutingSwitchDialog.svelte';

    interface Props {
        interfaceName: string;
    }

    let {interfaceName}: Props = $props();

    const stores = getStores();
    const t = stores.i18n.t;

    let selected = $state<string[]>([]);
    let switchOpen = $state(false);
    let switchAddress = $state('');
    let switchOn = $state(false);
    let tableOpen = $state(false);
    let tableAddress = $state('');

    /**
     * Task 97: the values are read when the list opens - and again on Refresh - one device after
     * the other; hmipserver answers them from its cache. The device table may have read them
     * already for its marker, which is why this reads again rather than trusting that.
     */
    const index = $derived(stores.devices.index(interfaceName));
    const indexed = $derived(index !== undefined);
    $effect(() => {
        const name = interfaceName;
        if (name !== '' && indexed) {
            untrack(() => void stores.routers.load(name));
        }
    });

    const states = $derived(stores.routers.routers(interfaceName));
    const count = $derived(routerCount(states));
    const enabledOf = $derived<Record<string, boolean | undefined>>(
        Object.fromEntries(states.map((state) => [state.address, state.enabled])),
    );
    const rows = $derived<DeviceDescription[]>(
        states
            .map((state) => index?.get(state.address))
            .filter((device): device is DeviceDescription => device !== undefined),
    );
    /** The access point the RSSI is measured against: the default one of `listBidcosInterfaces`. */
    const accessPoint = $derived.by(() => {
        const gateways = stores.radio.gateways(interfaceName);
        return (gateways.find((gateway) => gateway.DEFAULT === true) ?? gateways[0])?.ADDRESS ?? '';
    });

    function roomsOf(device: DeviceDescription): string {
        const taxonomy = stores.taxonomy;
        const view = (address: string) => taxonomy.view(taxonomy.refOf(interfaceName, address));
        const channels = stores.devices.channels(interfaceName, device.ADDRESS).map((channel) => view(channel.ADDRESS));
        return deviceNames(view(device.ADDRESS), channels, 'room').join(', ');
    }

    function tableAddressOf(device: DeviceDescription): string | undefined {
        return routingTableAddress(device, index?.get(maintenanceAddress(device.ADDRESS)));
    }

    function stateText(enabled: boolean | undefined): string {
        return enabled === undefined ? t('unknown') : enabled ? t('on') : t('off');
    }

    const columns = $derived<DataTableColumn<DeviceDescription>[]>([
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
        {
            key: 'routing',
            label: t('Routing'),
            width: 110,
            minWidth: 90,
            keepMinWidth: true,
            filterable: false,
            value: (device) => stateText(enabledOf[device.ADDRESS]),
        },
        {
            key: 'rx',
            label: '← dBm',
            width: 80,
            align: 'right',
            filterable: false,
            value: (device) => stores.radio.pair(interfaceName, device.ADDRESS, accessPoint)?.rx ?? '',
        },
        {
            key: 'tx',
            label: '→ dBm',
            width: 80,
            align: 'right',
            filterable: false,
            value: (device) => stores.radio.pair(interfaceName, device.ADDRESS, accessPoint)?.tx ?? '',
        },
        {
            key: 'table',
            label: t('Routing table'),
            width: 130,
            minWidth: 110,
            keepMinWidth: true,
            sortable: false,
            filterable: false,
            value: () => '',
        },
        {key: 'ADDRESS', label: 'ADDRESS', width: 140, mono: true, copy: 'address'},
        {key: 'TYPE', label: 'TYPE', width: 130},
        {key: 'rooms', label: t('Rooms'), width: 120, value: (device) => roomsOf(device)},
    ]);

    function askSwitch(address: string, on: boolean): void {
        switchAddress = address;
        switchOn = on;
        switchOpen = true;
    }

    function openTable(address: string): void {
        tableAddress = address;
        tableOpen = true;
    }

    const busy = $derived(stores.routers.isLoading(interfaceName));
</script>

<DataTable
    {rows}
    {columns}
    scope={interfaceName}
    getId={(device) => device.ADDRESS}
    bind:selected
    caption={t('Routers')}
    filterLabel={t('Filter')}
    emptyText={busy ? t('Reading…') : t('No device of this interface can route')}
    noMatchText={t('No row matches the filter')}
    clearFilterLabel={t('Clear filter')}
    showingText={(shown, total) => t('Showing {shown} of {total}', {shown, total})}
    toolbarLabel={t('Routers')}
    countText={t('{routing} of {capable} route', {routing: count.routing, capable: count.capable}, count.capable)}
    tableId="radio-routers"
    testId="routers-table"
>
    {#snippet toolbar()}
        <ToolbarButton
            title={t('Refresh')}
            icon="⟳"
            {busy}
            testId="routers-refresh"
            onclick={() => {
                void stores.routers.load(interfaceName);
                void stores.radio.load(interfaceName);
            }}
        />
    {/snippet}

    {#snippet cell(row, column)}
        {#if column.key === 'icon'}
            <DeviceImage deviceType={row.TYPE} src={stores.host.deviceImageUrl(row.TYPE)} />
        {:else if column.key === 'rx' || column.key === 'tx'}
            {@const measured = stores.radio.pair(interfaceName, row.ADDRESS, accessPoint)}
            <RssiCell
                value={column.key === 'rx' ? measured?.rx : measured?.tx}
                labelOf={(band) => t(band.label)}
                testId={`router-rssi-${row.ADDRESS}-${column.key}`}
            />
        {:else if column.key === 'routing'}
            {@const enabled = enabledOf[row.ADDRESS]}
            <button
                type="button"
                class="hmm-routing-switch"
                class:hmm-routing-on={enabled === true}
                role="switch"
                aria-checked={enabled === true}
                aria-label={`${t('Routing')} ${stores.nameOf(row.ADDRESS)}`}
                title={enabled === true ? t('Switch routing off') : t('Switch routing on')}
                disabled={enabled === undefined || stores.routers.writing !== ''}
                data-testid={`routing-switch-${row.ADDRESS}`}
                onclick={(event) => {
                    event.stopPropagation();
                    askSwitch(row.ADDRESS, enabled !== true);
                }}
            >
                <span class="hmm-routing-track" aria-hidden="true"><span class="hmm-routing-knob"></span></span>
                <span class="hmm-routing-label">{stateText(enabled)}</span>
            </button>
        {:else if column.key === 'table'}
            {@const address = tableAddressOf(row)}
            <button
                type="button"
                class="hmm-inline-button"
                disabled={address === undefined}
                title={address === undefined
                    ? t('The interface offers no routing table for this device')
                    : t('Read once from the device itself: costs duty cycle')}
                data-testid={`routing-table-${row.ADDRESS}`}
                onclick={(event) => {
                    event.stopPropagation();
                    if (address !== undefined) {
                        openTable(address);
                    }
                }}>{t('Routing table')}</button
            >
        {:else}
            {column.value ? (column.value(row) ?? '') : ((row as unknown as Record<string, string>)[column.key] ?? '')}
        {/if}
    {/snippet}
</DataTable>

<RoutingSwitchDialog
    bind:open={switchOpen}
    name={stores.nameOf(switchAddress)}
    address={switchAddress}
    on={switchOn}
    onconfirm={() => void stores.routers.setRouting(interfaceName, switchAddress, switchOn)}
/>
<ParamsetDialog bind:open={tableOpen} {interfaceName} address={tableAddress} paramset={ROUTING_TABLE_PARAMSET} />

<style>
    /* the PARAMSETS buttons' look (DevicesPage); a router without a table to read shows it faded */
    .hmm-inline-button {
        height: 18px;
        padding: 0 4px;
        border: 1px solid var(--hmm-border);
        border-radius: var(--hmm-radius);
        background: var(--hmm-control-bg);
        color: var(--hmm-fg-muted);
        cursor: pointer;
        font-size: var(--hmm-font-size-small);
        line-height: 1;
        vertical-align: middle;
    }

    .hmm-inline-button:hover:not(:disabled) {
        background: var(--hmm-control-bg-hover);
        color: var(--hmm-fg);
    }

    .hmm-inline-button:disabled {
        cursor: default;
        opacity: 0.5;
    }

    /* Task 97: the router module's switch - a track with a knob, the state as a word beside it. */
    .hmm-routing-switch {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 0;
        border: none;
        background: none;
        color: var(--hmm-fg);
        font: inherit;
        cursor: pointer;
    }

    .hmm-routing-switch:disabled {
        cursor: default;
        opacity: 0.6;
    }

    .hmm-routing-switch:focus-visible {
        outline: 2px solid var(--hmm-focus);
        outline-offset: 2px;
    }

    .hmm-routing-track {
        position: relative;
        flex: 0 0 auto;
        box-sizing: border-box;
        width: 28px;
        height: 16px;
        border: 1px solid var(--hmm-border-strong);
        border-radius: 8px;
        background: var(--hmm-control-bg);
    }

    .hmm-routing-knob {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--hmm-fg-muted);
        transition: left 0.12s ease;
    }

    .hmm-routing-on .hmm-routing-track {
        border-color: var(--hmm-accent);
        background: var(--hmm-accent-bg);
    }

    .hmm-routing-on .hmm-routing-knob {
        left: 14px;
        background: var(--hmm-accent);
    }

    .hmm-routing-label {
        white-space: nowrap;
    }
</style>
