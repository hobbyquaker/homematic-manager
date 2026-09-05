/**
 * The runtime data contract between the data pipeline (task 9, `data/`) and the core (task 3).
 *
 * The pipeline converts pinned openccu-data artifacts (HMSL 2.0 licensed, see data/NOTICE.md) into
 * these shapes; the core only ever sees these types. Loading is abstracted by `DataSource` so that
 * Electron, the web host and tests can supply the files any way they like.
 *
 * Field names are camelCase and stable; extend with optional fields, never rename or repurpose.
 */

/** Language code as used by the UI: `de`, `en`, optionally `tr` (legacy fallback, D-15). */
export type Language = 'de' | 'en' | 'tr';

/** A localised string: at least `de` and `en`; missing languages fall back to `en`, then `de`. */
export type Localized = Partial<Record<Language, string>>;

/** A parameter constraint inside a link profile (easy mode). */
export type ProfileConstraint =
    | {kind: 'fixed'; value: number | string | boolean}
    | {kind: 'list'; values: Array<number | string | boolean>; default?: number | string | boolean}
    | {kind: 'range'; min: number; max: number; default?: number};

/** One easy-mode profile of a receiver channel type for one sender channel type. Profile 0 is "expert". */
export interface LinkProfile {
    /** The `UI_HINT` value the CCU stores in the receiver's LINK paramset. */
    id: number;
    /** Stable key such as `expert`, `toggle`, `switch_toggle` (openccu-data `name_key`). */
    key: string;
    name: Localized;
    description: Localized;
    /** Parameters this profile sets or restricts; everything else keeps its current value. */
    params: Record<string, ProfileConstraint>;
}

/**
 * One group of link parameters the WebUI offers as a preset value, e.g. "switch on immediately"
 * versus "switch on after the ramp": picking `optionValue` writes `values` to `params`.
 */
export interface LinkParameterSubset {
    id: number;
    /** Stable key of the subset (openccu-data `name_key`). */
    key: string;
    optionValue: number;
    params: string[];
    values: Record<string, number | string | boolean>;
}

/** Link-paramset metadata for one sender channel type: what the easy-mode dialog shows besides the profile. */
export interface LinkSenderMetadata {
    /** Display order of the editable link parameters; parameters not listed come afterwards. */
    parameterOrder?: string[];
    /** parameter name -> `OptionPreset.id` */
    optionPresets?: Record<string, string>;
    subsets?: LinkParameterSubset[];
}

/** All profiles of one receiver channel type, keyed by sender channel type. */
export interface ReceiverProfiles {
    receiverType: string;
    senders: Record<string, LinkProfile[]>;
    /** Optional, keyed by sender channel type; the 2.x easy-mode dialog called this the profile's `options`. */
    senderMetadata?: Record<string, LinkSenderMetadata>;
}

/** `OPTICAL_SIGNAL_RECEIVER -> DIMMER_VIRTUAL_RECEIVER` etc.: receiver types that reuse another type's profiles. */
export type ReceiverTypeAliases = Record<string, string>;

/** Show `show` parameters only when `trigger` has `triggerValue`. */
export interface ConditionalVisibility {
    trigger: string;
    triggerValue: number | string | boolean;
    show: string[];
}

/** WebUI knowledge about a channel type's MASTER paramset that the description does not carry. */
export interface MasterMetadata {
    channelType: string;
    /** Display order; parameters not listed come afterwards in description order. */
    parameterOrder?: string[];
    conditionalVisibility?: ConditionalVisibility[];
    /** parameter name -> `OptionPreset.id` */
    optionPresets?: Record<string, string>;
    /** Optional fieldsets the WebUI renders the MASTER parameters in; `labelKey` refers to `Translations.uiLabels`. */
    parameterGroups?: Array<{id: string; labelKey?: string; parameters: string[]}>;
}

export interface OptionPresetEntry {
    /** Literal label such as `5s`; `labelKey` refers to `Translations.uiLabels`. */
    label?: string;
    labelKey?: string;
    value: number | string;
}

/** A dropdown of typical values for a parameter (delays, levels, ...), optionally with a free-value entry. */
export interface OptionPreset {
    id: string;
    allowCustom: boolean;
    presets: OptionPresetEntry[];
}

/** A rule between two or more parameters of the same paramset. */
export type CrossValidationRule =
    | {id: string; rule: 'gte'; paramA: string; paramB: string; errorKey: string}
    | {id: string; rule: 'lte'; paramA: string; paramB: string; errorKey: string}
    | {id: string; rule: 'between'; param: string; minParam: string; maxParam: string; errorKey: string};

/** Translations of one language. Keys are the CCU's own identifiers. */
export interface Translations {
    language: Language;
    /** channel type -> label */
    channelTypes: Record<string, string>;
    /** device type -> label */
    deviceModels: Record<string, string>;
    /** parameter name or `CHANNEL_TYPE|PARAM` -> label */
    parameters: Record<string, string>;
    /** `CHANNEL_TYPE|PARAM|VALUE`, `PARAM|VALUE` or `VALUE` -> label */
    parameterValues: Record<string, string>;
    /** parameter name or `CHANNEL_TYPE|PARAM` -> help text (may contain simple HTML) */
    parameterHelp: Record<string, string>;
    /** WebUI label key -> label */
    uiLabels: Record<string, string>;
}

/** device type -> image file name (relative, no directory), as the CCU serves it under /config/img/devices/<size>/. */
export type DeviceIcons = Record<string, string>;

/** Where the data came from; written by the pipeline, shown in the About dialog. */
export interface DataManifest {
    generatedAt: string;
    sources: Array<{name: string; version: string; url?: string; sha256?: string}>;
    receiverTypes: string[];
    languages: Language[];
}

/**
 * How the core obtains data files. Implementations: in-memory (tests), fetch (web/CCU),
 * Electron IPC. Every method resolves `undefined` when the file does not exist.
 */
export interface DataSource {
    manifest(): Promise<DataManifest | undefined>;
    receiverProfiles(receiverType: string): Promise<ReceiverProfiles | undefined>;
    receiverTypeAliases(): Promise<ReceiverTypeAliases>;
    masterMetadata(): Promise<Record<string, MasterMetadata>>;
    optionPresets(): Promise<Record<string, OptionPreset>>;
    crossValidations(): Promise<CrossValidationRule[]>;
    translations(language: Language): Promise<Translations | undefined>;
    deviceIcons(): Promise<DeviceIcons>;
}

/**
 * File layout the pipeline writes under `data/dist/` and every `DataSource` reads:
 *
 *   manifest.json                      DataManifest
 *   profiles/<RECEIVER_TYPE>.json      ReceiverProfiles
 *   receiver-type-aliases.json         ReceiverTypeAliases
 *   master-metadata.json               Record<channelType, MasterMetadata>
 *   option-presets.json                Record<id, OptionPreset>
 *   cross-validations.json             CrossValidationRule[]
 *   translations/<language>.json       Translations
 *   device-icons.json                  DeviceIcons
 */
export const DATA_FILES = {
    manifest: 'manifest.json',
    profiles: (receiverType: string) => `profiles/${receiverType}.json`,
    receiverTypeAliases: 'receiver-type-aliases.json',
    masterMetadata: 'master-metadata.json',
    optionPresets: 'option-presets.json',
    crossValidations: 'cross-validations.json',
    translations: (language: Language) => `translations/${language}.json`,
    deviceIcons: 'device-icons.json',
} as const;
