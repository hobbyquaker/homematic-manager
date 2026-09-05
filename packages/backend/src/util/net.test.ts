import {EventEmitter} from 'node:events';
import net from 'node:net';
import type {AddressInfo} from 'node:net';

import {afterEach, describe, expect, it, vi} from 'vitest';

import {delay, localIPv4Addresses, probePort, withTimeout} from './net.js';

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
        expect(addresses).toEqual(['192.168.1.10']);
    });

    it('asks the operating system when nothing is injected', () => {
        expect(Array.isArray(localIPv4Addresses())).toBe(true);
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
        const server = net.createServer();
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const {port} = server.address() as AddressInfo;
        await new Promise((resolve) => server.close(resolve));
        await expect(probePort('127.0.0.1', port, {timeoutMs: 500})).resolves.toBe(false);
    });

    it('is false when the connection times out, and destroys the socket', async () => {
        const socket = new EventEmitter() as net.Socket & EventEmitter;
        socket.destroy = vi.fn() as never;
        const connect = vi.fn(() => {
            setTimeout(() => socket.emit('timeout'), 0);
            return socket;
        });
        await expect(probePort('10.0.0.1', 2001, {connect: connect as never, timeoutMs: 10})).resolves.toBe(false);
        expect(socket.destroy).toHaveBeenCalled();
    });

    it('settles only once', async () => {
        const socket = new EventEmitter() as net.Socket & EventEmitter;
        socket.destroy = vi.fn() as never;
        const connect = vi.fn((_options: unknown, onConnect: () => void) => {
            setTimeout(() => {
                onConnect();
                socket.emit('error', new Error('late'));
            }, 0);
            return socket;
        });
        await expect(probePort('10.0.0.1', 2001, {connect: connect as never})).resolves.toBe(true);
        expect(socket.destroy).toHaveBeenCalledTimes(1);
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
        await expect(withTimeout(Promise.reject('plain'), 100, () => new Error('late'))).rejects.toThrow('plain');
    });
});
