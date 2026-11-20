/**
 * Casting a value against its paramset description.
 *
 * Ported from node-red-contrib-ccu `nodes/lib/cast.js` (MIT, Sebastian Raff and contributors),
 * which itself unified two divergent copies inside that project. Kept here as one implementation
 * for `setValue`, `putParamset` and link paramsets - 2.x had three copies that disagreed
 * (homematic-manager.js:1985-2020, :2058-2110, :2960-3005).
 *
 * Changes against the original:
 *
 *  - never `NaN` and never `Infinity`: `parseFloat('') || 0` catches NaN but `parseFloat('1e999')`
 *    is Infinity, which no XML-RPC encoder can represent either.
 *  - `enumAs`, because the interfaces disagree about enums: hmipserver wants the enum *name*,
 *    rfd and hs485d want the index. 2.x decided that per rendered `<option>` and then let
 *    `isNaN()` pick at write time. Here it is one option, chosen from the interface table.
 *  - the `{explicitDouble}` wrapper can be switched off, so the same function serves the
 *    comparison in the paramset diff and the payload that goes on the wire.
 *
 * Casting never validates: it produces the closest representable value, and `validate.ts` decides
 * whether that value may be written. Both run before every write (task 6).
 */

import {enumIndex, enumList, type ParameterDescription} from './description.js';
import {isExplicitDouble, type RpcWriteValue} from '../rpc/values.js';

/** How an interface wants `ENUM` values on the wire. */
export type EnumEncoding = 'index' | 'name';

/**
 * Every interface gets the **index**.
 *
 * A-1 said hmipserver wants the name from `VALUE_LIST` and everything else the index, because that
 * is what 2.x did (`homematic-manager.js:1782`: `daemon === 'HmIP' ? VALUE_LIST[i] : i`). The lab
 * measured it on 2026-09-05 (task 6, `docs/config-pending.md`) and **both interface processes take
 * both forms**: hmipserver stores `"100MS"` and `0` identically, rfd converts a name to its index.
 * The split was never necessary - and sending the name is actively worse, because `getParamset`
 * answers with the index on both, so a changed-only diff would see every `ENUM` as changed on every
 * write and send parameters the user never touched.
 *
 * What is dangerous is a value that is in neither form: an unknown name or an index outside the
 * `VALUE_LIST` is a fault plus a sticky `CONFIG_PENDING` on hmipserver, and is silently ignored by
 * rfd. `validate.ts` catches both.
 *
 * `ENUM_NAME_INTERFACES` is empty and is meant to stay empty; it exists so that an interface that
 * one day turns out to insist on the name has one place to be named, instead of the split coming
 * back as a condition somewhere in the write path.
 */
const ENUM_NAME_INTERFACES: ReadonlySet<string> = new Set<string>();

export function enumEncodingFor(interfaceName: string): EnumEncoding {
    return ENUM_NAME_INTERFACES.has(interfaceName) ? 'name' : 'index';
}

export interface CastOptions {
    /** Limit numbers to `MIN`/`MAX`. Off by default - clamping hides a wrong value. */
    readonly clamp?: boolean;
    /** How to encode `ENUM`; default `index`. See {@link enumEncodingFor}. */
    readonly enumAs?: EnumEncoding;
    /** Wrap `FLOAT` in `{explicitDouble}`; default true. */
    readonly explicitDouble?: boolean;
}

/**
 * Casts a value according to its paramset description.
 *
 * Without a description numbers become strings and everything else passes through, which is what
 * the original does for datapoints whose description has not been fetched.
 */
export function castValue(
    input: unknown,
    description?: ParameterDescription,
    options: CastOptions = {},
): RpcWriteValue {
    // Casting is idempotent: an already cast `FLOAT` arrives as `{explicitDouble: n}`, and without
    // this line the second cast would `String()` the wrapper, `parseFloat('[object Object]')` is
    // `NaN` and `NaN` becomes `0`. That is the task 19 `setValue` bug: the paramset dialog cast the
    // value before sending it and the backend cast what arrived, so every float was written as
    // zero. The dialog no longer pre-casts, and a double cast can no longer destroy a value.
    const value = isExplicitDouble(input) ? input.explicitDouble : input;
    if (!description) {
        return typeof value === 'boolean' || typeof value === 'string' ? value : String(value);
    }

    switch (description.TYPE) {
        case 'ACTION':
        case 'BOOL':
            return castBool(value);
        case 'FLOAT': {
            const number = roundFloat(
                clamp(finite(Number.parseFloat(String(value))), description, options),
                description,
            );
            return options.explicitDouble === false ? number : {explicitDouble: number};
        }
        case 'ENUM':
            return castEnum(value, description, options);
        case 'INTEGER':
            return castInteger(value, description, options);
        case 'STRING':
            return String(value);
        default:
            // A type no interface documents. 2.x rendered it as a text input and sent a string;
            // anything else risks putting an object on the wire.
            return String(value);
    }
}

/** `'false'`, `'0'`, `0` and `''` are false; everything else that is present is true. */
function castBool(value: unknown): boolean {
    if (value === 'false') {
        return false;
    }
    if (typeof value === 'string') {
        const number = Number(value);
        // a string that is not a number ('true', 'on', anything) counts as present
        return Number.isNaN(number) ? true : number !== 0;
    }
    return Boolean(value);
}

function castEnum(value: unknown, description: ParameterDescription, options: CastOptions): RpcWriteValue {
    const list = enumList(description);
    if (!list) {
        // an ENUM without a VALUE_LIST: nothing to map against, treat it as the integer it is
        return castInteger(value, description, options);
    }
    if (typeof value === 'string') {
        const byName = enumIndex(description, value);
        if (byName !== undefined) {
            return options.enumAs === 'name' ? value : byName;
        }
    }
    const index = numericIndex(value);
    if (index === undefined) {
        // a string that is neither a name from VALUE_LIST nor a number. The original turns this
        // into 0 with `parseInt(value) || 0`, i.e. silently into the first enum value - a wrong
        // write that nothing downstream can catch. Hand it on unchanged instead and let validate
        // reject it.
        return String(value);
    }
    return options.enumAs === 'name' ? (list[index] ?? String(value)) : clamp(index, description, options);
}

/** The index a value stands for, or `undefined` when it is not a number at all. */
function numericIndex(value: unknown): number | undefined {
    if (typeof value === 'boolean') {
        return Number(value);
    }
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function castInteger(value: unknown, description: ParameterDescription, options: CastOptions): number {
    if (typeof value === 'boolean') {
        return Number(value);
    }
    return clamp(toInteger(value), description, options);
}

function toInteger(value: unknown): number {
    return finite(Number.parseInt(String(value), 10));
}

/**
 * The decimals the interface processes print a double with: rfd's XML-RPC answers `0.500000`, and
 * binrpc decodes every double with `toFixed(6)`. Anything finer is float residue, never a value a
 * device holds.
 */
export const FLOAT_WIRE_DECIMALS = 6;

/**
 * The decimals a number is written with, residue removed first: `0.1` has one, `1.005` three,
 * `30` none, and `0.30000000000000004` one, because twelve significant digits are all the
 * comparison trusts (the WebUI's `toPrecision(12)` guard, OpenCCU-Base 3412ada).
 */
export function decimalsOf(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    const text = String(Number.parseFloat(value.toPrecision(12)));
    const exponent = /e([+-]\d+)$/.exec(text);
    const mantissa = exponent ? text.slice(0, exponent.index) : text;
    const point = mantissa.indexOf('.');
    const fraction = point === -1 ? 0 : mantissa.length - point - 1;
    return Math.max(0, fraction - (exponent ? Number(exponent[1]) : 0));
}

/**
 * The decimals of a parameter's range: the most that `MIN` or `MAX` carry, 0 when neither is a
 * number. This is what the CCU's WebUI rounds a FLOAT to (`ProofAndSetValue`, OpenCCU-Base
 * 3412ada) and what the editor derives its step from.
 */
export function rangeDecimals(description: ParameterDescription): number {
    const bounds = [description.MIN, description.MAX].filter((bound): bound is number => typeof bound === 'number');
    return bounds.reduce((most, bound) => Math.max(most, decimalsOf(bound)), 0);
}

/**
 * The decimals a FLOAT is rounded to before it is compared or written: those of its range, but
 * never fewer than {@link FLOAT_WIRE_DECIMALS}.
 *
 * The WebUI rounds to the range alone, and it can, because Tcl sees the bounds as the text the
 * interface sent (`30.000000`). Here they arrive as numbers, and a bound of `30.0` is `30`: most
 * FLOATs of the hm-simulator corpus have integer bounds while they hold halves (temperatures
 * 5..30), twentieths (levels 0..1) or tenths (times 0..111600). Rounding those to the range would
 * turn 21.5 °C into 22, so the range only ever adds decimals.
 */
export function floatDecimals(description: ParameterDescription): number {
    return Math.max(FLOAT_WIRE_DECIMALS, rangeDecimals(description));
}

/**
 * A FLOAT rounded to {@link floatDecimals}: `0.1 + 0.2` is `0.3` again, and `1.0049999999999999`
 * is `1.005`. The scaled number goes through `toPrecision(15)` first, so a product that lands a
 * bit below a half (`1.005 * 1000` is `1004.9999999999999`) still rounds the way it was written;
 * fifteen digits rather than the WebUI's twelve, because a Wired time of 16383000 s scaled by
 * 10**6 already has fourteen.
 */
export function roundFloat(value: number, description: ParameterDescription): number {
    if (!Number.isFinite(value)) {
        return value;
    }
    const factor = 10 ** floatDecimals(description);
    const rounded = Math.round(Number.parseFloat((value * factor).toPrecision(15))) / factor;
    // `-0` is a number no interface wants to see and `Object.is` tells it from 0
    return rounded === 0 ? 0 : rounded;
}

/** No `NaN` and no `Infinity` ever leaves this module: both are unencodable in XML-RPC. */
function finite(value: number): number {
    return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, description: ParameterDescription, options: CastOptions): number {
    if (options.clamp !== true) {
        return value;
    }
    const min = typeof description.MIN === 'number' ? description.MIN : undefined;
    const max = typeof description.MAX === 'number' ? description.MAX : undefined;
    if (min !== undefined && value < min) {
        return min;
    }
    if (max !== undefined && value > max) {
        return max;
    }
    return value;
}
