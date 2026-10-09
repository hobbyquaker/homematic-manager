import fs from 'node:fs';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {afterEach, describe, expect, it} from 'vitest';

import afterPack, {
    checkApp,
    derivedUuid,
    formatUuid,
    giveIdentity,
    machOSlices,
    plistString,
    readUuids,
    rewriteUuids,
    USAGE_KEY,
} from './mac-identity.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const here = createRequire(import.meta.url);
const yaml = createRequire(createRequire(here.resolve('electron-builder')).resolve('app-builder-lib/package.json'))(
    'js-yaml',
);
const realConfig = () => yaml.load(fs.readFileSync(path.join(workspace, 'electron-builder.yml'), 'utf8'));

const CPU_X86_64 = 0x01000007;
const CPU_ARM64 = 0x0100000c;
/** Electron's own UUID in these fakes: what every Electron app of a version shares (#169). */
const STOCK = Buffer.from('4c4c44ef555531219c0c2b4d5e6f7a8b', 'hex');

/** A thin 64-bit Mach-O: header, an LC_SEGMENT_64 stand-in, LC_UUID, padding. */
function thin(cputype, uuid = STOCK) {
    const buffer = Buffer.alloc(256);
    buffer.writeUInt32LE(0xfeedfacf, 0);
    buffer.writeInt32LE(cputype, 4);
    buffer.writeUInt32LE(2, 12); // MH_EXECUTE
    buffer.writeUInt32LE(2, 16); // ncmds
    buffer.writeUInt32LE(16 + 24, 20); // sizeofcmds
    buffer.writeUInt32LE(0x19, 32); // LC_SEGMENT_64, kept short: only its size is read
    buffer.writeUInt32LE(16, 36);
    buffer.writeUInt32LE(0x1b, 48); // LC_UUID
    buffer.writeUInt32LE(24, 52);
    uuid.copy(buffer, 56);
    return buffer;
}

/** A universal binary of the two, as lipo lays it out (FAT_MAGIC, big-endian table). */
function fat(...images) {
    const align = 0x1000;
    const header = Buffer.alloc(align);
    header.writeUInt32BE(0xcafebabe, 0);
    header.writeUInt32BE(images.length, 4);
    const parts = [header];
    let offset = align;
    images.forEach((image, index) => {
        const at = 8 + index * 20;
        header.writeInt32BE(image.readInt32LE(4), at);
        header.writeUInt32BE(offset, at + 8);
        header.writeUInt32BE(image.length, at + 12);
        header.writeUInt32BE(12, at + 16);
        const padded = Buffer.alloc(align);
        image.copy(padded);
        parts.push(padded);
        offset += align;
    });
    return Buffer.concat(parts);
}

const temporary = [];
afterEach(() => {
    for (const dir of temporary.splice(0)) {
        fs.rmSync(dir, {recursive: true, force: true});
    }
});

function plist(entries) {
    const body = Object.entries(entries)
        .map(([key, value]) => `    <key>${key}</key>\n    <string>${value}</string>`)
        .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n  <dict>\n${body}\n  </dict>\n</plist>\n`;
}

/** An .app with one helper, laid out as electron-builder leaves it; `usage` false drops the key. */
function fakeApp({usage = true} = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmm-b91-'));
    temporary.push(dir);
    const app = path.join(dir, 'mac-universal', 'homematic-manager.app');
    const write = (bundle, id, executable, extra = {}) => {
        fs.mkdirSync(path.join(bundle, 'Contents', 'MacOS'), {recursive: true});
        fs.writeFileSync(
            path.join(bundle, 'Contents', 'Info.plist'),
            plist({CFBundleExecutable: executable, CFBundleIdentifier: id, ...extra}),
        );
        fs.writeFileSync(path.join(bundle, 'Contents', 'MacOS', executable), fat(thin(CPU_X86_64), thin(CPU_ARM64)));
    };
    write(app, 'de.hobbyquaker.homematic-manager', 'homematic-manager', usage ? {[USAGE_KEY]: 'connects'} : {});
    write(
        path.join(app, 'Contents', 'Frameworks', 'Homematic Manager Helper.app'),
        'de.hobbyquaker.homematic-manager.helper',
        'Homematic Manager Helper',
    );
    return {dir, app};
}

const build = {appId: 'de.hobbyquaker.homematic-manager', version: '3.1.4'};

describe('electron-builder.yml (B-91, #169)', () => {
    it('gives the macOS app a Local Network usage description, in English and German', () => {
        const config = realConfig();
        expect(config.mac.extendInfo[USAGE_KEY]).toMatch(/^Homematic Manager connects to your CCU .+ local network/);
        expect(config.mac.extraResources).toContainEqual({from: 'build/mac/de.lproj', to: 'de.lproj'});
        const strings = fs.readFileSync(path.join(workspace, 'build/mac/de.lproj/InfoPlist.strings'), 'utf8');
        expect(strings).toMatch(/^"NSLocalNetworkUsageDescription" = "Homematic Manager verbindet sich .+";$/m);
        // no Bonjour: the discovery is a UDP broadcast
        expect(config.mac.extendInfo.NSBonjourServices).toBeUndefined();
    });

    it('runs this hook after packing', () => {
        expect(realConfig().afterPack).toBe('./scripts/mac-identity.mjs');
    });
});

describe('the Mach-O UUIDs', () => {
    it('finds both images of a universal binary and the one of a thin one', () => {
        expect(machOSlices(fat(thin(CPU_X86_64), thin(CPU_ARM64))).map((slice) => slice.cputype)).toEqual([
            CPU_X86_64,
            CPU_ARM64,
        ]);
        expect(machOSlices(thin(CPU_ARM64))).toEqual([{offset: 0, size: 256, cputype: CPU_ARM64}]);
        expect(machOSlices(Buffer.from('#!/bin/sh\n'))).toEqual([]);
        expect(machOSlices(Buffer.alloc(3))).toEqual([]);
    });

    it('writes a UUID per image that depends on the seed and the CPU, and is stable', () => {
        const binary = fat(thin(CPU_X86_64), thin(CPU_ARM64));
        const first = rewriteUuids(binary, 'seed');
        expect(first.changed).toBe(true);
        expect(first.images.map((image) => image.before)).toEqual([formatUuid(STOCK), formatUuid(STOCK)]);
        const [x64, arm64] = first.images.map((image) => image.after);
        expect(x64).not.toBe(arm64);
        expect(readUuids(binary).map((image) => image.uuid)).toEqual([x64, arm64]);
        // the same build again: nothing to write
        expect(rewriteUuids(binary, 'seed')).toEqual({
            images: [
                {cputype: CPU_X86_64, before: x64, after: x64},
                {cputype: CPU_ARM64, before: arm64, after: arm64},
            ],
            changed: false,
        });
        // another version, another app: other UUIDs
        expect(rewriteUuids(binary, 'other').images[0].after).not.toBe(x64);
    });

    it('formats like dwarfdump and sets the RFC 9562 version and variant', () => {
        expect(formatUuid(STOCK)).toBe('4C4C44EF-5555-3121-9C0C-2B4D5E6F7A8B');
        const uuid = derivedUuid('seed', CPU_ARM64);
        expect(uuid[6] >> 4).toBe(8);
        expect(uuid[8] >> 6).toBe(2);
    });

    it('leaves an image without LC_UUID alone', () => {
        const binary = thin(CPU_ARM64);
        binary.writeUInt32LE(0x2, 48); // LC_SYMTAB instead
        expect(rewriteUuids(binary, 'seed')).toEqual({images: [], changed: false});
    });

    it('stops at a load command with a broken size', () => {
        const binary = thin(CPU_ARM64);
        binary.writeUInt32LE(0, 36);
        expect(readUuids(binary)).toEqual([]);
    });
});

describe('a built app', () => {
    it('reads a string from an XML property list', () => {
        expect(plistString(plist({[USAGE_KEY]: 'connects'}), USAGE_KEY)).toBe('connects');
        expect(plistString(plist({}), USAGE_KEY)).toBeUndefined();
    });

    it('gets its own UUIDs for the app and every helper, and then passes the check', () => {
        const {app} = fakeApp();
        expect(checkApp(app, build)).toEqual([
            `${path.join(app, 'Contents/MacOS/homematic-manager')}: 4C4C44EF-5555-3121-9C0C-2B4D5E6F7A8B, 4C4C44EF-5555-3121-9C0C-2B4D5E6F7A8B is not this build's UUID`,
            `${path.join(app, 'Contents/Frameworks/Homematic Manager Helper.app/Contents/MacOS/Homematic Manager Helper')}: 4C4C44EF-5555-3121-9C0C-2B4D5E6F7A8B, 4C4C44EF-5555-3121-9C0C-2B4D5E6F7A8B is not this build's UUID`,
        ]);
        const results = giveIdentity(app, build);
        expect(results.map((result) => result.changed)).toEqual([true, true]);
        const uuids = results.flatMap((result) => result.images.map((image) => image.after));
        expect(new Set(uuids).size).toBe(4);
        expect(checkApp(app, build)).toEqual([]);
        expect(checkApp(app, {...build, version: '3.1.5'})).toHaveLength(2);
    });

    it('fails the check without the usage description or with another bundle id', () => {
        const {app} = fakeApp({usage: false});
        giveIdentity(app, build);
        expect(checkApp(app, build)).toEqual([`${path.join(app, 'Contents', 'Info.plist')}: no ${USAGE_KEY}`]);
        expect(checkApp(app, {...build, appId: 'com.github.Electron'})).toContain(
            'CFBundleIdentifier is de.hobbyquaker.homematic-manager, not com.github.Electron',
        );
    });
});

describe('the afterPack hook', () => {
    const context = (appOutDir, electronPlatformName = 'darwin') => ({
        appOutDir,
        electronPlatformName,
        packager: {appInfo: {productFilename: 'homematic-manager', id: build.appId, version: build.version}},
    });

    it('does nothing for Windows and Linux, nor for the halves of a universal build', async () => {
        const {app} = fakeApp();
        const before = fs.readFileSync(path.join(app, 'Contents/MacOS/homematic-manager'));
        await afterPack(context(path.dirname(app), 'linux'));
        await afterPack(context(`${path.dirname(app)}-arm64-temp`));
        expect(fs.readFileSync(path.join(app, 'Contents/MacOS/homematic-manager')).equals(before)).toBe(true);
    });

    it.runIf(process.platform !== 'darwin')('off macOS leaves the files as they are: no codesign', async () => {
        const {app} = fakeApp();
        const before = fs.readFileSync(path.join(app, 'Contents/MacOS/homematic-manager'));
        await afterPack(context(path.dirname(app)));
        expect(fs.readFileSync(path.join(app, 'Contents/MacOS/homematic-manager')).equals(before)).toBe(true);
    });
});
