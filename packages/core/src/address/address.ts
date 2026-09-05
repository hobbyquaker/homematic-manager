/**
 * The Homematic address model.
 *
 * Every logical device is addressed by its serial number and every channel by `SERIAL:INDEX`:
 *
 *   BidCos-RF      `LEQ0123456`, `LEQ0123456:1`
 *   BidCos-Wired   `IEQ0123456`, `IEQ0123456:1`
 *   HmIP-RF        `0001D3C99C1234`, `0001D3C99C1234:0`
 *   CUxD           `CUX2801001`, `CUX2801001:1`
 *   VirtualDevices `INT0000001`, `INT0000001:1`
 *   the interfaces' own devices: `BidCoS-RF`, `HMW-RCV-50 ...`
 *
 * There is no interface-specific parsing: the serial is opaque, only the `:INDEX` suffix carries
 * meaning. Channel 0 is the maintenance channel every device has - it carries UNREACH, LOWBAT,
 * CONFIG_PENDING and, on HmIP, RSSI_DEVICE/RSSI_PEER.
 */

/** Index of the maintenance channel. */
export const MAINTENANCE_CHANNEL = 0;

/** A parsed `ADDRESS`. `index` and `channel` are set exactly for channel addresses. */
export interface ParsedAddress {
    /** The address as given. */
    readonly address: string;
    /** The device part, i.e. the address without `:INDEX`. */
    readonly device: string;
    /** The channel index, absent for a device address. */
    readonly index?: number;
    /** The channel address, absent for a device address (then equal to `device`). */
    readonly channel?: string;
    readonly isDevice: boolean;
    readonly isChannel: boolean;
    /** `:0` - the maintenance channel. */
    readonly isMaintenance: boolean;
}

/** Thrown by {@link parseAddress} for something that is not an address. */
export class AddressError extends Error {
    readonly address: string;

    constructor(address: string, reason: string) {
        super(`invalid address ${JSON.stringify(address)}: ${reason}`);
        this.name = 'AddressError';
        this.address = address;
    }
}

const INDEX_PATTERN = /^\d+$/;

/**
 * Parses an `ADDRESS`. Returns `undefined` instead of throwing; use {@link parseAddress} where an
 * invalid address is a bug rather than user input.
 */
export function tryParseAddress(address: string): ParsedAddress | undefined {
    if (address === '') {
        return undefined;
    }
    const colon = address.indexOf(':');
    if (colon === -1) {
        return {address, device: address, isDevice: true, isChannel: false, isMaintenance: false};
    }
    const device = address.slice(0, colon);
    const index = address.slice(colon + 1);
    if (device === '' || !INDEX_PATTERN.test(index)) {
        return undefined;
    }
    const parsed = Number.parseInt(index, 10);
    return {
        address,
        device,
        index: parsed,
        channel: address,
        isDevice: false,
        isChannel: true,
        isMaintenance: parsed === MAINTENANCE_CHANNEL,
    };
}

/** Parses an `ADDRESS`, throwing an {@link AddressError} for anything malformed. */
export function parseAddress(address: string): ParsedAddress {
    const parsed = tryParseAddress(address);
    if (!parsed) {
        if (address === '') {
            throw new AddressError(address, 'empty');
        }
        throw new AddressError(address, 'expected SERIAL or SERIAL:INDEX with a numeric index');
    }
    return parsed;
}

/** Is this a device address (no `:INDEX`)? Malformed addresses are neither device nor channel. */
export function isDeviceAddress(address: string): boolean {
    return tryParseAddress(address)?.isDevice === true;
}

/** Is this a channel address (`SERIAL:INDEX`)? */
export function isChannelAddress(address: string): boolean {
    return tryParseAddress(address)?.isChannel === true;
}

/** Is this the maintenance channel `SERIAL:0`? */
export function isMaintenanceAddress(address: string): boolean {
    return tryParseAddress(address)?.isMaintenance === true;
}

/** The device an address belongs to; a device address is its own device. */
export function deviceAddress(address: string): string {
    return parseAddress(address).device;
}

/** The parent device of a channel, `undefined` for a device address. */
export function parentAddress(address: string): string | undefined {
    const parsed = parseAddress(address);
    return parsed.isChannel ? parsed.device : undefined;
}

/** The channel index, `undefined` for a device address. */
export function channelIndex(address: string): number | undefined {
    return parseAddress(address).index;
}

/** Builds `SERIAL:INDEX`. Throws for an empty serial or an index that is not a whole number >= 0. */
export function channelAddress(device: string, index: number): string {
    if (device === '' || device.includes(':')) {
        throw new AddressError(device, 'not a device serial');
    }
    if (!Number.isInteger(index) || index < 0) {
        throw new AddressError(`${device}:${index}`, 'channel index must be a non-negative integer');
    }
    return `${device}:${index}`;
}

/** The maintenance channel of a device (or of the device a channel belongs to). */
export function maintenanceAddress(address: string): string {
    return channelAddress(deviceAddress(address), MAINTENANCE_CHANNEL);
}

/**
 * Sort order for grids: by serial, then by channel index numerically - `:2` before `:10`, and the
 * device before its channels. Unparseable addresses sort last, among themselves lexically.
 */
export function compareAddresses(a: string, b: string): number {
    const left = tryParseAddress(a);
    const right = tryParseAddress(b);
    if (!left || !right) {
        if (left) {
            return -1;
        }
        if (right) {
            return 1;
        }
        return a < b ? -1 : a > b ? 1 : 0;
    }
    if (left.device !== right.device) {
        return left.device < right.device ? -1 : 1;
    }
    return (left.index ?? -1) - (right.index ?? -1);
}
