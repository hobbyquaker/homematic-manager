/**
 * Validating a value against its paramset description.
 *
 * Returns problems, never throws: a paramset dialog wants to show everything that is wrong at
 * once, and the write path wants to drop exactly the offending parameters rather than the whole
 * call. Nothing that fails here is ever sent (task 6, analysis 4.3).
 *
 * 2.x checked nothing beyond the HTML `min`/`max` attributes on number inputs, and `FLOAT` and
 * `STRING` were free-text fields - the "unknown or out-of-range parameter" scenario of issue #98.
 */

import {
    enumList,
    isSpecialValue,
    isWritable,
    numericBound,
    type ParameterDescription,
    type ParamsetDescription,
} from './description.js';
import {isExplicitDouble, type RpcWriteValue} from '../rpc/values.js';

export type ValidationCode =
    /** No such parameter in the description - the one thing hmipserver reacts to worst. */
    | 'unknown-parameter'
    /** `OPERATIONS & 2` is not set. */
    | 'not-writable'
    /** The value has a type the parameter cannot hold. */
    | 'wrong-type'
    /** `NaN` or `Infinity`; XML-RPC cannot encode either. */
    | 'not-finite'
    | 'below-min'
    | 'above-max'
    /** Not a member of `VALUE_LIST`. */
    | 'not-in-value-list'
    | 'string-too-long';

export interface ValidationProblem {
    readonly param: string;
    readonly code: ValidationCode;
    /** English, for logs and tests; the UI renders the code through i18n. */
    readonly message: string;
    /** The bound or list the value missed, where there is one. */
    readonly limit?: number | string;
}

export interface ValidateOptions {
    /** Reject parameters without the write bit; on by default. */
    readonly requireWritable?: boolean;
    /**
     * Longest accepted `STRING`. The descriptions carry no length, and the CCU's own name fields
     * stop at 255 characters, so that is the default (A-2 in ASSUMPTIONS.md).
     */
    readonly maxStringLength?: number;
}

/** The default length limit for `STRING` parameters. */
export const DEFAULT_MAX_STRING_LENGTH = 255;

/** Validates one value. An empty result means it may be written. */
export function validateValue(
    param: string,
    value: RpcWriteValue,
    description: ParameterDescription | undefined,
    options: ValidateOptions = {},
): ValidationProblem[] {
    if (!description) {
        return [problem(param, 'unknown-parameter', `${param} is not part of this paramset`)];
    }
    if (options.requireWritable !== false && !isWritable(description)) {
        return [problem(param, 'not-writable', `${param} is read-only (OPERATIONS ${description.OPERATIONS})`)];
    }
    const plain = isExplicitDouble(value) ? value.explicitDouble : value;

    switch (description.TYPE) {
        case 'BOOL':
        case 'ACTION':
            return typeof plain === 'boolean'
                ? []
                : [problem(param, 'wrong-type', `${param} expects a boolean, got ${typeName(plain)}`)];
        case 'INTEGER':
            return validateNumber(param, plain, description, true);
        case 'FLOAT':
            return validateNumber(param, plain, description, false);
        case 'ENUM':
            return validateEnum(param, plain, description);
        case 'STRING':
            return validateString(param, plain, options);
        default:
            // an undocumented type: accept any scalar, reject structures
            return typeof plain === 'object'
                ? [problem(param, 'wrong-type', `${param} expects a scalar, got ${typeName(plain)}`)]
                : [];
    }
}

/**
 * Validates a whole set of values. Parameters missing from `values` are not checked - a partial
 * write is the normal case.
 */
export function validateParamset(
    values: Readonly<Record<string, RpcWriteValue>>,
    description: ParamsetDescription,
    options: ValidateOptions = {},
): ValidationProblem[] {
    const problems: ValidationProblem[] = [];
    for (const [param, value] of Object.entries(values)) {
        problems.push(...validateValue(param, value, description[param], options));
    }
    return problems;
}

function validateNumber(
    param: string,
    value: RpcWriteValue,
    description: ParameterDescription,
    integer: boolean,
): ValidationProblem[] {
    if (typeof value !== 'number') {
        return [problem(param, 'wrong-type', `${param} expects a number, got ${typeName(value)}`)];
    }
    if (!Number.isFinite(value)) {
        return [problem(param, 'not-finite', `${param} is ${value}, which XML-RPC cannot encode`)];
    }
    if (integer && !Number.isInteger(value)) {
        return [problem(param, 'wrong-type', `${param} expects a whole number, got ${value}`)];
    }
    // a SPECIAL value (NOT_USED and friends) is deliberately outside MIN..MAX
    if (isSpecialValue(description, value)) {
        return [];
    }
    return checkBounds(param, value, description);
}

function validateEnum(param: string, value: RpcWriteValue, description: ParameterDescription): ValidationProblem[] {
    const list = enumList(description);
    if (typeof value === 'string') {
        if (!list) {
            return [problem(param, 'not-in-value-list', `${param} has no VALUE_LIST to resolve ${value} against`)];
        }
        return list.includes(value)
            ? []
            : [problem(param, 'not-in-value-list', `${param} does not accept ${value}`, list.join(', '))];
    }
    if (typeof value !== 'number' || !Number.isInteger(value)) {
        return [problem(param, 'wrong-type', `${param} expects an enum name or index, got ${typeName(value)}`)];
    }
    if (list && (value < 0 || value >= list.length)) {
        return [problem(param, 'not-in-value-list', `${param} has no value at index ${value}`, list.length - 1)];
    }
    return checkBounds(param, value, description);
}

function validateString(param: string, value: RpcWriteValue, options: ValidateOptions): ValidationProblem[] {
    if (typeof value !== 'string') {
        return [problem(param, 'wrong-type', `${param} expects a string, got ${typeName(value)}`)];
    }
    const max = options.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH;
    return value.length > max
        ? [problem(param, 'string-too-long', `${param} is longer than ${max} characters`, max)]
        : [];
}

function checkBounds(param: string, value: number, description: ParameterDescription): ValidationProblem[] {
    const min = numericBound(description, 'MIN');
    const max = numericBound(description, 'MAX');
    if (min !== undefined && value < min) {
        return [problem(param, 'below-min', `${param} is below its minimum of ${min}`, min)];
    }
    if (max !== undefined && value > max) {
        return [problem(param, 'above-max', `${param} is above its maximum of ${max}`, max)];
    }
    return [];
}

function problem(param: string, code: ValidationCode, message: string, limit?: number | string): ValidationProblem {
    return limit === undefined ? {param, code, message} : {param, code, message, limit};
}

function typeName(value: unknown): string {
    return value === null ? 'null' : typeof value;
}
