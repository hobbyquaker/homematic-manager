/**
 * Download the pinned openccu-data artifacts listed in `sources.json` into `data/upstream/` and
 * verify their sha256. `data/upstream/` is git-ignored; the pin plus the hashes are what makes the
 * conversion reproducible.
 *
 * Usage:
 *   node scripts/fetch.mjs                    download (cached) and verify
 *   node scripts/fetch.mjs --update-hashes    record the hashes of what was downloaded (after a version bump)
 *   node scripts/fetch.mjs --force            re-download even when the cached file already matches
 */
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';

import {dataDir, readSources, sha256, upstreamDir, writeText} from './lib/paths.mjs';

const updateHashes = process.argv.includes('--update-hashes');
const force = process.argv.includes('--force');

const sources = readSources();
const source = sources.openccuData;
const entries = Object.entries(source.files);

console.log(`fetching ${entries.length} artifacts of ${source.name} ${source.version}`);

let downloaded = 0;
let cached = 0;
/** @type {string[]} */
const mismatches = [];

for (const [file, expected] of entries) {
    const target = path.join(upstreamDir, file);
    if (!force && existsSync(target)) {
        const actual = sha256(readFileSync(target));
        if (expected === null || actual === expected) {
            cached += 1;
            if (expected === null) source.files[file] = actual;
            continue;
        }
    }
    // encodeURI keeps `/` but escapes the parentheses of UNIVERSAL_LIGHT_RECEIVER_RGB(W).
    const url = source.baseUrl + encodeURI(file);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const body = Buffer.from(await response.arrayBuffer());
    const actual = sha256(body);
    if (expected !== null && actual !== expected && !updateHashes) {
        mismatches.push(`${file}\n    expected ${expected}\n    got      ${actual}`);
        continue;
    }
    mkdirSync(path.dirname(target), {recursive: true});
    writeFileSync(target, body);
    source.files[file] = actual;
    downloaded += 1;
}

if (mismatches.length > 0) {
    console.error(
        `\nsha256 mismatch for ${mismatches.length} artifact(s) - upstream changed under the pinned tag:\n  ` +
            mismatches.join('\n  ') +
            '\nRe-pin deliberately with `npm run fetch -- --update-hashes` and review the resulting dist/ diff.',
    );
    process.exit(1);
}

const missing = entries.filter(([, hash]) => hash === null).length;
if (updateHashes || missing > 0) {
    writeText(path.join(dataDir, 'sources.json'), JSON.stringify(sources, null, 2) + '\n');
    console.log('sources.json: sha256 recorded');
}

console.log(`done: ${downloaded} downloaded, ${cached} cached, all sha256 verified`);
