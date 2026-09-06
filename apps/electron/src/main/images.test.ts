/**
 * The image chain itself is tested once, in `packages/backend/src/images/deviceImages.test.ts`.
 * What belongs to this host is the `hmm-image://` protocol handler, the CSP the renderer is served
 * under, and the bridge from the service's log to the error log panel.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {DeviceImageService as fromBackend} from '@homematic-manager/backend';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {deviceImageUrl} from '../shared/ipc.js';

import {ccuImagePaths, DeviceImageService, imageLog, type DeviceImageServiceOptions} from './images.js';
import {createImageProtocolHandler, PRIVILEGED_SCHEMES, RENDERER_CSP} from './protocol.js';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

let root: string;
let cacheDir: string;
let bundledDir: string;

const iconMap = {'HmIP-BSM': '141_hmip-bsm.png', 'HM-LC-SW1-PL': '4_hm-lc-sw1-fm.png'};

const options = (overrides: Partial<DeviceImageServiceOptions> = {}): DeviceImageServiceOptions => ({
    cacheDir,
    fallbackDir: bundledDir,
    icons: () => Promise.resolve(iconMap),
    upstream: () => undefined,
    ...overrides,
});

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'hmm-images-'));
    cacheDir = path.join(root, 'images');
    bundledDir = path.join(root, 'icons');
    fs.mkdirSync(bundledDir, {recursive: true});
});

afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true});
});

describe('the device image service this host uses', () => {
    it('is the backend implementation, with the candidates task 13 measured', () => {
        expect(DeviceImageService).toBe(fromBackend);
        // the copy this host used to carry asked for `50/<file>` and nothing else, which exists
        // for none of the 278 file names of device-icons.json
        expect(ccuImagePaths('141_hmip-bsm.png')[0]).toBe('/config/img/devices/250/141_hmip-bsm.png');
    });
});

describe('imageLog', () => {
    it('forwards a warning to the error log and drops debug lines', () => {
        const lines: string[] = [];
        const log = imageLog((message) => lines.push(message));
        log.warn('http://ccu/x failed:', new Error('ECONNREFUSED'));
        log.debug('no image for device type X');
        expect(lines).toEqual(['http://ccu/x failed: ECONNREFUSED']);
    });

    it('formats what is neither a string nor an Error', () => {
        const lines: string[] = [];
        const log = imageLog((message) => lines.push(message));
        const circular: Record<string, unknown> = {};
        circular['self'] = circular;
        log.warn({code: 'ENOENT'}, circular);
        expect(lines[0]).toContain('{"code":"ENOENT"}');
        expect(lines[0]).toContain('[object Object]');
    });
});

describe('the hmm-image protocol handler', () => {
    it('answers with the image bytes and a content type', async () => {
        fs.mkdirSync(cacheDir, {recursive: true});
        fs.writeFileSync(path.join(cacheDir, 'HmIP-BSM.png'), PNG);
        const handle = createImageProtocolHandler(new DeviceImageService(options()));
        const response = await handle(new Request(deviceImageUrl('HmIP-BSM')));
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/png');
        expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);
    });

    it('answers 404 for a device type without an image', async () => {
        const handle = createImageProtocolHandler(new DeviceImageService(options()));
        expect((await handle(new Request(deviceImageUrl('HB-UNI-SENSOR')))).status).toBe(404);
    });

    it('answers 400 for a URL that is not a device image', async () => {
        const handle = createImageProtocolHandler(new DeviceImageService(options()));
        expect((await handle(new Request('hmm-image://other/thing'))).status).toBe(400);
    });

    it('round-trips a device type with characters that need escaping', async () => {
        fs.mkdirSync(cacheDir, {recursive: true});
        // the cache file name is the sanitised device type, so the slash never reaches the disk
        await fsp.writeFile(path.join(cacheDir, '263_149___263_150.png'), PNG);
        const handle = createImageProtocolHandler(
            new DeviceImageService(options({icons: () => Promise.resolve({'263_149_/_263_150': 'x.png'})})),
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
        // `fetch()` of the scheme is governed by `connect-src`, not by `img-src`. Without this the
        // scheme's own `supportFetchAPI` privilege is a lie, and the browser says no more than
        // "Failed to fetch" about it - which cost assertion 6 of the smoke test three runners.
        expect(RENDERER_CSP).toContain("connect-src 'self' hmm-image:");
    });

    it('is the policy the renderer page actually carries', () => {
        // The page has the policy inline, because it is loaded from a `file:` URL and there are no
        // response headers to put it in. Its own comment says this test fails when the two drift
        // apart, so here is the test that does.
        const html = fs.readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');
        const policy = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1];
        expect(policy).toBe(RENDERER_CSP);
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
