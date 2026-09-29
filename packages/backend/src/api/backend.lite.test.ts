/**
 * Task 72: the backend against an openccu-lite system reached from off the system - occulite-client's
 * `FakeBox` as the host. The probe finds the system, the interfaces go through `LiteInterfaces`
 * (no callback servers, no `init`), the metadata store is the system's, and the settings dialog's
 * test and pairing talk to the same host.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {FakeBox} from 'occulite-client/testing';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import type {ApiEventName, PairingState} from '@homematic-manager/core';

import {Backend, type BackendOptions} from './backend.js';

const DEVICES = {
    'HmIP-RF': [
        {ADDRESS: 'ABC1', TYPE: 'HmIP-PDT', FIRMWARE: '1.4.8', VERSION: 1, CHILDREN: ['ABC1:0', 'ABC1:1']},
        {ADDRESS: 'ABC1:0', TYPE: 'MAINTENANCE', PARENT: 'ABC1', VERSION: 1},
        {ADDRESS: 'ABC1:1', TYPE: 'SWITCH_TRANSCEIVER', PARENT: 'ABC1', VERSION: 1},
    ],
    'BidCos-RF': [
        {ADDRESS: 'LEQ1', TYPE: 'HM-LC-Sw1-Pl', FIRMWARE: '2.8', VERSION: 1, CHILDREN: ['LEQ1:1']},
        {ADDRESS: 'LEQ1:1', TYPE: 'SWITCH', PARENT: 'LEQ1', VERSION: 1},
    ],
};

let dir: string;
let fake: FakeBox;
const backends: Backend[] = [];

beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-lite-'));
    fake = new FakeBox({
        token: 'olt_test',
        interfaces: ['HmIP-RF', 'BidCos-RF'],
        devices: DEVICES,
        values: {'HmIP-RF.ABC1:0.UNREACH': {value: false}, 'HmIP-RF.ABC1:1.STATE': {value: true}},
        descriptions: {'HmIP-RF.ABC1:1': {STATE: {TYPE: 'BOOL', OPERATIONS: 7}}},
        meta: {revision: 3, objects: {'HmIP-RF.ABC1': {name: 'Lamp'}}, enums: {}},
        autoApprove: true,
    });
    await fake.start();
});

afterEach(async () => {
    await Promise.all(backends.splice(0).map((backend) => backend.stop()));
    await fake.stop();
    await fs.rm(dir, {recursive: true, force: true});
});

async function until(check: () => boolean, ms = 3000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!check()) {
        if (Date.now() > deadline) {
            throw new Error('timed out waiting');
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

async function open(options: Partial<BackendOptions> = {}): Promise<{
    backend: Backend;
    events: {name: ApiEventName; payload: unknown}[];
    managers: number;
}> {
    const events: {name: ApiEventName; payload: unknown}[] = [];
    let managers = 0;
    const backend = await Backend.open({
        dataDir: dir,
        version: '3.0.0-dev.0',
        importLegacy: false,
        localAddresses: () => ['192.168.1.5'],
        watchdogIntervalMs: 0,
        serviceMessagePollMs: 0,
        hmipSweepDelayMs: 1,
        cacheWriteDelayMs: 0,
        fileRoots: {data: dir},
        // the CCU path must not be taken: a manager built here is the failure
        createInterfaceManager: () => {
            managers += 1;
            throw new Error('the CCU path was taken for an openccu-lite system');
        },
        liteOptions: {retryDelaysMs: [50], connectTimeoutMs: 2000, rpcTimeoutMs: 2000},
        ...options,
    });
    backends.push(backend);
    for (const name of [
        'interfaces.changed',
        'devices.changed',
        'rpc.event',
        'meta.changed',
        'names.changed',
        'rpcLog.appended',
        'pairing.changed',
        'notice',
    ] satisfies ApiEventName[]) {
        backend.on(name, (payload) => events.push({name, payload}));
    }
    return {
        backend,
        events,
        get managers() {
            return managers;
        },
    };
}

function liteConnection(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        host: new URL(fake.url).host,
        interfaces: ['HmIP-RF', 'BidCos-RF'],
        autoDetect: false,
        rega: true,
        metaToken: 'olt_test',
        callback: {ip: '', xmlrpcPort: 0, binrpcPort: 0},
        ...extra,
    };
}

describe('a remote openccu-lite connection (task 72)', () => {
    it('takes lite-rpc instead of callbacks, lists the devices and marks the interfaces as such', async () => {
        const h = await open();
        await h.backend.request('config.set', liteConnection() as never);
        await until(() => h.events.some((event) => event.name === 'devices.changed'));

        const states = await h.backend.request('interfaces.list');
        expect(states.map((state) => [state.name, state.lite, state.connected])).toEqual([
            ['HmIP-RF', true, true],
            ['BidCos-RF', true, true],
        ]);
        expect(h.managers).toBe(0);

        const devices = await h.backend.request('devices.list', 'HmIP-RF');
        expect(devices.map((entry) => entry.ADDRESS)).toEqual(['ABC1', 'ABC1:0', 'ABC1:1']);
        // the calls went over the JSON path, and into the RPC log
        expect(fake.calls.some((call) => call.interface === 'HmIP-RF' && call.method === 'listDevices')).toBe(true);
        expect(h.events.some((event) => event.name === 'rpcLog.appended')).toBe(true);
        // no ReGa on openccu-lite (B-62), and the metadata store is the system's
        expect(await h.backend.request('rega.state')).toMatchObject({reason: 'openccu-lite'});
        await until(() =>
            h.events.some(
                (event) =>
                    event.name === 'meta.changed' && (event.payload as {provider: string}).provider === 'occulite',
            ),
        );
        const meta = await h.backend.request('meta.state');
        expect(meta.provider).toBe('occulite');
        expect(meta.reachable).toBe(true);
        expect(
            h.events.some(
                (event) =>
                    event.name === 'notice' &&
                    /lite-rpc with the API token/.test((event.payload as {message: string}).message),
            ),
        ).toBe(true);
    });

    it('feeds the stream into the event pipeline and writes through the paced queue', async () => {
        const h = await open();
        await h.backend.request('config.set', liteConnection() as never);
        await until(() => h.events.filter((event) => event.name === 'devices.changed').length >= 2);
        await until(() => fake.streamsOpened >= 1);

        fake.event('HmIP-RF', 'ABC1:1', 'STATE', false);
        await until(() => h.events.some((event) => event.name === 'rpc.event'));
        const record = h.events.find((event) => event.name === 'rpc.event')?.payload as {
            address: string;
            datapoint: string;
            value: unknown;
        };
        expect(record).toMatchObject({address: 'ABC1:1', datapoint: 'STATE', value: false});

        await h.backend.request('value.set', 'HmIP-RF', 'ABC1:1', 'STATE', true);
        expect(fake.calls.some((call) => call.method === 'setValue' && call.params[0] === 'ABC1:1')).toBe(true);

        // the console: a read straight through (the fake's store holds the event's value; its setValue changes nothing)
        expect(await h.backend.request('rpc.call', 'HmIP-RF', 'getValue', ['ABC1:1', 'STATE'])).toBe(false);
    });

    it('keeps the CCU path for a profile without a token, even on an openccu-lite host', async () => {
        const h = await open({
            createInterfaceManager: (options) => {
                // the manager the CCU path would build; nothing is started here
                return {
                    idle: false,
                    detected: [],
                    states: () => [
                        {
                            name: 'HmIP-RF',
                            type: 'HmIP-RF',
                            protocol: 'xmlrpc',
                            host: options.connection.host,
                            port: 2010,
                            connected: false,
                        },
                    ],
                    client: () => {
                        throw new Error('not in this test');
                    },
                    isConnected: () => false,
                    names: () => ['HmIP-RF'],
                    resolved: () => undefined,
                    start: () => Promise.resolve(),
                    stop: () => Promise.resolve(),
                    unsubscribe: () => Promise.resolve(),
                    subscribe: () => Promise.resolve(),
                    reconnect: () => Promise.resolve(),
                    noteEvent: () => undefined,
                    probeInterfaces: () => Promise.resolve([]),
                    tick: () => Promise.resolve(),
                    callbackIp: '',
                    callbackWarning: undefined,
                } as never;
            },
        });
        await h.backend.request('config.set', liteConnection({metaToken: ''}) as never);
        const states = await h.backend.request('interfaces.list');
        expect(states[0]?.lite).toBeUndefined();
        expect(fake.streamsOpened).toBe(0);
    });

    it('tests a connection: the system, what the token is worth, and a CCU or nothing elsewhere', async () => {
        const h = await open();
        const found = await h.backend.request('connection.test', liteConnection() as never);
        expect(found).toMatchObject({kind: 'openccu-lite', reachable: true, url: fake.url, implementation: 'fakebox'});
        expect(found.token).toEqual({state: 'full', scopes: ['*']});

        expect((await h.backend.request('connection.test', liteConnection({metaToken: ''}) as never)).token).toEqual({
            state: 'none',
            scopes: [],
        });
        expect(
            (await h.backend.request('connection.test', liteConnection({metaToken: 'wrong'}) as never)).token,
        ).toEqual({state: 'refused', scopes: []});

        fake.opts.scopes = ['meta:read'];
        expect((await h.backend.request('connection.test', liteConnection() as never)).token).toEqual({
            state: 'names-only',
            scopes: ['meta:read'],
        });

        const gone = new FakeBox({});
        const url = await gone.start();
        await gone.stop();
        const nothing = await h.backend.request('connection.test', liteConnection({host: new URL(url).host}) as never);
        expect(nothing).toMatchObject({kind: 'unreachable', reachable: false, reason: 'refused'});

        await expect(h.backend.request('connection.test', liteConnection({host: ''}) as never)).rejects.toMatchObject({
            kind: 'validation',
        });
    });

    it('pairs: the code comes as an event, the approval brings the token', async () => {
        const h = await open();
        expect(await h.backend.request('connection.pair', liteConnection({metaToken: ''}) as never)).toBeNull();
        await until(
            () =>
                h.events.some(
                    (event) => event.name === 'pairing.changed' && (event.payload as PairingState).state === 'approved',
                ),
            5000,
        );
        const steps = h.events
            .filter((event) => event.name === 'pairing.changed')
            .map((event) => event.payload as PairingState);
        expect(steps.map((step) => step.state)).toEqual(['requesting', 'code', 'approved']);
        const code = steps[1] as {code: string};
        expect(code.code).toMatch(/^\d{6}$/);
        const approved = steps[2] as {token: string; fingerprint256: string; scopes: string[]; name: string};
        expect(approved.token).toMatch(/^olt_/);
        expect(approved.fingerprint256).toBe('');
        expect(approved.scopes).toEqual(['rpc:read']);
        // the fake names the token after the app that asked
        expect(approved.name).toBe('homematic-manager-fake');
    });

    it('cancels a pairing, and a second one replaces the first', async () => {
        fake.opts.autoApprove = false;
        const h = await open();
        await h.backend.request('connection.pair', liteConnection({metaToken: ''}) as never);
        await until(() =>
            h.events.some(
                (event) => event.name === 'pairing.changed' && (event.payload as PairingState).state === 'code',
            ),
        );
        const request = [...fake.pairings.values()][0];
        expect(request?.app).toBe('homematic-manager');
        expect(request?.access).toEqual({devices: 'administer', names: 'configure', system: 'configure'});
        expect(await h.backend.request('connection.pairCancel')).toBeNull();
        let steps = h.events
            .filter((event) => event.name === 'pairing.changed')
            .map((event) => (event.payload as PairingState).state);
        expect(steps).toEqual(['requesting', 'code', 'cancelled']);
        // withdrawn on the system as well
        await until(() => [...fake.pairings.values()].every((request) => request.state !== 'pending'));

        await h.backend.request('connection.pair', liteConnection({metaToken: ''}) as never);
        await until(() => h.events.filter((event) => event.name === 'pairing.changed').length >= 5);
        await h.backend.request('connection.pair', liteConnection({metaToken: ''}) as never);
        await until(() => h.events.filter((event) => event.name === 'pairing.changed').length >= 8);
        steps = h.events
            .filter((event) => event.name === 'pairing.changed')
            .map((event) => (event.payload as PairingState).state);
        expect(steps.slice(3)).toEqual(['requesting', 'code', 'cancelled', 'requesting', 'code']);
        expect(await h.backend.request('connection.pairCancel')).toBeNull();
    });

    it('says when there is no openccu-lite system to pair with', async () => {
        const h = await open();
        const gone = new FakeBox({});
        const url = await gone.start();
        await gone.stop();
        await h.backend.request('connection.pair', liteConnection({host: new URL(url).host}) as never);
        await until(() =>
            h.events.some(
                (event) => event.name === 'pairing.changed' && (event.payload as PairingState).state === 'failed',
            ),
        );
        const failed = h.events
            .map((event) => event.payload as PairingState)
            .find((step) => step.state === 'failed') as {message: string};
        expect(failed.message).toMatch(/does not answer \(refused\)/);
    });
});
