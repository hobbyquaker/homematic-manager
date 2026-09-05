import type {
    MasterView,
    OptionPreset,
    Paramset,
    ParameterDescription,
    ParamsetDescription,
    ParamsetWrite,
    SkippedParameter,
    SpecialValue,
    ValidationProblem,
} from '@homematic-manager/core';
import {
    diffParamset,
    enumEncodingFor,
    enumList,
    isWritable,
    numericBound,
    parameterOrder,
    toDisplayValue,
    unitLabel,
} from '@homematic-manager/core';

/**
 * The pure part of the paramset editor: which control a parameter needs, and what a write would
 * actually send.
 *
 * 2.x built the dialog and the write payload in one pass over the DOM (`dialogParamset` /
 * `putParamset`, homematic-manager.js:1700-1900), rewrote `MIN`, `MAX` and `UNIT` inside the cached
 * description while doing so, and then sent every enabled input whether or not it had changed. Both
 * halves are separated here: this module decides what to draw and what to send, the component only
 * draws it, and the payload is core's changed-only diff.
 */

/** Which control a parameter gets. */
export type FieldKind = 'bool' | 'action' | 'enum' | 'integer' | 'float' | 'string' | 'unknown';

export function fieldKind(description: ParameterDescription): FieldKind {
    switch (description.TYPE) {
        case 'BOOL':
            return 'bool';
        case 'ACTION':
            return 'action';
        case 'ENUM':
            return 'enum';
        case 'INTEGER':
            return 'integer';
        case 'FLOAT':
            return 'float';
        case 'STRING':
            return 'string';
        default:
            return 'unknown';
    }
}

/** One row of the editor. */
export interface FormField {
    readonly name: string;
    readonly description: ParameterDescription;
    readonly kind: FieldKind;
    readonly writable: boolean;
    /** `%`, `°C`, `s`, ... - repaired and with the `100%` convention resolved. */
    readonly unit: string;
    /** `MIN`/`MAX` in display units, so a spin box can use them directly. */
    readonly min?: number;
    readonly max?: number;
    readonly step: number;
    readonly valueList?: readonly string[];
    /** Values outside `MIN..MAX` with a meaning of their own - `NOT_USED` and friends (#96). */
    readonly special: readonly SpecialValue[];
    /** False when a `conditionalVisibility` rule of the metadata hides it at the current values. */
    readonly visible: boolean;
    /** The dropdown of typical values from the metadata, where there is one. */
    readonly preset?: OptionPreset;
}

/**
 * The rows of a paramset, in display order. With a {@link MasterView} the order, the visibility
 * rules and the option presets of the metadata (task 9) are used; without one - VALUES, SERVICE,
 * or a channel type the data does not know - it is `TAB_ORDER` and then alphabetical, which is
 * what `parameterOrder` does and what the CCU's own dialog falls back to.
 */
export function formFields(description: ParamsetDescription, view?: MasterView): FormField[] {
    const names = view ? view.parameters.map((parameter) => parameter.name) : parameterOrder(description);
    const meta = new Map((view?.parameters ?? []).map((parameter) => [parameter.name, parameter]));

    return names
        .map((name) => {
            const parameter = description[name];
            if (!parameter) {
                return undefined;
            }
            const min = toDisplayValue(numericBound(parameter, 'MIN'), parameter);
            const max = toDisplayValue(numericBound(parameter, 'MAX'), parameter);
            const preset = meta.get(name)?.preset;
            const list = enumList(parameter);
            const field: FormField = {
                name,
                description: parameter,
                kind: fieldKind(parameter),
                writable: isWritable(parameter),
                unit: unitLabel(parameter),
                step: parameter.TYPE === 'FLOAT' ? 0.1 : 1,
                special: parameter.SPECIAL ?? [],
                visible: meta.get(name)?.visible ?? true,
                ...(min === undefined ? {} : {min}),
                ...(max === undefined ? {} : {max}),
                ...(list === undefined ? {} : {valueList: list}),
                ...(preset === undefined ? {} : {preset}),
            };
            return field;
        })
        .filter((field): field is FormField => field !== undefined);
}

/** One line of the preview: what a parameter holds now and what would be written. */
export interface PreviewEntry {
    readonly param: string;
    readonly from: string;
    readonly to: string;
}

/** What a write would do, per target channel. */
export interface WritePreview {
    /** The addresses the payload goes to - the edited channel plus every multi-apply target. */
    readonly targets: readonly string[];
    readonly entries: readonly PreviewEntry[];
    /** Exactly the `putParamset` payload; empty means "nothing to do, do not call at all". */
    readonly values: ParamsetWrite;
    readonly skipped: readonly SkippedParameter[];
    readonly problems: readonly ValidationProblem[];
}

export interface PreviewOptions {
    readonly interfaceName: string;
    readonly targets: readonly string[];
    readonly writeAll?: boolean;
}

/**
 * The changed-only payload, before anything is sent (task 6 item 4).
 *
 * This is core's `diffParamset`, so the preview and the write cannot disagree: what the dialog
 * shows here is literally what `paramset.put` will compute again in the backend.
 */
export function buildPreview(
    original: Paramset,
    edited: Readonly<Record<string, unknown>>,
    description: ParamsetDescription,
    options: PreviewOptions,
): WritePreview {
    const diff = diffParamset(original, edited, description, {
        enumAs: enumEncodingFor(options.interfaceName),
        ...(options.writeAll === true ? {writeAll: true} : {}),
    });
    return {
        targets: [...options.targets],
        entries: diff.changed.map((param) => ({
            param,
            from: displayValue(original[param], description[param]),
            to: displayValue(diff.values[param], description[param]),
        })),
        values: diff.values,
        skipped: diff.skipped,
        problems: diff.problems,
    };
}

/** How the preview prints a value: enum names rather than indexes, `explicitDouble` unwrapped. */
export function displayValue(value: unknown, description: ParameterDescription | undefined): string {
    if (value === undefined) {
        return '—';
    }
    const plain =
        typeof value === 'object' && value !== null && 'explicitDouble' in value
            ? (value as {explicitDouble: number}).explicitDouble
            : value;
    if (description?.TYPE === 'ENUM' && typeof plain === 'number') {
        return enumList(description)?.[plain] ?? String(plain);
    }
    if (typeof plain === 'boolean') {
        return plain ? 'true' : 'false';
    }
    return String(plain);
}
