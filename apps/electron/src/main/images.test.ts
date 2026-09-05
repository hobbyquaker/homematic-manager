import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {deviceImageUrl} from '../shared/ipc.js';

import {
    ccuOrigin,
    DeviceImageCache,
    isSafeIconName,
    mimeOf,
    type DeviceImageCacheOptions,
    type ImageConnection,
} from './images.js';
import {createImageProtocolHandler, PRIVILEGED_SCHEMES, RENDERER_CSP} from './protocol.js';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const WEBP = Buffer.from('524946460000000057454250', 'hex');

let root: string;
let cacheDir: string;
let bundledDir: string;
let calls: Array<[string, RequestInit | undefined]>;
let answers: Map<string, {status: number; body: Buffer}>;
let errors: string[];
let connection: ImageConnection | undefined;

const iconMap = {'HmIP-BSM': '141_hmip-bsm.png', 'HM-LC-SW1-PL': '4_hm-lc-sw1-fm.png'};

const fakeFetch = ((url: string | URL | Request, init?: RequestInit) => {
    const key = String(url);
    calls.push([key, init]);
    const answer = answers.get(key);
    if (!answer) {
        return Promise.resolve(new Response('nope', {status: 404}));
    }
    return Promise.resolve(new Response(new Uint8Array(answer.body), {status: answer.status}));
}) as typeof globalThis.fetch;

const options = (overrides: Partial<DeviceImageCacheOptions> = {}): DeviceImageCacheOptions => ({
    cacheDir,
    bundledDir,
    iconMap: () => Promise.resolve(iconMap),
    connection: () => connection,
    fetch: fakeFetch,
    onError: (m) => errors.push(m),
    ...overrides,
});

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'hmm-images-'));
    cacheDir = path.join(root, 'images');
    bundledDir = path.join(root, 'icons');
    fs.mkdirSync(bundledDir, {recursive: true});
    calls = [];
    errors = [];
    answers = new Map();
    connection = {host: 'ccu.invalid'};
});

afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true});
});

describe('DeviceImageCache', () => {
    it('fetches from the CCU and stores the result in the cache', async () => {
        answers.set('http://ccu.invalid/config/img/devices/50/141_hmip-bsm.png', {status: 200, body: PNG});
        const cache = new DeviceImageCache(options());
        await expect(cache.get('HmIP-BSM')).resolves.toEqual({mime: 'image/png', body: PNG, source: 'ccu'});
        expect(fs.readFileSync(path.join(cacheDir, '141_hmip-bsm.png'))).toEqual(PNG);
    });

    it('serves the cache without asking the CCU again', async () => {
        fs.mkdirSync(cacheDir, {recursive: true});
        fs.writeFileSync(path.join(cacheDir, '141_hmip-bsm.png'), PNG);
        const cache = new DeviceImageCache(options());
        await expect(cache.get('HmIP-BSM')).resolves.toMatchObject({source: 'cache'});
        expect(calls).toEqual([]);
    });

    it('tries the coupling subdirectory the CCU keeps ten of them in', async () => {
        answers.set('http://ccu.invalid/config/img/devices/50/141_hmip-bsm.png', {status: 404, body: PNG});
        answers.set('http://ccu.invalid/config/img/devices/50/coupling/141_hmip-bsm.png', {status: 200, body: PNG});
        const cache = new DeviceImageCache(options());
        await expect(cache.get('HmIP-BSM')).resolves.toMatchObject({source: 'ccu'});
        expect(calls.map(([url]) => url)).toEqual([
            'http://ccu.invalid/config/img/devices/50/141_hmip-bsm.png',
            'http://ccu.invalid/config/img/devices/50/coupling/141_hmip-bsm.png',
        ]);
    });

    it('falls back to the bundled webp subset when the CCU has nothing', async () => {
        fs.writeFileSync(path.join(bundledDir, '141_hmip-bsm.webp'), WEBP);
        const cache = new DeviceImageCache(options());
        await expect(cache.get('HmIP-BSM')).resolves.toEqual({mime: 'image/webp', body: WEBP, source: 'bundled'});
    });

    it('falls back to the bundled subset when no CCU is configured at all', async () => {
        connection = undefined;
        fs.writeFileSync(path.join(bundledDir, '141_hmip-bsm.webp'), WEBP);
        const cache = new DeviceImageCache(options());
        await expect(cache.get('HmIP-BSM')).resolves.toMatchObject({source: 'bundled'});
        expect(calls).toEqual([]);
    });

    it('gives up quietly when nothing has the image', async () => {
        await expect(new DeviceImageCache(options()).get('HmIP-BSM')).resolves.toBeUndefined();
    });

    it('knows nothing about a device type that is not in the map', async () => {
        const cache = new DeviceImageCache(options());
        await expect(cache.get('HB-UNI-SENSOR')).resolves.toBeUndefined();
        expect(calls).toEqual([]);
    });

    it('matches an upper-case device type against the map', async () => {
        answers.set('http://ccu.invalid/config/img/devices/50/4_hm-lc-sw1-fm.png', {status: 200, body: PNG});
        await expect(new DeviceImageCache(options()).get('hm-lc-sw1-pl')).resolves.toMatchObject({source: 'ccu'});
    });

    it('sends basic auth when the connection has credentials', async () => {
        connection = {host: 'ccu.invalid', tls: true, auth: {user: 'admin', password: 'secret'}};
        answers.set('https://ccu.invalid/config/img/devices/50/141_hmip-bsm.png', {status: 200, body: PNG});
        await expect(new DeviceImageCache(options()).get('HmIP-BSM')).resolves.toMatchObject({source: 'ccu'});
        expect((calls[0]?.[1]?.headers as Record<string, string>)['authorization']).toBe(
            `Basic ${Buffer.from('admin:secret').toString('base64')}`,
        );
    });

    it('reports a network failure and does not throw at the caller', async () => {
        const cache = new DeviceImageCache(
            options({
                fetch: (() => Promise.reject(new Error('ECONNREFUSED'))) as typeof globalThis.fetch,
            }),
        );
        await expect(cache.get('HmIP-BSM')).resolves.toBeUndefined();
        expect(errors[0]).toContain('ECONNREFUSED');
    });

    it('reports a cache directory it cannot write to, and still serves the image', async () => {
        fs.writeFileSync(path.join(root, 'blocked'), 'not a directory');
        answers.set('http://ccu.invalid/config/img/devices/50/141_hmip-bsm.png', {status: 200, body: PNG});
        const cache = new DeviceImageCache(options({cacheDir: path.join(root, 'blocked', 'images')}));
        await expect(cache.get('HmIP-BSM')).resolves.toMatchObject({source: 'ccu'});
        expect(errors.join(' ')).toContain('could not be written');
    });

    it('asks the CCU once when a hundred rows want the same type', async () => {
        answers.set('http://ccu.invalid/config/img/devices/50/141_hmip-bsm.png', {status: 200, body: PNG});
        const cache = new DeviceImageCache(options());
        const all = await Promise.all(Array.from({length: 100}, () => cache.get('HmIP-BSM')));
        expect(calls).toHaveLength(1);
        expect(all.every((image) => image?.source === 'ccu')).toBe(true);
    });

    it('reads the icon map once and survives one that cannot be read', async () => {
        let reads = 0;
        const cache = new DeviceImageCache(
            options({
                iconMap: () => {
                    reads += 1;
                    return Promise.resolve(iconMap);
                },
            }),
        );
        await cache.get('HmIP-BSM');
        await cache.get('HM-LC-SW1-PL');
        expect(reads).toBe(1);

        const broken = new DeviceImageCache(options({iconMap: () => Promise.reject(new Error('ENOENT'))}));
        await expect(broken.get('HmIP-BSM')).resolves.toBeUndefined();
        expect(errors.join(' ')).toContain('device-icons.json could not be read');
    });

    it('refuses a file name from the map that would leave the cache directory', async () => {
        const cache = new DeviceImageCache(options({iconMap: () => Promise.resolve({EVIL: '../../etc/passwd.png'})}));
        await expect(cache.get('EVIL')).resolves.toBeUndefined();
    });
});

describe('the small helpers', () => {
    it('maps the extensions the CCU and the subset use', () => {
        expect(mimeOf('a.png')).toBe('image/png');
        expect(mimeOf('a.WEBP')).toBe('image/webp');
        expect(mimeOf('a.exe')).toBeUndefined();
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

describe('the hmm-image protocol handler', () => {
    it('answers with the image bytes and a content type', async () => {
        fs.mkdirSync(cacheDir, {recursive: true});
        fs.writeFileSync(path.join(cacheDir, '141_hmip-bsm.png'), PNG);
        const handle = createImageProtocolHandler(new DeviceImageCache(options()));
        const response = await handle(new Request(deviceImageUrl('HmIP-BSM')));
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/png');
        expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);
    });

    it('answers 404 for a device type without an image', async () => {
        const handle = createImageProtocolHandler(new DeviceImageCache(options()));
        expect((await handle(new Request(deviceImageUrl('HB-UNI-SENSOR')))).status).toBe(404);
    });

    it('answers 400 for a URL that is not a device image', async () => {
        const handle = createImageProtocolHandler(new DeviceImageCache(options()));
        expect((await handle(new Request('hmm-image://other/thing'))).status).toBe(400);
    });

    it('round-trips a device type with characters that need escaping', async () => {
        fs.mkdirSync(cacheDir, {recursive: true});
        await fsp.writeFile(path.join(cacheDir, 'x.png'), PNG);
        const handle = createImageProtocolHandler(
            new DeviceImageCache(options({iconMap: () => Promise.resolve({'263_149_/_263_150': 'x.png'})})),
        );
        const response = await handle(new Request(deviceImageUrl('263_149_/_263_150')));
        expect(response.status).toBe(200);
    });

    it('declares the scheme privileged, which has to happen before the app is ready', () => {
        expect(PRIVILEGED_SCHEMES[0].scheme).toBe('hmm-image');
        expect(PRIVILEGED_SCHEMES[0].privileges).toMatchObject({standard: true, secure: true});
    });
});

describe('the renderer CSP', () => {
    it('allows the bundle, the image scheme and nothing else', () => {
        expect(RENDERER_CSP).toContain("default-src 'self'");
        expect(RENDERER_CSP).toContain('img-src ');
        expect(RENDERER_CSP).toContain('hmm-image:');
        expect(RENDERER_CSP).toContain("object-src 'none'");
        expect(RENDERER_CSP).toContain("frame-ancestors 'none'");
    });

    it('never allows remote code or eval', () => {
        expect(RENDERER_CSP).not.toContain('unsafe-eval');
        expect(RENDERER_CSP).not.toContain('http:');
        expect(RENDERER_CSP.split('; ').find((part) => part.startsWith('script-src'))).toBe("script-src 'self'");
    });

    it('is the policy the renderer HTML actually carries', () => {
        const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
        expect(html).toContain(RENDERER_CSP);
    });
});
