import {describe, expect, it, vi} from 'vitest';

import {DEMO_DEVICES, DEMO_NAMES, DEMO_SERVICE_MESSAGES} from './demoData.js';
import {ApiRequestError} from './error.js';
import {MockTransport} from './MockTransport.js';

describe('MockTransport', () => {
    it('starts connected and reports connection changes once per change', () => {
        const transport = new MockTransport();
        const seen: boolean[] = [];
        const off = transport.onConnectionChange((connected) => seen.push(connected));

        expect(transport.connected).toBe(true);
        transport.setConnected(false);
        transport.setConnected(false);
        transport.setConnected(true);
        off();
        transport.setConnected(false);

        expect(seen).toEqual([false, true]);
        expect(transport.connected).toBe(false);
    });

    it('can start disconnected', () => {
        expect(new MockTransport({connected: false}).connected).toBe(false);
    });

    it('answers with the registered handler and records the call', async () => {
        const transport = new MockTransport();
        transport.respond('devices.list', (interfaceName) =>
            interfaceName === 'BidCos-RF' ? DEMO_DEVICES['BidCos-RF'] : [],
        );

        await expect(transport.request('devices.list', 'BidCos-RF')).resolves.toBe(DEMO_DEVICES['BidCos-RF']);
        await expect(transport.request('devices.list', 'HmIP-RF')).resolves.toEqual([]);

        expect(transport.calls).toEqual([
            {method: 'devices.list', params: ['BidCos-RF']},
            {method: 'devices.list', params: ['HmIP-RF']},
        ]);
        expect(transport.countOf('devices.list')).toBe(2);
        expect(transport.lastCall('devices.list')).toEqual(['HmIP-RF']);
        expect(transport.lastCall('links.list')).toBeUndefined();
    });

    it('awaits an asynchronous handler', async () => {
        const transport = new MockTransport();
        transport.respond('names.get', async () => Promise.resolve(DEMO_NAMES));
        await expect(transport.request('names.get')).resolves.toEqual(DEMO_NAMES);
    });

    it('rejects with an ApiError when no handler is registered', async () => {
        const transport = new MockTransport();
        await expect(transport.request('links.list', 'BidCos-RF')).rejects.toMatchObject({
            kind: 'internal',
            message: 'no mock handler for links.list',
        });
    });

    it('fails a method with a string or a full ApiError', async () => {
        const transport = new MockTransport();
        transport.fail('devices.list', 'boom');
        transport.fail('links.list', {message: 'fault', kind: 'rpc', faultCode: -5, faultString: 'unknown device'});

        await expect(transport.request('devices.list', 'BidCos-RF')).rejects.toBeInstanceOf(ApiRequestError);
        await expect(transport.request('links.list', 'BidCos-RF')).rejects.toMatchObject({
            kind: 'rpc',
            faultCode: -5,
            faultString: 'unknown device',
        });
    });

    it('replaces a handler when the same method is registered twice', async () => {
        const transport = new MockTransport();
        transport.result('devices.installMode.get', 0);
        transport.result('devices.installMode.get', 42);
        await expect(transport.request('devices.installMode.get', 'BidCos-RF')).resolves.toBe(42);
    });

    it('emits events to every subscriber until it unsubscribes', () => {
        const transport = new MockTransport();
        const first = vi.fn();
        const second = vi.fn();
        const off = transport.on('names.changed', first);
        transport.on('names.changed', second);

        transport.emit('names.changed', {'ABC:1': 'Test'});
        expect(transport.listenerCount('names.changed')).toBe(2);
        off();
        transport.emit('names.changed', {'ABC:1': 'Test 2'});
        transport.emit('rpc.event', {timestamp: 1, interfaceName: 'BidCos-RF', method: 'event'});

        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(2);
        expect(transport.listenerCount('names.changed')).toBe(1);
        expect(transport.listenerCount('devices.changed')).toBe(0);
    });

    it('survives an emit without subscribers', () => {
        expect(() => new MockTransport().emit('config.changed', {} as never)).not.toThrow();
    });

    it('resets the recorded calls but keeps the handlers', async () => {
        const transport = new MockTransport({demo: true});
        await transport.request('config.get');
        transport.reset();
        expect(transport.calls).toEqual([]);
        await expect(transport.request('config.get')).resolves.toMatchObject({version: '3.0.0-dev.0'});
    });

    describe('demo data', () => {
        const transport = new MockTransport({demo: true});

        it('lists the devices of a known interface and nothing for an unknown one', async () => {
            await expect(transport.request('devices.list', 'BidCos-RF')).resolves.toHaveLength(
                DEMO_DEVICES['BidCos-RF'].length,
            );
            await expect(transport.request('devices.list', 'CUxD')).resolves.toEqual([]);
        });

        it('filters the service messages by interface', async () => {
            await expect(transport.request('serviceMessages.list')).resolves.toEqual(DEMO_SERVICE_MESSAGES);
            await expect(transport.request('serviceMessages.list', 'HmIP-RF')).resolves.toEqual([]);
        });

        it('filters the recent events by interface', async () => {
            const all = await transport.request('events.recent');
            const hmip = await transport.request('events.recent', 'HmIP-RF');
            expect(all.length).toBeGreaterThan(hmip.length);
            expect(hmip.every((event) => event.interfaceName === 'HmIP-RF')).toBe(true);
        });

        it('merges renamed addresses into the name map', async () => {
            const names = await transport.request('names.set', [{address: 'MEQ0123456', name: 'Licht Flur'}]);
            expect(names['MEQ0123456']).toBe('Licht Flur');
            expect(names['GEQ0567890']).toBe(DEMO_NAMES['GEQ0567890']);
        });

        it('answers config.set with the connection it was given', async () => {
            const config = await transport.request('config.get');
            const updated = await transport.request('config.set', {...config.connection, host: 'ccu3'});
            expect(updated.connection.host).toBe('ccu3');
        });

        it('answers the remaining fixture methods', async () => {
            await expect(transport.request('interfaces.list')).resolves.toHaveLength(2);
            await expect(transport.request('interfaces.reconnect')).resolves.toBeNull();
            await expect(transport.request('rega.state')).resolves.toMatchObject({reachable: true});
            await expect(transport.request('config.discover')).resolves.toHaveLength(1);
            await expect(transport.request('config.clearCaches')).resolves.toBeNull();
            await expect(transport.request('links.list', 'BidCos-RF')).resolves.toHaveLength(2);
            await expect(transport.request('links.list', 'CUxD')).resolves.toEqual([]);
            await expect(transport.request('rssi.get', 'BidCos-RF')).resolves.toMatchObject({MEQ0123456: {}});
            await expect(transport.request('rssi.get', 'CUxD')).resolves.toEqual({});
            await expect(transport.request('bidcos.interfaces', 'BidCos-RF')).resolves.toHaveLength(1);
            await expect(transport.request('serviceMessages.ack', 'BidCos-RF', 'A:0', 'STICKY')).resolves.toBeNull();
            await expect(transport.request('events.clear')).resolves.toBeNull();
            await expect(transport.request('writeLog.list')).resolves.toHaveLength(2);
            await expect(transport.request('writeLog.clear')).resolves.toBeNull();
            await expect(transport.request('rpc.methods', 'BidCos-RF')).resolves.toHaveLength(4);
        });
    });
});
