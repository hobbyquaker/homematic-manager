import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import type {ApiEventName, DeviceDescription, RpcValue} from '@homematic-manager/core';

import {BackendError} from '../errors.js';
import type {RpcClient, RpcClientOptions, RpcOutValue} from '../rpc/client.js';
import type {CallbackHandler, CallbackServerSet} from '../rpc/server.js';
import {Backend, type BackendOptions} from './backend.js';
import {InProcessTransport} from './transport.js';

const HMIP_DEVICES: DeviceDescription[] = [
    {ADDRESS: 'ABC1', TYPE: 'HmIP-PDT', FIRMWARE: '1.4.8', VERSION: 1, CHILDREN: ['ABC1:0', 'ABC1:1']},
    {ADDRESS: 'ABC1:0', TYPE: 'MAINTENANCE', PARENT: 'ABC1', VERSION: 1},
    {ADDRESS: 'ABC1:1', TYPE: 'SWITCH_TRANSCEIVER', PARENT: 'ABC1', VERSION: 1},
];

const BIDCOS_DEVICES: DeviceDescription[] = [
    {ADDRESS: 'LEQ1', TYPE: 'HM-LC-Sw1-Pl', FIRMWARE: '2.8', VERSION: 1, CHILDREN: ['LEQ1:1']},
    {ADDRESS: 'LEQ1:1', TYPE: 'SWITCH', PARENT: 'LEQ1', VERSION: 1},
];

type Answer = (method: string, params: readonly RpcOutValue[]) => RpcValue | Error;

interface Harness {
    backend: Backend;
    calls: {interfaceName: string; method: string; params: readonly RpcOutValue[]}[];
    handler: CallbackHandler;
    events: {name: ApiEventName; payload: unknown}[];
    dir: string;
    rega: {getChannels: ReturnType<typeof vi.fn>; exec: ReturnType<typeof vi.fn>};
}

let dir: string;

beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-backend-'));
});

afterEach(async () => {
    await fs.rm(dir, {recursive: true, force: true});
});

const defaultAnswers: Record<string, Answer> = {
    'HmIP-RF': (method, params) => {
        switch (method) {
            case 'listDevices':
                return HMIP_DEVICES as unknown as RpcValue;
            case 'listBidcosInterfaces':
                return [{ADDRESS: 'XEQ0123456', TYPE: 'HMIP_CCU'}];
            case 'getParamset':
                return params[1] === 'VALUES'
                    ? {RSSI_DEVICE: -60, RSSI_PEER: -62, STICKY_UNREACH: false, LOGGING: false}
                    : {LOGGING: false};
            case 'getParamsetDescription':
                return {LOGGING: {TYPE: 'BOOL', OPERATIONS: 7, DEFAULT: false}};
            default:
                return '';
        }
    },
    'BidCos-RF': (method) => {
        switch (method) {
            case 'listDevices':
                return BIDCOS_DEVICES as unknown as RpcValue;
            case 'getServiceMessages':
                return [['LEQ1:0', 'STICKY_UNREACH', true]];
            case 'rssiInfo':
                return {LEQ1: {BidCos: [-70, -80]}};
            default:
                return '';
        }
    },
};

async function harness(
    options: {
        answers?: Record<string, Answer>;
        connection?: Record<string, unknown>;
        backend?: Partial<BackendOptions>;
        regaChannels?: {id: number; address: string; name: string}[];
    } = {},
): Promise<Harness> {
    const calls: Harness['calls'] = [];
    const events: Harness['events'] = [];
    let handler: CallbackHandler | undefined;
    const answers = {...defaultAnswers, ...options.answers};

    const servers: CallbackServerSet = {
        ensure: () => Promise.resolve(2042),
        port: () => 2042,
        callbackUrl: (protocol, ip) => `${protocol === 'binrpc' ? 'xmlrpc_bin://' : 'http://'}${ip}:2042`,
        stop: () => Promise.resolve(),
    };

    const createClient = (clientOptions: RpcClientOptions): RpcClient =>
        ({
            name: clientOptions.name,
            host: clientOptions.host,
            port: clientOptions.port,
            protocol: clientOptions.protocol,
            closed: false,
            description: clientOptions.name,
            call: (method: string, params: readonly RpcOutValue[] = []) => {
                calls.push({interfaceName: clientOptions.name, method, params});
                const answer = (answers[clientOptions.name] ?? (() => ''))(method, params);
                // the real client reports every finished call; the write log hangs off that hook
                const record = {
                    interfaceName: clientOptions.name,
                    method,
                    params: [...params],
                    durationMs: 0,
                    timestamp: Date.now(),
                };
                if (answer instanceof Error) {
                    clientOptions.onCall?.({...record, ok: false, error: answer.message});
                    return Promise.reject(answer);
                }
                clientOptions.onCall?.({...record, ok: true, result: answer});
                return Promise.resolve(answer);
            },
            close: () => undefined,
        }) as unknown as RpcClient;

    const rega = {
        getChannels: vi.fn(() =>
            Promise.resolve(options.regaChannels ?? [{id: 4711, address: 'ABC1:1', name: 'Lamp'}]),
        ),
        exec: vi.fn((script: string) => Promise.resolve({output: script, objects: {}})),
    };

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
        discover: () => Promise.resolve([{address: '10.0.0.1', name: 'ccu3', interfaces: ['HmIP-RF']}]),
        regaOptions: {createClient: () => rega},
        interfaceManagerOptions: {
            createClient,
            createCallbackServers: (incoming) => {
                handler = incoming;
                return servers;
            },
            probe: () => Promise.resolve(true),
            watchdogIntervalMs: 0,
        },
        ...options.backend,
    });

    for (const name of [
        'interfaces.changed',
        'rega.changed',
        'devices.changed',
        'names.changed',
        'rpc.event',
        'serviceMessages.changed',
        'writeLog.appended',
        'write.progress',
        'unreach.changed',
        'config.changed',
        'notice',
    ] satisfies ApiEventName[]) {
        backend.on(name, (payload) => events.push({name, payload}));
    }

    await backend.request('config.set', {
        host: 'ccu.lan',
        interfaces: ['HmIP-RF', 'BidCos-RF'],
        autoDetect: false,
        callback: {ip: '192.168.1.5', xmlrpcPort: 0, binrpcPort: 0},
        ...options.connection,
    } as never);

    return {backend, calls, handler: handler as CallbackHandler, events, dir, rega};
}

describe('smoke detector teams (#97)', () => {
    const TEAM = {
        ADDRESS: 'NEQ1000002-TEAM:1',
        TYPE: 'SMOKE_DETECTOR_TEAM',
        VERSION: 1,
        TEAM_TAG: 'SMOKE_DETECTOR',
        TEAM_CHANNELS: ['NEQ1000002:1'],
    };

    it('lists the teams and puts a channel into one', async () => {
        const h = await harness({
            answers: {
                'BidCos-RF': (method) => {
                    switch (method) {
                        case 'listDevices':
                            return BIDCOS_DEVICES as unknown as RpcValue;
                        case 'listTeams':
                            return [TEAM];
                        default:
                            return '';
                    }
                },
            },
        });

        await expect(h.backend.request('teams.list', 'BidCos-RF')).resolves.toEqual([TEAM]);

        await h.backend.request('teams.set', 'BidCos-RF', 'NEQ1000001:1', 'NEQ1000002-TEAM:1');
        const call = h.calls.find((entry) => entry.method === 'setTeam');
        expect(call?.params).toEqual(['NEQ1000001:1', 'NEQ1000002-TEAM:1']);
        // the description changes with it, so the device list is re-read rather than left stale
        expect(h.calls.filter((entry) => entry.method === 'listDevices').length).toBeGreaterThan(1);
        await h.backend.stop();
    });

    it('sends the empty team address that puts a channel back into its own', async () => {
        const h = await harness();
        await h.backend.request('teams.set', 'BidCos-RF', 'NEQ1000001:1', '');
        expect(h.calls.find((entry) => entry.method === 'setTeam')?.params).toEqual(['NEQ1000001:1', '']);
        await h.backend.stop();
    });

    it('reports an interface that has no teams as a fault, not as an empty list', async () => {
        const h = await harness({
            answers: {
                'HmIP-RF': (method) =>
                    method === 'listTeams'
                        ? new BackendError({message: 'unknown method name', kind: 'rpc', faultCode: -1})
                        : (HMIP_DEVICES as unknown as RpcValue),
            },
        });
        await expect(h.backend.request('teams.list', 'HmIP-RF')).rejects.toMatchObject({kind: 'rpc'});
        await h.backend.stop();
    });
});

describe('unreach counters and the auto-acknowledge (#26)', () => {
    it('counts one outage however often the interface repeats it, and persists it', async () => {
        const h = await harness();
        h.handler.event('BidCos-RF', 'LEQ1:0', 'UNREACH', true);
        h.handler.event('BidCos-RF', 'LEQ1:0', 'UNREACH', true);
        h.handler.event('BidCos-RF', 'LEQ1:0', 'STICKY_UNREACH', true);

        expect(await h.backend.request('unreach.list')).toEqual([
            {
                interfaceName: 'BidCos-RF',
                address: 'LEQ1',
                count: 1,
                lastAt: expect.any(Number) as number,
                unreach: true,
            },
        ]);
        expect(h.events.filter((event) => event.name === 'unreach.changed')).toHaveLength(1);

        // back, then away again: that is a second outage
        h.handler.event('BidCos-RF', 'LEQ1:0', 'UNREACH', false);
        h.handler.event('BidCos-RF', 'LEQ1:0', 'UNREACH', true);
        expect((await h.backend.request('unreach.list'))[0]?.count).toBe(2);

        // and it survives a restart of the backend against the same profile
        await h.backend.stop();
        const second = await harness({backend: {dataDir: dir}});
        expect((await second.backend.request('unreach.list', 'BidCos-RF'))[0]).toMatchObject({
            address: 'LEQ1',
            count: 2,
        });
        await second.backend.stop();
    });

    it('leaves STICKY_UNREACH alone unless the setting is on', async () => {
        const h = await harness();
        h.handler.event('BidCos-RF', 'LEQ1:0', 'STICKY_UNREACH', true);
        await Promise.resolve();
        expect(h.calls.filter((call) => call.method === 'setValue')).toHaveLength(0);
        expect(await h.backend.request('serviceMessages.list', 'BidCos-RF')).toHaveLength(1);
        await h.backend.stop();
    });

    it('acknowledges it when the setting is on, and keeps the count (#26)', async () => {
        const h = await harness({
            answers: {
                'BidCos-RF': (method) => {
                    switch (method) {
                        case 'listDevices':
                            return BIDCOS_DEVICES as unknown as RpcValue;
                        case 'getParamsetDescription':
                            return {STICKY_UNREACH: {TYPE: 'BOOL', OPERATIONS: 7}};
                        default:
                            return '';
                    }
                },
            },
        });
        const config = await h.backend.request('config.get');
        await h.backend.request('config.set', {...config.connection, autoAckStickyUnreach: true});

        h.handler.event('BidCos-RF', 'LEQ1:0', 'STICKY_UNREACH', true);
        await vi.waitFor(() => {
            expect(
                h.calls.filter((call) => call.method === 'setValue' && call.params[1] === 'STICKY_UNREACH'),
            ).toHaveLength(1);
        });
        // the value written is `false`, which is what the acknowledge button sends
        const write = h.calls.find((call) => call.method === 'setValue' && call.params[1] === 'STICKY_UNREACH');
        expect(write?.params[2]).toBe(false);
        // the message is gone, the counter is not - that is what makes the setting safe to use
        expect((await h.backend.request('unreach.list'))[0]?.count).toBe(1);
        await h.backend.stop();
    });

    it('reports a device that will not take the acknowledgement as a notice, not as a failure', async () => {
        const h = await harness({
            answers: {
                'BidCos-RF': (method) => {
                    switch (method) {
                        case 'setValue':
                            return new BackendError({message: 'not reachable', kind: 'rpc'});
                        case 'listDevices':
                            return BIDCOS_DEVICES as unknown as RpcValue;
                        case 'getParamsetDescription':
                            return {STICKY_UNREACH: {TYPE: 'BOOL', OPERATIONS: 7}};
                        default:
                            return '';
                    }
                },
            },
        });
        const config = await h.backend.request('config.get');
        await h.backend.request('config.set', {...config.connection, autoAckStickyUnreach: true});

        h.handler.event('BidCos-RF', 'LEQ1:0', 'STICKY_UNREACH', true);
        await vi.waitFor(() => {
            expect(
                h.events.some(
                    (event) =>
                        event.name === 'notice' &&
                        JSON.stringify(event.payload).includes('could not be acknowledged automatically'),
                ),
            ).toBe(true);
        });
        await h.backend.stop();
    });

    it('resets one device, one interface and everything', async () => {
        const h = await harness();
        h.handler.event('BidCos-RF', 'LEQ1:0', 'UNREACH', true);
        h.handler.event('BidCos-RF', 'LEQ1:0', 'UNREACH', false);
        h.handler.event('HmIP-RF', 'ABC1:0', 'UNREACH', true);
        h.handler.event('HmIP-RF', 'ABC1:0', 'UNREACH', false);

        await h.backend.request('unreach.reset', 'BidCos-RF', 'LEQ1');
        expect(await h.backend.request('unreach.list', 'BidCos-RF')).toEqual([]);
        await h.backend.request('unreach.reset');
        expect(await h.backend.request('unreach.list')).toEqual([]);
        await h.backend.stop();
    });
});

describe('idle unsubscribe (D-31)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    /** The `init` calls of one interface, in order, as `[url, ident]` pairs. */
    const inits = (h: Awaited<ReturnType<typeof harness>>, name = 'HmIP-RF'): string[] =>
        h.calls
            .filter((call) => call.interfaceName === name && call.method === 'init')
            .map((call) => (typeof call.params[1] === 'string' ? call.params[1] : ''));

    it('drops the subscriptions after the grace period and takes them up again on connect', async () => {
        const h = await harness({backend: {idleUnsubscribeMs: 60_000}});
        expect(inits(h)).toEqual(['hmm_HmIP-RF']);

        // one session opens and closes again
        h.backend.noteSessions(1);
        h.backend.noteSessions(0);
        await vi.advanceTimersByTimeAsync(59_000);
        expect(inits(h)).toEqual(['hmm_HmIP-RF']);

        await vi.advanceTimersByTimeAsync(2000);
        expect(inits(h)).toEqual(['hmm_HmIP-RF', '']);
        const idle = (await h.backend.request('interfaces.list')).find((state) => state.name === 'HmIP-RF');
        expect(idle?.idle).toBe(true);
        expect(idle?.connected).toBe(false);
        // the caches are kept: a `devices.list` still answers without asking the interface
        const before = h.calls.filter((call) => call.method === 'listDevices').length;
        expect(await h.backend.request('devices.list', 'HmIP-RF')).toHaveLength(3);
        expect(h.calls.filter((call) => call.method === 'listDevices')).toHaveLength(before);

        h.backend.noteSessions(1);
        await vi.advanceTimersByTimeAsync(10);
        expect(inits(h)).toEqual(['hmm_HmIP-RF', '', 'hmm_HmIP-RF']);
        const back = (await h.backend.request('interfaces.list')).find((state) => state.name === 'HmIP-RF');
        expect(back?.connected).toBe(true);
        expect(back?.idle).toBeUndefined();
        expect(back?.subscribing).toBeUndefined();
        await h.backend.stop();
    });

    it('cancels the grace period when a session comes back inside it', async () => {
        const h = await harness({backend: {idleUnsubscribeMs: 60_000}});
        h.backend.noteSessions(1);
        h.backend.noteSessions(0);
        await vi.advanceTimersByTimeAsync(30_000);
        h.backend.noteSessions(1);
        await vi.advanceTimersByTimeAsync(120_000);
        // nothing was dropped, and nothing was subscribed a second time
        expect(inits(h)).toEqual(['hmm_HmIP-RF']);
        await h.backend.stop();
    });

    it('never subscribes twice for a second session', async () => {
        const h = await harness({backend: {idleUnsubscribeMs: 60_000}});
        h.backend.noteSessions(1);
        h.backend.noteSessions(2);
        h.backend.noteSessions(1);
        await vi.advanceTimersByTimeAsync(120_000);
        expect(inits(h)).toEqual(['hmm_HmIP-RF']);
        await h.backend.stop();
    });

    it('does nothing at all when the option is off, which is the Electron case', async () => {
        const h = await harness();
        h.backend.noteSessions(1);
        h.backend.noteSessions(0);
        await vi.advanceTimersByTimeAsync(600_000);
        expect(inits(h)).toEqual(['hmm_HmIP-RF']);
        await h.backend.stop();
    });

    it('reports the interface as subscribing until the device sweep is through', async () => {
        const h = await harness({backend: {idleUnsubscribeMs: 60_000}});
        h.backend.noteSessions(1);
        h.backend.noteSessions(0);
        await vi.advanceTimersByTimeAsync(61_000);

        const states: unknown[] = [];
        h.backend.on('interfaces.changed', (payload) => states.push(payload));
        h.backend.noteSessions(1);
        await vi.advanceTimersByTimeAsync(10);
        // one of the intermediate broadcasts had the flag set; the last one has it cleared
        const flat = states.flat() as {name: string; subscribing?: boolean}[];
        expect(flat.some((state) => state.subscribing === true)).toBe(true);
        expect((await h.backend.request('interfaces.list')).every((state) => state.subscribing !== true)).toBe(true);
        await h.backend.stop();
    });
});

describe('config', () => {
    it('answers config.get with the defaults on a fresh profile', async () => {
        const backend = await Backend.open({dataDir: dir, importLegacy: false, localAddresses: () => ['10.0.0.2']});
        const config = await backend.request('config.get');
        expect(config.version).toBe('3.0.0-dev.0');
        expect(config.connection.host).toBe('');
        expect(config.localAddresses).toEqual(['10.0.0.2']);
        await backend.stop();
    });

    it('does not connect without a host and says so', async () => {
        const notices: string[] = [];
        const backend = await Backend.open({dataDir: dir, importLegacy: false});
        backend.on('notice', (notice) => notices.push(notice.message));
        await backend.start();
        expect(notices.some((message) => message.includes('no CCU address configured'))).toBe(true);
        expect(await backend.request('interfaces.list')).toEqual([]);
        await backend.stop();
    });

    it('reports the imported 2.x configuration as a notice (D-17)', async () => {
        const home = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-home-'));
        await fs.mkdir(path.join(home, '.hm-manager'), {recursive: true});
        await fs.writeFile(path.join(home, '.hm-manager', 'config'), JSON.stringify({ccuAddress: '10.0.0.1'}), 'utf8');
        const notices: string[] = [];
        const backend = await Backend.open({
            dataDir: dir,
            legacyEnvironment: {platform: 'linux', appData: '', home},
            watchdogIntervalMs: 0,
            regaOptions: {
                createClient: () => ({
                    getChannels: () => Promise.reject(new Error('offline')),
                    exec: () => Promise.reject(new Error('offline')),
                }),
            },
            interfaceManagerOptions: {
                createClient: () =>
                    ({call: () => Promise.reject(new Error('offline')), close: () => undefined}) as never,
                createCallbackServers: () => ({
                    ensure: () => Promise.resolve(1),
                    port: () => 1,
                    callbackUrl: () => 'http://127.0.0.1:1',
                    stop: () => Promise.resolve(),
                }),
                probe: () => Promise.resolve(false),
                watchdogIntervalMs: 0,
            },
        });
        backend.on('notice', (notice) => notices.push(notice.message));
        await backend.start();
        expect(notices[0]).toContain('2.x was imported');
        await expect(backend.request('config.get')).resolves.toMatchObject({connection: {host: '10.0.0.1'}});
        await backend.stop();
        await fs.rm(home, {recursive: true, force: true});
    });

    it('connects on config.set and emits config.changed', async () => {
        const h = await harness();
        expect(h.events.some((event) => event.name === 'config.changed')).toBe(true);
        const states = await h.backend.request('interfaces.list');
        expect(states.map((state) => [state.name, state.connected])).toEqual([
            ['HmIP-RF', true],
            ['BidCos-RF', true],
        ]);
        await h.backend.stop();
    });

    it('runs the discovery and remembers the result', async () => {
        const h = await harness();
        const found = await h.backend.request('config.discover');
        expect(found).toEqual([{address: '10.0.0.1', name: 'ccu3', interfaces: ['HmIP-RF']}]);
        expect((await h.backend.request('config.get')).discovered).toEqual(found);
        await h.backend.stop();
    });

    it('clears the caches', async () => {
        const h = await harness();
        await h.backend.request('devices.list', 'HmIP-RF');
        expect(await h.backend.request('config.clearCaches')).toBeNull();
        expect(h.events.some((event) => event.name === 'names.changed')).toBe(true);
        await h.backend.stop();
    });
});

describe('interfaces and rega', () => {
    it('reconnects one interface', async () => {
        const h = await harness();
        h.calls.length = 0;
        await h.backend.request('interfaces.reconnect', 'HmIP-RF');
        expect(h.calls.filter((call) => call.method === 'init').map((call) => call.interfaceName)).toEqual(['HmIP-RF']);
        await h.backend.stop();
    });

    it('refuses to reconnect an interface that is not configured', async () => {
        const h = await harness();
        await expect(h.backend.request('interfaces.reconnect', 'CUxD')).rejects.toThrow('is not configured');
        await h.backend.stop();
    });

    it('reports the ReGa state and merges its names', async () => {
        const h = await harness();
        expect(await h.backend.request('rega.state')).toEqual({enabled: true, reachable: true, names: 1});
        expect(await h.backend.request('names.get')).toEqual({'ABC1:1': 'Lamp'});
        await h.backend.stop();
    });

    it('degrades to the local names when ReGa fails (D-2)', async () => {
        const h = await harness({regaChannels: []});
        h.rega.getChannels.mockRejectedValueOnce(new Error('401 Unauthorized'));
        await h.backend.request('interfaces.reconnect');
        const state = await h.backend.request('rega.state');
        expect(state.enabled).toBe(true);
        await h.backend.stop();
    });

    it('says ReGa is off before anything is connected', async () => {
        const backend = await Backend.open({dataDir: dir, importLegacy: false});
        expect(await backend.request('rega.state')).toEqual({enabled: true, reachable: false, names: 0});
        await backend.stop();
    });
});

describe('devices', () => {
    it('lists from the cache and refreshes on demand', async () => {
        const h = await harness();
        h.calls.length = 0;
        const cached = await h.backend.request('devices.list', 'HmIP-RF');
        expect(cached.map((device) => device.ADDRESS)).toEqual(['ABC1', 'ABC1:0', 'ABC1:1']);
        expect(h.calls.filter((call) => call.method === 'listDevices')).toEqual([]);
        await h.backend.request('devices.list', 'HmIP-RF', {refresh: true});
        expect(h.calls.filter((call) => call.method === 'listDevices')).toHaveLength(1);
        await h.backend.stop();
    });

    it('answers a description from the cache and asks the interface for an unknown one', async () => {
        const h = await harness({
            answers: {
                'HmIP-RF': (method, params) =>
                    method === 'getDeviceDescription'
                        ? {ADDRESS: params[0] as string, TYPE: 'HmIP-NEW'}
                        : (defaultAnswers['HmIP-RF'] as Answer)(method, params),
            },
        });
        expect((await h.backend.request('devices.description', 'HmIP-RF', 'ABC1')).TYPE).toBe('HmIP-PDT');
        expect((await h.backend.request('devices.description', 'HmIP-RF', 'NEW1')).TYPE).toBe('HmIP-NEW');
        await h.backend.stop();
    });

    it('reports a description the interface does not answer with', async () => {
        const h = await harness({answers: {'HmIP-RF': () => ''}});
        await expect(h.backend.request('devices.description', 'HmIP-RF', 'NEW1')).rejects.toThrow('no description');
        await h.backend.stop();
    });

    it('deletes a device and drops it from the cache', async () => {
        const h = await harness();
        await h.backend.request('devices.list', 'HmIP-RF');
        expect(await h.backend.request('devices.delete', 'HmIP-RF', 'ABC1', 1)).toBeNull();
        expect(h.calls.some((call) => call.method === 'deleteDevice')).toBe(true);
        const changed = h.events.filter((event) => event.name === 'devices.changed').at(-1);
        expect(changed?.payload).toMatchObject({kind: 'deleted'});
        await h.backend.stop();
    });

    it('passes the small device calls through', async () => {
        const h = await harness({
            answers: {
                'HmIP-RF': (method, params) => {
                    switch (method) {
                        case 'replaceDevice':
                            return true;
                        case 'reportValueUsage':
                            return 2;
                        case 'updateFirmware':
                            return [true, false];
                        case 'installFirmware':
                            return true;
                        case 'listReplaceableDevices':
                            return [{ADDRESS: 'DEF1', TYPE: 'HmIP-PDT'}];
                        case 'getInstallMode':
                            return 42;
                        default:
                            return (defaultAnswers['HmIP-RF'] as Answer)(method, params);
                    }
                },
            },
        });
        expect(await h.backend.request('devices.replace', 'HmIP-RF', 'A', 'B')).toBe(true);
        expect(await h.backend.request('devices.reportValueUsage', 'HmIP-RF', 'A:1', 'STATE', 1)).toBe(2);
        expect(await h.backend.request('devices.restoreConfig', 'HmIP-RF', 'A')).toBeNull();
        expect(await h.backend.request('devices.clearConfigCache', 'HmIP-RF', 'A')).toBeNull();
        expect(await h.backend.request('devices.updateFirmware', 'HmIP-RF', ['A'])).toEqual([true, false]);
        expect(await h.backend.request('devices.installFirmware', 'HmIP-RF', 'A')).toBe(true);
        expect(await h.backend.request('devices.replaceable', 'HmIP-RF', 'A')).toHaveLength(1);
        expect(await h.backend.request('devices.installMode.get', 'HmIP-RF')).toBe(42);
        await h.backend.stop();
    });

    it('opens the install mode in every variant', async () => {
        const h = await harness();
        h.calls.length = 0;
        await h.backend.request('devices.installMode.set', 'BidCos-RF', true, {seconds: 60, mode: 2, tempKey: 'K'});
        await h.backend.request('devices.installMode.set', 'HmIP-RF', true, {
            hmipKey: {sgtin: '3014F711A000000000001234', key: 'AAAAAAAAAAAA'},
        });
        await h.backend.request('devices.installMode.set', 'HmIP-RF', false);
        const install = h.calls.filter((call) => call.method.startsWith('set'));
        expect(install.map((call) => call.method)).toEqual([
            'setTempKey',
            'setInstallMode',
            'setInstallModeWithWhitelist',
            'setInstallMode',
        ]);
        await h.backend.stop();
    });
});

describe('the callbacks', () => {
    it('records an event, pushes it and keeps the interface alive', async () => {
        const h = await harness();
        h.handler.event('HmIP-RF', 'ABC1:1', 'STATE', true);
        const pushed = h.events.filter((event) => event.name === 'rpc.event');
        expect(pushed.at(-1)?.payload).toMatchObject({address: 'ABC1:1', datapoint: 'STATE', value: true});
        expect(await h.backend.request('events.recent', 'HmIP-RF')).toHaveLength(1);
        expect(await h.backend.request('events.recent', 'BidCos-RF')).toHaveLength(0);
        expect(await h.backend.request('events.clear')).toBeNull();
        expect(await h.backend.request('events.recent')).toHaveLength(0);
        await h.backend.stop();
    });

    it('files a service message from an event', async () => {
        const h = await harness();
        h.handler.event('HmIP-RF', 'ABC1:0', 'STICKY_UNREACH', true);
        expect(await h.backend.request('serviceMessages.list', 'HmIP-RF')).toEqual([
            expect.objectContaining({address: 'ABC1:0', datapoint: 'STICKY_UNREACH', value: true}),
        ]);
        h.handler.event('HmIP-RF', 'ABC1:0', 'STICKY_UNREACH', false);
        expect(await h.backend.request('serviceMessages.list', 'HmIP-RF')).toEqual([]);
        await h.backend.stop();
    });

    it('files an HmIP RSSI event against the access point', async () => {
        const h = await harness();
        h.handler.event('HmIP-RF', 'ABC1:0', 'RSSI_DEVICE', -55);
        const matrix = await h.backend.request('rssi.get', 'HmIP-RF');
        expect(matrix['XEQ0123456']?.['ABC1']?.[0]).toBe(-55);
        await h.backend.stop();
    });

    it('adds, deletes and replaces devices in the cache', async () => {
        const h = await harness();
        h.handler.newDevices('BidCos-RF', [{ADDRESS: 'LEQ2', TYPE: 'HM-LC-Sw1-Pl'}]);
        expect((await h.backend.request('devices.list', 'BidCos-RF')).map((d) => d.ADDRESS)).toContain('LEQ2');
        h.handler.deleteDevices('BidCos-RF', ['LEQ2']);
        expect((await h.backend.request('devices.list', 'BidCos-RF')).map((d) => d.ADDRESS)).not.toContain('LEQ2');
        await h.backend.request('names.set', [{address: 'LEQ1', name: 'Old'}]);
        h.handler.replaceDevice('BidCos-RF', 'LEQ1', 'LEQ3');
        expect(await h.backend.request('names.get')).toMatchObject({LEQ3: 'Old'});
        await h.backend.stop();
    });

    it('answers listDevices from the cache in the reduced HmIP shape', async () => {
        const h = await harness();
        const answer = h.handler.listDevices('HmIP-RF');
        expect(answer).toHaveLength(3);
        expect(answer[0]).toMatchObject({ADDRESS: 'ABC1', TYPE: 'HmIP-PDT'});
        expect(h.handler.listDevices('BidCos-RF')[0]).toEqual({ADDRESS: 'LEQ1', VERSION: 1});
        await h.backend.stop();
    });

    it('reports readded, updated and unknown callbacks', async () => {
        const h = await harness();
        h.handler.readdedDevice('HmIP-RF', ['ABC1']);
        h.handler.updateDevice('HmIP-RF', 'ABC1', 1);
        h.handler.readyConfig?.('HmIP-RF');
        h.handler.unknownMethod?.('foo.bar', []);
        h.handler.unknownMethod?.('foo.bar', []);
        const refreshed = h.events.filter(
            (event) => event.name === 'devices.changed' && (event.payload as {kind: string}).kind === 'refreshed',
        );
        expect(refreshed.length).toBeGreaterThanOrEqual(2);
        // one notice for the unknown method, none for the second call, none for setReadyConfig
        expect(h.events.filter((event) => event.name === 'notice').length).toBe(1);
        await h.backend.stop();
    });
});

describe('paramsets, values and links', () => {
    it('reads a paramset and caches its description by identity', async () => {
        const h = await harness();
        expect(await h.backend.request('paramset.get', 'HmIP-RF', 'ABC1:1', 'MASTER')).toEqual({LOGGING: false});
        await h.backend.request('paramset.description', 'HmIP-RF', 'ABC1:1', 'MASTER');
        h.calls.length = 0;
        await h.backend.request('paramset.description', 'HmIP-RF', 'ABC1:1', 'MASTER');
        expect(h.calls).toEqual([]);
        await h.backend.stop();
    });

    it('writes only what changed and logs it', async () => {
        const h = await harness();
        const results = await h.backend.request('paramset.put', 'HmIP-RF', ['ABC1:1'], 'MASTER', {LOGGING: true});
        expect(results[0]?.sent).toEqual({LOGGING: true});
        const log = await h.backend.request('writeLog.list');
        expect(log.at(-1)).toMatchObject({method: 'putParamset', ok: true});
        expect(h.events.some((event) => event.name === 'writeLog.appended')).toBe(true);
        expect(h.events.some((event) => event.name === 'write.progress')).toBe(true);
        expect(await h.backend.request('writeLog.clear')).toBeNull();
        expect(await h.backend.request('writeLog.list')).toEqual([]);
        await h.backend.stop();
    });

    it('writes a link paramset in both directions', async () => {
        const h = await harness();
        const results = await h.backend.request(
            'paramset.putLink',
            'HmIP-RF',
            [{sender: 'ABC1:1', receiver: 'ABC1:0'}],
            {senderToReceiver: {LOGGING: true}},
        );
        expect(results[0]?.peer).toBe('ABC1:0');
        await h.backend.stop();
    });

    it('sets and gets a value', async () => {
        const h = await harness({
            answers: {
                'HmIP-RF': (method, params) => {
                    if (method === 'getParamsetDescription') {
                        return {STATE: {TYPE: 'BOOL', OPERATIONS: 7, DEFAULT: false}};
                    }
                    if (method === 'getValue') {
                        return true;
                    }
                    return (defaultAnswers['HmIP-RF'] as Answer)(method, params);
                },
            },
        });
        expect(await h.backend.request('value.set', 'HmIP-RF', 'ABC1:1', 'STATE', true)).toBeNull();
        expect(h.calls.some((call) => call.method === 'setValue')).toBe(true);
        expect(await h.backend.request('value.get', 'HmIP-RF', 'ABC1:1', 'STATE')).toBe(true);
        await h.backend.stop();
    });

    it('cancels a queued bulk write', async () => {
        const h = await harness();
        expect(await h.backend.request('write.cancel')).toBe(0);
        await h.backend.stop();
    });

    it('passes the link calls through and shapes their answers', async () => {
        const h = await harness({
            answers: {
                'BidCos-RF': (method) => {
                    switch (method) {
                        case 'getLinks':
                            return [{SENDER: 'LEQ1:1', RECEIVER: 'LEQ2:1'}, 'nonsense'];
                        case 'getLinkInfo':
                            return {NAME: 'n', DESCRIPTION: 'd'};
                        case 'getLinkPeers':
                            return ['LEQ2:1', 5];
                        default:
                            return '';
                    }
                },
            },
        });
        expect(await h.backend.request('links.list', 'BidCos-RF')).toEqual([{SENDER: 'LEQ1:1', RECEIVER: 'LEQ2:1'}]);
        expect(await h.backend.request('links.info.get', 'BidCos-RF', 'LEQ1:1', 'LEQ2:1')).toEqual({
            SENDER: 'LEQ1:1',
            RECEIVER: 'LEQ2:1',
            NAME: 'n',
            DESCRIPTION: 'd',
        });
        expect(await h.backend.request('links.peers', 'BidCos-RF', 'LEQ1:1')).toEqual(['LEQ2:1']);
        expect(await h.backend.request('links.add', 'BidCos-RF', 'LEQ1:1', 'LEQ2:1')).toBeNull();
        expect(await h.backend.request('links.remove', 'BidCos-RF', 'LEQ1:1', 'LEQ2:1')).toBeNull();
        expect(await h.backend.request('links.info.set', 'BidCos-RF', 'LEQ1:1', 'LEQ2:1', 'n', 'd')).toBeNull();
        expect(await h.backend.request('links.activate', 'BidCos-RF', 'LEQ2:1', 'LEQ1:1', false)).toBeNull();
        await h.backend.stop();
    });

    it('answers links.info.get for an interface that returns nothing', async () => {
        const h = await harness({answers: {'BidCos-RF': () => ''}});
        expect(await h.backend.request('links.info.get', 'BidCos-RF', 'A:1', 'B:1')).toEqual({
            SENDER: 'A:1',
            RECEIVER: 'B:1',
        });
        await h.backend.stop();
    });
});

describe('radio and service messages', () => {
    it('reads the BidCos RSSI matrix from the interface', async () => {
        const h = await harness();
        expect(await h.backend.request('rssi.get', 'BidCos-RF')).toEqual({LEQ1: {BidCos: [-70, -80]}});
        await h.backend.stop();
    });

    it('lists and answers listBidcosInterfaces and setBidcosInterface', async () => {
        const h = await harness();
        expect(await h.backend.request('bidcos.interfaces', 'HmIP-RF')).toEqual([
            {ADDRESS: 'XEQ0123456', TYPE: 'HMIP_CCU'},
        ]);
        expect(await h.backend.request('bidcos.setInterface', 'BidCos-RF', 'LEQ1', 'BidCos', true)).toBeNull();
        await h.backend.stop();
    });

    it('reads the BidCos service messages on connect and on demand', async () => {
        const h = await harness();
        expect(await h.backend.request('serviceMessages.list', 'BidCos-RF')).toEqual([
            expect.objectContaining({address: 'LEQ1:0', datapoint: 'STICKY_UNREACH'}),
        ]);
        await h.backend.pollServiceMessages();
        expect(await h.backend.request('serviceMessages.list', 'BidCos-RF')).toHaveLength(1);
        await h.backend.stop();
    });

    it('sweeps the HmIP maintenance channels for RSSI and service messages', async () => {
        const h = await harness({
            answers: {
                'HmIP-RF': (method, params) =>
                    method === 'getParamset' && params[1] === 'VALUES'
                        ? {RSSI_DEVICE: -50, STICKY_UNREACH: true}
                        : (defaultAnswers['HmIP-RF'] as Answer)(method, params),
            },
        });
        await h.backend.sweepHmip();
        expect(await h.backend.request('serviceMessages.list', 'HmIP-RF')).toEqual([
            expect.objectContaining({address: 'ABC1:0', datapoint: 'STICKY_UNREACH'}),
        ]);
        expect((await h.backend.request('rssi.get', 'HmIP-RF'))['XEQ0123456']?.['ABC1']?.[0]).toBe(-50);
        await h.backend.stop();
    });

    it('acknowledges a service message by writing its datapoint', async () => {
        const h = await harness({
            answers: {
                'HmIP-RF': (method, params) =>
                    method === 'getParamsetDescription'
                        ? {STICKY_UNREACH: {TYPE: 'BOOL', OPERATIONS: 7, DEFAULT: false}}
                        : (defaultAnswers['HmIP-RF'] as Answer)(method, params),
            },
        });
        h.handler.event('HmIP-RF', 'ABC1:0', 'STICKY_UNREACH', true);
        h.calls.length = 0;
        expect(await h.backend.request('serviceMessages.ack', 'HmIP-RF', 'ABC1:0', 'STICKY_UNREACH')).toBeNull();
        expect(h.calls.find((call) => call.method === 'setValue')?.params).toEqual(['ABC1:0', 'STICKY_UNREACH', false]);
        expect(await h.backend.request('serviceMessages.list', 'HmIP-RF')).toEqual([]);
        await h.backend.stop();
    });

    it('reads an omitted optional parameter that arrived as JSON null (task 14 e2e)', async () => {
        const h = await harness();
        h.handler.event('HmIP-RF', 'ABC1:0', 'STICKY_UNREACH', true);
        const all = await h.backend.request('serviceMessages.list');
        expect(all.length).toBeGreaterThan(0);

        // `JSON.stringify([undefined])` is `[null]`, so this is exactly what the WebSocket
        // transport delivers for `serviceMessages.list()` with no interface name. It has to mean
        // "every interface", not "the interface called null" - which answered with nothing and
        // made the refresh button of the service-message tab empty the grid.
        expect(await h.backend.request('serviceMessages.list', null as unknown as string)).toEqual(all);
        await h.backend.stop();
    });

    it('refuses to acknowledge a datapoint that cannot be acknowledged', async () => {
        const h = await harness();
        await expect(h.backend.request('serviceMessages.ack', 'HmIP-RF', 'ABC1:0', 'LOWBAT')).rejects.toThrow(
            'cannot be acknowledged',
        );
        await h.backend.stop();
    });
});

describe('the console and data files', () => {
    it('sends a read straight through and a write through the log', async () => {
        const h = await harness();
        await h.backend.request('rpc.call', 'HmIP-RF', 'getVersion', []);
        expect(await h.backend.request('writeLog.list')).toEqual([]);
        await h.backend.request('rpc.call', 'HmIP-RF', 'setValue', ['ABC1:1', 'STATE', true]);
        expect((await h.backend.request('writeLog.list')).at(-1)?.method).toBe('setValue');
        await h.backend.stop();
    });

    it('refuses a call without a method', async () => {
        const h = await harness();
        await expect(h.backend.request('rpc.call', 'HmIP-RF', '', [])).rejects.toThrow('no method given');
        await h.backend.stop();
    });

    it('builds the method catalogue from listMethods and methodHelp', async () => {
        const h = await harness({
            answers: {
                'HmIP-RF': (method, params) => {
                    if (method === 'system.listMethods') {
                        return ['getParamset', 'somethingNew'];
                    }
                    if (method === 'system.methodHelp') {
                        return params[0] === 'getParamset' ? 'Liest ein Paramset' : '';
                    }
                    return (defaultAnswers['HmIP-RF'] as Answer)(method, params);
                },
            },
        });
        const methods = await h.backend.request('rpc.methods', 'HmIP-RF');
        expect(methods.map((entry) => entry.name)).toEqual(['getParamset', 'somethingNew']);
        expect(methods[0]?.help).toBe('Liest ein Paramset');
        expect(methods[0]?.params.length).toBeGreaterThan(0);
        expect(methods[1]?.params).toEqual([]);
        // cached for the session
        h.calls.length = 0;
        await h.backend.request('rpc.methods', 'HmIP-RF');
        expect(h.calls).toEqual([]);
        await h.backend.stop();
    });

    it('falls back to the shipped catalogue when listMethods fails', async () => {
        const h = await harness({answers: {'BidCos-RF': () => new Error('no such method')}});
        const methods = await h.backend.request('rpc.methods', 'BidCos-RF');
        expect(methods.length).toBeGreaterThan(40);
        await h.backend.stop();
    });

    it('serves a data file and refuses one outside the roots', async () => {
        const h = await harness();
        await fs.writeFile(path.join(h.dir, 'manifest.json'), JSON.stringify({version: 1}), 'utf8');
        expect(await h.backend.request('data.file', 'data/manifest.json')).toEqual({version: 1});
        await expect(h.backend.request('data.file', 'etc/passwd')).rejects.toThrow('readable roots');
        await h.backend.stop();
    });
});

describe('errors', () => {
    it('classifies an unknown method', async () => {
        const h = await harness();
        await expect(h.backend.request('nope' as never, ...([] as never))).rejects.toThrow('unknown API method');
        await h.backend.stop();
    });

    it('passes a fault of the interface through with its code', async () => {
        const h = await harness({
            answers: {
                'HmIP-RF': () =>
                    new BackendError({message: 'Unknown instance', kind: 'rpc', faultCode: -2, faultString: 'x'}),
            },
        });
        const error = await h.backend.request('value.get', 'HmIP-RF', 'A:1', 'STATE').catch((value: unknown) => value);
        expect((error as BackendError).faultCode).toBe(-2);
        await h.backend.stop();
    });

    it('refuses every call when nothing is connected', async () => {
        const backend = await Backend.open({dataDir: dir, importLegacy: false});
        await expect(backend.request('devices.list', 'HmIP-RF')).rejects.toThrow('not connected to a CCU');
        await backend.stop();
    });
});

describe('InProcessTransport', () => {
    it('forwards requests and events', async () => {
        const h = await harness();
        const transport = new InProcessTransport(h.backend);
        expect(transport.connected).toBe(true);
        const seen: unknown[] = [];
        const off = transport.on('notice', (payload) => seen.push(payload));
        const connections: boolean[] = [];
        const offConnection = transport.onConnectionChange((connected) => connections.push(connected));
        expect((await transport.request('config.get')).connection.host).toBe('ccu.lan');
        h.handler.unknownMethod?.('x', []);
        expect(seen).toHaveLength(1);
        transport.setConnected(false);
        transport.setConnected(false);
        expect(connections).toEqual([false]);
        off();
        offConnection();
        h.handler.unknownMethod?.('y', []);
        expect(seen).toHaveLength(1);
        await h.backend.stop();
    });
});
