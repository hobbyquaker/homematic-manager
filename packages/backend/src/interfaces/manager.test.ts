import {describe, expect, it, vi} from 'vitest';

import type {ConnectionConfig, InterfaceState, RpcProtocol, RpcValue} from '@homematic-manager/core';

import {BackendError} from '../errors.js';
import {normaliseConnection} from '../config/defaults.js';
import {RpcClient, type RpcClientOptions} from '../rpc/client.js';
import type {CallbackHandler, CallbackServerSet} from '../rpc/server.js';
import {InterfaceManager, firstBidcosInterfaceAddress} from './manager.js';

/** A callback server set that binds nothing. */
function fakeServers(): CallbackServerSet & {stopped: boolean; started: RpcProtocol[]} {
    const ports: Record<string, number> = {xmlrpc: 2042, binrpc: 2043};
    return {
        stopped: false,
        started: [] as RpcProtocol[],
        ensure(protocol) {
            this.started.push(protocol);
            return Promise.resolve(ports[protocol] ?? 0);
        },
        port: (protocol) => ports[protocol] ?? 0,
        callbackUrl: (protocol, ip) =>
            `${protocol === 'binrpc' ? 'xmlrpc_bin://' : 'http://'}${ip}:${String(ports[protocol] ?? 0)}`,
        stop() {
            this.stopped = true;
            return Promise.resolve();
        },
    };
}

type Answer = (method: string, params: readonly RpcValue[]) => RpcValue | Error;

/** Records every call and answers from a per-interface table. */
function fakeClients(answers: Record<string, Answer> = {}): {
    create: (options: RpcClientOptions) => RpcClient;
    calls: {name: string; method: string; params: readonly RpcValue[]}[];
    closed: string[];
} {
    const calls: {name: string; method: string; params: readonly RpcValue[]}[] = [];
    const closed: string[] = [];
    return {
        calls,
        closed,
        create: (options) => {
            const answer = answers[options.name] ?? (() => '');
            return {
                name: options.name,
                host: options.host,
                port: options.port,
                protocol: options.protocol,
                closed: false,
                description: `${options.name} (${options.host}:${String(options.port)}, ${options.protocol})`,
                call: (method: string, params: readonly RpcValue[] = []) => {
                    calls.push({name: options.name, method, params});
                    const value = answer(method, params);
                    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
                },
                close: () => closed.push(options.name),
            } as unknown as RpcClient;
        },
    };
}

interface Harness {
    manager: InterfaceManager;
    states: InterfaceState[][];
    notices: {level: string; message: string; interfaceName?: string}[];
    connected: string[];
    servers: ReturnType<typeof fakeServers>;
    clients: ReturnType<typeof fakeClients>;
    clock: {value: number};
}

function harness(
    options: {
        connection?: Partial<ConnectionConfig>;
        answers?: Record<string, Answer>;
        probe?: (host: string, port: number) => Promise<boolean>;
        initBackoffMs?: number;
    } = {},
): Harness {
    const states: InterfaceState[][] = [];
    const notices: Harness['notices'] = [];
    const connected: string[] = [];
    const servers = fakeServers();
    const clients = fakeClients(options.answers);
    const clock = {value: 1_000_000};
    const handler = {} as CallbackHandler;
    const connection = normaliseConnection({
        host: 'ccu.lan',
        interfaces: ['BidCos-RF', 'HmIP-RF'],
        callback: {ip: '192.168.1.5', xmlrpcPort: 0, binrpcPort: 0},
        ...options.connection,
    });
    const manager = new InterfaceManager({
        connection,
        handler,
        onStateChanged: (next) => states.push(next.map((state) => ({...state}))),
        onNotice: (level, message, interfaceName) =>
            notices.push({level, message, ...(interfaceName === undefined ? {} : {interfaceName})}),
        onConnected: (name) => {
            connected.push(name);
        },
        now: () => clock.value,
        watchdogIntervalMs: 0,
        createClient: clients.create,
        createCallbackServers: () => servers,
        ...(options.initBackoffMs === undefined ? {} : {initBackoffMs: options.initBackoffMs}),
        ...(options.probe ? {probe: options.probe} : {probe: () => Promise.resolve(true)}),
    });
    return {manager, states, notices, connected, servers, clients, clock};
}

describe('firstBidcosInterfaceAddress', () => {
    it('takes the address of the first entry', () => {
        expect(firstBidcosInterfaceAddress([{ADDRESS: 'XEQ0123456', TYPE: 'HMIP_CCU'}])).toBe('XEQ0123456');
    });

    it('survives every shape 2.x crashed on (#93)', () => {
        expect(firstBidcosInterfaceAddress([])).toBeUndefined();
        expect(firstBidcosInterfaceAddress('')).toBeUndefined();
        expect(firstBidcosInterfaceAddress([[1, 2]])).toBeUndefined();
        expect(firstBidcosInterfaceAddress([{TYPE: 'X'}])).toBeUndefined();
        expect(firstBidcosInterfaceAddress([{ADDRESS: ''}])).toBeUndefined();
        expect(firstBidcosInterfaceAddress([{ADDRESS: 42}])).toBeUndefined();
    });
});

describe('InterfaceManager.start', () => {
    it('refuses to start without a host', async () => {
        await expect(harness({connection: {host: ''}}).manager.start()).rejects.toThrow('no CCU address configured');
    });

    it('refuses to start when no name resolves to an interface', async () => {
        // `normaliseConnection` drops unknown names, so this can only come from a caller that
        // bypassed it - the manager still has to say so rather than sit there with no client
        const h = harness();
        const manager = new InterfaceManager({
            connection: {...normaliseConnection({host: 'ccu.lan'}), interfaces: ['Nothing']},
            handler: {} as CallbackHandler,
            onStateChanged: () => undefined,
            onNotice: () => undefined,
            watchdogIntervalMs: 0,
            createClient: h.clients.create,
            createCallbackServers: () => h.servers,
        });
        await expect(manager.start()).rejects.toThrow('no interface selected');
    });

    it('starts one callback server per protocol and subscribes with the right ident and URL', async () => {
        const h = harness({connection: {interfaces: ['BidCos-RF', 'HmIP-RF', 'CUxD']}});
        await h.manager.start();
        expect(h.servers.started.sort()).toEqual(['binrpc', 'xmlrpc']);
        const inits = h.clients.calls.filter((call) => call.method === 'init');
        expect(inits).toEqual([
            {name: 'BidCos-RF', method: 'init', params: ['http://192.168.1.5:2042', 'hmm_BidCos-RF']},
            {name: 'HmIP-RF', method: 'init', params: ['http://192.168.1.5:2042', 'hmm_HmIP-RF']},
            {name: 'CUxD', method: 'init', params: ['xmlrpc_bin://192.168.1.5:2043', 'CUxD']},
        ]);
        expect(h.manager.names()).toEqual(['BidCos-RF', 'HmIP-RF', 'CUxD']);
    });

    it('reports every interface as connected and calls the connect hook', async () => {
        const h = harness();
        await h.manager.start();
        expect(h.manager.states().map((state) => [state.name, state.connected])).toEqual([
            ['BidCos-RF', true],
            ['HmIP-RF', true],
        ]);
        expect(h.manager.states()[0]?.lastEvent).toBe(1_000_000);
        expect(h.connected).toEqual(['BidCos-RF', 'HmIP-RF']);
    });

    it('keeps going when one interface refuses the subscription', async () => {
        const h = harness({
            answers: {'HmIP-RF': () => Object.assign(new Error('connect ECONNREFUSED'), {})},
        });
        await h.manager.start();
        const [bidcos, hmip] = h.manager.states();
        expect(bidcos?.connected).toBe(true);
        expect(hmip?.connected).toBe(false);
        expect(hmip?.error).toContain('ECONNREFUSED');
        // a refused port is not an error of the interface: nothing is running there (task 13)
        expect(hmip?.absent).toBe(true);
        const notice = h.notices.find((entry) => entry.interfaceName === 'HmIP-RF');
        expect(notice?.level).toBe('warn');
        expect(notice?.message).toContain('not present');
        expect(h.connected).toEqual(['BidCos-RF']);
    });

    it('reports an interface that answers with something other than a refusal as an error', async () => {
        const h = harness({answers: {'HmIP-RF': () => new BackendError({message: 'boom', kind: 'rpc'})}});
        await h.manager.start();
        expect(h.manager.states()[1]?.absent).toBeUndefined();
        expect(h.notices.find((entry) => entry.interfaceName === 'HmIP-RF')?.level).toBe('error');
    });

    it('backs off instead of re-initing a missing interface every round (task 13)', async () => {
        // this is BidCos-Wired on a CCU without a wired gateway: it is in the default interface
        // list, hs485d is not running, and 2.x's watchdog produced four ERROR lines a minute
        const h = harness({
            answers: {'HmIP-RF': () => Object.assign(new Error('connect ECONNREFUSED'), {})},
            initBackoffMs: 15_000,
        });
        await h.manager.start();
        const initsAfterStart = h.clients.calls.filter((call) => call.name === 'HmIP-RF').length;
        expect(initsAfterStart).toBe(1);

        // twenty watchdog rounds of 15 s: without the back-off that is twenty more attempts
        for (let round = 0; round < 20; round += 1) {
            h.clock.value += 15_000;
            await h.manager.tick();
        }
        const attempts = h.clients.calls.filter((call) => call.name === 'HmIP-RF').length;
        // 15 s, 30 s, 60 s, 120 s, 240 s and then the 300 s ceiling: five within the five minutes
        expect(attempts).toBeGreaterThan(1);
        expect(attempts).toBeLessThan(8);
        // and exactly one notice, however often it was tried
        expect(h.notices.filter((entry) => entry.interfaceName === 'HmIP-RF')).toHaveLength(1);
    });

    it('never waits longer than five minutes, and starts over when the user asks', async () => {
        let refuse = true;
        const h = harness({
            answers: {
                'HmIP-RF': () => (refuse ? Object.assign(new Error('connect ECONNREFUSED'), {}) : ''),
            },
            initBackoffMs: 15_000,
        });
        await h.manager.start();
        for (let round = 0; round < 40; round += 1) {
            h.clock.value += 60_000;
            await h.manager.tick();
        }
        const attempts = h.clients.calls.filter((call) => call.name === 'HmIP-RF').length;
        // forty minutes at the 300 s ceiling is eight attempts, plus the ones before it
        expect(attempts).toBeGreaterThanOrEqual(8);

        refuse = false;
        await h.manager.reconnect('HmIP-RF');
        const state = h.manager.states()[1];
        expect(state?.connected).toBe(true);
        expect(state?.absent).toBeUndefined();
        expect(h.notices.filter((entry) => entry.interfaceName === 'HmIP-RF' && entry.level === 'info')).toHaveLength(
            1,
        );
    });

    it('finds the callback address itself when none is configured', () => {
        const h = harness({connection: {callback: {ip: '', xmlrpcPort: 0, binrpcPort: 0}}});
        expect(h.manager.callbackIp).toBeTypeOf('string');
    });
});

describe('the watchdog', () => {
    it('pings after two thirds of the timeout and re-inits after all of it', async () => {
        const h = harness({connection: {interfaces: ['BidCos-RF']}});
        await h.manager.start();
        h.clients.calls.length = 0;

        // BidCos-RF has a 60 s timeout: nothing to do after 10 s
        h.clock.value += 10_000;
        await h.manager.tick();
        expect(h.clients.calls).toEqual([]);

        // 45 s of silence: ping
        h.clock.value += 35_000;
        await h.manager.tick();
        expect(h.clients.calls.map((call) => call.method)).toEqual(['ping']);

        // 61 s of silence: the subscription is gone
        h.clock.value += 16_000;
        h.clients.calls.length = 0;
        await h.manager.tick();
        expect(h.clients.calls.map((call) => call.method)).toEqual(['init']);
    });

    it('gives HmIP its 600 s (eq-3/occu#42)', async () => {
        const h = harness({connection: {interfaces: ['HmIP-RF']}});
        await h.manager.start();
        h.clients.calls.length = 0;
        h.clock.value += 120_000;
        await h.manager.tick();
        expect(h.clients.calls).toEqual([]);
        h.clock.value += 300_000;
        await h.manager.tick();
        expect(h.clients.calls.map((call) => call.method)).toEqual(['ping']);
        h.clock.value += 181_000;
        h.clients.calls.length = 0;
        await h.manager.tick();
        expect(h.clients.calls.map((call) => call.method)).toEqual(['init']);
    });

    it('never pings an interface that answers none, but still re-inits it', async () => {
        const h = harness({connection: {interfaces: ['VirtualDevices']}});
        await h.manager.start();
        h.clients.calls.length = 0;
        h.clock.value += 50_000;
        await h.manager.tick();
        expect(h.clients.calls).toEqual([]);
        h.clock.value += 20_000;
        await h.manager.tick();
        expect(h.clients.calls.map((call) => call.method)).toEqual(['init']);
    });

    it('keeps a failing ping as a hint without dropping the connection', async () => {
        const h = harness({
            connection: {interfaces: ['BidCos-RF']},
            answers: {'BidCos-RF': (method) => (method === 'ping' ? new Error('no answer') : '')},
        });
        await h.manager.start();
        h.clock.value += 45_000;
        await h.manager.tick();
        expect(h.manager.states()[0]?.connected).toBe(true);
        expect(h.manager.states()[0]?.error).toContain('no answer');
    });

    it('an event resets the clock and brings a lost interface back', async () => {
        const h = harness({connection: {interfaces: ['BidCos-RF']}});
        await h.manager.start();
        h.clock.value += 100_000;
        await h.manager.tick();
        h.clock.value += 1;
        h.manager.noteEvent('BidCos-RF');
        expect(h.manager.isConnected('BidCos-RF')).toBe(true);
        h.clock.value += 10_000;
        h.clients.calls.length = 0;
        await h.manager.tick();
        expect(h.clients.calls).toEqual([]);
    });

    it('ignores an event of an interface it does not manage', async () => {
        const h = harness();
        await h.manager.start();
        expect(() => {
            h.manager.noteEvent('Nothing');
        }).not.toThrow();
    });
});

describe('client, reconnect and stop', () => {
    it('hands out the client of a configured interface and refuses others', async () => {
        const h = harness();
        await h.manager.start();
        expect(h.manager.client('HmIP-RF').name).toBe('HmIP-RF');
        expect(() => h.manager.client('Nothing')).toThrow(BackendError);
        expect(() => h.manager.client('Nothing')).toThrow('is not configured');
    });

    it('reconnects one interface or all of them', async () => {
        const h = harness();
        await h.manager.start();
        h.clients.calls.length = 0;
        await h.manager.reconnect('HmIP-RF');
        expect(h.clients.calls.map((call) => call.name)).toEqual(['HmIP-RF']);
        h.clients.calls.length = 0;
        await h.manager.reconnect();
        expect(h.clients.calls.map((call) => call.name)).toEqual(['BidCos-RF', 'HmIP-RF']);
        await expect(h.manager.reconnect('Nothing')).rejects.toThrow('is not configured');
    });

    it('de-registers with an empty ident, closes the clients and the servers', async () => {
        const h = harness();
        await h.manager.start();
        h.clients.calls.length = 0;
        await h.manager.stop();
        expect(h.clients.calls).toEqual([
            {name: 'BidCos-RF', method: 'init', params: ['http://192.168.1.5:2042', '']},
            {name: 'HmIP-RF', method: 'init', params: ['http://192.168.1.5:2042', '']},
        ]);
        expect(h.clients.closed.sort()).toEqual(['BidCos-RF', 'HmIP-RF']);
        expect(h.servers.stopped).toBe(true);
        expect(h.manager.states()).toEqual([]);
    });

    it('closes even when the CCU does not answer the de-registration', async () => {
        const h = harness({answers: {'BidCos-RF': () => new Error('gone'), 'HmIP-RF': () => new Error('gone')}});
        await h.manager.start();
        await expect(h.manager.stop()).resolves.toBeUndefined();
        expect(h.servers.stopped).toBe(true);
    });
});

describe('the background port probe', () => {
    it('reports which interfaces answered', async () => {
        const open = new Set([2001, 2010]);
        const h = harness({probe: (_host, port) => Promise.resolve(open.has(port))});
        await h.manager.start();
        await expect(h.manager.probeInterfaces()).resolves.toEqual(['BidCos-RF', 'HmIP-RF']);
        expect(h.manager.detected).toEqual(['BidCos-RF', 'HmIP-RF']);
    });

    it('warns about a configured interface whose port is closed and is not connected', async () => {
        const h = harness({
            connection: {interfaces: ['BidCos-RF', 'HmIP-RF'], autoDetect: false},
            answers: {'HmIP-RF': () => new Error('refused')},
            probe: (_host, port) => Promise.resolve(port === 2001),
        });
        await h.manager.start();
        await h.manager.probeInterfaces();
        const warnings = h.notices.filter((notice) => notice.level === 'warn');
        expect(warnings.map((notice) => notice.interfaceName)).toEqual(['HmIP-RF']);
    });

    it('probes the TLS ports when TLS is on', async () => {
        const seen: number[] = [];
        const h = harness({
            connection: {tls: true},
            probe: (_host, port) => {
                seen.push(port);
                return Promise.resolve(false);
            },
        });
        await h.manager.probeInterfaces();
        expect(seen).toContain(42_001);
        expect(seen).toContain(42_010);
    });

    it('is started in the background when autoDetect is on and skipped when it is off', async () => {
        const probe = vi.fn(() => Promise.resolve(true));
        const off = harness({connection: {autoDetect: false}, probe});
        await off.manager.start();
        expect(probe).not.toHaveBeenCalled();
        const on = harness({connection: {autoDetect: true}, probe});
        await on.manager.start();
        expect(probe).toHaveBeenCalled();
    });
});
