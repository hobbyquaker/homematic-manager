import {randomBytes} from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import type {Socket} from 'node:net';

import type {ApiFrame} from '@homematic-manager/core';

import {proxyRequest, proxyUpgrade} from './proxy.js';
import {createWebHost, displayHost, normaliseBase, type WebHost, type WebHostOptions} from './server.js';

let uiDir: string;
let metadataDir: string;
let dataDir: string;
let temporary: string;
const hosts: WebHost[] = [];

const INDEX = '<!doctype html><title>Homematic Manager</title><div id="app"></div>';

beforeEach(async () => {
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-host-'));
    uiDir = path.join(temporary, 'ui');
    metadataDir = path.join(temporary, 'data');
    dataDir = path.join(temporary, 'profile');
    await fs.mkdir(path.join(uiDir, 'assets'), {recursive: true});
    await fs.mkdir(path.join(metadataDir, 'icons'), {recursive: true});
    await fs.writeFile(path.join(uiDir, 'index.html'), INDEX);
    await fs.writeFile(path.join(uiDir, 'assets', 'app-C9tqDdX1.js'), 'export const a = 1;\n');
    await fs.writeFile(path.join(metadataDir, 'manifest.json'), '{"generatedAt":"now"}');
    await fs.writeFile(
        path.join(metadataDir, 'device-icons.json'),
        JSON.stringify({'HM-LC-SW1-PL': 'OM55_DimmerSwitch.png', DEVICE: 'unknown_device.png'}),
    );
    await fs.writeFile(path.join(metadataDir, 'icons', 'OM55_DimmerSwitch.webp'), 'BUNDLED');
});

afterEach(async () => {
    for (const host of hosts.splice(0)) {
        await host.close();
    }
    await fs.rm(temporary, {recursive: true, force: true});
});

async function start(options: WebHostOptions = {}): Promise<WebHost> {
    const host = await createWebHost({
        port: 0,
        uiDir,
        metadataDir,
        dataDir,
        token: 'secret',
        ...options,
        backendOptions: {
            importLegacy: false,
            watchdogIntervalMs: 0,
            serviceMessagePollMs: 0,
            cacheWriteDelayMs: 0,
            rpcTimeoutMs: 500,
            localAddresses: () => ['127.0.0.1'],
            discover: () => Promise.resolve([]),
            // port 1 refuses at once, so a test that configures a CCU never waits for a timeout
            regaOptions: {port: 1, timeoutMs: 200},
            // D-40: the metadata detection is a probe against the configured host; no test wants
            // to wait three seconds for a host that drops packets
            metaOptions: {detectTimeoutMs: 50},
            interfaceManagerOptions: {portOverride: () => 1, watchdogIntervalMs: 0},
            ...options.backendOptions,
        },
    });
    hosts.push(host);
    return host;
}

/** Closes a helper server for good; an upgraded socket is not one `closeAllConnections()` reaches. */
function trackSockets(server: http.Server): () => Promise<void> {
    const sockets = new Set<Socket>();
    server.on('connection', (socket: Socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
    });
    return () =>
        new Promise<void>((resolve) => {
            server.close(() => resolve());
            for (const socket of sockets) {
                socket.destroy();
            }
        });
}

/** The status code of a raw WebSocket handshake on any port: 101 when it was let in, 401 when not. */
function rawHandshake(port: number, path: string, extra: Record<string, string>): Promise<number> {
    return new Promise((resolve, reject) => {
        const headers: Record<string, string> = {
            Connection: 'Upgrade',
            Upgrade: 'websocket',
            'Sec-WebSocket-Version': '13',
            'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
            ...extra,
        };
        const request = http.request({host: '127.0.0.1', port, path, headers});
        request.on('upgrade', (response, socket) => {
            socket.destroy();
            resolve(response.statusCode ?? 0);
        });
        request.on('response', (response) => {
            response.resume();
            resolve(response.statusCode ?? 0);
        });
        request.on('error', reject);
        request.end();
    });
}

/** The same against a `WebHost`, with its base path and the token forms the tests use. */
function handshake(
    host: WebHost,
    options: {path?: string; cookie?: string; protocol?: string; headers?: Record<string, string>} = {},
): Promise<number> {
    return rawHandshake(host.port, options.path ?? `${host.base}api`, {
        ...(options.cookie === undefined ? {} : {Cookie: options.cookie}),
        ...(options.protocol === undefined ? {} : {'Sec-WebSocket-Protocol': options.protocol}),
        ...options.headers,
    });
}

/** The backend of a host that has one; `!` would be flagged and a missing one is a test bug. */
function backendOf(host: WebHost): NonNullable<WebHost['backend']> {
    if (!host.backend) {
        throw new Error('this host has no backend');
    }
    return host.backend;
}

/** One request/response round trip over a real WebSocket, plus every frame that arrived. */
async function roundTrip(host: WebHost, frames: ApiFrame[]): Promise<ApiFrame[]> {
    const socket = new WebSocket(`ws://127.0.0.1:${host.port}${host.base}api?token=${host.token ?? ''}`);
    const received: ApiFrame[] = [];
    await new Promise<void>((resolve, reject) => {
        socket.onopen = (): void => resolve();
        socket.onerror = (): void => reject(new Error('the socket did not open'));
    });
    const wanted = frames.filter((frame) => frame.t === 'req').length;
    const done = new Promise<void>((resolve) => {
        socket.onmessage = (event): void => {
            received.push(JSON.parse(String(event.data)) as ApiFrame);
            if (received.filter((frame) => frame.t === 'res' || frame.t === 'err').length >= wanted) {
                resolve();
            }
        };
    });
    for (const frame of frames) {
        socket.send(JSON.stringify(frame));
    }
    await done;
    socket.close();
    return received;
}

describe('normaliseBase', () => {
    it('is a directory path, always', () => {
        expect(normaliseBase(undefined)).toBe('/');
        expect(normaliseBase('/')).toBe('/');
        expect(normaliseBase('')).toBe('/');
        expect(normaliseBase('addons/hmm')).toBe('/addons/hmm/');
        expect(normaliseBase('/addons/hmm')).toBe('/addons/hmm/');
        expect(normaliseBase('/addons/hmm/')).toBe('/addons/hmm/');
    });
});

describe('displayHost', () => {
    it('names something a browser can open', () => {
        expect(displayHost('0.0.0.0')).toBe('127.0.0.1');
        expect(displayHost('::')).toBe('127.0.0.1');
        expect(displayHost('')).toBe('127.0.0.1');
        expect(displayHost('127.0.0.1')).toBe('127.0.0.1');
        expect(displayHost('::1')).toBe('[::1]');
        expect(displayHost('[::1]')).toBe('[::1]');
    });
});

describe('the static UI', () => {
    it('serves index.html at the base and sets the token cookie there', async () => {
        const host = await start();
        const answer = await fetch(host.url);
        expect(answer.status).toBe(200);
        expect(answer.headers.get('content-type')).toBe('text/html; charset=utf-8');
        expect(answer.headers.get('set-cookie')).toBe('hmm_token=secret; Path=/; HttpOnly; SameSite=Strict');
        expect(await answer.text()).toContain('Homematic Manager');
    });

    it('serves a hashed asset as immutable and revalidates the rest', async () => {
        const host = await start();
        const asset = await fetch(`${host.url}assets/app-C9tqDdX1.js`);
        expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
        expect(asset.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
        expect(asset.headers.get('set-cookie')).toBeNull();
        await asset.text();
    });

    it('answers a second request with 304', async () => {
        const host = await start();
        const first = await fetch(host.url);
        await first.text();
        const second = await fetch(host.url, {headers: {'if-none-match': first.headers.get('etag') as string}});
        expect(second.status).toBe(304);
    });

    it('has no index fallback and no directory listing', async () => {
        const host = await start();
        expect((await fetch(`${host.url}nope`)).status).toBe(404);
        expect((await fetch(`${host.url}assets`)).status).toBe(404);
        expect((await fetch(`${host.url}assets/`)).status).toBe(404);
    });

    it('refuses a traversal out of the ui directory', async () => {
        const host = await start();
        await fs.writeFile(path.join(temporary, 'secret.txt'), 'no');
        for (const attempt of ['%2e%2e/secret.txt', '%2e%2e%2fsecret.txt', 'assets/%2e%2e/%2e%2e/secret.txt']) {
            expect((await fetch(`${host.url}${attempt}`)).status, attempt).toBe(404);
        }
    });

    it('answers anything but GET and HEAD with 405', async () => {
        const host = await start();
        const answer = await fetch(host.url, {method: 'POST'});
        expect(answer.status).toBe(405);
        expect(answer.headers.get('allow')).toBe('GET, HEAD');
    });

    it('answers a plain GET on the api path with 426', async () => {
        const host = await start();
        expect((await fetch(`${host.url}api`)).status).toBe(426);
        expect((await fetch(`${host.url}api/anything`)).status).toBe(426);
    });

    it('answers 500 when handling the request itself goes wrong', async () => {
        const host = await start();
        vi.spyOn(host.images, 'get').mockRejectedValue(new Error('disk on fire'));
        const answer = await fetch(`${host.url}images/HM-LC-Sw1-Pl`);
        expect(answer.status).toBe(500);
        expect(await answer.text()).toContain('internal error');
    });
});

describe('the metadata of task 9', () => {
    it('is served as plain files under <base>data/', async () => {
        const host = await start();
        const answer = await fetch(`${host.url}data/manifest.json`);
        expect(answer.status).toBe(200);
        expect(answer.headers.get('content-type')).toContain('application/json');
        expect(await answer.json()).toEqual({generatedAt: 'now'});
        expect((await fetch(`${host.url}data/nope.json`)).status).toBe(404);
    });

    it('is also readable through the backend, under the same root name', async () => {
        const host = await start();
        await expect(backendOf(host).request('data.file', 'data/manifest.json')).resolves.toEqual({
            generatedAt: 'now',
        });
    });
});

describe('the image proxy (D-10)', () => {
    it('serves the bundled webp when no CCU is configured', async () => {
        const host = await start();
        const answer = await fetch(`${host.url}images/HM-LC-Sw1-Pl`);
        expect(answer.status).toBe(200);
        expect(answer.headers.get('content-type')).toBe('image/webp');
        expect(answer.headers.get('x-hmm-image-source')).toBe('bundled');
        expect(await answer.text()).toBe('BUNDLED');
    });

    it('fetches from the configured CCU and caches it', async () => {
        const upstream = vi.fn<(url: string) => Promise<Response>>(() => Promise.resolve(new Response('FROM-CCU')));
        const host = await start({fetch: upstream as unknown as typeof globalThis.fetch});
        const config = await backendOf(host).request('config.get');
        // a host but no interface: the image proxy has its address and nothing tries to connect
        await backendOf(host).request('config.set', {
            ...config.connection,
            host: '127.0.0.1',
            interfaces: [],
            autoDetect: false,
        });

        const answer = await fetch(`${host.url}images/HM-LC-Sw1-Pl`);
        expect(answer.headers.get('x-hmm-image-source')).toBe('ccu');
        expect(await answer.text()).toBe('FROM-CCU');
        expect(upstream.mock.calls[0]?.[0]).toContain('http://127.0.0.1/config/img/devices/250/OM55_DimmerSwitch.png');
        expect(await fs.readdir(path.join(dataDir, 'images'))).toContain('HM-LC-Sw1-Pl.png');
    });

    it('is 404 for a type nothing knows and for an empty one', async () => {
        const host = await start();
        expect((await fetch(`${host.url}images/NOT-A-DEVICE`)).status).toBe(404);
        expect((await fetch(`${host.url}images/`)).status).toBe(404);
    });

    it('answers HEAD without a body', async () => {
        const host = await start();
        const answer = await fetch(`${host.url}images/HM-LC-Sw1-Pl`, {method: 'HEAD'});
        expect(answer.status).toBe(200);
        expect(await answer.text()).toBe('');
    });
});

describe('the token on the api socket', () => {
    it('refuses an upgrade without one and lets the query form in', async () => {
        const host = await start();
        await expect(handshake(host)).resolves.toBe(401);
        await expect(handshake(host, {path: '/api?token=secret'})).resolves.toBe(101);
        await expect(handshake(host, {path: '/api?token=wrong'})).resolves.toBe(401);
    });

    it('accepts the cookie the page load handed the browser', async () => {
        const host = await start();
        await expect(handshake(host, {cookie: 'hmm_token=secret'})).resolves.toBe(101);
        await expect(handshake(host, {cookie: 'other=1; hmm_token=secret'})).resolves.toBe(101);
        await expect(handshake(host, {cookie: 'hmm_token=wrong'})).resolves.toBe(401);
    });

    it('accepts the sub-protocol form the backend also understands', async () => {
        const host = await start();
        await expect(handshake(host, {protocol: 'secret'})).resolves.toBe(101);
    });

    it('generates a token when none is given', async () => {
        const host = await start({token: undefined});
        expect(host.token).toMatch(/^[0-9a-f]{32}$/);
        await expect(handshake(host)).resolves.toBe(401);
    });

    it('lets everyone in with auth off, and hands out no cookie', async () => {
        const host = await start({auth: false});
        expect(host.token).toBeUndefined();
        await expect(handshake(host)).resolves.toBe(101);
        const answer = await fetch(host.url);
        await answer.text();
        expect(answer.headers.get('set-cookie')).toBeNull();
    });

    it('hands out no cookie on a non-loopback bind, where a proxy has to issue it (task 13)', async () => {
        const host = await start({host: '0.0.0.0'});
        const answer = await fetch(`http://127.0.0.1:${host.port}/`);
        await answer.text();
        expect(answer.headers.get('set-cookie')).toBeNull();
        // a cookie someone else issued - the addon's session-checked CGI - is still accepted
        await expect(handshake(host, {cookie: 'hmm_token=secret'})).resolves.toBe(101);
        await expect(handshake(host)).resolves.toBe(401);
    });

    it('refuses an upgrade on any other path with a plain 404', async () => {
        const host = await start();
        await expect(handshake(host, {path: '/nope'})).resolves.toBe(404);
    });
});

describe('the ApiFrame round trip', () => {
    it('answers a request on the socket that asked it', async () => {
        const host = await start();
        const [answer] = await roundTrip(host, [{t: 'req', id: 1, m: 'config.get', p: []}]);
        expect(answer).toMatchObject({t: 'res', id: 1});
        expect((answer as unknown as {r: {connection: {host: string}}}).r.connection.host).toBe('');
    });

    it('answers a failing request with an error frame instead of closing the socket', async () => {
        const host = await start();
        const [answer] = await roundTrip(host, [{t: 'req', id: 7, m: 'rpc.call', p: ['BidCos-RF', 'listDevices', []]}]);
        expect(answer).toMatchObject({t: 'err', id: 7});
        expect((answer as unknown as {e: {kind: string}}).e.kind).toBeTypeOf('string');
    });

    it('pushes the events of the backend to the socket', async () => {
        const host = await start();
        const config = await backendOf(host).request('config.get');
        const frames = await roundTrip(host, [
            {t: 'req', id: 1, m: 'config.set', p: [{...config.connection, writePaceMs: 123}]},
        ]);
        expect(frames.some((frame) => frame.t === 'ev' && frame.n === 'config.changed')).toBe(true);
    });
});

describe('the base path (task 13 mounts this under /addons/hmm/)', () => {
    it('serves everything under the prefix and nothing outside it', async () => {
        const host = await start({base: '/addons/hmm'});
        expect(host.base).toBe('/addons/hmm/');
        expect(host.url).toContain('/addons/hmm/');

        const page = await fetch(host.url);
        expect(page.status).toBe(200);
        expect(page.headers.get('set-cookie')).toContain('Path=/addons/hmm/');
        await page.text();

        expect((await fetch(`${host.url}data/manifest.json`)).status).toBe(200);
        expect((await fetch(`http://127.0.0.1:${host.port}/`)).status).toBe(404);
        expect((await fetch(`http://127.0.0.1:${host.port}/assets/app-C9tqDdX1.js`)).status).toBe(404);
    });

    it('redirects the prefix without its trailing slash', async () => {
        const host = await start({base: '/addons/hmm'});
        const answer = await fetch(`http://127.0.0.1:${host.port}/addons/hmm?a=1`, {redirect: 'manual'});
        expect(answer.status).toBe(301);
        expect(answer.headers.get('location')).toBe('/addons/hmm/?a=1');
    });

    it('puts the api socket under the prefix too', async () => {
        const host = await start({base: '/addons/hmm'});
        await expect(handshake(host, {path: '/addons/hmm/api?token=secret'})).resolves.toBe(101);
        await expect(handshake(host, {path: '/api?token=secret'})).resolves.toBe(404);
    });

    it('does not care about the Origin and Host a reverse proxy forwards', async () => {
        const host = await start({base: '/addons/hmm'});
        await expect(
            handshake(host, {
                path: '/addons/hmm/api?token=secret',
                headers: {Origin: 'https://ccu3.local', Host: 'ccu3.local', 'X-Forwarded-For': '192.168.1.9'},
            }),
        ).resolves.toBe(101);
    });

    it('upgrades through a reverse proxy the way lighttpd will (task 13)', async () => {
        const host = await start({base: '/addons/hmm'});
        // the smallest thing that behaves like `proxy.header = ("upgrade" => "enable")`
        const proxy = http.createServer((request, response) => {
            proxyRequest({target: new URL(`http://127.0.0.1:${host.port}`)}, request, response);
        });
        proxy.on('upgrade', (request, socket, head) => {
            proxyUpgrade({target: new URL(`http://127.0.0.1:${host.port}`)}, request, socket, head);
        });
        const closeProxy = trackSockets(proxy);
        await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
        const proxyPort = (proxy.address() as {port: number}).port;
        try {
            const page = await fetch(`http://127.0.0.1:${proxyPort}/addons/hmm/`);
            expect(page.status).toBe(200);
            expect(await page.text()).toContain('Homematic Manager');

            const cookie = (page.headers.get('set-cookie') ?? '').split(';')[0] as string;
            expect(cookie).toBe('hmm_token=secret');
            // the browser replays the cookie the page set, through the proxy, on the upgrade
            await expect(
                rawHandshake(proxyPort, '/addons/hmm/api', {Cookie: cookie, Origin: 'http://ccu3.local'}),
            ).resolves.toBe(101);
            await expect(rawHandshake(proxyPort, '/addons/hmm/api', {})).resolves.toBe(401);
        } finally {
            await closeProxy();
        }
    });
});

describe('development mode', () => {
    it('proxies everything but the api to the vite dev server, upgrades included', async () => {
        const vite = http.createServer((_request, response) => {
            response.writeHead(200, {'Content-Type': 'text/html'});
            response.end('<h1>from vite</h1>');
        });
        vite.on('upgrade', (_request, socket) => {
            socket.write(
                ['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', '', ''].join('\r\n'),
            );
            socket.write('hmr');
        });
        const closeVite = trackSockets(vite);
        await new Promise<void>((resolve) => vite.listen(0, '127.0.0.1', resolve));
        const vitePort = (vite.address() as {port: number}).port;
        try {
            const host = await start({uiDevServer: `http://127.0.0.1:${vitePort}`});
            expect(await (await fetch(`${host.url}src/App.svelte`)).text()).toBe('<h1>from vite</h1>');
            // the api still belongs to the backend, and the token still guards it
            expect((await fetch(`${host.url}api`)).status).toBe(426);
            await expect(handshake(host, {path: '/api?token=secret'})).resolves.toBe(101);
            // anything else upgrades against vite - that is what hot reload rides on
            await expect(handshake(host, {path: '/'})).resolves.toBe(101);
        } finally {
            for (const host of hosts.splice(0)) {
                await host.close();
            }
            await closeVite();
        }
    });
});

describe('demo mode', () => {
    it('starts no backend and sends the page to the UI fixture', async () => {
        const host = await start({demo: true});
        expect(host.backend).toBeUndefined();
        expect(host.api).toBeUndefined();

        const redirect = await fetch(host.url, {redirect: 'manual'});
        expect(redirect.status).toBe(302);
        expect(redirect.headers.get('location')).toBe('/?demo');

        const page = await fetch(`${host.url}?demo`);
        expect(page.status).toBe(200);
        expect(await page.text()).toContain('Homematic Manager');
    });

    it('refuses the api upgrade, because there is nothing behind it', async () => {
        const host = await start({demo: true});
        await expect(handshake(host)).resolves.toBe(404);
    });

    it('writes nothing into a profile directory', async () => {
        const host = await start({demo: true});
        expect(host.token).toBeDefined();
        await expect(fs.readdir(dataDir)).rejects.toThrow();
    });
});

describe('the connection options', () => {
    it('writes --ccu and --local into the configuration on the first start', async () => {
        // 127.0.0.1 with no interface: the option is written, nothing tries to reach a CCU
        const host = await start({ccu: '127.0.0.1', local: true, backendOptions: {rpcTimeoutMs: 500}});
        const config = await backendOf(host).request('config.get');
        expect(config.connection.host).toBe('127.0.0.1');
        expect(config.connection.local).toBe(true);
    });

    it('writes the callback address and ports a container behind NAT needs', async () => {
        // a bridge-networked container sees 172.17.0.2 and would announce that in `init`
        const host = await start({
            callbackIp: '192.168.1.10',
            callbackXmlrpcPort: 2126,
            callbackBinrpcPort: 2127,
            backendOptions: {rpcTimeoutMs: 500},
        });
        const config = await backendOf(host).request('config.get');
        expect(config.connection.callback).toEqual({ip: '192.168.1.10', xmlrpcPort: 2126, binrpcPort: 2127});
    });

    it('leaves the configuration alone when neither is given', async () => {
        const first = await start();
        const before = await backendOf(first).request('config.get');
        await first.close();
        const second = await start();
        const after = await backendOf(second).request('config.get');
        expect(after.connection).toEqual(before.connection);
    });
});

describe('the keepalive that a reverse proxy needs (task 13)', () => {
    it('pings an idle socket so lighttpd does not cut it', async () => {
        const host = await start({keepAliveMs: 20});
        const socket = new WebSocket(`ws://127.0.0.1:${host.port}/api?token=secret`);
        await new Promise<void>((resolve, reject) => {
            socket.onopen = (): void => resolve();
            socket.onerror = (): void => reject(new Error('the socket did not open'));
        });
        // the browser answers a ping with a pong on its own; the proof it survives is that a
        // request still works after several ping intervals have gone by with no other traffic
        await new Promise((resolve) => setTimeout(resolve, 120));
        const answered = await new Promise<boolean>((resolve) => {
            socket.onmessage = (event): void => resolve(String(event.data).includes('"t":"res"'));
            socket.send(JSON.stringify({t: 'req', id: 1, m: 'config.get', p: []}));
        });
        expect(answered).toBe(true);
        socket.close();
    });

    it('can be turned off', async () => {
        const host = await start({keepAliveMs: 0});
        await expect(handshake(host, {path: '/api?token=secret'})).resolves.toBe(101);
    });
});

describe('the ReGa login (D-32)', () => {
    /** A CCU with one user; the real one asks ReGa and the udp daemon, this one asks nobody. */
    const fakeCcu = {
        calls: [] as Array<{user: string; password: string}>,
        fail: false,
        authenticate(user: string, password: string): Promise<{name: string; level: number} | undefined> {
            fakeCcu.calls.push({user, password});
            if (fakeCcu.fail) {
                return Promise.reject(new Error('rega is not answering'));
            }
            return Promise.resolve(user === 'Admin' && password === 'secret' ? {name: 'Admin', level: 8} : undefined);
        },
    };

    beforeEach(() => {
        fakeCcu.calls.length = 0;
        fakeCcu.fail = false;
    });

    /** A host in `rega` mode. `local` is required, so every one of these sets it. */
    function login(options: WebHostOptions = {}): Promise<WebHost> {
        return start({authMode: 'rega', local: true, authenticator: fakeCcu, ...options});
    }

    /** Posts the form the login page carries. */
    function post(host: WebHost, body: string, headers: Record<string, string> = {}): Promise<Response> {
        return fetch(`${host.url}login`, {
            method: 'POST',
            redirect: 'manual',
            headers: {'Content-Type': 'application/x-www-form-urlencoded', ...headers},
            body,
        });
    }

    /** The `hmm_session` cookie out of a `Set-Cookie` header. */
    function sessionCookieOf(answer: Response): string {
        const header = answer.headers.get('set-cookie') ?? '';
        const value = /hmm_session=([^;]+)/.exec(header)?.[1];
        expect(value, `no session cookie in ${header}`).toBeTruthy();
        return `hmm_session=${value ?? ''}`;
    }

    it('is off by default: the UI is served without any login', async () => {
        const host = await start();
        expect(host.authMode).toBe('token');
        expect(host.sessions).toBeUndefined();
        expect((await fetch(host.url)).status).toBe(200);
        expect(await (await fetch(host.url)).text()).toContain('<div id="app">');
    });

    it('serves the login page instead of the UI, and a 401 for everything else', async () => {
        const host = await login();
        const page = await fetch(host.url);
        expect(page.status).toBe(200);
        const body = await page.text();
        // No `Accept-Language` on this request, so English - D-36's fallback, not German.
        expect(body).toContain('User name');
        expect(body).toContain(`action="${host.base}login"`);
        expect(body).not.toContain('<div id="app">');
        expect(page.headers.get('cache-control')).toBe('no-store');
        // the assets and the metadata are not the page: a login form in place of a stylesheet
        // only confuses a browser
        expect((await fetch(`${host.url}assets/app-C9tqDdX1.js`)).status).toBe(401);
        expect((await fetch(`${host.url}data/manifest.json`)).status).toBe(401);
    });

    it('refuses to start off the CCU, and says why', async () => {
        await expect(start({authMode: 'rega'})).rejects.toThrow('--auth-mode rega needs --local');
        await expect(start({authMode: 'rega', local: false})).rejects.toThrow('loopback');
        // and it guards nothing without a token, so that combination is refused too
        await expect(start({authMode: 'rega', local: true, auth: false})).rejects.toThrow('--no-auth');
    });

    it('hands out a session cookie for the right credentials and lets the browser in', async () => {
        const host = await login();
        const answer = await post(host, 'user=Admin&password=secret');
        expect(answer.status).toBe(302);
        expect(answer.headers.get('location')).toBe(host.base);
        const cookie = sessionCookieOf(answer);
        const header = answer.headers.get('set-cookie') ?? '';
        expect(header).toContain('Path=/');
        expect(header).toContain('HttpOnly');
        expect(header).toContain('SameSite=Strict');
        expect(header).toContain('Max-Age=86400');
        // no Secure over plain http - the CCU is usually reached over http, and the browser would
        // simply never send the cookie back
        expect(header).not.toContain('Secure');

        const ui = await fetch(host.url, {headers: {Cookie: cookie}});
        expect(await ui.text()).toContain('<div id="app">');
        expect((await fetch(`${host.url}data/manifest.json`, {headers: {Cookie: cookie}})).status).toBe(200);
    });

    it('answers a wrong password and an unknown user identically', async () => {
        const host = await login();
        const wrong = await post(host, 'user=Admin&password=nope');
        const unknown = await post(host, 'user=Nobody&password=secret');
        expect(wrong.status).toBe(401);
        expect(unknown.status).toBe(401);
        const wrongBody = await wrong.text();
        const unknownBody = await unknown.text();
        expect(wrongBody).toContain('data-error="credentials"');
        // the two pages differ only in the user name that is put back into the form
        expect(wrongBody.replace('Admin', 'X')).toBe(unknownBody.replace('Nobody', 'X'));
        expect(wrong.headers.get('set-cookie')).toBeNull();
    });

    it('stops after five failures from one source and refuses the sixth without asking the CCU', async () => {
        const host = await login();
        for (let attempt = 0; attempt < 5; attempt += 1) {
            expect((await post(host, 'user=Admin&password=nope')).status).toBe(401);
        }
        expect(fakeCcu.calls).toHaveLength(5);
        const blocked = await post(host, 'user=Admin&password=secret');
        expect(blocked.status).toBe(429);
        expect(await blocked.text()).toContain('data-error="rate-limited"');
        // the right password was never even tried: the CCU was not asked a sixth time
        expect(fakeCcu.calls).toHaveLength(5);
    });

    it('says so when the CCU cannot be asked at all', async () => {
        const host = await login();
        fakeCcu.fail = true;
        const answer = await post(host, 'user=Admin&password=secret');
        expect(answer.status).toBe(401);
        expect(await answer.text()).toContain('data-error="unavailable"');
    });

    it('opens the api socket with the session cookie, exactly like the token cookie', async () => {
        const host = await login();
        const cookie = sessionCookieOf(await post(host, 'user=Admin&password=secret'));
        await expect(handshake(host, {cookie})).resolves.toBe(101);
        await expect(handshake(host, {cookie: 'hmm_session=forged'})).resolves.toBe(401);
        await expect(handshake(host)).resolves.toBe(401);
        await expect(handshake(host, {cookie: `hmm_token=${host.token ?? ''}`})).resolves.toBe(101);
    });

    it('answers session.info on that socket with the user and the level', async () => {
        const host = await login();
        const cookie = sessionCookieOf(await post(host, 'user=Admin&password=secret'));
        const socket = new WebSocket(`ws://127.0.0.1:${host.port}${host.base}api`, {
            headers: {Cookie: cookie},
        } as unknown as string[]);
        await new Promise<void>((resolve, reject) => {
            socket.onopen = (): void => resolve();
            socket.onerror = (): void => reject(new Error('the socket did not open'));
        });
        const answer = await new Promise<ApiFrame>((resolve) => {
            socket.onmessage = (event): void => resolve(JSON.parse(String(event.data)) as ApiFrame);
            socket.send(JSON.stringify({t: 'req', id: 1, m: 'session.info', p: []}));
        });
        expect(answer).toEqual({t: 'res', id: 1, r: {user: 'Admin', level: 8}});
        socket.close();
    });

    it('slides the expiry and re-sends the cookie on every page load', async () => {
        const host = await login({sessionTtlMs: 60_000});
        const cookie = sessionCookieOf(await post(host, 'user=Admin&password=secret'));
        const page = await fetch(host.url, {headers: {Cookie: cookie}});
        expect(page.headers.get('set-cookie')).toContain('Max-Age=60');
        expect(host.sessions?.size).toBe(1);
    });

    it('logs out: the session is gone here and the cookie is gone there', async () => {
        const host = await login();
        const cookie = sessionCookieOf(await post(host, 'user=Admin&password=secret'));
        expect(host.sessions?.size).toBe(1);
        const answer = await fetch(`${host.url}logout`, {headers: {Cookie: cookie}, redirect: 'manual'});
        expect(answer.status).toBe(302);
        expect(answer.headers.get('location')).toBe(`${host.base}login`);
        expect(answer.headers.get('set-cookie')).toContain('Max-Age=0');
        expect(host.sessions?.size).toBe(0);
        // and the cookie the browser still has opens nothing
        expect(await (await fetch(host.url, {headers: {Cookie: cookie}})).text()).toContain('User name');
        await expect(handshake(host, {cookie})).resolves.toBe(401);
    });

    it('lets the settings.cgi hand-over past the login page, untouched', async () => {
        // task 13: the WebUI session was checked by `settings.cgi`, which set the token cookie and
        // redirected here. That browser must never see the login form.
        const host = await login({base: '/addons/hmm/'});
        const cookie = `hmm_token=${host.token ?? ''}`;
        const page = await fetch(host.url, {headers: {Cookie: cookie}});
        expect(await page.text()).toContain('<div id="app">');
        expect((await fetch(`${host.url}data/manifest.json`, {headers: {Cookie: cookie}})).status).toBe(200);
        await expect(handshake(host, {cookie})).resolves.toBe(101);
        expect(fakeCcu.calls).toHaveLength(0);
    });

    it('serves the login page in English when the browser asks for it, and on request', async () => {
        const host = await login();
        const english = await fetch(host.url, {headers: {'Accept-Language': 'en-GB,en;q=0.9'}});
        expect(await english.text()).toContain('User name');
        const chosen = await fetch(`${host.url}login?lang=en`);
        expect(await chosen.text()).toContain('User name');
        const german = await fetch(`${host.url}login?lang=de`, {headers: {'Accept-Language': 'en-GB'}});
        expect(await german.text()).toContain('Benutzername');
    });

    it('marks the cookie Secure when the request came in over https', async () => {
        const host = await login();
        const answer = await post(host, 'user=Admin&password=secret', {'X-Forwarded-Proto': 'https'});
        expect(answer.headers.get('set-cookie')).toContain('Secure');
    });

    it('answers a login body that is far too large as a failed attempt, not with a buffer', async () => {
        const host = await login();
        const answer = await post(host, `user=Admin&password=${'x'.repeat(9000)}`);
        expect(answer.status).toBe(401);
        expect(fakeCcu.calls).toHaveLength(0);
    });
});

describe('shutdown', () => {
    it('closes the port, the socket and the backend, and may be called twice', async () => {
        const host = await start();
        await handshake(host, {path: '/api?token=secret'});
        await host.close();
        await host.close();
        await expect(fetch(host.url)).rejects.toThrow();
    });

    it('gives up on a backend that will not stop, and says so', async () => {
        const warnings: string[] = [];
        const host = await start({
            shutdownTimeoutMs: 50,
            log: {
                error: () => undefined,
                warn: (...parts: unknown[]) => warnings.push(parts.map(String).join(' ')),
                info: () => undefined,
                debug: () => undefined,
            },
        });
        vi.spyOn(backendOf(host), 'stop').mockReturnValue(new Promise(() => undefined));
        await host.close();
        expect(warnings.join(' ')).toContain('did not stop');
    });
});

describe('the openccu-lite hand-over (D-40)', () => {
    /** A box that knows one session. The real one asks the box's metadata API. */
    const fakeBox = {
        offered: [] as (string | null | undefined)[],
        check(sid: string | null | undefined): Promise<{name: string; level: number; sid: string} | undefined> {
            fakeBox.offered.push(sid);
            return Promise.resolve(
                sid === '@abcdefghij@' || sid === 'abcdefghij'
                    ? {name: 'admin', level: 8, sid: 'abcdefghij'}
                    : undefined,
            );
        },
    };

    beforeEach(() => {
        fakeBox.offered.length = 0;
    });

    function box(options: WebHostOptions = {}): Promise<WebHost> {
        return start({authMode: 'occulite', sessionChecker: fakeBox, ...options});
    }

    function sessionCookieOf(answer: Response): string {
        const header = answer.headers.get('set-cookie') ?? '';
        const value = /hmm_session=([^;]+)/.exec(header)?.[1];
        expect(value, `no session cookie in ${header}`).toBeTruthy();
        return `hmm_session=${value ?? ''}`;
    }

    it("turns the shell's ?sid=@…@ into a session of its own and takes it off the URL", async () => {
        const host = await box();
        const answer = await fetch(`${host.url}?sid=%40abcdefghij%40`, {redirect: 'manual'});
        expect(answer.status).toBe(302);
        expect(answer.headers.get('location')).toBe(host.base);
        expect(fakeBox.offered).toEqual(['@abcdefghij@']);

        const ui = await fetch(host.url, {headers: {Cookie: sessionCookieOf(answer)}});
        expect(await ui.text()).toContain('<div id="app">');
    });

    it('keeps the rest of the query string', async () => {
        const host = await box();
        const answer = await fetch(`${host.url}?sid=abcdefghij&lang=de`, {redirect: 'manual'});
        expect(answer.headers.get('location')).toBe(`${host.base}?lang=de`);
    });

    it('sends a session the box does not know back to the box, not to a form', async () => {
        const host = await box();
        const answer = await fetch(`${host.url}?sid=zzzzzzzzzz`, {redirect: 'manual'});
        expect(answer.status).toBe(302);
        expect(answer.headers.get('location')).toBe('/');
        expect(answer.headers.get('set-cookie')).toBeNull();
    });

    it('sends a browser without a session to the box, and answers 401 for everything else', async () => {
        const host = await box();
        const page = await fetch(host.url, {redirect: 'manual'});
        expect(page.status).toBe(302);
        expect(page.headers.get('location')).toBe('/');
        expect((await fetch(`${host.url}data/manifest.json`)).status).toBe(401);
        // nothing was asked of the box: there was no session to check
        expect(fakeBox.offered).toEqual([]);
    });

    it("still accepts the token cookie of settings.cgi, which is the addon's other door", async () => {
        const host = await box();
        const ui = await fetch(host.url, {headers: {Cookie: 'hmm_token=secret'}});
        expect(ui.status).toBe(200);
        expect(await ui.text()).toContain('<div id="app">');
    });

    it('hands the session to the backend, so a write to the box is attributed to the user', async () => {
        const host = await box();
        const seen: (string | undefined)[] = [];
        vi.spyOn(backendOf(host), 'noteMetaSession').mockImplementation((sid) => seen.push(sid));
        const answer = await fetch(`${host.url}?sid=abcdefghij`, {redirect: 'manual'});
        await fetch(host.url, {headers: {Cookie: sessionCookieOf(answer)}});
        expect(seen).toContain('abcdefghij');
    });

    it("logs out to the box, because the login is the box's", async () => {
        const host = await box();
        const answer = await fetch(`${host.url}?sid=abcdefghij`, {redirect: 'manual'});
        const out = await fetch(`${host.url}logout`, {
            redirect: 'manual',
            headers: {Cookie: sessionCookieOf(answer)},
        });
        expect(out.status).toBe(302);
        expect(out.headers.get('location')).toBe('/');
        expect(out.headers.get('set-cookie')).toContain('Max-Age=0');
    });

    it('refuses --no-auth, which would leave the api open whatever the session says', async () => {
        await expect(start({authMode: 'occulite', auth: false})).rejects.toThrow('--no-auth');
    });
});
