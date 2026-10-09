// B-91 (#169): give the macOS app an identity of its own for Local Network privacy.
//
// Since macOS 15 every connection into the local network needs the user's permission (Apple's
// TN3179, https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy).
// Without it the kernel refuses the connection and Node reports EHOSTUNREACH for every LAN
// address - #169's symptom, with no prompt and no entry under Privacy & Security -> Local Network.
// Two things decide whether macOS asks:
//
// - the usage description, `NSLocalNetworkUsageDescription` in Info.plist (electron-builder.yml's
//   `mac.extendInfo`), which the alert shows;
// - the identity: macOS records the decision by the code signature and looks the process up by its
//   main executable's LC_UUID ("Build-time considerations": a UUID shared with other programs makes
//   local network privacy "behave weirdly"). electron-builder renames Electron's prebuilt binary
//   without relinking it, so every Electron app of a version shares one UUID, and macOS can find
//   another app's record and never ask (electron-builder#9158, MQTT-Explorer#854, where the log
//   shows `found bundle id com.github.Electron by UUID`).
//
// This hook runs as electron-builder's `afterPack`, before signing. It writes a UUID of this app
// into every executable that is the main executable of a bundle - the app and its helper apps -
// derived from the bundle id, the version, the file and the CPU type, so a build is as
// reproducible as before and each release has UUIDs nobody else has. Writing into the load
// commands breaks the arm64 slice's ad-hoc linker signature, which Apple silicon refuses to run, so
// the hook then signs the whole app ad hoc (`codesign --force --deep --sign -`). With the Apple
// secrets, electron-builder's Developer ID signing comes after this hook and replaces that
// signature; without them (every release so far) the ad-hoc one is what ships, and it binds the
// Info.plist and the new UUIDs to the bundle, where 3.1.3 had no bundle signature at all.
//
// The universal build packs an x64 and an arm64 app first (`<out>-x64-temp`, `<out>-arm64-temp`) and
// calls this hook for each before merging them with lipo; those are left alone, so that the merge
// sees two apps exactly as electron-builder made them, and the hook does its work once, on the
// merged app. Off macOS there is no `codesign`: the hook leaves the files alone and says so, because
// a rewritten arm64 binary without a valid signature would not start.
//
// `node scripts/mac-identity.mjs check <dir|.app>` checks a built app: the usage description is in
// its Info.plist and every bundle executable carries the UUID this hook gives it. The release
// workflows run it after packaging on macOS.

import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const FAT_MAGIC = 0xcafebabe;
const FAT_MAGIC_64 = 0xcafebabf;
const MH_MAGIC_64 = 0xfeedfacf;
const MH_MAGIC = 0xfeedface;
const LC_UUID = 0x1b;

/** The Info.plist key the alert's text comes from. */
export const USAGE_KEY = 'NSLocalNetworkUsageDescription';

/** The thin Mach-O images in a file: `{offset, size, cputype}`; a thin file is one image at 0. */
export function machOSlices(buffer) {
    if (buffer.length < 8) {
        return [];
    }
    const magic = buffer.readUInt32BE(0);
    if (magic === FAT_MAGIC || magic === FAT_MAGIC_64) {
        const count = buffer.readUInt32BE(4);
        const wide = magic === FAT_MAGIC_64;
        const entry = wide ? 32 : 20;
        const slices = [];
        for (let index = 0; index < count; index += 1) {
            const at = 8 + index * entry;
            const cputype = buffer.readInt32BE(at);
            const offset = wide ? Number(buffer.readBigUInt64BE(at + 8)) : buffer.readUInt32BE(at + 8);
            const size = wide ? Number(buffer.readBigUInt64BE(at + 16)) : buffer.readUInt32BE(at + 16);
            slices.push({offset, size, cputype});
        }
        return slices;
    }
    const little = buffer.readUInt32LE(0);
    if (little === MH_MAGIC_64 || little === MH_MAGIC) {
        return [{offset: 0, size: buffer.length, cputype: buffer.readInt32LE(4)}];
    }
    return [];
}

/** Where the 16 UUID bytes of the image at `offset` are, or -1 when it has no LC_UUID. */
export function uuidOffset(buffer, offset) {
    const magic = buffer.readUInt32LE(offset);
    if (magic !== MH_MAGIC_64 && magic !== MH_MAGIC) {
        return -1;
    }
    const commands = buffer.readUInt32LE(offset + 16);
    let at = offset + (magic === MH_MAGIC_64 ? 32 : 28);
    for (let index = 0; index < commands; index += 1) {
        const command = buffer.readUInt32LE(at);
        const size = buffer.readUInt32LE(at + 4);
        if (command === LC_UUID) {
            return at + 8;
        }
        if (size < 8) {
            return -1;
        }
        at += size;
    }
    return -1;
}

/** The UUID as `dwarfdump --uuid` prints it. */
export function formatUuid(bytes) {
    const hex = Buffer.from(bytes).toString('hex').toUpperCase();
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A name-based UUID (RFC 9562 layout, version 8) from what identifies this file of this build. */
export function derivedUuid(seed, cputype) {
    const bytes = createHash('sha256').update(`${seed}\0${cputype}`).digest().subarray(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x80;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return Buffer.from(bytes);
}

/**
 * Writes this build's UUID into every image of `buffer` (in place) and returns what it found:
 * `{cputype, before, after}` per image that has an LC_UUID. `changed` says whether a byte moved.
 */
export function rewriteUuids(buffer, seed) {
    const images = [];
    let changed = false;
    for (const slice of machOSlices(buffer)) {
        const at = uuidOffset(buffer, slice.offset);
        if (at < 0) {
            continue;
        }
        const before = formatUuid(buffer.subarray(at, at + 16));
        const uuid = derivedUuid(seed, slice.cputype);
        if (!uuid.equals(buffer.subarray(at, at + 16))) {
            uuid.copy(buffer, at);
            changed = true;
        }
        images.push({cputype: slice.cputype, before, after: formatUuid(uuid)});
    }
    return {images, changed};
}

/** The UUIDs of every image in `buffer`, in slice order. */
export function readUuids(buffer) {
    return machOSlices(buffer)
        .map((slice) => ({slice, at: uuidOffset(buffer, slice.offset)}))
        .filter(({at}) => at >= 0)
        .map(({slice, at}) => ({cputype: slice.cputype, uuid: formatUuid(buffer.subarray(at, at + 16))}));
}

/** The value of a `<key>` that is followed by a `<string>` in an XML property list, or undefined. */
export function plistString(xml, key) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`<key>${escaped}</key>\\s*<string>([^<]*)</string>`).exec(xml);
    return match === null ? undefined : match[1];
}

/** `CFBundleExecutable` and `CFBundleIdentifier` of a bundle, from its XML Info.plist. */
function bundleInfo(bundle) {
    const xml = fs.readFileSync(path.join(bundle, 'Contents', 'Info.plist'), 'utf8');
    return {xml, executable: plistString(xml, 'CFBundleExecutable'), id: plistString(xml, 'CFBundleIdentifier')};
}

/** The app and its helper apps: every bundle whose main executable is ours to name. */
export function bundlesOf(app) {
    const frameworks = path.join(app, 'Contents', 'Frameworks');
    const helpers = fs.existsSync(frameworks)
        ? fs
              .readdirSync(frameworks)
              .filter((name) => name.endsWith('.app'))
              .sort()
              .map((name) => path.join(frameworks, name))
        : [];
    return [app, ...helpers];
}

/** The seed of one bundle's executable: app id, version, and the bundle's own id and file name. */
export function seedOf({appId, version, bundleId, executable}) {
    return `${appId}\0${version}\0${bundleId}\0${executable}`;
}

function findApp(dir) {
    if (dir.endsWith('.app')) {
        return dir;
    }
    const app = fs.readdirSync(dir).find((name) => name.endsWith('.app'));
    if (app === undefined) {
        throw new Error(`no .app in ${dir}`);
    }
    return path.join(dir, app);
}

/** What the hook did and does: per bundle executable, `{file, images, changed}`. */
export function giveIdentity(app, {appId, version, write = true}) {
    const results = [];
    for (const bundle of bundlesOf(app)) {
        const info = bundleInfo(bundle);
        if (info.executable === undefined) {
            continue;
        }
        const file = path.join(bundle, 'Contents', 'MacOS', info.executable);
        const buffer = fs.readFileSync(file);
        const result = rewriteUuids(
            buffer,
            seedOf({appId, version, bundleId: info.id ?? '', executable: info.executable}),
        );
        if (write && result.changed) {
            fs.writeFileSync(file, buffer);
        }
        results.push({file, ...result});
    }
    return results;
}

/** Problems of a built app, empty when it is right (the `check` command). */
export function checkApp(app, {appId, version}) {
    const problems = [];
    const {xml, id} = bundleInfo(app);
    const usage = plistString(xml, USAGE_KEY);
    if (usage === undefined || usage.trim() === '') {
        problems.push(`${path.join(app, 'Contents', 'Info.plist')}: no ${USAGE_KEY}`);
    }
    if (id !== appId) {
        problems.push(`CFBundleIdentifier is ${id}, not ${appId}`);
    }
    for (const {file, images, changed} of giveIdentity(app, {appId, version, write: false})) {
        if (images.length === 0) {
            problems.push(`${file}: no LC_UUID`);
        } else if (changed) {
            problems.push(`${file}: ${images.map((image) => image.before).join(', ')} is not this build's UUID`);
        }
    }
    return problems;
}

/** electron-builder's `afterPack` (see electron-builder.yml). */
export default async function afterPack(context) {
    if (context.electronPlatformName !== 'darwin' && context.electronPlatformName !== 'mas') {
        return;
    }
    if (context.appOutDir.endsWith('-temp')) {
        // one half of a universal build; the merged app comes back through this hook
        return;
    }
    const {appInfo} = context.packager;
    const app = path.join(context.appOutDir, `${appInfo.productFilename}.app`);
    if (process.platform !== 'darwin') {
        console.log(
            `  • B-91: not on macOS, no codesign to sign with: the executables keep Electron's UUID  app=${app}`,
        );
        return;
    }
    let changed = false;
    for (const result of giveIdentity(app, {appId: appInfo.id, version: appInfo.version})) {
        for (const image of result.images) {
            console.log(`  • B-91: LC_UUID ${image.before} -> ${image.after}  file=${path.relative(app, result.file)}`);
        }
        changed ||= result.changed;
    }
    if (changed) {
        // the arm64 slice's linker signature covered the load commands just written
        execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], {stdio: 'inherit'});
    }
}

function main(argv) {
    const [command, target] = argv;
    if (command !== 'check' || target === undefined) {
        console.error('usage: node scripts/mac-identity.mjs check <dist-electron/mac-*|*.app>');
        return 2;
    }
    const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const version = JSON.parse(fs.readFileSync(path.join(workspace, 'package.json'), 'utf8')).version;
    const config = fs.readFileSync(path.join(workspace, 'electron-builder.yml'), 'utf8');
    const appId = /^appId:\s*(\S+)\s*$/m.exec(config)?.[1];
    const app = findApp(path.resolve(target));
    const problems = checkApp(app, {appId, version});
    for (const problem of problems) {
        console.error(`B-91: ${problem}`);
    }
    if (problems.length === 0) {
        console.log(`B-91: ${app} has ${USAGE_KEY} and its own UUIDs`);
    }
    return problems.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = main(process.argv.slice(2));
}
