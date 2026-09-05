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
import type {RpcWriteValue} from '../rpc/values.js';

/** How an interface wants `ENUM` values on the wire. */
export type EnumEncoding = 'index' | 'name';

/**
 * hmipserver rejects an `ENUM` sent as an index and wants the name from `VALUE_LIST`; rfd, hs485d,
 * the group process and CUxD want the index.
 *
 * ASSUMPTION (A-1, see packages/core/ASSUMPTIONS.md): this is what the 2.x code did
 * (homematic-manager.js:1782 - `daemon === 'HmIP' ? VALUE_LIST[i] : i`) and it has worked in
 * production for years, but it has never been verified against hmipserver's actual behaviour -
 * whether it also accepts the index is unknown. Task 6 checks it in the lab.
 */
export function enumEncodingFor(interfaceName: string): EnumEncoding {
    return interfaceName === 'HmIP-RF' ? 'name' : 'index';
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
    value: unknown,
    description?: ParameterDescription,
    options: CastOptions = {},
): RpcWriteValue {
    if (!description) {
        return typeof value === 'boolean' || typeof value === 'string' ? value : String(value);
    }

    switch (description.TYPE) {
        case 'ACTION':
        case 'BOOL':
            return castBool(value);
        case 'FLOAT': {
            const number = clamp(finite(Number.parseFloat(String(value))), description, options);
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
