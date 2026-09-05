/**
 * D-10: download the full device-image set from a CCU into a directory, for whoever wants a local
 * cache prepared up front (the app itself fetches and caches them lazily at runtime).
 *
 * This is a tool, not part of `npm run update`: it is never run by the pipeline, no CCU address is
 * committed anywhere, and the result is not part of `dist/`.
 *
 * The candidate URLs are `lib/ccu-images.mjs` - the same four the backend's image service walks.
 * Until task 15 this script asked the thumbnail directory `50/` for the plain file names, which
 * exist only in `250/`, so it saved nothing from a real CCU.
 *
 * Usage: node scripts/icons-from-ccu.mjs http://ccu <target directory>
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';

import {ccuImageUrls} from './lib/ccu-images.mjs';
import {distDir} from './lib/paths.mjs';

const [, , base, targetDirectory] = process.argv;
if (!base || !targetDirectory) {
    console.error('usage: node scripts/icons-from-ccu.mjs http://ccu <target directory>');
    process.exit(2);
}

const deviceIcons = JSON.parse(readFileSync(path.join(distDir, 'device-icons.json'), 'utf8'));
const files = [...new Set(Object.values(deviceIcons))].sort();
mkdirSync(targetDirectory, {recursive: true});

const root = base.replace(/\/+$/u, '');
let saved = 0;
const failed = [];

for (const file of files) {
    let stored = false;
    for (const url of ccuImageUrls(root, file)) {
        let response;
        try {
            response = await fetch(url);
        } catch (error) {
            failed.push(`${file}: ${String(error)}`);
            break;
        }
        if (!response.ok) continue;
        writeFileSync(path.join(targetDirectory, file), Buffer.from(await response.arrayBuffer()));
        saved += 1;
        stored = true;
        break;
    }
    if (!stored && !failed.some((entry) => entry.startsWith(`${file}:`))) failed.push(`${file}: not found`);
}

console.log(`${saved} of ${files.length} device images saved to ${targetDirectory}`);
if (failed.length > 0) {
    console.log(`${failed.length} not available on this CCU:`);
    for (const entry of failed) console.log(`  ${entry}`);
}
