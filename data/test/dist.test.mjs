/**
 * Validates the committed `data/dist/` against the runtime contract in
 * `packages/core/src/data/types.ts` and against facts from `docs/analysis-2026-09.md` section 6.
 *
 * The test deliberately reads only `dist/`, never `upstream/`: `dist/` is what ships, and it has to
 * stand on its own in a checkout that never ran `npm run fetch` (CI does not).
 */
import {readFileSync, readdirSync, existsSync} from 'node:fs';
import path from 'node:path';

import {describe, expect, it} from 'vitest';

import {distDir} from '../scripts/lib/paths.mjs';

const read = (relative) => JSON.parse(readFileSync(path.join(distDir, relative), 'utf8'));

const manifest = read('manifest.json');
const aliases = read('receiver-type-aliases.json');
const masterMetadata = read('master-metadata.json');
const optionPresets = read('option-presets.json');
const crossValidations = read('cross-validations.json');
const deviceIcons = read('device-icons.json');
const translations = Object.fromEntries(['de', 'en', 'tr'].map((l) => [l, read(`translations/${l}.json`)]));
const receiverTypes = readdirSync(path.join(distDir, 'profiles'))
    .map((file) => file.slice(0, -'.json'.length))
    .sort();
const profiles = Object.fromEntries(receiverTypes.map((type) => [type, read(`profiles/${type}.json`)]));

// ---------------------------------------------------------------- small runtime validators

const isString = (value) => typeof value === 'string';
const isRecordOfStrings = (value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(isString);

/** `Localized`: at least one of de/en/tr, all strings, nothing else. */
function checkLocalized(value, where, problems) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        problems.push(`${where}: not an object`);
        return;
    }
    for (const [language, text] of Object.entries(value)) {
        if (!['de', 'en', 'tr'].includes(language)) problems.push(`${where}: unknown language ${language}`);
        if (!isString(text) || text === '') problems.push(`${where}.${language}: empty or not a string`);
    }
}

/** `ProfileConstraint`. */
function checkConstraint(value, where, problems) {
    const scalar = (v) => ['number', 'string', 'boolean'].includes(typeof v);
    if (value === null || typeof value !== 'object') {
        problems.push(`${where}: not an object`);
        return;
    }
    const keys = Object.keys(value).sort().join(',');
    if (value.kind === 'fixed') {
        if (keys !== 'kind,value') problems.push(`${where}: unexpected keys ${keys}`);
        if (!scalar(value.value)) problems.push(`${where}: value is not a scalar`);
    } else if (value.kind === 'list') {
        if (!['kind,values', 'default,kind,values'].includes(keys)) problems.push(`${where}: unexpected keys ${keys}`);
        if (!Array.isArray(value.values) || value.values.length < 2) problems.push(`${where}: values is not a list`);
        else if (!value.values.every(scalar)) problems.push(`${where}: non-scalar list value`);
    } else if (value.kind === 'range') {
        if (!['kind,max,min', 'default,kind,max,min'].includes(keys))
            problems.push(`${where}: unexpected keys ${keys}`);
        if (typeof value.min !== 'number' || typeof value.max !== 'number') problems.push(`${where}: min/max`);
        if ('default' in value && typeof value.default !== 'number') problems.push(`${where}: default`);
    } else {
        problems.push(`${where}: unknown kind ${JSON.stringify(value.kind)}`);
    }
}

// ---------------------------------------------------------------- structure

describe('dist layout', () => {
    it('has exactly the files DATA_FILES describes', () => {
        const files = [];
        const walk = (dir, prefix) => {
            for (const entry of readdirSync(dir, {withFileTypes: true}).sort((a, b) => (a.name < b.name ? -1 : 1))) {
                if (entry.isDirectory()) walk(path.join(dir, entry.name), `${prefix}${entry.name}/`);
                else files.push(prefix + entry.name);
            }
        };
        walk(distDir, '');
        const json = files.filter((file) => file.endsWith('.json'));
        expect(json).toContain('manifest.json');
        expect(json).toContain('receiver-type-aliases.json');
        expect(json).toContain('master-metadata.json');
        expect(json).toContain('option-presets.json');
        expect(json).toContain('cross-validations.json');
        expect(json).toContain('device-icons.json');
        expect(json).toContain('translations/de.json');
        expect(json).toContain('translations/en.json');
        expect(json).toContain('translations/tr.json');
        // Nothing outside the documented layout (dist/icons/*.webp is allowed, see D-10).
        const unexpected = json.filter(
            (file) =>
                !file.startsWith('profiles/') &&
                !file.startsWith('translations/') &&
                ![
                    'manifest.json',
                    'receiver-type-aliases.json',
                    'master-metadata.json',
                    'option-presets.json',
                    'cross-validations.json',
                    'device-icons.json',
                ].includes(file),
        );
        expect(unexpected).toEqual([]);
    });

    it('is formatted with two-space JSON and an LF newline at the end', () => {
        for (const file of ['manifest.json', 'profiles/DIMMER.json', 'translations/de.json']) {
            const text = readFileSync(path.join(distDir, file), 'utf8');
            expect(text.endsWith('\n')).toBe(true);
            expect(text).not.toMatch(/\r/u);
            expect(text.split('\n')[1]).toMatch(/^ {2}"/u);
        }
    });
});

describe('manifest', () => {
    it('is a DataManifest', () => {
        expect(typeof manifest.generatedAt).toBe('string');
        expect(new Date(manifest.generatedAt).toISOString()).toBe(manifest.generatedAt);
        expect(manifest.languages).toEqual(['de', 'en', 'tr']);
        expect(manifest.receiverTypes).toEqual(receiverTypes);
        expect(manifest.sources.length).toBeGreaterThan(0);
        for (const source of manifest.sources) {
            expect(typeof source.name).toBe('string');
            expect(typeof source.version).toBe('string');
            expect(source.url).toMatch(/^https:\/\//u);
            expect(source.sha256).toMatch(/^[0-9a-f]{64}$/u);
        }
    });

    it('pins openccu-data 2026.7.2', () => {
        const openccu = manifest.sources.filter((source) => source.name.startsWith('openccu-data/'));
        expect(openccu).toHaveLength(4);
        for (const source of openccu) expect(source.version).toBe('2026.7.2');
    });
});

describe('link profiles', () => {
    // 65 receiver-type profile files. The analysis says 66 because openccu-data's `profiles/`
    // directory holds 66 entries - 65 receivers plus `_receiver_type_aliases.json`; the three
    // aliases bring the number of receiver types the app can resolve to 68.
    it('covers 65 receiver types plus 3 aliases', () => {
        expect(receiverTypes).toHaveLength(65);
        expect(Object.keys(aliases)).toHaveLength(3);
        expect(aliases).toHaveProperty('OPTICAL_SIGNAL_RECEIVER', 'DIMMER_VIRTUAL_RECEIVER');
        for (const [alias, target] of Object.entries(aliases)) {
            expect(receiverTypes, `${alias} -> ${target}`).toContain(target);
            expect(receiverTypes).not.toContain(alias);
        }
    });

    it('matches ReceiverProfiles everywhere', () => {
        const problems = [];
        let profileCount = 0;
        for (const [receiverType, file] of Object.entries(profiles)) {
            if (file.receiverType !== receiverType) problems.push(`${receiverType}: receiverType mismatch`);
            const extra = Object.keys(file).filter(
                (key) => !['receiverType', 'senders', 'senderMetadata'].includes(key),
            );
            if (extra.length > 0) problems.push(`${receiverType}: unexpected keys ${extra.join(',')}`);
            for (const [senderType, list] of Object.entries(file.senders)) {
                if (!Array.isArray(list)) {
                    problems.push(`${receiverType}/${senderType}: not an array`);
                    continue;
                }
                const ids = new Set();
                for (const profile of list) {
                    profileCount += 1;
                    const where = `${receiverType}/${senderType}#${profile.id}`;
                    if (typeof profile.id !== 'number' || !Number.isInteger(profile.id)) problems.push(`${where}: id`);
                    if (ids.has(profile.id)) problems.push(`${where}: duplicate id`);
                    ids.add(profile.id);
                    if (!isString(profile.key) || profile.key === '') problems.push(`${where}: key`);
                    checkLocalized(profile.name, `${where}.name`, problems);
                    checkLocalized(profile.description, `${where}.description`, problems);
                    if (profile.params === null || typeof profile.params !== 'object') problems.push(`${where}.params`);
                    else {
                        for (const [name, constraint] of Object.entries(profile.params)) {
                            checkConstraint(constraint, `${where}.params.${name}`, problems);
                        }
                    }
                }
                const sorted = [...ids].sort((a, b) => a - b);
                if (JSON.stringify([...ids]) !== JSON.stringify(sorted))
                    problems.push(`${receiverType}/${senderType}: unsorted ids`);
            }
        }
        expect(problems).toEqual([]);
        // 3521 profiles: 1113 from openccu-data's profiles/, 2408 added from easymode_extract.
        expect(profileCount).toBe(3521);
    });

    it('keeps DIMMER as the analysis describes it', () => {
        const dimmer = profiles.DIMMER;
        expect(Object.keys(dimmer.senders)).toEqual(expect.arrayContaining(['KEY', 'SHUTTER_CONTACT']));
        const first = dimmer.senders.KEY.find((profile) => profile.id === 1);
        expect(first.key).toBe('dimmer_on_brighter');
        expect(first.name.de).toBe('Dimmer - ein/heller');
        expect(first.name.en).toBe('Dimmer - on/brighter');
        expect(first.params.LONG_ACTION_TYPE).toEqual({kind: 'fixed', value: 4});
        expect(dimmer.senders.KEY[0]).toMatchObject({id: 0, key: 'expert'});
        expect(dimmer.senders.SHUTTER_CONTACT.find((profile) => profile.id === 1).key).toBe('dimmer_on_off');
    });

    it('resolves the jump targets of easymode_extract into numbers', () => {
        // SWITCH_VIRTUAL_RECEIVER/COND_SWITCH_TRANSMITTER only exists in easymode_extract, where the
        // jump targets are Tcl variables (`[subst {$ON_DELAY $OFF_DELAY}]`).
        const problems = [];
        for (const [receiverType, file] of Object.entries(profiles)) {
            for (const [senderType, list] of Object.entries(file.senders)) {
                for (const profile of list) {
                    for (const [name, constraint] of Object.entries(profile.params)) {
                        const values = constraint.kind === 'fixed' ? [constraint.value] : (constraint.values ?? []);
                        for (const value of values) {
                            if (typeof value === 'string') {
                                problems.push(`${receiverType}/${senderType}#${profile.id}.${name} = ${value}`);
                            }
                        }
                    }
                }
            }
        }
        expect(problems).toEqual([]);
    });

    it('keeps the sender metadata consistent', () => {
        for (const file of Object.values(profiles)) {
            for (const [senderType, meta] of Object.entries(file.senderMetadata ?? {})) {
                expect(Object.keys(file.senders), `${file.receiverType}/${senderType}`).toContain(senderType);
                for (const id of Object.values(meta.optionPresets ?? {})) expect(optionPresets).toHaveProperty(id);
                for (const subset of meta.subsets ?? []) {
                    expect(typeof subset.id).toBe('number');
                    expect(typeof subset.key).toBe('string');
                    expect(Array.isArray(subset.params)).toBe(true);
                }
            }
        }
    });
});

describe('master metadata, presets and cross validations', () => {
    it('matches MasterMetadata for all 54 channel types', () => {
        expect(Object.keys(masterMetadata)).toHaveLength(54);
        for (const [channelType, entry] of Object.entries(masterMetadata)) {
            expect(entry.channelType).toBe(channelType);
            for (const key of Object.keys(entry)) {
                expect([
                    'channelType',
                    'parameterOrder',
                    'conditionalVisibility',
                    'optionPresets',
                    'parameterGroups',
                ]).toContain(key);
            }
            for (const rule of entry.conditionalVisibility ?? []) {
                expect(typeof rule.trigger).toBe('string');
                expect(['number', 'string', 'boolean']).toContain(typeof rule.triggerValue);
                expect(Array.isArray(rule.show)).toBe(true);
            }
            for (const id of Object.values(entry.optionPresets ?? {})) expect(optionPresets).toHaveProperty(id);
            for (const group of entry.parameterGroups ?? []) {
                expect(typeof group.id).toBe('string');
                expect(Array.isArray(group.parameters)).toBe(true);
            }
        }
        expect(masterMetadata.SWITCH_VIRTUAL_RECEIVER.parameterOrder).toEqual(['POWERUP_JUMPTARGET']);
    });

    it('matches OptionPreset for all 85 presets', () => {
        expect(Object.keys(optionPresets)).toHaveLength(85);
        for (const [id, preset] of Object.entries(optionPresets)) {
            expect(preset.id).toBe(id);
            expect(typeof preset.allowCustom).toBe('boolean');
            expect(preset.presets.length).toBeGreaterThan(0);
            for (const entry of preset.presets) {
                expect(['number', 'string']).toContain(typeof entry.value);
                expect(entry.label === undefined || typeof entry.label === 'string').toBe(true);
                expect(entry.labelKey === undefined || typeof entry.labelKey === 'string').toBe(true);
                expect(entry.label !== undefined || entry.labelKey !== undefined).toBe(true);
            }
        }
        expect(optionPresets.DELAY.allowCustom).toBe(true);
        expect(optionPresets.DELAY.presets).toHaveLength(10);
        expect(optionPresets.DELAY.presets[0]).toEqual({labelKey: 'none', value: 0});
        expect(optionPresets.DELAY.presets.at(-1)).toEqual({label: '1h', value: 3600});
    });

    it('matches CrossValidationRule for all 5 rules', () => {
        expect(crossValidations).toHaveLength(5);
        for (const rule of crossValidations) {
            expect(typeof rule.id).toBe('string');
            expect(translations.de.uiLabels).toHaveProperty(rule.errorKey);
            expect(translations.en.uiLabels).toHaveProperty(rule.errorKey);
            if (rule.rule === 'between') {
                expect(Object.keys(rule).sort()).toEqual(['errorKey', 'id', 'maxParam', 'minParam', 'param', 'rule']);
            } else {
                expect(['gte', 'lte']).toContain(rule.rule);
                expect(Object.keys(rule).sort()).toEqual(['errorKey', 'id', 'paramA', 'paramB', 'rule']);
            }
        }
        expect(crossValidations[0]).toMatchObject({
            id: 'dim_max_gte_min',
            rule: 'gte',
            paramA: 'DIM_MAX_LEVEL',
            paramB: 'DIM_MIN_LEVEL',
        });
    });

    it('resolves every label key it emits', () => {
        // Six WebUI keys have no string in openccu-data's ui_labels (two of them are unevaluated Tcl
        // expressions upstream); everything else must resolve, so the UI never shows a raw key.
        const missing = new Set();
        const check = (key) => {
            if (key !== undefined && !(key in translations.de.uiLabels)) missing.add(key);
        };
        for (const preset of Object.values(optionPresets)) for (const entry of preset.presets) check(entry.labelKey);
        for (const entry of Object.values(masterMetadata)) {
            for (const group of entry.parameterGroups ?? []) check(group.labelKey);
        }
        expect([...missing].sort()).toEqual([
            '\\${motiondetectoroptionmotion_$operationmode}',
            '\\${motiondetectoroptionnomotion_$operationmode}',
            'currentdetectionactive',
            'currentdetectioninactivevalueoutput1',
            'stringtablepowermeterconstantvolume',
            'virtualhelptxtdimmer',
        ]);
    });
});

describe('translations', () => {
    const maps = ['channelTypes', 'deviceModels', 'parameters', 'parameterValues', 'parameterHelp', 'uiLabels'];

    it('matches Translations for de, en and tr', () => {
        for (const [language, file] of Object.entries(translations)) {
            expect(file.language).toBe(language);
            expect(Object.keys(file).sort()).toEqual(['language', ...maps].sort());
            for (const map of maps) expect(isRecordOfStrings(file[map]), `${language}.${map}`).toBe(true);
        }
    });

    it('has the volume the analysis promised, plus the translation_custom overrides', () => {
        // Upstream translation_extract: 234 channel types, 373 device models, 1843 parameters,
        // 1851 parameter values, 167 help texts, 5455 UI labels. translation_custom adds the rest.
        expect(Object.keys(translations.de.channelTypes)).toHaveLength(253);
        expect(Object.keys(translations.de.deviceModels)).toHaveLength(488);
        expect(Object.keys(translations.de.parameters)).toHaveLength(2359);
        expect(Object.keys(translations.de.parameterHelp)).toHaveLength(167);
        expect(Object.keys(translations.de.parameterValues).length).toBeGreaterThan(3000);
        expect(Object.keys(translations.de.uiLabels).length).toBeGreaterThan(5400);
        for (const map of maps) {
            expect(Object.keys(translations.en[map]).length, `en.${map}`).toBeGreaterThan(
                Object.keys(translations.de[map]).length * 0.99,
            );
        }
    });

    it('uses CCU identifiers as keys, and verbatim WebUI keys for uiLabels', () => {
        for (const map of ['channelTypes', 'deviceModels', 'parameters', 'parameterValues', 'parameterHelp']) {
            for (const key of Object.keys(translations.de[map])) {
                expect(key, `${map}: ${key}`).toBe(key.toUpperCase());
                expect(key).not.toContain('=');
            }
        }
        for (const key of Object.keys(translations.de.uiLabels)) expect(key).toBe(key.toLowerCase());
        expect(translations.de.channelTypes.DIMMER).toBeTypeOf('string');
        expect(translations.en.parameters['DIMMER|LEVEL']).toBeTypeOf('string');
    });

    it('carries the 2015 Turkish easy-mode strings as a fallback (D-15)', () => {
        expect(Object.keys(translations.tr.parameters).length).toBeGreaterThan(80);
        expect(translations.tr.parameters.DIM_MAX_LEVEL).toBe('Isik aydinlatildiginda seviye siniri');
        // Only keys that de or en actually have, so the fallback never invents an identifier.
        for (const map of maps) {
            for (const key of Object.keys(translations.tr[map])) {
                const known = key in translations.de[map] || key in translations.en[map];
                expect(known, `tr.${map}.${key}`).toBe(true);
            }
        }
    });

    it('gives the profiles Turkish names and descriptions where the 2.x code had them', () => {
        let names = 0;
        let descriptions = 0;
        for (const file of Object.values(profiles)) {
            for (const list of Object.values(file.senders)) {
                for (const profile of list) {
                    if (profile.name.tr) names += 1;
                    if (profile.description.tr) descriptions += 1;
                }
            }
        }
        expect(names).toBeGreaterThan(1000);
        expect(descriptions).toBeGreaterThan(400);
        expect(profiles.DIMMER.senders.KEY[0].name.tr).toBe('Uzmanlar');
    });
});

describe('device icons', () => {
    it('is a DeviceIcons map of bare file names', () => {
        expect(Object.keys(deviceIcons).length).toBe(535);
        for (const [type, file] of Object.entries(deviceIcons)) {
            expect(type).toBe(type.toUpperCase());
            expect(file).not.toContain('/');
            expect(file).toMatch(/\.(?:png|webp|gif|jpg)$/u);
        }
        expect(deviceIcons['HM-LC-SW1-FM']).toBe('4_hm-lc-sw1-fm.png');
    });
});

describe('bundled webp subset (D-10)', () => {
    const iconsDir = path.join(distDir, 'icons');
    it.skipIf(!existsSync(iconsDir))('stays small enough to ship', () => {
        const files = readdirSync(iconsDir);
        expect(files.length).toBeGreaterThan(0);
        for (const file of files) expect(file).toMatch(/\.webp$/u);
        const bytes = files.reduce((sum, file) => sum + readFileSync(path.join(iconsDir, file)).byteLength, 0);
        expect(bytes).toBeLessThan(3 * 1024 * 1024);
    });
});
