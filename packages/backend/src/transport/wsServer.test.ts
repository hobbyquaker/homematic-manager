import fs from 'node:fs/promises';
import http from 'node:http';
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
    await backend.stop();
    await fs.rm(dir, {recursive: true, force: true});
});

async function serve(options: {token?: string} = {}): Promise<{server: ApiWebSocketServer; url: string}> {
    const server = new ApiWebSocketServer({backend, port: 0, ...options});
    servers.push(server);
    const port = await server.start();
    return {server, url: `ws://127.0.0.1:${String(port)}${server.path}`};
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
