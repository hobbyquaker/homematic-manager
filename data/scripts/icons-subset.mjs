/**
 * The device pictures that ship with the app, `data/dist/icons/`: the CCU is asked first (D-10), and
 * these are what a box without `/config/img` shows - openccu-lite, Homegear, a bare rfd/hmipserver
 * installation - and what stands in when a CCU does not answer.
 *
 * D-51 (B-57): the CCU's 50 px list thumbnails for **every** file of `dist/device-icons.json`,
 * HomematicIP included. The source is the CCU's `www/config/img/devices` directory (openccu-base's,
 * or a CCU's `/www/config/img/devices` copied off the box), given with `--ccu`: `50/<stem>_thumb.png`
 * where it exists, otherwise the 250 px picture (`250/<file>` or `250/coupling/<file>`) scaled down.
 * The 2.7.1 images (`www/images/` of the tag 2.7.1, BidCos only) were the source before D-51 and the
 * fallback until `legacy/` was deleted after 3.0.0 (task 84); `--ccu` is required since.
 *
 * The output is named after the file name in `dist/device-icons.json`, so the app resolves an icon
 * the same way for both sources: `deviceIcons[type]` with the extension swapped for `.webp`.
 *
 * Usage: node scripts/icons-subset.mjs --ccu <path to config/img/devices> [--height 50] [--quality 80]
 */
import {existsSync, mkdirSync, readFileSync, readdirSync, statSync} from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

import {distDir, removeDir} from './lib/paths.mjs';

const argument = (name, fallback) => {
    const index = process.argv.indexOf(`--${name}`);
    return index === -1 ? fallback : Number(process.argv[index + 1]);
};
const height = argument('height', 50);
const quality = argument('quality', 80);
const ccuIndex = process.argv.indexOf('--ccu');
const ccuDir = ccuIndex === -1 ? '' : path.resolve(process.argv[ccuIndex + 1] ?? '');

if (!ccuDir) {
    console.error("give the CCU's pictures with --ccu <path to config/img/devices>");
    process.exit(1);
}
if (!existsSync(path.join(ccuDir, '50'))) {
    console.error(`${ccuDir}/50 does not exist - --ccu wants the directory that holds 50/ and 250/`);
    process.exit(1);
}

const deviceIcons = JSON.parse(readFileSync(path.join(distDir, 'device-icons.json'), 'utf8'));

const stem = (file) =>
    path
        .basename(file)
        .replace(/\.[a-z]+$/iu, '')
        .replace(/_thum[bp]$/iu, '');

/** target webp name -> source png path */
const wanted = new Map();
let fromThumb = 0;
let fromLarge = 0;
const missing = [];

// D-51: the CCU's pictures, one per file name of device-icons.json
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
console.log(`from the CCU: ${fromThumb} thumbnails, ${fromLarge} scaled down from 250 px`);
if (missing.length > 0) console.log(`no CCU picture for ${missing.length} file(s): ${missing.join(', ')}`);
if (bytes > 3 * 1024 * 1024) {
    console.error('the subset is larger than 3 MB - rerun with --height 40 or --quality 75');
    process.exit(1);
}
