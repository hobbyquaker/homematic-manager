import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {cacheFileName, CCU_IMAGE_PATH, ImageService, type ImageUpstream} from './images.js';

let root: string;
let cacheDir: string;

const ICONS = {
    'HM-LC-SW1-PL': 'OM55_DimmerSwitch.png',
    'HMIP-PDT': '134_hmip-pdt.png',
    DEVICE: 'unknown_device.png',
};

beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-images-'));
    cacheDir = path.join(root, 'cache');
    await fs.mkdir(path.join(root, 'icons'), {recursive: true});
    await fs.writeFile(path.join(root, 'device-icons.json'), JSON.stringify(ICONS));
    // the bundled webp subset knows the BidCos device, not the HmIP one and not "unknown"
    await fs.writeFile(path.join(root, 'icons', 'OM55_DimmerSwitch.webp'), 'BUNDLED');
});

afterEach(async () => {
    await fs.rm(root, {recursive: true, force: true});
});

function service(options: {
    fetch?: typeof globalThis.fetch;
    upstream?: ImageUpstream | undefined;
    iconMapFile?: string;
}): ImageService {
    return new ImageService({
        iconMapFile: options.iconMapFile ?? path.join(root, 'device-icons.json'),
        fallbackDir: path.join(root, 'icons'),
        cacheDir,
        upstream: () => options.upstream,
        ...(options.fetch ? {fetch: options.fetch} : {}),
    });
}

function okFetch(body: string): typeof globalThis.fetch {
    return vi.fn(async () => new Response(body, {status: 200})) as unknown as typeof globalThis.fetch;
}

describe('cacheFileName', () => {
    it('keeps the extension and cannot escape the cache directory', () => {
        expect(cacheFileName('HmIP-PDT', '134_hmip-pdt.png')).toBe('HmIP-PDT.png');
        expect(cacheFileName('263_149_/_263_150', 'a.png')).toBe('263_149___263_150.png');
        expect(cacheFileName('../../etc/passwd', 'a.webp')).toBe('.._.._etc_passwd.webp');
        expect(cacheFileName('X', 'no-extension')).toBe('X.png');
    });
});

describe('ImageService', () => {
    it('fetches from the CCU, caches it on disk and answers the next call from memory', async () => {
        const upstreamFetch = okFetch('FROM-CCU');
        const images = service({fetch: upstreamFetch, upstream: {host: 'ccu3'}});

        const first = await images.get('HmIP-PDT');
        expect(first).toMatchObject({source: 'ccu', mime: 'image/png'});
        expect(first?.body.toString()).toBe('FROM-CCU');
        expect(vi.mocked(upstreamFetch).mock.calls[0]?.[0]).toBe(`http://ccu3${CCU_IMAGE_PATH}/134_hmip-pdt.png`);

        expect(await images.get('HmIP-PDT')).toMatchObject({source: 'memory'});
        expect(vi.mocked(upstreamFetch)).toHaveBeenCalledTimes(1);

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
        const call = vi.mocked(upstreamFetch).mock.calls[0];
        expect(call?.[0]).toBe(`https://ccu3${CCU_IMAGE_PATH}/134_hmip-pdt.png`);
        expect((call?.[1]?.headers as Record<string, string>)['Authorization']).toBe(
            `Basic ${Buffer.from('admin:pw').toString('base64')}`,
        );
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
        const failing = vi.fn(async () => new Response('nope', {status: 404})) as unknown as typeof globalThis.fetch;
        expect(await service({fetch: failing, upstream: {host: 'ccu3'}}).get('HM-LC-Sw1-Pl')).toMatchObject({
            source: 'bundled',
        });

        const throwing = vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof globalThis.fetch;
        expect(await service({fetch: throwing, upstream: {host: 'ccu3'}}).get('HM-LC-Sw1-Pl')).toMatchObject({
            source: 'bundled',
        });
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
        await fs.writeFile(path.join(root, 'device-icons.json'), JSON.stringify({'HMIP-PDT': 'a.png'}));
        expect(await service({upstream: undefined}).get('NOPE')).toBeUndefined();
    });

    it('survives a mapping that is missing or not an object', async () => {
        expect(
            await service({upstream: undefined, iconMapFile: path.join(root, 'gone.json')}).get('X'),
        ).toBeUndefined();
        await fs.writeFile(path.join(root, 'device-icons.json'), '[]');
        const images = service({upstream: undefined});
        await expect(images.icons()).resolves.toEqual([]);
    });

    it('serves the picture even when the cache directory cannot be written', async () => {
        const images = new ImageService({
            iconMapFile: path.join(root, 'device-icons.json'),
            fallbackDir: path.join(root, 'icons'),
            // a file where a directory should be: mkdir fails, the request must not
            cacheDir: path.join(root, 'device-icons.json', 'cache'),
            upstream: () => ({host: 'ccu3'}),
            fetch: okFetch('FROM-CCU'),
        });
        expect(await images.get('HmIP-PDT')).toMatchObject({source: 'ccu'});
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
