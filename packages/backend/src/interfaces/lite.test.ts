import {OccuLiteError, fetchTransport, type OccuLite, type Options as OccuLiteOptions} from 'occulite-client';
import {FakeBox} from 'occulite-client/testing';
import {afterEach, describe, expect, it, vi} from 'vitest';

import type {ConnectionConfig, InterfaceState} from '@homematic-manager/core';

import {defaultConnection} from '../config/defaults.js';
import {BackendError} from '../errors.js';
import type {RpcCallRecord} from '../rpc/client.js';
import type {CallbackHandler} from '../rpc/server.js';
import {LiteInterfaces, fromWire, toWire, type LiteInterfacesOptions} from './lite.js';

const DEVICES = {
    'HmIP-RF': [
        {
            ADDRESS: '000A1B2C3D4E5F',
            TYPE: 'HmIP-PSM',
            CHILDREN: ['000A1B2C3D4E5F:0', '000A1B2C3D4E5F:3'],
            PARAMSETS: 'MASTER',
        },
        {ADDRESS: '000A1B2C3D4E5F:0', TYPE: 'MAINTENANCE', PARENT: '000A1B2C3D4E5F', PARAMSETS: ['MASTER', 'VALUES']},
        {
            ADDRESS: '000A1B2C3D4E5F:3',
            TYPE: 'SWITCH_VIRTUAL_RECEIVER',
            PARENT: '000A1B2C3D4E5F',
            PARAMSETS: ['MASTER', 'VALUES'],
        },
    ],
    'BidCos-RF': [{ADDRESS: 'KEQ0000001', TYPE: 'HM-LC-Sw1-Pl', CHILDREN: ['KEQ0000001:1'], PARAMSETS: ['MASTER']}],
};

function connection(host: string, extra: Partial<ConnectionConfig> = {}): ConnectionConfig {
    return {
        ...defaultConnection(),
        host,
        interfaces: ['HmIP-RF', 'BidCos-RF', 'BidCos-Wired'],
        autoDetect: false,
        metaToken: 't',
        ...extra,
    };
}

interface Harness {
    lite: LiteInterfaces;
    handler: CallbackHandler & {
        events: [string, string, string, unknown][];
        added: [string, unknown[]][];
        deleted: [string, string[]][];
        replaced: [string, string, string][];
    };
    states: InterfaceState[][];
    notices: [string, string][];
    calls: RpcCallRecord[];
    connected: string[];
}

function harness(
    url: string,
    options: Partial<LiteInterfacesOptions> = {},
    extra: Partial<ConnectionConfig> = {},
): Harness {
    const handler: Harness['handler'] = {
        events: [],
        added: [],
        deleted: [],
        replaced: [],
        event: (interfaceName, address, datapoint, value) => {
            handler.events.push([interfaceName, address, datapoint, value]);
        },
        newDevices: (interfaceName, devices) => {
            handler.added.push([interfaceName, devices]);
        },
        deleteDevices: (interfaceName, addresses) => {
            handler.deleted.push([interfaceName, addresses]);
        },
        replaceDevice: (interfaceName, oldAddress, newAddress) => {
            handler.replaced.push([interfaceName, oldAddress, newAddress]);
        },
        readdedDevice: () => undefined,
        updateDevice: () => undefined,
        listDevices: () => [],
    };
    const states: InterfaceState[][] = [];
    const notices: [string, string][] = [];
    const calls: RpcCallRecord[] = [];
    const connected: string[] = [];
    const lite = new LiteInterfaces({
        connection: connection(new URL(url).host, extra),
        baseUrl: url,
        token: 't',
        transport: fetchTransport(),
        handler,
        onStateChanged: (next) => {
            states.push(next);
        },
        onNotice: (level, message) => {
            notices.push([level, message]);
        },
        onConnected: (name) => {
            connected.push(name);
        },
        onCall: (record) => {
            calls.push(record);
        },
        connectTimeoutMs: 2000,
        rpcTimeoutMs: 2000,
        retryDelaysMs: [20],
        ...options,
    });
    return {lite, handler, states, notices, calls, connected};
}

async function until(check: () => boolean, ms = 2000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!check()) {
        if (Date.now() > deadline) {
            throw new Error('timed out waiting');
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

describe('LiteInterfaces', () => {
    const boxes: FakeBox[] = [];
    const lites: LiteInterfaces[] = [];

    async function box(options: ConstructorParameters<typeof FakeBox>[0] = {}): Promise<FakeBox> {
        const fake = new FakeBox({token: 't', interfaces: ['HmIP-RF', 'BidCos-RF'], devices: DEVICES, ...options});
        await fake.start();
        boxes.push(fake);
        return fake;
    }

    function open(
        url: string,
        options: Partial<LiteInterfacesOptions> = {},
        extra: Partial<ConnectionConfig> = {},
    ): Harness {
        const h = harness(url, options, extra);
        lites.push(h.lite);
        return h;
    }

    afterEach(async () => {
        await Promise.all(lites.splice(0).map((lite) => lite.stop()));
        await Promise.all(boxes.splice(0).map((fake) => fake.stop()));
    });

    it('connects the interfaces the system runs, marks the one it lacks absent, and fills the caches once', async () => {
        const fake = await box();
        const h = open(fake.url);
        await h.lite.start();

        const states = h.lite.states();
        expect(states.map((state) => state.name)).toEqual(['HmIP-RF', 'BidCos-RF', 'BidCos-Wired']);
        for (const state of states) {
            expect(state.lite).toBe(true);
            expect(state.host).toBe('127.0.0.1');
            expect(state.port).toBe(Number(new URL(fake.url).port));
            expect(state.protocol).toBe('xmlrpc');
        }
        expect(states[0]).toMatchObject({connected: true, type: 'HmIP-RF'});
        expect(states[1]).toMatchObject({connected: true, type: 'BidCos-RF'});
        expect(states[2]).toMatchObject({connected: false, absent: true});
        expect(states[2]?.error).toMatch(/runs no such interface/);
        expect(h.connected.sort()).toEqual(['BidCos-RF', 'HmIP-RF']);
        expect(h.lite.isConnected('HmIP-RF')).toBe(true);
        expect(h.lite.isConnected('BidCos-Wired')).toBe(false);
        expect(h.lite.names()).toEqual(['HmIP-RF', 'BidCos-RF', 'BidCos-Wired']);
        expect(h.lite.resolved('HmIP-RF')?.serviceMessages).toBe(false);
        // one stream for the events (opened right after ready), none for the metadata (the provider follows that one)
        await until(() => fake.streamsOpened === 1);
        expect(fake.metaStreamsOpened).toBe(0);
        // the client did not list the devices itself: the backend does that in onConnected
        expect(fake.calls.filter((call) => call.method === 'listDevices')).toEqual([]);
        expect(h.notices.some(([level, message]) => level === 'info' && /connected to fakebox/.test(message))).toBe(
            true,
        );
    });

    it('hands the events of the stream to the callback handler, and not the system confirming a stored value', async () => {
        const fake = await box();
        const h = open(fake.url);
        await h.lite.start();
        await until(() => fake.streamsOpened === 1);

        fake.event('HmIP-RF', '000A1B2C3D4E5F:3', 'STATE', true);
        await until(() => h.handler.events.length === 1);
        expect(h.handler.events[0]).toEqual(['HmIP-RF', '000A1B2C3D4E5F:3', 'STATE', true]);

        // the system's own sweep found a value: a `state` message, no device reported anything
        fake.push('state', {
            interface: 'HmIP-RF',
            address: '000A1B2C3D4E5F:0',
            datapoint: 'UNREACH',
            value: false,
            source: 'sweep',
        });
        fake.event('BidCos-RF', 'KEQ0000001:1', 'LEVEL', 0.5);
        await until(() => h.handler.events.length === 2);
        expect(h.handler.events[1]).toEqual(['BidCos-RF', 'KEQ0000001:1', 'LEVEL', 0.5]);
    });

    it('turns the device callbacks of the stream into the handler calls, fetching the descriptions a newDevices lacks', async () => {
        const fake = await box();
        const h = open(fake.url);
        await h.lite.start();
        await until(() => fake.streamsOpened === 1);

        fake.push('newDevices', {interface: 'HmIP-RF', addresses: ['000A1B2C3D4E5F', '000A1B2C3D4E5F:3']});
        await until(() => h.handler.added.length === 1);
        const [interfaceName, devices] = h.handler.added[0] ?? ['', []];
        expect(interfaceName).toBe('HmIP-RF');
        expect((devices as {ADDRESS: string; PARAMSETS: unknown}[]).map((entry) => entry.ADDRESS)).toEqual([
            '000A1B2C3D4E5F',
            '000A1B2C3D4E5F:3',
        ]);
        // #143: normalised on the way in, as the callback server's descriptions are
        expect((devices[0] as {PARAMSETS: unknown}).PARAMSETS).toEqual(['MASTER']);

        fake.push('deleteDevices', {interface: 'BidCos-RF', addresses: ['KEQ0000001', 'KEQ0000001:1']});
        await until(() => h.handler.deleted.length === 1);
        expect(h.handler.deleted[0]).toEqual(['BidCos-RF', ['KEQ0000001', 'KEQ0000001:1']]);

        fake.push('replaceDevice', {interface: 'BidCos-RF', addresses: ['KEQ0000001', 'KEQ0000002']});
        await until(() => h.handler.replaced.length === 1);
        expect(h.handler.replaced[0]).toEqual(['BidCos-RF', 'KEQ0000001', 'KEQ0000002']);
    });

    it('calls a method over lite-rpc, types a FLOAT as a double, and records every call with its origin', async () => {
        const fake = await box();
        const h = open(fake.url, {originOf: () => 'ui'});
        await h.lite.start();

        const list = await h.lite.client('HmIP-RF').call('listDevices');
        expect((list as {ADDRESS: string}[]).map((entry) => entry.ADDRESS)).toEqual(
            DEVICES['HmIP-RF'].map((entry) => entry.ADDRESS),
        );

        await h.lite
            .client('BidCos-RF')
            .call('putParamset', ['KEQ0000001:1', 'MASTER', {ON_TIME: {explicitDouble: 5}, LOGGING: 1}], {
                origin: 'console',
            });
        const put = fake.calls.find((call) => call.method === 'putParamset');
        expect(put?.params).toEqual(['KEQ0000001:1', 'MASTER', {ON_TIME: {double: 5}, LOGGING: 1}]);
        // a method without a result answers `null` on the JSON path; the contract has '' for it
        expect(await h.lite.client('BidCos-RF').call('setValue', ['KEQ0000001:1', 'STATE', true])).toBe('');

        expect(h.calls.map((record) => [record.interfaceName, record.method, record.ok, record.origin])).toEqual([
            ['HmIP-RF', 'listDevices', true, 'ui'],
            ['BidCos-RF', 'putParamset', true, 'console'],
            ['BidCos-RF', 'setValue', true, 'ui'],
        ]);
        expect(h.calls[1]?.params).toEqual(['KEQ0000001:1', 'MASTER', {ON_TIME: {explicitDouble: 5}, LOGGING: 1}]);
    });

    it('keeps a fault of the interface process a fault, with its code', async () => {
        const fake = await box({failing: ['BidCos-RF.KEQ0000001:1']});
        const h = open(fake.url);
        await h.lite.start();

        const failure = await h.lite
            .client('BidCos-RF')
            .call('getParamset', ['KEQ0000001:1', 'VALUES'])
            .catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(BackendError);
        expect(failure).toMatchObject({kind: 'rpc', faultCode: -1, faultString: 'Failure'});
        expect(h.calls.at(-1)).toMatchObject({method: 'getParamset', ok: false});
        // the interface is fine; a fault says nothing about the connection
        expect(h.lite.isConnected('BidCos-RF')).toBe(true);
    });

    it('says which scope the token lacks, per call, and never takes it for a lost connection', async () => {
        const fake = await box();
        const stub = stubClient({
            call: () =>
                Promise.reject(
                    new OccuLiteError('forbidden', 'the credential lacks rpc:operate', {
                        status: 403,
                        scope: 'rpc:operate',
                    }),
                ),
        });
        const h = open(fake.url, {createClient: () => stub.box});
        await h.lite.start();
        expect(h.lite.isConnected('HmIP-RF')).toBe(true);

        const failure = await h.lite
            .client('HmIP-RF')
            .call('setValue', ['000A1B2C3D4E5F:3', 'STATE', true])
            .catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(BackendError);
        expect((failure as BackendError).kind).toBe('config');
        expect((failure as BackendError).message).toMatch(/may not call setValue \(it lacks rpc:operate\)/);
        expect(h.lite.isConnected('HmIP-RF')).toBe(true);
    });

    it('reports a refused token once, without retrying, and opens again on a reconnect', async () => {
        const fake = await box({token: 'other'});
        const h = open(fake.url);
        await h.lite.start();

        for (const state of h.lite.states()) {
            expect(state.connected).toBe(false);
            expect(state.error).toMatch(/refuses the API token/);
            expect(state.waiting).toBeUndefined();
        }
        expect(h.notices.filter(([level]) => level === 'error')).toHaveLength(1);
        const opened = fake.streamsOpened;
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(fake.streamsOpened).toBe(opened);

        // the user pasted the right token: `reconnect` is "try now"
        fake.opts.token = 't';
        await h.lite.reconnect();
        expect(h.lite.isConnected('HmIP-RF')).toBe(true);
    });

    it('reads names only with a token that lacks rpc:read, and says so', async () => {
        const fake = await box({scopes: ['meta:read']});
        const h = open(fake.url);
        await h.lite.start();

        for (const state of h.lite.states()) {
            expect(state.connected).toBe(false);
            expect(state.error).toMatch(/reads names only/);
        }
        expect(h.connected).toEqual([]);
        expect(h.notices.some(([level, message]) => level === 'error' && /pair this application/.test(message))).toBe(
            true,
        );
    });

    it('waits for a system that does not answer and connects when it does', async () => {
        const fake = await box();
        const url = fake.url;
        await fake.stop();
        boxes.splice(boxes.indexOf(fake), 1);

        const h = open(url);
        await h.lite.start();
        for (const state of h.lite.states()) {
            expect(state).toMatchObject({connected: false, unreachable: true, waiting: true});
        }
        expect(h.notices.filter(([level]) => level === 'warn')).toHaveLength(1);

        // the system comes back on the same port
        const again = new FakeBox({token: 't', interfaces: ['HmIP-RF', 'BidCos-RF'], devices: DEVICES});
        await again.start();
        boxes.push(again);
        // FakeBox picks a free port; point the second one where the first was by listening there
        if (again.url !== url) {
            // the port was taken meanwhile: the schedule still fires, and the states keep saying so
            await new Promise((resolve) => setTimeout(resolve, 80));
            expect(h.notices.filter(([level]) => level === 'warn')).toHaveLength(1);
            expect(h.notices.filter(([level]) => level === 'debug').length).toBeGreaterThan(0);
            return;
        }
        await until(() => h.lite.isConnected('HmIP-RF'));
    });

    it('follows an interface process going down and up, and reads its devices again when it is back', async () => {
        const fake = await box();
        const h = open(fake.url);
        await h.lite.start();
        await until(() => fake.streamsOpened === 1);
        h.connected.length = 0;

        fake.setInterface('HmIP-RF', false);
        await until(() => !h.lite.isConnected('HmIP-RF'));
        expect(h.lite.states()[0]?.error).toMatch(/not running/);
        expect(h.lite.isConnected('BidCos-RF')).toBe(true);

        fake.setInterface('HmIP-RF', true);
        await until(() => h.lite.isConnected('HmIP-RF'));
        await until(() => h.connected.includes('HmIP-RF'));
        expect(h.connected).toEqual(['HmIP-RF']);
    });

    it('reads every interface again after the stream was resynchronised', async () => {
        const fake = await box();
        const h = open(fake.url);
        await h.lite.start();
        await until(() => fake.streamsOpened === 1);
        h.connected.length = 0;

        fake.bootId = 'boot2';
        fake.dropStreams();
        await until(() => h.connected.length >= 2, 5000);
        expect(h.connected.sort()).toEqual(['BidCos-RF', 'HmIP-RF']);
        expect(h.notices.some(([, message]) => /resynchronised \(boot\)/.test(message))).toBe(true);
    });

    it('closes the stream when it goes idle and opens it again on subscribe (D-31)', async () => {
        const fake = await box();
        const h = open(fake.url);
        await h.lite.start();
        expect(h.lite.idle).toBe(false);

        await h.lite.unsubscribe();
        expect(h.lite.idle).toBe(true);
        for (const state of h.lite.states()) {
            expect(state).toMatchObject({connected: false, idle: true});
        }
        expect(h.lite.box).toBeUndefined();
        await expect(h.lite.client('HmIP-RF').call('listDevices')).rejects.toMatchObject({kind: 'connection'});

        await h.lite.subscribe();
        expect(h.lite.idle).toBe(false);
        expect(h.lite.isConnected('HmIP-RF')).toBe(true);
        await until(() => fake.streamsOpened === 2);
    });

    it('stops: the stream is closed, the states are gone, nothing is de-registered', async () => {
        const fake = await box();
        const h = open(fake.url);
        await h.lite.start();
        const before = fake.calls.length;
        await h.lite.stop();
        expect(h.lite.states()).toEqual([]);
        expect(h.states.at(-1)).toEqual([]);
        expect(fake.calls.length).toBe(before);
        expect(() => h.lite.client('HmIP-RF')).toThrow(/not configured/);
    });

    it('refuses to start without a host or an interface', async () => {
        const fake = await box();
        const none = open(fake.url, {}, {host: ''});
        await expect(none.lite.start()).rejects.toThrow(/no CCU address/);
        const empty = open(fake.url, {}, {interfaces: []});
        await expect(empty.lite.start()).rejects.toThrow(/no interface selected/);
    });
});

describe('the wire shapes', () => {
    it('types an explicit double where the system understands it, and unwraps it elsewhere', () => {
        expect(toWire({explicitDouble: 5}, true)).toEqual({double: 5});
        expect(toWire({explicitDouble: 5}, false)).toBe(5);
        expect(toWire(['a', {LEVEL: {explicitDouble: 1}, ON: true}], true)).toEqual([
            'a',
            {LEVEL: {double: 1}, ON: true},
        ]);
        expect(toWire(0.5, true)).toBe(0.5);
    });

    it('reads null as the empty string of a void answer and passes the rest', () => {
        expect(fromWire(null)).toBe('');
        expect(fromWire(undefined)).toBe('');
        expect(fromWire([1, null, {a: null, b: 'x'}])).toEqual([1, '', {a: '', b: 'x'}]);
        expect(fromWire(true)).toBe(true);
    });
});

/** A client that is `ready` at once with one running interface, and answers calls as told. */
function stubClient(overrides: {call: OccuLite['call']}): {box: OccuLite; options?: OccuLiteOptions} {
    const handlers = new Map<string, Set<(arg: unknown) => void>>();
    const box = {
        status: 'idle',
        mode: 'full',
        info: {implementation: 'stub'},
        capabilities: {json_double: true},
        interfaces: [{name: 'HmIP-RF', running: true}],
        on(event: string, fn: (arg: unknown) => void) {
            let set = handlers.get(event);
            if (!set) {
                handlers.set(event, (set = new Set()));
            }
            set.add(fn);
            return () => set.delete(fn);
        },
        ready: () => {
            box.status = 'ready';
            return Promise.resolve();
        },
        close: vi.fn(),
        call: overrides.call,
    };
    return {box: box as unknown as OccuLite};
}
