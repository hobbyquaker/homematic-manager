import type {OptionPreset, ParamsetDescription, ParamsetValue} from '@homematic-manager/core';

/**
 * The plug-in point of the device-specific editors (task 10).
 *
 * The generic paramset editor draws one row per parameter, which is right for almost everything and
 * useless for the handful of paramsets that are really one procedural dialog: a week programme is
 * 546 numbered parameters, a calibration is a base and a factor that have to be multiplied in the
 * head. The WebUI has a hand-written Tcl dialog for each of those and openccu-data cannot extract
 * them (docs/analysis-2026-09.md, 6.2), so they are hand-written here too - but *on top of* the
 * generic editor, never beside it:
 *
 *   - an editor is offered a {@link EditorTarget} and either recognises the description or does
 *     not; an unexpected description means no editor, not a broken one,
 *   - what it recognises it lists in `covers`, and exactly those rows disappear from the generic
 *     list - everything else stays a normal row, so a firmware that adds a parameter still shows
 *     it,
 *   - it writes into the same `edited` map the generic rows write into, so the preview and the
 *     payload are still `diffParamset`'s changed-only diff (task 6, item 4). No editor calls
 *     `putParamset` itself.
 *
 * The rule that follows from the second point is the one to keep in mind when adding an editor:
 * **an unexpected description must never hide a parameter.** Detection is therefore strict - every
 * name an editor claims has to be in the description, and a group that is missing a piece is not
 * recognised at all.
 */

/** What an editor is asked about. */
export interface EditorTarget {
    readonly interfaceName: string;
    readonly address: string;
    /** The channel's `TYPE`, or `''` for a device paramset - where the BidCos week profiles live. */
    readonly channelType: string;
    readonly paramset: string;
    readonly description: ParamsetDescription;
}

/** What every editor specification has. */
export interface DeviceEditorBase {
    /** Stable id: the `data-testid` of the block and the key of its heading. */
    readonly id: string;
    /** Everything this editor draws. The generic list drops exactly these names. */
    readonly covers: readonly string[];
}

/** The values as they stand: what the device answered, with the edits on top. */
export type EditorValues = Readonly<Record<string, ParamsetValue | undefined>>;

/** How an editor hands a change back: the same shape the generic rows use. */
export type EditorChange = (values: Readonly<Record<string, ParamsetValue>>) => void;

/**
 * What an editor may know beyond the description: the CCU string table and the metadata of task 9.
 *
 * It is injected rather than read from a store so the detectors stay pure functions the tests can
 * call without a DOM - and so a detector cannot quietly start depending on data that may not have
 * loaded yet. Every method answers `undefined` when nothing is known, and {@link EMPTY_CONTEXT} is
 * the "no data at all" case, which every editor has to survive.
 */
export interface EditorContext {
    /** The label of one enum value by its `VALUE_LIST` name, or `undefined` when untranslated. */
    optionByName(param: string, name: string): string | undefined;
    /** The label of one enum value by its index - how 586 of the value translations are keyed. */
    optionByIndex(param: string, index: number): string | undefined;
    /** The option preset the MASTER metadata assigns to a parameter, if any. */
    preset(param: string): OptionPreset | undefined;
    /** A WebUI label by its own key, what `OptionPresetEntry.labelKey` points at. */
    uiLabel(key: string): string;
}

/** No string table and no metadata: what a detector sees before the data has loaded. */
export const EMPTY_CONTEXT: EditorContext = {
    optionByName: () => undefined,
    optionByIndex: () => undefined,
    preset: () => undefined,
    uiLabel: (key) => key,
};
