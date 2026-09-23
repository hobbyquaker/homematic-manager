import net from 'node:net';
import os from 'node:os';

import {describe, expect, it, vi} from 'vitest';

import type {
    ConnectionConfig,
    InterfaceState,
    RpcProtocol,
    RpcValue,
    UserDefinedInterface,
} from '@homematic-manager/core';

import {BackendError} from '../errors.js';
import {normaliseConnection} from '../config/defaults.js';
import {RpcClient, type RpcClientOptions} from '../rpc/client.js';
import type {CallbackHandler, CallbackServerSet} from '../rpc/server.js';
import type {CallbackNetwork, LocalIPv4, PortProbe} from '../util/net.js';
import {
    InterfaceManager,
    START_WINDOW_MS,
    callbackBindHost,
    firstBidcosInterfaceAddress,
    startRetryDelay,
} from './manager.js';

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

/**
 * B-53: a machine in `192.168.1.0/24` whose CCU `ccu.lan` is `192.168.1.2` - unless the test says
 * otherwise. `lookups` counts the name lookups, `routes` the route probes.
 */
function fakeNetwork(
    options: {
        interfaces?: LocalIPv4[];
        hosts?: Record<string, string>;
        route?: (address: string) => string | undefined;
    } = {},
): CallbackNetwork & {lookups: string[]; routes: string[]; set: (interfaces: LocalIPv4[]) => void} {
    let interfaces = options.interfaces ?? [{address: '192.168.1.5', netmask: '255.255.255.0'}];
    const hosts = options.hosts ?? {'ccu.lan': '192.168.1.2'};
    const lookups: string[] = [];
    const routes: string[] = [];
    return {
        lookups,
        routes,
        set: (next) => {
            interfaces = next;
        },
        interfaces: () => interfaces,
        resolve: (host) => {
            lookups.push(host);
            return Promise.resolve(/^\d+\.\d+\.\d+\.\d+$/.test(host) ? host : hosts[host]);
        },
        route: (address) => {
            routes.push(address);
            return Promise.resolve(options.route?.(address));
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
        probe?: (host: string, port: number) => Promise<PortProbe>;
        initBackoffMs?: number;
        /** Task 56: off unless a test asks, so the others see what happens after the start window. */
        startWindowMs?: number;
        network?: CallbackNetwork;
        keepConfiguredCallbackIp?: boolean;
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
        monotonicNow: () => clock.value,
        watchdogIntervalMs: 0,
        createClient: clients.create,
        createCallbackServers: () => servers,
        ...(options.initBackoffMs === undefined ? {} : {initBackoffMs: options.initBackoffMs}),
        startWindowMs: options.startWindowMs ?? 0,
        network: options.network ?? fakeNetwork(),
        ...(options.keepConfiguredCallbackIp === undefined
            ? {}
            : {keepConfiguredCallbackIp: options.keepConfiguredCallbackIp}),
        ...(options.probe ? {probe: options.probe} : {probe: () => Promise.resolve<PortProbe>('open')}),
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

    it('says in the state whether the interface is talked to over TLS (task 21)', async () => {
        // The port alone does not say it: 42001 is a number, and the interface popup shows the
        // encryption as a word beside protocol and port. Off is absent, not `false`, so the state
        // of a plain installation is byte-identical to what it was before this field existed.
        const plain = harness();
        await plain.manager.start();
        expect(plain.manager.states().map((state) => state.tls)).toEqual([undefined, undefined]);

        const secure = harness({connection: {tls: true}});
        await secure.manager.start();
        expect(secure.manager.states().map((state) => [state.port, state.tls])).toEqual([
            [42_001, true],
            [42_010, true],
        ]);
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

    /**
     * Issue #144: on the CCU itself - the addon, which starts with `--local --ccu 127.0.0.1` - the
     * interface processes are on the loopback and so are we. The box's LAN address worked, but it
     * is the one address that changes, while an `init` registration survives the change in the
     * interface process's handler list, and every other local subscriber on a CCU registers on
     * 127.0.0.1.
     */
    it('calls back on the loopback when it runs on the CCU itself (#144)', async () => {
        const h = harness({
            connection: {host: '127.0.0.1', local: true, callback: {ip: '', xmlrpcPort: 0, binrpcPort: 0}},
        });
        expect(h.manager.callbackIp).toBe('127.0.0.1');

        await h.manager.start();
        expect(h.clients.calls.filter((call) => call.method === 'init').map((call) => call.params[0])).toEqual([
            'xmlrpc_bin://127.0.0.1:2043',
            'http://127.0.0.1:2042',
        ]);
    });

    it('keeps a configured callback address even on the CCU (#144)', () => {
        const h = harness({
            connection: {host: '127.0.0.1', local: true, callback: {ip: '10.0.0.9', xmlrpcPort: 0, binrpcPort: 0}},
        });
        expect(h.manager.callbackIp).toBe('10.0.0.9');
    });
});

/**
 * B-53 (#162, #165): with no callback address set, "the first local address" was the default, and
 * on a Mac with a VPN, a bridge or a link-local address listed first the CCU called back into the
 * void. The default is now the address that reaches the CCU, worked out at every `init`.
 */
describe('the automatic callback address (B-53)', () => {
    const AUTO = {callback: {ip: '', xmlrpcPort: 0, binrpcPort: 0}};
    const initUrls = (h: Harness): RpcValue[] =>
        h.clients.calls.filter((call) => call.method === 'init').map((call) => call.params[0] as RpcValue);

    it('takes the address in the CCU subnet over interfaces listed before it', async () => {
        const network = fakeNetwork({
            interfaces: [
                {address: '10.8.0.2', netmask: '255.255.255.255'}, // utun, a VPN
                {address: '192.168.64.1', netmask: '255.255.255.0'}, // bridge100, a VM
                {address: '192.168.1.5', netmask: '255.255.255.0'},
            ],
        });
        const h = harness({connection: AUTO, network});
        await h.manager.start();
        expect(h.manager.callbackIp).toBe('192.168.1.5');
        expect(initUrls(h)).toEqual(['http://192.168.1.5:2042', 'http://192.168.1.5:2042']);
        // a CCU in our own network needs no route probe
        expect(network.routes).toEqual([]);
        expect(h.notices).toEqual([]);
    });

    it('never takes a link-local address listed first', async () => {
        const network = fakeNetwork({
            interfaces: [
                {address: '169.254.12.34', netmask: '255.255.0.0'},
                {address: '172.20.0.7', netmask: '255.255.0.0'},
            ],
        });
        const h = harness({connection: AUTO, network});
        await h.manager.start();
        // the CCU is in neither network and the route says nothing: the first that is not link-local
        expect(h.manager.callbackIp).toBe('172.20.0.7');
        expect(network.routes).toEqual(['192.168.1.2']);
    });

    it('takes the address the route to a CCU in another network leaves from', async () => {
        const network = fakeNetwork({
            interfaces: [
                {address: '10.8.0.2', netmask: '255.255.255.255'},
                {address: '172.16.23.50', netmask: '255.255.255.0'},
            ],
            hosts: {'ccu.lan': '172.16.24.145'},
            route: () => '172.16.23.50',
        });
        const h = harness({connection: AUTO, network});
        await h.manager.start();
        expect(h.manager.callbackIp).toBe('172.16.23.50');
    });

    it('ignores a route whose source is no address it offers, or is link-local', async () => {
        const network = fakeNetwork({
            interfaces: [
                {address: '169.254.1.1', netmask: '255.255.0.0'},
                {address: '10.0.0.3', netmask: '255.255.255.0'},
            ],
            hosts: {'ccu.lan': '172.16.24.145'},
            route: () => '169.254.1.1',
        });
        const h = harness({connection: AUTO, network});
        await h.manager.start();
        expect(h.manager.callbackIp).toBe('10.0.0.3');
    });

    it('resolves a CCU given by name', async () => {
        const network = fakeNetwork({
            interfaces: [
                {address: '10.0.0.3', netmask: '255.255.255.0'},
                {address: '192.168.178.20', netmask: '255.255.255.0'},
            ],
            hosts: {'ccu3-webui': '192.168.178.2'},
        });
        const h = harness({connection: {...AUTO, host: 'ccu3-webui'}, network});
        // before the first connect only an address literal can be matched: the first address
        expect(h.manager.callbackIp).toBe('10.0.0.3');
        await h.manager.start();
        expect(network.lookups).toEqual(['ccu3-webui']);
        expect(h.manager.callbackIp).toBe('192.168.178.20');
    });

    it('matches an address literal before the first connect', () => {
        const network = fakeNetwork({
            interfaces: [
                {address: '10.0.0.3', netmask: '255.255.255.0'},
                {address: '192.168.178.20', netmask: '255.255.255.0'},
            ],
        });
        const h = harness({connection: {...AUTO, host: '192.168.178.2'}, network});
        expect(h.manager.callbackIp).toBe('192.168.178.20');
    });

    it('falls back to the first address when the name does not resolve', async () => {
        const network = fakeNetwork({hosts: {}});
        const h = harness({connection: {...AUTO, host: 'nowhere.invalid'}, network});
        await h.manager.start();
        expect(h.manager.callbackIp).toBe('192.168.1.5');
        expect(network.routes).toEqual([]);
    });

    it('works it out again at every connect, so a new lease is followed', async () => {
        const network = fakeNetwork();
        const h = harness({connection: AUTO, network});
        await h.manager.start();
        expect(h.manager.callbackIp).toBe('192.168.1.5');
        // one lookup for both interfaces of the same connect
        expect(network.lookups).toEqual(['ccu.lan']);

        network.set([{address: '192.168.1.77', netmask: '255.255.255.0'}]);
        await h.manager.reconnect();
        expect(h.manager.callbackIp).toBe('192.168.1.77');
        expect(initUrls(h).slice(2)).toEqual(['http://192.168.1.77:2042', 'http://192.168.1.77:2042']);

        // and the de-registration names the URL each interface was registered with
        await h.manager.stop();
        const deinit = h.clients.calls.filter((call) => call.method === 'init' && call.params[1] === '');
        expect(deinit.map((call) => call.params[0])).toEqual(['http://192.168.1.77:2042', 'http://192.168.1.77:2042']);
    });

    it('keeps an address that is set and fits', async () => {
        const network = fakeNetwork({
            interfaces: [
                {address: '192.168.1.5', netmask: '255.255.255.0'},
                {address: '192.168.1.6', netmask: '255.255.255.0'},
            ],
        });
        const h = harness({connection: {callback: {ip: '192.168.1.6', xmlrpcPort: 0, binrpcPort: 0}}, network});
        await h.manager.start();
        expect(h.manager.callbackIp).toBe('192.168.1.6');
        expect(h.manager.callbackWarning).toBeUndefined();
        expect(h.manager.states().every((state) => state.callbackWarning === undefined)).toBe(true);
    });

    it('uses the automatic address, and says so once, when the set one is no address of this machine', async () => {
        const network = fakeNetwork();
        const h = harness({connection: {callback: {ip: '192.168.0.99', xmlrpcPort: 0, binrpcPort: 0}}, network});
        await h.manager.start();
        expect(h.manager.callbackIp).toBe('192.168.1.5');
        expect(initUrls(h)).toEqual(['http://192.168.1.5:2042', 'http://192.168.1.5:2042']);
        const warning = {address: '192.168.0.99', reason: 'notLocal', auto: '192.168.1.5'};
        expect(h.manager.callbackWarning).toEqual(warning);
        expect(h.manager.states().map((state) => state.callbackWarning)).toEqual([warning, warning]);
        const said = h.notices.filter((notice) => notice.message.includes('192.168.0.99'));
        expect(said).toHaveLength(1);
        expect(said[0]?.level).toBe('warn');

        await h.manager.reconnect();
        expect(h.notices.filter((notice) => notice.message.includes('192.168.0.99'))).toHaveLength(1);

        // the address comes back: used again, and the warning is gone
        network.set([
            {address: '192.168.1.5', netmask: '255.255.255.0'},
            {address: '192.168.0.99', netmask: '255.255.255.0'},
        ]);
        await h.manager.reconnect();
        expect(h.manager.callbackIp).toBe('192.168.0.99');
        // 192.168.0.99 is not in the CCU's network, so it is kept with the other warning
        expect(h.manager.callbackWarning?.reason).toBe('otherNetwork');
    });

    it('keeps a set address outside the CCU network, with a warning', async () => {
        const network = fakeNetwork({
            interfaces: [
                {address: '192.168.1.5', netmask: '255.255.255.0'},
                {address: '10.211.55.2', netmask: '255.255.255.0'},
            ],
        });
        const h = harness({connection: {callback: {ip: '10.211.55.2', xmlrpcPort: 0, binrpcPort: 0}}, network});
        await h.manager.start();
        expect(h.manager.callbackIp).toBe('10.211.55.2');
        expect(h.manager.callbackWarning).toEqual({
            address: '10.211.55.2',
            reason: 'otherNetwork',
            auto: '192.168.1.5',
        });
        expect(h.notices.filter((notice) => notice.level === 'warn')).toHaveLength(1);
    });

    it('does not warn about a set address that is the route to a routed CCU', async () => {
        const network = fakeNetwork({
            interfaces: [
                {address: '10.211.55.2', netmask: '255.255.255.0'},
                {address: '172.16.23.50', netmask: '255.255.255.0'},
            ],
            hosts: {'ccu.lan': '172.16.24.145'},
            route: () => '172.16.23.50',
        });
        const h = harness({connection: {callback: {ip: '172.16.23.50', xmlrpcPort: 0, binrpcPort: 0}}, network});
        await h.manager.start();
        expect(h.manager.callbackWarning).toBeUndefined();
    });

    it('takes a set address as it is where the host says so (task 38, a container)', async () => {
        const network = fakeNetwork();
        const h = harness({
            connection: {callback: {ip: '192.168.0.99', xmlrpcPort: 0, binrpcPort: 0}},
            network,
            keepConfiguredCallbackIp: true,
        });
        await h.manager.start();
        expect(h.manager.callbackIp).toBe('192.168.0.99');
        expect(h.manager.callbackWarning).toBeUndefined();
        expect(network.lookups).toEqual([]);
    });

    it('never questions a set loopback address', async () => {
        const network = fakeNetwork();
        const h = harness({connection: {callback: {ip: '127.0.0.1', xmlrpcPort: 0, binrpcPort: 0}}, network});
        await h.manager.start();
        expect(h.manager.callbackIp).toBe('127.0.0.1');
        expect(h.manager.callbackWarning).toBeUndefined();
    });

    it('calls a CCU on the loopback back on the loopback', async () => {
        const network = fakeNetwork();
        const h = harness({connection: {...AUTO, host: '127.0.0.1'}, network});
        expect(h.manager.callbackIp).toBe('127.0.0.1');
        await h.manager.start();
        expect(h.manager.callbackIp).toBe('127.0.0.1');
    });

    it('stays on the loopback for local: true and looks nothing up (#144)', async () => {
        const network = fakeNetwork({interfaces: [{address: '10.0.0.3', netmask: '255.255.255.0'}]});
        const h = harness({connection: {...AUTO, host: '127.0.0.1', local: true}, network});
        await h.manager.start();
        expect(h.manager.callbackIp).toBe('127.0.0.1');
        expect(network.lookups).toEqual([]);
        expect(network.routes).toEqual([]);
    });

    it('subscribes nothing when it is stopped during the name lookup', async () => {
        let answer: ((value: string | undefined) => void) | undefined;
        const network = {
            ...fakeNetwork(),
            resolve: () =>
                new Promise<string | undefined>((resolve) => {
                    answer = resolve;
                }),
        };
        const h = harness({connection: AUTO, network});
        const starting = h.manager.start();
        await vi.waitFor(() => {
            expect(answer).toBeDefined();
        });
        const stopping = h.manager.stop();
        answer?.('192.168.1.2');
        await Promise.all([starting, stopping]);
        expect(h.clients.calls.filter((call) => call.method === 'init' && call.params[1] !== '')).toEqual([]);
    });

    it('falls back to the old rule when the interface list throws', async () => {
        const network = fakeNetwork();
        let calls = 0;
        const throwing: CallbackNetwork = {
            ...network,
            interfaces: () => {
                calls += 1;
                if (calls > 1) {
                    throw new Error('no interfaces');
                }
                return network.interfaces();
            },
        };
        const h = harness({connection: AUTO, network: throwing});
        expect(h.manager.callbackIp).toBe('192.168.1.5');
        await h.manager.start();
        expect(typeof h.manager.callbackIp).toBe('string');
    });
});

/**
 * Task 35 (D-43): the CCU addon starts the host with a fixed callback pair for the ports the
 * configuration leaves at 0. Real sockets on the loopback here, because the fallback is a bind that
 * fails.
 */
describe('the default callback ports', () => {
    function listening(port = 0): Promise<net.Server> {
        return new Promise((resolve, reject) => {
            const server = net.createServer();
            server.once('error', reject);
            server.listen(port, '127.0.0.1', () => {
                resolve(server);
            });
        });
    }

    function portOf(server: net.Server): number {
        const address = server.address();
        return typeof address === 'object' && address !== null ? address.port : 0;
    }

    function closed(server: net.Server): Promise<void> {
        return new Promise((resolve) => {
            server.close(() => {
                resolve();
            });
        });
    }

    /** Two ports that were free a moment ago, and different from each other. */
    async function freePorts(): Promise<[number, number]> {
        const first = await listening();
        const second = await listening();
        const ports: [number, number] = [portOf(first), portOf(second)];
        await closed(first);
        await closed(second);
        return ports;
    }

    /**
     * Runs `body` with two ports that were free a moment ago. Between the probe's close and the bind
     * in `body`, a test file running in parallel may be handed one of those numbers (as in `69708aa`).
     * A lost race is not what these tests are about, so `body` runs again with new ports, at most five
     * times; a real failure fails all five. `body` stops what it started, pass or fail.
     */
    async function withFreePorts(body: (ports: [number, number]) => Promise<void>): Promise<void> {
        for (let attempt = 1; ; attempt += 1) {
            const ports = await freePorts();
            try {
                await body(ports);
                return;
            } catch (error) {
                if (attempt >= 5) {
                    throw error;
                }
            }
        }
    }

    function subscriber(
        callback: {xmlrpcPort: number; binrpcPort: number},
        defaultCallbackPorts: {xmlrpc: number; binrpc: number},
    ) {
        const clients = fakeClients();
        const notices: {level: string; message: string}[] = [];
        const manager = new InterfaceManager({
            connection: normaliseConnection({
                host: '127.0.0.1',
                local: true,
                interfaces: ['BidCos-RF', 'HmIP-RF'],
                callback: {ip: '', ...callback},
            }),
            handler: {} as CallbackHandler,
            onStateChanged: () => undefined,
            onNotice: (level, message) => notices.push({level, message}),
            watchdogIntervalMs: 0,
            createClient: clients.create,
            probe: () => Promise.resolve<PortProbe>('open'),
            callbackHost: '127.0.0.1',
            defaultCallbackPorts,
        });
        const urls = (): unknown[] =>
            clients.calls
                .filter((call) => call.method === 'init' && call.params[1] !== '')
                .map((call) => call.params[0])
                .sort();
        return {manager, notices, urls};
    }

    it('registers the default pair while the configured ports are 0', async () => {
        await withFreePorts(async ([xmlrpc, binrpc]) => {
            const s = subscriber({xmlrpcPort: 0, binrpcPort: 0}, {xmlrpc, binrpc});
            try {
                await s.manager.start();
                expect(s.urls()).toEqual([
                    `http://127.0.0.1:${String(xmlrpc)}`,
                    `xmlrpc_bin://127.0.0.1:${String(binrpc)}`,
                ]);
                expect(s.notices.filter((notice) => notice.level !== 'info')).toEqual([]);
            } finally {
                await s.manager.stop();
            }
        });
    });

    it('falls back to a free port with one warning when a default port is taken', async () => {
        await withFreePorts(async ([binrpc]) => {
            const blocker = await listening();
            const taken = portOf(blocker);
            const s = subscriber({xmlrpcPort: 0, binrpcPort: 0}, {xmlrpc: taken, binrpc});
            try {
                await s.manager.start();
                const [http, bin] = s.urls();
                expect(http).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
                expect(http).not.toBe(`http://127.0.0.1:${String(taken)}`);
                expect(bin).toBe(`xmlrpc_bin://127.0.0.1:${String(binrpc)}`);
                const warnings = s.notices.filter((notice) => notice.level === 'warn');
                expect(warnings).toHaveLength(1);
                expect(warnings[0]?.message).toContain(`the default xmlrpc port ${String(taken)} is taken`);
                expect(s.notices.filter((notice) => notice.level === 'error')).toEqual([]);
            } finally {
                await s.manager.stop();
                await closed(blocker);
            }
        });
    });

    it("keeps the user's configured ports over the default pair", async () => {
        await withFreePorts(async ([xmlrpc, binrpc]) => {
            const s = subscriber({xmlrpcPort: xmlrpc, binrpcPort: binrpc}, {xmlrpc: 2031, binrpc: 2032});
            try {
                await s.manager.start();
                expect(s.urls()).toEqual([
                    `http://127.0.0.1:${String(xmlrpc)}`,
                    `xmlrpc_bin://127.0.0.1:${String(binrpc)}`,
                ]);
            } finally {
                await s.manager.stop();
            }
        });
    });

    /**
     * Task 38: a *fixed* port that is taken - hm2mqtt.js on the same pair, a second container on the
     * host network. Before, the whole connection failed with a bare EADDRINUSE notice and no
     * interface state at all; now the other protocol still works, the log names the port and the
     * option, the state carries the reason, and nothing falls back to a free port.
     */
    it('fails loudly on a taken fixed port: no free port, the option in the log, the reason in the state', async () => {
        await withFreePorts(async ([binrpc]) => {
            const blocker = await listening();
            const taken = portOf(blocker);
            const clients = fakeClients();
            const notices: {level: string; message: string}[] = [];
            let states: InterfaceState[] = [];
            const manager = new InterfaceManager({
                connection: normaliseConnection({
                    host: '127.0.0.1',
                    local: true,
                    interfaces: ['BidCos-RF', 'HmIP-RF'],
                    callback: {ip: '', xmlrpcPort: taken, binrpcPort: binrpc},
                }),
                handler: {} as CallbackHandler,
                onStateChanged: (next) => {
                    states = next;
                },
                onNotice: (level, message) => notices.push({level, message}),
                watchdogIntervalMs: 0,
                initBackoffMs: 0,
                createClient: clients.create,
                probe: () => Promise.resolve<PortProbe>('open'),
                callbackHost: '127.0.0.1',
                // a default pair is there and must not be used: the configured port is fixed
                defaultCallbackPorts: {xmlrpc: 2031, binrpc: 2032},
                callbackPins: {xmlrpcPort: true},
            });
            try {
                await manager.start();

                const errors = notices.filter((notice) => notice.level === 'error');
                expect(errors).toHaveLength(1);
                expect(errors[0]?.message).toContain(`xmlrpc port ${String(taken)}`);
                expect(errors[0]?.message).toContain('HMM_CALLBACK_XMLRPC_PORT / --callback-xmlrpc-port');
                expect(errors[0]?.message).toContain('is in use');
                expect(notices.filter((notice) => notice.level === 'warn')).toEqual([]);

                const xmlrpcState = states.find((state) => state.protocol === 'xmlrpc');
                const binrpcState = states.find((state) => state.protocol === 'binrpc');
                expect(xmlrpcState).toMatchObject({
                    connected: false,
                    error: `callback port ${String(taken)} is in use`,
                    callbackFailure: {port: taken, inUse: true},
                });
                expect(xmlrpcState).not.toHaveProperty('callbackUrl');
                // not subscribed with a URL nobody listens on, and not with a free port either
                const inits = (name: string | undefined): unknown[] =>
                    clients.calls
                        .filter((call) => call.name === name && call.method === 'init' && call.params[1] !== '')
                        .map((call) => call.params[0]);
                expect(inits(xmlrpcState?.name)).toEqual([]);
                // the other protocol is untouched, and its state names the URL it was given
                expect(binrpcState).toMatchObject({
                    connected: true,
                    callbackUrl: `xmlrpc_bin://127.0.0.1:${String(binrpc)}`,
                });
                expect(binrpcState).not.toHaveProperty('callbackFailure');

                // a retry after the port is free again binds it and subscribes
                await closed(blocker);
                await manager.reconnect();
                expect(inits(xmlrpcState?.name)).toEqual([`http://127.0.0.1:${String(taken)}`]);
                const recovered = manager.states().find((state) => state.protocol === 'xmlrpc');
                expect(recovered).toMatchObject({connected: true, callbackUrl: `http://127.0.0.1:${String(taken)}`});
                expect(recovered).not.toHaveProperty('callbackFailure');
                expect(
                    notices.some((notice) => notice.level === 'info' && notice.message.includes('is open now')),
                ).toBe(true);
            } finally {
                await manager.stop();
                // already closed when the test got that far; closing twice only hands close() an error
                await closed(blocker);
            }
        });
    });

    it('names the settings as the source of an unpinned fixed port, and a bind error that is not "in use"', async () => {
        const clients = fakeClients();
        const notices: {level: string; message: string}[] = [];
        const servers: CallbackServerSet = {
            ensure: (protocol) =>
                protocol === 'xmlrpc'
                    ? Promise.reject(Object.assign(new Error('listen EACCES: permission denied'), {code: 'EACCES'}))
                    : Promise.resolve(2043),
            port: (protocol) => (protocol === 'xmlrpc' ? 0 : 2043),
            callbackUrl: (protocol, ip) => `${protocol === 'binrpc' ? 'xmlrpc_bin://' : 'http://'}${ip}:2043`,
            stop: () => Promise.resolve(),
        };
        const manager = new InterfaceManager({
            connection: normaliseConnection({
                host: '127.0.0.1',
                local: true,
                interfaces: ['BidCos-RF', 'HmIP-RF'],
                callback: {ip: '', xmlrpcPort: 80, binrpcPort: 0},
            }),
            handler: {} as CallbackHandler,
            onStateChanged: () => undefined,
            onNotice: (level, message) => notices.push({level, message}),
            watchdogIntervalMs: 0,
            createClient: clients.create,
            createCallbackServers: () => servers,
            probe: () => Promise.resolve<PortProbe>('open'),
        });
        await manager.start();
        const [error] = notices.filter((notice) => notice.level === 'error');
        expect(error?.message).toContain('xmlrpc port 80 set by connection.callback.xmlrpcPort in the settings');
        expect(error?.message).toContain('cannot be opened');
        expect(manager.states().find((state) => state.protocol === 'xmlrpc')).toMatchObject({
            error: 'callback port 80 cannot be opened',
            callbackFailure: {port: 80, inUse: false},
        });
        await manager.stop();
    });

    it('still throws when a free port cannot be had, as before', async () => {
        const servers: CallbackServerSet = {
            ensure: () => Promise.reject(new Error('listen EADDRNOTAVAIL')),
            port: () => 0,
            callbackUrl: () => '',
            stop: () => Promise.resolve(),
        };
        const manager = new InterfaceManager({
            connection: normaliseConnection({host: '127.0.0.1', local: true, interfaces: ['HmIP-RF']}),
            handler: {} as CallbackHandler,
            onStateChanged: () => undefined,
            onNotice: () => undefined,
            watchdogIntervalMs: 0,
            createClient: fakeClients().create,
            createCallbackServers: () => servers,
            probe: () => Promise.resolve<PortProbe>('open'),
        });
        await expect(manager.start()).rejects.toThrow('EADDRNOTAVAIL');
    });
});

/**
 * Task 35: with a fixed port, a listener on every interface would be a known port on the LAN of a
 * CCU whose firewall is open. On the CCU itself the interface processes call back on the loopback
 * (#144), so the servers listen there and nowhere else; for a CCU elsewhere nothing changes.
 */
describe('where the callback servers listen', () => {
    const callback = (ip: string): ConnectionConfig['callback'] => ({ip, xmlrpcPort: 0, binrpcPort: 0});

    it('picks the loopback where the callback address is the loopback', () => {
        const onTheCcu = {host: '127.0.0.1', local: true};
        expect(callbackBindHost(normaliseConnection({...onTheCcu, callback: callback('')}))).toBe('127.0.0.1');
        expect(callbackBindHost(normaliseConnection({...onTheCcu, callback: callback('127.0.0.1')}))).toBe('127.0.0.1');
        expect(callbackBindHost(normaliseConnection({host: 'ccu.lan', callback: callback('127.0.0.1')}))).toBe(
            '127.0.0.1',
        );
        // a LAN address, even on the CCU, and a CCU somewhere else: every interface, as before
        expect(callbackBindHost(normaliseConnection({...onTheCcu, callback: callback('10.0.0.9')}))).toBeUndefined();
        expect(callbackBindHost(normaliseConnection({host: 'ccu.lan', callback: callback('')}))).toBeUndefined();
    });

    function connects(host: string, port: number): Promise<boolean> {
        return new Promise((resolve) => {
            const socket = net.connect({host, port});
            socket.once('connect', () => {
                socket.destroy();
                resolve(true);
            });
            socket.once('error', () => {
                resolve(false);
            });
        });
    }

    async function listeningPorts(
        connection: Partial<ConnectionConfig>,
    ): Promise<{ports: number[]; stop: () => Promise<void>}> {
        const clients = fakeClients();
        const manager = new InterfaceManager({
            connection: normaliseConnection(connection),
            handler: {} as CallbackHandler,
            onStateChanged: () => undefined,
            onNotice: () => undefined,
            watchdogIntervalMs: 0,
            createClient: clients.create,
            probe: () => Promise.resolve<PortProbe>('open'),
        });
        await manager.start();
        const ports = clients.calls
            .filter((call) => call.method === 'init')
            .map((call) => (typeof call.params[0] === 'string' ? call.params[0] : ''))
            .map((url) => Number(/:(\d+)$/.exec(url)?.[1]));
        return {ports, stop: () => manager.stop()};
    }

    /** A LAN address of this machine; the socket checks need one, and a CI runner has it. */
    const lan = Object.values(os.networkInterfaces())
        .flat()
        .find((entry) => entry?.family === 'IPv4' && !entry.internal)?.address;

    it.runIf(lan !== undefined)('cannot be reached on a LAN address of the box when it runs on the CCU', async () => {
        const {ports, stop} = await listeningPorts({
            host: '127.0.0.1',
            local: true,
            interfaces: ['BidCos-RF', 'HmIP-RF'],
        });
        expect(ports).toHaveLength(2);
        for (const port of ports) {
            expect(await connects('127.0.0.1', port)).toBe(true);
            expect(await connects(lan ?? '', port)).toBe(false);
        }
        await stop();
    });

    it.runIf(lan !== undefined)('still listens on every interface for a CCU elsewhere', async () => {
        const {ports, stop} = await listeningPorts({
            host: 'ccu.lan',
            interfaces: ['HmIP-RF'],
            callback: callback(lan ?? ''),
        });
        expect(ports).toHaveLength(1);
        expect(await connects(lan ?? '', ports[0] ?? 0)).toBe(true);
        await stop();
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
        const h = harness({probe: (_host, port) => Promise.resolve(open.has(port) ? 'open' : 'refused')});
        await h.manager.start();
        await expect(h.manager.probeInterfaces()).resolves.toEqual(['BidCos-RF', 'HmIP-RF']);
        expect(h.manager.detected).toEqual(['BidCos-RF', 'HmIP-RF']);
    });

    it('warns about a configured interface whose port is closed and is not connected', async () => {
        const h = harness({
            connection: {interfaces: ['BidCos-RF', 'HmIP-RF'], autoDetect: false},
            answers: {'HmIP-RF': () => new Error('refused')},
            probe: (_host, port) => Promise.resolve(port === 2001 ? 'open' : 'refused'),
        });
        await h.manager.start();
        await h.manager.probeInterfaces();
        const warnings = h.notices.filter((notice) => notice.level === 'warn');
        expect(warnings.map((notice) => notice.interfaceName)).toEqual(['HmIP-RF']);
        expect(h.manager.states()[1]).toMatchObject({name: 'HmIP-RF', absent: true});
        expect(h.manager.states()[1]?.unreachable).toBeUndefined();
    });

    it('B-28: a built-in port that does not answer is not answering, never "not present"', async () => {
        let silent = true;
        const h = harness({
            connection: {interfaces: ['BidCos-RF', 'HmIP-RF'], autoDetect: false},
            answers: {
                'HmIP-RF': () =>
                    silent
                        ? new BackendError({
                              message: 'HmIP-RF (ccu.lan:2010, xmlrpc): init timed out after 10000 ms',
                              kind: 'connection',
                          })
                        : '',
            },
            probe: (_host, port) => Promise.resolve(port === 2010 ? 'unreachable' : 'open'),
        });
        await h.manager.start();
        const hmip = (): InterfaceState | undefined => h.manager.states().find((state) => state.name === 'HmIP-RF');
        // the failed `init` says it first
        expect(hmip()).toMatchObject({connected: false, unreachable: true});
        expect(hmip()?.absent).toBeUndefined();

        await h.manager.probeInterfaces();
        expect(hmip()).toMatchObject({connected: false, unreachable: true});
        expect(hmip()?.absent).toBeUndefined();
        // one notice, the `init`'s; the probe does not say it again
        expect(h.notices.filter((notice) => notice.interfaceName === 'HmIP-RF')).toHaveLength(1);

        // it answers again: the mark goes with the success
        silent = false;
        h.clock.value += 60_000;
        await h.manager.reconnect('HmIP-RF');
        expect(hmip()?.connected).toBe(true);
        expect(hmip()?.unreachable).toBeUndefined();
    });

    it('B-28: probes a user-defined interface where it is configured, and keeps its three answers apart', async () => {
        const extra = (name: string, port: number): UserDefinedInterface => ({
            name,
            host: '10.0.0.5',
            port,
            protocol: 'xmlrpc',
        });
        const seen: string[] = [];
        const byPort: Record<number, PortProbe> = {2121: 'open', 2122: 'refused', 2123: 'unreachable'};
        const h = harness({
            connection: {
                interfaces: ['Answers', 'Refuses', 'Silent'],
                extraInterfaces: [extra('Answers', 2121), extra('Refuses', 2122), extra('Silent', 2123)],
                autoDetect: false,
            },
            answers: {
                Refuses: () => Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:2122'), {code: 'ECONNREFUSED'}),
                // a slow CCU-Jack: nothing refused, nothing answered in time
                Silent: () =>
                    new BackendError({
                        message: 'Silent (10.0.0.5:2123, xmlrpc): init timed out after 10000 ms',
                        kind: 'connection',
                    }),
            },
            probe: (host, port) => {
                seen.push(`${host}:${String(port)}`);
                return Promise.resolve(byPort[port] ?? 'refused');
            },
        });
        await h.manager.start();
        await h.manager.probeInterfaces();

        // asked where they are, not on the CCU's built-in ports
        expect(seen).toEqual(expect.arrayContaining(['10.0.0.5:2121', '10.0.0.5:2122', '10.0.0.5:2123']));
        const byName = Object.fromEntries(h.manager.states().map((state) => [state.name, state]));
        expect(byName['Answers']).toMatchObject({connected: true});
        expect(byName['Answers']?.absent).toBeUndefined();
        expect(byName['Answers']?.unreachable).toBeUndefined();
        expect(byName['Refuses']).toMatchObject({connected: false, absent: true});
        expect(byName['Refuses']?.unreachable).toBeUndefined();
        // until beta.15 this one was marked absent, because the built-in probe never looks at it
        expect(byName['Silent']).toMatchObject({connected: false, unreachable: true});
        expect(byName['Silent']?.absent).toBeUndefined();
        // and it stays configured
        expect(h.manager.names()).toEqual(['Answers', 'Refuses', 'Silent']);
    });

    it('B-28: a probe that times out on an interface whose init was refused turns it from absent into not answering', async () => {
        const h = harness({
            connection: {interfaces: ['BidCos-RF', 'HmIP-RF'], autoDetect: false},
            answers: {
                'HmIP-RF': () => Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:2010'), {code: 'ECONNREFUSED'}),
            },
            probe: (_host, port) => Promise.resolve(port === 2010 ? 'unreachable' : 'open'),
        });
        await h.manager.start();
        expect(h.manager.states()[1]?.absent).toBe(true);
        await h.manager.probeInterfaces();
        expect(h.manager.states()[1]?.absent).toBeUndefined();
        expect(h.manager.states()[1]?.unreachable).toBe(true);
        expect(h.notices.some((notice) => notice.level === 'warn' && notice.message.includes('does not answer'))).toBe(
            true,
        );
    });

    it('probes the TLS ports when TLS is on', async () => {
        const seen: number[] = [];
        const h = harness({
            connection: {tls: true},
            probe: (_host, port) => {
                seen.push(port);
                return Promise.resolve('refused');
            },
        });
        await h.manager.probeInterfaces();
        expect(seen).toContain(42_001);
        expect(seen).toContain(42_010);
    });

    it('is started in the background when autoDetect is on and skipped when it is off', async () => {
        const probe = vi.fn(() => Promise.resolve<PortProbe>('open'));
        const off = harness({connection: {autoDetect: false}, probe});
        await off.manager.start();
        expect(probe).not.toHaveBeenCalled();
        const on = harness({connection: {autoDetect: true}, probe});
        await on.manager.start();
        expect(probe).toHaveBeenCalled();
    });
});

describe('the quick retries at the start (task 56, D-52)', () => {
    const refused = () => Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:32010'), {code: 'ECONNREFUSED'});

    /** Moves the injected clock and the fake timers together, one second at a time. */
    async function advance(h: Harness, ms: number): Promise<void> {
        for (let passed = 0; passed < ms; passed += 1000) {
            h.clock.value += 1000;
            await vi.advanceTimersByTimeAsync(1000);
        }
    }

    function initTimes(h: Harness, name: string, since: number, times: number[]): void {
        const count = h.clients.calls.filter((call) => call.name === name && call.method === 'init').length;
        while (times.length < count) {
            times.push(h.clock.value - since);
        }
    }

    it('waits 1, 2, 4 and 8 s and then 15 s between the attempts', () => {
        expect([1, 2, 3, 4, 5, 6, 20].map((attempt) => startRetryDelay(attempt))).toEqual([
            1000, 2000, 4000, 8000, 15_000, 15_000, 15_000,
        ]);
    });

    it('tries a refused interface again within seconds and connects as soon as it answers', async () => {
        vi.useFakeTimers();
        try {
            let up = false;
            const h = harness({
                answers: {'HmIP-RF': () => (up ? '' : refused())},
                startWindowMs: START_WINDOW_MS,
            });
            const started = h.clock.value;
            await h.manager.start();
            const times: number[] = [0];
            for (let second = 0; second < 45; second += 1) {
                await advance(h, 1000);
                initTimes(h, 'HmIP-RF', started, times);
            }
            // 1, 2, 4, 8 s apart, then every 15 s: at +1, +3, +7, +15, +30, +45
            expect(times).toEqual([0, 1000, 3000, 7000, 15_000, 30_000, 45_000]);
            const waiting = h.manager.states()[1];
            expect(waiting).toMatchObject({name: 'HmIP-RF', connected: false, waiting: true});
            expect(waiting?.absent).toBeUndefined();
            expect(waiting?.unreachable).toBeUndefined();

            up = true;
            await advance(h, 15_000);
            const state = h.manager.states()[1];
            expect(state?.connected).toBe(true);
            expect(state?.waiting).toBeUndefined();
            expect(h.connected).toEqual(['BidCos-RF', 'HmIP-RF']);

            // one line when it starts waiting, the retries at debug level, one when it answers
            const notices = h.notices.filter((entry) => entry.interfaceName === 'HmIP-RF');
            expect(notices.filter((entry) => entry.level !== 'debug')).toEqual([
                {
                    level: 'info',
                    message: 'HmIP-RF: nothing is listening on ccu.lan:2010 yet - waiting for it',
                    interfaceName: 'HmIP-RF',
                },
                {level: 'info', message: 'HmIP-RF: answering, attempt 8 at the start', interfaceName: 'HmIP-RF'},
            ]);
            expect(notices.filter((entry) => entry.level === 'debug')).toHaveLength(6);
            expect(h.notices.some((entry) => entry.level === 'warn' || entry.level === 'error')).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it('treats an init that times out at the start the same way, and not as an error', async () => {
        vi.useFakeTimers();
        try {
            const h = harness({
                answers: {
                    'HmIP-RF': () => new BackendError({message: 'init timed out after 10000 ms', kind: 'connection'}),
                },
                startWindowMs: START_WINDOW_MS,
            });
            await h.manager.start();
            await advance(h, 3000);
            expect(h.clients.calls.filter((call) => call.name === 'HmIP-RF')).toHaveLength(3);
            expect(h.manager.states()[1]?.waiting).toBe(true);
            expect(h.notices.filter((entry) => entry.level === 'error')).toEqual([]);
            expect(h.notices.find((entry) => entry.interfaceName === 'HmIP-RF')?.message).toBe(
                'HmIP-RF: ccu.lan:2010 does not answer yet - waiting for it',
            );
        } finally {
            vi.useRealTimers();
        }
    });

    it('says "not present" once and falls back to the back-off when the window is over (task 13)', async () => {
        vi.useFakeTimers();
        try {
            const h = harness({
                answers: {'HmIP-RF': () => refused()},
                startWindowMs: 60_000,
                initBackoffMs: 15_000,
            });
            await h.manager.start();
            await advance(h, 75_000);
            const state = h.manager.states()[1];
            expect(state?.waiting).toBeUndefined();
            expect(state?.absent).toBe(true);
            const warnings = h.notices.filter((entry) => entry.level === 'warn');
            expect(warnings).toHaveLength(1);
            expect(warnings[0]?.message).toContain('treated as not present');

            // no timer any more: only the watchdog tries it, with the back-off
            const before = h.clients.calls.length;
            await advance(h, 60_000);
            expect(h.clients.calls.length).toBe(before);
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps waiting when the wall clock jumps at boot (a box without a real-time clock)', async () => {
        vi.useFakeTimers();
        try {
            let wall = 1_000_000;
            let mono = 0;
            const clients = fakeClients({'HmIP-RF': () => refused()});
            const notices: {level: string; message: string}[] = [];
            const manager = new InterfaceManager({
                connection: normaliseConnection({
                    host: 'ccu.lan',
                    interfaces: ['HmIP-RF'],
                    callback: {ip: '192.168.1.5', xmlrpcPort: 0, binrpcPort: 0},
                    autoDetect: false,
                }),
                handler: {} as CallbackHandler,
                onStateChanged: () => undefined,
                onNotice: (level, message) => notices.push({level, message}),
                now: () => wall,
                monotonicNow: () => mono,
                watchdogIntervalMs: 0,
                createClient: clients.create,
                createCallbackServers: () => fakeServers(),
                network: fakeNetwork(),
            });
            await manager.start();
            // NTP moves the date six months forward a second after the start
            wall += 183 * 24 * 3600 * 1000;
            mono += 1000;
            await vi.advanceTimersByTimeAsync(1000);
            expect(manager.states()[0]?.waiting).toBe(true);
            expect(notices.filter((entry) => entry.level === 'warn')).toEqual([]);
            await manager.stop();
        } finally {
            vi.useRealTimers();
        }
    });

    it('leaves a waiting interface to its timer, not to the watchdog, and to the user when asked', async () => {
        vi.useFakeTimers();
        try {
            let up = false;
            const h = harness({
                answers: {'HmIP-RF': () => (up ? '' : refused())},
                startWindowMs: START_WINDOW_MS,
            });
            await h.manager.start();
            h.clock.value += 60_000;
            await h.manager.tick();
            // the tick found its timer and left it alone
            expect(h.clients.calls.filter((call) => call.name === 'HmIP-RF')).toHaveLength(1);
            up = true;
            await h.manager.reconnect('HmIP-RF');
            expect(h.manager.states()[1]?.connected).toBe(true);
            await vi.advanceTimersByTimeAsync(60_000);
            expect(h.clients.calls.filter((call) => call.name === 'HmIP-RF')).toHaveLength(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not report a waiting interface from the background probe', async () => {
        const h = harness({
            connection: {interfaces: ['BidCos-RF', 'HmIP-RF'], autoDetect: false},
            answers: {'HmIP-RF': () => refused()},
            probe: (_host, port) => Promise.resolve(port === 2001 ? 'open' : 'refused'),
            startWindowMs: START_WINDOW_MS,
        });
        await h.manager.start();
        await h.manager.probeInterfaces();
        expect(h.notices.filter((entry) => entry.level === 'warn')).toEqual([]);
        expect(h.manager.states()[1]?.waiting).toBe(true);
        await h.manager.stop();
    });

    it('treats a failure after the interface once answered as an outage, not a start', async () => {
        let up = true;
        const h = harness({
            answers: {'HmIP-RF': (method) => (method === 'init' && !up ? refused() : '')},
            startWindowMs: START_WINDOW_MS,
        });
        await h.manager.start();
        up = false;
        await h.manager.reconnect('HmIP-RF');
        expect(h.manager.states()[1]?.absent).toBe(true);
        expect(h.manager.states()[1]?.waiting).toBeUndefined();
        expect(h.notices.find((entry) => entry.interfaceName === 'HmIP-RF')?.level).toBe('warn');
    });

    it('stops the timers on stop and on unsubscribe, and waits again after a resubscribe', async () => {
        vi.useFakeTimers();
        try {
            const h = harness({answers: {'HmIP-RF': () => refused()}, startWindowMs: START_WINDOW_MS});
            await h.manager.start();
            await h.manager.unsubscribe();
            const afterUnsubscribe = h.clients.calls.length;
            await advance(h, 30_000);
            expect(h.clients.calls.length).toBe(afterUnsubscribe);

            await h.manager.subscribe();
            expect(h.manager.states()[1]?.waiting).toBe(true);
            await h.manager.stop();
            const afterStop = h.clients.calls.length;
            await advance(h, 30_000);
            expect(h.clients.calls.length).toBe(afterStop);
        } finally {
            vi.useRealTimers();
        }
    });
});
