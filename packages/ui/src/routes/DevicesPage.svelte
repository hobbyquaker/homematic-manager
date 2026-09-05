<script lang="ts">
    import type {DeviceDescription} from '@homematic-manager/core';
    import {decodeDeviceFlags, decodeDirection, decodeRxMode} from '@homematic-manager/core';

    import DataTable from '../lib/components/DataTable.svelte';
    import DeviceImage from '../lib/components/DeviceImage.svelte';
    import Toolbar from '../lib/components/Toolbar.svelte';
    import ToolbarButton from '../lib/components/ToolbarButton.svelte';
    import type {DataTableColumn} from '../lib/components/tableModel.js';
    import {getStores} from '../lib/stores/context.js';
    import {firmwareCell, serviceMarks} from '../lib/util/deviceGrid.js';

    const stores = getStores();
    const t = stores.i18n.t;

    /** How often the grid re-reads `listDevices` while a firmware update is in flight (#95, #113). */
    const FIRMWARE_POLL_MS = 10_000;

    let selected = $state<string[]>([]);
    let expanded = $state<string[]>([]);

    const interfaceName = $derived(stores.app.selectedInterface);
    const interfaceType = $derived(stores.interfaces.typeOf(interfaceName));
    const devices = $derived(stores.devices.devices(interfaceName));
    const index = $derived(stores.devices.index(interfaceName));
    const messages = $derived(stores.serviceMessages.of(interfaceName));
    const todo = $derived(t('Comes with task 8'));

    /**
     * hmipserver empties its device cache on every `init` and re-sends the whole list (eq-3/occu#45,
     * found in task 4), so an empty grid right after connecting is a normal transient state. It is
     * only "no devices" once a `listDevices` has really answered with nothing, which is what
     * `loading` distinguishes.
     */
    const emptyText = $derived(
        stores.devices.isLoading(interfaceName) || index === undefined
            ? t('Loading Homematic Manager...')
            : t('No devices - the interface has not reported any yet'),
    );

    /**
     * The columns of the 2.7 device grid, in its order: icon, Name, ADDRESS, Msgs, TYPE, SUBTYPE,
     * FIRMWARE, PARAMSETS, FLAGS, RX_MODE. `initDaemon` hid SUBTYPE for everything but HmIP and
     * RX_MODE for BidCos-Wired; the same rules apply here.
     */
    const columns = $derived<DataTableColumn<DeviceDescription>[]>([
        {
            key: 'icon',
            label: '',
            width: 24,
            sortable: false,
            filterable: false,
            align: 'center',
            value: () => '',
        },
        {key: 'name', label: t('Name'), width: 200, value: (device) => stores.nameOf(device.ADDRESS)},
        {key: 'ADDRESS', label: 'ADDRESS', width: 160, mono: true},
        {
            key: 'msgs',
            label: 'Msgs',
            width: 48,
            align: 'center',
            filterable: false,
            sortable: false,
            value: (device) =>
                serviceMarks(device.ADDRESS, messages)
                    .map((mark) => mark.datapoint)
                    .join(' '),
        },
        {key: 'TYPE', label: 'TYPE', width: 170},
        {key: 'SUBTYPE', label: 'SUBTYPE', width: 90, hidden: interfaceType !== 'HmIP-RF'},
        {
            key: 'FIRMWARE',
            label: 'FIRMWARE',
            width: 150,
            value: (device) => `${device.FIRMWARE ?? ''} ${device.AVAILABLE_FIRMWARE ?? ''}`.trim(),
        },
        {
            key: 'PARAMSETS',
            label: 'PARAMSETS',
            width: 130,
            sortable: false,
            value: (device) => (device.PARAMSETS ?? []).join(' '),
        },
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

    /**
     * The channel sub-grid of 2.7 (`subGridChannels`, homematic-manager.js:1321): Name, ADDRESS,
     * TYPE, DIRECTION, PARAMSETS, FLAGS and - on BidCos-RF only - AES_ACTIVE.
     */
    const subColumns = $derived<DataTableColumn<DeviceDescription>[]>([
        {key: 'name', label: t('Name'), width: 200, value: (channel) => stores.nameOf(channel.ADDRESS)},
        {key: 'ADDRESS', label: 'ADDRESS', width: 160, mono: true},
        {key: 'TYPE', label: 'TYPE', width: 200},
        {key: 'DIRECTION', label: 'DIRECTION', width: 110, value: (channel) => decodeDirection(channel.DIRECTION)},
        {
            key: 'PARAMSETS',
            label: 'PARAMSETS',
            width: 130,
            sortable: false,
            value: (channel) => (channel.PARAMSETS ?? []).join(' '),
        },
        {
            key: 'FLAGS',
            label: 'FLAGS',
            width: 140,
            value: (channel) => decodeDeviceFlags(channel.FLAGS).labels.join(' '),
        },
        {
            key: 'AES_ACTIVE',
            label: 'AES_ACTIVE',
            hidden: interfaceType !== 'BidCos-RF',
            value: (channel) => (channel.AES_ACTIVE ? '🔑' : ''),
        },
    ]);

    function channelsOf(device: DeviceDescription): DeviceDescription[] {
        return stores.devices.channels(interfaceName, device.ADDRESS);
    }

    /** A device is "update pending" when one of its channels reports the service message. */
    function updatePending(address: string): boolean {
        return serviceMarks(address, messages, 99).some((mark) => mark.datapoint === 'UPDATE_PENDING');
    }

    function firmwareOf(device: DeviceDescription) {
        return firmwareCell(device, {
            busy: stores.devices.firmwareBusy.includes(device.ADDRESS),
            updatePending: updatePending(device.ADDRESS),
        });
    }

    async function startFirmware(device: DeviceDescription): Promise<void> {
        const cell = firmwareOf(device);
        if (cell.action === 'install') {
            await stores.devices.installFirmware(interfaceName, device.ADDRESS);
        } else if (cell.action === 'update') {
            await stores.devices.updateFirmware(interfaceName, [device.ADDRESS]);
        }
    }

    /**
     * While an update is in flight the grid re-reads the device list, because neither rfd nor
     * hmipserver pushes a `newDevices` when only the firmware changed. The poll stops by itself as
     * soon as nothing is pending any more.
     */
    $effect(() => {
        const name = interfaceName;
        if (name === '' || !stores.devices.firmwarePending(name)) {
            return;
        }
        const timer = setInterval(() => {
            void stores.devices.load(name, {refresh: true});
        }, FIRMWARE_POLL_MS);
        return () => {
            clearInterval(timer);
        };
    });
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
            {subColumns}
            getId={(device) => device.ADDRESS}
            subRows={channelsOf}
            bind:selected
            bind:expanded
            caption={t('Devices')}
            filterLabel={t('Filter')}
            {emptyText}
            testId="devices-table"
        >
            {#snippet cell(row, column, flatRow)}
                {#if column.key === 'icon'}
                    <DeviceImage
                        deviceType={row.TYPE}
                        src={stores.host.deviceImageUrl(row.TYPE)}
                        testId={`device-image-${row.ADDRESS}`}
                    />
                {:else if column.key === 'msgs' && flatRow.depth === 0}
                    {#each serviceMarks(row.ADDRESS, messages) as mark (mark.datapoint)}
                        <span
                            class="hmm-msg-mark"
                            class:hmm-msg-error={mark.level === 'error'}
                            class:hmm-msg-warn={mark.level === 'warn'}
                            title={mark.title}
                            aria-label={mark.datapoint}
                            role="img">{mark.symbol}</span
                        >
                    {/each}
                {:else if column.key === 'FIRMWARE' && flatRow.depth === 0}
                    {@const cellState = firmwareOf(row)}
                    <span>{cellState.firmware}</span>
                    {#if cellState.busy}
                        <span class="hmm-firmware-status">{t('in progress')}</span>
                    {:else if cellState.action}
                        <button
                            type="button"
                            class="hmm-inline-button"
                            data-testid={`firmware-${row.ADDRESS}`}
                            title={t('Install firmware {version}', {version: cellState.available ?? ''})}
                            onclick={(event) => {
                                event.stopPropagation();
                                void startFirmware(row);
                            }}>{t('install')} {cellState.available ?? ''}</button
                        >
                    {:else if cellState.status}
                        <span class="hmm-firmware-status">{cellState.status}</span>
                    {/if}
                {:else if column.key === 'AES_ACTIVE'}
                    {#if row.AES_ACTIVE}
                        <span title="AES_ACTIVE" aria-label="AES_ACTIVE" role="img">🔑</span>
                    {/if}
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

    .hmm-msg-mark {
        padding: 0 1px;
    }

    .hmm-msg-error {
        color: var(--hmm-error);
    }

    .hmm-msg-warn {
        color: var(--hmm-warn);
    }

    .hmm-firmware-status {
        color: var(--hmm-fg-muted);
        font-size: var(--hmm-font-size-small);
        padding-left: 4px;
    }

    .hmm-inline-button {
        height: 17px;
        padding: 0 5px;
        margin-left: 4px;
        border: 1px solid var(--hmm-border);
        border-radius: var(--hmm-radius);
        background: var(--hmm-header-bg);
        cursor: pointer;
        font-size: var(--hmm-font-size-small);
        line-height: 1;
        vertical-align: middle;
    }

    .hmm-inline-button:hover {
        border-color: var(--hmm-border-strong);
        background: var(--hmm-accent-bg);
    }
</style>
