/**
 * The two pieces of network plumbing the configuration needs: which addresses this machine could
 * ask the CCU to call back on, and whether a port answers at all.
 *
 * The port probe is the same TCP connect 2.x used (`main.js:149-161`), with two differences: it is
 * never awaited by anything the UI waits for (issues #121/#126/#134 - 2.x probed six ports with a
 * 5 s timeout each before the window became usable) and it destroys the socket instead of leaving
 * it to time out.
 */

import dgram from 'node:dgram';
import dns from 'node:dns';
import net from 'node:net';
import os from 'node:os';

import type {CallbackAddressCandidate, CallbackAddressInfo, CallbackAutoReason} from '@homematic-manager/core';

/**
 * Every non-internal IPv4 address of this machine, then `127.0.0.1`; candidates for the callback
 * address. The loopback comes last so nothing that picked "the first candidate" changes - but it
 * has to be offered: on an openccu-lite box the interface processes bind the loopback only
 * (their D-29), so for the Homematic Manager running *on* the box it is the one address they
 * can call back (openccu-lite task 28.10, maintainer 2026-09-08).
 */
export function localIPv4Addresses(
    interfaces: () => NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces,
): string[] {
    const addresses: string[] = [];
    for (const entries of Object.values(interfaces())) {
        for (const entry of entries ?? []) {
            if (entry.family === 'IPv4' && !entry.internal && !addresses.includes(entry.address)) {
                addresses.push(entry.address);
            }
        }
    }
    addresses.push('127.0.0.1');
    return addresses;
}

/** The address an interface process on this machine calls back on. */
const LOOPBACK = '127.0.0.1';

/** One IPv4 address of this machine; `netmask` is absent where it is not known (an injected list). */
export interface LocalIPv4 {
    readonly address: string;
    readonly netmask?: string;
}

/**
 * B-53: every non-internal IPv4 address of this machine with its netmask, in the order
 * `os.networkInterfaces()` gives them - the loopback is not in it.
 */
export function localIPv4Interfaces(
    interfaces: () => NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces,
): LocalIPv4[] {
    const found: LocalIPv4[] = [];
    for (const entries of Object.values(interfaces())) {
        for (const entry of entries ?? []) {
            if (entry.family === 'IPv4' && !entry.internal && !found.some((seen) => seen.address === entry.address)) {
                found.push({address: entry.address, netmask: entry.netmask});
            }
        }
    }
    return found;
}

/** A dotted IPv4 address as a number; `undefined` for anything else. */
export function ipv4ToNumber(address: string): number | undefined {
    const parts = address.split('.');
    if (parts.length !== 4) {
        return undefined;
    }
    let value = 0;
    for (const part of parts) {
        if (!/^\d{1,3}$/.test(part)) {
            return undefined;
        }
        const byte = Number(part);
        if (byte > 255) {
            return undefined;
        }
        value = value * 256 + byte;
    }
    return value;
}

/** True when `target` is in the network of `address/netmask`. False when any of them is no IPv4 address. */
export function inSubnet(address: string, netmask: string, target: string): boolean {
    const a = ipv4ToNumber(address);
    const m = ipv4ToNumber(netmask);
    const t = ipv4ToNumber(target);
    if (a === undefined || m === undefined || t === undefined) {
        return false;
    }
    // `>>> 0` keeps the results unsigned; `&` alone would make 192.168.x.x negative
    return (a & m) >>> 0 === (t & m) >>> 0;
}

/** `169.254.0.0/16`, the address an interface gives itself when no DHCP server answered. */
export function isLinkLocal(address: string): boolean {
    return address.startsWith('169.254.');
}

/** `127.0.0.0/8`. */
export function isLoopback(address: string): boolean {
    return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address);
}

/**
 * B-53: what the automatic callback address is worked out from. Injected by the tests, so that no
 * unit test depends on the network of the machine it runs on.
 */
export interface CallbackNetwork {
    /** This machine's non-internal IPv4 addresses, see {@link localIPv4Interfaces}. */
    readonly interfaces: () => LocalIPv4[];
    /** The CCU host's IPv4 address; `undefined` when it does not resolve. Never rejects. */
    readonly resolve: (host: string) => Promise<string | undefined>;
    /** The local address the operating system sends from towards `address`; `undefined` when there is no route. Never rejects. */
    readonly route: (address: string) => Promise<string | undefined>;
}

/** How long a name lookup for the callback address may take before the first address is used. */
export const RESOLVE_TIMEOUT_MS = 3000;

/** The CCU host's IPv4 address, through the system resolver (`/etc/hosts`, mDNS where the OS has it). */
export async function resolveIPv4(
    host: string,
    lookup: typeof dns.promises.lookup = dns.promises.lookup,
): Promise<string | undefined> {
    if (ipv4ToNumber(host) !== undefined) {
        return host;
    }
    if (host === '' || net.isIPv6(host)) {
        return undefined;
    }
    try {
        const result = await withTimeout(lookup(host, {family: 4}), RESOLVE_TIMEOUT_MS, () => new Error('timeout'));
        return result.address;
    } catch {
        return undefined;
    }
}

/**
 * The local address a UDP socket gets when it is `connect()`ed to `address`: the source address of
 * the route the operating system would take. `connect` on a datagram socket only sets the default
 * peer - no packet is sent - so this works for a CCU behind a router or a VPN as well as for one in
 * the same network.
 */
export function routeSource(
    address: string,
    createSocket: typeof dgram.createSocket = dgram.createSocket,
): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve) => {
        let socket: dgram.Socket;
        try {
            socket = createSocket('udp4');
        } catch {
            resolve(undefined);
            return;
        }
        let settled = false;
        const done = (result: string | undefined): void => {
            if (settled) {
                return;
            }
            settled = true;
            try {
                socket.close();
            } catch {
                // already closed
            }
            resolve(result);
        };
        socket.on('error', () => {
            done(undefined);
        });
        try {
            // the port does not matter, nothing is sent; 9 is "discard"
            socket.connect(9, address, () => {
                try {
                    done(socket.address().address);
                } catch {
                    done(undefined);
                }
            });
        } catch {
            done(undefined);
        }
    });
}

/** The machine's own network, as the running host sees it. */
export function systemNetwork(): CallbackNetwork {
    return {
        interfaces: () => localIPv4Interfaces(),
        resolve: (host) => resolveIPv4(host),
        route: (address) => routeSource(address),
    };
}

/**
 * A network made of a fixed address list, for a caller that injects `localAddresses` (the tests and
 * the e2e hosts): no netmasks, no name lookup beyond an address literal, no route.
 */
export function staticNetwork(addresses: () => string[]): CallbackNetwork {
    return {
        interfaces: () =>
            addresses()
                .filter((address) => !isLoopback(address))
                .map((address) => ({address})),
        resolve: (host) => Promise.resolve(ipv4ToNumber(host) === undefined ? undefined : host),
        route: () => Promise.resolve(undefined),
    };
}

/**
 * B-53 (#162, #165): the automatic callback address, and every address with whether it is in the
 * CCU's network. Synchronous: `hostAddress` and `routed` are what {@link describeCallbackAddresses}
 * found out, and `undefined` when nothing could be.
 *
 * The order: the CCU on the loopback (or `local`) is called back on the loopback; then the
 * address in the CCU's network; then the route's source address; then the first address that is
 * not link-local. A link-local address wins only as the CCU's own network, and the loopback is
 * never chosen for a CCU elsewhere unless this machine has no other address at all.
 */
export function pickCallbackAddress(
    host: string,
    hostAddress: string | undefined,
    interfaces: readonly LocalIPv4[],
    routed: string | undefined,
    local = false,
): CallbackAddressInfo {
    const matches = (entry: LocalIPv4): boolean =>
        hostAddress !== undefined && entry.netmask !== undefined && inSubnet(entry.address, entry.netmask, hostAddress);
    const ccuOnLoopback = local || (hostAddress !== undefined && isLoopback(hostAddress));
    const addresses: CallbackAddressCandidate[] = interfaces.map((entry) => ({
        address: entry.address,
        inSubnet: matches(entry),
        ...(isLinkLocal(entry.address) ? {linkLocal: true} : {}),
    }));
    addresses.push({address: LOOPBACK, inSubnet: ccuOnLoopback});

    const choose = (): {address: string; reason: CallbackAutoReason} => {
        if (ccuOnLoopback) {
            return {address: LOOPBACK, reason: 'loopback'};
        }
        const subnet = interfaces.find((entry) => matches(entry));
        if (subnet !== undefined) {
            return {address: subnet.address, reason: 'subnet'};
        }
        if (routed !== undefined && !isLinkLocal(routed) && interfaces.some((entry) => entry.address === routed)) {
            return {address: routed, reason: 'route'};
        }
        const first = interfaces.find((entry) => !isLinkLocal(entry.address));
        return {address: first?.address ?? LOOPBACK, reason: 'first'};
    };

    return {
        host,
        ...(hostAddress === undefined ? {} : {hostAddress}),
        auto: choose(),
        addresses,
    };
}

/**
 * B-53: {@link pickCallbackAddress} with the facts looked up - the CCU's name resolved, and the route
 * asked for only when no address shares the CCU's network. Never rejects.
 */
export async function describeCallbackAddresses(
    host: string,
    network: CallbackNetwork,
    local = false,
): Promise<CallbackAddressInfo> {
    const interfaces = network.interfaces();
    if (local) {
        return pickCallbackAddress(host, undefined, interfaces, undefined, true);
    }
    const hostAddress = host === '' ? undefined : await network.resolve(host);
    const inNetwork =
        hostAddress !== undefined &&
        (isLoopback(hostAddress) ||
            interfaces.some(
                (entry) => entry.netmask !== undefined && inSubnet(entry.address, entry.netmask, hostAddress),
            ));
    const routed = hostAddress === undefined || inNetwork ? undefined : await network.route(hostAddress);
    return pickCallbackAddress(host, hostAddress, interfaces, routed);
}

export interface ProbeOptions {
    readonly timeoutMs?: number;
    /** Injected for the tests; defaults to `net.connect`. */
    readonly connect?: typeof net.connect;
}

/**
 * What a port probe found.
 *
 * B-28: `refused` and `unreachable` are different answers. A refused connection means nothing listens
 * there - the interface process is not installed, the normal state of BidCos-Wired on a CCU without a
 * wired gateway. A connection that times out, or a host without a route, says nothing about the
 * process: a slow CCU-Jack, a remote CUxD on a box that is rebooting. Only the first may be shown as
 * "not present".
 */
export type PortProbe = 'open' | 'refused' | 'unreachable';

/** Whether a TCP connection to `host:port` is accepted, refused, or not answered in time. Never throws. */
export function probePortState(host: string, port: number, options: ProbeOptions = {}): Promise<PortProbe> {
    const timeoutMs = options.timeoutMs ?? 2000;
    const connect = options.connect ?? net.connect;
    return new Promise<PortProbe>((resolve) => {
        let settled = false;
        const done = (result: PortProbe): void => {
            if (settled) {
                return;
            }
            settled = true;
            socket.destroy();
            resolve(result);
        };
        const socket = connect({host, port, timeout: timeoutMs}, () => {
            done('open');
        });
        socket.on('error', (error: NodeJS.ErrnoException & {errors?: NodeJS.ErrnoException[]}) => {
            // node's happy-eyeballs connect aggregates the per-address failures in `errors`
            const codes = [error.code, ...(error.errors ?? []).map((entry) => entry.code)];
            done(codes.includes('ECONNREFUSED') ? 'refused' : 'unreachable');
        });
        socket.on('timeout', () => {
            done('unreachable');
        });
    });
}

/** True when a TCP connection to `host:port` is accepted within the timeout. Never throws. */
export async function probePort(host: string, port: number, options: ProbeOptions = {}): Promise<boolean> {
    return (await probePortState(host, port, options)) === 'open';
}

/** Resolves after `ms`; the timer never keeps the process alive. */
export function delay(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        if (typeof timer.unref === 'function') {
            timer.unref();
        }
    });
}

/**
 * Rejects with `error` when `promise` has not settled after `ms`. The underlying work is not
 * cancelled - an RPC call that answers late is simply ignored, which is what the watchdog wants.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, error: () => Error): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(error());
        }, ms);
        if (typeof timer.unref === 'function') {
            timer.unref();
        }
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (reason: unknown) => {
                clearTimeout(timer);
                reject(reason instanceof Error ? reason : new Error(String(reason)));
            },
        );
    });
}
