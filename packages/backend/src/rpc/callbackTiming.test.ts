/**
 * Task 73: the callback servers never keep an interface process waiting.
 *
 * hmipserver runs every registered listener on a worker of its own, and a worker blocked for longer
 * than a minute makes Vert.x log a full stack trace every second until the delivery returns. So
 * every callback has to be answered at once, whatever the UI side is doing. This is the whole
 * stack a real one meets - the backend's own callback servers, its handler, the WebSocket server
 * with twenty connected UI clients, one of which never reads its socket - and a fake daemon that
 * times each answer the way hmipserver and rfd see it: a burst of events in `system.multicall`
 * batches, and a `newDevices` with a hundred descriptions, over XML-RPC and BIN-RPC alike.
 */

import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import binrpc from 'binrpc';
import xmlrpc from 'homematic-xmlrpc';
import {WebSocket} from 'ws';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import type {DeviceDescription, RpcValue} from '@homematic-manager/core';

import {Backend} from '../api/backend.js';
import {ApiWebSocketServer} from '../transport/wsServer.js';
import type {RpcClient, RpcClientOptions} from './client.js';

/** The spec's bound: every callback answered within this many milliseconds of the request. */
const ANSWER_WITHIN_MS = 50;
const UI_CLIENTS = 20;

interface Registration {
    readonly url: string;
    readonly ident: string;
}

interface DaemonClient {
    methodCall(method: string, params: RpcValue[], callback: (error: unknown, value: unknown) => void): void;
}

let dir: string;
let backend: Backend;
let api: ApiWebSocketServer;
const sockets: WebSocket[] = [];
/** The frames each reading UI client received. */
const received: string[][] = [];
/** The `init` of each interface, as the backend registered its callback servers. */
const registrations = new Map<string, Registration>();

/** An interface process that answers everything with '' and records the `init`. */
function fakeClient(options: RpcClientOptions): RpcClient {
    return {
        name: options.name,
        host: options.host,
        port: options.port,
        protocol: options.protocol,
        closed: false,
        description: options.name,
        call: (method: string, params: readonly RpcValue[] = []) => {
            if (method === 'init' && typeof params[0] === 'string' && typeof params[1] === 'string' && params[1]) {
                registrations.set(options.name, {url: params[0], ident: params[1]});
            }
            return Promise.resolve(method === 'listDevices' ? [] : '');
        },
        close: () => undefined,
    } as unknown as RpcClient;
}

function daemonFor(url: string): DaemonClient {
    const match = /^(xmlrpc_bin|http):\/\/[^:]+:(\d+)/.exec(url);
    if (!match) {
        throw new Error(`not a callback url: ${url}`);
    }
    const port = Number(match[2]);
    return match[1] === 'xmlrpc_bin'
        ? binrpc.createClient({host: '127.0.0.1', port})
        : xmlrpc.createClient({host: '127.0.0.1', port, path: '/'});
}

/** One call, timed from the request to the answer, as the daemon sees it. */
function timedCall(client: DaemonClient, method: string, params: RpcValue[]): Promise<number> {
    return new Promise((resolve, reject) => {
        const started = performance.now();
        client.methodCall(method, params, (error) => {
            if (error) {
                reject(error instanceof Error ? error : new Error(JSON.stringify(error)));
                return;
            }
            resolve(performance.now() - started);
        });
    });
}

function descriptions(prefix: string, count: number): DeviceDescription[] {
    return Array.from({length: count}, (_, index) => ({
        ADDRESS: `${prefix}${String(index).padStart(7, '0')}:1`,
        PARENT: `${prefix}${String(index).padStart(7, '0')}`,
        PARENT_TYPE: 'HmIP-PS',
        TYPE: 'SWITCH_VIRTUAL_RECEIVER',
        VERSION: 1,
        PARAMSETS: ['MASTER', 'VALUES'],
    }));
}

beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-callback-timing-'));
    backend = await Backend.open({
        dataDir: dir,
        importLegacy: false,
        localAddresses: () => ['127.0.0.1'],
        watchdogIntervalMs: 0,
        serviceMessagePollMs: 0,
        hmipSweepDelayMs: 600_000,
        fileRoots: {data: dir},
        interfaceManagerOptions: {
            createClient: fakeClient,
            probe: () => Promise.resolve('open' as const),
            watchdogIntervalMs: 0,
        },
    });
    api = new ApiWebSocketServer({backend, port: 0, host: '127.0.0.1'});
    const port = await api.start();

    for (let index = 0; index < UI_CLIENTS; index++) {
        const socket = new WebSocket(`ws://127.0.0.1:${String(port)}${api.path}`);
        sockets.push(socket);
        await new Promise<void>((resolve, reject) => {
            socket.once('open', () => {
                resolve();
            });
            socket.once('error', reject);
        });
        if (index === 0) {
            // the tab that never reads: its socket buffer fills up and stays full
            (socket as unknown as {_socket: {pause(): void}})._socket.pause();
            continue;
        }
        const frames: string[] = [];
        received.push(frames);
        socket.on('message', (data: Buffer) => {
            frames.push(data.toString());
        });
    }

    await backend.request('config.set', {
        host: '127.0.0.1',
        interfaces: ['HmIP-RF', 'BidCos-RF'],
        autoDetect: false,
        // on the system itself, as the addon: BidCos-RF then speaks BIN-RPC, HmIP-RF XML-RPC
        local: true,
        callback: {ip: '127.0.0.1', xmlrpcPort: 0, binrpcPort: 0},
    } as never);
    const until = Date.now() + 10_000;
    while (registrations.size < 2 && Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}, 30_000);

afterAll(async () => {
    for (const socket of sockets.splice(0)) {
        socket.terminate();
    }
    await api.stop();
    await backend.stop();
    await fs.rm(dir, {recursive: true, force: true});
});

describe('the callback servers answer at once (task 73)', () => {
    it('registered both interfaces, one over each protocol', () => {
        const urls = [...registrations.values()].map((registration) => registration.url);
        expect(urls.some((url) => url.startsWith('xmlrpc_bin://'))).toBe(true);
        expect(urls.some((url) => url.startsWith('http://'))).toBe(true);
    });

    for (const protocol of ['XML-RPC', 'BIN-RPC'] as const) {
        it(`answers a burst of 500 events in batches of 50 and a newDevices of 100 within ${String(ANSWER_WITHIN_MS)} ms each, over ${protocol}`, async () => {
            const registration = [...registrations.values()].find((entry) =>
                entry.url.startsWith(protocol === 'BIN-RPC' ? 'xmlrpc_bin://' : 'http://'),
            );
            expect(registration).toBeDefined();
            const {url, ident} = registration as Registration;
            const daemon = daemonFor(url);
            const prefix = protocol === 'BIN-RPC' ? 'BIN' : 'XML';
            const before = received.map((frames) => frames.length);

            const times: number[] = [];
            times.push(
                await timedCall(daemon, 'newDevices', [ident, descriptions(prefix, 100) as unknown as RpcValue]),
            );
            for (let batch = 0; batch < 10; batch++) {
                const calls = Array.from({length: 50}, (_, index) => ({
                    methodName: 'event',
                    params: [ident, `${prefix}${String(index).padStart(7, '0')}:1`, 'STATE', (batch + index) % 2 === 0],
                }));
                times.push(await timedCall(daemon, 'system.multicall', [calls]));
            }

            expect(times).toHaveLength(11);
            expect(
                Math.max(...times),
                `answer times in ms: ${times.map((time) => time.toFixed(1)).join(' ')}`,
            ).toBeLessThan(ANSWER_WITHIN_MS);

            // and the reading tabs still get every event, in order, after the answers went out
            await expect
                .poll(() => Math.min(...received.map((frames, index) => frames.length - (before[index] ?? 0))), {
                    timeout: 10_000,
                })
                .toBeGreaterThanOrEqual(500);
            const events = (received[0] ?? [])
                .slice(before[0])
                .map((frame) => JSON.parse(frame) as {n: string; d: {address?: string; value?: unknown}})
                .filter((frame) => frame.n === 'rpc.event' && frame.d.address?.startsWith(prefix) === true);
            expect(events).toHaveLength(500);
            expect(events[0]?.d.address).toBe(`${prefix}0000000:1`);
            expect(events.at(-1)?.d.address).toBe(`${prefix}0000049:1`);
        });

        it(`writes the answer to the daemon before it sends a single frame to a tab, over ${protocol}`, async () => {
            const registration = [...registrations.values()].find((entry) =>
                entry.url.startsWith(protocol === 'BIN-RPC' ? 'xmlrpc_bin://' : 'http://'),
            ) as Registration;
            const callbackPort = Number(/:(\d+)(?:\/|$)/.exec(registration.url)?.[1]);
            const wsPort = api.port;
            // every write of this process, in order: the callback server's answer on its port, a
            // frame to a tab on the WebSocket server's
            const writes: string[] = [];
            // eslint-disable-next-line @typescript-eslint/unbound-method -- put back below, called with its socket
            const original = net.Socket.prototype.write;
            net.Socket.prototype.write = function (this: net.Socket, ...args: unknown[]): boolean {
                if (this.localPort === callbackPort) {
                    writes.push('answer');
                } else if (this.localPort === wsPort) {
                    writes.push('frame');
                }
                return (original as (...parameters: unknown[]) => boolean).apply(this, args);
            };
            try {
                const prefix = protocol === 'BIN-RPC' ? 'BOR' : 'XOR';
                const before = received.map((frames) => frames.length);
                const calls = Array.from({length: 50}, (_, index) => ({
                    methodName: 'event',
                    params: [registration.ident, `${prefix}${String(index).padStart(7, '0')}:1`, 'LEVEL', index],
                }));
                await timedCall(daemonFor(registration.url), 'system.multicall', [calls]);
                await expect
                    .poll(() => Math.min(...received.map((frames, index) => frames.length - (before[index] ?? 0))))
                    .toBeGreaterThanOrEqual(50);
            } finally {
                net.Socket.prototype.write = original;
            }
            // task 73: before, each of the 50 events went to every tab inline, before the answer
            expect(writes.indexOf('answer')).toBeGreaterThanOrEqual(0);
            expect(writes.indexOf('frame')).toBeGreaterThan(writes.indexOf('answer'));
        });
    }
});
