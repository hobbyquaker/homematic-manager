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

const out = path.join(dataDir, 'extracted', 'easymode_links.json');
await writeJson(out, sortKeys({source, pairs: sortKeys(pairs), dispatchers: sortKeys(dispatchers), hmip, bidcos}));
const count = (table) => Object.values(table).reduce((sum, inner) => sum + Object.keys(inner).length, 0);
console.log(
    `${path.relative(process.cwd(), out)}: ${count(pairs)} pairs, ${count(dispatchers)} dispatchers, ` +
        `${Object.keys(hmip).length} linkHmIP files, ${Object.keys(bidcos).length} BidCos link files`,
);
