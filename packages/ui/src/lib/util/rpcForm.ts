import type {RpcMethod, RpcMethodParameter, RpcValue} from '@homematic-manager/core';
import {rpcMethod, unknownRpcMethod} from '@homematic-manager/core';

/**
 * The RPC console's argument form, as data.
 *
 * 2.x had one free-text field for the whole parameter list and parsed it with `JSON.parse` on a
 * string the user had to get right by hand - which is why `putParamset` was effectively unusable
 * from the console (#27, #136). The catalogue in `packages/core/src/rpc/methods.ts` knows the type
 * of every argument, so the form is generated from it: a struct gets key/value rows with a type per
 * row, a bit field gets its flags, an argument with a fixed set of values gets a select.
 */

/** Which control an argument gets. */
export type ArgKind = 'text' | 'number' | 'bool' | 'select' | 'flags' | 'struct' | 'variant' | 'json';

/** One entry of a struct argument (a paramset). */
export interface StructEntry {
    key: string;
    type: 'string' | 'integer' | 'double' | 'bool';
    value: string;
}

/** One argument of the form. */
export interface ArgField {
    readonly name: string;
    readonly type: RpcMethodParameter['type'];
    readonly kind: ArgKind;
    /** For `select`: value -> label. For `flags`: bit -> label. */
    readonly options?: Readonly<Record<string, string>>;
    /** The interface processes that let this argument be left out. */
    readonly optional: readonly string[];
}

/** A value as the form holds it, before it becomes an `RpcValue`. */
export type ArgValue = string | number | boolean | StructEntry[] | {type: StructEntry['type']; value: string};

const ADDRESS_TYPES: readonly string[] = [
    'address',
    'device_address',
    'channel_address',
    'interface_address',
    'team_address',
];

export function argKind(parameter: RpcMethodParameter): ArgKind {
    if (parameter.values) {
        return 'select';
    }
    if (parameter.bitmask) {
        return 'flags';
    }
    switch (parameter.type) {
        case 'bool':
        case 'boolean':
            return 'bool';
        case 'integer':
            return 'number';
        case 'paramset':
            return 'struct';
        case 'RpcStruct[]':
            return 'json';
        case 'mixed':
        case 'variant':
            return 'variant';
        default:
            return 'text';
    }
}

/** Is this argument an address, so the form can offer the known ones? */
export function isAddressArgument(parameter: {type: string}): boolean {
    return ADDRESS_TYPES.includes(parameter.type);
}

/** The form of a method: one field per documented argument. */
export function argFields(methodName: string): ArgField[] {
    const method: RpcMethod = rpcMethod(methodName) ?? unknownRpcMethod(methodName);
    return method.params.map((parameter) => ({
        name: parameter.name,
        type: parameter.type,
        kind: argKind(parameter),
        optional: parameter.optional ?? [],
        ...(parameter.values ? {options: parameter.values} : {}),
        ...(parameter.bitmask ? {options: parameter.bitmask} : {}),
    }));
}

/** The empty value a field starts with. */
export function emptyValue(field: ArgField): ArgValue {
    switch (field.kind) {
        case 'bool':
            return false;
        case 'number':
        case 'flags':
            return 0;
        case 'struct':
            return [];
        case 'variant':
            return {type: 'string', value: ''};
        case 'select':
            return Object.keys(field.options ?? {})[0] ?? '';
        default:
            return '';
    }
}

/** One struct entry as the value it stands for. */
export function structValue(entry: StructEntry): RpcValue {
    switch (entry.type) {
        case 'bool':
            return entry.value === 'true' || entry.value === '1';
        case 'integer':
            return Number.parseInt(entry.value, 10) || 0;
        case 'double':
            return Number.parseFloat(entry.value) || 0;
        default:
            return entry.value;
    }
}

/** What one field sends. */
export function argValue(field: ArgField, value: ArgValue): RpcValue {
    switch (field.kind) {
        case 'bool':
            return value === true || value === 'true';
        case 'number':
        case 'flags':
            return typeof value === 'number' ? value : Number.parseInt(String(value), 10) || 0;
        case 'struct': {
            const struct: Record<string, RpcValue> = {};
            for (const entry of Array.isArray(value) ? value : []) {
                if (entry.key !== '') {
                    struct[entry.key] = structValue(entry);
                }
            }
            return struct;
        }
        case 'variant': {
            const variant = value as {type: StructEntry['type']; value: string};
            return structValue({key: '', type: variant.type, value: variant.value});
        }
        case 'json':
            return parseJson(String(value));
        case 'select':
            // The catalogue keys its `values` map by the value the CCU wants; a numeric key goes
            // out as a number, everything else as the string it is.
            return /^-?\d+$/.test(String(value)) ? Number(value) : String(value);
        default:
            return String(value);
    }
}

/** The whole parameter tuple of a call. */
export function buildParams(fields: readonly ArgField[], values: readonly ArgValue[]): RpcValue[] {
    return fields.map((field, index) => argValue(field, values[index] ?? emptyValue(field)));
}

/** `[]` for anything that is not valid JSON, so a half-typed struct never throws mid-keystroke. */
export function parseJson(text: string): RpcValue {
    if (text.trim() === '') {
        return [];
    }
    try {
        return JSON.parse(text) as RpcValue;
    } catch {
        return [];
    }
}

/** Is this text valid JSON? The console marks the box rather than refusing the keystroke. */
export function isValidJson(text: string): boolean {
    if (text.trim() === '') {
        return true;
    }
    try {
        JSON.parse(text);
        return true;
    } catch {
        return false;
    }
}
