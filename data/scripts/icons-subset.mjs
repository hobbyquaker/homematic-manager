/**
 * D-10: device images are fetched from the connected CCU at runtime, but a Homegear or bare
 * rfd/hmipserver installation has no CCU to fetch them from. This script builds the small webp
 * subset that ships with the app for exactly that case.
 *
 * Source are the 2.7.1 images under `legacy/www/images/`, mapped through
 * `legacy/www/js/deviceImages.json`; only the BidCos-RF (`HM-*`) and BidCos-Wired (`HMW-*`) device
 * types are taken - HomematicIP devices need a CCU anyway, and the 250 px variants are for the
 * device detail view, which is not part of the fallback.
 *
 * The output is named after the file name in `dist/device-icons.json`, so the app resolves an icon
 * the same way for both sources: `deviceIcons[type]` with the extension swapped for `.webp`.
 *
 * Usage: node scripts/icons-subset.mjs [--height 50] [--quality 80]
 */
import {existsSync, mkdirSync, readFileSync, readdirSync, statSync} from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

import {distDir, legacyDir, removeDir} from './lib/paths.mjs';

const argument = (name, fallback) => {
    const index = process.argv.indexOf(`--${name}`);
    return index === -1 ? fallback : Number(process.argv[index + 1]);
};
const height = argument('height', 50);
const quality = argument('quality', 80);

const legacyImages = path.join(legacyDir, 'www', 'js', 'deviceImages.json');
if (!existsSync(legacyImages)) {
    console.error(`${legacyImages} is gone - the subset can only be rebuilt while legacy/ exists`);
    process.exit(1);
}

const deviceIcons = JSON.parse(readFileSync(path.join(distDir, 'device-icons.json'), 'utf8'));
/** @type {Record<string, string>} */
const images = JSON.parse(readFileSync(legacyImages, 'utf8'));

const stem = (file) =>
    path
        .basename(file)
        .replace(/\.[a-z]+$/iu, '')
        .replace(/_thum[bp]$/iu, '');

/** target webp name -> source png path */
const wanted = new Map();
const substitutions = [];
let withoutMapping = 0;

for (const [deviceType, relative] of Object.entries(images)) {
    const type = deviceType.toUpperCase();
    if (!type.startsWith('HM-') && !type.startsWith('HMW-')) continue;
    const source = path.join(legacyDir, 'www', relative);
    if (!existsSync(source)) continue;

    const upstream = deviceIcons[type];
    const target = upstream === undefined ? stem(relative) : stem(upstream);
    if (upstream === undefined) withoutMapping += 1;
    else if (stem(upstream) !== stem(relative)) substitutions.push(`${deviceType}: 2.x shows ${stem(relative)}`);
    if (!wanted.has(target)) wanted.set(target, source);
}

const iconsDir = path.join(distDir, 'icons');
removeDir(iconsDir);
mkdirSync(iconsDir, {recursive: true});
for (const [target, source] of [...wanted].sort(([a], [b]) => (a < b ? -1 : 1))) {
    await sharp(source)
        .resize({height, withoutEnlargement: true})
        .webp({quality, effort: 6})
        .toFile(path.join(iconsDir, `${target}.webp`));
}

const written = readdirSync(iconsDir);
const bytes = written.reduce((sum, file) => sum + statSync(path.join(iconsDir, file)).size, 0);
console.log(
    `dist/icons/: ${written.length} webp at ${height} px height, quality ${quality}, ` +
        `${(bytes / 1024).toFixed(0)} KiB total (${(bytes / written.length).toFixed(0)} B average)`,
);
if (withoutMapping > 0) console.log(`${withoutMapping} device type(s) have no entry in device-icons.json`);
if (substitutions.length > 0) {
    console.log(`${substitutions.length} device type(s) where 2.x used a different image than the CCU serves:`);
    for (const line of substitutions) console.log(`  ${line}`);
}
if (bytes > 3 * 1024 * 1024) {
    console.error('the subset is larger than 3 MB - rerun with --height 40 or --quality 75');
    process.exit(1);
}
