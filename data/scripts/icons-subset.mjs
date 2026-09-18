/**
 * The device pictures that ship with the app, `data/dist/icons/`: the CCU is asked first (D-10), and
 * these are what a box without `/config/img` shows - openccu-lite, Homegear, a bare rfd/hmipserver
 * installation - and what stands in when a CCU does not answer.
 *
 * D-51 (B-57): the CCU's 50 px list thumbnails for **every** file of `dist/device-icons.json`,
 * HomematicIP included. The source is the CCU's `www/config/img/devices` directory (openccu-base's,
 * or a CCU's `/www/config/img/devices` copied off the box), given with `--ccu`: `50/<stem>_thumb.png`
 * where it exists, otherwise the 250 px picture (`250/<file>` or `250/coupling/<file>`) scaled down.
 * Without `--ccu` the old source is used: the 2.7.1 images under `legacy/www/images/`, mapped
 * through `legacy/www/js/deviceImages.json`, BidCos only. With both, the legacy pictures fill in the
 * device types that have no entry in `device-icons.json`.
 *
 * The output is named after the file name in `dist/device-icons.json`, so the app resolves an icon
 * the same way for both sources: `deviceIcons[type]` with the extension swapped for `.webp`.
 *
 * Usage: node scripts/icons-subset.mjs [--ccu <path to config/img/devices>] [--height 50] [--quality 80]
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
const ccuIndex = process.argv.indexOf('--ccu');
const ccuDir = ccuIndex === -1 ? '' : path.resolve(process.argv[ccuIndex + 1] ?? '');

const legacyImages = path.join(legacyDir, 'www', 'js', 'deviceImages.json');
const haveLegacy = existsSync(legacyImages);
if (!ccuDir && !haveLegacy) {
    console.error(`${legacyImages} is gone - give the CCU's pictures with --ccu <path to config/img/devices>`);
    process.exit(1);
}
if (ccuDir && !existsSync(path.join(ccuDir, '50'))) {
    console.error(`${ccuDir}/50 does not exist - --ccu wants the directory that holds 50/ and 250/`);
    process.exit(1);
}

const deviceIcons = JSON.parse(readFileSync(path.join(distDir, 'device-icons.json'), 'utf8'));
/** @type {Record<string, string>} */
const images = haveLegacy ? JSON.parse(readFileSync(legacyImages, 'utf8')) : {};

const stem = (file) =>
    path
        .basename(file)
        .replace(/\.[a-z]+$/iu, '')
        .replace(/_thum[bp]$/iu, '');

/** target webp name -> source png path */
const wanted = new Map();
const substitutions = [];
let withoutMapping = 0;
let fromThumb = 0;
let fromLarge = 0;
const missing = [];

// D-51: the CCU's pictures first, one per file name of device-icons.json
if (ccuDir) {
    for (const file of [...new Set(Object.values(deviceIcons))].sort()) {
        const target = stem(file);
        const thumb = path.join(ccuDir, '50', `${target}_thumb.png`);
        const large = [path.join(ccuDir, '250', file), path.join(ccuDir, '250', 'coupling', file)].find((f) =>
            existsSync(f),
        );
        if (existsSync(thumb)) {
            wanted.set(target, thumb);
            fromThumb += 1;
        } else if (large) {
            wanted.set(target, large);
            fromLarge += 1;
        } else {
            missing.push(file);
        }
    }
}

for (const [deviceType, relative] of Object.entries(images)) {
    const type = deviceType.toUpperCase();
    if (!type.startsWith('HM-') && !type.startsWith('HMW-')) continue;
    // with the CCU's pictures, the legacy ones only fill in what those do not cover
    if (ccuDir && deviceIcons[type] !== undefined) continue;
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
if (ccuDir) {
    console.log(`from the CCU: ${fromThumb} thumbnails, ${fromLarge} scaled down from 250 px`);
    if (missing.length > 0) console.log(`no CCU picture for ${missing.length} file(s): ${missing.join(', ')}`);
}
if (substitutions.length > 0) {
    console.log(`${substitutions.length} device type(s) where 2.x used a different image than the CCU serves:`);
    for (const line of substitutions) console.log(`  ${line}`);
}
if (bytes > 3 * 1024 * 1024) {
    console.error('the subset is larger than 3 MB - rerun with --height 40 or --quality 75');
    process.exit(1);
}
