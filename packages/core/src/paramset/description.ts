/**
 * The paramset description model: `getParamsetDescription` as the interface processes deliver it.
 *
 * Nothing here mutates a description. The 2.x renderer rewrote `MIN`, `MAX` and `UNIT` in place
 * while building the dialog and then cached the rewritten object, so a cached description no
 * longer matched what the device had sent - the accessors below replace that.
 */

import type {ParamsetValue} from '../rpc/values.js';

/** The parameter types the CCU uses. Anything else is treated as a string. */
export const PARAMETER_TYPES = ['BOOL', 'ACTION', 'INTEGER', 'FLOAT', 'ENUM', 'STRING'] as const;

export type ParameterType = (typeof PARAMETER_TYPES)[number];

/** `OPERATIONS` bits. `WRITE` is the one the write path checks before sending anything. */
export const OPERATIONS = {
    READ: 1,
    WRITE: 2,
    EVENT: 4,
} as const;

/** `FLAGS` bits of a parameter description. */
export const PARAMETER_FLAGS = {
    VISIBLE: 1,
    INTERNAL: 2,
    TRANSFORM: 4,
    SERVICE: 8,
    STICKY: 16,
} as const;

/**
 * A value outside `MIN`..`MAX` with a meaning of its own, e.g.
 * `{ID: 'NOT_USED', VALUE: 111600}` on a BidCos-RF `LONG_OFF_TIME` whose `MAX` is 108000.
 * A special value must pass validation even though it is out of range.
 */
export interface SpecialValue {
    readonly ID: string;
    readonly VALUE: number;
}

/** One parameter of a paramset description. */
export interface ParameterDescription {
    readonly TYPE: string;
    /** Bit field, see {@link OPERATIONS}. */
    readonly OPERATIONS: number;
    /** Bit field, see {@link PARAMETER_FLAGS}. */
    readonly FLAGS?: number;
    readonly DEFAULT?: ParamsetValue;
    /** Number, or an enum name on HmIP. */
    readonly MIN?: ParamsetValue;
    /** Number, or an enum name on HmIP. */
    readonly MAX?: ParamsetValue;
    readonly UNIT?: string;
    readonly TAB_ORDER?: number;
    /** WebUI hint such as `SWITCH.STATE`, `NONE` or `BUTTON.SHORT`. */
    readonly CONTROL?: string;
    /** The parameter's own name; the CCU repeats it here. */
    readonly ID?: string;
    /** Enum names, in index order. The CCU sends them as `VALUE_LIST`, never as `ENUM`. */
    readonly VALUE_LIST?: readonly string[];
    readonly SPECIAL?: readonly SpecialValue[];
}

/** A whole paramset description: parameter name -> description. */
export type ParamsetDescription = Readonly<Record<string, ParameterDescription>>;

/** The paramsets a channel can have. */
export const PARAMSET_NAMES = ['MASTER', 'VALUES', 'LINK', 'SERVICE'] as const;

export type ParamsetName = (typeof PARAMSET_NAMES)[number];

/** Is this one of the six types the CCU documents? */
export function isKnownParameterType(type: string): type is ParameterType {
    return (PARAMETER_TYPES as readonly string[]).includes(type);
}

export function isReadable(description: ParameterDescription): boolean {
    return (description.OPERATIONS & OPERATIONS.READ) !== 0;
}

/**
 * The check the write path lives by: only parameters with the WRITE bit are ever sent.
 * node-red-contrib-ccu shipped `!(OPERATIONS) && 2` for years, which is always false - hence the
 * explicit, tested helper.
 */
export function isWritable(description: ParameterDescription): boolean {
    return (description.OPERATIONS & OPERATIONS.WRITE) !== 0;
}

export function isEvent(description: ParameterDescription): boolean {
    return (description.OPERATIONS & OPERATIONS.EVENT) !== 0;
}

/** Decoded parameter `FLAGS`. */
export interface DecodedParameterFlags {
    readonly visible: boolean;
    readonly internal: boolean;
    readonly transform: boolean;
    readonly service: boolean;
    readonly sticky: boolean;
}

export function decodeParameterFlags(flags: number | undefined): DecodedParameterFlags {
    const bits = typeof flags === 'number' ? flags : 0;
    return {
        visible: (bits & PARAMETER_FLAGS.VISIBLE) !== 0,
        internal: (bits & PARAMETER_FLAGS.INTERNAL) !== 0,
        transform: (bits & PARAMETER_FLAGS.TRANSFORM) !== 0,
        service: (bits & PARAMETER_FLAGS.SERVICE) !== 0,
        sticky: (bits & PARAMETER_FLAGS.STICKY) !== 0,
    };
}

/**
 * The enum names of a parameter. The CCU sends them in `VALUE_LIST`; `ENUM` is accepted as a
 * fallback for hand-written data only (no interface process ever sends it).
 */
export function enumList(description: ParameterDescription | undefined): readonly string[] | undefined {
    if (!description) {
        return undefined;
    }
    const list = description.VALUE_LIST;
    return Array.isArray(list) ? list : undefined;
}

/** The index of an enum name, or `undefined` when the name is not in the list. */
export function enumIndex(description: ParameterDescription, name: string): number | undefined {
    const index = enumList(description)?.indexOf(name) ?? -1;
    return index === -1 ? undefined : index;
}

/** The enum name at an index, or `undefined` when the index is out of range. */
export function enumName(description: ParameterDescription, index: number): string | undefined {
    return enumList(description)?.[index];
}

/**
 * `MIN`/`MAX` as numbers. For an HmIP `ENUM` the CCU sends the bounds as enum *names*
 * (`{MIN: '100MS', MAX: 'H'}`), so they are resolved through `VALUE_LIST` here instead of being
 * written back into the description as 2.x did.
 */
export function numericBound(description: ParameterDescription, bound: 'MIN' | 'MAX'): number | undefined {
    const value = description[bound];
    if (typeof value === 'number') {
        return value;
    }
    if (typeof value === 'string' && description.TYPE === 'ENUM') {
        return enumIndex(description, value);
    }
    return undefined;
}

/** The `SPECIAL` entry a value stands for, e.g. `NOT_USED`; `undefined` for an ordinary value. */
export function specialValue(description: ParameterDescription, value: unknown): SpecialValue | undefined {
    if (typeof value !== 'number' || !description.SPECIAL) {
        return undefined;
    }
    return description.SPECIAL.find((special) => special.VALUE === value);
}

/** Is this value one of the parameter's `SPECIAL` values, and therefore exempt from MIN/MAX? */
export function isSpecialValue(description: ParameterDescription, value: unknown): boolean {
    return specialValue(description, value) !== undefined;
}

/**
 * Parameter names in display order: by `TAB_ORDER`, then alphabetically. A parameter without a
 * `TAB_ORDER` sorts after the ones that have one.
 */
export function parameterOrder(description: ParamsetDescription): string[] {
    return Object.keys(description).sort((a, b) => {
        const left = description[a]?.TAB_ORDER ?? Number.MAX_SAFE_INTEGER;
        const right = description[b]?.TAB_ORDER ?? Number.MAX_SAFE_INTEGER;
        if (left !== right) {
            return left - right;
        }
        // object keys are unique, so there is no "equal" case to handle here
        return a < b ? -1 : 1;
    });
}
