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

import {enumList, numericBound, type ParameterDescription, type ParamsetDescription} from './description.js';
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

/**
 * ## The other duration encodings
 *
 * `*_TIME_BASE` / `*_TIME_FACTOR` is not the only pair a description uses for a duration, and an
 * editor that only knows that one leaves the rest as two raw numbers the user has to multiply in
 * their head. Taken from real descriptions (node-red-contrib-ccu's `paramsets.json`):
 *
 *   `X_BASE` / `X_FACTOR`  the same eight bases under another prefix - `SWITCHING_INTERVAL_BASE`
 *                          on BidCos-RF, and `01_WP_DURATION_BASE` and `01_WP_RAMP_TIME_BASE`
 *                          inside the 75 slots of an HmIP week profile.
 *   `X_UNIT` / `X_VALUE`   HmIP's own encoding: an ENUM of unit tokens plus an INTEGER count.
 *                          `REFERENCE_RUNNING_TIME_BOTTOM_TOP_UNIT` is `10MS|100MS|1S|10S` with a
 *                          value 0..16383, `POWERUP_ONDELAY_UNIT` is `100MS|1S|5S|10S|1M|5M|10M|H`,
 *                          `DURATION_UNIT` is `S|M|H|D` on some devices and `S|M|H` on others, and
 *                          `RAMP_TIME_UNIT` is `S|M|H|10MS` - the list is neither sorted nor stable
 *                          across parameters, so the seconds always come from the token.
 *
 * Both are read here through one {@link DurationPair}, so a picker written once covers all of them.
 * Nothing is assumed about the vocabulary of a `_UNIT` enum: a pair is only recognised when every
 * one of its `VALUE_LIST` entries is a token this table knows, which is what keeps
 * `DISPLAY_TEMPERATUR_UNIT` (`CELSIUS|FAHRENHEIT`) out of it.
 */

/** The duration tokens an HmIP `*_UNIT` enum uses, and what each is worth in seconds. */
export const DURATION_UNIT_SECONDS: Readonly<Record<string, number>> = {
    '10MS': 0.01,
    '100MS': 0.1,
    S: 1,
    '1S': 1,
    '5S': 5,
    '10S': 10,
    M: 60,
    '1M': 60,
    '5M': 300,
    '10M': 600,
    H: 3600,
    '1H': 3600,
    D: 86_400,
};

const BASE_SUFFIX_SHORT = '_BASE';
const FACTOR_SUFFIX_SHORT = '_FACTOR';
const UNIT_SUFFIX = '_UNIT';
const VALUE_SUFFIX = '_VALUE';
const TIME_INFIX = '_TIME';

/** How a pair encodes its duration. */
export type DurationPairKind = 'base-factor' | 'unit-value';

/** One step of a pair's unit selector. */
export interface DurationUnit {
    /** The enum name the description carries, e.g. `BASE_1_M` or `10MS`. */
    readonly name: string;
    readonly seconds: number;
}

/** A duration expressed as two parameters: a unit (or base) and a count (or factor). */
export interface DurationPair {
    /** The common prefix, e.g. `SHORT_ON` or `REFERENCE_RUNNING_TIME_BOTTOM_TOP`. */
    readonly name: string;
    readonly kind: DurationPairKind;
    /** `*_TIME_BASE`, `*_BASE` or `*_UNIT`. */
    readonly unitParam: string;
    /** `*_TIME_FACTOR`, `*_FACTOR` or `*_VALUE`. */
    readonly countParam: string;
    /** The unit steps in `VALUE_LIST` order; the index is what the parameter stores. */
    readonly units: readonly DurationUnit[];
    /** The largest count the description allows - 31 for a factor, `MAX` for a `*_VALUE`. */
    readonly maxCount: number;
}

/** A duration read back out of a pair. */
export interface DecodedDuration {
    readonly seconds: number;
    readonly unitIndex: number;
    readonly unitSeconds: number;
    readonly count: number;
    /** Both halves are at their maximum, which is how "for ever" is expressed. */
    readonly maximal: boolean;
}

/**
 * Every duration pair in a description, in description order: the base/factor pairs first seen on
 * BidCos and the unit/value pairs of HmIP alike. A `*_TIME_BASE` pair is reported with the same
 * `name` {@link findTimePairs} gives it, so the two views cannot disagree.
 */
export function findDurationPairs(description: ParamsetDescription): DurationPair[] {
    const pairs: DurationPair[] = [];
    for (const [param, parameter] of Object.entries(description)) {
        const pair = baseFactorPair(description, param, parameter) ?? unitValuePair(description, param, parameter);
        if (pair) {
            pairs.push(pair);
        }
    }
    return pairs;
}

/** The duration a pair holds now, or `undefined` when one half is missing or out of range. */
export function readDurationPair(
    values: Readonly<Record<string, ParamsetValue | undefined>>,
    pair: DurationPair,
): DecodedDuration | undefined {
    return decodeDuration(values[pair.unitParam], values[pair.countParam], pair);
}

/** unit + count -> seconds, against the pair's own unit table. */
export function decodeDuration(
    unit: ParamsetValue | undefined,
    count: ParamsetValue | undefined,
    pair: DurationPair,
): DecodedDuration | undefined {
    const unitIndex = durationUnitIndex(unit, pair);
    const step = unitIndex === undefined ? undefined : pair.units[unitIndex];
    const countValue = typeof count === 'number' ? count : Number.NaN;
    if (
        unitIndex === undefined ||
        step === undefined ||
        !Number.isInteger(countValue) ||
        countValue < 0 ||
        countValue > pair.maxCount
    ) {
        return undefined;
    }
    return {
        seconds: round(step.seconds * countValue),
        unitIndex,
        unitSeconds: step.seconds,
        count: countValue,
        maximal: unitIndex === pair.units.length - 1 && countValue === pair.maxCount,
    };
}

/**
 * The unit index a stored value stands for: an index on BidCos, an enum name on HmIP - the same
 * two shapes {@link timeBaseIndex} handles, resolved against this pair's own list.
 */
export function durationUnitIndex(value: ParamsetValue | undefined, pair: DurationPair): number | undefined {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < pair.units.length) {
        return value;
    }
    if (typeof value === 'string') {
        const index = pair.units.findIndex((unit) => unit.name === value);
        return index === -1 ? undefined : index;
    }
    return undefined;
}

/**
 * seconds -> unit + count. The first unit that expresses the value exactly wins - the list runs
 * from the finest step upwards, so that is also the most precise one; when none is exact, the unit
 * that comes closest, and `exact` says which of the two happened so the dialog can warn that the
 * device will not do exactly what was typed.
 */
export function encodeDuration(
    seconds: number,
    pair: DurationPair,
): (DecodedDuration & {readonly exact: boolean}) | undefined {
    if (!Number.isFinite(seconds) || seconds < 0 || pair.units.length === 0) {
        return undefined;
    }
    let best: (DecodedDuration & {exact: boolean}) | undefined;
    let bestError = Number.POSITIVE_INFINITY;
    for (const [unitIndex, unit] of pair.units.entries()) {
        const count = Math.min(pair.maxCount, Math.max(0, Math.round(seconds / unit.seconds)));
        const value = round(unit.seconds * count);
        const error = Math.abs(value - seconds);
        if (error < bestError) {
            bestError = error;
            best = {
                seconds: value,
                unitIndex,
                unitSeconds: unit.seconds,
                count,
                maximal: unitIndex === pair.units.length - 1 && count === pair.maxCount,
                exact: error === 0,
            };
        }
    }
    return best;
}

/**
 * The two values to write for a duration. The unit is returned as its index; `castValue` turns it
 * into the enum name where the interface wants names (HmIP).
 */
export function writeDurationPair(seconds: number, pair: DurationPair): Record<string, number> | undefined {
    const encoded = encodeDuration(seconds, pair);
    if (!encoded) {
        return undefined;
    }
    return {[pair.unitParam]: encoded.unitIndex, [pair.countParam]: encoded.count};
}

/** The longest duration a pair can express. */
export function maxDurationSeconds(pair: DurationPair): number {
    const last = pair.units.at(-1);
    return last === undefined ? 0 : round(last.seconds * pair.maxCount);
}

function baseFactorPair(
    description: ParamsetDescription,
    param: string,
    parameter: ParameterDescription,
): DurationPair | undefined {
    if (!param.endsWith(BASE_SUFFIX_SHORT)) {
        return undefined;
    }
    const name = param.slice(0, -BASE_SUFFIX_SHORT.length);
    const countParam = `${name}${FACTOR_SUFFIX_SHORT}`;
    const factor = description[countParam];
    if (!factor) {
        return undefined;
    }
    // A base without a VALUE_LIST is the BidCos shape: the eight fixed steps addressed by index.
    const units = durationUnits(
        enumList(parameter) ?? TIME_BASE_NAMES,
        (entry) => TIME_BASES[TIME_BASE_NAMES.indexOf(entry)],
    );
    if (!units) {
        return undefined;
    }
    return {
        name: name.endsWith(TIME_INFIX) ? name.slice(0, -TIME_INFIX.length) : name,
        kind: 'base-factor',
        unitParam: param,
        countParam,
        units,
        // A factor without a MAX is 0..31, which is the whole range the encoding has.
        maxCount: numericBound(factor, 'MAX') ?? MAX_TIME_FACTOR,
    };
}

function unitValuePair(
    description: ParamsetDescription,
    param: string,
    parameter: ParameterDescription,
): DurationPair | undefined {
    if (!param.endsWith(UNIT_SUFFIX)) {
        return undefined;
    }
    const name = param.slice(0, -UNIT_SUFFIX.length);
    const countParam = `${name}${VALUE_SUFFIX}`;
    const count = description[countParam];
    const list = enumList(parameter);
    if (!count || !list || list.length === 0) {
        return undefined;
    }
    const maxCount = numericBound(count, 'MAX');
    // Only a list of pure duration tokens is a duration - CELSIUS|FAHRENHEIT is not.
    const units = durationUnits(list, (entry) => DURATION_UNIT_SECONDS[entry]);
    if (maxCount === undefined || !units) {
        return undefined;
    }
    return {name, kind: 'unit-value', unitParam: param, countParam, units, maxCount};
}

/** The unit steps of a `VALUE_LIST`, or `undefined` as soon as one entry is not a duration. */
function durationUnits(
    names: readonly string[],
    secondsOf: (name: string) => number | undefined,
): DurationUnit[] | undefined {
    const units: DurationUnit[] = [];
    for (const name of names) {
        const seconds = secondsOf(name);
        if (seconds === undefined) {
            return undefined;
        }
        units.push({name, seconds});
    }
    return units;
}
