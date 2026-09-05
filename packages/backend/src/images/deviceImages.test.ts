/**
 * The device-image chain, once. Both host suites (`apps/web/src/images.test.ts` and
 * `apps/electron/src/main/images.test.ts`) used to assert this separately and disagreed about it:
 * the Electron copy asked `50/<file>` only, which task 13 measured to exist for none of the 278
 * file names. The behaviour lives here now; the hosts test their own wiring.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {
    cacheFileName,
    ccuImagePaths,
    ccuOrigin,
    DeviceImageService,
    imageMimeType,
    isSafeIconName,
    readIconMapFile,
    type DeviceImageLog,
    type DeviceImageServiceOptions,
    type ImageUpstream,
} from './deviceImages.js';

let root: string;
let cacheDir: string;
let warnings: string[];

const ICONS = {
    'HM-LC-SW1-PL': 'OM55_DimmerSwitch.png',
    'HMIP-PDT': '134_hmip-pdt.png',
    DEVICE: 'unknown_device.png',
};

const log: DeviceImageLog = {
    warn: (...parts: unknown[]) => warnings.push(parts.map(String).join(' ')),
    debug: () => undefined,
};

beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-images-'));
    cacheDir = path.join(root, 'cache');
    warnings = [];
    await fs.mkdir(path.join(root, 'icons'), {recursive: true});
    await fs.writeFile(path.join(root, 'device-icons.json'), JSON.stringify(ICONS));
    // the bundled webp subset knows the BidCos device, not the HmIP one and not "unknown"
    await fs.writeFile(path.join(root, 'icons', 'OM55_DimmerSwitch.webp'), 'BUNDLED');
});

afterEach(async () => {
    await fs.rm(root, {recursive: true, force: true});
});

/** A  the test can inspect; the service only ever needs url and init. */
type FetchMock = ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;

function service(options: {
    fetch?: FetchMock;
    upstream?: ImageUpstream | undefined;
    icons?: DeviceImageServiceOptions['icons'];
    cacheDir?: string;
}): DeviceImageService {
    return new DeviceImageService({
        icons: options.icons ?? (() => readIconMapFile(path.join(root, 'device-icons.json'), log)),
        fallbackDir: path.join(root, 'icons'),
        cacheDir: options.cacheDir ?? cacheDir,
        upstream: () => options.upstream,
        log,
        ...(options.fetch ? {fetch: options.fetch as unknown as typeof globalThis.fetch} : {}),
    });
}

function okFetch(body: string): FetchMock {
    return vi.fn(() => Promise.resolve(new Response(body, {status: 200})));
}

function answering(match: (url: string) => string | undefined): FetchMock {
    return vi.fn((url: string) => {
        const body = match(url);
        return Promise.resolve(body === undefined ? new Response('nope', {status: 404}) : new Response(body));
    });
}

describe('the small helpers', () => {
    it('keeps the extension and cannot escape the cache directory', () => {
        expect(cacheFileName('HmIP-PDT', '134_hmip-pdt.png')).toBe('HmIP-PDT.png');
        expect(cacheFileName('263_149_/_263_150', 'a.png')).toBe('263_149___263_150.png');
        expect(cacheFileName('../../etc/passwd', 'a.webp')).toBe('.._.._etc_passwd.webp');
        expect(cacheFileName('X', 'no-extension')).toBe('X.png');
    });

    it('maps the extensions the CCU and the subset use', () => {
        expect(imageMimeType('a.png')).toBe('image/png');
        expect(imageMimeType('a.WEBP')).toBe('image/webp');
        expect(imageMimeType('a.exe')).toBeUndefined();
    });

    it('accepts the real file names and refuses paths', () => {
        expect(isSafeIconName('107_hm-es-pmsw1-pl-R2.png')).toBe(true);
        expect(isSafeIconName('hm_resc-win-pcb-sc.png')).toBe(true);
        expect(isSafeIconName('../x.png')).toBe(false);
        expect(isSafeIconName('sub/dir.png')).toBe(false);
        expect(isSafeIconName('x.sh')).toBe(false);
        expect(isSafeIconName('')).toBe(false);
    });

    it('builds the CCU origin from host and tls', () => {
        expect(ccuOrigin({host: 'ccu'})).toBe('http://ccu');
        expect(ccuOrigin({host: 'ccu', tls: true})).toBe('https://ccu');
        expect(ccuOrigin({host: ''})).toBeUndefined();
        expect(ccuOrigin(undefined)).toBeUndefined();
    });
});

describe('ccuImagePaths', () => {
    // measured against the 278 file names of device-icons.json on the lab CCU (task 13): the two
    // `250` shapes cover all of them, `50/<base>_thumb<ext>` covers 254, and the `50/<file>` the
    // Electron host used to be limited to covers none - the `50` directory suffixes every name.
    it('asks for the 250 picture first and the _thumb of the 50 directory after it', () => {
        expect(ccuImagePaths('134_hmip-pdt.png')).toEqual([
            '/config/img/devices/250/134_hmip-pdt.png',
            '/config/img/devices/250/coupling/134_hmip-pdt.png',
            '/config/img/devices/50/134_hmip-pdt_thumb.png',
            '/config/img/devices/50/134_hmip-pdt.png',
        ]);
    });

    it('assumes .png for a mapping entry without an extension', () => {
        expect(ccuImagePaths('weird')).toContain('/config/img/devices/50/weird_thumb.png');
    });
});

describe('readIconMapFile', () => {
    it('reads the mapping and warns instead of throwing when it is not there', async () => {
        await expect(readIconMapFile(path.join(root, 'device-icons.json'), log)).resolves.toMatchObject(ICONS);
        await expect(readIconMapFile(path.join(root, 'gone.json'), log)).resolves.toEqual({});
        expect(warnings.join(' ')).toContain('device-icons.json is not readable');
    });

    it('is quiet without a logger and survives a file that is not an object', async () => {
        await fs.writeFile(path.join(root, 'broken.json'), '[]');
        await expect(readIconMapFile(path.join(root, 'broken.json'))).resolves.toEqual([]);
        await expect(readIconMapFile(path.join(root, 'nope.json'))).resolves.toEqual({});
    });
});

describe('DeviceImageService', () => {
    it('fetches from the CCU, caches it on disk and answers the next call from memory', async () => {
        const upstreamFetch = okFetch('FROM-CCU');
        const images = service({fetch: upstreamFetch, upstream: {host: 'ccu3'}});

        const first = await images.get('HmIP-PDT');
        expect(first).toMatchObject({source: 'ccu', mime: 'image/png'});
        expect(first?.body.toString()).toBe('FROM-CCU');
        expect(upstreamFetch.mock.calls[0]?.[0]).toBe('http://ccu3/config/img/devices/250/134_hmip-pdt.png');

        expect(await images.get('HmIP-PDT')).toMatchObject({source: 'memory'});
        expect(upstreamFetch).toHaveBeenCalledTimes(1);

        // a fresh service, same cache directory: the disk copy answers without any request
        const second = service({fetch: okFetch('OTHER'), upstream: {host: 'ccu3'}});
        expect(await second.get('HmIP-PDT')).toMatchObject({source: 'disk'});
        expect((await fs.readFile(path.join(cacheDir, 'HmIP-PDT.png'))).toString()).toBe('FROM-CCU');
    });

    it('uses https and basic auth when the connection asks for them', async () => {
        const upstreamFetch = okFetch('X');
        const images = service({
            fetch: upstreamFetch,
            upstream: {host: 'ccu3', tls: true, auth: {user: 'admin', password: 'pw'}},
        });
        await images.get('HmIP-PDT');
        const call = upstreamFetch.mock.calls[0];
        expect(call?.[0]).toBe('https://ccu3/config/img/devices/250/134_hmip-pdt.png');
        expect((call?.[1]?.headers as Record<string, string>)['Authorization']).toBe(
            `Basic ${Buffer.from('admin:pw').toString('base64')}`,
        );
    });

    it('tries the coupling subdirectory the CCU keeps eleven of them in', async () => {
        const upstreamFetch = answering((url) =>
            url.endsWith('/250/coupling/134_hmip-pdt.png') ? 'COUPLED' : undefined,
        );
        const image = await service({fetch: upstreamFetch, upstream: {host: 'ccu3'}}).get('HmIP-PDT');
        expect(image?.body.toString()).toBe('COUPLED');
    });

    it('takes the _thumb of the 50 directory when the 250 one is not there', async () => {
        const upstreamFetch = answering((url) => (url.endsWith('/50/134_hmip-pdt_thumb.png') ? 'THUMB' : undefined));
        const image = await service({fetch: upstreamFetch, upstream: {host: 'ccu3'}}).get('HmIP-PDT');
        expect(image).toMatchObject({source: 'ccu', mime: 'image/png'});
        expect(image?.body.toString()).toBe('THUMB');
    });

    it('falls back to the bundled webp when there is no CCU at all (D-2, D-10)', async () => {
        const images = service({upstream: undefined});
        const image = await images.get('HM-LC-Sw1-Pl');
        expect(image).toMatchObject({source: 'bundled', mime: 'image/webp'});
        expect(image?.body.toString()).toBe('BUNDLED');
        // the fallback is not written to the cache: a CCU that comes back has to be able to win
        await expect(fs.readdir(cacheDir)).rejects.toThrow();
    });

    it('falls back when the CCU answers with an error or refuses the connection', async () => {
        const failing = answering(() => undefined);
        expect(await service({fetch: failing, upstream: {host: 'ccu3'}}).get('HM-LC-Sw1-Pl')).toMatchObject({
            source: 'bundled',
        });
        // every candidate was tried before giving up on the file
        expect(failing).toHaveBeenCalledTimes(ccuImagePaths('x.png').length);

        const throwing: FetchMock = vi.fn(() => Promise.reject(new Error('ECONNREFUSED')));
        expect(await service({fetch: throwing, upstream: {host: 'ccu3'}}).get('HM-LC-Sw1-Pl')).toMatchObject({
            source: 'bundled',
        });
        // but a refused connection or a timeout says nothing about the file name: asking three more
        // times would only make the user wait four timeouts for the bundled picture
        expect(throwing).toHaveBeenCalledTimes(1);
        expect(warnings.join(' ')).toContain('ECONNREFUSED');
    });

    it('looks the device type up upper-cased, the way openccu-data keys it', async () => {
        const images = service({upstream: undefined});
        expect(await images.get('HM-LC-Sw1-Pl')).toMatchObject({source: 'bundled'});
        expect(await images.get('HM-LC-SW1-PL')).toMatchObject({source: 'bundled'});
    });

    it('is undefined when neither the CCU nor the bundle has anything', async () => {
        const images = service({upstream: undefined});
        // an unknown type falls back to DEVICE -> unknown_device.png, which the bundle does not have
        expect(await images.get('WHAT-IS-THIS')).toBeUndefined();
    });

    it('is undefined when the mapping has no entry and no DEVICE fallback', async () => {
        expect(
            await service({upstream: undefined, icons: () => Promise.resolve({'HMIP-PDT': 'a.png'})}).get('NOPE'),
        ).toBeUndefined();
    });

    it('refuses a file name from the map that would leave the cache directory', async () => {
        const images = service({icons: () => Promise.resolve({EVIL: '../../etc/passwd.png'}), upstream: {host: 'c'}});
        await expect(images.get('EVIL')).resolves.toBeUndefined();
    });

    it('reads the mapping once and survives one that rejects', async () => {
        let reads = 0;
        const images = service({
            upstream: undefined,
            icons: () => {
                reads += 1;
                return Promise.resolve(ICONS);
            },
        });
        await images.get('HM-LC-SW1-PL');
        await images.get('HMIP-PDT');
        expect(reads).toBe(1);

        const broken = service({upstream: undefined, icons: () => Promise.reject(new Error('ENOENT'))});
        await expect(broken.get('HM-LC-SW1-PL')).resolves.toBeUndefined();
        expect(warnings.join(' ')).toContain('device-icons.json could not be read');
    });

    it('serves the picture even when the cache directory cannot be written', async () => {
        // a file where a directory should be: mkdir fails, the request must not
        const images = service({
            cacheDir: path.join(root, 'device-icons.json', 'cache'),
            upstream: {host: 'ccu3'},
            fetch: okFetch('FROM-CCU'),
        });
        expect(await images.get('HmIP-PDT')).toMatchObject({source: 'ccu'});
        expect(warnings.join(' ')).toContain('could not be written');
    });

    it('asks the CCU once when a hundred rows want the same type', async () => {
        const upstreamFetch = okFetch('X');
        const images = service({fetch: upstreamFetch, upstream: {host: 'ccu3'}});
        const all = await Promise.all(Array.from({length: 100}, () => images.get('HmIP-PDT')));
        expect(upstreamFetch).toHaveBeenCalledTimes(1);
        expect(all.every((image) => image?.source === 'ccu')).toBe(true);
    });

    it('does not grow without bound', async () => {
        const images = service({fetch: okFetch('X'), upstream: {host: 'ccu3'}});
        for (let index = 0; index < 210; index += 1) {
            await images.get(`TYPE-${index}`);
        }
        // still answering, and the oldest entries were dropped rather than kept forever
        expect(await images.get('TYPE-209')).toMatchObject({source: 'memory'});
        expect(await images.get('TYPE-0')).toMatchObject({source: 'disk'});
    });
});
