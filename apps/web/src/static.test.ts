import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type {AddressInfo} from 'node:net';

import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import {
    etagOf,
    IMMUTABLE_CACHE_CONTROL,
    isImmutableAsset,
    isInside,
    mimeType,
    REVALIDATE_CACHE_CONTROL,
    resolveStaticFile,
    sendFile,
} from './static.js';

let root: string;
let outside: string;

beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-static-'));
    outside = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-outside-'));
    await fs.mkdir(path.join(root, 'assets'), {recursive: true});
    await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><title>UI</title>');
    await fs.writeFile(path.join(root, 'assets', 'app-C9tqDdX1.js'), 'export const a = 1;\n');
    await fs.writeFile(path.join(root, 'assets', 'logo.svg'), '<svg/>');
    await fs.writeFile(path.join(outside, 'secret.txt'), 'not yours');
    await fs.symlink(path.join(outside, 'secret.txt'), path.join(root, 'escape.txt'));
});

afterAll(async () => {
    await fs.rm(root, {recursive: true, force: true});
    await fs.rm(outside, {recursive: true, force: true});
});

describe('mimeType', () => {
    it('knows what the UI bundle and the metadata are made of', () => {
        expect(mimeType('index.html')).toBe('text/html; charset=utf-8');
        expect(mimeType('app.JS')).toBe('text/javascript; charset=utf-8');
        expect(mimeType('theme.css')).toContain('text/css');
        expect(mimeType('manifest.json')).toContain('application/json');
        expect(mimeType('icon.webp')).toBe('image/webp');
        expect(mimeType('logo.svg')).toBe('image/svg+xml');
        expect(mimeType('font.woff2')).toBe('font/woff2');
    });

    it('falls back to octet-stream for anything else', () => {
        expect(mimeType('archive.tar.gz')).toBe('application/octet-stream');
        expect(mimeType('LICENSE')).toBe('application/octet-stream');
    });
});

describe('isImmutableAsset', () => {
    it('recognises a vite hash and nothing else', () => {
        expect(isImmutableAsset('assets/index-C9tqDdX1.js')).toBe(true);
        expect(isImmutableAsset('assets/index-BFQ9gSIA.css')).toBe(true);
        expect(isImmutableAsset('index.html')).toBe(false);
        expect(isImmutableAsset('logo-v2.svg')).toBe(false);
    });
});

describe('isInside', () => {
    it('refuses the root itself and everything above it', () => {
        expect(isInside('/a/b', '/a/b/c')).toBe(true);
        expect(isInside('/a/b', '/a/b')).toBe(false);
        expect(isInside('/a/b', '/a/c')).toBe(false);
    });
});

describe('resolveStaticFile', () => {
    it('resolves a file inside the root', async () => {
        await expect(resolveStaticFile(root, 'index.html')).resolves.toBe(path.join(root, 'index.html'));
        await expect(resolveStaticFile(root, 'assets/logo.svg')).resolves.toBe(path.join(root, 'assets', 'logo.svg'));
    });

    it('refuses a traversal, however it is spelled', async () => {
        for (const attempt of ['../secret.txt', 'assets/../../secret.txt', '..%2Fsecret.txt', '/../secret.txt']) {
            await expect(resolveStaticFile(root, attempt), attempt).resolves.toBeUndefined();
        }
    });

    it('refuses a symlink that leaves the root', async () => {
        await expect(resolveStaticFile(root, 'escape.txt')).resolves.toBeUndefined();
    });

    it('refuses a NUL byte, an undecodable escape, an empty path and a directory', async () => {
        await expect(resolveStaticFile(root, 'index.html\0.png')).resolves.toBeUndefined();
        await expect(resolveStaticFile(root, '%E0%A4%A')).resolves.toBeUndefined();
        await expect(resolveStaticFile(root, '')).resolves.toBeUndefined();
        await expect(resolveStaticFile(root, './')).resolves.toBeUndefined();
        await expect(resolveStaticFile(root, 'assets')).resolves.toBeUndefined();
    });

    it('is undefined for a file that is not there', async () => {
        await expect(resolveStaticFile(root, 'nope.js')).resolves.toBeUndefined();
    });
});

describe('etagOf', () => {
    it('is a weak validator of size and mtime', () => {
        expect(etagOf(255, 16)).toBe('W/"ff-10"');
    });
});

describe('sendFile', () => {
    let server: http.Server;
    let base: string;

    beforeAll(async () => {
        server = http.createServer((request, response) => {
            const file = path.join(root, (request.url ?? '/').slice(1));
            void sendFile(response, file, {
                method: request.method,
                ifNoneMatch: request.headers['if-none-match'],
                ...(request.headers['x-extra'] === undefined ? {} : {headers: {'Set-Cookie': 'a=b'}}),
            });
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('sends the body, the type, a length and a revalidating cache header', async () => {
        const answer = await fetch(`${base}/index.html`);
        expect(answer.status).toBe(200);
        expect(answer.headers.get('content-type')).toBe('text/html; charset=utf-8');
        expect(answer.headers.get('cache-control')).toBe(REVALIDATE_CACHE_CONTROL);
        expect(answer.headers.get('content-length')).toBe('32');
        expect(await answer.text()).toContain('<title>UI</title>');
    });

    it('lets a hashed asset be cached forever', async () => {
        const answer = await fetch(`${base}/assets/app-C9tqDdX1.js`);
        expect(answer.headers.get('cache-control')).toBe(IMMUTABLE_CACHE_CONTROL);
    });

    it('answers a matching validator with 304 and no body', async () => {
        const first = await fetch(`${base}/index.html`);
        const etag = first.headers.get('etag') as string;
        await first.text();
        const second = await fetch(`${base}/index.html`, {headers: {'if-none-match': etag}});
        expect(second.status).toBe(304);
        expect(await second.text()).toBe('');
    });

    it('answers HEAD with the headers and no body', async () => {
        const answer = await fetch(`${base}/index.html`, {method: 'HEAD'});
        expect(answer.status).toBe(200);
        expect(answer.headers.get('content-length')).toBe('32');
        expect(await answer.text()).toBe('');
    });

    it('adds the extra headers it is given', async () => {
        const answer = await fetch(`${base}/index.html`, {headers: {'x-extra': '1'}});
        await answer.text();
        expect(answer.headers.get('set-cookie')).toBe('a=b');
    });
});
