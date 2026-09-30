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
    isServiceMessageDatapoint,
    isWritable,
    numericBound,
    parameterOrder,
    toDisplayValue,
    unitLabel,
} from '@homematic-manager/core';

import {suppressCallText} from '../stores/suppression.js';

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
    /** B-87: which end of a link the parameter belongs to; absent for a channel's own paramset. */
    readonly side?: LinkSide;
}

/** The two ends of a direct link, each with its own LINK paramset. */
export type LinkSide = 'sender' | 'receiver';

/** What a write would do, per target channel. */
export interface WritePreview {
    /** The addresses the payload goes to - the edited channel plus every multi-apply target. */
    readonly targets: readonly string[];
    readonly entries: readonly PreviewEntry[];
    /** Exactly the `putParamset` payload; empty means "nothing to do, do not call at all". */
    readonly values: ParamsetWrite;
    readonly skipped: readonly SkippedParameter[];
    readonly problems: readonly ValidationProblem[];
    /**
     * The exact calls, one line each, where the write is not a `putParamset` at all - task 26's
     * `suppressServiceMessages`. Absent for a paramset write, whose one call the preview prints
     * itself from `targets` and `values`.
     */
    readonly calls?: readonly string[];
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

/** The write of one direct link, sender to receiver - what `paramset.putLink` gets per link. */
export interface LinkPair {
    readonly sender: string;
    readonly receiver: string;
}

/**
 * B-87: one preview for both ends of a link. The receiver's LINK paramset is written on the receiver
 * with the sender as peer, the sender's on the sender with the receiver as peer - `putLink`'s two
 * directions. The preview carries one `putParamset` line per link and end that has something to
 * write, and the table both ends' parameters, each marked with its end. `values` stays the
 * receiver's payload; the sender's is `senderValues`.
 */
export function linkWritePreview(
    receiver: WritePreview,
    sender: WritePreview | undefined,
    pairs: readonly LinkPair[],
): WritePreview & {readonly senderValues: ParamsetWrite} {
    const call = (owner: string, peer: string, values: ParamsetWrite) =>
        `putParamset(${owner}←${peer}, LINK, ${JSON.stringify(values)})`;
    const senderValues = sender?.values ?? {};
    const receiverWrites = Object.keys(receiver.values).length > 0;
    const senderWrites = Object.keys(senderValues).length > 0;
    return {
        targets: pairs.map((pair) => `${pair.receiver}←${pair.sender}`),
        entries: [
            ...receiver.entries.map((entry) => ({...entry, side: 'receiver' as const})),
            ...(sender?.entries ?? []).map((entry) => ({...entry, side: 'sender' as const})),
        ],
        values: receiver.values,
        senderValues,
        skipped: [...receiver.skipped, ...(sender?.skipped ?? [])],
        problems: [...receiver.problems, ...(sender?.problems ?? [])],
        calls: [
            ...(receiverWrites ? pairs.map((pair) => call(pair.receiver, pair.sender, receiver.values)) : []),
            ...(senderWrites ? pairs.map((pair) => call(pair.sender, pair.receiver, senderValues)) : []),
        ],
    };
}

/**
 * The `paramset.putLink` payload of a link preview: only the directions that have something to
 * write, so a sender-only change does not also send the receiver an empty set.
 */
export function linkWriteValues(preview: WritePreview & {readonly senderValues?: ParamsetWrite}): {
    receiverToSender?: ParamsetWrite;
    senderToReceiver?: ParamsetWrite;
} {
    const senderValues = preview.senderValues ?? {};
    return {
        ...(Object.keys(preview.values).length > 0 ? {receiverToSender: preview.values} : {}),
        ...(Object.keys(senderValues).length > 0 ? {senderToReceiver: senderValues} : {}),
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
    // `ParamsetValue` is a scalar in practice; the type also admits the struct an interface process
    // may answer with, and "[object Object]" is the honest rendering of one in a single-line field.
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- deliberate, see above
    return String(plain);
}

/** One line of the read-back: what was sent, and what the interface process really stored. */
export interface ReadBackEntry {
    readonly param: string;
    readonly sent: string;
    readonly stored: string;
    /** The two differ - on BidCos the usual reason is a silent clamp or a dropped value. */
    readonly differs: boolean;
    /** B-87: which end of a link the parameter was written to. */
    readonly side?: LinkSide;
}

/**
 * What a write really did, by comparing the payload with a fresh `getParamset`.
 *
 * Task 6 measured that rfd answers `ok` to writes it silently drops, coerces or clamps: an unknown
 * parameter is dropped, a string in an `INTEGER` becomes `MIN`, a value above `MAX` becomes `MAX`,
 * a `FLOAT` sent as an int is ignored. `ok` therefore means nothing on BidCos, and the only
 * feedback the interface gives is the value it holds afterwards.
 */
export function readBack(sent: ParamsetWrite, stored: Paramset, description: ParamsetDescription): ReadBackEntry[] {
    return Object.keys(sent).map((param) => {
        const sentText = displayValue(sent[param], description[param]);
        const storedText = displayValue(stored[param], description[param]);
        return {param, sent: sentText, stored: storedText, differs: sentText !== storedText};
    });
}

/**
 * Task 26 (openccu-lite 28.9): the parameters of a `VALUES` description whose messages the HmIP
 * server can suppress - the service datapoints of the maintenance channel, in the dialog's order.
 * `DUTY_CYCLE` counts only where it is a boolean: on HmIP the same name is also the integer
 * percentage of the transmitter's duty cycle, which is a measurement and not a message (core's
 * `countsAsServiceMessage`).
 */
export function serviceMessageParameters(description: ParamsetDescription): string[] {
    return parameterOrder(description).filter((name) => {
        if (!isServiceMessageDatapoint(name)) {
            return false;
        }
        return name !== 'DUTY_CYCLE' || description[name]?.TYPE === 'BOOL';
    });
}

export interface SuppressPreviewOptions {
    readonly address: string;
    /** What the interface reports now (`getSuppressedServiceMessages`). */
    readonly suppressed: readonly string[];
    /** The checkboxes as the user left them, by parameter; absent = untouched. */
    readonly edits: Readonly<Record<string, boolean>>;
    /** How the two states read in the table - the dialog passes its translations. */
    readonly labels: {readonly suppressed: string; readonly unsuppressed: string};
}

/**
 * The suppression changes as a preview of the same shape as a paramset write: one line and one
 * `suppressServiceMessages(address, parameter, true|false)` call per checkbox that differs from
 * what the interface reports. A checkbox set back to its current state produces nothing - exactly
 * like a parameter edited back to its value - so nothing is sent for it.
 */
export function buildSuppressPreview(options: SuppressPreviewOptions): WritePreview {
    const changed = Object.entries(options.edits)
        .filter(([param, suppress]) => options.suppressed.includes(param) !== suppress)
        .sort(([a], [b]) => a.localeCompare(b));
    const label = (suppress: boolean): string => (suppress ? options.labels.suppressed : options.labels.unsuppressed);
    return {
        targets: [options.address],
        entries: changed.map(([param, suppress]) => ({param, from: label(!suppress), to: label(suppress)})),
        values: {},
        skipped: [],
        problems: [],
        calls: changed.map(([param, suppress]) => suppressCallText(options.address, param, suppress)),
    };
}
