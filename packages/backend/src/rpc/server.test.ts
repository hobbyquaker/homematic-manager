import {describe, expect, it, vi} from 'vitest';

import binrpc from 'binrpc';
import xmlrpc from 'homematic-xmlrpc';

import type {DeviceDescription, RpcValue} from '@homematic-manager/core';

import {
    CALLBACK_METHODS,
    CallbackServer,
    CallbackServers,
    hmipListDevicesEntry,
    listDevicesAnswer,
    type CallbackHandler,
} from './server.js';

function recordingHandler(devices: DeviceDescription[] = []): CallbackHandler & {calls: unknown[][]} {
    const calls: unknown[][] = [];
    return {
        calls,
        event: (...args) => calls.push(['event', ...args]),
        newDevices: (...args) => calls.push(['newDevices', ...args]),
        deleteDevices: (...args) => calls.push(['deleteDevices', ...args]),
        replaceDevice: (...args) => calls.push(['replaceDevice', ...args]),
        readdedDevice: (...args) => calls.push(['readdedDevice', ...args]),
        updateDevice: (...args) => calls.push(['updateDevice', ...args]),
        listDevices: (interfaceName) => {
            calls.push(['listDevices', interfaceName]);
            return listDevicesAnswer(interfaceName, devices);
        },
        unknownMethod: (...args) => calls.push(['unknown', ...args]),
    };
}

const device = (overrides: Partial<DeviceDescription> = {}): DeviceDescription => ({
    ADDRESS: 'ABC0000001',
    TYPE: 'HmIP-PDT',
    VERSION: 1,
    ...overrides,
});

describe('listDevicesAnswer', () => {
    it('sends address and version for a BidCos interface', () => {
        expect(listDevicesAnswer('BidCos-RF', [device({ADDRESS: 'LEQ1', VERSION: 3})])).toEqual([
            {ADDRESS: 'LEQ1', VERSION: 3},
        ]);
    });

    it('defaults a missing VERSION to 0', () => {
        expect(listDevicesAnswer('BidCos-RF', [{ADDRESS: 'LEQ1', TYPE: 'X'}])).toEqual([{ADDRESS: 'LEQ1', VERSION: 0}]);
    });

    it('sends the reduced HmIP shape and drops falsy fields', () => {
        const answer = listDevicesAnswer('HmIP-RF', [
            device({
                ADDRESS: 'ABC:1',
                PARENT: 'ABC',
                PARENT_TYPE: 'HmIP-PDT',
                TYPE: 'SWITCH_TRANSCEIVER',
                FLAGS: 1,
                AES_ACTIVE: 0,
                DIRECTION: 0,
                RX_MODE: 12,
                FIRMWARE: '1.4.8',
            }),
        ]);
        expect(answer).toEqual([
            {
                ADDRESS: 'ABC:1',
                VERSION: 1,
                FLAGS: 1,
                RX_MODE: 12,
                FIRMWARE: '1.4.8',
                PARENT: 'ABC',
                PARENT_TYPE: 'HmIP-PDT',
                TYPE: 'SWITCH_TRANSCEIVER',
            },
        ]);
    });

    it('lists the virtual remote control and its channels like any other device', () => {
        // Leaving it out makes hmipserver warn and re-send all of it with newDevices at every init.
        const answer = listDevicesAnswer('HmIP-RF', [
            device({ADDRESS: 'HmIP-RCV-1', TYPE: 'HmIP-RCV-50', CHILDREN: ['HmIP-RCV-1:0', 'HmIP-RCV-1:1']}),
            device({ADDRESS: 'HmIP-RCV-1:0', TYPE: 'MAINTENANCE', PARENT: 'HmIP-RCV-1', PARENT_TYPE: 'HmIP-RCV-50'}),
            device({
                ADDRESS: 'HmIP-RCV-1:1',
                TYPE: 'KEY_TRANSCEIVER',
                PARENT: 'HmIP-RCV-1',
                PARENT_TYPE: 'HmIP-RCV-50',
            }),
        ]);
        expect(answer.map((entry) => (entry as Record<string, RpcValue>)['ADDRESS'])).toEqual([
            'HmIP-RCV-1',
            'HmIP-RCV-1:0',
            'HmIP-RCV-1:1',
        ]);
        expect(hmipListDevicesEntry(device({ADDRESS: 'HmIP-RCV-1', TYPE: 'HmIP-RCV-50'}))).toMatchObject({
            ADDRESS: 'HmIP-RCV-1',
            TYPE: 'HmIP-RCV-50',
        });
    });
});

describe('CallbackServer.dispatch', () => {
    const server = (handler: CallbackHandler) => new CallbackServer({protocol: 'xmlrpc', port: 0, handler});

    it('maps the ident back to the interface name', () => {
        const handler = recordingHandler();
        server(handler).dispatch('event', ['hmm_BidCos-RF', 'LEQ1:1', 'STATE', true]);
        expect(handler.calls[0]).toEqual(['event', 'BidCos-RF', 'LEQ1:1', 'STATE', true]);
    });

    it('knows the literal CUxD ident', () => {
        const handler = recordingHandler();
        server(handler).dispatch('event', ['CUxD', 'CUX1:1', 'STATE', 1]);
        expect(handler.calls[0]).toEqual(['event', 'CUxD', 'CUX1:1', 'STATE', 1]);
    });

    it('falls back to the raw ident when nothing maps it', () => {
        const handler = recordingHandler();
        server(handler).dispatch('event', ['something-else', 'A:1', 'STATE', false]);
        expect(handler.calls[0]?.[1]).toBe('something-else');
    });

    it('answers system.listMethods with everything it implements', () => {
        expect(server(recordingHandler()).dispatch('system.listMethods', [])).toEqual([...CALLBACK_METHODS]);
    });

    it('answers listDevices from the cache', () => {
        const handler = recordingHandler([device({ADDRESS: 'LEQ1'})]);
        expect(server(handler).dispatch('listDevices', ['hmm_BidCos-RF'])).toEqual([{ADDRESS: 'LEQ1', VERSION: 1}]);
    });

    it('forwards the device callbacks with their payloads', () => {
        const handler = recordingHandler();
        const target = server(handler);
        target.dispatch('newDevices', ['hmm_HmIP-RF', [{ADDRESS: 'ABC'}, 'nonsense', {NO_ADDRESS: 1}]]);
        target.dispatch('deleteDevices', ['hmm_HmIP-RF', ['ABC', 'DEF']]);
        target.dispatch('replaceDevice', ['hmm_HmIP-RF', 'OLD', 'NEW']);
        target.dispatch('readdedDevice', ['hmm_HmIP-RF', ['ABC']]);
        target.dispatch('updateDevice', ['hmm_HmIP-RF', 'ABC', 1]);
        expect(handler.calls).toEqual([
            ['newDevices', 'HmIP-RF', [{ADDRESS: 'ABC'}]],
            ['deleteDevices', 'HmIP-RF', ['ABC', 'DEF']],
            ['replaceDevice', 'HmIP-RF', 'OLD', 'NEW'],
            ['readdedDevice', 'HmIP-RF', ['ABC']],
            ['updateDevice', 'HmIP-RF', 'ABC', 1],
        ]);
    });

    it('tolerates missing or wrongly typed parameters', () => {
        const handler = recordingHandler();
        const target = server(handler);
        target.dispatch('event', ['hmm_HmIP-RF']);
        target.dispatch('deleteDevices', ['hmm_HmIP-RF', 'not an array']);
        target.dispatch('updateDevice', ['hmm_HmIP-RF', 'ABC']);
        expect(handler.calls[0]).toEqual(['event', 'HmIP-RF', '', '', '']);
        expect(handler.calls[1]).toEqual(['deleteDevices', 'HmIP-RF', []]);
        expect(handler.calls[2]).toEqual(['updateDevice', 'HmIP-RF', 'ABC', 0]);
    });

    it('answers an unknown method harmlessly and reports it', () => {
        const handler = recordingHandler();
        expect(server(handler).dispatch('foo.bar', ['hmm_HmIP-RF'])).toBe('');
        expect(handler.calls[0]).toEqual(['unknown', 'foo.bar', ['hmm_HmIP-RF']]);
    });

    it('knows setReadyConfig, the documented callback the interfaces send after init', () => {
        const handler = recordingHandler();
        expect(server(handler).dispatch('setReadyConfig', ['hmm_HmIP-RF'])).toBe('');
        expect(handler.calls.some((call) => call[0] === 'unknown')).toBe(false);
        expect(server(handler).dispatch('system.listMethods', [])).toContain('setReadyConfig');
    });

    it('runs a multicall and answers one entry per call', () => {
        const handler = recordingHandler();
        const answer = server(handler).dispatch('system.multicall', [
            [
                {methodName: 'event', params: ['hmm_HmIP-RF', 'A:1', 'STATE', true]},
                {methodName: 'event', params: ['hmm_HmIP-RF', 'A:1', 'LEVEL', 0.5]},
                {methodName: 'system.listMethods', params: []},
                'garbage',
                {methodName: 'event'},
            ],
        ]);
        expect(Array.isArray(answer)).toBe(true);
        expect((answer as RpcValue[]).length).toBe(5);
        expect(handler.calls.filter((call) => call[0] === 'event')).toHaveLength(3);
    });

    it('answers an empty multicall and a malformed one', () => {
        const target = server(recordingHandler());
        expect(target.dispatch('system.multicall', [])).toEqual([]);
        expect(target.dispatch('system.multicall', ['nope'])).toEqual([]);
    });

    it('swallows a handler that throws inside a multicall', () => {
        const onError = vi.fn();
        const handler = recordingHandler();
        handler.event = () => {
            throw new Error('cache is broken');
        };
        const target = new CallbackServer({protocol: 'xmlrpc', port: 0, handler, onError});
        expect(target.dispatch('system.multicall', [[{methodName: 'event', params: ['hmm_HmIP-RF']}]])).toEqual(['']);
        expect(onError).toHaveBeenCalledOnce();
    });
});

describe('the sockets', () => {
    it('starts an xmlrpc server on a free port and answers a real call', async () => {
        const handler = recordingHandler([device({ADDRESS: 'LEQ1'})]);
        const server = new CallbackServer({protocol: 'xmlrpc', host: '127.0.0.1', port: 0, handler});
        const port = await server.start();
        expect(port).toBeGreaterThan(0);
        const client = xmlrpc.createClient({host: '127.0.0.1', port, path: '/'});
        const answer = await new Promise((resolve, reject) => {
            client.methodCall('listDevices', ['hmm_BidCos-RF'], (error, value) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(value);
                }
            });
        });
        expect(answer).toEqual([{ADDRESS: 'LEQ1', VERSION: 1}]);
        await server.stop();
        expect(server.port).toBe(0);
    });

    it('starts a binrpc server on a free port and answers a real call', async () => {
        const handler = recordingHandler();
        const server = new CallbackServer({protocol: 'binrpc', host: '127.0.0.1', port: 0, handler});
        const port = await server.start();
        const client = binrpc.createClient({host: '127.0.0.1', port});
        await new Promise((resolve, reject) => {
            client.methodCall('event', ['hmm_BidCos-RF', 'LEQ1:1', 'STATE', true], (error, value) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(value);
                }
            });
        });
        expect(handler.calls[0]).toEqual(['event', 'BidCos-RF', 'LEQ1:1', 'STATE', true]);
        client.socket.removeAllListeners();
        client.socket.destroy();
        await server.stop();
    });

    it('rejects when the xmlrpc port is taken, and reports it only that way', async () => {
        const handler = recordingHandler();
        const onError = vi.fn();
        const first = new CallbackServer({protocol: 'xmlrpc', host: '127.0.0.1', port: 0, handler});
        const port = await first.start();
        const second = new CallbackServer({protocol: 'xmlrpc', host: '127.0.0.1', port, handler, onError});
        await expect(second.start()).rejects.toThrow(/xmlrpc callback server/);
        // the manager turns `onError` into a notice of its own, and the rejection already is one
        expect(onError).not.toHaveBeenCalled();
        await first.stop();
        await second.stop();
    });

    it('rejects when the binrpc port is taken, and reports it only that way', async () => {
        const handler = recordingHandler();
        const onError = vi.fn();
        const first = new CallbackServer({protocol: 'binrpc', host: '127.0.0.1', port: 0, handler});
        const port = await first.start();
        const second = new CallbackServer({protocol: 'binrpc', host: '127.0.0.1', port, handler, onError});
        await expect(second.start()).rejects.toThrow(/binrpc callback server/);
        expect(onError).not.toHaveBeenCalled();
        await first.stop();
        await second.stop();
    });
});

describe('CallbackServers', () => {
    it('starts one server per protocol and builds the init URLs', async () => {
        const servers = new CallbackServers({
            handler: recordingHandler(),
            host: '127.0.0.1',
            ports: {xmlrpc: 0, binrpc: 0},
        });
        const xmlrpcPort = await servers.ensure('xmlrpc');
        expect(await servers.ensure('xmlrpc')).toBe(xmlrpcPort);
        const binrpcPort = await servers.ensure('binrpc');
        expect(binrpcPort).not.toBe(xmlrpcPort);
        expect(servers.callbackUrl('xmlrpc', '192.168.1.5')).toBe(`http://192.168.1.5:${String(xmlrpcPort)}`);
        expect(servers.callbackUrl('binrpc', '192.168.1.5')).toBe(`xmlrpc_bin://192.168.1.5:${String(binrpcPort)}`);
        await servers.stop();
        expect(servers.port('xmlrpc')).toBe(0);
    });

    it('forgets a server that could not be started', async () => {
        const blocker = new CallbackServer({
            protocol: 'xmlrpc',
            host: '127.0.0.1',
            port: 0,
            handler: recordingHandler(),
        });
        const port = await blocker.start();
        const servers = new CallbackServers({
            handler: recordingHandler(),
            host: '127.0.0.1',
            ports: {xmlrpc: port, binrpc: 0},
        });
        await expect(servers.ensure('xmlrpc')).rejects.toThrow();
        expect(servers.port('xmlrpc')).toBe(0);
        await blocker.stop();
        await servers.stop();
    });

    /** Task 35 (D-43): the CCU addon's fixed pair, for the ports the configuration leaves at 0. */
    it('takes the default port while the configured one is 0', async () => {
        const probe = new CallbackServer({protocol: 'binrpc', host: '127.0.0.1', port: 0, handler: recordingHandler()});
        const free = await probe.start();
        await probe.stop();
        const servers = new CallbackServers({
            handler: recordingHandler(),
            host: '127.0.0.1',
            ports: {xmlrpc: 0, binrpc: 0},
            defaultPorts: {xmlrpc: 0, binrpc: free},
        });
        expect(await servers.ensure('binrpc')).toBe(free);
        // a default of 0 is no default: the kernel's free port, as before
        expect(await servers.ensure('xmlrpc')).toBeGreaterThan(0);
        await servers.stop();
    });

    it('falls back to a free port when the default one is taken, and says so once', async () => {
        const blocker = new CallbackServer({
            protocol: 'xmlrpc',
            host: '127.0.0.1',
            port: 0,
            handler: recordingHandler(),
        });
        const taken = await blocker.start();
        const onFallback = vi.fn();
        const onError = vi.fn();
        const servers = new CallbackServers({
            handler: recordingHandler(),
            host: '127.0.0.1',
            ports: {xmlrpc: 0, binrpc: 0},
            defaultPorts: {xmlrpc: taken, binrpc: 0},
            onFallback,
            onError,
        });
        const port = await servers.ensure('xmlrpc');
        expect(port).toBeGreaterThan(0);
        expect(port).not.toBe(taken);
        expect(await servers.ensure('xmlrpc')).toBe(port);
        expect(servers.callbackUrl('xmlrpc', '127.0.0.1')).toBe(`http://127.0.0.1:${String(port)}`);
        expect(onFallback).toHaveBeenCalledOnce();
        expect(onFallback.mock.calls[0]?.slice(0, 2)).toEqual(['xmlrpc', taken]);
        expect(onError).not.toHaveBeenCalled();
        await servers.stop();
        await blocker.stop();
    });

    it('keeps a configured port over the default, and a taken configured port stays an error', async () => {
        const blocker = new CallbackServer({
            protocol: 'xmlrpc',
            host: '127.0.0.1',
            port: 0,
            handler: recordingHandler(),
        });
        const taken = await blocker.start();
        const onFallback = vi.fn();
        // A free port for the configured binrpc server comes from a probe that is closed again, and
        // between that close and the bind another test file running in parallel may take the number
        // (seen once in a full run). A lost race is not what this test is about, so it picks another
        // port; a configured port that is taken still has to be an error, which the xmlrpc half checks.
        let servers: CallbackServers | undefined;
        for (let attempt = 1; servers === undefined; attempt += 1) {
            const probe = new CallbackServer({
                protocol: 'binrpc',
                host: '127.0.0.1',
                port: 0,
                handler: recordingHandler(),
            });
            const free = await probe.start();
            await probe.stop();
            const candidate = new CallbackServers({
                handler: recordingHandler(),
                host: '127.0.0.1',
                ports: {xmlrpc: taken, binrpc: free},
                // never bound: a configured port wins
                defaultPorts: {xmlrpc: 2031, binrpc: 2032},
                onFallback,
            });
            try {
                expect(await candidate.ensure('binrpc')).toBe(free);
                servers = candidate;
            } catch (error) {
                await candidate.stop();
                if (attempt >= 5) {
                    throw error;
                }
            }
        }
        await expect(servers.ensure('xmlrpc')).rejects.toThrow(/xmlrpc callback server/);
        expect(onFallback).not.toHaveBeenCalled();
        await servers.stop();
        await blocker.stop();
    });
});
