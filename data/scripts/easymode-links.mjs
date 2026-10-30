/**
 * Task 108: extract from a WebUI easymode tree *which* profile file the CCU's WebUI opens for a
 * link, into `extracted/easymode_links.json`. The profiles themselves come from openccu-data (see
 * README.md); what decides between them lives only in the WebUI's Tcl:
 *
 * - `pairs`: every `<RECEIVER>/<SENDER>.tcl` that defines profiles, with the profile numbers it
 *   offers (its non-commented `set PROFILES_MAP(<n>)` lines).
 * - `dispatchers`: every `<RECEIVER>/<SENDER>.tcl` that defines none and sources another file by a
 *   value read at run time - `MULTI_MODE_INPUT_TRANSMITTER` by the sender's MASTER
 *   `CHANNEL_OPERATION_MODE`, `ROTARY_CONTROL_TRANSCEIVER` by the sender's channel number - with
 *   the folder it sources from and the device type that takes a variant (`_FDC`).
 * - `hmip`: per `linkHmIP_<RECEIVER_TYPE>.tcl` (the file `ic_setprofiles.cgi` opens for an HmIP
 *   receiver), whether it remaps the receiver type, whether it reads an HmIP-MOD-RC8 key channel's
 *   mode, and the `LEVEL_COMMAND_TRANSMITTER_*` senders it maps to another sender folder.
 * - `bidcos`: per `<paramid>.tcl` that is a link dispatcher (the file a BidCos receiver's LINK
 *   paramset id names), how it names the receiver folder (`HMW_` + type, type + `M`, `DIMMER`) and
 *   the sender file (`_<INPUT_TYPE>`, `_PAIR`, HM-WDS100-C6-O-2's `_2`).
 *
 * - `senders` (task 109): per `<paramid>.tcl` that draws a *sender's* form of its own (the file
 *   `ic_setprofiles.cgi` sources for the sender part of a link, by the sender's LINK paramset id):
 *   its profiles and presets, the threshold options, the device variant, the receiver it hides
 *   itself for, the receiver parameters it mirrors into, the percentage it shows; `weatherTexts`
 *   the de/en texts of the weather forms.
 *
 * `packages/core/src/easymodes/linkTypes.ts` implements these rules; its test reads this file and
 * fails for every rule or pair the core does not resolve. Like `easymode-controls.mjs` a tool, not
 * part of `npm run update`, and the output is committed.
 *
 * Usage: node scripts/easymode-links.mjs <easymodes directory> --source "<firmware and version>"
 */
import {readFileSync, readdirSync, statSync} from 'node:fs';
import path from 'node:path';

import {dataDir, sortKeys} from './lib/paths.mjs';
import {writeJson} from './lib/write-json.mjs';

const args = process.argv.slice(2);
const option = (name) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
};
const source = option('--source');
const root = args.find((arg, index) => !arg.startsWith('--') && !args[index - 1]?.startsWith('--'));
if (!root || !source) {
    console.error('usage: node scripts/easymode-links.mjs <easymodes directory> --source "<firmware and version>"');
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
/** Tcl without its comment lines, so that a commented-out profile or rule does not count. */
const code = (text) =>
    text
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .join('\n');

const NOT_RECEIVERS = new Set(['etc', 'js', 'hmip', 'MASTER_LANG']);

const pairs = {};
const dispatchers = {};
for (const receiver of readdirSync(root).sort()) {
    if (NOT_RECEIVERS.has(receiver) || !isDir(path.join(root, receiver))) continue;
    for (const file of readdirSync(path.join(root, receiver)).sort()) {
        if (!file.endsWith('.tcl')) continue;
        const sender = file.slice(0, -4);
        const text = code(read(path.join(root, receiver, file)));
        const profiles = [...text.matchAll(/^\s*set PROFILES_MAP\((\d+)\)/gmu)].map((match) => Number(match[1]));
        if (profiles.length > 0) {
            (pairs[receiver] ??= {})[sender] = [...new Set(profiles)].sort((a, b) => a - b);
            continue;
        }
        const sourced = [...text.matchAll(/config\/easymodes\/([^/\]]+)\/([A-Z_]+)_\$mode(\\_FDC)?\.tcl/gu)];
        if (sourced.length === 0) continue;
        const by = /CHANNEL_OPERATION_MODE/u.test(text)
            ? 'CHANNEL_OPERATION_MODE'
            : /split \$sender_address :\] 1\]/u.test(text)
              ? 'channel'
              : undefined;
        if (by === undefined) {
            console.warn(`${receiver}/${file}: sources by $mode, but reads neither the mode nor the channel`);
            continue;
        }
        const entry = {by, folder: sourced[0][1]};
        const variant = sourced.find((match) => match[3] !== undefined);
        if (variant) {
            const device = /PARENT_TYPE\) != "([^"]+)"\) \|\| \(\$mode != (\d+)\)/u.exec(text);
            if (!device) {
                console.warn(`${receiver}/${file}: an _FDC variant without the device test`);
                continue;
            }
            entry.variant = {deviceType: device[1], mode: Number(device[2]), suffix: '_FDC'};
        }
        (dispatchers[receiver] ??= {})[sender] = entry;
    }
}

const hmip = {};
const bidcos = {};
for (const file of readdirSync(root).sort()) {
    if (!file.endsWith('.tcl')) continue;
    const text = code(read(path.join(root, file)));
    const linkHmIP = /^linkHmIP_(.+)\.tcl$/u.exec(file);
    if (linkHmIP) {
        const levelCommand = {};
        for (const match of text.matchAll(
            /dev_descr_sender\(TYPE\) == "(LEVEL_COMMAND_TRANSMITTER_[A-Z0-9_]+)"\}\s*\{\s*set x "([A-Z0-9_]+)"/gu,
        )) {
            levelCommand[match[1]] = match[2];
        }
        hmip[linkHmIP[1]] = sortKeys({
            remapsReceiver: /set dev_descr_receiver\(TYPE\)|set ACTOR [A-Z"]/u.test(text),
            modRc8: text.includes('"HmIP-MOD-RC8"'),
            levelCommand,
        });
        continue;
    }
    if (!file.endsWith('_link.tcl') || !/config\/easymodes\/\$ACTOR\//u.test(text)) continue;
    const entry = {};
    if (/set ACTOR "HMW_"/u.test(text)) entry.receiver = 'HMW_';
    else if (/set mem "M"/u.test(text)) entry.receiver = 'M';
    else if (/^set ACTOR DIMMER\s*$/mu.test(text)) entry.receiver = 'DIMMER';
    if (/\$ACTOR == "VIRTUAL_DIMMER"/u.test(text)) entry.virtualDimmer = 'DIMMER';
    if (/INPUT_TYPE/u.test(text)) entry.inputType = true;
    if (/set pair "_PAIR"/u.test(text)) entry.pair = true;
    const suffix = /PARENT_TYPE\) == "([^"]+)"\}\s*\{\s*append dev_descr_sender\(TYPE\) "([^"]+)"/u.exec(text);
    if (suffix) entry.senderSuffix = {deviceType: suffix[1], suffix: suffix[2]};
    bidcos[file.slice(0, -4)] = sortKeys(entry);
}

// Task 109: the sender-side forms. `ic_setprofiles.cgi` sources `<sender paramid>.tcl` for the sender
// part of a link; a few BidCos sensors have a file of their own there, which draws its own form
// (`proc set_htmlParams`) from its own presets instead of sourcing a receiver folder's.
const senders = {};
for (const file of readdirSync(root).sort()) {
    if (!file.endsWith('_link.tcl')) continue;
    const text = code(read(path.join(root, file)));
    if (!/proc set_htmlParams/u.test(text) || /config\/easymodes\/\$ACTOR\//u.test(text)) continue;
    const variables = {};
    for (const match of text.matchAll(/^\s*set ([a-z]+) \{([^}]*)\}\s*$/gmu)) {
        variables[match[1]] = match[2].trim().split(/\s+/u).map(Number);
    }
    const profiles = {};
    for (const match of text.matchAll(/^\s*set PROFILES_MAP\((\d+)\)\s+"([^"]*)"/gmu)) {
        profiles[match[1]] = match[2].replace(/^\\\$\{(.+)\}$/u, '$1');
    }
    const presets = {};
    for (const match of text.matchAll(/^\s*set PROFILE_(\d+)\(([A-Z0-9_]+)\)\s+(.+?)\s*$/gmu)) {
        if (match[2].startsWith('UI_')) continue;
        const raw = match[3];
        const value = raw.startsWith('$') ? variables[raw.slice(1)] : /^\{(.*)\}$/u.test(raw) ? raw.slice(1, -1) : raw;
        (presets[match[1]] ??= {})[match[2]] = value;
    }
    // the option lists of the threshold selects: value -> label key, the default branch and the
    // values a device type puts in place of another
    const options = {};
    const variantOptions = {};
    const variant =
        /if \{ \[string first "([^"]+)" \$SENDER\] == 0 \} \{\s*set options\((\d+)\)\s+"\\\$\{([A-Za-z0-9]+)\}"\s*\} else \{\s*set options\((\d+)\)/u.exec(
            text,
        );
    for (const match of text.matchAll(/set options\((\d+)\)\s+"\\\$\{([A-Za-z0-9]+)\}"/gu)) {
        if (variant && match[1] === variant[2] && match[2] === variant[3]) continue;
        options[match[1]] = match[2];
    }
    if (variant) variantOptions[variant[1]] = {add: Number(variant[2]), remove: Number(variant[4])};
    const entry = {profiles, presets};
    if (Object.keys(options).length > 0) entry.options = options;
    if (variant) entry.variantOptions = variantOptions;
    const hidesFor = /if \{\$ACTOR != "([A-Z_]+)"\}/u.exec(text);
    if (hidesFor) entry.hiddenForReceiver = hidesFor[1];
    if (/getElementById\('sender_profiles'\)\.style\.display = 'none'/u.test(text)) entry.hidesProfileSelect = true;
    const mirror = /PARENT_TYPE\) == "([^"]+)"\}[\s\S]*?setActorConditions/u.exec(text);
    if (mirror) {
        entry.mirrors = {
            deviceType: mirror[1],
            STORM_LOWER_THRESHOLD: /expertCondLowElm\.val\(stormLowerThresholdElm/u.test(text)
                ? 'SHORT_COND_VALUE_LO'
                : '',
            STORM_UPPER_THRESHOLD: /expertCondHiElm\.val\(stormUpperThresholdElm/u.test(text)
                ? 'SHORT_COND_VALUE_HI'
                : '',
        };
    }
    if (/setThresholdActiv/u.test(text)) {
        // the fill level form: a percentage of the raw value (`100.0 / (200.0/$val)`), 255 = inactive
        const inactive = /if \{\$val == "(\d+)"\}/u.exec(text);
        entry.percentOf = {
            divisor: /100\.0 \/ \(200\.0\/\$val\)/u.test(text) ? 2 : 0,
            inactive: inactive ? Number(inactive[1]) : 0,
        };
    }
    senders[file.slice(0, -4)] = sortKeys(entry);
}

// the texts the weather forms use (`WEATHER/localization/lang.js`), de and en
const weatherTexts = {};
const weatherLang = path.join(root, 'WEATHER', 'localization', 'lang.js');
const decode = (value) =>
    value
        .replace(/&auml;/gu, 'ä')
        .replace(/&ouml;/gu, 'ö')
        .replace(/&uuml;/gu, 'ü')
        .replace(/&Auml;/gu, 'Ä')
        .replace(/&Ouml;/gu, 'Ö')
        .replace(/&Uuml;/gu, 'Ü')
        .replace(/&szlig;/gu, 'ß')
        .replace(/%([0-9A-F]{2})/gu, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .trim();
for (const block of read(weatherLang).matchAll(/"(de|en)"\s*:\s*\{([\s\S]*?)\n\s*\}/gu)) {
    for (const match of block[2].matchAll(/"([A-Za-z0-9]+)"\s*:\s*"([^"]*)"/gu)) {
        if (match[1] === 'dummyWeather') continue;
        (weatherTexts[match[1]] ??= {})[block[1]] = decode(match[2]);
    }
}

const out = path.join(dataDir, 'extracted', 'easymode_links.json');
await writeJson(
    out,
    sortKeys({
        source,
        pairs: sortKeys(pairs),
        dispatchers: sortKeys(dispatchers),
        hmip,
        bidcos,
        senders,
        weatherTexts: sortKeys(weatherTexts),
    }),
);
const count = (table) => Object.values(table).reduce((sum, inner) => sum + Object.keys(inner).length, 0);
console.log(
    `${path.relative(process.cwd(), out)}: ${count(pairs)} pairs, ${count(dispatchers)} dispatchers, ` +
        `${Object.keys(hmip).length} linkHmIP files, ${Object.keys(bidcos).length} BidCos link files, ` +
        `${Object.keys(senders).length} sender forms`,
);
