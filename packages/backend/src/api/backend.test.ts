import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import type {ApiEventName, AppConfig, DeviceDescription, RpcValue} from '@homematic-manager/core';

import {BackendError, connectionError, rpcFaultError} from '../errors.js';
import {InterfaceManager, type InterfaceManagerOptions} from '../interfaces/manager.js';
import {META_READ_SCRIPT} from '../rega/scripts.js';
import {
    RpcClient,
    type RpcCallOptions,
    type RpcClientOptions,
    type RpcOutValue,
    type RpcTransport,
} from '../rpc/client.js';
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
    /** Task 48: what went through the transports when the harness runs the real `RpcClient`. */
    transportCalls: {interfaceName: string; method: string}[];
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
        /** What the rooms-and-functions script answers instead of the document built from the channels. */
        regaMeta?: string;
        /** Task 48: the real `RpcClient` over a fake transport, so the log is fed by the real hook. */
        realClient?: boolean;
    } = {},
): Promise<Harness> {
    const calls: Harness['calls'] = [];
    const transportCalls: Harness['transportCalls'] = [];
    const events: Harness['events'] = [];
    let handler: CallbackHandler | undefined;
    const answers = {...defaultAnswers, ...options.answers};

    const servers: CallbackServerSet = {
        ensure: () => Promise.resolve(2042),
        port: () => 2042,
        callbackUrl: (protocol, ip) => `${protocol === 'binrpc' ? 'xmlrpc_bin://' : 'http://'}${ip}:2042`,
        stop: () => Promise.resolve(),
    };

    const fakeClient = (clientOptions: RpcClientOptions): RpcClient =>
        ({
            name: clientOptions.name,
            host: clientOptions.host,
            port: clientOptions.port,
            protocol: clientOptions.protocol,
            closed: false,
            description: clientOptions.name,
            call: (method: string, params: readonly RpcOutValue[] = [], callOptions: RpcCallOptions = {}) => {
                calls.push({interfaceName: clientOptions.name, method, params});
                const answer = (answers[clientOptions.name] ?? (() => ''))(method, params);
                // the real client reports every finished call; the RPC log hangs off that hook
                const record = {
                    interfaceName: clientOptions.name,
                    method,
                    params: [...params],
                    durationMs: 0,
                    timestamp: Date.now(),
                    origin: callOptions.origin ?? clientOptions.originOf?.() ?? ('background' as const),
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

    /** Task 48: the real client, with the socket replaced by the answer table. */
    const realClient = (clientOptions: RpcClientOptions): RpcClient =>
        new RpcClient({
            ...clientOptions,
            createTransport: (): RpcTransport => ({
                methodCall: (method, params, callback) => {
                    transportCalls.push({interfaceName: clientOptions.name, method});
                    calls.push({interfaceName: clientOptions.name, method, params});
                    const answer = (answers[clientOptions.name] ?? (() => ''))(method, params);
                    setTimeout(() => {
                        if (answer instanceof Error) {
                            callback(answer);
                        } else {
                            callback(null, answer);
                        }
                    }, 0);
                },
            }),
        });
    const createClient = options.realClient === true ? realClient : fakeClient;

    const rega = {
        getChannels: vi.fn(() =>
            Promise.resolve(options.regaChannels ?? [{id: 4711, address: 'ABC1:1', name: 'Lamp'}]),
        ),
        // task 27: the rooms-and-functions script answers with the same channel in one room, so
        // that ReGa is the metadata store of every harness; every other script is echoed back
        exec: vi.fn((script: string) =>
            Promise.resolve({
                output:
                    script === META_READ_SCRIPT && options.regaMeta !== undefined
                        ? options.regaMeta
                        : script === META_READ_SCRIPT
                          ? JSON.stringify({
                                objects: (options.regaChannels ?? [{id: 4711, address: 'ABC1:1', name: 'Lamp'}]).map(
                                    (channel) => ({...channel, interface: 'HmIP-RF'}),
                                ),
                                rooms: [{id: 9000, name: 'Flur', channels: [4711]}],
                                functions: [],
                            })
                          : script,
                objects: {},
            }),
        ),
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
            probe: () => Promise.resolve('open' as const),
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
        'rpcLog.appended',
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

    return {backend, calls, transportCalls, handler: handler as CallbackHandler, events, dir, rega};
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

    /**
     * Task 34 (#147, D-42): the messages already in the list when the option is switched on. Their
     * STICKY_UNREACH was raised before anything listened, so there is no edge that would ever
     * acknowledge them; the settings dialog asks, and `acknowledgeExisting` is the answer.
     */
    describe('switching it on with messages already in the list (task 34)', () => {
        const BIDCOS_TWO: DeviceDescription[] = [
            ...BIDCOS_DEVICES,
            {ADDRESS: 'LEQ2', TYPE: 'HM-Sec-SC-2', FIRMWARE: '2.8', VERSION: 1, CHILDREN: ['LEQ2:0']},
            {ADDRESS: 'LEQ2:0', TYPE: 'MAINTENANCE', PARENT: 'LEQ2', VERSION: 1},
        ];

        /**
         * A BidCos-RF whose `getServiceMessages` is what its values say, so an acknowledgement
         * really takes a message out of the next answer - plus an HmIP-RF with a sticky flag of its
         * own, which must never be written.
         */
        function stickyWorld(): {answers: Record<string, Answer>; values: Map<string, RpcValue>} {
            const values = new Map<string, RpcValue>([
                ['LEQ1:0|STICKY_UNREACH', true],
                ['LEQ1:0|LOWBAT', true],
                ['LEQ2:0|STICKY_UNREACH', true],
                ['LEQ2:0|SABOTAGE', true],
                ['LEQ2:0|UNREACH', true],
            ]);
            const bidcos: Answer = (method, params) => {
                switch (method) {
                    case 'listDevices':
                        return BIDCOS_TWO as unknown as RpcValue;
                    case 'getServiceMessages':
                        return [...values]
                            .filter(([, value]) => value !== false)
                            .map(([key, value]) => [...key.split('|'), value] as RpcValue);
                    case 'getParamsetDescription':
                        return {
                            STICKY_UNREACH: {TYPE: 'BOOL', OPERATIONS: 7},
                            SABOTAGE: {TYPE: 'BOOL', OPERATIONS: 7},
                            LOWBAT: {TYPE: 'BOOL', OPERATIONS: 5},
                            UNREACH: {TYPE: 'BOOL', OPERATIONS: 5},
                        };
                    case 'setValue':
                        values.set(`${params[0] as string}|${params[1] as string}`, params[2] as RpcValue);
                        return '';
                    default:
                        return '';
                }
            };
            const hmip: Answer = (method, params) => {
                switch (method) {
                    case 'listDevices':
                        return HMIP_DEVICES as unknown as RpcValue;
                    case 'getParamset':
                        return params[1] === 'VALUES' ? {RSSI_DEVICE: -60, STICKY_UNREACH: true, UNREACH: false} : {};
                    case 'getParamsetDescription':
                        return {STICKY_UNREACH: {TYPE: 'BOOL', OPERATIONS: 7}};
                    default:
                        return '';
                }
            };
            return {answers: {'BidCos-RF': bidcos, 'HmIP-RF': hmip}, values};
        }

        const acknowledgements = (h: Harness): string[] =>
            h.calls
                .filter((call) => call.method === 'setValue')
                .map((call) => `${call.interfaceName} ${call.params[0] as string} ${call.params[1] as string}`);

        async function withMessages(): Promise<Harness> {
            const world = stickyWorld();
            // the sweep runs when the test says so, not on the connect's timer in the middle of it
            const h = await harness({answers: world.answers, backend: {hmipSweepDelayMs: 600_000}});
            await h.backend.sweepHmip();
            const listed = await h.backend.request('serviceMessages.list');
            expect(listed.map((message) => `${message.interfaceName} ${message.address} ${message.datapoint}`)).toEqual(
                expect.arrayContaining([
                    'BidCos-RF LEQ1:0 STICKY_UNREACH',
                    'BidCos-RF LEQ2:0 STICKY_UNREACH',
                    'BidCos-RF LEQ2:0 SABOTAGE',
                    'HmIP-RF ABC1:0 STICKY_UNREACH',
                ]),
            );
            return h;
        }

        it('acknowledges each STICKY_UNREACH once with the button’s write, and nothing else', async () => {
            const h = await withMessages();
            const config = await h.backend.request('config.get');
            await h.backend.request(
                'config.set',
                {...config.connection, autoAckStickyUnreach: true},
                {acknowledgeExisting: true},
            );

            await vi.waitFor(() => {
                expect(acknowledgements(h)).toHaveLength(2);
            });
            // one write per sticky message, and `false` - what `serviceMessages.ack` sends
            expect(acknowledgements(h).sort()).toEqual([
                'BidCos-RF LEQ1:0 STICKY_UNREACH',
                'BidCos-RF LEQ2:0 STICKY_UNREACH',
            ]);
            expect(h.calls.filter((call) => call.method === 'setValue').map((call) => call.params[2])).toEqual([
                false,
                false,
            ]);
            // the two are gone from the list; LOWBAT, SABOTAGE, UNREACH and HmIP are untouched
            await vi.waitFor(async () => {
                const left = (await h.backend.request('serviceMessages.list')).map(
                    (message) => `${message.interfaceName} ${message.address} ${message.datapoint}`,
                );
                expect(left).not.toContain('BidCos-RF LEQ1:0 STICKY_UNREACH');
                expect(left).not.toContain('BidCos-RF LEQ2:0 STICKY_UNREACH');
                expect(left).toEqual(
                    expect.arrayContaining([
                        'BidCos-RF LEQ1:0 LOWBAT',
                        'BidCos-RF LEQ2:0 SABOTAGE',
                        'HmIP-RF ABC1:0 STICKY_UNREACH',
                    ]),
                );
            });
            // and the Funk tab still knows both devices were away
            const counters = await h.backend.request('unreach.list', 'BidCos-RF');
            expect(counters.map((counter) => counter.address).sort()).toEqual(['LEQ1', 'LEQ2']);
            await h.backend.stop();
        });

        it('writes nothing for "only new ones"', async () => {
            const h = await withMessages();
            const config = await h.backend.request('config.get');
            await h.backend.request('config.set', {...config.connection, autoAckStickyUnreach: true});
            await h.backend.request('config.set', {...config.connection, autoAckStickyUnreach: true}, {});
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(acknowledgements(h)).toEqual([]);
            await h.backend.stop();
        });

        it('writes nothing when the option was already on, or when the save switches it off', async () => {
            const h = await withMessages();
            const config = await h.backend.request('config.get');
            await h.backend.request('config.set', {...config.connection, autoAckStickyUnreach: true});
            // already on: the answer belongs to a question that was never asked
            await h.backend.request(
                'config.set',
                {...config.connection, autoAckStickyUnreach: true},
                {acknowledgeExisting: true},
            );
            // switched off in the same save: nothing to acknowledge either
            await h.backend.request(
                'config.set',
                {...config.connection, autoAckStickyUnreach: false},
                {acknowledgeExisting: true},
            );
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(acknowledgements(h)).toEqual([]);
            await h.backend.stop();
        });

        it('acknowledges nothing when the same save moves to another CCU', async () => {
            const world = stickyWorld();
            const h = await harness({answers: world.answers, backend: {hmipSweepDelayMs: 600_000}});
            expect(await h.backend.request('serviceMessages.list', 'BidCos-RF')).not.toEqual([]);
            // the other CCU has nothing pending, so a write after the move can only be the old list
            world.values.clear();
            const config = await h.backend.request('config.get');
            await h.backend.request(
                'config.set',
                {...config.connection, host: 'other.lan', autoAckStickyUnreach: true},
                {acknowledgeExisting: true},
            );
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(acknowledgements(h)).toEqual([]);
            await h.backend.stop();
        });

        it('reports a message that will not take it as a notice, and goes on with the next', async () => {
            const world = stickyWorld();
            const bidcos = world.answers['BidCos-RF'] ?? (() => '');
            const h = await harness({
                answers: {
                    ...world.answers,
                    'BidCos-RF': (method, params) =>
                        method === 'setValue' && params[0] === 'LEQ1:0'
                            ? new BackendError({message: 'not reachable', kind: 'rpc'})
                            : bidcos(method, params),
                },
            });
            const config = await h.backend.request('config.get');
            await h.backend.request(
                'config.set',
                {...config.connection, autoAckStickyUnreach: true},
                {acknowledgeExisting: true},
            );
            await vi.waitFor(() => {
                expect(acknowledgements(h)).toHaveLength(2);
                expect(
                    h.events.some(
                        (event) =>
                            event.name === 'notice' &&
                            JSON.stringify(event.payload).includes('LEQ1:0: STICKY_UNREACH could not be acknowledged'),
                    ),
                ).toBe(true);
            });
            // the failure is in the RPC log as well, which is what the RPC log drawer shows
            const log = await h.backend.request('rpcLog.list');
            expect(
                log
                    .filter((entry) => entry.method === 'setValue')
                    .map((entry) => entry.ok)
                    .sort(),
            ).toEqual([false, true]);
            await h.backend.stop();
        });

        it('keeps the edge behaviour: a new STICKY_UNREACH is acknowledged once after the switch', async () => {
            const h = await withMessages();
            const config = await h.backend.request('config.get');
            await h.backend.request('config.set', {...config.connection, autoAckStickyUnreach: true});
            expect(acknowledgements(h)).toEqual([]);

            // LEQ1 comes back and goes away again - that edge is acknowledged, as before
            h.handler.event('BidCos-RF', 'LEQ1:0', 'UNREACH', false);
            h.handler.event('BidCos-RF', 'LEQ1:0', 'STICKY_UNREACH', true);
            await vi.waitFor(() => {
                expect(acknowledgements(h)).toEqual(['BidCos-RF LEQ1:0 STICKY_UNREACH']);
            });
            // the same flag once more is the same outage, and no second write
            h.handler.event('BidCos-RF', 'LEQ1:0', 'STICKY_UNREACH', true);
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(acknowledgements(h)).toHaveLength(1);
            await h.backend.stop();
        });
    });

    /**
     * Task 34 (B-9): the HmIP sweep reads the `:0` channels, and until now nothing it read reached
     * the unreach counter - the Funk tab counted HmIP outages only when an event said so.
     */
    it('counts an unreach edge the HmIP sweep reads, and acknowledges nothing', async () => {
        let unreach = false;
        // sticky, as its name says: once raised it stays in every later paramset until written back
        let sticky = false;
        const h = await harness({
            answers: {
                'HmIP-RF': (method, params) => {
                    switch (method) {
                        case 'listDevices':
                            return HMIP_DEVICES as unknown as RpcValue;
                        case 'getParamset':
                            sticky = sticky || unreach;
                            return params[1] === 'VALUES'
                                ? {RSSI_DEVICE: -60, UNREACH: unreach, STICKY_UNREACH: sticky}
                                : {};
                        case 'getParamsetDescription':
                            return {STICKY_UNREACH: {TYPE: 'BOOL', OPERATIONS: 7}};
                        default:
                            return '';
                    }
                },
            },
            backend: {hmipSweepDelayMs: 600_000},
        });
        const config = await h.backend.request('config.get');
        await h.backend.request('config.set', {...config.connection, autoAckStickyUnreach: true});

        await h.backend.sweepHmip();
        expect(await h.backend.request('unreach.list', 'HmIP-RF')).toEqual([]);

        unreach = true;
        await h.backend.sweepHmip();
        await h.backend.sweepHmip();
        expect(await h.backend.request('unreach.list', 'HmIP-RF')).toEqual([
            expect.objectContaining({address: 'ABC1', count: 1, unreach: true}),
        ]);

        // back, and away again: a second outage
        unreach = false;
        await h.backend.sweepHmip();
        unreach = true;
        await h.backend.sweepHmip();
        expect((await h.backend.request('unreach.list', 'HmIP-RF'))[0]?.count).toBe(2);

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(h.calls.filter((call) => call.method === 'setValue')).toEqual([]);
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

    it('waits for the metadata detection before it stops, so nothing is written afterwards', async () => {
        // D-40: the detection is deliberately not awaited by the connect - a host that swallows
        // packets would hold the interfaces up for its timeout - so `stop()` has to wait for it
        // instead. Without that, a store that finished loading after the caller had already taken
        // its directory apart asked for a cache write and put a file back into it: CI found this
        // as an ENOTEMPTY in the simulator suite, which has nothing to do with metadata at all.
        const order: string[] = [];
        const h = await harness({
            backend: {
                metaOptions: {
                    // a box that takes its time - a LAN, a busy lighttpd, or the host that swallows
                    // the packet altogether and is answered by the detection timeout
                    fetch: async () => {
                        await new Promise((resolve) => setTimeout(resolve, 150));
                        order.push('detected');
                        // a CCU: no metadata API here
                        return new Response('not found', {status: 404});
                    },
                },
            },
        });
        expect(order).toEqual([]);
        await h.backend.stop();
        order.push('stopped');
        // and not the other way round, which is what leaves a store loading into a profile
        // directory its owner has already deleted
        expect(order).toEqual(['detected', 'stopped']);

        // the profile directory stays gone once it is removed, however late anything finishes
        await fs.rm(dir, {recursive: true, force: true});
        await new Promise((resolve) => setTimeout(resolve, 250));
        await expect(fs.readdir(dir)).rejects.toThrow();
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
                probe: () => Promise.resolve('refused' as const),
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

/**
 * Task 66: what the system says about HmIP pairing reaches the dialog as `meta.pairing`, read
 * afresh from the system's `/version` each time, and is `null` wherever nothing says anything.
 */
describe('the HmIP pairing fact of openccu-lite (task 66)', () => {
    it('is null before a connection and on a CCU', async () => {
        const backend = await Backend.open({dataDir: dir, importLegacy: false});
        expect(await backend.request('meta.pairing')).toBeNull();
        await backend.stop();

        const h = await harness({
            backend: {metaOptions: {fetch: () => Promise.resolve(new Response('not found', {status: 404}))}},
        });
        expect(await h.backend.request('meta.pairing')).toBeNull();
        await h.backend.stop();
    });

    it('relays the fact of a system that says it, asked of the system each time', async () => {
        const json = (body: unknown): Response =>
            new Response(JSON.stringify(body), {status: 200, headers: {'Content-Type': 'application/json'}});
        let mode = 'LOCAL';
        let probes = 0;
        const fetchImpl = ((input: string | URL) => {
            const url = new URL(String(input));
            switch (url.pathname) {
                case '/api/meta/v1/version':
                    probes += 1;
                    return Promise.resolve(
                        json({
                            api: 'meta',
                            version: 1,
                            format: 1,
                            revision: 3,
                            hmip: {keyserver_mode: mode, device_keys: 2, offline_pairing: mode !== 'LOCAL'},
                        }),
                    );
                case '/api/meta/v1/snapshot':
                    return Promise.resolve(json({format: 1, revision: 3, objects: {}, enums: {}}));
                case '/api/meta/v1/events/sse':
                    return Promise.resolve(
                        new Response(new ReadableStream({start: () => undefined}), {
                            headers: {'Content-Type': 'text/event-stream'},
                        }),
                    );
                default:
                    return Promise.resolve(new Response('not found', {status: 404}));
            }
        }) as unknown as typeof globalThis.fetch;
        const h = await harness({
            connection: {metaUrl: 'http://box', metaToken: 'olt_0123456789abcdef0123456789abcdef'},
            backend: {metaOptions: {fetch: fetchImpl}},
        });
        expect(await h.backend.request('meta.pairing')).toEqual({
            keyserver_mode: 'LOCAL',
            device_keys: 2,
            offline_pairing: false,
        });
        const before = probes;
        // the system was switched back to the key server in between: the next dialog sees it
        mode = 'KEYSERVER_LOCAL';
        expect(await h.backend.request('meta.pairing')).toMatchObject({keyserver_mode: 'KEYSERVER_LOCAL'});
        expect(probes).toBe(before + 1);
        await h.backend.stop();
    });
});

describe('rooms and functions through ReGa (task 27)', () => {
    /**
     * A CCU: no metadata API, and the detection answered at once rather than by a timeout. The
     * detection is not awaited by the connect (D-40), so every test first asks for something that
     * waits for it - `meta.objects` does - before it looks at the state.
     */
    /** The scripts ReGa was sent since the last `mockClear()`. */
    function scriptsOf(h: Harness): string[] {
        return (h.rega.exec.mock.calls as unknown as [string][]).map(([script]) => script);
    }

    async function regaHarness(connection: Record<string, unknown> = {}, regaMeta?: string): Promise<Harness> {
        const h = await harness({
            connection,
            ...(regaMeta === undefined ? {} : {regaMeta}),
            backend: {metaOptions: {fetch: () => Promise.resolve(new Response('not found', {status: 404}))}},
        });
        await h.backend.request('meta.objects');
        return h;
    }

    it('makes ReGa the metadata store of a CCU, flat, with its rooms as the taxonomy', async () => {
        const h = await regaHarness();
        expect(await h.backend.request('meta.state')).toMatchObject({provider: 'rega', reachable: true, flat: true});
        const snapshot = await h.backend.request('meta.get');
        expect(snapshot.enums['room']?.tree).toEqual([{id: 'r9000', name: 'Flur'}]);
        expect(snapshot.objects['HmIP-RF.ABC1:1']?.rooms).toEqual(['Flur']);
        await h.backend.stop();
    });

    it('renames through the provider once, not through the name service as well', async () => {
        const h = await regaHarness();
        h.rega.exec.mockClear();
        await h.backend.request('names.set', [{address: 'ABC1:1', name: 'Lampe'}]);
        const renames = scriptsOf(h).filter((script) => script.includes('Name('));
        expect(renames).toEqual(['dom.GetObject(4711).Name("Lampe");\n']);
        expect(await h.backend.request('names.get')).toEqual({'ABC1:1': 'Lampe'});
        await h.backend.stop();
    });

    it('assigns through Add/Remove, refreshes on request, and refuses a floor', async () => {
        const h = await regaHarness();
        h.rega.exec.mockClear();
        await h.backend.request('meta.assign', ['HmIP-RF.ABC1:1'], 'room/r9000', false);
        expect(scriptsOf(h)).toEqual(['dom.GetObject(9000).Remove(4711);\n']);
        expect((await h.backend.request('meta.objects'))['HmIP-RF.ABC1:1']?.rooms).toEqual([]);

        h.rega.exec.mockClear();
        const state = await h.backend.request('meta.refresh');
        expect(scriptsOf(h)).toEqual([META_READ_SCRIPT]);
        expect(state.provider).toBe('rega');
        // the read script's answer still has the channel in the room: ReGa's word wins
        expect((await h.backend.request('meta.objects'))['HmIP-RF.ABC1:1']?.rooms).toEqual(['Flur']);

        await expect(h.backend.request('meta.node.create', 'room', 'room/r9000', 'Unten')).rejects.toThrow('flat list');
        await h.backend.stop();
    });

    it('falls back to the profile store when ReGa answers getChannels but not the script, and still renames on the CCU', async () => {
        // hm-simulator's ReGa mock, or a ReGa that runs no script: `auto` promised a store that works
        const h = await regaHarness({}, 'not the document');
        expect(await h.backend.request('meta.state')).toMatchObject({provider: 'local', reachable: true});
        const notices = h.events
            .filter((event) => event.name === 'notice')
            .map((event) => JSON.stringify(event.payload));
        expect(notices.some((notice) => notice.includes('stay in this profile'))).toBe(true);
        h.rega.exec.mockClear();
        await h.backend.request('names.set', [{address: 'ABC1:1', name: 'Lampe'}]);
        expect(scriptsOf(h)).toEqual(['dom.GetObject(4711).Name("Lampe");\n']);
        await h.backend.stop();
    });

    it("renames through the name service for an object ReGa's list does not hold", async () => {
        const h = await regaHarness({}, JSON.stringify({objects: [], rooms: [], functions: []}));
        expect(await h.backend.request('meta.state')).toMatchObject({provider: 'rega', reachable: true, objects: 0});
        h.rega.exec.mockClear();
        await h.backend.request('names.set', [{address: 'ABC1:1', name: 'Lampe'}]);
        // once, through the name service; the provider had nothing to write
        expect(scriptsOf(h).filter((script) => script.includes('Name('))).toEqual([
            'dom.GetObject(4711).Name("Lampe");\n',
        ]);
        await h.backend.stop();
    });

    it('keeps the profile store when ReGa is switched off', async () => {
        const h = await regaHarness({rega: false});
        expect(await h.backend.request('meta.state')).toMatchObject({provider: 'local', reachable: true});
        await h.backend.stop();
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

    /**
     * Task 28: any HmIP device without its SGTIN. `hmipKeyMode: 'ANY'` in the contract is
     * `setInstallMode` with exactly two arguments on the wire, and a mode integer never reaches
     * hmipserver - the lab's answered `setInstallMode(true, 30, 1)` with an empty HTTP reply and
     * opened no install mode. BidCos keeps its mode.
     */
    it('arms HmIP for any device with two arguments and never sends it a mode (task 28)', async () => {
        const h = await harness();
        h.calls.length = 0;
        await h.backend.request('devices.installMode.set', 'HmIP-RF', true, {seconds: 30, hmipKeyMode: 'ANY'});
        await h.backend.request('devices.installMode.set', 'HmIP-RF', true, {seconds: 30, mode: 1});
        await h.backend.request('devices.installMode.set', 'BidCos-RF', true, {seconds: 30, mode: 1});
        const install = h.calls.filter((call) => call.method === 'setInstallMode');
        expect(install.map(({interfaceName, params}) => [interfaceName, params])).toEqual([
            ['HmIP-RF', [true, 30]],
            ['HmIP-RF', [true, 30]],
            ['BidCos-RF', [true, 30, 1]],
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
        const log = await h.backend.request('rpcLog.list');
        expect(log.at(-1)).toMatchObject({method: 'putParamset', ok: true, origin: 'ui'});
        expect(h.events.some((event) => event.name === 'rpcLog.appended')).toBe(true);
        expect(h.events.some((event) => event.name === 'write.progress')).toBe(true);
        expect(await h.backend.request('rpcLog.clear')).toBeNull();
        expect(await h.backend.request('rpcLog.list')).toEqual([]);
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

    it('hands the default callback ports to the interface manager and names them in every configuration it reports (task 35)', async () => {
        let managerOptions: InterfaceManagerOptions | undefined;
        const h = await harness({
            backend: {
                defaultCallbackPorts: {xmlrpc: 2031, binrpc: 2032},
                createInterfaceManager: (options) => {
                    managerOptions = options;
                    return new InterfaceManager(options);
                },
            },
        });
        const pair = {xmlrpc: 2031, binrpc: 2032};
        expect(managerOptions?.defaultCallbackPorts).toEqual(pair);
        const config = await h.backend.request('config.get');
        expect(config.callbackDefaultPorts).toEqual(pair);
        // a fact of the host, not a setting: the connection keeps its 0, and the profile never sees the pair
        expect(config.connection.callback).toEqual({ip: '192.168.1.5', xmlrpcPort: 0, binrpcPort: 0});
        expect((await h.backend.request('config.set', config.connection)).callbackDefaultPorts).toEqual(pair);
        await h.backend.request('config.discover');
        const changed = h.events
            .filter((event) => event.name === 'config.changed')
            .map((event) => (event.payload as AppConfig).callbackDefaultPorts);
        expect(changed.length).toBeGreaterThanOrEqual(3);
        expect(changed).toEqual(changed.map(() => pair));
        expect(await fs.readFile(path.join(dir, 'config.json'), 'utf8')).not.toContain('callbackDefaultPorts');
        await h.backend.stop();
    });

    it('names no default callback ports where the host has none', async () => {
        const h = await harness();
        expect(await h.backend.request('config.get')).not.toHaveProperty('callbackDefaultPorts');
        await h.backend.stop();
    });

    /**
     * Task 38: `HMM_CALLBACK_XMLRPC_PORT` wins over the port saved in the settings dialog. Before, the
     * web host wrote it into `config.json` at start and a later save in the dialog moved the
     * listener away from the published port until the next restart.
     */
    it('pins the callback fields the host was started with, reports them read-only and logs a replaced saved port once (task 38)', async () => {
        await fs.writeFile(
            path.join(dir, 'config.json'),
            JSON.stringify({
                version: '3.0.0-beta.13',
                connection: {
                    host: 'ccu.lan',
                    interfaces: ['HmIP-RF'],
                    autoDetect: false,
                    callback: {ip: '192.168.1.5', xmlrpcPort: 3000, binrpcPort: 0},
                },
            }),
        );
        let managerOptions: InterfaceManagerOptions | undefined;
        const h = await harness({
            backend: {
                pinnedCallback: {xmlrpcPort: 2126},
                createInterfaceManager: (options) => {
                    managerOptions = options;
                    return new InterfaceManager(options);
                },
            },
        });
        expect(managerOptions?.callbackPins).toEqual({xmlrpcPort: true});
        expect(managerOptions?.connection.callback.xmlrpcPort).toBe(2126);
        const config = await h.backend.request('config.get');
        expect(config.connection.callback).toEqual({ip: '192.168.1.5', xmlrpcPort: 2126, binrpcPort: 0});
        expect(config.callbackPinned).toEqual({xmlrpcPort: true});
        expect(config).not.toHaveProperty('publishCallbackPorts');

        // a save cannot move it, and the profile keeps what the user saved
        const saved = await h.backend.request('config.set', {
            ...config.connection,
            callback: {ip: '192.168.1.5', xmlrpcPort: 4000, binrpcPort: 0},
        });
        expect(saved.connection.callback.xmlrpcPort).toBe(2126);
        expect(saved.callbackPinned).toEqual({xmlrpcPort: true});
        const written = JSON.parse(await fs.readFile(path.join(dir, 'config.json'), 'utf8')) as {
            connection: {callback: {xmlrpcPort: number}};
        };
        expect(written.connection.callback.xmlrpcPort).toBe(3000);
        expect(await fs.readFile(path.join(dir, 'config.json'), 'utf8')).not.toContain('callbackPinned');

        const ignored = (): string[] =>
            h.events
                .filter((event) => event.name === 'notice')
                .map((event) => (event.payload as {message: string}).message)
                .filter((message) => message.includes('is ignored'));
        await h.backend.start();
        await h.backend.stop();
        await h.backend.start();
        expect(ignored()).toEqual([
            'callback: the saved XML-RPC callback port 3000 is ignored, HMM_CALLBACK_XMLRPC_PORT / --callback-xmlrpc-port sets 2126',
        ]);
        await h.backend.stop();
    });

    it('asks for the callback ports to be published only in a container that listens beyond the loopback (task 38)', async () => {
        const h = await harness({backend: {inContainer: true}});
        const config = await h.backend.request('config.get');
        expect(config.publishCallbackPorts).toBe(true);
        expect(config).not.toHaveProperty('callbackPinned');
        // on the loopback nothing reaches the servers from outside, so there is nothing to publish
        const loopback = await h.backend.request('config.set', {
            ...config.connection,
            callback: {ip: '127.0.0.1', xmlrpcPort: 0, binrpcPort: 0},
        });
        expect(loopback).not.toHaveProperty('publishCallbackPorts');
        await h.backend.stop();
    });

    it('answers config.callbackAddresses for the configured CCU and for a host being typed (B-53)', async () => {
        let managerOptions: InterfaceManagerOptions | undefined;
        const network = {
            interfaces: () => [
                {address: '10.8.0.2', netmask: '255.255.255.255'},
                {address: '192.168.1.5', netmask: '255.255.255.0'},
            ],
            resolve: (host: string) =>
                Promise.resolve(host === 'ccu.lan' ? '192.168.1.2' : /^[\d.]+$/.test(host) ? host : undefined),
            route: () => Promise.resolve('192.168.1.5'),
        };
        const h = await harness({
            backend: {
                network,
                createInterfaceManager: (options) => {
                    managerOptions = options;
                    return new InterfaceManager(options);
                },
            },
        });
        expect(managerOptions?.network).toBe(network);
        expect(managerOptions).not.toHaveProperty('keepConfiguredCallbackIp');
        expect(await h.backend.request('config.callbackAddresses')).toEqual({
            host: 'ccu.lan',
            hostAddress: '192.168.1.2',
            auto: {address: '192.168.1.5', reason: 'subnet'},
            addresses: [
                {address: '10.8.0.2', inSubnet: false},
                {address: '192.168.1.5', inSubnet: true},
                {address: '127.0.0.1', inSubnet: false},
            ],
        });
        const typed = await h.backend.request('config.callbackAddresses', ' 172.16.24.145 ');
        expect(typed.host).toBe('172.16.24.145');
        expect(typed.auto).toEqual({address: '192.168.1.5', reason: 'route'});
        expect(typed.addresses.every((entry) => !entry.inSubnet)).toBe(true);
        // `null` is what an omitted argument becomes over the WebSocket
        expect((await h.backend.request('config.callbackAddresses', null as never)).host).toBe('ccu.lan');
        await h.backend.stop();
    });

    it('takes an injected address list as the network when none is given (B-53)', async () => {
        const h = await harness();
        const info = await h.backend.request('config.callbackAddresses', '127.0.0.1');
        expect(info.auto).toEqual({address: '127.0.0.1', reason: 'loopback'});
        expect(info.addresses.map((entry) => entry.address)).toEqual(['192.168.1.5', '127.0.0.1']);
        expect(info).not.toHaveProperty('keepsConfigured');
        await h.backend.stop();
    });

    it('keeps a set callback address as it is in a container or where it was set at start (B-53)', async () => {
        let managerOptions: InterfaceManagerOptions | undefined;
        const container = await harness({
            backend: {
                inContainer: true,
                createInterfaceManager: (options) => {
                    managerOptions = options;
                    return new InterfaceManager(options);
                },
            },
        });
        expect(managerOptions?.keepConfiguredCallbackIp).toBe(true);
        expect((await container.backend.request('config.callbackAddresses')).keepsConfigured).toBe(true);
        await container.backend.stop();

        const pinned = await harness({backend: {pinnedCallback: {ip: '192.168.0.10'}}});
        expect((await pinned.backend.request('config.callbackAddresses')).keepsConfigured).toBe(true);
        await pinned.backend.stop();
    });

    it('stays on the loopback for local: true (B-53)', async () => {
        const h = await harness({connection: {host: '127.0.0.1', local: true}});
        const info = await h.backend.request('config.callbackAddresses', 'ccu.lan');
        expect(info.auto).toEqual({address: '127.0.0.1', reason: 'loopback'});
        await h.backend.stop();
    });

    it('says nothing about publishing outside a container (task 38)', async () => {
        const h = await harness();
        expect(await h.backend.request('config.get')).not.toHaveProperty('publishCallbackPorts');
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

    it('repairs the UTF-8 link texts the XML-RPC client read as ISO-8859-1 (B-23, #156)', async () => {
        // what the reporter's Links tab showed: rfd hands back the UTF-8 bytes of the WebUI's
        // default description, and the latin1 decode makes two characters of every umlaut
        const h = await harness({
            answers: {
                'BidCos-RF': (method) => {
                    switch (method) {
                        case 'getLinks':
                            return [
                                {
                                    SENDER: 'LEQ1:1',
                                    RECEIVER: 'LEQ2:1',
                                    NAME: 'KÃ¼che',
                                    DESCRIPTION: 'StandardverknÃ¼pfung',
                                },
                                {SENDER: 'LEQ1:2', RECEIVER: 'LEQ2:2', NAME: 'Küche 21 °C', FLAGS: 0},
                            ];
                        case 'getLinkInfo':
                            return {NAME: 'Au\u00c3\u009fent\u00c3\u00bcr', DESCRIPTION: 'Taster 1'};
                        default:
                            return '';
                    }
                },
            },
        });
        expect(await h.backend.request('links.list', 'BidCos-RF')).toEqual([
            {SENDER: 'LEQ1:1', RECEIVER: 'LEQ2:1', NAME: 'Küche', DESCRIPTION: 'Standardverknüpfung'},
            {SENDER: 'LEQ1:2', RECEIVER: 'LEQ2:2', NAME: 'Küche 21 °C', FLAGS: 0},
        ]);
        expect(await h.backend.request('links.info.get', 'BidCos-RF', 'LEQ1:1', 'LEQ2:1')).toEqual({
            SENDER: 'LEQ1:1',
            RECEIVER: 'LEQ2:1',
            NAME: 'Außentür',
            DESCRIPTION: 'Taster 1',
        });
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

    /**
     * Issue #146: the refresh button of the service-message tab asked `serviceMessages.list`,
     * which answers from the cache the events and the five-minute poll fill - so it changed
     * nothing and read as a button without a function. `serviceMessages.refresh` makes the round
     * trip: `getServiceMessages` per BidCos interface, the `:0` sweep on HmIP.
     */
    it('reads the interfaces again on serviceMessages.refresh (#146)', async () => {
        let messages: RpcValue = [['LEQ1:0', 'STICKY_UNREACH', true]];
        const h = await harness({
            answers: {
                'BidCos-RF': (method, params) =>
                    method === 'getServiceMessages'
                        ? messages
                        : (defaultAnswers['BidCos-RF'] as Answer)(method, params),
            },
        });
        expect(await h.backend.request('serviceMessages.list', 'BidCos-RF')).toHaveLength(1);

        // the interface has nothing to report any more; the cache still has the old message
        messages = [];
        h.calls.length = 0;
        expect(await h.backend.request('serviceMessages.list', 'BidCos-RF')).toHaveLength(1);
        expect(h.calls.some((call) => call.method === 'getServiceMessages')).toBe(false);

        expect(await h.backend.request('serviceMessages.refresh', 'BidCos-RF')).toEqual([]);
        expect(h.calls.some((call) => call.interfaceName === 'BidCos-RF' && call.method === 'getServiceMessages')).toBe(
            true,
        );
        expect(await h.backend.request('serviceMessages.list', 'BidCos-RF')).toEqual([]);
        await h.backend.stop();
    });

    it('sweeps the HmIP maintenance channels on serviceMessages.refresh (#146)', async () => {
        const h = await harness({
            answers: {
                'HmIP-RF': (method, params) =>
                    method === 'getParamset' && params[1] === 'VALUES'
                        ? {RSSI_DEVICE: -50, STICKY_UNREACH: true}
                        : (defaultAnswers['HmIP-RF'] as Answer)(method, params),
            },
        });
        expect(await h.backend.request('serviceMessages.refresh', 'HmIP-RF')).toEqual([
            expect.objectContaining({address: 'ABC1:0', datapoint: 'STICKY_UNREACH'}),
        ]);
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

/**
 * B-26 (#158): CUxD wrote `called unknown request method 'getServiceMessages'` into the CCU's syslog
 * every five minutes, and the backend logged the fault just as often. The poll asked CUxD, and its
 * fault `unknown.method name` was not recognised as "no such method", so nothing was remembered.
 */
describe('the service-message poll and methods an interface does not have (B-26, #158)', () => {
    /** A missing method, worded the way CUxD words it and wrapped the way the BIN-RPC client does. */
    const unknownMethod = (interfaceName: string, method: string): BackendError =>
        rpcFaultError(`${interfaceName} (127.0.0.1:8701, binrpc): ${method}`, {
            faultCode: -1,
            faultString: `${method}: unknown.method name`,
        });

    const CUSTOM = {name: 'Custom', host: 'ccu.lan', port: 2121, protocol: 'xmlrpc', path: '/RPC3'};

    function callsOf(h: Harness, interfaceName: string, method: string): number {
        return h.calls.filter((call) => call.interfaceName === interfaceName && call.method === method).length;
    }

    function noticesAbout(h: Harness, text: string): string[] {
        return h.events
            .filter((event) => event.name === 'notice')
            .map((event) => (event.payload as {message: string}).message)
            .filter((message) => message.includes(text));
    }

    it('never asks CUxD', async () => {
        const h = await harness({
            connection: {interfaces: ['BidCos-RF', 'CUxD']},
            answers: {
                CUxD: (method) =>
                    method === 'getServiceMessages' || method === 'system.listMethods'
                        ? unknownMethod('CUxD', method)
                        : '',
            },
        });
        expect((await h.backend.request('interfaces.list')).map((state) => [state.name, state.connected])).toEqual([
            ['BidCos-RF', true],
            ['CUxD', true],
        ]);

        await h.backend.pollServiceMessages();
        await h.backend.pollServiceMessages();
        await h.backend.request('serviceMessages.refresh');

        expect(callsOf(h, 'CUxD', 'getServiceMessages')).toBe(0);
        // the table decides for a built-in interface; its method list is not needed for that
        expect(callsOf(h, 'CUxD', 'system.listMethods')).toBe(0);
        // the sweep after the connect, two polls and the refresh
        expect(callsOf(h, 'BidCos-RF', 'getServiceMessages')).toBe(4);
        expect(noticesAbout(h, 'getServiceMessages')).toEqual([]);
        await h.backend.stop();
    });

    it('does not ask a user-defined interface whose system.listMethods lacks the method', async () => {
        let methods = ['init', 'ping', 'listDevices', 'system.listMethods'];
        const h = await harness({
            connection: {interfaces: ['BidCos-RF', 'Custom'], extraInterfaces: [CUSTOM]},
            answers: {
                Custom: (method) => {
                    switch (method) {
                        case 'system.listMethods':
                            return methods;
                        case 'getServiceMessages':
                            return [];
                        default:
                            return '';
                    }
                },
            },
        });
        await h.backend.pollServiceMessages();
        await h.backend.pollServiceMessages();

        expect(callsOf(h, 'Custom', 'getServiceMessages')).toBe(0);
        // once for the subscription, not once per round
        expect(callsOf(h, 'Custom', 'system.listMethods')).toBe(1);

        // a re-`init` may be a restarted, updated process: its list is asked again
        methods = [...methods, 'getServiceMessages'];
        await h.backend.request('interfaces.reconnect', 'Custom');
        expect(callsOf(h, 'Custom', 'system.listMethods')).toBe(2);
        expect(callsOf(h, 'Custom', 'getServiceMessages')).toBe(1);
        await h.backend.pollServiceMessages();
        expect(callsOf(h, 'Custom', 'system.listMethods')).toBe(2);
        expect(callsOf(h, 'Custom', 'getServiceMessages')).toBe(2);
        await h.backend.stop();
    });

    it('asks a user-defined interface without system.listMethods once, and remembers both answers', async () => {
        const h = await harness({
            connection: {interfaces: ['BidCos-RF', 'Custom'], extraInterfaces: [CUSTOM]},
            answers: {
                Custom: (method) =>
                    method === 'getServiceMessages' || method === 'system.listMethods'
                        ? unknownMethod('Custom', method)
                        : '',
            },
        });
        expect(callsOf(h, 'Custom', 'system.listMethods')).toBe(1);
        expect(callsOf(h, 'Custom', 'getServiceMessages')).toBe(1);

        await h.backend.pollServiceMessages();
        await h.backend.request('interfaces.reconnect', 'Custom');
        await h.backend.pollServiceMessages();

        expect(callsOf(h, 'Custom', 'system.listMethods')).toBe(1);
        expect(callsOf(h, 'Custom', 'getServiceMessages')).toBe(1);
        expect(noticesAbout(h, 'getServiceMessages')).toEqual([]);
        expect(noticesAbout(h, 'listMethods')).toEqual([]);
        await h.backend.stop();
    });

    it('asks for the method list again after a failure that may pass', async () => {
        let listMethods: RpcValue | Error = connectionError('Custom: system.listMethods timed out after 5000 ms');
        const h = await harness({
            connection: {interfaces: ['BidCos-RF', 'Custom'], extraInterfaces: [CUSTOM]},
            answers: {
                Custom: (method) => {
                    switch (method) {
                        case 'system.listMethods':
                            return listMethods;
                        case 'getServiceMessages':
                            return [];
                        default:
                            return '';
                    }
                },
            },
        });
        // no list: tried, as before
        expect(callsOf(h, 'Custom', 'system.listMethods')).toBe(1);
        expect(callsOf(h, 'Custom', 'getServiceMessages')).toBe(1);

        listMethods = ['init', 'system.listMethods'];
        await h.backend.pollServiceMessages();
        await h.backend.pollServiceMessages();
        expect(callsOf(h, 'Custom', 'system.listMethods')).toBe(2);
        expect(callsOf(h, 'Custom', 'getServiceMessages')).toBe(1);
        await h.backend.stop();
    });

    it('logs a failing getServiceMessages once, and again only after it answered in between', async () => {
        let failing = true;
        const h = await harness({
            answers: {
                'BidCos-RF': (method, params) =>
                    method === 'getServiceMessages' && failing
                        ? connectionError(
                              'BidCos-RF (ccu.lan:2001, xmlrpc): getServiceMessages timed out after 5000 ms',
                          )
                        : (defaultAnswers['BidCos-RF'] as Answer)(method, params),
            },
        });
        // the sweep after the connect failed and said so
        expect(noticesAbout(h, 'getServiceMessages failed')).toHaveLength(1);
        await h.backend.pollServiceMessages();
        await h.backend.pollServiceMessages();
        expect(noticesAbout(h, 'getServiceMessages failed')).toHaveLength(1);
        // a timeout is not "no such method": every round still asks
        expect(callsOf(h, 'BidCos-RF', 'getServiceMessages')).toBe(3);

        failing = false;
        await h.backend.pollServiceMessages();
        await h.backend.pollServiceMessages();
        expect(noticesAbout(h, 'getServiceMessages answers again')).toHaveLength(1);
        expect(await h.backend.request('serviceMessages.list', 'BidCos-RF')).toHaveLength(1);

        failing = true;
        await h.backend.pollServiceMessages();
        await h.backend.pollServiceMessages();
        expect(noticesAbout(h, 'getServiceMessages failed')).toHaveLength(2);
        expect(noticesAbout(h, 'getServiceMessages answers again')).toHaveLength(1);
        await h.backend.stop();
    });
});

describe('the console and data files', () => {
    it('sends a read straight through and a write through the queue, both into the log', async () => {
        const h = await harness();
        await h.backend.request('rpc.call', 'HmIP-RF', 'getVersion', []);
        expect((await h.backend.request('rpcLog.list')).at(-1)).toMatchObject({
            method: 'getVersion',
            origin: 'console',
        });
        await h.backend.request('rpc.call', 'HmIP-RF', 'setValue', ['ABC1:1', 'STATE', true]);
        expect((await h.backend.request('rpcLog.list')).at(-1)).toMatchObject({method: 'setValue', origin: 'console'});
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

describe('the RPC log (task 48)', () => {
    const entriesOf = async (h: Harness, method: string) =>
        (await h.backend.request('rpcLog.list')).filter((entry) => entry.method === method);

    it('logs the connection as background work although a config.set asked for it', async () => {
        const h = await harness();
        // the harness connects through `config.set`, a UI request: the init, the listDevices
        // sweep and the service messages after it belong to the backend, not to that request
        const log = await h.backend.request('rpcLog.list');
        expect(log.length).toBeGreaterThan(0);
        expect(log.map((entry) => entry.method)).toEqual(expect.arrayContaining(['init', 'listDevices']));
        expect(new Set(log.map((entry) => entry.origin))).toEqual(new Set(['background']));
        expect(log.find((entry) => entry.method === 'init')?.params).toEqual([
            'http://192.168.1.5:2042',
            'hmm_HmIP-RF',
        ]);
        await h.backend.stop();
    });

    it('tells a UI action, the console and the background apart', async () => {
        const h = await harness();
        await h.backend.request('devices.list', 'HmIP-RF', {refresh: true});
        expect((await entriesOf(h, 'listDevices')).at(-1)?.origin).toBe('ui');
        await h.backend.request('rpc.call', 'HmIP-RF', 'getVersion', []);
        expect((await entriesOf(h, 'getVersion')).at(-1)?.origin).toBe('console');
        await h.backend.request('value.set', 'HmIP-RF', 'ABC1:1', 'LOGGING', true);
        expect((await entriesOf(h, 'setValue')).at(-1)?.origin).toBe('ui');
        await h.backend.pollServiceMessages();
        expect((await entriesOf(h, 'getServiceMessages')).at(-1)?.origin).toBe('background');
        await h.backend.stop();
    });

    it('logs the idle unsubscribe and the resubscribe as background (D-31)', async () => {
        vi.useFakeTimers();
        try {
            const h = await harness({backend: {idleUnsubscribeMs: 60_000}});
            h.backend.noteSessions(1);
            h.backend.noteSessions(0);
            await vi.advanceTimersByTimeAsync(60_000);
            const deinit = (await entriesOf(h, 'init')).filter((entry) => entry.params[1] === '');
            expect(deinit.length).toBeGreaterThan(0);
            expect(deinit.every((entry) => entry.origin === 'background')).toBe(true);
            h.backend.noteSessions(1);
            await vi.advanceTimersByTimeAsync(10);
            const again = (await entriesOf(h, 'init')).filter((entry) => entry.params[1] !== '');
            expect(again.length).toBeGreaterThan(1);
            expect(again.every((entry) => entry.origin === 'background')).toBe(true);
            await h.backend.stop();
        } finally {
            vi.useRealTimers();
        }
    });

    it('logs a queued write with the origin of whoever enqueued it', async () => {
        const h = await harness({connection: {writePaceMs: 5}});
        // a console write first, so the UI write below runs from the queue's timer - in the
        // draining context of the console's, which is not where it came from
        const console_ = h.backend.request('rpc.call', 'HmIP-RF', 'setValue', ['ABC1:1', 'LOGGING', true]);
        const ui = h.backend.request('value.set', 'HmIP-RF', 'ABC1:1', 'LOGGING', false);
        await Promise.all([console_, ui]);
        const writes = (await h.backend.request('rpcLog.list')).filter((entry) => entry.method === 'setValue');
        expect(writes.map((entry) => [entry.params[2], entry.origin])).toEqual([
            [true, 'console'],
            [false, 'ui'],
        ]);
        await h.backend.stop();
    });

    it('records every call that reaches a transport - nothing bypasses the logging layer', async () => {
        const h = await harness({realClient: true});
        await h.backend.request('devices.list', 'HmIP-RF', {refresh: true});
        await h.backend.request('rpc.call', 'HmIP-RF', 'getVersion', []);
        await h.backend.request('value.set', 'HmIP-RF', 'ABC1:1', 'LOGGING', true);
        await h.backend.request('paramset.get', 'HmIP-RF', 'ABC1:1', 'MASTER');
        await h.backend.request('serviceMessages.refresh', 'BidCos-RF');
        await h.backend.request('rpc.call', 'HmIP-RF', 'noSuchMethod', []).catch(() => undefined);
        await h.backend.pollServiceMessages();
        await h.backend.sweepHmip();
        await h.backend.stop();
        // `stop()` de-registers with `init('')`; that is on the wire and therefore in the log
        const log = await h.backend.request('rpcLog.list');
        expect(h.transportCalls.length).toBeGreaterThan(10);
        expect(log.map((entry) => `${entry.interfaceName} ${entry.method}`).sort()).toEqual(
            h.transportCalls.map((call) => `${call.interfaceName} ${call.method}`).sort(),
        );
        expect(log.every((entry) => ['console', 'ui', 'background'].includes(entry.origin))).toBe(true);
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

describe('the heating groups of openccu-lite (task 57)', () => {
    const TOKEN = 'olt_0123456789abcdef0123456789abcdef';
    const SEC_SC = {id: 'KEQ0165114', serial: 'KEQ0165114', type: 'HM-Sec-SC'};

    /**
     * A box made of a function: the metadata API the provider probes and follows, and the groups
     * API the client speaks - one `fetch` for both, which is how the backend injects it.
     */
    function box(): {fetch: typeof globalThis.fetch; calls: string[]; credentials: (string | undefined)[]} {
        const calls: string[] = [];
        const credentials: (string | undefined)[] = [];
        const json = (body: unknown, status = 200): Response =>
            new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
        const detail = {
            id: 1,
            name: 'Bad',
            type: 'HomeMatic.heating',
            device: 'INT0000001',
            ref: 'VirtualDevices.INT0000001',
            device_name: '',
            forbid_single_operation: false,
            members: [SEC_SC],
            assignable: [],
            leftover: [],
            types: [{id: 'HomeMatic.heating', label: 'Heating_Control'}],
        };
        const fetchImpl = ((input: string | URL, init?: RequestInit) => {
            const url = new URL(String(input));
            const method = init?.method ?? 'GET';
            const headers = (init?.headers ?? {}) as Record<string, string>;
            const route = `${method} ${url.pathname}`;
            if (url.pathname.startsWith('/api/system/')) {
                calls.push(typeof init?.body === 'string' ? `${route} ${init.body}` : route);
                credentials.push(headers['Authorization']);
            }
            switch (route) {
                case 'GET /api/meta/v1/version':
                    return Promise.resolve(
                        json({api: 'meta', version: 1, format: 1, revision: 3, implementation: 'test'}),
                    );
                case 'GET /api/meta/v1/snapshot':
                    return Promise.resolve(json({format: 1, revision: 3, objects: {}, enums: {}}));
                case 'GET /api/meta/v1/events/sse':
                    return Promise.resolve(
                        new Response(new ReadableStream({start: () => undefined}), {
                            headers: {'Content-Type': 'text/event-stream'},
                        }),
                    );
                case 'GET /api/system/v1/groups':
                    return Promise.resolve(
                        json({
                            groups: [
                                {
                                    id: 1,
                                    name: 'Bad',
                                    type: 'HomeMatic.heating',
                                    type_label: 'Heating_Control',
                                    device: 'INT0000001',
                                    ref: 'VirtualDevices.INT0000001',
                                },
                            ],
                            devices_to_configure: [],
                        }),
                    );
                case 'GET /api/system/v1/groups/1':
                    return Promise.resolve(json(detail));
                case 'PUT /api/system/v1/groups/1':
                    return Promise.resolve(json({...detail, members: [], devices_to_configure: [SEC_SC]}));
                default:
                    return Promise.resolve(json({error: 'unknown-path', message: route}, 404));
            }
        }) as unknown as typeof globalThis.fetch;
        return {fetch: fetchImpl, calls, credentials};
    }

    it('answers the state, the list and a change through the box, every call with the configured token', async () => {
        const b = box();
        const h = await harness({
            connection: {metaUrl: 'http://box', metaToken: TOKEN},
            backend: {metaOptions: {fetch: b.fetch}},
        });
        // `groups.state` waits for the detection; `meta.state` does not, so it comes second
        expect(await h.backend.request('groups.state')).toEqual({available: true});
        expect(await h.backend.request('meta.state')).toMatchObject({provider: 'occulite', reachable: true});

        const list = await h.backend.request('groups.list');
        expect(list.groups).toEqual([
            expect.objectContaining({id: 1, name: 'Bad', typeLabel: 'Heating_Control', members: [SEC_SC]}),
        ]);

        // the members as a whole, the name left out because it did not change
        const change = await h.backend.request('groups.update', 1, undefined, []);
        expect(change).toMatchObject({id: 1, members: [], devicesToConfigure: [SEC_SC]});
        expect(b.calls).toContain('PUT /api/system/v1/groups/1 {"members":[]}');
        // over the WebSocket an omitted argument arrives as `null`, and that keeps the field as well
        // (the e2e suite found the box being sent `"name":null`)
        await h.backend.request('groups.update', 1, null as never, ['KEQ0165114']);
        expect(b.calls.at(-1)).toBe('PUT /api/system/v1/groups/1 {"members":["KEQ0165114"]}');
        expect(new Set(b.credentials)).toEqual(new Set([`Bearer ${TOKEN}`]));
        await h.backend.stop();
    });

    it('sends the person’s session once the host has noted one - the token is the fallback, never the local token', async () => {
        const b = box();
        const h = await harness({
            connection: {metaUrl: 'http://box', metaToken: TOKEN},
            backend: {metaOptions: {fetch: b.fetch}},
        });
        await h.backend.request('groups.state');
        h.backend.noteMetaSession('@QL5IGTZSCJSV4H4AHCVOX4MQVC@');
        await h.backend.request('groups.state');
        expect(b.credentials).toEqual([`Bearer ${TOKEN}`, 'Bearer QL5IGTZSCJSV4H4AHCVOX4MQVC']);
        await h.backend.stop();
    });

    it('says no-box on a CCU, and refuses the list with a config error rather than asking anybody', async () => {
        let asked = 0;
        const h = await harness({
            backend: {
                metaOptions: {
                    fetch: () => {
                        asked += 1;
                        return Promise.resolve(new Response('not found', {status: 404}));
                    },
                },
            },
        });
        expect(await h.backend.request('groups.state')).toEqual({available: false, reason: 'no-box'});
        await expect(h.backend.request('groups.list')).rejects.toMatchObject({kind: 'config'});
        // the one call was the metadata probe; the groups never went near the network
        expect(asked).toBe(1);
        await h.backend.stop();
    });
});
