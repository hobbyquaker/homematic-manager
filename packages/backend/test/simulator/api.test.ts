/**
 * The API over its two transports, against a running hm-simulator: the RPC console, the method
 * catalogue, a WebSocket round trip with the `ApiFrame` codec, and the one-time import of the 2.x
 * configuration on a first start that then really connects.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {WebSocket} from 'ws';
import {afterEach, describe, expect, it} from 'vitest';

import type {ApiFrame} from '@homematic-manager/core';

import {ApiWebSocketServer, InProcessTransport, decodeFrame, encodeFrame} from '../../src/index.js';
import {simulatorAvailable, startBackend, startSimulator} from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any -- hm-simulator ships no types */

const running: {close: () => unknown}[] = [];

afterEach(async () => {
    for (const item of running.splice(0)) {
        await item.close();
    }
});

async function connected(): Promise<{sim: any; harness: Awaited<ReturnType<typeof startBackend>>}> {
    const sim = await startSimulator();
    running.push({close: () => sim.close()});
    const harness = await startBackend(sim);
    running.unshift({close: () => harness.close()});
    return {sim, harness};
}

function frame(socket: WebSocket, predicate: (candidate: ApiFrame) => boolean): Promise<ApiFrame> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no frame')), 5000);
        const onMessage = (data: unknown): void => {
            const parsed = decodeFrame(data);
            if (parsed && predicate(parsed)) {
                clearTimeout(timer);
                socket.off('message', onMessage);
                resolve(parsed);
            }
        };
        socket.on('message', onMessage);
    });
}

describe.skipIf(!simulatorAvailable)('the API against hm-simulator', () => {
    it('sends a console read straight through and a console write through the log', async () => {
        const {harness} = await connected();
        const version = await harness.backend.request('rpc.call', 'HmIP-RF', 'getDeviceDescription', [
            '0001D3C99ABCDE',
        ]);
        expect(version).toMatchObject({ADDRESS: '0001D3C99ABCDE', TYPE: 'HmIP-PDT'});
        expect(await harness.backend.request('writeLog.list')).toEqual([]);

        await harness.backend.request('rpc.call', 'HmIP-RF', 'setValue', ['0001D3C99ABCDE:3', 'STATE', true]);
        expect((await harness.backend.request('writeLog.list')).at(-1)).toMatchObject({
            method: 'setValue',
            ok: true,
        });
    });

    it('reports a fault of the interface with its code', async () => {
        const {harness} = await connected();
        const error = await harness.backend
            .request('rpc.call', 'HmIP-RF', 'getParamset', ['NOPE:1', 'MASTER'])
            .catch((value: unknown) => value);
        expect((error as {kind?: string}).kind).toBe('rpc');
        expect((error as {faultCode?: number}).faultCode).toBeDefined();
    });

    it('builds the method catalogue from the interface and the core', async () => {
        const {harness} = await connected();
        const methods = await harness.backend.request('rpc.methods', 'HmIP-RF');
        expect(methods.length).toBeGreaterThan(10);
        const getParamset = methods.find((method) => method.name === 'getParamset');
        expect(getParamset?.params.map((parameter) => parameter.name)).toEqual(['address', 'paramset_key', 'mode']);
        expect(getParamset?.help).toBeTypeOf('string');
    });

    it('answers the radio and service-message methods', async () => {
        const {sim, harness} = await connected();
        expect(await harness.backend.request('bidcos.interfaces', 'BidCos-RF')).toEqual([
            expect.objectContaining({ADDRESS: expect.any(String)}),
        ]);
        expect(Object.keys(await harness.backend.request('rssi.get', 'BidCos-RF')).length).toBeGreaterThan(0);

        sim.setServiceMessage('rfd', 'LEQ0000001:0', 'STICKY_UNREACH', true);
        await harness.backend.pollServiceMessages();
        expect(await harness.backend.request('serviceMessages.list', 'BidCos-RF')).toEqual([
            expect.objectContaining({datapoint: 'STICKY_UNREACH'}),
        ]);
    });

    it('serves the whole contract over a WebSocket with the ApiFrame codec', async () => {
        const {harness} = await connected();
        const server = new ApiWebSocketServer({backend: harness.backend, port: 0, host: '127.0.0.1'});
        const port = await server.start();
        running.unshift({close: () => server.stop()});

        const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/api`);
        running.unshift({close: () => socket.close()});
        await new Promise<void>((resolve, reject) => {
            socket.once('open', resolve);
            socket.once('error', reject);
        });

        socket.send(encodeFrame({t: 'req', id: 1, m: 'devices.list', p: ['HmIP-RF']}));
        const response = (await frame(socket, (candidate) => candidate.t === 'res')) as {r: {ADDRESS: string}[]};
        expect(response.r.map((device) => device.ADDRESS)).toContain('0001D3C99ABCDE:3');

        const event = frame(socket, (candidate) => candidate.t === 'ev');
        await harness.backend.request('names.set', [{address: '0001D3C99ABCDE', name: 'Ueber die Leitung'}]);
        expect(await event).toMatchObject({t: 'ev'});

        socket.send(encodeFrame({t: 'req', id: 2, m: 'paramset.get', p: ['HmIP-RF', 'NOPE:1', 'MASTER']}));
        expect(await frame(socket, (candidate) => candidate.t === 'err')).toMatchObject({
            t: 'err',
            id: 2,
            e: {kind: 'rpc'},
        });
    });

    it('serves the same contract in-process', async () => {
        const {harness} = await connected();
        const transport = new InProcessTransport(harness.backend);
        const devices = await transport.request('devices.list', 'BidCos-RF');
        expect(devices.map((device) => device.ADDRESS)).toContain('LEQ0000001:1');
    });

    it('imports the 2.x configuration on a first start and connects with it (D-17)', async () => {
        const sim = await startSimulator();
        running.push({close: () => sim.close()});
        const home = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-legacy-'));
        await fs.mkdir(path.join(home, '.hm-manager'), {recursive: true});
        await fs.writeFile(
            path.join(home, '.hm-manager', 'config'),
            JSON.stringify({ccuAddress: '127.0.0.1', useTLS: false, language: 'en', rpcDelay: 500}),
            'utf8',
        );

        const harness = await startBackend(sim, {
            connect: false,
            backend: {
                importLegacy: true,
                legacyEnvironment: {platform: 'linux', appData: '', home},
                // the imported configuration keeps the four default interfaces, and only HmIP-RF
                // is served here - the other three have to fail fast rather than hold the test up
                rpcTimeoutMs: 300,
                watchdogIntervalMs: 0,
                serviceMessagePollMs: 0,
                cacheWriteDelayMs: 0,
                localAddresses: () => ['127.0.0.1'],
                callbackHost: '127.0.0.1',
                regaOptions: {port: sim.regaSim.port as number, timeoutMs: 1000},
                interfaceManagerOptions: {
                    portOverride: (name) => (name === 'HmIP-RF' ? (sim.ports.hmip as number) : undefined),
                    watchdogIntervalMs: 0,
                },
            },
        });
        running.unshift({close: () => harness.close()});

        const config = await harness.backend.request('config.get');
        expect(config.connection).toMatchObject({host: '127.0.0.1', language: 'en', writePaceMs: 500});
        expect(harness.notices.some((notice) => notice.message.includes('2.x was imported'))).toBe(false);

        await harness.backend.start();
        expect(harness.notices.some((notice) => notice.message.includes('2.x was imported'))).toBe(true);
        const states = await harness.backend.request('interfaces.list');
        expect(states.find((state) => state.name === 'HmIP-RF')?.connected).toBe(true);
        await fs.rm(home, {recursive: true, force: true});
    });
});
