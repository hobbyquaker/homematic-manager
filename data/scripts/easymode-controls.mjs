/**
 * Tasks 62 and 63 (D-54, D-55): extract the CCU easy mode's forms from a WebUI easymode tree into
 * `extracted/easymode_controls.json.gz`, which `convert.mjs` merges into `dist/`: every link
 * profile's form (into `profiles/`), and every HmIP channel type's MASTER form (into
 * `master-metadata.json`).
 *
 * Like `icons-subset.mjs --ccu`, this is a tool, not part of `npm run update`: it needs the WebUI's
 * `/www/config/easymodes` directory, which is not published anywhere this repository could pin a
 * download of. Copy it from a CCU or OpenCCU (`tar -C /www/config -czf - easymodes`) and name the
 * firmware it came from. Unlike `upstream/` (downloaded, git-ignored), `extracted/` is committed,
 * since nobody could download it again; it is under the same HMSL notice (D-6).
 *
 * The MASTER forms' labels are mostly `stringTable...` keys of the WebUI's own language files
 * (`/www/webui/js/lang/<de|en>/translate.lang*.js`); `--webui-lang` names that `lang` directory.
 *
 * Usage: node scripts/easymode-controls.mjs <easymodes directory> --source "OpenCCU 3.89.8.20260719"
 *            [--webui-lang <www/webui/js/lang directory>]
 */
import {readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {gzipSync} from 'node:zlib';

import {
    extractForms,
    extractMasterControls,
    extractTimeSelectorOptions,
    htmlParamsBody,
    parseLocalization,
    parseProcs,
    timeOptionMeaning,
} from './lib/easymode-tcl.mjs';
import {dataDir, sortKeys} from './lib/paths.mjs';

const LANGUAGES = ['de', 'en'];

const args = process.argv.slice(2);
const option = (name) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
};
const source = option('--source');
const webuiLang = option('--webui-lang');
const root = args.find((arg, index) => !arg.startsWith('--') && !args[index - 1]?.startsWith('--'));
if (!root || !source) {
    console.error('usage: node scripts/easymode-controls.mjs <easymodes directory> --source "<firmware and version>"');
    process.exit(2);
}

const read = (file) => readFileSync(file, 'latin1');
const isFile = (file) => {
    try {
        return statSync(file).isFile();
    } catch {
        return false;
    }
};
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

// ------------------------------------------------------------------ the MASTER forms (task 63)
// The WebUI's own strings: `stringTable...`, `lbl...`, `option...` keys, which the MASTER forms
// use and the easymode localization files mostly do not have.
/** @type {Record<string, Record<string, string>>} */
const webuiStrings = {};
for (const language of LANGUAGES) {
    const dir = webuiLang === undefined ? undefined : path.join(webuiLang, language);
    webuiStrings[language] = {};
    if (dir === undefined || !isDir(dir)) continue;
    for (const file of readdirSync(dir)
        .filter((name) => name.endsWith('.js'))
        .sort()) {
        Object.assign(webuiStrings[language], parseLocalization(read(path.join(dir, file)), {percent: true}));
    }
}
const masterLabel = (key) => labelFor(key, webuiStrings);

const dialogs = parseProcs(read(path.join(root, 'etc', 'hmipChannelConfigDialogs.tcl')));
/** @type {Record<string, object[]>} */
const master = {};
let masterControls = 0;
const hmipDir = path.join(root, 'hmip');
for (const file of isDir(hmipDir) ? readdirSync(hmipDir).sort() : []) {
    // `hmip/<CHANNEL_TYPE>.tcl`; the lower-case files are keyed by a paramset id, below (task 64)
    if (!/^[A-Z][A-Z0-9_]*\.tcl$/u.test(file)) continue;
    const text = read(path.join(hmipDir, file));
    const body = htmlParamsBody(text);
    if (body === undefined) continue;
    const controls = extractMasterControls(body, new Map([...dialogs, ...parseProcs(text)]));
    if (controls.length === 0) continue;
    master[file.slice(0, -'.tcl'.length)] = controls.map(({labelKey, ...control}) => {
        const label = masterLabel(labelKey);
        return {...control, ...(label === undefined ? {} : {label})};
    });
    masterControls += controls.length;
}

// ------------------------------------------------------------------ MASTER forms by paramset id (task 64)
// The WebUI picks a MASTER form by the paramset id `getParamsetId(address, MASTER)` answers
// (ic_deviceparameters.cgi): `hmip/<paramid>.tcl` first, then `easymodes/<paramid>.tcl` - the BidCos
// forms and the device-level ones - and only for HmIP the channel type's `hmip/<TYPE>.tcl` above.
// A form that sets `internalKey` shows the channel's own button as a link profile instead of (or
// beside) its MASTER parameters: the channel's LINK paramset with itself as the peer, drawn with
// the link easymode it sources (`easymodes/<RECEIVER>/<SENDER>.tcl`). A `<paramid>Params.tcl` is
// the expert parameters the WebUI shows beside that internal key.
/** Procedures of every `etc/` file a form sources, for the calls into them (`getMaintenanceFloorHeating $chn`). */
const etcProcs = (text) => {
    const procs = new Map(dialogs);
    for (const match of text.matchAll(/easymodes\/etc\/(\w+)\.tcl/gu)) {
        const file = path.join(root, 'etc', `${match[1]}.tcl`);
        try {
            for (const [name, proc] of parseProcs(read(file))) procs.set(name, proc);
        } catch {
            // a file the form sources but this tree lacks: its calls stay unresolved
        }
    }
    return procs;
};
/** @type {Record<string, {controls?: object[], internalKey?: {receiverType: string}}>} */
const byParamsetId = {};
let byIdControls = 0;
const formOf = (text) => {
    const body = htmlParamsBody(text);
    if (body === undefined) return [];
    return extractMasterControls(body, new Map([...etcProcs(text), ...parseProcs(text)])).map(
        ({labelKey, ...control}) => {
            const label = masterLabel(labelKey);
            return {...control, ...(label === undefined ? {} : {label})};
        },
    );
};
const paramIdFiles = [
    // BidCos and device-level forms first, so the HmIP file of the same id wins, as in the WebUI
    ...readdirSync(root)
        .filter((file) => /^[a-z][A-Za-z0-9_.-]*\.tcl$/u.test(file) && !file.endsWith('Params.tcl'))
        .sort()
        .map((file) => path.join(root, file)),
    ...(isDir(hmipDir) ? readdirSync(hmipDir) : [])
        .filter((file) => /^[a-z][A-Za-z0-9_.-]*\.tcl$/u.test(file))
        .sort()
        .map((file) => path.join(hmipDir, file)),
];
for (const file of paramIdFiles) {
    const id = path.basename(file, '.tcl');
    // the link easymodes (`*_ch_link.tcl`, `linkHmIP_*`) and the helpers are not MASTER forms
    if (/_link$|^linkHmIP_|^em_common$|^NO_PROFILE$|_intkey$/u.test(id)) continue;
    const text = read(file);
    /** @type {{controls?: object[], internalKey?: {receiverType: string}}} */
    const entry = {};
    const intKey = /^\s*set internalKey\b/mu.test(text)
        ? /easymodes\/([A-Z][A-Z0-9_]*)\/[A-Za-z0-9_]+\.tcl/u.exec(text)?.[1]
        : undefined;
    if (intKey !== undefined) entry.internalKey = {receiverType: intKey};
    else if (/^\s*set internalKey\b/mu.test(text)) entry.internalKey = {receiverType: ''};
    // the dual-white controllers keep their internal key in `<paramid>_intkey.tcl`, which the WebUI
    // sources beside the form (setInternalDeviceKey)
    const intKeyFile = path.join(path.dirname(file), `${id}_intkey.tcl`);
    if (entry.internalKey === undefined && isFile(intKeyFile)) {
        const receiverType = /easymodes\/([A-Z][A-Z0-9_]*)\/[A-Za-z0-9_]+\.tcl/u.exec(read(intKeyFile))?.[1];
        if (receiverType !== undefined) entry.internalKey = {receiverType};
    }
    const paramsFile = path.join(path.dirname(file), `${id}Params.tcl`);
    const controls = [...formOf(text), ...(entry.internalKey && isFile(paramsFile) ? formOf(read(paramsFile)) : [])];
    if (controls.length > 0) entry.controls = controls;
    if (entry.controls === undefined && entry.internalKey === undefined) continue;
    byParamsetId[id] = entry;
    byIdControls += controls.length;
}

const out = {
    $comment:
        'The CCU easy mode forms (task 62, D-54), extracted by scripts/easymode-controls.mjs from the WebUI easymode TCL; HMSL, see NOTICE.md.',
    source,
    timeSelectors: sortKeys(timeSelectors),
    receivers: sortKeys(receivers),
    master: sortKeys(master),
    masterByParamsetId: sortKeys(byParamsetId),
};
const target = path.join(dataDir, 'extracted', 'easymode_controls.json.gz');
writeFileSync(target, gzipSync(`${JSON.stringify(out)}\n`, {level: 9}));
console.log(
    `${files} easymodes, ${profiles} profile forms, ${controls} controls, ${Object.keys(timeSelectors).length} time selector types; ` +
        `${Object.keys(master).length} MASTER forms, ${masterControls} controls; ` +
        `${Object.keys(byParamsetId).length} by paramset id, ${byIdControls} controls -> ${path.relative(process.cwd(), target)}`,
);
