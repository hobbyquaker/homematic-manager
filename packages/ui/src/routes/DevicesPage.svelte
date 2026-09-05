<script lang="ts">
    import type {DeviceDescription} from '@homematic-manager/core';
    import {
        decodeDeviceFlags,
        decodeDirection,
        decodeRxMode,
        isDeviceAddress,
        isMaintenanceAddress,
        parseRoles,
    } from '@homematic-manager/core';

    import ContextMenu from '../lib/components/ContextMenu.svelte';
    import type {ContextMenuItem} from '../lib/components/contextMenu.js';
    import DataTable from '../lib/components/DataTable.svelte';
    import DeviceImage from '../lib/components/DeviceImage.svelte';
    import Toolbar from '../lib/components/Toolbar.svelte';
    import ToolbarButton from '../lib/components/ToolbarButton.svelte';
    import type {DataTableColumn} from '../lib/components/tableModel.js';
    import {getStores} from '../lib/stores/context.js';
    import {firmwareCell, offersRepair, serviceMarks, serviceMessageExplanation} from '../lib/util/deviceGrid.js';

    import AddLinkDialog from './links/AddLinkDialog.svelte';
    import TeamDialog from './devices/TeamDialog.svelte';
    import ParamsetDialog from './paramset/ParamsetDialog.svelte';

    import AddDeviceDialog from './devices/AddDeviceDialog.svelte';
    import DeleteDeviceDialog from './devices/DeleteDeviceDialog.svelte';
    import RenameDialog from './devices/RenameDialog.svelte';
    import RepairConfigDialog from './devices/RepairConfigDialog.svelte';
    import ReplaceDeviceDialog from './devices/ReplaceDeviceDialog.svelte';

    const stores = getStores();
    const t = stores.i18n.t;

    /** How often the grid re-reads `listDevices` while a firmware update is in flight (#95, #113). */
    const FIRMWARE_POLL_MS = 10_000;

    let selected = $state<string[]>([]);
    let expanded = $state<string[]>([]);

    let menuOpen = $state(false);
    let menuX = $state(0);
    let menuY = $state(0);
    let menuAddress = $state('');

    let renameOpen = $state(false);
    let deleteOpen = $state(false);
    let replaceOpen = $state(false);
    let repairOpen = $state(false);
    let addOpen = $state(false);
    let actionAddress = $state('');
    /** #25: the create-link dialog, opened from here with the channel already chosen. */
    let addLinkOpen = $state(false);
    let linkSenders = $state<string[]>([]);
    let linkReceivers = $state<string[]>([]);
    /** #97: the team dialog, for a channel that carries a TEAM_TAG. */
    let teamOpen = $state(false);

    let paramsetOpen = $state(false);
    let paramsetAddress = $state('');
    let paramsetName = $state('MASTER');

    const interfaceName = $derived(stores.app.selectedInterface);
    const interfaceType = $derived(stores.interfaces.typeOf(interfaceName));
    const devices = $derived(stores.devices.devices(interfaceName));
    const index = $derived(stores.devices.index(interfaceName));
    const messages = $derived(stores.serviceMessages.of(interfaceName));

    /** #25: the link count in the channel grid needs the links of this interface to be loaded. */
    $effect(() => {
        if (interfaceName !== '') {
            void stores.links.ensure(interfaceName);
        }
    });

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

    // ---------------------------------------------------------------- selection

    const one = $derived(selected.length === 1 ? (selected[0] ?? '') : '');
    const oneDevice = $derived(one !== '' && isDeviceAddress(one) ? one : '');
    /** Channels the toolbar may act on: never a device, never the `:0` maintenance channel. */
    const channelSelection = $derived(
        selected.filter((address) => !isDeviceAddress(address) && !isMaintenanceAddress(address)),
    );
    const canRename = $derived(one !== '' && !isMaintenanceAddress(one));
    /**
     * `DontDelete` is set on the CCU's own virtual devices and on everything the interface refuses
     * to remove; 2.x greyed delete, replace and rename out for those rows.
     */
    const dontDelete = $derived(oneDevice !== '' && decodeDeviceFlags(index?.get(oneDevice)?.FLAGS).dontDelete);
    const canDelete = $derived(oneDevice !== '' && !dontDelete);
    /** `restoreConfigToDevice` and `clearConfigCache` are BidCos-only, as the 2.x menu classes said. */
    const isBidcos = $derived(interfaceType.startsWith('BidCos'));

    function reasonFor(kind: 'device' | 'channel' | 'delete' | 'bidcos'): string {
        switch (kind) {
            case 'device':
                return t('Select a device');
            case 'channel':
                return t('Select one or more channels');
            case 'delete':
                return dontDelete ? t('This device carries the DontDelete flag') : t('Select a device');
            case 'bidcos':
                return t('Only available on BidCos interfaces');
        }
    }

    // ---------------------------------------------------------------- columns

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
            fixed: true,
            sortable: false,
            filterable: false,
            align: 'center',
            value: () => '',
        },
        {key: 'name', label: t('Name'), width: 170, value: (device) => stores.nameOf(device.ADDRESS)},
        {key: 'ADDRESS', label: 'ADDRESS', width: 150, mono: true},
        {
            key: 'msgs',
            label: 'Msgs',
            width: 48,
            fixed: true,
            align: 'center',
            filterable: false,
            sortable: false,
            value: (device) =>
                serviceMarks(device.ADDRESS, messages)
                    .map((mark) => mark.datapoint)
                    .join(' '),
        },
        {key: 'TYPE', label: 'TYPE', width: 150},
        {key: 'SUBTYPE', label: 'SUBTYPE', width: 90, hidden: interfaceType !== 'HmIP-RF'},
        {
            key: 'FIRMWARE',
            label: 'FIRMWARE',
            width: 160,
            value: (device) => `${device.FIRMWARE ?? ''} ${device.AVAILABLE_FIRMWARE ?? ''}`.trim(),
        },
        {
            key: 'PARAMSETS',
            label: 'PARAMSETS',
            width: 140,
            sortable: false,
            value: (device) => (device.PARAMSETS ?? []).join(' '),
        },
        {
            key: 'FLAGS',
            label: 'FLAGS',
            width: 130,
            value: (device) => decodeDeviceFlags(device.FLAGS).labels.join(' '),
        },
        {
            key: 'RX_MODE',
            label: 'RX_MODE',
            width: 130,
            hidden: interfaceType === 'BidCos-Wired',
            value: (device) => decodeRxMode(device.RX_MODE).join(' '),
        },
    ]);

    /**
     * The channel sub-grid of 2.7 (`subGridChannels`, homematic-manager.js:1321): Name, ADDRESS,
     * TYPE, DIRECTION, PARAMSETS, FLAGS and - on BidCos-RF only - AES_ACTIVE.
     */
    const subColumns = $derived<DataTableColumn<DeviceDescription>[]>([
        {key: 'name', label: t('Name'), width: 170, value: (channel) => stores.nameOf(channel.ADDRESS)},
        {key: 'ADDRESS', label: 'ADDRESS', width: 150, mono: true},
        {key: 'TYPE', label: 'TYPE', width: 150},
        {key: 'DIRECTION', label: 'DIRECTION', width: 100, value: (channel) => decodeDirection(channel.DIRECTION)},
        {
            key: 'PARAMSETS',
            label: 'PARAMSETS',
            width: 140,
            sortable: false,
            value: (channel) => (channel.PARAMSETS ?? []).join(' '),
        },
        {
            key: 'FLAGS',
            label: 'FLAGS',
            width: 130,
            value: (channel) => decodeDeviceFlags(channel.FLAGS).labels.join(' '),
        },
        {
            // Issue #25 asks for the direct links to be *shown* in the Devices tab as well as
            // created there. A count is what fits in a grid; the context menu opens the list.
            key: 'links',
            label: t('Links'),
            width: 60,
            fixed: true,
            align: 'right',
            filterable: false,
            value: (channel) => {
                const count = stores.links.forAddress(interfaceName, channel.ADDRESS).length;
                return count === 0 ? '' : count;
            },
        },
        {
            key: 'AES_ACTIVE',
            label: 'AES_ACTIVE',
            width: 90,
            hidden: interfaceType !== 'BidCos-RF',
            value: (channel) => (channel.AES_ACTIVE ? '🔑' : ''),
        },
    ]);

    /** #25: what a channel may be in a link, from its roles - the same rule the Links tab uses. */
    function linkRolesOf(address: string): {canSend: boolean; canReceive: boolean; links: number} {
        const channel = index?.get(address);
        return {
            canSend: parseRoles(channel?.LINK_SOURCE_ROLES).length > 0,
            canReceive: parseRoles(channel?.LINK_TARGET_ROLES).length > 0,
            links: stores.links.forAddress(interfaceName, address).length,
        };
    }

    function channelsOf(device: DeviceDescription): DeviceDescription[] {
        return stores.devices.channels(interfaceName, device.ADDRESS);
    }

    // ---------------------------------------------------------------- firmware

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

    // ---------------------------------------------------------------- actions

    function openRename(address: string): void {
        actionAddress = address;
        renameOpen = true;
    }

    function openDelete(address: string): void {
        actionAddress = address;
        deleteOpen = true;
    }

    function openReplace(address: string): void {
        actionAddress = address;
        replaceOpen = true;
    }

    function openRepair(address: string): void {
        actionAddress = address;
        repairOpen = true;
    }

    /**
     * `reportValueUsage` over every parameter of every selected channel (issue #18, PR #138). 2.x
     * could only do the one channel the grid had selected and refused a device outright; here the
     * multi-selection of the grid is the input and a notice reports how many calls went through.
     */
    async function reportValueUsage(refCounter: number): Promise<void> {
        const addresses = [...channelSelection];
        if (addresses.length === 0) {
            return;
        }
        const done = await stores.devices.reportValueUsage(interfaceName, addresses, refCounter);
        stores.notices.push(
            'info',
            t('reportValueUsage {value}: {count} datapoints on {channels} channels', {
                value: refCounter,
                count: done,
                channels: addresses.length,
            }),
        );
    }

    /** Opens the generic paramset editor. LINK is not reachable from here - it is the Links tab. */
    function openParamset(address: string, name: string): void {
        paramsetAddress = address;
        paramsetName = name;
        paramsetOpen = true;
    }

    function openMenu(row: DeviceDescription, event: MouseEvent): void {
        menuAddress = row.ADDRESS;
        menuX = event.clientX;
        menuY = event.clientY;
        menuOpen = true;
    }

    /**
     * The two 2.7 context menus, merged into one that knows which row it was opened on: the device
     * menu had rename / paramsets / restore / clear / replace / delete, the channel menu rename /
     * reportValueUsage / paramsets, both with the entries greyed out that the row cannot do.
     */
    const menuItems = $derived<ContextMenuItem[]>(
        isDeviceAddress(menuAddress)
            ? [
                  {id: 'rename', label: t('Rename')},
                  {id: 'paramset:MASTER', label: t('MASTER Paramset')},
                  {
                      id: 'paramset:SERVICE',
                      label: t('SERVICE Paramset'),
                      disabled: !(index?.get(menuAddress)?.PARAMSETS ?? []).includes('SERVICE'),
                  },
                  {id: 'sep1', separator: true},
                  {
                      id: 'restore',
                      label: t('restoreConfigToDevice'),
                      disabled: !isBidcos,
                  },
                  {id: 'clear', label: t('clearConfigCache'), disabled: !isBidcos},
                  {id: 'repair', label: t('Repair configuration')},
                  {id: 'sep2', separator: true},
                  {id: 'replace', label: t('Replace'), disabled: dontDeleteOf(menuAddress)},
                  {id: 'delete', label: t('Delete'), danger: true, disabled: dontDeleteOf(menuAddress)},
              ]
            : [
                  {id: 'rename', label: t('Rename'), disabled: isMaintenanceAddress(menuAddress)},
                  {id: 'usage1', label: 'reportValueUsage 1', disabled: isMaintenanceAddress(menuAddress)},
                  {id: 'usage0', label: 'reportValueUsage 0', disabled: isMaintenanceAddress(menuAddress)},
                  {id: 'sep1', separator: true},
                  {id: 'paramset:MASTER', label: t('MASTER Paramset')},
                  {id: 'paramset:VALUES', label: t('VALUES Paramset')},
                  {id: 'sep2', separator: true},
                  // Issue #25: create a link from here, with this channel already chosen
                  {
                      id: 'link:sender',
                      label: t('Create link as sender'),
                      disabled: !linkRolesOf(menuAddress).canSend,
                  },
                  {
                      id: 'link:receiver',
                      label: t('Create link as receiver'),
                      disabled: !linkRolesOf(menuAddress).canReceive,
                  },
                  {
                      id: 'link:show',
                      label: `${t('Show links')} (${String(linkRolesOf(menuAddress).links)})`,
                      disabled: linkRolesOf(menuAddress).links === 0,
                  },
                  // Issue #97: smoke detectors are not linked, they are in a team
                  {
                      id: 'team',
                      label: t('Team'),
                      disabled: (index?.get(menuAddress)?.TEAM_TAG ?? '') === '',
                  },
              ],
    );

    function dontDeleteOf(address: string): boolean {
        return decodeDeviceFlags(index?.get(address)?.FLAGS).dontDelete;
    }

    async function onMenuSelect(id: string): Promise<void> {
        const address = menuAddress;
        if (id.startsWith('paramset:')) {
            openParamset(address, id.slice('paramset:'.length));
            return;
        }
        switch (id) {
            case 'link:sender':
                linkSenders = [address];
                linkReceivers = [];
                addLinkOpen = true;
                break;
            case 'link:receiver':
                linkSenders = [];
                linkReceivers = [address];
                addLinkOpen = true;
                break;
            case 'team':
                actionAddress = address;
                teamOpen = true;
                break;
            case 'link:show':
                stores.app.linksFilter = address;
                stores.app.setTab('links');
                break;
            case 'rename':
                openRename(address);
                break;
            case 'restore':
                await stores.devices.restoreConfig(interfaceName, address);
                break;
            case 'clear':
                await stores.devices.clearConfigCache(interfaceName, address);
                break;
            case 'repair':
                openRepair(address);
                break;
            case 'replace':
                openReplace(address);
                break;
            case 'delete':
                openDelete(address);
                break;
            case 'usage1':
            case 'usage0':
                await stores.devices.reportValueUsage(interfaceName, [address], id === 'usage1' ? 1 : 0);
                break;
            default:
                break;
        }
    }
</script>

<div class="hmm-page">
    <Toolbar label={t('Devices')}>
        <ToolbarButton title={t('Add device')} icon="+" testId="devices-add" onclick={() => (addOpen = true)} />
        <ToolbarButton
            title={t('Rename device')}
            icon="✎"
            disabled={!canRename}
            reason={reasonFor('device')}
            testId="devices-rename"
            onclick={() => openRename(one)}
        />
        <ToolbarButton
            title="reportValueUsage 1"
            icon="⇩"
            disabled={channelSelection.length === 0}
            reason={reasonFor('channel')}
            testId="devices-usage-1"
            onclick={() => void reportValueUsage(1)}
        />
        <ToolbarButton
            title="reportValueUsage 0"
            icon="⇧"
            disabled={channelSelection.length === 0}
            reason={reasonFor('channel')}
            testId="devices-usage-0"
            onclick={() => void reportValueUsage(0)}
        />
        <ToolbarButton
            title={t('restoreConfigToDevice')}
            icon="⟲"
            disabled={oneDevice === '' || !isBidcos}
            reason={isBidcos ? reasonFor('device') : reasonFor('bidcos')}
            testId="devices-restore"
            onclick={() => void stores.devices.restoreConfig(interfaceName, oneDevice)}
        />
        <ToolbarButton
            title={t('clearConfigCache')}
            icon="⌫"
            disabled={oneDevice === '' || !isBidcos}
            reason={isBidcos ? reasonFor('device') : reasonFor('bidcos')}
            testId="devices-clear"
            onclick={() => void stores.devices.clearConfigCache(interfaceName, oneDevice)}
        />
        <ToolbarButton
            title={t('Repair configuration')}
            icon="⚒"
            disabled={oneDevice === ''}
            reason={reasonFor('device')}
            testId="devices-repair"
            onclick={() => openRepair(oneDevice)}
        />
        <ToolbarButton
            title={t('Replace device')}
            icon="⇄"
            disabled={!canDelete}
            reason={reasonFor('delete')}
            testId="devices-replace"
            onclick={() => openReplace(oneDevice)}
        />
        <ToolbarButton
            title={t('Delete device')}
            icon="🗑"
            disabled={!canDelete}
            reason={reasonFor('delete')}
            testId="devices-delete"
            onclick={() => openDelete(oneDevice)}
        />
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
            onrowcontextmenu={openMenu}
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
                        {@const explanation = serviceMessageExplanation(mark.datapoint, !isBidcos)}
                        <span
                            class="hmm-msg-mark"
                            class:hmm-msg-error={mark.level === 'error'}
                            class:hmm-msg-warn={mark.level === 'warn'}
                            title={explanation === undefined ? mark.title : `${mark.title} — ${t(explanation)}`}
                            aria-label={mark.datapoint}
                            role="img">{mark.symbol}</span
                        >
                        {#if offersRepair(mark.datapoint, !isBidcos)}
                            <button
                                type="button"
                                class="hmm-inline-button"
                                data-testid={`repair-${row.ADDRESS}`}
                                title={t('Repair configuration')}
                                onclick={(event) => {
                                    event.stopPropagation();
                                    openRepair(row.ADDRESS);
                                }}>⚒</button
                            >
                        {/if}
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
                {:else if column.key === 'PARAMSETS'}
                    {#each (row.PARAMSETS ?? []).filter((name) => name !== 'LINK') as name (name)}
                        <button
                            type="button"
                            class="hmm-inline-button"
                            data-testid={`paramset-${row.ADDRESS}-${name}`}
                            onclick={(event) => {
                                event.stopPropagation();
                                openParamset(row.ADDRESS, name);
                            }}>{name}</button
                        >
                    {/each}
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

<ContextMenu
    bind:open={menuOpen}
    items={menuItems}
    x={menuX}
    y={menuY}
    label={t('Devices')}
    testId="devices-menu"
    onselect={(id) => void onMenuSelect(id)}
/>

<RenameDialog bind:open={renameOpen} address={actionAddress} />
<DeleteDeviceDialog bind:open={deleteOpen} address={actionAddress} />
<ReplaceDeviceDialog bind:open={replaceOpen} address={actionAddress} />
<AddDeviceDialog bind:open={addOpen} />
<AddLinkDialog bind:open={addLinkOpen} presetSenders={linkSenders} presetReceivers={linkReceivers} />
<TeamDialog bind:open={teamOpen} address={actionAddress} />
<RepairConfigDialog bind:open={repairOpen} address={actionAddress} />
<ParamsetDialog bind:open={paramsetOpen} {interfaceName} address={paramsetAddress} paramset={paramsetName} />

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
