/**
 * The RSSI matrix behind the radio ("Funk") tab.
 *
 * `rssiInfo` answers with `{[device]: {[peer]: [receive, send]}}` in dBm, where 65536 means "not
 * known" (the interface process's placeholder for an unsigned 16-bit -1). hmipserver has no
 * `rssiInfo`, so for HmIP the matrix is assembled from `RSSI_DEVICE` / `RSSI_PEER`, which arrive
 * as events and sit in every device's `<device>:0` VALUES paramset - the same thing 2.x does in
 * main.js (:404-432 for the events, :800-822 for the paramset read).
 */

import type {BidcosInterfaceInfo} from '../api/types.js';
import type {Paramset, ParamsetValue} from '../rpc/values.js';

/** What an interface process sends instead of a value it does not have. */
export const RSSI_UNKNOWN = 65536;

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

/** A step of the RSSI scale, 1 the strongest signal, 8 the weakest. */
export type RssiStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** How many of the pill's four signal bars a step lights. */
export type RssiBars = 0 | 1 | 2 | 3 | 4;

/** One band of the RSSI scale. */
export interface RssiBand {
    readonly step: RssiStep;
    /** The lowest reading that still belongs to the band, in dBm; `-Infinity` for the last one. */
    readonly min: number;
    readonly bars: RssiBars;
    /** What the band means, in English - the key the UI translates it by. */
    readonly label: string;
}

/**
 * The RSSI scale of the Funk tab (#161): eight bands, 10 dB apart from -30 to -90 dBm.
 *
 * Until 3.0.0-beta.17 there were three classes from the 2.x colour gradient - good from -20 dBm,
 * bad below -100 - and nearly every real link, which lies between -40 and -90, was the same yellow
 * "medium". Issue #161 (@Baxxy13) asked for a finer scale closer to the OpenCCU WebUI, which colours
 * green above -70, yellow down to -90 and red below; both of its edges are edges here. The maintainer
 * posted three eight-step palettes, and on 2026-09-15 he, @Baxxy13 and @Herbert-Testmann settled on
 * "Variante 3" with signal bars in the pill (arrangement B), so that the step reads without its
 * colour too. The fills are theme tokens (`--hmm-rssi-<step>`); this table is the part that is not
 * a colour.
 *
 * A reading belongs to the first band whose lower edge it reaches: -30 is step 1, -40 is step 2.
 */
export const RSSI_BANDS: readonly RssiBand[] = [
    {step: 1, min: -30, bars: 4, label: 'Very good (maximum)'},
    {step: 2, min: -40, bars: 4, label: 'Very good'},
    {step: 3, min: -50, bars: 4, label: 'Good'},
    {step: 4, min: -60, bars: 3, label: 'Good (normal operation)'},
    {step: 5, min: -70, bars: 3, label: 'Sufficient'},
    {step: 6, min: -80, bars: 2, label: 'Sufficient to weak'},
    {step: 7, min: -90, bars: 1, label: 'Poor'},
    {step: 8, min: Number.NEGATIVE_INFINITY, bars: 0, label: 'Critical'},
];

/**
 * One RSSI value as the CCU hands it out, as dBm - or `undefined` where it is not a measurement.
 *
 * Issue #154: a receive level in dBm is always negative, and yet `rssiInfo` and the `RSSI_*`
 * datapoints produce positive numbers (`37`), numbers far below the noise floor (`-208`) and
 * placeholders (`65536`, `128`). Three things are mixed in there:
 *
 * - **`65536`** is eQ-3's documented "no information" (the WebUI's `rssiinfo.tcl`: *"Der Wert 65536
 *   bedeutet, dass keine Informationen vorliegen"*), and `-65536`, `±256`, `0` and `±1` are used
 *   the same way by one component or another - `0`/`1` meaning nothing was received in that
 *   direction since the last start.
 * - **`128` / `-128`** (`0x80`) is the radio chip's "no RSSI available", not a level.
 * - The rest is a **sign that was lost on the way**: ReGaHss creates the maintenance datapoints as
 *   an unsigned byte (`ivtByte`) although the paramset says `INTEGER`, so values arrive with an
 *   offset of 256 or with the sign dropped. `130…255` is `value - 256`, `-255…-130` is
 *   `-value - 256` (which is what turns the maintainer's `-208` into a perfectly ordinary
 *   -48 dBm), and a bare positive `2…126` is the same level without its minus.
 *
 * The mapping is the one Home Assistant's `aiohomematic` applies (`model/generic/sensor.py`,
 * `_fix_rssi`); OpenCCU's WebUI does the `- 256` half in
 * `0144-WebUI-ControlForMaintenanceChannel` and hm2mqtt.js does it for the ReGa cache. The
 * inversion of a small positive value is the one step no eQ-3 source confirms - it is
 * `aiohomematic`'s reading, and it is what makes a `37` in the grid the -37 dBm it plainly is.
 */
export function normaliseRssiValue(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return undefined;
    }
    if (value > -127 && value < 0) {
        return value; // already a dBm value
    }
    if (value > 1 && value < 127) {
        return -value; // the minus was lost
    }
    if (value > -256 && value < -129) {
        return -value - 256; // -208 -> -48
    }
    if (value > 129 && value < 256) {
        return value - 256; // 218 -> -38
    }
    // 0, ±1, ±128, ±129, ±256, ±65536 and anything outside: not a measurement
    return undefined;
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
 * The band of {@link RSSI_BANDS} a reading falls into, or `undefined` where it is not a measurement
 * at all (65536 and the other placeholders of #154) - the grid shows a faint dash for those.
 */
export function rssiBand(dbm: number | undefined): RssiBand | undefined {
    const value = normaliseRssiValue(dbm);
    if (value === undefined) {
        return undefined;
    }
    return RSSI_BANDS.find((band) => value >= band.min);
}

/** The two fields of a `listBidcosInterfaces` entry that name it. */
export type BidcosInterfaceName = Pick<BidcosInterfaceInfo, 'ADDRESS' | 'DESCRIPTION'>;

/**
 * How a BidCos interface is named for a person: the `DESCRIPTION` the CCU carries for it - the
 * name a LAN gateway was given in the WebUI, `CCU2-Coprocessor` for the built-in module - and the
 * serial when there is none. The 2.x Funk grid put the serial over the interface's columns with
 * the description in small print under it; a gateway without a description shows its serial alone.
 */
export function bidcosInterfaceLabel(gateway: BidcosInterfaceName): string {
    const description = gateway.DESCRIPTION?.trim() ?? '';
    return description === '' ? gateway.ADDRESS : description;
}

/**
 * The receiver a BidCos-RF device is routed through, for the device grid (BUGS.md B-2): the
 * label of the gateway whose serial the description's `INTERFACE` names, the serial itself when
 * `listBidcosInterfaces` does not know it or has not been read yet, and nothing for a device
 * without one - HmIP and Wired have no receivers.
 */
export function receiverLabel(
    device: {readonly INTERFACE?: string | undefined},
    gateways: readonly BidcosInterfaceName[],
): string {
    const serial = device.INTERFACE ?? '';
    if (serial === '') {
        return '';
    }
    const gateway = gateways.find((candidate) => candidate.ADDRESS === serial);
    return gateway ? bidcosInterfaceLabel(gateway) : serial;
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

/**
 * Why a device is, or is not, proposed for another receiver (#69).
 *
 * - `switch`: another interface receives the device better than the configured one by at least
 *   the margin.
 * - `marginal`: another interface receives it better, but by less than the margin - one sample
 *   apart, which `rssiInfo` values are between two reads.
 * - `unheard`: the configured receiver has no measurement of the device at all while another
 *   interface has one; that can mean the device never reaches its receiver, or that rfd has not
 *   heard it since a restart.
 * - `keep`: the configured receiver hears it best, or at least as well as any other.
 * - `unmeasured`: no interface has a measurement.
 * - `roaming`: the device roams, so the CCU picks its receiver itself; nothing to assign.
 */
export type ReceiverVerdict = 'switch' | 'marginal' | 'unheard' | 'keep' | 'unmeasured' | 'roaming';

/** One row of the "assign the best receiver" proposal (#69). */
export interface ReceiverProposal {
    readonly address: string;
    /** The serial of the receiver the device is configured for. */
    readonly configured: string;
    /** What the configured receiver receives from the device, in dBm. */
    readonly configuredTx: number | undefined;
    /** The interface that receives the device best; `undefined` without a measurement. */
    readonly best: string | undefined;
    readonly bestTx: number | undefined;
    /** `bestTx - configuredTx` where both are known. */
    readonly gain: number | undefined;
    readonly verdict: ReceiverVerdict;
}

/**
 * The margin a better interface has to clear before a switch is proposed, in dB. The values of
 * `rssiInfo` are the last measurement rfd holds, and two reads of the same link differ by a few dB
 * without anything having moved; 6 dB is roughly a quartering of the received power and clears
 * that noise.
 */
export const DEFAULT_RECEIVER_MARGIN_DB = 6;

const VERDICT_ORDER: readonly ReceiverVerdict[] = ['switch', 'marginal', 'unheard', 'keep', 'unmeasured', 'roaming'];

/** The fields of a device description the proposal reads. */
export interface ReceiverCandidate {
    readonly ADDRESS: string;
    readonly PARENT?: string | undefined;
    readonly INTERFACE?: string | undefined;
    readonly ROAMING?: boolean | number | undefined;
}

/**
 * The dry run behind issue #69: for every BidCos-RF device with a receiver, which interface hears
 * it best and whether that is worth a `setBidcosInterface`. Nothing is written here - the list
 * is what the user confirms, device by device, before anything is. Channels and devices without
 * an `INTERFACE` (HmIP, Wired, groups) are not in the answer at all. Sorted by verdict in the
 * order of {@link ReceiverVerdict}, then by gain, then by address.
 */
export function proposeReceivers(
    devices: readonly ReceiverCandidate[],
    interfaceAddresses: readonly string[],
    store: Pick<RssiStore, 'get' | 'bestInterfaceFor'>,
    options: {readonly marginDb?: number | undefined} = {},
): ReceiverProposal[] {
    const margin = Math.max(0, options.marginDb ?? DEFAULT_RECEIVER_MARGIN_DB);
    const proposals: ReceiverProposal[] = [];
    for (const device of devices) {
        const configured = device.INTERFACE ?? '';
        if (configured === '' || (device.PARENT ?? '') !== '') {
            continue;
        }
        const configuredTx = store.get(device.ADDRESS, configured)?.tx;
        const best = store.bestInterfaceFor(device.ADDRESS, interfaceAddresses);
        const gain = best?.tx !== undefined && configuredTx !== undefined ? best.tx - configuredTx : undefined;
        let verdict: ReceiverVerdict;
        if (device.ROAMING === true || device.ROAMING === 1) {
            verdict = 'roaming';
        } else if (best === undefined) {
            verdict = 'unmeasured';
        } else if (best.address === configured) {
            verdict = 'keep';
        } else if (gain === undefined) {
            verdict = 'unheard';
        } else if (gain <= 0) {
            verdict = 'keep';
        } else {
            verdict = gain >= margin ? 'switch' : 'marginal';
        }
        proposals.push({
            address: device.ADDRESS,
            configured,
            configuredTx,
            best: best?.address,
            bestTx: best?.tx,
            gain,
            verdict,
        });
    }
    return proposals.sort(
        (a, b) =>
            VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict) ||
            (b.gain ?? Number.NEGATIVE_INFINITY) - (a.gain ?? Number.NEGATIVE_INFINITY) ||
            a.address.localeCompare(b.address),
    );
}
