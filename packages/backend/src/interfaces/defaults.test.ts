/**
 * The interface manager with nothing injected: real callback servers, real clients, the real port
 * probe and the real watchdog timer. `manager.test.ts` drives the logic with fakes; this checks
 * that the wiring underneath it is the wiring a host gets.
 */

import net from 'node:net';
import type {AddressInfo} from 'node:net';

import {afterEach, describe, expect, it} from 'vitest';

import {normaliseConnection} from '../config/defaults.js';
import type {CallbackHandler} from '../rpc/server.js';
import {InterfaceManager} from './manager.js';

const handler = {
    event: () => undefined,
    newDevices: () => undefined,
    deleteDevices: () => undefined,
    replaceDevice: () => undefined,
    readdedDevice: () => undefined,
    updateDevice: () => undefined,
    listDevices: () => [],
} satisfies CallbackHandler;

const managers: InterfaceManager[] = [];

afterEach(async () => {
    for (const manager of managers.splice(0)) {
        await manager.stop();
    }
});

/** A port nothing listens on: bound, read, closed again. */
async function closedPort(): Promise<number> {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const {port} = server.address() as AddressInfo;
    await new Promise((resolve) => server.close(resolve));
    return port;
}

describe('InterfaceManager without injected parts', () => {
    it('starts real callback servers, fails to reach a closed port and stops cleanly', async () => {
        const port = await closedPort();
        const notices: string[] = [];
        const manager = new InterfaceManager({
            connection: normaliseConnection({
                host: '127.0.0.1',
                interfaces: ['HmIP-RF'],
                autoDetect: true,
                callback: {ip: '127.0.0.1', xmlrpcPort: 0, binrpcPort: 0},
            }),
            handler,
            callbackHost: '127.0.0.1',
            rpcTimeoutMs: 500,
            // a real interval, short enough for the test and long enough not to fire during it
            watchdogIntervalMs: 60_000,
            portOverride: () => port,
            onStateChanged: () => undefined,
            onNotice: (_level, message) => notices.push(message),
        });
        managers.push(manager);

        await manager.start();
        expect(manager.isConnected('HmIP-RF')).toBe(false);
        expect(notices.some((message) => message.includes('HmIP-RF'))).toBe(true);
        // the background probe ran against the same closed port
        await expect(manager.probeInterfaces()).resolves.toEqual([]);
        expect(manager.callbackIp).toBe('127.0.0.1');
    });

    it('takes the first local address when the callback address is empty', () => {
        const manager = new InterfaceManager({
            connection: normaliseConnection({host: '127.0.0.1', interfaces: ['HmIP-RF']}),
            handler,
            localAddresses: () => ['10.1.2.3', '10.1.2.4'],
            onStateChanged: () => undefined,
            onNotice: () => undefined,
        });
        expect(manager.callbackIp).toBe('10.1.2.3');
    });

    it('falls back to loopback when this machine has no external address', () => {
        const manager = new InterfaceManager({
            connection: normaliseConnection({host: '127.0.0.1', interfaces: ['HmIP-RF']}),
            handler,
            localAddresses: () => [],
            onStateChanged: () => undefined,
            onNotice: () => undefined,
        });
        expect(manager.callbackIp).toBe('127.0.0.1');
    });

    it('reports a callback server that cannot bind instead of throwing', async () => {
        const blocker = net.createServer();
        await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
        const {port} = blocker.address() as AddressInfo;
        const notices: string[] = [];
        const manager = new InterfaceManager({
            connection: normaliseConnection({
                host: '127.0.0.1',
                interfaces: ['HmIP-RF'],
                autoDetect: false,
                callback: {ip: '127.0.0.1', xmlrpcPort: port, binrpcPort: 0},
            }),
            handler,
            callbackHost: '127.0.0.1',
            watchdogIntervalMs: 0,
            onStateChanged: () => undefined,
            onNotice: (_level, message) => notices.push(message),
        });
        managers.push(manager);
        await expect(manager.start()).rejects.toThrow(/callback server/);
        await new Promise((resolve) => blocker.close(resolve));
    });
});
