/**
 * Task 62 (D-54): extract the CCU easy mode's form of every link profile from a WebUI easymode tree
 * into `extracted/easymode_controls.json.gz`, which `convert.mjs` merges into `dist/profiles/`.
 *
 * Like `icons-subset.mjs --ccu`, this is a tool, not part of `npm run update`: it needs the WebUI's
 * `/www/config/easymodes` directory, which is not published anywhere this repository could pin a
 * download of. Copy it from a CCU or OpenCCU (`tar -C /www/config -czf - easymodes`) and name the
 * firmware it came from. Unlike `upstream/` (downloaded, git-ignored), `extracted/` is committed,
 * since nobody could download it again; it is under the same HMSL notice (D-6).
 *
 * Usage: node scripts/easymode-controls.mjs <easymodes directory> --source "OpenCCU 3.89.8.20260719"
 */
import {readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {gzipSync} from 'node:zlib';

import {extractForms, extractTimeSelectorOptions, parseLocalization, timeOptionMeaning} from './lib/easymode-tcl.mjs';
import {dataDir, sortKeys} from './lib/paths.mjs';

const LANGUAGES = ['de', 'en'];

const args = process.argv.slice(2);
const sourceAt = args.indexOf('--source');
const source = sourceAt >= 0 ? args[sourceAt + 1] : undefined;
const root = args.find((arg, index) => !arg.startsWith('--') && index !== sourceAt + 1);
if (!root || !source) {
    console.error('usage: node scripts/easymode-controls.mjs <easymodes directory> --source "<firmware and version>"');
    process.exit(2);
}

const read = (file) => readFileSync(file, 'latin1');
const isDir = (file) => {
    try {
        return statSync(file).isDirectory();
    } catch {
        return false;
    }
};

/** The strings of every file in a localization directory, per language. */
function localizationOf(directory) {
    /** @type {Record<string, Record<string, string>>} */
    const byLanguage = {};
    for (const language of LANGUAGES) {
        const dir = path.join(directory, 'localization', language);
        if (!isDir(dir)) continue;
        const files = readdirSync(dir)
            .filter((file) => file.endsWith('.txt'))
            .sort();
        byLanguage[language] = Object.fromEntries(
            files.map((file) => [file, parseLocalization(read(path.join(dir, file)))]),
        );
    }
    return byLanguage;
}

// The shared strings. `PNAME.txt` is the WebUI's generic label file and wins; a key only other
// files have counts where they all agree. `ON_LEVEL` is "Pegel im Zustand "ein"" in PNAME.txt and
// "Öffnungsweite" in PNAME_TipTronic.txt, a variant for one device family: the generic one is meant.
// A key that stays ambiguous is never guessed - the control then shows the parameter's own name.
const GENERIC = 'PNAME.txt';
const shared = localizationOf(path.join(root, 'etc'));
/** @type {Record<string, Record<string, string>>} */
const sharedUnambiguous = {};
for (const language of LANGUAGES) {
    const files = shared[language] ?? {};
    const seen = new Map();
    for (const [file, strings] of Object.entries(files)) {
        if (file === GENERIC) continue;
        for (const [key, value] of Object.entries(strings)) {
            const before = seen.get(key);
            seen.set(key, before === undefined || before === value ? value : null);
        }
    }
    sharedUnambiguous[language] = {
        ...Object.fromEntries([...seen].filter(([, value]) => value !== null)),
        ...(files[GENERIC] ?? {}),
    };
}

/** A label in both languages, from the easymode's own strings first; `undefined` when neither has it. */
function labelFor(key, own) {
    if (key === undefined) return undefined;
    /** @type {Record<string, string>} */
    const label = {};
    for (const language of LANGUAGES) {
        const value = own[language]?.[key] ?? sharedUnambiguous[language]?.[key];
        if (value !== undefined) label[language] = value;
    }
    return Object.keys(label).length > 0 ? label : undefined;
}

// ------------------------------------------------------------------ the time selectors' presets
const helper = read(path.join(root, 'etc', 'hmip_helper.tcl'));
/** @type {Record<string, object[]>} */
const timeSelectors = {};
for (const [type, keys] of Object.entries(extractTimeSelectorOptions(helper))) {
    const options = [];
    for (const key of keys) {
        const meaning = timeOptionMeaning(key);
        if (meaning === undefined) continue;
        const label = labelFor(key, {});
        options.push({...meaning, ...(label === undefined ? {} : {label})});
    }
    timeSelectors[type] = options;
}

// ------------------------------------------------------------------ the forms
/** @type {Record<string, Record<string, Record<string, object[]>>>} */
const receivers = {};
let files = 0;
let profiles = 0;
let controls = 0;
for (const receiverType of readdirSync(root).sort()) {
    const directory = path.join(root, receiverType);
    if (receiverType === 'etc' || !isDir(directory)) continue;
    const local = localizationOf(directory);
    for (const file of readdirSync(directory).sort()) {
        if (!file.endsWith('.tcl')) continue;
        const forms = extractForms(read(path.join(directory, file)));
        if (Object.keys(forms).length === 0) continue;
        const senderType = file.slice(0, -'.tcl'.length);
        // the easymode's own strings: localization/<language>/<SENDER_TYPE>.txt
        const own = Object.fromEntries(
            LANGUAGES.map((language) => [language, local[language]?.[`${senderType}.txt`] ?? {}]),
        );
        /** @type {Record<string, object[]>} */
        const bySender = {};
        for (const [profile, list] of Object.entries(forms)) {
            bySender[profile] = list.map(({labelKey, ...control}) => {
                const label = labelFor(labelKey, own);
                if (control.kind === 'subset') {
                    // the choices' names: SUBSET_n(NAME) is "${subset_n}" in the easymode's strings
                    const names = control.subsets.map((id) => labelFor(`subset_${id}`, own));
                    return {
                        ...control,
                        ...(label === undefined ? {} : {label}),
                        ...(names.some((name) => name !== undefined) ? {names} : {}),
                    };
                }
                return {...control, ...(label === undefined ? {} : {label})};
            });
            profiles += 1;
            controls += list.length;
        }
        (receivers[receiverType] ??= {})[senderType] = bySender;
        files += 1;
    }
}

const out = {
    $comment:
        'The CCU easy mode forms (task 62, D-54), extracted by scripts/easymode-controls.mjs from the WebUI easymode TCL; HMSL, see NOTICE.md.',
    source,
    timeSelectors: sortKeys(timeSelectors),
    receivers: sortKeys(receivers),
};
const target = path.join(dataDir, 'extracted', 'easymode_controls.json.gz');
writeFileSync(target, gzipSync(`${JSON.stringify(out)}\n`, {level: 9}));
console.log(
    `${files} easymodes, ${profiles} profile forms, ${controls} controls, ${Object.keys(timeSelectors).length} time selector types -> ${path.relative(process.cwd(), target)}`,
);
