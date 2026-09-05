/**
 * Convert the pinned openccu-data artifacts in `data/upstream/` into the runtime format defined by
 * `packages/core/src/data/types.ts` and write it to `data/dist/` (committed).
 *
 * Sources and precedence, per output:
 *
 *   profiles/<RECEIVER_TYPE>.json
 *     1. `profiles/<RECEIVER_TYPE>.json.gz`  - wins for params, de and en name and description.
 *        Its extractor evaluates the WebUI's Tcl, so its numbers are the trustworthy ones.
 *     2. `easymode_extract.channel_metadata[*].sender_types[*]` - adds the sender types and
 *        profiles (1) does not cover (494 senders, 2409 profiles) and is the only source of
 *        `name_key`, which becomes `LinkProfile.key`. Its values are raw Tcl and are resolved by
 *        `lib/constraints.mjs`.
 *     3. `legacy/www/easymodes/localization/{de,en,tr}` - fills descriptions that neither has, and
 *        is the only source of Turkish (D-15).
 *
 *   translations/{de,en}.json
 *     `translation_custom/*.json` over `translation_extract.json.gz`.
 *   translations/tr.json
 *     `legacy/www/easymodes/localization/tr/{PNAME,GENERIC}.json`, restricted to keys that de and
 *     en actually have.
 */
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';

import {toConstraint} from './lib/constraints.mjs';
import {hasLegacy, legacyEasymodesDir, legacyLocalization, legacyReceiverTypes} from './lib/legacy.mjs';
import {distDir, readSources, readUpstreamJson, removeDir, sha256, sortKeys, upstreamDir} from './lib/paths.mjs';
import {CROSS_VALIDATION_MESSAGES, identifierKey, labelKey, mergeMap, valueKey} from './lib/translations.mjs';
import {writeJson} from './lib/write-json.mjs';

const LANGUAGES = ['de', 'en', 'tr'];

/** @type {string[]} */
const warnings = [];
const warn = (message) => warnings.push(message);

const sources = readSources();
const easymode = readUpstreamJson('easymode_extract.json.gz');
const extract = readUpstreamJson('translation_extract.json.gz');
const aliases = readUpstreamJson('profiles/_receiver_type_aliases.json');
const custom = Object.fromEntries(
    Object.keys(sources.openccuData.files)
        .filter((file) => file.startsWith('translation_custom/'))
        .map((file) => [path.basename(file, '.json'), readUpstreamJson(file)]),
);

const receiverTypes = readdirSync(path.join(upstreamDir, 'profiles'))
    .filter((file) => file.endsWith('.json.gz'))
    .map((file) => file.slice(0, -'.json.gz'.length))
    .sort();
/** @type {Record<string, Record<string, {profiles: Array<{id: number, name: Record<string, string>, description: Record<string, string>, params: Record<string, object>}>}>>} */
const profileFiles = Object.fromEntries(
    receiverTypes.map((type) => [type, readUpstreamJson(`profiles/${type}.json.gz`)]),
);

// ---------------------------------------------------------------- translations

/** @type {Record<string, {language: string, channelTypes: Record<string, string>, deviceModels: Record<string, string>, parameters: Record<string, string>, parameterValues: Record<string, string>, parameterHelp: Record<string, string>, uiLabels: Record<string, string>}>} */
const translations = {};
for (const language of ['de', 'en']) {
    const pick = (name) => extract[`${name}_${language}`] ?? {};
    const pickCustom = (name) => custom[`${name}_${language}`] ?? {};
    translations[language] = {
        language,
        channelTypes: mergeMap(identifierKey, pick('channel_types'), pickCustom('channel_types'), warn),
        deviceModels: mergeMap(identifierKey, pick('device_models'), pickCustom('device_models'), warn),
        parameters: mergeMap(identifierKey, pick('parameters'), pickCustom('parameters'), warn),
        parameterValues: mergeMap(valueKey, pick('parameter_values'), pickCustom('parameter_values'), warn),
        parameterHelp: mergeMap(identifierKey, pick('parameter_help'), pickCustom('parameter_help'), warn),
        uiLabels: mergeMap(labelKey, pick('ui_labels'), pickCustom('ui_labels'), warn),
    };
}

/**
 * Make sure every `labelKey` / `errorKey` the pipeline emits resolves in `uiLabels`. openccu-data
 * keeps a handful of them in `parameters` instead, and the three cross-validation messages exist
 * nowhere upstream.
 *
 * @param {string} key
 * @returns {string} the lower-cased key, guaranteed to be present in uiLabels where possible
 */
function useLabelKey(key) {
    const lower = labelKey(key);
    for (const language of ['de', 'en']) {
        const t = translations[language];
        if (lower in t.uiLabels) continue;
        const message = CROSS_VALIDATION_MESSAGES[key]?.[language];
        if (message !== undefined) {
            t.uiLabels[lower] = message;
            continue;
        }
        const fromParameters = t.parameters[identifierKey(key)];
        if (fromParameters !== undefined) t.uiLabels[lower] = fromParameters;
    }
    if (!(lower in translations.de.uiLabels)) warn(`label key without a translation: ${key}`);
    return lower;
}

// ---------------------------------------------------------------- link profiles

/** Descriptions from the 2.x tree: receiverType -> senderType -> language -> profile id -> text. */
const legacyDescriptions = new Map();
if (hasLegacy()) {
    for (const receiverType of legacyReceiverTypes()) {
        /** @type {Record<string, Record<string, Record<number, string>>>} */
        const perSender = {};
        for (const language of LANGUAGES) {
            const file = legacyLocalization(language, receiverType);
            if (!file) continue;
            for (const [senderType, entries] of Object.entries(file)) {
                for (const [key, text] of Object.entries(entries)) {
                    const match = /^description_(\d+)$/u.exec(key);
                    if (!match || typeof text !== 'string' || text === '') continue;
                    perSender[senderType] ??= {};
                    perSender[senderType][language] ??= {};
                    perSender[senderType][language][Number(match[1])] = text;
                }
            }
        }
        legacyDescriptions.set(receiverType, perSender);
    }
}
/** Turkish profile names: the 2.x code looked the profile's name key up in GENERIC.json. */
const legacyGeneric = Object.fromEntries(LANGUAGES.map((l) => [l, legacyLocalization(l, 'GENERIC') ?? {}]));

/** @param {Record<string, string|undefined>} candidates */
function localized(candidates) {
    /** @type {Record<string, string>} */
    const out = {};
    for (const language of LANGUAGES) {
        const value = candidates[language];
        if (typeof value === 'string' && value.trim() !== '') out[language] = value;
    }
    return out;
}

/** @param {Record<string, object>} params */
function convertParams(params, where) {
    /** @type {Record<string, object>} */
    const out = {};
    for (const name of Object.keys(params).sort()) {
        // `UI_DEFINITION_n_m` is not a device parameter but the label of a WebUI radio button
        // ("gekippt oder ganz offen"); openccu-data's profiles extractor drops it as well.
        if (name.startsWith('UI_DEFINITION_')) continue;
        const constraint = toConstraint(params[name]);
        if (constraint === undefined) {
            warn(`unresolvable constraint dropped: ${where} ${name} = ${JSON.stringify(params[name])}`);
            continue;
        }
        out[name] = constraint;
    }
    return out;
}

let profileCount = 0;
let profilesFromEasymodeOnly = 0;
/** @type {Record<string, object>} */
const receiverProfiles = {};

for (const receiverType of receiverTypes) {
    const fromProfiles = profileFiles[receiverType];
    const fromEasymode = easymode.channel_metadata[receiverType]?.sender_types ?? {};
    const senderTypes = [
        ...new Set([...Object.keys(fromProfiles), ...Object.keys(fromEasymode).filter((s) => s !== '_MASTER')]),
    ].sort();

    /** @type {Record<string, object[]>} */
    const senders = {};
    /** @type {Record<string, object>} */
    const senderMetadata = {};

    for (const senderType of senderTypes) {
        const byId = new Map();
        for (const profile of fromEasymode[senderType]?.profiles ?? []) byId.set(profile.id, {easymode: profile});
        for (const profile of fromProfiles[senderType]?.profiles ?? []) {
            byId.set(profile.id, {...byId.get(profile.id), profiles: profile});
        }

        const legacyText = legacyDescriptions.get(receiverType)?.[senderType] ?? {};
        /** @type {object[]} */
        const list = [];
        for (const id of [...byId.keys()].sort((a, b) => a - b)) {
            const {easymode: e, profiles: p} = byId.get(id);
            const where = `${receiverType}/${senderType}#${id}`;
            const key = e?.name_key ?? `profile_${id}`;
            if (!p) profilesFromEasymodeOnly += 1;

            const name = localized({
                de: p?.name?.de ?? translations.de.parameters[identifierKey(key)],
                en: p?.name?.en ?? translations.en.parameters[identifierKey(key)],
                tr: legacyGeneric.tr?.[key],
            });
            const description = localized({
                de: p?.description?.de || e?.description || legacyText.de?.[id],
                en: p?.description?.en || legacyText.en?.[id],
                tr: legacyText.tr?.[id],
            });
            list.push({
                id,
                key,
                name,
                description,
                params: convertParams(p?.params ?? e?.params ?? {}, where),
            });
            profileCount += 1;
        }
        senders[senderType] = list;

        const metadata = fromEasymode[senderType];
        /** @type {Record<string, unknown>} */
        const meta = {};
        if (metadata?.parameter_order) meta.parameterOrder = metadata.parameter_order;
        if (metadata?.option_presets) meta.optionPresets = sortKeys(metadata.option_presets);
        if (metadata?.subsets) {
            meta.subsets = metadata.subsets.map((subset) => ({
                id: subset.id,
                key: subset.name_key,
                optionValue: subset.option_value,
                params: subset.member_params,
                values: subset.values,
            }));
        }
        if (Object.keys(meta).length > 0) senderMetadata[senderType] = meta;
    }

    receiverProfiles[receiverType] = {
        receiverType,
        senders: sortKeys(senders),
        ...(Object.keys(senderMetadata).length > 0 ? {senderMetadata: sortKeys(senderMetadata)} : {}),
    };
}

// ---------------------------------------------------------------- master metadata, presets, rules

/** @type {Record<string, object>} */
const masterMetadata = {};
for (const [channelType, meta] of Object.entries(easymode.channel_metadata)) {
    const master = meta.sender_types?._MASTER;
    if (!master) continue;
    /** @type {Record<string, unknown>} */
    const entry = {channelType};
    if (master.parameter_order) entry.parameterOrder = master.parameter_order;
    if (master.conditional_visibility) {
        entry.conditionalVisibility = master.conditional_visibility.map((rule) => ({
            trigger: rule.trigger,
            triggerValue: rule.trigger_value,
            show: rule.show,
        }));
    }
    if (master.option_presets) entry.optionPresets = sortKeys(master.option_presets);
    if (master.parameter_groups) {
        entry.parameterGroups = master.parameter_groups.map((group) => ({
            id: group.id,
            ...(group.label_key ? {labelKey: useLabelKey(group.label_key)} : {}),
            parameters: group.parameters,
        }));
    }
    masterMetadata[channelType] = entry;
}

/** @type {Record<string, object>} */
const optionPresets = {};
for (const [id, preset] of Object.entries(easymode.option_presets)) {
    optionPresets[id] = {
        id,
        allowCustom: Boolean(preset.allow_custom),
        presets: preset.presets.map((entry) => ({
            ...(entry.label === undefined ? {} : {label: entry.label}),
            ...(entry.label_key === undefined ? {} : {labelKey: useLabelKey(entry.label_key)}),
            value: entry.value,
        })),
    };
}
// Drop references to presets that the extract does not define, so that every id in
// master-metadata.json resolves in option-presets.json.
for (const entry of Object.values(masterMetadata)) {
    if (!entry.optionPresets) continue;
    for (const [parameter, id] of Object.entries(entry.optionPresets)) {
        if (id in optionPresets) continue;
        warn(`master-metadata: ${entry.channelType}.${parameter} references undefined preset ${id}`);
        delete entry.optionPresets[parameter];
    }
}
for (const receiver of Object.values(receiverProfiles)) {
    for (const [senderType, meta] of Object.entries(receiver.senderMetadata ?? {})) {
        if (!meta.optionPresets) continue;
        for (const [parameter, id] of Object.entries(meta.optionPresets)) {
            if (id in optionPresets) continue;
            warn(`${receiver.receiverType}/${senderType}.${parameter} references undefined preset ${id}`);
            delete meta.optionPresets[parameter];
        }
    }
}

const crossValidations = easymode.cross_validations.rules.map((rule) => {
    const base = {id: rule.id, rule: rule.rule, errorKey: useLabelKey(rule.error_key)};
    if (rule.rule === 'between') {
        return {...base, param: rule.param, minParam: rule.min_param, maxParam: rule.max_param};
    }
    return {...base, paramA: rule.param_a, paramB: rule.param_b};
});

// ---------------------------------------------------------------- turkish fallback (D-15)

const turkish = {
    language: 'tr',
    channelTypes: {},
    deviceModels: {},
    parameters: {},
    parameterValues: {},
    parameterHelp: {},
    uiLabels: {},
};
if (hasLegacy()) {
    const parameterNames = legacyLocalization('tr', 'PNAME') ?? {};
    const generic = legacyGeneric.tr ?? {};
    let dropped = 0;
    for (const [rawKey, text] of [...Object.entries(parameterNames), ...Object.entries(generic)]) {
        if (typeof text !== 'string' || text === '') continue;
        const asParameter = identifierKey(rawKey);
        const asLabel = labelKey(rawKey);
        if (asParameter in translations.de.parameters || asParameter in translations.en.parameters) {
            turkish.parameters[asParameter] = text;
        } else if (asLabel in translations.de.uiLabels || asLabel in translations.en.uiLabels) {
            turkish.uiLabels[asLabel] = text;
        } else {
            dropped += 1;
        }
    }
    for (const [key, texts] of Object.entries(CROSS_VALIDATION_MESSAGES)) turkish.uiLabels[labelKey(key)] = texts.tr;
    if (dropped > 0) warn(`tr: ${dropped} legacy key(s) dropped, no de/en counterpart`);
}

// ---------------------------------------------------------------- device icons

/** @type {Record<string, string>} */
const deviceIcons = {};
const iconSources = {...extract.device_icons, ...(custom.device_icons ?? {})};
for (const [rawType, file] of Object.entries(iconSources)) {
    const type = identifierKey(rawType);
    // The contract wants the bare file name; ten upstream entries sit in the CCU's `coupling/`
    // subdirectory, which `scripts/icons-from-ccu.mjs` retries for.
    const name = file.split('/').pop();
    if (type in deviceIcons && deviceIcons[type] !== name) warn(`device icon collision for ${type}`);
    deviceIcons[type] = name;
}

// ---------------------------------------------------------------- manifest

/** @param {(file: string) => boolean} match */
function bundleHash(match) {
    const lines = Object.entries(sources.openccuData.files)
        .filter(([file]) => match(file))
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([file, hash]) => `${file} ${hash}`);
    return sha256(lines.join('\n'));
}

const legacyTurkishDir = path.join(legacyEasymodesDir, 'localization', 'tr');
const legacyFiles = hasLegacy()
    ? readdirSync(legacyTurkishDir)
          .sort()
          .map((file) => sha256(readFileSync(path.join(legacyTurkishDir, file))))
    : [];

const manifestSources = [
    {
        name: 'openccu-data/easymode_extract',
        version: sources.openccuData.version,
        url: sources.openccuData.baseUrl + 'easymode_extract.json.gz',
        sha256: sources.openccuData.files['easymode_extract.json.gz'],
    },
    {
        name: 'openccu-data/translation_extract',
        version: sources.openccuData.version,
        url: sources.openccuData.baseUrl + 'translation_extract.json.gz',
        sha256: sources.openccuData.files['translation_extract.json.gz'],
    },
    {
        name: 'openccu-data/profiles',
        version: sources.openccuData.version,
        url: sources.openccuData.baseUrl + 'profiles/',
        sha256: bundleHash((file) => file.startsWith('profiles/')),
    },
    {
        name: 'openccu-data/translation_custom',
        version: sources.openccuData.version,
        url: sources.openccuData.baseUrl + 'translation_custom/',
        sha256: bundleHash((file) => file.startsWith('translation_custom/')),
    },
];
if (legacyFiles.length > 0) {
    manifestSources.push({
        name: 'homematic-manager/legacy-easymode-localization',
        version: '2.7.1',
        url: 'https://github.com/hobbyquaker/homematic-manager/tree/master/www/easymodes/localization',
        sha256: sha256(legacyFiles.join('\n')),
    });
}

// `generatedAt` is kept from the previous run while the inputs are unchanged, so that re-running
// `npm run update` produces no diff (the update procedure in README.md relies on that).
const previous = existsSync(path.join(distDir, 'manifest.json'))
    ? JSON.parse(readFileSync(path.join(distDir, 'manifest.json'), 'utf8'))
    : undefined;
const sameInputs =
    previous !== undefined &&
    JSON.stringify(previous.sources) === JSON.stringify(manifestSources) &&
    JSON.stringify(previous.receiverTypes) === JSON.stringify(receiverTypes) &&
    JSON.stringify(previous.languages) === JSON.stringify(LANGUAGES);

const manifest = {
    generatedAt: sameInputs ? previous.generatedAt : new Date().toISOString(),
    sources: manifestSources,
    receiverTypes,
    languages: LANGUAGES,
};

// ---------------------------------------------------------------- write

// Only what the converter owns: dist/icons/ is produced by scripts/icons-subset.mjs and stays.
removeDir(path.join(distDir, 'profiles'));
removeDir(path.join(distDir, 'translations'));
let bytes = 0;
let files = 0;
const write = async (relative, value) => {
    bytes += await writeJson(path.join(distDir, relative), value);
    files += 1;
};

for (const [receiverType, value] of Object.entries(receiverProfiles)) {
    await write(`profiles/${receiverType}.json`, value);
}
await write('receiver-type-aliases.json', sortKeys(aliases));
await write('master-metadata.json', sortKeys(masterMetadata));
await write('option-presets.json', sortKeys(optionPresets));
await write('cross-validations.json', crossValidations);
for (const language of ['de', 'en']) {
    await write(`translations/${language}.json`, {
        language,
        channelTypes: sortKeys(translations[language].channelTypes),
        deviceModels: sortKeys(translations[language].deviceModels),
        parameters: sortKeys(translations[language].parameters),
        parameterValues: sortKeys(translations[language].parameterValues),
        parameterHelp: sortKeys(translations[language].parameterHelp),
        uiLabels: sortKeys(translations[language].uiLabels),
    });
}
await write('translations/tr.json', {
    language: 'tr',
    channelTypes: sortKeys(turkish.channelTypes),
    deviceModels: sortKeys(turkish.deviceModels),
    parameters: sortKeys(turkish.parameters),
    parameterValues: sortKeys(turkish.parameterValues),
    parameterHelp: sortKeys(turkish.parameterHelp),
    uiLabels: sortKeys(turkish.uiLabels),
});
await write('device-icons.json', sortKeys(deviceIcons));
await write('manifest.json', manifest);

console.log(
    `dist/: ${files} files, ${(bytes / 1024).toFixed(0)} KiB, ${receiverTypes.length} receiver types, ` +
        `${profileCount} link profiles (${profilesFromEasymodeOnly} only in easymode_extract), ` +
        `${Object.keys(masterMetadata).length} MASTER metadata entries, ` +
        `${Object.keys(optionPresets).length} option presets, ${crossValidations.length} cross validations`,
);
if (warnings.length > 0) {
    const unique = [...new Set(warnings)];
    console.log(`${warnings.length} warning(s), ${unique.length} distinct:`);
    for (const message of unique) console.log(`  ${message}`);
}
