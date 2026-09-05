/**
 * Finding CCUs on the network: the eQ-3 UDP broadcast probe, ported from hm2mqtt.js
 * (`lib/discovery.js` plus the `udpProbe` of `mqtt-interfaces-core`), which in turn comes from
 * `hm-discover` - the unmaintained package 2.x used.
 *
 * A datagram to UDP 43439 makes every eQ-3 device (CCU1/2/3, RaspberryMatic/OpenCCU, HmIP access
 * points) answer with its type, serial number and firmware version. Which interfaces the CCU
 * actually runs is then read off the ports that answer, the same table the interface manager
 * probes with.
 *
 * The probe is sent to `255.255.255.255` and to the broadcast address of every local subnet: some
 * stacks drop the global broadcast, and a CCU one hop away hears neither - for that case the
 * configuration dialog keeps its "type the address" field.
 */

import dgram from 'node:dgram';
import os from 'node:os';

import {INTERFACE_NAMES, interfaceDefinition, interfacePort, type DiscoveredCcu} from '@homematic-manager/core';

import {probePort} from '../util/net.js';

/** eQ-3 discovery port and the magic datagram: header plus `eQ3-*\0*\0I`. */
export const EQ3_PORT = 43_439;
export const EQ3_HEADER = '028f91c001';
export const EQ3_PROBE = Buffer.from([
    0x02, 0x8f, 0x91, 0xc0, 0x01, 0x65, 0x51, 0x33, 0x2d, 0x2a, 0x00, 0x2a, 0x00, 0x49,
]);

/** What one CCU answered. */
export interface Eq3Answer {
    readonly type: string;
    readonly serial: string;
    readonly version?: string;
}

/**
 * Parses an eQ-3 discovery answer: the five byte header, then NUL-terminated type and serial, three
 * flag bytes, then the firmware version. `undefined` for a datagram from something else.
 */
export function parseEq3(message: Buffer): Eq3Answer | undefined {
    if (!Buffer.isBuffer(message) || message.length < 8 || message.subarray(0, 5).toString('hex') !== EQ3_HEADER) {
        return undefined;
    }
    let offset = 5;
    const readString = (): string | undefined => {
        const end = message.indexOf(0, offset);
        if (end < 0) {
            return undefined;
        }
        // the CCU sends ISO-8859-1 here too
        const value = message.toString('latin1', offset, end);
        offset = end + 1;
        return value;
    };
    const type = readString();
    const serial = readString();
    if (type === undefined || serial === undefined) {
        return undefined;
    }
    offset += 3; // three flag bytes between the serial and the version
    const version = readString();
    return {type, serial, ...(version !== undefined && version !== '' ? {version} : {})};
}

/** The broadcast address of every non-internal IPv4 subnet of this machine. */
export function localBroadcasts(
    interfaces: () => NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces,
): string[] {
    const addresses: string[] = [];
    for (const entries of Object.values(interfaces())) {
        for (const entry of entries ?? []) {
            if (entry.family !== 'IPv4' || entry.internal || !entry.netmask) {
                continue;
            }
            const mask = ipToInt(entry.netmask);
            const network = (ipToInt(entry.address) & mask) >>> 0;
            const broadcast = (network | (~mask >>> 0)) >>> 0;
            const text = intToIp(broadcast);
            if (broadcast > network + 1 && !addresses.includes(text)) {
                addresses.push(text);
            }
        }
    }
    return addresses;
}

function ipToInt(address: string): number {
    return address.split('.').reduce((total, part) => ((total << 8) | (Number(part) & 0xff)) >>> 0, 0) >>> 0;
}

function intToIp(value: number): string {
    return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].join('.');
}

export interface DiscoverOptions {
    /** How long to listen, in milliseconds. */
    readonly timeoutMs?: number;
    /** How often the probe is repeated inside the timeout; UDP loses datagrams. */
    readonly tries?: number;
    /** Extra unicast targets, for a CCU that no broadcast reaches. */
    readonly targets?: readonly string[];
    /** Probe the interface ports of every answer to see what it runs. Default: yes. */
    readonly probePorts?: boolean;
    /** Interface ports of a CCU behind TLS. */
    readonly tls?: boolean;
    /** Injected by the tests. */
    readonly createSocket?: () => dgram.Socket;
    readonly probe?: (host: string, port: number) => Promise<boolean>;
    readonly interfaces?: () => NodeJS.Dict<os.NetworkInterfaceInfo[]>;
}

/** The interfaces of a discovered CCU, in table order: whichever ports answered. */
export async function probeInterfacesOf(address: string, options: DiscoverOptions = {}): Promise<string[]> {
    const probe = options.probe ?? ((host, port) => probePort(host, port, {timeoutMs: 1500}));
    const found: string[] = [];
    await Promise.all(
        INTERFACE_NAMES.map(async (name) => {
            const definition = interfaceDefinition(name);
            if (definition && (await probe(address, interfacePort(definition, {tls: options.tls === true})))) {
                found.push(name);
            }
        }),
    );
    return INTERFACE_NAMES.filter((name) => found.includes(name));
}

/**
 * Sends the probe and collects what answers. Never rejects - a socket that cannot be bound or a
 * network that forbids broadcast simply produces an empty list, and the user types the address.
 */
export async function discoverCcus(options: DiscoverOptions = {}): Promise<DiscoveredCcu[]> {
    const timeoutMs = options.timeoutMs ?? 2000;
    const tries = Math.max(1, options.tries ?? 3);
    const socket = (options.createSocket ?? (() => dgram.createSocket({type: 'udp4', reuseAddr: true})))();
    const answers = new Map<string, Eq3Answer>();

    socket.on('message', (data: Buffer, rinfo: dgram.RemoteInfo) => {
        const parsed = parseEq3(data);
        if (parsed && !answers.has(rinfo.address)) {
            answers.set(rinfo.address, parsed);
        }
    });

    try {
        await new Promise<void>((resolve, reject) => {
            socket.once('error', reject);
            socket.bind(0, () => {
                socket.removeListener('error', reject);
                resolve();
            });
        });
    } catch {
        socket.close();
        return [];
    }
    socket.on('error', () => undefined);

    const targets = [
        '255.255.255.255',
        ...localBroadcasts(options.interfaces ?? os.networkInterfaces),
        ...(options.targets ?? []),
    ];
    try {
        socket.setBroadcast(true);
    } catch {
        // a socket that refuses SO_BROADCAST: only the unicast targets will hear us
    }
    for (let attempt = 0; attempt < tries; attempt += 1) {
        for (const target of targets) {
            try {
                socket.send(EQ3_PROBE, 0, EQ3_PROBE.length, EQ3_PORT, target, () => undefined);
            } catch {
                // an address the stack rejects outright must not end the whole scan
            }
        }
        await sleep(timeoutMs / tries);
    }
    socket.close();

    const found: DiscoveredCcu[] = [];
    for (const [address, answer] of answers) {
        found.push({
            address,
            name: answer.type,
            serial: answer.serial,
            ...(answer.version === undefined ? {} : {firmware: answer.version}),
            interfaces: options.probePorts === false ? [] : await probeInterfacesOf(address, options),
        });
    }
    return found.sort((a, b) => a.address.localeCompare(b.address));
}

function sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        if (typeof timer.unref === 'function') {
            timer.unref();
        }
    });
}
