/**
 * Reading the 2.7.1 easy-mode data under `legacy/www/easymodes/`.
 *
 * Two things are still needed from it:
 *   - the Turkish easy-mode localisation of 2015 (D-15), which openccu-data has no equivalent for,
 *   - de/en profile descriptions for the profiles openccu-data leaves without one.
 *
 * Layout:
 *   <RECEIVER_TYPE>/<SENDER_TYPE>.json          {"<profile id>": {name, params, options}}
 *   localization/<lang>/<RECEIVER_TYPE>.json    {"<SENDER_TYPE>": {"description_<id>": "..."}}
 *   localization/<lang>/GENERIC.json            generic UI labels and profile names
 *   localization/<lang>/PNAME.json              parameter names, keyed by the CCU parameter name
 */
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';

import {legacyDir} from './paths.mjs';

export const legacyEasymodesDir = path.join(legacyDir, 'www', 'easymodes');

const ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', szlig: 'ß'};

/**
 * The 2015 files are HTML fragments: `konfig&uuml;re`, `&ouml;`, `&szlig;`. Decode the named and
 * numeric entities so the runtime data is plain text (the few `<br/>` stay, they are markup).
 *
 * @param {string} text
 */
export function decodeEntities(text) {
    return text
        .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/&([a-z]+)(acute|grave|uml|circ|tilde|ring|cedil|slash);/giu, (whole, letter, mark) => {
            const map = {acute: '́', grave: '̀', uml: '̈', circ: '̂', tilde: '̃'};
            return mark in map ? (letter + map[mark]).normalize('NFC') : whole;
        })
        .replace(/&([a-z]+);/giu, (whole, name) => ENTITIES[name] ?? whole);
}

/** @param {string} file */
function readJson(file) {
    return JSON.parse(readFileSync(file, 'utf8'));
}

/** @returns {boolean} whether the legacy tree is present at all (it is deleted when 3.0 ships) */
export function hasLegacy() {
    return existsSync(legacyEasymodesDir);
}

/** @returns {string[]} the 28 receiver types the 2.x code shipped easy modes for */
export function legacyReceiverTypes() {
    if (!hasLegacy()) return [];
    return readdirSync(legacyEasymodesDir, {withFileTypes: true})
        .filter((entry) => entry.isDirectory() && entry.name !== 'localization')
        .map((entry) => entry.name)
        .sort();
}

/**
 * @param {string} receiverType
 * @returns {Record<string, Record<string, {name?: string, params?: Record<string, {val: string, readonly?: boolean}>, options?: Record<string, unknown>}>>}
 *   sender type -> profile id -> profile
 */
export function legacyProfiles(receiverType) {
    const dir = path.join(legacyEasymodesDir, receiverType);
    if (!existsSync(dir)) return {};
    /** @type {Record<string, Record<string, object>>} */
    const senders = {};
    for (const file of readdirSync(dir).sort()) {
        if (!file.endsWith('.json')) continue;
        senders[file.slice(0, -'.json'.length)] = readJson(path.join(dir, file));
    }
    return senders;
}

/**
 * @param {'de'|'en'|'tr'} language
 * @param {string} name file base name, e.g. `GENERIC`, `PNAME` or a receiver type
 * @returns {Record<string, unknown> | undefined}
 */
export function legacyLocalization(language, name) {
    const file = path.join(legacyEasymodesDir, 'localization', language, `${name}.json`);
    if (!existsSync(file)) return undefined;
    /** @type {Record<string, unknown>} */
    const raw = readJson(file);
    return decodeDeep(raw);
}

/** @param {unknown} value */
function decodeDeep(value) {
    if (typeof value === 'string') return decodeEntities(value);
    if (Array.isArray(value)) return value.map(decodeDeep);
    if (value && typeof value === 'object') {
        /** @type {Record<string, unknown>} */
        const out = {};
        for (const [key, inner] of Object.entries(value)) out[key] = decodeDeep(inner);
        return out;
    }
    return value;
}
