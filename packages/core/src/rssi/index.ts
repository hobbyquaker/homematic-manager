/**
 * The RSSI matrix behind the radio ("Funk") tab.
 *
 * `rssiInfo` answers with `{[device]: {[peer]: [receive, send]}}` in dBm, where 65536 means "not
 * known" (the interface process's placeholder for an unsigned 16-bit -1). hmipserver has no
 * `rssiInfo`, so for HmIP the matrix is assembled from `RSSI_DEVICE` / `RSSI_PEER`, which arrive
 * as events and sit in every device's `<device>:0` VALUES paramset - the same thing 2.x does in
 * main.js (:404-432 for the events, :800-822 for the paramset read).
 */

import type {Paramset, ParamsetValue} from '../rpc/values.js';

/** What an interface process sends instead of a value it does not have. */
export const RSSI_UNKNOWN = 65536;

/** The thresholds of the 2.x `rssiColor()` (homematic-manager.js:4649). */
export const RSSI_BAD = -120;
export const RSSI_MEDIUM = -100;
export const RSSI_GOOD = -20;

/** What one partner measures of another. `undefined` where the interface reported 65536. */
export interface RssiPair {
    /** What this device receives from the peer, in dBm. */
    readonly rx?: number;
    /** What the peer receives from this device, in dBm. */
    readonly tx?: number;
}

/** An `rssiInfo` answer, straight off the wire. */
export type RawRssiInfo = Readonly<Record<string, Readonly<Record<string, readonly unknown[]>>>>;

/** device or interface address -> peer address -> the pair. */
export type RssiMatrix = Record<string, Record<string, RssiPair>>;

/** How good a signal is, for the colour of the grid cell. */
export type RssiClass = 'unknown' | 'bad' | 'medium' | 'good';

/** One value from an `rssiInfo` answer: a number, unless it is the "unknown" placeholder. */
export function normaliseRssiValue(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value === RSSI_UNKNOWN) {
        return undefined;
    }
    return value;
}

/** Turns an `rssiInfo` answer into the matrix, dropping the 65536 placeholders. */
export function normaliseRssiInfo(raw: RawRssiInfo): RssiMatrix {
    const matrix: RssiMatrix = {};
    for (const [address, peers] of Object.entries(raw)) {
        const row: Record<string, RssiPair> = {};
        for (const [peer, values] of Object.entries(peers)) {
            row[peer] = pair(normaliseRssiValue(values[0]), normaliseRssiValue(values[1]));
        }
        matrix[address] = row;
    }
    return matrix;
}

/**
 * How good a signal is. -20 dBm and better is good, -100 and worse is bad, in between is medium;
 * an absent value is unknown. The bounds come from the 2.x colour gradient.
 */
export function rssiClass(dbm: number | undefined): RssiClass {
    const value = normaliseRssiValue(dbm);
    if (value === undefined) {
        return 'unknown';
    }
    if (value >= RSSI_GOOD) {
        return 'good';
    }
    return value >= RSSI_MEDIUM ? 'medium' : 'bad';
}

/**
 * The red/green gradient of the 2.x grid, kept so the radio tab looks the same (D-3).
 * `undefined` for a value there is none for - the cell stays empty, as it did.
 */
export function rssiColor(dbm: number | undefined): string | undefined {
    const value = normaliseRssiValue(dbm);
    if (value === undefined) {
        return undefined;
    }
    const red = channel((256 * (value - RSSI_GOOD)) / (RSSI_MEDIUM - RSSI_GOOD));
    const green = channel((256 * (value - RSSI_BAD)) / (RSSI_MEDIUM - RSSI_BAD));
    return `#${hex(red)}${hex(green)}00`;
}

/** The HmIP datapoints the matrix is built from. */
export const RSSI_DATAPOINTS: readonly string[] = ['RSSI_DEVICE', 'RSSI_PEER'];

export interface RssiStoreOptions {
    /**
     * The HmIP access point's address, from `listBidcosInterfaces()`. Without it the HmIP values
     * have no counterpart to be filed under and are dropped.
     */
    readonly centralAddress?: string;
}

/** The RSSI matrix of one interface. */
export class RssiStore {
    #matrix: RssiMatrix = {};
    #centralAddress: string | undefined;

    constructor(options: RssiStoreOptions = {}) {
        this.#centralAddress = options.centralAddress;
    }

    /** The access point address the HmIP values are filed against. */
    get centralAddress(): string | undefined {
        return this.#centralAddress;
    }

    /** Set once `listBidcosInterfaces` has answered. */
    setCentralAddress(address: string): void {
        this.#centralAddress = address;
    }

    /** Replaces everything with a fresh `rssiInfo` answer (BidCos). */
    applyRssiInfo(raw: RawRssiInfo): void {
        this.#matrix = normaliseRssiInfo(raw);
    }

    /**
     * Applies an HmIP `RSSI_DEVICE` / `RSSI_PEER` value, filing it in both directions exactly as
     * 2.x does: `RSSI_DEVICE` is what the access point receives from the device, `RSSI_PEER` what
     * the device receives from the access point.
     *
     * Returns false for a datapoint that is not an RSSI one, for an unusable value, or while the
     * access point address is still unknown.
     */
    applyHmipValue(deviceAddress: string, datapoint: string, value: ParamsetValue): boolean {
        const central = this.#centralAddress;
        const dbm = normaliseRssiValue(value);
        if (central === undefined || dbm === undefined || !RSSI_DATAPOINTS.includes(datapoint)) {
            return false;
        }
        if (datapoint === 'RSSI_DEVICE') {
            this.#merge(central, deviceAddress, {rx: dbm});
            this.#merge(deviceAddress, central, {tx: dbm});
        } else {
            this.#merge(deviceAddress, central, {rx: dbm});
            this.#merge(central, deviceAddress, {tx: dbm});
        }
        return true;
    }

    /** Applies the RSSI datapoints of a `getParamset(<device>:0, VALUES)` answer. */
    applyHmipParamset(deviceAddress: string, values: Paramset): boolean {
        let changed = false;
        for (const datapoint of RSSI_DATAPOINTS) {
            const value = values[datapoint];
            if (value !== undefined) {
                changed = this.applyHmipValue(deviceAddress, datapoint, value) || changed;
            }
        }
        return changed;
    }

    /** What `a` measures of `b`. */
    get(a: string, b: string): RssiPair | undefined {
        return this.#matrix[a]?.[b];
    }

    /** The peers of an address, sorted. */
    peersOf(address: string): string[] {
        return Object.keys(this.#matrix[address] ?? {}).sort();
    }

    /** The whole matrix, as a plain object. */
    toJSON(): RssiMatrix {
        const copy: RssiMatrix = {};
        for (const [address, peers] of Object.entries(this.#matrix)) {
            copy[address] = {...peers};
        }
        return copy;
    }

    /**
     * The interface a device is heard best by, among the given candidates - the input for the
     * "use the strongest interface" action of issue #69. Compares what the interface receives from
     * the device (`tx` on the device's row), the value that decides whether a command gets through.
     */
    bestInterfaceFor(
        deviceAddress: string,
        interfaceAddresses: readonly string[],
    ): {readonly address: string; readonly rx?: number; readonly tx?: number} | undefined {
        let best: {address: string; rx?: number; tx?: number} | undefined;
        let bestValue = Number.NEGATIVE_INFINITY;
        for (const address of interfaceAddresses) {
            const measured = this.get(deviceAddress, address);
            if (measured?.tx === undefined) {
                continue;
            }
            if (measured.tx > bestValue) {
                bestValue = measured.tx;
                best = {address, ...measured};
            }
        }
        return best;
    }

    #merge(address: string, peer: string, values: RssiPair): void {
        const row = (this.#matrix[address] ??= {});
        row[peer] = {...row[peer], ...values};
    }
}

function pair(rx: number | undefined, tx: number | undefined): RssiPair {
    const result: {rx?: number; tx?: number} = {};
    if (rx !== undefined) {
        result.rx = rx;
    }
    if (tx !== undefined) {
        result.tx = tx;
    }
    return result;
}

function channel(value: number): number {
    return Math.min(255, Math.max(0, Math.round(value)));
}

function hex(value: number): string {
    return `0${value.toString(16)}`.slice(-2);
}
