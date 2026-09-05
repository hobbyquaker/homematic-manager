import type {ParameterDescription} from '@homematic-manager/core';
import {enumList, isWritable} from '@homematic-manager/core';

import type {DeviceEditorBase, EditorContext, EditorTarget} from './types.js';

/**
 * `DISPLAY_INFORMATION` and the other enums the description alone cannot render.
 *
 * An `ENUM` arrives as a `VALUE_LIST` of identifiers, and the generic row translates each of them
 * through `CHANNEL_TYPE|PARAM|NAME` of the CCU string table. That covers most of them - and misses
 * two kinds entirely:
 *
 *   **the index-keyed ones.** 586 of the 3039 value translations in `data/dist` are keyed by the
 *   *index*, not by the name: `DISPLAY_INFORMATION|0` is "Time" and `DISPLAY_INFORMATION|1` is
 *   "Date", while the description says `TIME` and `DATE` and nothing translates those. 141
 *   parameters are in that state, `ACOUSTIC_ALARM_SIGNAL` (eight frequencies) and
 *   `ADAPTIVE_REGULATION` among them.
 *
 *   **the ones the metadata narrows.** 52 channel types assign an option preset to a parameter,
 *   and a good third of those parameters are enums: `CHANNEL_OPERATION_MODE` on an
 *   `ACCELERATION_TRANSCEIVER` really offers three of its values, with WebUI labels
 *   (`motiondetectorchanneloperationmodeflat`), and the generic row shows a preset dropdown for
 *   numbers only.
 *
 * This editor takes exactly those enums: a preset list where the metadata has one, the index-keyed
 * names otherwise, and the raw `VALUE_LIST` identifier next to each entry so the wire value stays
 * visible. An enum whose names the description already carries is left to the generic row.
 */

/** One choice of an enum, as the dialog shows it. */
export interface EnumOption {
    /** The index the paramset stores. */
    readonly value: number;
    /** What the user reads. */
    readonly label: string;
    /** The `VALUE_LIST` identifier, or `''` when the preset offers a value the list does not name. */
    readonly raw: string;
    /** True when the label came from the string table or the metadata rather than the description. */
    readonly named: boolean;
}

export interface EnumField {
    readonly param: string;
    readonly description: ParameterDescription;
    readonly options: readonly EnumOption[];
    readonly writable: boolean;
    /** The option preset the list came from; absent when the names came from the string table. */
    readonly presetId?: string;
}

export interface EnumOptionsSpec extends DeviceEditorBase {
    readonly kind: 'enum-options';
    readonly fields: readonly EnumField[];
}

export function detectEnumOptions(
    target: EditorTarget,
    taken: ReadonlySet<string>,
    context: EditorContext,
): EnumOptionsSpec | undefined {
    const fields: EnumField[] = [];
    for (const [param, description] of Object.entries(target.description)) {
        const list = enumList(description);
        if (description.TYPE !== 'ENUM' || !list || list.length === 0 || taken.has(param)) {
            continue;
        }
        const preset = context.preset(param);
        const options = preset ? presetOptions(preset.presets, list, context) : namedOptions(param, list, context);
        // Nothing beyond what the description says: leave it to the generic row.
        if (!options || options.length === 0) {
            continue;
        }
        fields.push({
            param,
            description,
            options,
            writable: isWritable(description),
            ...(preset === undefined ? {} : {presetId: preset.id}),
        });
    }
    if (fields.length === 0) {
        return undefined;
    }
    return {
        kind: 'enum-options',
        id: 'enum-options',
        covers: fields.map((field) => field.param),
        fields,
    };
}

/** The preset's own list, with the raw identifier of each value where the description names one. */
function presetOptions(
    presets: EditorContextPreset,
    list: readonly string[],
    context: EditorContext,
): EnumOption[] | undefined {
    const options: EnumOption[] = [];
    for (const entry of presets) {
        const value = typeof entry.value === 'number' ? entry.value : Number(entry.value);
        if (!Number.isInteger(value)) {
            // A preset that is not about indexes does not belong on an enum; leave the whole
            // parameter to the generic row rather than showing half of it.
            return undefined;
        }
        options.push({
            value,
            label: entry.label ?? (entry.labelKey === undefined ? '' : context.uiLabel(entry.labelKey)),
            raw: list[value] ?? '',
            named: true,
        });
    }
    return options;
}

/**
 * The `VALUE_LIST`, named through the string table by index. Returns `undefined` when the names the
 * description carries are already translated - then there is nothing this editor could add.
 */
function namedOptions(param: string, list: readonly string[], context: EditorContext): EnumOption[] | undefined {
    let added = false;
    const options = list.map((raw, value) => {
        const byName = context.optionByName(param, raw);
        const byIndex = context.optionByIndex(param, value);
        if (byName === undefined && byIndex !== undefined) {
            added = true;
            return {value, label: byIndex, raw, named: true};
        }
        return {value, label: byName ?? raw, raw, named: byName !== undefined};
    });
    return added ? options : undefined;
}

type EditorContextPreset = readonly {
    label?: string | undefined;
    labelKey?: string | undefined;
    value: number | string;
}[];
