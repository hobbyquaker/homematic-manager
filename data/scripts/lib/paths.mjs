/**
 * Shared paths and small helpers for the data pipeline scripts.
 *
 * Everything here is plain ESM with JSDoc types: the pipeline runs with bare `node`, without a
 * TypeScript loader, so that `npm run update` works in a fresh checkout without a build step.
 */
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {readFileSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/** `data/` itself. */
export const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Repository root. */
export const repoDir = path.resolve(dataDir, '..');
/** Downloaded, git-ignored upstream artifacts. */
export const upstreamDir = path.join(dataDir, 'upstream');
/** The committed runtime format. */
export const distDir = path.join(dataDir, 'dist');
/** The 2.7.1 tree, reference only. */
export const legacyDir = path.join(repoDir, 'legacy');

/** @returns {{openccuData: {name: string, repository: string, version: string, license: string, baseUrl: string, files: Record<string, string|null>}}} */
export function readSources() {
    return JSON.parse(readFileSync(path.join(dataDir, 'sources.json'), 'utf8'));
}

/**
 * @param {string} file relative path inside `data/upstream/`
 * @returns {unknown} the parsed JSON, transparently gunzipped for `*.json.gz`
 */
export function readUpstreamJson(file) {
    const absolute = path.join(upstreamDir, file);
    let buffer;
    try {
        buffer = readFileSync(absolute);
    } catch {
        throw new Error(`missing upstream artifact ${file} - run \`npm run fetch\` in data/ first`);
    }
    return JSON.parse((file.endsWith('.gz') ? gunzipSync(buffer) : buffer).toString('utf8'));
}

/** @param {Buffer|Uint8Array|string} data */
export function sha256(data) {
    return createHash('sha256').update(data).digest('hex');
}

/**
 * Write a file, creating parent directories. Always LF, always a trailing newline.
 *
 * @param {string} absolute
 * @param {string} contents
 */
export function writeText(absolute, contents) {
    mkdirSync(path.dirname(absolute), {recursive: true});
    writeFileSync(absolute, contents.replace(/\r\n/gu, '\n'));
}

/** @param {string} absolute */
export function removeDir(absolute) {
    rmSync(absolute, {recursive: true, force: true});
}

/**
 * Sort an object by key so that the committed JSON has a stable, reviewable order.
 *
 * @template T
 * @param {Record<string, T>} object
 * @returns {Record<string, T>}
 */
export function sortKeys(object) {
    /** @type {Record<string, T>} */
    const sorted = {};
    for (const key of Object.keys(object).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
        sorted[key] = object[key];
    }
    return sorted;
}
