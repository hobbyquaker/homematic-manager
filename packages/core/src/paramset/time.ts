/**
 * Time parameters: the `*_TIME_BASE` / `*_TIME_FACTOR` pairs and the "not used / infinite" value.
 *
 * A duration is stored as a base out of eight fixed steps times a factor 0..31, i.e. eight bits
 * altogether. `ON_TIME_BASE = BASE_1_H, ON_TIME_FACTOR = 31` is 111600 s, the largest value the
 * pair can express, and that is what "on forever" means on the wire.
 *
 * ## Issue #96: 111600 s here, 16383000 s in the WebUI - which is right?
 *
 * Both, for their own device. The value is not a constant: it is in the parameter's own
 * description, as the `SPECIAL` entry with `ID: NOT_USED`, and it differs by interface because the
 * encodings differ. Taken from real descriptions (test/fixtures/paramset-descriptions.json):
 *
 *   BidCos-RF   HM-LC-Sw1-Pl-CT-R1 SWITCH/LINK LONG_OFF_TIME
 *               TYPE FLOAT, MIN 0, MAX 108000, SPECIAL [{NOT_USED, 111600}]
 *   BidCos-Wired HMW-LC-Dim1L-DR   DIMMER/LINK LONG_OFF_TIME
 *               TYPE FLOAT, MIN 0, MAX 982980, SPECIAL [{NOT_USED, 16383000}]
 *   HmIP-RF     HmIP-PDT DIMMER_VIRTUAL_RECEIVER/LINK LONG_OFF_TIME_BASE / _FACTOR
 *               ENUM BASE_100_MS..BASE_1_H, DEFAULT BASE_1_H, and INTEGER 0..31, DEFAULT 31
 *               -> the pair's maximum, 111600 s
 *
 * So the BidCos-RF and HmIP-RF answer is 111600 s (the base/factor maximum), and hs485d's is
 * 16383000 s (its own 14-bit encoding, whose MAX is 982980 = 16383 * 60). The 2.x UI has 111600
 * hard-coded in the "unlimited" entry of its LENGTH_OF_STAY select
 * (homematic-manager.js:3237) and therefore shows the BidCos-RF value on a wired device, which is
 * exactly what #96 reports. Read the value from `SPECIAL` instead of hard-coding either one.
 */

import type {ParameterDescription, ParamsetDescription} from './description.js';
import type {ParamsetValue} from '../rpc/values.js';

/** The eight time bases in seconds, in `VALUE_LIST` order. */
export const TIME_BASES: readonly number[] = [0.1, 1, 5, 10, 60, 300, 600, 3600];

/** The names the CCU uses for them, in the same order. */
export const TIME_BASE_NAMES: readonly string[] = [
    'BASE_100_MS',
    'BASE_1_S',
    'BASE_5_S',
    'BASE_10_S',
    'BASE_1_M',
    'BASE_5_M',
    'BASE_10_M',
    'BASE_1_H',
];

/** `*_TIME_FACTOR` is `INTEGER` 0..31 on every device that has one. */
export const MAX_TIME_FACTOR = 31;

/** The longest duration a base/factor pair can express: `BASE_1_H` * 31. */
export const MAX_BASE_FACTOR_SECONDS = 111600;

/** The `SPECIAL.ID` that marks the "not used / infinite" value. */
export const NOT_USED = 'NOT_USED';

const BASE_SUFFIX = '_TIME_BASE';
const FACTOR_SUFFIX = '_TIME_FACTOR';

/** A `*_TIME_BASE` / `*_TIME_FACTOR` pair found in a paramset description. */
export interface TimeParameterPair {
    /** The common prefix, e.g. `SHORT_ON` for `SHORT_ON_TIME_BASE`. */
    readonly name: string;
    readonly baseParam: string;
    readonly factorParam: string;
}

/** A decoded duration. */
export interface DecodedTime {
    readonly seconds: number;
    readonly baseIndex: number;
    readonly base: number;
    readonly factor: number;
    /** The pair is at its maximum, which is how "on forever" is expressed. */
    readonly infinite: boolean;
}

/** The base index a `*_TIME_BASE` value stands for: an index on BidCos, a name on HmIP. */
export function timeBaseIndex(value: ParamsetValue | undefined): number | undefined {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < TIME_BASES.length) {
        return value;
    }
    if (typeof value === 'string') {
        const index = TIME_BASE_NAMES.indexOf(value);
        return index === -1 ? undefined : index;
    }
    return undefined;
}

/** The seconds one base step stands for. */
export function timeBaseSeconds(value: ParamsetValue | undefined): number | undefined {
    const index = timeBaseIndex(value);
    return index === undefined ? undefined : TIME_BASES[index];
}

/**
 * base + factor -> seconds. Returns `undefined` for a base the table does not know or a factor
 * outside 0..31, so that a broken pair is reported rather than silently turned into a duration.
 */
export function decodeTime(
    base: ParamsetValue | undefined,
    factor: ParamsetValue | undefined,
): DecodedTime | undefined {
    const baseIndex = timeBaseIndex(base);
    const baseSeconds = baseIndex === undefined ? undefined : TIME_BASES[baseIndex];
    const factorValue = typeof factor === 'number' ? factor : Number.NaN;
    if (
        baseIndex === undefined ||
        baseSeconds === undefined ||
        !Number.isInteger(factorValue) ||
        factorValue < 0 ||
        factorValue > MAX_TIME_FACTOR
    ) {
        return undefined;
    }
    return {
        seconds: round(baseSeconds * factorValue),
        baseIndex,
        base: baseSeconds,
        factor: factorValue,
        infinite: baseIndex === TIME_BASES.length - 1 && factorValue === MAX_TIME_FACTOR,
    };
}

/**
 * seconds -> base + factor. Picks the smallest base that hits the value exactly with a factor
 * 0..31; when no base does, the one whose representable value is closest (and among equals the
 * smaller base, which has the finer resolution). `exact` says which of the two happened, so the
 * dialog can warn that the device will not do exactly what was typed.
 */
export function encodeTime(seconds: number): (DecodedTime & {readonly exact: boolean}) | undefined {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return undefined;
    }
    if (seconds > MAX_BASE_FACTOR_SECONDS) {
        return undefined;
    }
    let best: (DecodedTime & {exact: boolean}) | undefined;
    let bestError = Number.POSITIVE_INFINITY;
    for (const [baseIndex, base] of TIME_BASES.entries()) {
        const factor = Math.min(MAX_TIME_FACTOR, Math.max(0, Math.round(seconds / base)));
        const value = round(base * factor);
        const error = Math.abs(value - seconds);
        if (error < bestError) {
            bestError = error;
            best = {
                seconds: value,
                baseIndex,
                base,
                factor,
                infinite: baseIndex === TIME_BASES.length - 1 && factor === MAX_TIME_FACTOR,
                exact: error === 0,
            };
        }
        if (error === 0) {
            break;
        }
    }
    return best;
}

/** Every `*_TIME_BASE` in a description that has a matching `*_TIME_FACTOR`, in description order. */
export function findTimePairs(description: ParamsetDescription): TimeParameterPair[] {
    const pairs: TimeParameterPair[] = [];
    for (const param of Object.keys(description)) {
        if (!param.endsWith(BASE_SUFFIX)) {
            continue;
        }
        const name = param.slice(0, -BASE_SUFFIX.length);
        const factorParam = `${name}${FACTOR_SUFFIX}`;
        if (factorParam in description) {
            pairs.push({name, baseParam: param, factorParam});
        }
    }
    return pairs;
}

/** The duration a pair currently holds, or `undefined` when one half is missing or malformed. */
export function readTimePair(
    values: Readonly<Record<string, ParamsetValue>>,
    pair: TimeParameterPair,
): DecodedTime | undefined {
    return decodeTime(values[pair.baseParam], values[pair.factorParam]);
}

/**
 * The two values to write for a duration. The base is returned as its index; `castValue` turns it
 * into the enum name where the interface wants names (HmIP).
 */
export function writeTimePair(seconds: number, pair: TimeParameterPair): Record<string, number> | undefined {
    const encoded = encodeTime(seconds);
    if (!encoded) {
        return undefined;
    }
    return {[pair.baseParam]: encoded.baseIndex, [pair.factorParam]: encoded.factor};
}

/**
 * The value that means "not used" / "infinite" for this parameter, read from its `SPECIAL` list.
 * 111600 on BidCos-RF and HmIP-RF, 16383000 on BidCos-Wired - see the note at the top (#96).
 */
export function notUsedValue(description: ParameterDescription | undefined): number | undefined {
    return description?.SPECIAL?.find((special) => special.ID === NOT_USED)?.VALUE;
}

/** Is this value the parameter's "not used" value? */
export function isNotUsed(description: ParameterDescription, value: unknown): boolean {
    const notUsed = notUsedValue(description);
    return notUsed !== undefined && value === notUsed;
}

/** 0.1 * 3 is 0.30000000000000004; durations are exact to a tenth of a second, so round there. */
function round(value: number): number {
    return Math.round(value * 10) / 10;
}
