/**
 * D-10: download the full device-image set from a CCU into a directory, for whoever wants a local
 * cache prepared up front (the app itself fetches and caches them lazily at runtime).
 *
 * This is a tool, not part of `npm run update`: it is never run by the pipeline, no CCU address is
 * committed anywhere, and the result is not part of `dist/`.
 *
 * Usage: node scripts/icons-from-ccu.mjs http://ccu <target directory> [--size 50]
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';

import {distDir} from './lib/paths.mjs';

const [, , base, targetDirectory] = process.argv;
if (!base || !targetDirectory) {
    console.error('usage: node scripts/icons-from-ccu.mjs http://ccu <target directory> [--size 50]');
    process.exit(2);
}
const sizeIndex = process.argv.indexOf('--size');
const size = sizeIndex === -1 ? 50 : Number(process.argv[sizeIndex + 1]);

const deviceIcons = JSON.parse(readFileSync(path.join(distDir, 'device-icons.json'), 'utf8'));
const files = [...new Set(Object.values(deviceIcons))].sort();
mkdirSync(targetDirectory, {recursive: true});

const root = base.replace(/\/+$/u, '');
let saved = 0;
const failed = [];

/** Ten upstream entries live in the CCU's `coupling/` subdirectory; device-icons.json has no path. */
const candidates = (file) => [
    `${root}/config/img/devices/${size}/${file}`,
    `${root}/config/img/devices/${size}/coupling/${file}`,
];

for (const file of files) {
    let stored = false;
    for (const url of candidates(file)) {
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
