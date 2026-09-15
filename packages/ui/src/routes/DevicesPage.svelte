<script lang="ts">
    import type {DeviceDescription} from '@homematic-manager/core';
    import {
        canPairDevices,
        decodeDeviceFlags,
        decodeDirection,
        decodeRxMode,
        isChannelAddress,
        isChannelDescription,
        isDeviceAddress,
        isMaintenanceAddress,
        isRoaming,
        parseRoles,
        receiverLabel,
    } from '@homematic-manager/core';

    import ContextMenu from '../lib/components/ContextMenu.svelte';
    import type {ContextMenuItem} from '../lib/components/contextMenu.js';
    import DataTable from '../lib/components/DataTable.svelte';
    import DeviceImage from '../lib/components/DeviceImage.svelte';
    import {ICON_COLUMN_WIDTH} from '../lib/components/metrics.js';
    import PrimaryToolbarButton from '../lib/components/PrimaryToolbarButton.svelte';
    import ToolbarButton from '../lib/components/ToolbarButton.svelte';
    import type {DataTableColumn} from '../lib/components/tableModel.js';
    import {getStores} from '../lib/stores/context.js';
    import {STORE_INTERFACE} from '../lib/stores/routing.js';
    import {isHmipInterface} from '../lib/stores/suppression.js';
    import {
        firmwareCell,
        offeredParamsets,
        offersRepair,
        PARAMSETS_COLUMN_WIDTH,
        SERVICE_MARKS_COLUMN_WIDTH,
        serviceMarks,
        serviceMessageExplanation,
        type OfferedParamsets,
    } from '../lib/util/deviceGrid.js';
    import {
        channelVisible,
        deviceMatches,
        deviceNames,
        indentedLabel,
        namesOf,
        type TaxonomyId,
    } from '../lib/util/taxonomy.js';
    import type {AssignTarget} from '../lib/util/assignment.js';

    import AddLinkDialog from './links/AddLinkDialog.svelte';
    import TeamDialog from './devices/TeamDialog.svelte';
    import ParamsetDialog from './paramset/ParamsetDialog.svelte';

    import AddDeviceDialog from './devices/AddDeviceDialog.svelte';
    import AssignDialog from './devices/AssignDialog.svelte';
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

    /** Task 25: the assign dialog for the selection. */
    let assignOpen = $state(false);
    let assignEnum = $state<TaxonomyId>('room');
    let assignRefs = $state<AssignTarget[]>([]);
    /** The filter above the grid: a node path per taxonomy, `''` for everything. */
    let roomFilter = $state('');
    let functionFilter = $state('');

    const interfaceName = $derived(stores.app.selectedInterface);
    const interfaceType = $derived(stores.interfaces.typeOf(interfaceName));
    const allDevices = $derived(stores.devices.devices(interfaceName));
    const index = $derived(stores.devices.index(interfaceName));
    const messages = $derived(stores.serviceMessages.of(interfaceName));
    /** The BidCos interfaces of this process, for the names of the receivers (B-2). */
    const gateways = $derived(stores.radio.gateways(interfaceName));

    $effect(() => {
        if (interfaceType === 'BidCos-RF') {
            void stores.radio.ensureGateways(interfaceName);
        }
    });

    // A selection, the expanded rows and the room/function filter belong to the interface they were
    // made on (B-1: state that outlives an interface switch is what emptied the grid). #143: the
    // room and the function filter were the two that still survived it - they are applied to the
    // rows before the table sees them, so the table's own "0 von 31" could not report them either,
    // and a device grid narrowed to a room of BidCos-RF was simply empty on VirtualDevices, whose
    // groups are in no room at all.
    $effect(() => {
        void interfaceName;
        selected = [];
        expanded = [];
        roomFilter = '';
        functionFilter = '';
    });

    // ---------------------------------------------------------------- rooms and functions

    const taxonomy = $derived(stores.taxonomy);
    const roomOptions = $derived(taxonomy.options('room'));
    const functionOptions = $derived(taxonomy.options('function'));
    /** The active filter targets; a parent node matches everything below it. */
    const filterTargets = $derived([roomFilter, functionFilter].filter((target) => target !== ''));

    $effect(() => {
        // a node that was deleted while it was the filter: back to everything, not to an empty grid
        if (roomFilter !== '' && !roomOptions.some((option) => option.path === roomFilter)) {
            roomFilter = '';
        }
        if (functionFilter !== '' && !functionOptions.some((option) => option.path === functionFilter)) {
            functionFilter = '';
        }
    });

    function refOf(address: string): string {
        return taxonomy.refOf(interfaceName, address);
    }

    function viewOf(address: string) {
        return taxonomy.view(refOf(address));
    }

    function channelViewsOf(device: DeviceDescription) {
        return stores.devices.channels(interfaceName, device.ADDRESS).map((channel) => viewOf(channel.ADDRESS));
    }

    /** What the grid prints: the leaf names, and for a device without its own the channels' union. */
    function taxonomyText(row: DeviceDescription, enumId: TaxonomyId): string {
        const names = isDeviceAddress(row.ADDRESS)
            ? deviceNames(viewOf(row.ADDRESS), channelViewsOf(row), enumId)
            : namesOf(viewOf(row.ADDRESS), enumId);
        return names.join(', ');
    }

    /**
     * The filter is applied to the rows before the table sees them, so the per-column text filters
     * and the sort work on what is left. A device stays when it or any of its channels is in the
     * target; under it only the channels that are (or all of them when the device itself is).
     */
    const devices = $derived(
        filterTargets.length === 0
            ? allDevices
            : allDevices.filter((device) =>
                  filterTargets.every((target) =>
                      deviceMatches(viewOf(device.ADDRESS), channelViewsOf(device), target),
                  ),
              ),
    );

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
        stores.devices.isLoading(interfaceName)
            ? t('Loading Homematic Manager...')
            : // #143: a read that failed leaves no index, exactly like one that has not started.
              // Saying "loading" for both left the grid claiming to be busy for good.
              stores.devices.hasFailed(interfaceName)
              ? t('The device list could not be read - press Refresh to try again')
              : index === undefined
                ? t('Loading Homematic Manager...')
                : allDevices.length > 0
                  ? // #143: the interface *has* reported devices, the room or function filter above the
                    // grid is hiding them. Saying the opposite is what sends somebody hunting for a
                    // fault in the interface.
                    t('No device matches the room or function filter')
                  : t('No devices - the interface has not reported any yet'),
    );

    // ---------------------------------------------------------------- selection

    const one = $derived(selected.length === 1 ? (selected[0] ?? '') : '');
    const oneDevice = $derived(one !== '' && isDeviceAddress(one) ? one : '');
    /** Channels the toolbar may act on: never a device, never the `:0` maintenance channel. */
    const channelSelection = $derived(
        selected.filter((address) => !isDeviceAddress(address) && !isMaintenanceAddress(address)),
    );
    /** The `:0` maintenance channel has no name of its own to change; 2.x greyed rename out there. */
    function renamable(address: string): boolean {
        return address !== '' && !isMaintenanceAddress(address);
    }
    const canRename = $derived(renamable(one));
    /**
     * `DontDelete` is set on the CCU's own virtual devices and on everything the interface refuses
     * to remove; 2.x greyed delete, replace and rename out for those rows.
     */
    const dontDelete = $derived(oneDevice !== '' && decodeDeviceFlags(index?.get(oneDevice)?.FLAGS).dontDelete);
    const canDelete = $derived(oneDevice !== '' && !dontDelete);
    /** `restoreConfigToDevice` and `clearConfigCache` are BidCos-only, as the 2.x menu classes said. */
    const isBidcos = $derived(interfaceType.startsWith('BidCos'));
    /** Task 28: VirtualDevices and CUxD have no install mode, so there is nothing to pair there. */
    const canPair = $derived(canPairDevices(interfaceType));

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
            width: ICON_COLUMN_WIDTH,
            fixed: true,
            sortable: false,
            filterable: false,
            align: 'center',
            value: () => '',
        },
        // Task 47: both carry the copy button, the full name and the address whatever the cell shows
        {key: 'name', label: t('Name'), width: 170, copy: 'name', value: (device) => stores.nameOf(device.ADDRESS)},
        {key: 'ADDRESS', label: 'ADDRESS', width: 150, mono: true, copy: 'address'},
        // Task 25: the taxonomy of the store, as the arrays of names ReGa's rooms always were
        {key: 'rooms', label: t('Rooms'), width: 120, value: (device) => taxonomyText(device, 'room')},
        {key: 'functions', label: t('Functions'), width: 110, value: (device) => taxonomyText(device, 'function')},
        {
            // B-34: two marks and the repair button fit, and it can be dragged wider. Not narrower than
            // they are, like PARAMSETS (B-35): a squeezed repair button slides under the next cell,
            // where its click is lost. A cell cut off after all shows its content as a tooltip (task 42)
            key: 'msgs',
            label: 'Msgs',
            width: SERVICE_MARKS_COLUMN_WIDTH,
            minWidth: SERVICE_MARKS_COLUMN_WIDTH,
            keepMinWidth: true,
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
            width: 170,
            value: (device) => `${device.FIRMWARE ?? ''} ${device.AVAILABLE_FIRMWARE ?? ''}`.trim(),
        },
        {
            key: 'PARAMSETS',
            label: 'PARAMSETS',
            // the buttons in this cell do not shrink with the window: a column that is squeezed
            // below them puts the VALUES button under the next cell, where a click never lands
            // (found by the e2e suite when the rooms and functions columns arrived, task 25). So
            // neither the window nor a drag makes it narrower than they are; wider it can be (B-35, #157).
            width: PARAMSETS_COLUMN_WIDTH,
            minWidth: PARAMSETS_COLUMN_WIDTH,
            keepMinWidth: true,
            sortable: false,
            value: (device) => paramsetsOf(device).names.join(' '),
        },
        {
            key: 'FLAGS',
            label: 'FLAGS',
            width: 130,
            value: (device) => decodeDeviceFlags(device.FLAGS).labels.join(' '),
        },
        {
            // Forum report against beta.5 (BUGS.md B-2, #142): which receiver a BidCos-RF device
            // is routed through is what a user with LAN gateways looks for first, and 2.7 had this
            // column commented out. The value is the receiver's name as `listBidcosInterfaces`
            // describes it (the CCU's own module, a named LAN gateway) and its serial otherwise;
            // the cell adds a mark when ROAMING is on. BidCos-RF only: HmIP and Wired have no
            // receivers.
            key: 'INTERFACE',
            label: 'INTERFACE',
            width: 130,
            hidden: interfaceType !== 'BidCos-RF',
            value: (device) => receiverLabel(device, gateways),
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
        {key: 'name', label: t('Name'), width: 170, copy: 'name', value: (channel) => stores.nameOf(channel.ADDRESS)},
        {key: 'ADDRESS', label: 'ADDRESS', width: 150, mono: true, copy: 'address'},
        {key: 'rooms', label: t('Rooms'), width: 120, value: (channel) => taxonomyText(channel, 'room')},
        {key: 'functions', label: t('Functions'), width: 110, value: (channel) => taxonomyText(channel, 'function')},
        {key: 'TYPE', label: 'TYPE', width: 150},
        {key: 'DIRECTION', label: 'DIRECTION', width: 100, value: (channel) => decodeDirection(channel.DIRECTION)},
        {
            key: 'PARAMSETS',
            label: 'PARAMSETS',
            // the device's column: a key both depths share is one track, sized from the head
            width: PARAMSETS_COLUMN_WIDTH,
            minWidth: PARAMSETS_COLUMN_WIDTH,
            keepMinWidth: true,
            sortable: false,
            value: (channel) => paramsetsOf(channel).names.join(' '),
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
            // B-35: resizable like any text column; three digits fit the grid's own minimum.
            key: 'links',
            label: t('Links'),
            width: 60,
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

    /**
     * B-33: the paramsets a row offers - what it lists, where the description has parameters. The
     * store keeps the answer per paramset identity, so a hundred channels of one kind cost one
     * `getParamsetDescription`, and only for the rows that are drawn.
     */
    function paramsetsOf(row: DeviceDescription): OfferedParamsets {
        const parent = isDeviceAddress(row.ADDRESS) ? undefined : index?.parentOf(row.ADDRESS);
        // Task 26: the MASTER dialog of an HmIP channel 0 also carries the suppression rows of its
        // service messages, which come from VALUES - an empty MASTER there still has something to show
        const suppressible = isHmipInterface(interfaceName, interfaceType) && isMaintenanceAddress(row.ADDRESS);
        // the maintainer's decision on B-33: no SERVICE button on a channel, channel 0 included
        const channel = isChannelAddress(row.ADDRESS) || isChannelDescription(row);
        return offeredParamsets(
            row.PARAMSETS,
            (name) => {
                const content = stores.paramsets.contentOf(interfaceName, row, name, parent);
                if (name !== 'MASTER' || content !== 'empty' || !suppressible) {
                    return content;
                }
                return stores.paramsets.contentOf(interfaceName, row, 'VALUES', parent, 'service-messages');
            },
            {channel},
        );
    }

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
        const channels = stores.devices.channels(interfaceName, device.ADDRESS);
        if (filterTargets.length === 0) {
            return channels;
        }
        const deviceView = viewOf(device.ADDRESS);
        return channels.filter((channel) =>
            filterTargets.every((target) => channelVisible(viewOf(channel.ADDRESS), deviceView, target)),
        );
    }

    /**
     * One row for the assign dialog: its ref, and for a device the refs of its channels - a device is
     * shown in a room when its channels are (task 49), and taken out of it with them.
     */
    function assignTargetOf(address: string): AssignTarget {
        return {
            ref: refOf(address),
            channels: isDeviceAddress(address)
                ? stores.devices.channels(interfaceName, address).map((channel) => refOf(channel.ADDRESS))
                : [],
        };
    }

    /** The rows the assign dialog works on: the selection, or the row the menu was opened on. */
    function assignTargets(address: string): AssignTarget[] {
        const rows = selected.includes(address) ? selected : [address];
        return rows.map((entry) => assignTargetOf(entry));
    }

    function openAssign(enumId: TaxonomyId, address?: string): void {
        assignEnum = enumId;
        assignRefs = address === undefined ? selected.map((entry) => assignTargetOf(entry)) : assignTargets(address);
        if (assignRefs.length === 0) {
            return;
        }
        assignOpen = true;
    }

    const canAssign = $derived(selected.length > 0 && taxonomy.writable);
    const assignReason = $derived(
        !taxonomy.available
            ? t('No store connected')
            : !taxonomy.writable
              ? t('The store does not take writes')
              : t('Select one or more rows'),
    );

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

    /** B-33: one entry per paramset the row offers, the same set as its buttons. */
    const menuParamsets = $derived.by((): ContextMenuItem[] => {
        const row = index?.get(menuAddress);
        return row === undefined
            ? []
            : paramsetsOf(row).names.map((name) => ({id: `paramset:${name}`, label: t(`${name} Paramset`)}));
    });

    /**
     * The two 2.7 context menus, merged into one that knows which row it was opened on: the device
     * menu had rename / paramsets / restore / clear / replace / delete, the channel menu rename /
     * reportValueUsage / paramsets, both with the entries greyed out that the row cannot do. B-33:
     * the paramsets are the ones the row offers, not a fixed set per kind of row.
     */
    const menuItems = $derived<ContextMenuItem[]>(
        isDeviceAddress(menuAddress)
            ? [
                  {id: 'rename', label: t('Rename')},
                  ...menuParamsets,
                  {id: 'sep1', separator: true},
                  {
                      id: 'restore',
                      label: t('restoreConfigToDevice'),
                      disabled: !isBidcos,
                  },
                  {id: 'clear', label: t('clearConfigCache'), disabled: !isBidcos},
                  {id: 'repair', label: t('Repair configuration')},
                  {id: 'sep2', separator: true},
                  // Task 25: the selection into a room or a function - one entry each
                  {id: 'assign:room', label: `${t('Assign to room')}…`, disabled: !taxonomy.writable},
                  {id: 'assign:function', label: `${t('Assign to function')}…`, disabled: !taxonomy.writable},
                  {id: 'sep3', separator: true},
                  {id: 'replace', label: t('Replace'), disabled: dontDeleteOf(menuAddress)},
                  {id: 'delete', label: t('Delete'), danger: true, disabled: dontDeleteOf(menuAddress)},
              ]
            : [
                  {id: 'rename', label: t('Rename'), disabled: !renamable(menuAddress)},
                  {id: 'usage1', label: 'reportValueUsage 1', disabled: isMaintenanceAddress(menuAddress)},
                  {id: 'usage0', label: 'reportValueUsage 0', disabled: isMaintenanceAddress(menuAddress)},
                  {id: 'sep1', separator: true},
                  ...(menuParamsets.length === 0 ? [] : [...menuParamsets, {id: 'sep2', separator: true}]),
                  {id: 'assign:room', label: `${t('Assign to room')}…`, disabled: !taxonomy.writable},
                  {id: 'assign:function', label: `${t('Assign to function')}…`, disabled: !taxonomy.writable},
                  {id: 'sep3', separator: true},
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
        if (id === 'assign:room' || id === 'assign:function') {
            openAssign(id === 'assign:room' ? 'room' : 'function', address);
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
    <div class="hmm-page-grid">
        <DataTable
            rows={devices}
            {columns}
            {subColumns}
            getId={(device) => device.ADDRESS}
            subRows={channelsOf}
            bind:selected
            bind:expanded
            scope={interfaceName}
            caption={t('Devices')}
            filterLabel={t('Filter')}
            {emptyText}
            noMatchText={t('No row matches the filter')}
            clearFilterLabel={t('Clear filter')}
            showingText={(shown, total) => t('Showing {shown} of {total}', {shown, total})}
            onrowcontextmenu={openMenu}
            canRename={(row) => renamable(row.ADDRESS)}
            onrename={(row) => openRename(row.ADDRESS)}
            toolbarLabel={t('Devices')}
            countText={t('{count} devices', {}, devices.length)}
            tableId="devices"
            subTableId="devices-channels"
            testId="devices-table"
        >
            {#snippet toolbar()}
                <PrimaryToolbarButton
                    caption={t('Pair device')}
                    icon="+"
                    disabled={!canPair}
                    reason={t('This interface cannot pair devices')}
                    testId="devices-add"
                    onclick={() => (addOpen = true)}
                />
                <ToolbarButton
                    title={t('Rename device')}
                    icon="✎"
                    disabled={!canRename}
                    reason={reasonFor('device')}
                    testId="devices-rename"
                    onclick={() => openRename(one)}
                />
                <ToolbarButton
                    title={t('Assign to room')}
                    icon="⌂"
                    disabled={!canAssign}
                    reason={assignReason}
                    testId="devices-assign-room"
                    onclick={() => openAssign('room')}
                />
                <ToolbarButton
                    title={t('Assign to function')}
                    icon="⚑"
                    disabled={!canAssign}
                    reason={assignReason}
                    testId="devices-assign-function"
                    onclick={() => openAssign('function')}
                />
                <!--
                    2026-09-10: the tree dialog of task 25 is gone - the store has its own pages
                    behind its entry in the interface picker, and this button goes there.
                -->
                <ToolbarButton
                    title={t('Rooms and functions')}
                    icon="⊞"
                    disabled={!taxonomy.available}
                    reason={t('No store connected')}
                    testId="devices-taxonomy"
                    onclick={() => void stores.selectInterface(STORE_INTERFACE)}
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
            {/snippet}

            {#snippet status()}
                <!--
                    Task 25: the filter by room and by function, which is what the taxonomy is
                    for. A parent node - a floor - matches everything under it.
                -->
                {#if taxonomy.available}
                    <select
                        class="hmm-select hmm-taxonomy-filter"
                        bind:value={roomFilter}
                        aria-label={t('Room')}
                        data-testid="devices-filter-room"
                    >
                        <option value="">{t('All rooms')}</option>
                        {#each roomOptions as option (option.path)}
                            <option value={option.path}>{indentedLabel(option, ' ')}</option>
                        {/each}
                    </select>
                    <select
                        class="hmm-select hmm-taxonomy-filter"
                        bind:value={functionFilter}
                        aria-label={t('Function')}
                        data-testid="devices-filter-function"
                    >
                        <option value="">{t('All functions')}</option>
                        {#each functionOptions as option (option.path)}
                            <option value={option.path}>{indentedLabel(option, ' ')}</option>
                        {/each}
                    </select>
                {/if}
            {/snippet}

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
                    <!-- #143: `offeredParamsets` reads the list with `asStringList`: a value that is
                         not a list at all (the group process sends `PARAMSETS` as a string on some
                         boxes) must not throw here - one throw in a reactive grid blanks the whole
                         page. The backend shapes it too; this is the second lock on the same door.
                         B-33: busy while a listed paramset's description is still being asked for. -->
                    {@const offered = paramsetsOf(row)}
                    <span data-testid={`paramsets-${row.ADDRESS}`} aria-busy={offered.pending}>
                        {#each offered.names as name (name)}
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
                    </span>
                {:else if column.key === 'AES_ACTIVE'}
                    {#if row.AES_ACTIVE}
                        <span title="AES_ACTIVE" aria-label="AES_ACTIVE" role="img">🔑</span>
                    {/if}
                {:else if column.key === 'INTERFACE' && flatRow.depth === 0}
                    <span data-testid={`receiver-${row.ADDRESS}`}>{receiverLabel(row, gateways)}</span>
                    {#if isRoaming(row)}
                        <span class="hmm-roaming" title="ROAMING" aria-label="ROAMING" role="img">⇄</span>
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
<AssignDialog bind:open={assignOpen} enumId={assignEnum} targets={assignRefs} />
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

    .hmm-taxonomy-filter {
        max-width: 160px;
        height: 22px;
        padding: 0 4px;
        font-size: var(--hmm-font-size-small);
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

    .hmm-roaming {
        padding-left: 4px;
        color: var(--hmm-fg-muted);
    }

    .hmm-firmware-status {
        color: var(--hmm-fg-muted);
        font-size: var(--hmm-font-size-small);
        padding-left: 4px;
    }

    .hmm-inline-button {
        height: 18px;
        padding: 0 4px;
        margin-left: 3px;
        border: 1px solid var(--hmm-border);
        border-radius: var(--hmm-radius);
        background: var(--hmm-control-bg);
        color: var(--hmm-fg-muted);
        cursor: pointer;
        font-size: var(--hmm-font-size-small);
        line-height: 1;
        vertical-align: middle;
    }

    .hmm-inline-button:hover {
        background: var(--hmm-control-bg-hover);
        color: var(--hmm-fg);
    }
</style>
