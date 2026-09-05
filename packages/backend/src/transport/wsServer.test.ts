import fs from 'node:fs/promises';
import http from 'node:http';
import type {Socket} from 'node:net';
import os from 'node:os';
import path from 'node:path';

import {WebSocket} from 'ws';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import type {ApiFrame} from '@homematic-manager/core';

import {Backend} from '../api/backend.js';
import {decodeFrame, encodeFrame} from './codec.js';
import {ApiWebSocketServer, UNAUTHORIZED_CLOSE_CODE, refuseUnauthorised} from './wsServer.js';

let dir: string;
let backend: Backend;
const servers: ApiWebSocketServer[] = [];
const sockets: WebSocket[] = [];
const httpServers: http.Server[] = [];
/** An upgraded socket is no longer one `close()` counts, so it is destroyed by hand. */
const hostSockets = new Set<Socket>();

beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-ws-'));
    backend = await Backend.open({dataDir: dir, importLegacy: false, localAddresses: () => ['10.0.0.2']});
});

afterEach(async () => {
    for (const socket of sockets.splice(0)) {
        socket.close();
    }
    for (const server of servers.splice(0)) {
        await server.stop();
    }
    for (const server of httpServers.splice(0)) {
        await new Promise<void>((resolve) => {
            server.close(() => {
                resolve();
            });
            for (const socket of hostSockets) {
                socket.destroy();
            }
            hostSockets.clear();
        });
    }
    await backend.stop();
    await fs.rm(dir, {recursive: true, force: true});
});

async function serve(
    options: {token?: string; keepAliveMs?: number} = {},
): Promise<{server: ApiWebSocketServer; url: string}> {
    const server = new ApiWebSocketServer({backend, port: 0, ...options});
    servers.push(server);
    const port = await server.start();
    return {server, url: `ws://127.0.0.1:${String(port)}${server.path}`};
}

/** An HTTP server that is closed again after the test, with its upgraded sockets. */
async function listen(handler: http.Server): Promise<number> {
    httpServers.push(handler);
    handler.on('connection', (socket: Socket) => {
        hostSockets.add(socket);
        socket.on('close', () => hostSockets.delete(socket));
    });
    await new Promise<void>((resolve) => {
        handler.listen(0, '127.0.0.1', resolve);
    });
    const address = handler.address();
    return typeof address === 'object' && address !== null ? address.port : 0;
}

/** The status code of a raw WebSocket handshake: 101 when it was let in, anything else when not. */
function handshakeStatus(port: number, path: string): Promise<number> {
    return new Promise((resolve, reject) => {
        const request = http.request({
            host: '127.0.0.1',
            port,
            path,
            headers: {
                Connection: 'Upgrade',
                Upgrade: 'websocket',
                'Sec-WebSocket-Version': '13',
                'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
            },
        });
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

function connect(url: string, protocols?: string[]): Promise<WebSocket> {
    const socket = protocols ? new WebSocket(url, protocols) : new WebSocket(url);
    sockets.push(socket);
    return new Promise((resolve, reject) => {
        socket.once('open', () => {
            resolve(socket);
        });
        socket.once('error', reject);
        socket.once('close', (code: number) => {
            reject(new Error(`closed with ${String(code)}`));
        });
    });
}

/** Waits for a condition the other side of a socket makes true, instead of for a fixed delay. */
async function until(condition: () => boolean, limitMs = 5000): Promise<void> {
    const deadline = Date.now() + limitMs;
    while (!condition()) {
        if (Date.now() > deadline) {
            throw new Error('the condition never became true');
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

function nextFrame(socket: WebSocket, predicate: (frame: ApiFrame) => boolean): Promise<ApiFrame> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error('no frame'));
        }, 5000);
        const onMessage = (data: unknown): void => {
            const frame = decodeFrame(data);
            if (frame && predicate(frame)) {
                clearTimeout(timer);
                socket.off('message', onMessage);
                resolve(frame);
            }
        };
        socket.on('message', onMessage);
    });
}

describe('ApiWebSocketServer', () => {
    it('answers a request frame with a response frame', async () => {
        const {url} = await serve();
        const socket = await connect(url);
        socket.send(encodeFrame({t: 'req', id: 1, m: 'config.get', p: []}));
        const frame = await nextFrame(socket, (candidate) => candidate.t === 'res');
        expect(frame).toMatchObject({t: 'res', id: 1});
        expect((frame as {r: {localAddresses: string[]}}).r.localAddresses).toEqual(['10.0.0.2']);
    });

    it('answers a failing request with an error frame that keeps the kind', async () => {
        const {url} = await serve();
        const socket = await connect(url);
        socket.send(encodeFrame({t: 'req', id: 2, m: 'devices.list', p: ['HmIP-RF']}));
        const frame = await nextFrame(socket, (candidate) => candidate.t === 'err');
        expect(frame).toMatchObject({t: 'err', id: 2, e: {kind: 'config'}});
    });

    it('fans an event out to every client', async () => {
        const {server, url} = await serve();
        const first = await connect(url);
        const second = await connect(url);
        expect(server.clients).toBe(2);
        const seen = Promise.all([
            nextFrame(first, (frame) => frame.t === 'ev'),
            nextFrame(second, (frame) => frame.t === 'ev'),
        ]);
        backend.events.emit('notice', {level: 'info', message: 'hello'});
        const [a, b] = await seen;
        expect(a).toEqual({t: 'ev', n: 'notice', d: {level: 'info', message: 'hello'}});
        expect(b).toEqual(a);
    });

    it('drops a frame that is not a frame instead of answering it', async () => {
        const {url} = await serve();
        const socket = await connect(url);
        socket.send('not json at all');
        socket.send(encodeFrame({t: 'res', id: 9, r: 1}));
        socket.send(encodeFrame({t: 'req', id: 3, m: 'names.get', p: []}));
        const frame = await nextFrame(socket, (candidate) => candidate.t === 'res');
        expect(frame).toEqual({t: 'res', id: 3, r: {}});
    });

    it('refuses a client without the token and accepts one with it', async () => {
        const {server, url} = await serve({token: 's3cret'});
        await expect(connect(url)).rejects.toThrow('401');
        const byQuery = await connect(`${url}?token=s3cret`);
        expect(byQuery.readyState).toBe(WebSocket.OPEN);
        const byProtocol = await connect(url, ['s3cret']);
        expect(byProtocol.readyState).toBe(WebSocket.OPEN);
        expect(server.clients).toBe(2);
    });

    it('accepts the token as a prefixed subprotocol', () => {
        const server = new ApiWebSocketServer({backend, token: 'abc'});
        servers.push(server);
        expect(server.authorise({url: '/api', headers: {'sec-websocket-protocol': 'token.abc'}})).toBe(true);
        expect(server.authorise({url: '/api', headers: {'sec-websocket-protocol': 'other'}})).toBe(false);
        expect(server.authorise({url: undefined, headers: {}})).toBe(false);
    });

    it('exports the close code and the plain 401 for a host that guards the upgrade itself', () => {
        expect(UNAUTHORIZED_CLOSE_CODE).toBe(4401);
        const written: string[] = [];
        refuseUnauthorised({
            write: (chunk: string) => written.push(chunk),
            destroy: () => undefined,
        } as never);
        expect(written[0]).toContain('401');
    });

    it('lets everyone in when no token is configured', () => {
        const server = new ApiWebSocketServer({backend});
        servers.push(server);
        expect(server.authorise({url: '/api', headers: {}})).toBe(true);
    });

    it('attaches to an HTTP server the host already runs', async () => {
        const http_ = http.createServer();
        await new Promise<void>((resolve) => http_.listen(0, '127.0.0.1', resolve));
        const address = http_.address();
        const port = typeof address === 'object' && address !== null ? address.port : 0;
        const server = new ApiWebSocketServer({backend, server: http_, path: '/addons/hmm/api'});
        servers.push(server);
        expect(await server.start()).toBe(0);
        expect(server.port).toBe(0);
        const socket = await connect(`ws://127.0.0.1:${String(port)}/addons/hmm/api`);
        socket.send(encodeFrame({t: 'req', id: 4, m: 'rega.state', p: []}));
        expect(await nextFrame(socket, (frame) => frame.t === 'res')).toMatchObject({t: 'res', id: 4});
        await server.stop();
        await new Promise<void>((resolve) =>
            http_.close(() => {
                resolve();
            }),
        );
    });

    it('rejects when the port is taken', async () => {
        const {server} = await serve();
        const blocked = new ApiWebSocketServer({backend, port: server.port});
        servers.push(blocked);
        await expect(blocked.start()).rejects.toThrow();
    });

    it('takes the upgrades a host routes to it and never touches the rest (noServer)', async () => {
        const api = new ApiWebSocketServer({backend, noServer: true, token: 's3cret'});
        servers.push(api);
        expect(await api.start()).toBe(0);
        expect(api.port).toBe(0);
        // the host owns the routing: with `WebSocketServer({server, path})` the second endpoint of
        // an origin - a vite HMR socket, another proxy - would be answered with ws's 400 instead
        const host = http.createServer();
        host.on('upgrade', (request, socket, head) => {
            if (new URL(request.url ?? '/', 'http://host').pathname === '/addons/hmm/api') {
                api.handleUpgrade(request, socket, head);
                return;
            }
            socket.end('HTTP/1.1 418 the host keeps this one\r\nConnection: close\r\n\r\n');
        });
        const port = await listen(host);

        await expect(handshakeStatus(port, '/hmr')).resolves.toBe(418);
        await expect(handshakeStatus(port, '/addons/hmm/api')).resolves.toBe(401);
        await expect(handshakeStatus(port, '/addons/hmm/api?token=s3cret')).resolves.toBe(101);

        const socket = await connect(`ws://127.0.0.1:${String(port)}/addons/hmm/api?token=s3cret`);
        socket.send(encodeFrame({t: 'req', id: 7, m: 'rega.state', p: []}));
        expect(await nextFrame(socket, (frame) => frame.t === 'res')).toMatchObject({t: 'res', id: 7});
        expect(api.clients).toBe(1);
    });

    it('refuses to hand an upgrade over when it is not in noServer mode', async () => {
        const api = new ApiWebSocketServer({backend, noServer: true});
        servers.push(api);
        const request = {url: '/api', headers: {}} as never;
        const socket = {end: () => undefined} as never;
        expect(() => {
            api.handleUpgrade(request, socket, Buffer.alloc(0));
        }).toThrow('before start()');
        const attached = await serve();
        expect(() => {
            attached.server.handleUpgrade(request, socket, Buffer.alloc(0));
        }).toThrow('noServer');
    });

    it('leaves a client that answers the ping alone', async () => {
        const {server, url} = await serve({keepAliveMs: 30});
        const socket = await connect(url);
        const pings: number[] = [];
        socket.on('ping', () => pings.push(Date.now()));
        await new Promise((resolve) => setTimeout(resolve, 200));
        // without the pong bookkeeping the second ping would already have terminated this socket
        expect(pings.length).toBeGreaterThan(1);
        expect(socket.readyState).toBe(WebSocket.OPEN);
        expect(server.clients).toBe(1);
    });

    it('terminates a client that stops answering', async () => {
        const {server, url} = await serve({keepAliveMs: 30});
        const socket = await connect(url);
        await new Promise<void>((resolve) => {
            socket.once('ping', () => {
                resolve();
            });
        });
        // a client that no longer reads cannot pong - the socket a suspended laptop leaves behind.
        // It is the server side that has to notice; the paused client never processes anything
        // again, not even the close, which is exactly the situation the heartbeat is there for.
        socket.pause();
        await until(() => server.clients === 0);
    });

    it('has no heartbeat unless one is asked for', async () => {
        const {url} = await serve();
        const socket = await connect(url);
        let pinged = false;
        socket.on('ping', () => {
            pinged = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 120));
        expect(pinged).toBe(false);
        expect(socket.readyState).toBe(WebSocket.OPEN);
    });

    it('stops cleanly and forgets its clients', async () => {
        const {server, url} = await serve();
        await connect(url);
        expect(server.clients).toBe(1);
        await server.stop();
        expect(server.clients).toBe(0);
        expect(server.port).toBe(0);
        // a stopped server no longer forwards events
        backend.events.emit('notice', {level: 'info', message: 'x'});
        await expect(server.stop()).resolves.toBeUndefined();
    });
});

describe('session.info (D-32)', () => {
    it('is null on a transport whose host has no login', async () => {
        const {url} = await serve();
        const socket = await connect(url);
        socket.send(encodeFrame({t: 'req', id: 1, m: 'session.info', p: []}));
        const frame = await nextFrame(socket, (candidate) => candidate.t === 'res');
        expect(frame).toEqual({t: 'res', id: 1, r: null});
    });

    it('answers each socket with the session it was opened with', async () => {
        // the host reads its own cookie here; the backend never sees one
        const server = new ApiWebSocketServer({
            backend,
            port: 0,
            sessionInfo: (request) =>
                (request.headers['cookie'] ?? '').includes('hmm_session=one') ? {user: 'Admin', level: 8} : null,
        });
        servers.push(server);
        const port = await server.start();
        const url = `ws://127.0.0.1:${String(port)}${server.path}`;

        const withSession = new WebSocket(url, {headers: {Cookie: 'hmm_session=one'}});
        sockets.push(withSession);
        await new Promise<void>((resolve, reject) => {
            withSession.once('open', () => {
                resolve();
            });
            withSession.once('error', reject);
        });
        const without = await connect(url);

        withSession.send(encodeFrame({t: 'req', id: 1, m: 'session.info', p: []}));
        without.send(encodeFrame({t: 'req', id: 1, m: 'session.info', p: []}));
        const [a, b] = await Promise.all([
            nextFrame(withSession, (frame) => frame.t === 'res'),
            nextFrame(without, (frame) => frame.t === 'res'),
        ]);
        expect(a).toEqual({t: 'res', id: 1, r: {user: 'Admin', level: 8}});
        expect(b).toEqual({t: 'res', id: 1, r: null});
    });
});

describe('session counting (D-31)', () => {
    it('reports the number of open sockets to the backend, and 0 when the last one goes', async () => {
        const counts: number[] = [];
        const original = backend.noteSessions.bind(backend);
        backend.noteSessions = (count: number): void => {
            counts.push(count);
            original(count);
        };

        const {url} = await serve();
        const first = await connect(url);
        await connect(url);
        expect(counts).toEqual([1, 2]);

        first.close();
        await until(() => counts.length === 3);
        expect(counts).toEqual([1, 2, 1]);
    });

    it('does not start an idle grace period while the host is shutting the server down', async () => {
        const counts: number[] = [];
        backend.noteSessions = (count: number): void => {
            counts.push(count);
        };
        const {server, url} = await serve();
        await connect(url);
        expect(counts).toEqual([1]);
        await server.stop();
        // `stop()` clears its own set; telling a backend that is about to be stopped that it has no
        // sessions would only leave a timer behind
        expect(counts).toEqual([1]);
    });
});
