import {randomBytes} from 'node:crypto';
import http from 'node:http';
import type {AddressInfo, Socket} from 'node:net';

import {afterEach, describe, expect, it} from 'vitest';

import {proxyRequest, proxyUpgrade} from './proxy.js';

const running: {close: () => Promise<void>}[] = [];

afterEach(async () => {
    for (const item of running.splice(0)) {
        await item.close();
    }
});

async function listen(server: http.Server): Promise<string> {
    // an upgraded socket is no longer one of the server's connections, so `closeAllConnections()`
    // does not reach it and `close()` would wait for it forever - they are tracked by hand
    const sockets = new Set<Socket>();
    server.on('connection', (socket: Socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    running.push({
        close: () =>
            new Promise<void>((resolve) => {
                server.close(() => resolve());
                for (const socket of sockets) {
                    socket.destroy();
                }
            }),
    });
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** A stand-in for the vite dev server: echoes the request, and upgrades `/hmr`. */
async function upstream(): Promise<string> {
    const server = http.createServer((request, response) => {
        const body: Buffer[] = [];
        request.on('data', (chunk: Buffer) => body.push(chunk));
        request.on('end', () => {
            response.writeHead(200, {'Content-Type': 'application/json'});
            response.end(
                JSON.stringify({
                    url: request.url,
                    method: request.method,
                    host: request.headers.host,
                    body: Buffer.concat(body).toString(),
                }),
            );
        });
    });
    server.on('upgrade', (request, socket, head) => {
        socket.write(
            ['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', '', ''].join('\r\n'),
        );
        socket.write(`echo:${head.toString()}`);
        socket.on('data', (chunk: Buffer) => socket.write(`echo:${chunk.toString()}`));
    });
    return listen(server);
}

/** A port nothing listens on, so a connection to it is refused at once. */
async function deadTarget(): Promise<string> {
    const probe = http.createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const {port} = probe.address() as AddressInfo;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    return `http://127.0.0.1:${port}`;
}

/** The front server the browser talks to; everything is proxied. */
async function front(target: string): Promise<string> {
    const server = http.createServer((request, response) => {
        proxyRequest({target: new URL(target)}, request, response);
    });
    server.on('upgrade', (request, socket, head) => {
        proxyUpgrade({target: new URL(target)}, request, socket, head);
    });
    return listen(server);
}

describe('proxyRequest', () => {
    it('forwards the path, the method and the body, and rewrites the host header', async () => {
        const target = await upstream();
        const base = await front(target);
        const answer = await fetch(`${base}/src/App.svelte?import`, {method: 'POST', body: 'hello'});
        expect(answer.status).toBe(200);
        expect(await answer.json()).toEqual({
            url: '/src/App.svelte?import',
            method: 'POST',
            host: new URL(target).host,
            body: 'hello',
        });
    });

    it('answers 502 when the dev server is not there', async () => {
        const base = await front(await deadTarget());
        const answer = await fetch(`${base}/`);
        expect(answer.status).toBe(502);
        expect(await answer.text()).toContain('not reachable');
    });
});

describe('proxyUpgrade', () => {
    it('passes an upgrade through and pipes both directions', async () => {
        const target = await upstream();
        const base = await front(target);
        const {port} = new URL(base);
        const answer = await new Promise<{status: number; data: string}>((resolve, reject) => {
            const request = http.request({
                host: '127.0.0.1',
                port: Number(port),
                path: '/hmr',
                headers: {
                    Connection: 'Upgrade',
                    Upgrade: 'websocket',
                    'Sec-WebSocket-Version': '13',
                    'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
                },
            });
            request.on('upgrade', (response, socket) => {
                socket.write('ping');
                socket.once('data', (chunk: Buffer) => {
                    socket.destroy();
                    resolve({status: response.statusCode ?? 0, data: chunk.toString()});
                });
            });
            request.on('response', (response) => resolve({status: response.statusCode ?? 0, data: ''}));
            request.on('error', reject);
            request.end();
        });
        expect(answer.status).toBe(101);
        expect(answer.data).toContain('echo:');
    });

    it('destroys the socket when the dev server is not there', async () => {
        const base = await front(await deadTarget());
        const {port} = new URL(base);
        const failed = await new Promise<boolean>((resolve) => {
            const request = http.request({
                host: '127.0.0.1',
                port: Number(port),
                path: '/hmr',
                headers: {
                    Connection: 'Upgrade',
                    Upgrade: 'websocket',
                    'Sec-WebSocket-Version': '13',
                    'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
                },
            });
            request.on('upgrade', () => resolve(false));
            request.on('response', () => resolve(false));
            request.on('error', () => resolve(true));
            request.end();
        });
        expect(failed).toBe(true);
    });

    it('forwards an answer that is not an upgrade, so a 401 reaches the browser', async () => {
        // what `ws` does when the token is wrong: a real 401 instead of a socket that just dies
        const refusing = http.createServer();
        refusing.on('upgrade', (_request, socket) => {
            socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n');
            socket.destroy();
        });
        const target = await listen(refusing);
        const base = await front(target);
        const {port} = new URL(base);
        const status = await new Promise<number | 'error'>((resolve) => {
            const request = http.request({
                host: '127.0.0.1',
                port: Number(port),
                path: '/hmr',
                headers: {
                    Connection: 'Upgrade',
                    Upgrade: 'websocket',
                    'Sec-WebSocket-Version': '13',
                    'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
                },
            });
            request.on('upgrade', (answer, socket) => {
                socket.destroy();
                resolve(answer.statusCode ?? 0);
            });
            request.on('response', (answer) => {
                answer.resume();
                resolve(answer.statusCode ?? 0);
            });
            request.on('error', () => resolve('error'));
            request.end();
        });
        expect(status).toBe(401);
    });
});
