import {EventEmitter} from 'node:events';
import net from 'node:net';
import type {AddressInfo} from 'node:net';

import {afterEach, describe, expect, it, vi} from 'vitest';

import {
    delay,
    describeCallbackAddresses,
    inSubnet,
    ipv4ToNumber,
    isLinkLocal,
    isLoopback,
    localIPv4Addresses,
    localIPv4Interfaces,
    pickCallbackAddress,
    probePort,
    probePortState,
    resolveIPv4,
    routeSource,
    staticNetwork,
    systemNetwork,
    withTimeout,
    type CallbackNetwork,
} from './net.js';

describe('localIPv4Addresses', () => {
    it('keeps external IPv4 addresses and drops loopback, IPv6 and duplicates', () => {
        const addresses = localIPv4Addresses(
            () =>
                ({
                    lo: [
                        {address: '127.0.0.1', family: 'IPv4', internal: true} as net.AddressInfo & {internal: boolean},
                    ],
                    eth0: [
                        {address: '192.168.1.10', family: 'IPv4', internal: false},
                        {address: 'fe80::1', family: 'IPv6', internal: false},
                    ],
                    eth1: [{address: '192.168.1.10', family: 'IPv4', internal: false}],
                    down: undefined,
                }) as never,
        );
        expect(addresses).toEqual(['192.168.1.10', '127.0.0.1']); // the loopback last, always offered (28.10)
    });

    it('asks the operating system when nothing is injected', () => {
        expect(Array.isArray(localIPv4Addresses())).toBe(true);
    });
});

describe('localIPv4Interfaces (B-53)', () => {
    it('keeps address and netmask of every external IPv4 address, in the order given', () => {
        const found = localIPv4Interfaces(
            () =>
                ({
                    lo0: [{address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', internal: true}],
                    utun4: [{address: '10.8.0.2', netmask: '255.255.255.255', family: 'IPv4', internal: false}],
                    en0: [
                        {address: 'fe80::1', netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', internal: false},
                        {address: '192.168.1.20', netmask: '255.255.255.0', family: 'IPv4', internal: false},
                    ],
                    en1: [{address: '192.168.1.20', netmask: '255.255.255.0', family: 'IPv4', internal: false}],
                    gone: undefined,
                }) as never,
        );
        expect(found).toEqual([
            {address: '10.8.0.2', netmask: '255.255.255.255'},
            {address: '192.168.1.20', netmask: '255.255.255.0'},
        ]);
    });

    it('asks the operating system when nothing is injected', () => {
        expect(Array.isArray(localIPv4Interfaces())).toBe(true);
    });
});

describe('address arithmetic (B-53)', () => {
    it('parses dotted IPv4 addresses only', () => {
        expect(ipv4ToNumber('192.168.1.2')).toBe(3_232_235_778);
        expect(ipv4ToNumber('0.0.0.0')).toBe(0);
        expect(ipv4ToNumber('255.255.255.255')).toBe(4_294_967_295);
        for (const bad of ['', 'ccu', '1.2.3', '1.2.3.4.5', '1.2.3.256', '1.2.3.-1', '::1', '1.2.3.x']) {
            expect(ipv4ToNumber(bad)).toBeUndefined();
        }
    });

    it('decides subnet membership by the netmask', () => {
        expect(inSubnet('192.168.1.20', '255.255.255.0', '192.168.1.2')).toBe(true);
        expect(inSubnet('192.168.1.20', '255.255.255.0', '192.168.2.2')).toBe(false);
        expect(inSubnet('172.16.23.50', '255.255.254.0', '172.16.22.1')).toBe(true);
        expect(inSubnet('10.8.0.2', '255.255.255.255', '10.8.0.1')).toBe(false);
        expect(inSubnet('10.8.0.2', '0.0.0.0', '8.8.8.8')).toBe(true);
        expect(inSubnet('10.8.0.2', 'ffff::', '10.8.0.1')).toBe(false);
    });

    it('knows link-local and loopback addresses', () => {
        expect(isLinkLocal('169.254.3.4')).toBe(true);
        expect(isLinkLocal('169.25.3.4')).toBe(false);
        expect(isLoopback('127.0.0.1')).toBe(true);
        expect(isLoopback('127.1.2.3')).toBe(true);
        expect(isLoopback('128.0.0.1')).toBe(false);
    });
});

describe('pickCallbackAddress (B-53)', () => {
    const lan = {address: '192.168.1.20', netmask: '255.255.255.0'};
    const vpn = {address: '10.8.0.2', netmask: '255.255.255.255'};
    const linkLocal = {address: '169.254.7.7', netmask: '255.255.0.0'};

    it('marks every address and takes the one in the CCU subnet', () => {
        expect(pickCallbackAddress('ccu', '192.168.1.2', [vpn, linkLocal, lan], undefined)).toEqual({
            host: 'ccu',
            hostAddress: '192.168.1.2',
            auto: {address: '192.168.1.20', reason: 'subnet'},
            addresses: [
                {address: '10.8.0.2', inSubnet: false},
                {address: '169.254.7.7', inSubnet: false, linkLocal: true},
                {address: '192.168.1.20', inSubnet: true},
                {address: '127.0.0.1', inSubnet: false},
            ],
        });
    });

    it('takes a link-local address when the CCU is link-local too', () => {
        const info = pickCallbackAddress('169.254.7.1', '169.254.7.1', [lan, linkLocal], undefined);
        expect(info.auto).toEqual({address: '169.254.7.7', reason: 'subnet'});
    });

    it('takes the route source next, and the first non-link-local address last', () => {
        expect(pickCallbackAddress('ccu', '172.16.24.145', [vpn, lan], '192.168.1.20').auto).toEqual({
            address: '192.168.1.20',
            reason: 'route',
        });
        expect(pickCallbackAddress('ccu', '172.16.24.145', [linkLocal, vpn, lan], undefined).auto).toEqual({
            address: '10.8.0.2',
            reason: 'first',
        });
        // a route source that is not offered is not taken
        expect(pickCallbackAddress('ccu', '172.16.24.145', [lan], '10.9.9.9').auto.reason).toBe('first');
        expect(pickCallbackAddress('', undefined, [], undefined)).toEqual({
            host: '',
            auto: {address: '127.0.0.1', reason: 'first'},
            addresses: [{address: '127.0.0.1', inSubnet: false}],
        });
        expect(pickCallbackAddress('ccu', '172.16.24.145', [linkLocal], undefined).auto.address).toBe('127.0.0.1');
    });

    it('uses the loopback for a CCU on the loopback and for local', () => {
        const loop = pickCallbackAddress('localhost', '127.0.0.1', [lan], undefined);
        expect(loop.auto).toEqual({address: '127.0.0.1', reason: 'loopback'});
        expect(loop.addresses.at(-1)).toEqual({address: '127.0.0.1', inSubnet: true});
        expect(pickCallbackAddress('ccu', undefined, [lan], undefined, true).auto.reason).toBe('loopback');
    });

    it('matches nothing without netmasks', () => {
        expect(pickCallbackAddress('ccu', '192.168.1.2', [{address: '192.168.1.20'}], undefined).auto.reason).toBe(
            'first',
        );
    });
});

describe('describeCallbackAddresses (B-53)', () => {
    function network(overrides: Partial<CallbackNetwork> = {}): CallbackNetwork & {routes: string[]} {
        const routes: string[] = [];
        return {
            routes,
            interfaces: () => [
                {address: '10.8.0.2', netmask: '255.255.255.255'},
                {address: '192.168.1.20', netmask: '255.255.255.0'},
            ],
            resolve: (host) => Promise.resolve(host === 'ccu' ? '192.168.1.2' : undefined),
            route: (address) => {
                routes.push(address);
                return Promise.resolve('10.8.0.2');
            },
            ...overrides,
        };
    }

    it('resolves the name and asks no route for a CCU in its own network', async () => {
        const net = network();
        const info = await describeCallbackAddresses('ccu', net);
        expect(info.hostAddress).toBe('192.168.1.2');
        expect(info.auto).toEqual({address: '192.168.1.20', reason: 'subnet'});
        expect(net.routes).toEqual([]);
    });

    it('asks the route for a CCU elsewhere', async () => {
        const net = network({resolve: () => Promise.resolve('172.16.24.145')});
        const info = await describeCallbackAddresses('ccu', net);
        expect(info.auto).toEqual({address: '10.8.0.2', reason: 'route'});
        expect(net.routes).toEqual(['172.16.24.145']);
    });

    it('asks nothing for an unresolvable name, no host, a loopback CCU or local', async () => {
        const net = network();
        expect((await describeCallbackAddresses('nowhere', net)).auto.reason).toBe('first');
        expect((await describeCallbackAddresses('', net)).auto.reason).toBe('first');
        expect(
            (await describeCallbackAddresses('127.0.0.1', network({resolve: (h) => Promise.resolve(h)}))).auto.reason,
        ).toBe('loopback');
        expect((await describeCallbackAddresses('ccu', net, true)).auto.reason).toBe('loopback');
        expect(net.routes).toEqual([]);
    });
});

describe('the lookups behind it (B-53)', () => {
    it('resolves names with the injected lookup and never rejects', async () => {
        const lookup = vi.fn((host: string) =>
            host === 'ccu'
                ? Promise.resolve({address: '192.168.1.2', family: 4})
                : Promise.reject(new Error('ENOTFOUND')),
        );
        await expect(resolveIPv4('ccu', lookup as never)).resolves.toBe('192.168.1.2');
        await expect(resolveIPv4('nowhere', lookup as never)).resolves.toBeUndefined();
        await expect(resolveIPv4('192.168.1.9', lookup as never)).resolves.toBe('192.168.1.9');
        await expect(resolveIPv4('', lookup as never)).resolves.toBeUndefined();
        await expect(resolveIPv4('fe80::1', lookup as never)).resolves.toBeUndefined();
        expect(lookup).toHaveBeenCalledTimes(2);
        expect(lookup.mock.calls[0]).toEqual(['ccu', {family: 4}]);
    });

    it('resolves localhost with the system resolver', async () => {
        await expect(resolveIPv4('localhost')).resolves.toMatch(/^127\./);
    });

    it('finds the source address of the route to the loopback without sending anything', async () => {
        await expect(routeSource('127.0.0.1')).resolves.toBe('127.0.0.1');
    });

    it('answers undefined when the socket cannot be had or connected', async () => {
        await expect(
            routeSource('127.0.0.1', () => {
                throw new Error('EMFILE');
            }),
        ).resolves.toBeUndefined();

        const failing = new EventEmitter() as EventEmitter & {
            connect: () => void;
            close: () => void;
            address: () => never;
        };
        failing.connect = () => {
            queueMicrotask(() => failing.emit('error', new Error('ENETUNREACH')));
        };
        failing.close = () => {
            throw new Error('already closed');
        };
        failing.address = () => {
            throw new Error('not bound');
        };
        await expect(routeSource('10.0.0.1', () => failing as never)).resolves.toBeUndefined();

        const throwing = new EventEmitter() as EventEmitter & {connect: () => void; close: () => void};
        throwing.connect = () => {
            throw new Error('ERR_SOCKET_BAD_PORT');
        };
        throwing.close = () => undefined;
        await expect(routeSource('10.0.0.1', () => throwing as never)).resolves.toBeUndefined();

        const unbound = new EventEmitter() as EventEmitter & {
            connect: (port: number, host: string, done: () => void) => void;
            close: () => void;
            address: () => never;
        };
        unbound.connect = (_port, _host, done) => {
            queueMicrotask(done);
        };
        unbound.close = () => undefined;
        unbound.address = () => {
            throw new Error('not bound');
        };
        await expect(routeSource('10.0.0.1', () => unbound as never)).resolves.toBeUndefined();
    });

    it('builds the system network and a static one', async () => {
        const system = systemNetwork();
        expect(Array.isArray(system.interfaces())).toBe(true);
        await expect(system.resolve('127.0.0.1')).resolves.toBe('127.0.0.1');
        await expect(system.route('127.0.0.1')).resolves.toBe('127.0.0.1');

        const fixed = staticNetwork(() => ['10.0.0.2', '127.0.0.1']);
        expect(fixed.interfaces()).toEqual([{address: '10.0.0.2'}]);
        await expect(fixed.resolve('10.0.0.1')).resolves.toBe('10.0.0.1');
        await expect(fixed.resolve('ccu')).resolves.toBeUndefined();
        await expect(fixed.route('10.0.0.1')).resolves.toBeUndefined();
    });
});

describe('probePort', () => {
    const servers: net.Server[] = [];

    afterEach(async () => {
        await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
    });

    it('is true for a port that accepts a connection', async () => {
        const server = net.createServer();
        servers.push(server);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const {port} = server.address() as AddressInfo;
        await expect(probePort('127.0.0.1', port)).resolves.toBe(true);
    });

    it('is false for a closed port', async () => {
        // A port that was bound and closed again can be handed to a test file running in parallel
        // before the probe runs. A lost race takes another port, at most five times; a probe that
        // wrongly answers "open" fails all five.
        let open = true;
        for (let attempt = 1; open && attempt <= 5; attempt += 1) {
            const server = net.createServer();
            await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
            const {port} = server.address() as AddressInfo;
            await new Promise((resolve) => server.close(resolve));
            open = await probePort('127.0.0.1', port, {timeoutMs: 500});
        }
        expect(open).toBe(false);
    });

    it('is false when the connection times out, and destroys the socket', async () => {
        const socket = new EventEmitter() as net.Socket & EventEmitter;
        const destroy = vi.fn();
        socket.destroy = destroy as never;
        const connect = vi.fn(() => {
            setTimeout(() => socket.emit('timeout'), 0);
            return socket;
        });
        await expect(probePort('10.0.0.1', 2001, {connect: connect as never, timeoutMs: 10})).resolves.toBe(false);
        expect(destroy).toHaveBeenCalled();
    });

    it('settles only once', async () => {
        const socket = new EventEmitter() as net.Socket & EventEmitter;
        const destroy = vi.fn();
        socket.destroy = destroy as never;
        const connect = vi.fn((_options: unknown, onConnect: () => void) => {
            setTimeout(() => {
                onConnect();
                socket.emit('error', new Error('late'));
            }, 0);
            return socket;
        });
        await expect(probePort('10.0.0.1', 2001, {connect: connect as never})).resolves.toBe(true);
        expect(destroy).toHaveBeenCalledTimes(1);
    });
});

describe('probePortState (B-28)', () => {
    /** A socket that emits `event` with `payload` right after the connect is started. */
    function fakeConnect(event: string, payload?: unknown): typeof net.connect {
        const socket = new EventEmitter() as net.Socket & EventEmitter;
        socket.destroy = vi.fn() as never;
        return vi.fn(() => {
            setTimeout(() => socket.emit(event, payload), 0);
            return socket;
        }) as never;
    }

    it('tells a refused port from one that does not answer', async () => {
        const refused = Object.assign(new Error('connect ECONNREFUSED'), {code: 'ECONNREFUSED'});
        await expect(probePortState('10.0.0.1', 2121, {connect: fakeConnect('error', refused)})).resolves.toBe(
            'refused',
        );
        await expect(probePortState('10.0.0.1', 2121, {connect: fakeConnect('timeout'), timeoutMs: 10})).resolves.toBe(
            'unreachable',
        );
        const noRoute = Object.assign(new Error('connect EHOSTUNREACH'), {code: 'EHOSTUNREACH'});
        await expect(probePortState('10.0.0.1', 2121, {connect: fakeConnect('error', noRoute)})).resolves.toBe(
            'unreachable',
        );
    });

    it('finds the refusal in the aggregate of happy eyeballs', async () => {
        const aggregate = Object.assign(new Error('all attempts failed'), {
            errors: [
                Object.assign(new Error('v6'), {code: 'ENETUNREACH'}),
                Object.assign(new Error('v4'), {code: 'ECONNREFUSED'}),
            ],
        });
        await expect(probePortState('ccu.lan', 2121, {connect: fakeConnect('error', aggregate)})).resolves.toBe(
            'refused',
        );
    });

    it('is open for a port that accepts, and refused for a real closed one', async () => {
        const server = net.createServer();
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const {port} = server.address() as AddressInfo;
        try {
            await expect(probePortState('127.0.0.1', port)).resolves.toBe('open');
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
        // the same race as above: a freed port can be taken by a parallel test file, so up to five tries
        let result = 'open';
        for (let attempt = 1; result === 'open' && attempt <= 5; attempt += 1) {
            const closed = net.createServer();
            await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
            const free = (closed.address() as AddressInfo).port;
            await new Promise((resolve) => closed.close(resolve));
            result = await probePortState('127.0.0.1', free, {timeoutMs: 500});
        }
        // WSL's loopback leaves a SYN to a closed port unanswered, which is the timeout path
        expect(['refused', 'unreachable']).toContain(result);
    });
});

describe('delay', () => {
    it('resolves after the given time', async () => {
        const started = Date.now();
        await delay(5);
        expect(Date.now() - started).toBeGreaterThanOrEqual(3);
    });
});

describe('withTimeout', () => {
    it('passes a value through', async () => {
        await expect(withTimeout(Promise.resolve(7), 100, () => new Error('late'))).resolves.toBe(7);
    });

    it('rejects with the given error when nothing settles', async () => {
        const never = new Promise<number>(() => undefined);
        await expect(withTimeout(never, 5, () => new Error('ping timed out'))).rejects.toThrow('ping timed out');
    });

    it('forwards a rejection and wraps a non-error', async () => {
        await expect(withTimeout(Promise.reject(new Error('fault')), 100, () => new Error('late'))).rejects.toThrow(
            'fault',
        );
        // an RPC library that rejects with a bare string is exactly what this branch is for
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        const rejected = Promise.reject('plain');
        await expect(withTimeout(rejected, 100, () => new Error('late'))).rejects.toThrow('plain');
    });
});
