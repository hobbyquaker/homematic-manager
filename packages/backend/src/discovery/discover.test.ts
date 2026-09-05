import {EventEmitter} from 'node:events';
import type dgram from 'node:dgram';

import {describe, expect, it, vi} from 'vitest';

import {EQ3_PORT, EQ3_PROBE, discoverCcus, localBroadcasts, parseEq3, probeInterfacesOf} from './discover.js';

/** A CCU answer: header, type\0, serial\0, three flag bytes, version\0. */
function answer(type: string, serial: string, version?: string): Buffer {
    const parts = [
        Buffer.from([0x02, 0x8f, 0x91, 0xc0, 0x01]),
        Buffer.from(`${type}\0${serial}\0`, 'latin1'),
        Buffer.from([0, 0, 0]),
    ];
    if (version !== undefined) {
        parts.push(Buffer.from(`${version}\0`, 'latin1'));
    }
    return Buffer.concat(parts);
}

/** A socket that hands out the datagrams a test prepared. */
function fakeSocket(
    messages: {data: Buffer; address: string}[],
): dgram.Socket & {sent: {port: number; target: string}[]} {
    const socket = new EventEmitter() as dgram.Socket & {sent: {port: number; target: string}[]};
    socket.sent = [];
    socket.bind = ((_port: number, callback: () => void) => {
        setTimeout(() => {
            callback();
            for (const message of messages) {
                socket.emit('message', message.data, {address: message.address});
            }
        }, 0);
        return socket;
    }) as never;
    socket.setBroadcast = (() => undefined) as never;
    socket.send = ((
        _message: Buffer,
        _offset: number,
        _length: number,
        port: number,
        target: string,
        callback: () => void,
    ) => {
        socket.sent.push({port, target});
        callback();
    }) as never;
    socket.close = (() => undefined) as never;
    return socket;
}

describe('parseEq3', () => {
    it('reads type, serial and firmware', () => {
        expect(parseEq3(answer('eQ3-HM-CCU2', 'KEQ0123456', '3.89.8'))).toEqual({
            type: 'eQ3-HM-CCU2',
            serial: 'KEQ0123456',
            version: '3.89.8',
        });
    });

    it('works without a firmware version', () => {
        expect(parseEq3(answer('eQ3-HmIP-HAP', 'XEQ1'))).toEqual({type: 'eQ3-HmIP-HAP', serial: 'XEQ1'});
    });

    it('decodes ISO-8859-1, not UTF-8', () => {
        expect(parseEq3(answer('eQ3-Küche', 'KEQ1'))?.type).toBe('eQ3-Küche');
    });

    it('rejects a foreign datagram', () => {
        expect(parseEq3(Buffer.from('hello world'))).toBeUndefined();
        expect(parseEq3(Buffer.from([0x02, 0x8f]))).toBeUndefined();
        expect(parseEq3('not a buffer' as unknown as Buffer)).toBeUndefined();
    });

    it('rejects a truncated answer', () => {
        expect(parseEq3(Buffer.from([0x02, 0x8f, 0x91, 0xc0, 0x01, 0x41, 0x42, 0x43]))).toBeUndefined();
        expect(
            parseEq3(Buffer.concat([Buffer.from([0x02, 0x8f, 0x91, 0xc0, 0x01]), Buffer.from('A\0BC')])),
        ).toBeUndefined();
    });
});

describe('localBroadcasts', () => {
    it('derives the broadcast address of every external subnet', () => {
        const addresses = localBroadcasts(
            () =>
                ({
                    lo: [{address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', internal: true}],
                    eth0: [
                        {address: '192.168.1.5', netmask: '255.255.255.0', family: 'IPv4', internal: false},
                        {address: 'fe80::1', netmask: 'ffff::', family: 'IPv6', internal: false},
                    ],
                    eth1: [{address: '10.0.0.5', netmask: '255.255.0.0', family: 'IPv4', internal: false}],
                    dup: [{address: '192.168.1.9', netmask: '255.255.255.0', family: 'IPv4', internal: false}],
                    ptp: [{address: '10.9.9.1', netmask: '255.255.255.255', family: 'IPv4', internal: false}],
                    down: undefined,
                }) as never,
        );
        expect(addresses).toEqual(['192.168.1.255', '10.0.255.255']);
    });

    it('asks the operating system when nothing is injected', () => {
        expect(Array.isArray(localBroadcasts())).toBe(true);
    });
});

describe('probeInterfacesOf', () => {
    it('lists the interfaces whose ports answer, in table order', async () => {
        const open = new Set([2010, 2001]);
        await expect(
            probeInterfacesOf('10.0.0.1', {probe: (_host, port) => Promise.resolve(open.has(port))}),
        ).resolves.toEqual(['BidCos-RF', 'HmIP-RF']);
    });

    it('uses the TLS ports when asked', async () => {
        const seen: number[] = [];
        await probeInterfacesOf('10.0.0.1', {
            tls: true,
            probe: (_host, port) => {
                seen.push(port);
                return Promise.resolve(false);
            },
        });
        expect(seen).toContain(42_001);
    });
});

describe('discoverCcus', () => {
    const noInterfaces = () => ({});

    it('collects what answered and probes its interfaces', async () => {
        const socket = fakeSocket([
            {data: answer('eQ3-HM-CCU3', 'KEQ1', '3.89.8'), address: '10.0.0.1'},
            {data: answer('eQ3-HM-CCU3', 'KEQ1', '3.89.8'), address: '10.0.0.1'},
            {data: Buffer.from('something else'), address: '10.0.0.9'},
            {data: answer('eQ3-HmIP-HAP', 'XEQ2'), address: '10.0.0.2'},
        ]);
        const found = await discoverCcus({
            createSocket: () => socket,
            interfaces: noInterfaces,
            timeoutMs: 10,
            tries: 1,
            probe: (host, port) => Promise.resolve(host === '10.0.0.1' && port === 2010),
        });
        expect(found).toEqual([
            {address: '10.0.0.1', name: 'eQ3-HM-CCU3', serial: 'KEQ1', firmware: '3.89.8', interfaces: ['HmIP-RF']},
            {address: '10.0.0.2', name: 'eQ3-HmIP-HAP', serial: 'XEQ2', interfaces: []},
        ]);
    });

    it('sends the probe to the broadcast and to the extra targets, once per try', async () => {
        const socket = fakeSocket([]);
        await discoverCcus({
            createSocket: () => socket,
            interfaces: noInterfaces,
            timeoutMs: 6,
            tries: 2,
            targets: ['10.0.0.7'],
            probePorts: false,
        });
        expect(socket.sent).toHaveLength(4);
        expect(socket.sent[0]).toEqual({port: EQ3_PORT, target: '255.255.255.255'});
        expect(socket.sent[1]).toEqual({port: EQ3_PORT, target: '10.0.0.7'});
        expect(EQ3_PROBE.subarray(0, 5).toString('hex')).toBe('028f91c001');
    });

    it('answers with an empty list when the socket cannot be bound', async () => {
        const socket = fakeSocket([]);
        socket.bind = (() => {
            setTimeout(() => socket.emit('error', new Error('EACCES')), 0);
            return socket;
        }) as never;
        const close = vi.fn();
        socket.close = close as never;
        await expect(discoverCcus({createSocket: () => socket, interfaces: noInterfaces})).resolves.toEqual([]);
        expect(close).toHaveBeenCalled();
    });

    it('survives a socket that refuses broadcast and a send that throws', async () => {
        const socket = fakeSocket([]);
        socket.setBroadcast = (() => {
            throw new Error('EPERM');
        }) as never;
        socket.send = (() => {
            throw new Error('EINVAL');
        }) as never;
        await expect(
            discoverCcus({createSocket: () => socket, interfaces: noInterfaces, timeoutMs: 5, tries: 1}),
        ).resolves.toEqual([]);
    });
});
