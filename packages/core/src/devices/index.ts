/**
 * The device model: `DeviceDescription` as `listDevices` and `newDevices` deliver it, the bit
 * fields it carries, and an index over one interface's devices and channels.
 *
 * The 2.x renderer kept this as four global objects (`listDevices`, `indexChannels`,
 * `indexSourceRoles`, `indexTargetRoles`) that were rebuilt and mutated while rendering. Here it
 * is one immutable index built once per `listDevices` answer.
 */

import {compareAddresses, MAINTENANCE_CHANNEL, tryParseAddress} from '../address/address.js';

/**
 * A logical device or channel as the interface process describes it. Only `ADDRESS` and `TYPE` are
 * guaranteed; which of the rest an interface sends differs between rfd, hs485d, hmipserver, the
 * group process and CUxD, so everything else is optional.
 */
export interface DeviceDescription {
    readonly ADDRESS: string;
    readonly TYPE: string;
    /** Empty string or absent on a device, the device's address on a channel. */
    readonly PARENT?: string;
    readonly PARENT_TYPE?: string;
    readonly CHILDREN?: readonly string[];
    readonly PARAMSETS?: readonly string[];
    readonly FLAGS?: number;
    readonly DIRECTION?: number;
    readonly LINK_SOURCE_ROLES?: string;
    readonly LINK_TARGET_ROLES?: string;
    readonly VERSION?: number;
    readonly FIRMWARE?: string;
    readonly AVAILABLE_FIRMWARE?: string;
    readonly FIRMWARE_UPDATE_STATE?: string;
    readonly UPDATABLE?: boolean | number;
    readonly RX_MODE?: number;
    readonly INTERFACE?: string;
    readonly ROAMING?: boolean | number;
    readonly RF_ADDRESS?: number;
    readonly AES_ACTIVE?: boolean | number;
    readonly TEAM?: string;
    readonly TEAM_TAG?: string;
    readonly TEAM_CHANNELS?: readonly string[];
    readonly GROUP?: string;
    readonly INDEX?: number;
    readonly SUBTYPE?: string;
}

/** `FLAGS` bits of a device description. */
export const DEVICE_FLAGS = {
    VISIBLE: 1,
    INTERNAL: 2,
    DONT_DELETE: 8,
} as const;

/** Decoded `FLAGS`, as the 2.x device grid's "flags" column showed them. */
export interface DecodedDeviceFlags {
    readonly visible: boolean;
    readonly internal: boolean;
    readonly dontDelete: boolean;
    /** Bits the specification does not name; kept so nothing is silently lost. */
    readonly unknownBits: number;
    /** `['Visible', 'DontDelete']` - the labels the old grid printed. */
    readonly labels: readonly string[];
}

/** Decodes the `FLAGS` bit field. A missing value means no flags. */
export function decodeDeviceFlags(flags: number | undefined): DecodedDeviceFlags {
    const bits = typeof flags === 'number' ? flags : 0;
    const visible = (bits & DEVICE_FLAGS.VISIBLE) !== 0;
    const internal = (bits & DEVICE_FLAGS.INTERNAL) !== 0;
    const dontDelete = (bits & DEVICE_FLAGS.DONT_DELETE) !== 0;
    const labels: string[] = [];
    if (visible) {
        labels.push('Visible');
    }
    if (internal) {
        labels.push('Internal');
    }
    if (dontDelete) {
        labels.push('DontDelete');
    }
    const known = DEVICE_FLAGS.VISIBLE | DEVICE_FLAGS.INTERNAL | DEVICE_FLAGS.DONT_DELETE;
    return {visible, internal, dontDelete, unknownBits: bits & ~known, labels};
}

/** `RX_MODE` bits: when the device listens. */
export const RX_MODES = {
    ALWAYS: 1,
    BURST: 2,
    CONFIG: 4,
    WAKEUP: 8,
    LAZY_CONFIG: 16,
} as const;

/**
 * Decodes `RX_MODE` into its names. This is what decides whether a `putParamset MASTER` reaches a
 * device now or waits for the next wake-up - the difference between a `CONFIG_PENDING` that clears
 * by itself and one that does not (task 6).
 */
export function decodeRxMode(rxMode: number | undefined): string[] {
    const bits = typeof rxMode === 'number' ? rxMode : 0;
    const names: string[] = [];
    for (const [name, bit] of Object.entries(RX_MODES)) {
        if ((bits & bit) !== 0) {
            names.push(name);
        }
    }
    return names;
}

/** `DIRECTION` of a channel. */
export const DIRECTIONS = ['NONE', 'SENDER', 'RECEIVER'] as const;

/** Decodes `DIRECTION`; anything unexpected is `NONE`, as the 2.x grid did. */
export function decodeDirection(direction: number | undefined): (typeof DIRECTIONS)[number] {
    return DIRECTIONS[direction ?? 0] ?? 'NONE';
}

/**
 * The device types the CCU's own virtual "central" devices have. They exist on every interface,
 * carry no hardware, and must never be offered for deletion, firmware update or a paramset write.
 * `CENTRAL` is what the group process and CUxD call theirs.
 */
export const CENTRAL_DEVICE_TYPES: readonly string[] = ['HM-RCV-50', 'HMW-RCV-50', 'HmIP-RCV-50', 'CENTRAL'];

/** Is this the CCU's own virtual device rather than real hardware? */
export function isCentralDeviceType(type: string): boolean {
    return CENTRAL_DEVICE_TYPES.includes(type);
}

/**
 * Is this description a channel (rather than a device)? Narrows PARENT to a string, which is
 * what makes the parent lookups below total.
 */
export function isChannelDescription(
    description: DeviceDescription,
): description is DeviceDescription & {readonly PARENT: string} {
    return typeof description.PARENT === 'string' && description.PARENT !== '';
}

/**
 * The description cache key, and the key that decides whether two channels may be written in one
 * multi-apply (task 6): `interface/deviceType/firmware/version/channelType/paramset`.
 *
 * Built exactly as `paramsetName()` in the 2.x main.js does, so that caches written by 2.x and the
 * paramsets.json of node-red-contrib-ccu use the same keys: for a device the channel type is
 * empty, for a channel the device's type, firmware and version are used together with the
 * channel's type. Missing firmware or version become an empty segment.
 *
 * @param parent required for a channel - the description of its device.
 */
export function paramsetIdentity(
    interfaceName: string,
    description: DeviceDescription,
    paramset: string,
    parent?: DeviceDescription,
): string {
    let channelType = '';
    let device = description;
    if (isChannelDescription(description)) {
        if (!parent) {
            throw new Error(`cannot build a paramset identity for channel ${description.ADDRESS} without its device`);
        }
        channelType = description.TYPE;
        device = parent;
    }
    const firmware = device.FIRMWARE ?? '';
    const version = device.VERSION === undefined ? '' : String(device.VERSION);
    return [interfaceName, device.TYPE, firmware, version, channelType, paramset].join('/');
}

/** Splits the space-separated `LINK_SOURCE_ROLES` / `LINK_TARGET_ROLES` lists. */
export function parseRoles(roles: string | undefined): string[] {
    if (roles === undefined || roles.trim() === '') {
        return [];
    }
    return roles.trim().split(/\s+/);
}

/** An index over the devices and channels of one interface. */
export class DeviceIndex {
    /** The interface these descriptions came from; part of every paramset identity. */
    readonly interfaceName: string;

    readonly #byAddress = new Map<string, DeviceDescription>();
    readonly #deviceAddresses: string[] = [];
    readonly #channelAddresses: string[] = [];
    readonly #childrenByParent = new Map<string, string[]>();
    readonly #sourceRoles = new Map<string, string[]>();
    readonly #targetRoles = new Map<string, string[]>();

    constructor(interfaceName: string, descriptions: Iterable<DeviceDescription> = []) {
        this.interfaceName = interfaceName;
        for (const description of descriptions) {
            this.#add(description);
        }
        this.#deviceAddresses.sort(compareAddresses);
        this.#channelAddresses.sort(compareAddresses);
        for (const children of this.#childrenByParent.values()) {
            children.sort(compareAddresses);
        }
    }

    #add(description: DeviceDescription): void {
        const {ADDRESS} = description;
        this.#byAddress.set(ADDRESS, description);
        if (isChannelDescription(description)) {
            this.#channelAddresses.push(ADDRESS);
            const siblings = this.#childrenByParent.get(description.PARENT);
            if (siblings) {
                siblings.push(ADDRESS);
            } else {
                this.#childrenByParent.set(description.PARENT, [ADDRESS]);
            }
        } else {
            this.#deviceAddresses.push(ADDRESS);
        }
        for (const role of parseRoles(description.LINK_SOURCE_ROLES)) {
            addToRoleIndex(this.#sourceRoles, role, ADDRESS);
        }
        for (const role of parseRoles(description.LINK_TARGET_ROLES)) {
            addToRoleIndex(this.#targetRoles, role, ADDRESS);
        }
    }

    /** Number of descriptions, devices and channels together. */
    get size(): number {
        return this.#byAddress.size;
    }

    has(address: string): boolean {
        return this.#byAddress.has(address);
    }

    get(address: string): DeviceDescription | undefined {
        return this.#byAddress.get(address);
    }

    /** Like {@link get}, but throws - for callers that already know the address exists. */
    require(address: string): DeviceDescription {
        const description = this.#byAddress.get(address);
        if (!description) {
            throw new Error(`unknown address ${address} on interface ${this.interfaceName}`);
        }
        return description;
    }

    /** Devices only, sorted by address. */
    devices(): DeviceDescription[] {
        return this.#deviceAddresses.map((address) => this.require(address));
    }

    /** Channels only, sorted by address. */
    channels(): DeviceDescription[] {
        return this.#channelAddresses.map((address) => this.require(address));
    }

    /** Everything, devices before their channels. */
    all(): DeviceDescription[] {
        return [...this.#byAddress.values()].sort((a, b) => compareAddresses(a.ADDRESS, b.ADDRESS));
    }

    /**
     * The channels of a device. Derived from the `PARENT` back-references; only when the index
     * holds no channels for the device is its own `CHILDREN` list consulted, and then only the
     * entries the index actually knows.
     */
    childrenOf(address: string): DeviceDescription[] {
        const derived = this.#childrenByParent.get(address);
        if (derived) {
            return derived.map((child) => this.require(child));
        }
        const children = this.#byAddress.get(address)?.CHILDREN ?? [];
        return children
            .map((child) => this.#byAddress.get(child))
            .filter((child): child is DeviceDescription => child !== undefined);
    }

    /** The device a channel belongs to; `undefined` for a device or an unknown parent. */
    parentOf(address: string): DeviceDescription | undefined {
        const description = this.#byAddress.get(address);
        if (!description || !isChannelDescription(description)) {
            return undefined;
        }
        return this.#byAddress.get(description.PARENT);
    }

    /** The `:0` channel of a device or of the device a channel belongs to. */
    maintenanceChannelOf(address: string): DeviceDescription | undefined {
        const parsed = tryParseAddress(address);
        if (!parsed) {
            return undefined;
        }
        return this.#byAddress.get(`${parsed.device}:${MAINTENANCE_CHANNEL}`);
    }

    /** Is this address one of the CCU's own virtual devices (or a channel of one)? */
    isCentral(address: string): boolean {
        const description = this.#byAddress.get(address);
        if (!description) {
            return false;
        }
        if (isCentralDeviceType(description.TYPE)) {
            return true;
        }
        const parentType = description.PARENT_TYPE ?? this.parentOf(address)?.TYPE;
        return parentType !== undefined && isCentralDeviceType(parentType);
    }

    /** The CCU's own virtual devices on this interface. */
    centralDevices(): DeviceDescription[] {
        return this.devices().filter((device) => isCentralDeviceType(device.TYPE));
    }

    /** Channel addresses that can send to the given link role. */
    sourceRole(role: string): string[] {
        return [...(this.#sourceRoles.get(role) ?? [])];
    }

    /** Channel addresses that can receive the given link role. */
    targetRole(role: string): string[] {
        return [...(this.#targetRoles.get(role) ?? [])];
    }

    /** Every role any channel of this interface can send, sorted. */
    sourceRoles(): string[] {
        return [...this.#sourceRoles.keys()].sort();
    }

    /** Every role any channel of this interface can receive, sorted. */
    targetRoles(): string[] {
        return [...this.#targetRoles.keys()].sort();
    }

    /**
     * The paramset description identity of an address, i.e. the cache key and the multi-apply
     * eligibility key. `undefined` when the address, or a channel's device, is not in the index.
     */
    paramsetIdentity(address: string, paramset: string): string | undefined {
        const description = this.#byAddress.get(address);
        if (!description) {
            return undefined;
        }
        if (!isChannelDescription(description)) {
            return paramsetIdentity(this.interfaceName, description, paramset);
        }
        const parent = this.parentOf(address);
        if (!parent) {
            return undefined;
        }
        return paramsetIdentity(this.interfaceName, description, paramset, parent);
    }
}

function addToRoleIndex(index: Map<string, string[]>, role: string, address: string): void {
    const addresses = index.get(role);
    if (addresses) {
        addresses.push(address);
    } else {
        index.set(role, [address]);
    }
}
