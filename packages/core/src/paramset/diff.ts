/**
 * What a `putParamset` actually sends.
 *
 * The fix for issue #98 starts here. 2.x collected every enabled input of the dialog and sent all
 * of them, always - the "skip unchanged" branch has been commented out since commit 660711f
 * (2019-02-22, "always set all params of paramset"). A `MASTER` write with 40 parameters where the
 * user changed one is 40 chances for a device or hmipserver to disagree, and a disagreement is a
 * `CONFIG_PENDING` that does not clear.
 *
 * Here the default is the opposite: only parameters whose value actually changed, each cast and
 * validated, and never a parameter that is unknown, read-only or out of range. `writeAll` is the
 * explicit opt-out the dialog offers (roadmap task 6.1).
 */

import {castValue, type EnumEncoding} from './cast.js';
import {isWritable, type ParameterDescription, type ParamsetDescription} from './description.js';
import {validateValue, type ValidationProblem} from './validate.js';
import {sameValue, type Paramset, type ParamsetWrite, type RpcWriteValue} from '../rpc/values.js';

export interface DiffOptions {
    /** Send every writable parameter instead of only the changed ones. Off by default. */
    readonly writeAll?: boolean;
    /** How to encode `ENUM`; see `enumEncodingFor(interfaceName)`. */
    readonly enumAs?: EnumEncoding;
    /** Passed to the validation. */
    readonly maxStringLength?: number;
}

/** Why a parameter is not in the payload. */
export type SkipReason =
    /** Its value is unchanged - the normal case, and the point of the whole module. */
    | 'unchanged'
    /** `OPERATIONS & 2` is not set. */
    | 'not-writable'
    /** The description does not have it. */
    | 'unknown-parameter'
    /** It failed validation; the reason is in `problems`. */
    | 'invalid';

export interface SkippedParameter {
    readonly param: string;
    readonly reason: SkipReason;
}

export interface ParamsetDiff {
    /** Exactly what goes into the `putParamset` call. Empty means: do not call at all. */
    readonly values: ParamsetWrite;
    /** The parameters in `values`, in the order they were considered. */
    readonly changed: readonly string[];
    readonly skipped: readonly SkippedParameter[];
    /** Everything wrong with the input; a parameter with a problem is never in `values`. */
    readonly problems: readonly ValidationProblem[];
}

/**
 * Compares the values read from the device with the values the user edited and returns the exact
 * `putParamset` payload.
 *
 * @param original what `getParamset` returned. A parameter missing here counts as changed - we
 *                 cannot know that it already has the value in question.
 * @param edited   the values from the dialog; raw, they are cast here.
 */
export function diffParamset(
    original: Paramset,
    edited: Readonly<Record<string, unknown>>,
    description: ParamsetDescription,
    options: DiffOptions = {},
): ParamsetDiff {
    const values: ParamsetWrite = {};
    const changed: string[] = [];
    const skipped: SkippedParameter[] = [];
    const problems: ValidationProblem[] = [];

    const writeAll = options.writeAll === true;
    const castOptions = options.enumAs === undefined ? {} : {enumAs: options.enumAs};
    const validateOptions = options.maxStringLength === undefined ? {} : {maxStringLength: options.maxStringLength};

    for (const param of candidates(edited, description, writeAll)) {
        const parameter = description[param];
        if (!parameter) {
            problems.push(...validateValue(param, edited[param] as RpcWriteValue, undefined));
            skipped.push({param, reason: 'unknown-parameter'});
            continue;
        }

        const wasEdited = Object.prototype.hasOwnProperty.call(edited, param);
        if (!isWritable(parameter)) {
            // only complain when the caller asked for this parameter; writeAll picks up read-only
            // parameters by itself and silently dropping those is the right thing
            if (wasEdited) {
                problems.push(...validateValue(param, edited[param] as RpcWriteValue, parameter));
            }
            skipped.push({param, reason: 'not-writable'});
            continue;
        }

        const raw = wasEdited ? edited[param] : (original[param] ?? parameter.DEFAULT);
        const value = castValue(raw, parameter, castOptions);

        if (!writeAll && isUnchanged(original, param, raw, parameter, castOptions)) {
            skipped.push({param, reason: 'unchanged'});
            continue;
        }

        const found = validateValue(param, value, parameter, validateOptions);
        if (found.length > 0) {
            problems.push(...found);
            skipped.push({param, reason: 'invalid'});
            continue;
        }

        values[param] = value;
        changed.push(param);
    }

    return {values, changed, skipped, problems};
}

/**
 * Which parameters to look at: everything the description has when writing all, otherwise only
 * what the dialog edited. Unknown parameters are kept in the list so that they are reported
 * rather than silently dropped.
 */
function candidates(
    edited: Readonly<Record<string, unknown>>,
    description: ParamsetDescription,
    writeAll: boolean,
): string[] {
    if (!writeAll) {
        return Object.keys(edited);
    }
    const names = Object.keys(description);
    for (const param of Object.keys(edited)) {
        if (!(param in description)) {
            names.push(param);
        }
    }
    return names;
}

function isUnchanged(
    original: Paramset,
    param: string,
    raw: unknown,
    parameter: ParameterDescription,
    castOptions: {enumAs?: EnumEncoding},
): boolean {
    if (!Object.prototype.hasOwnProperty.call(original, param)) {
        // never read from the device: we cannot know it already holds this value
        return false;
    }
    // compare like against like: both raw values through the same cast, no explicitDouble wrapper
    const plain = {...castOptions, explicitDouble: false};
    return sameValue(castValue(original[param], parameter, plain), castValue(raw, parameter, plain));
}
