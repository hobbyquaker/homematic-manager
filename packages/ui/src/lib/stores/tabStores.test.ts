import {describe, expect, it} from 'vitest';

import {MockTransport} from '../transport/MockTransport.js';

import {ConsoleStore} from './ConsoleStore.svelte.js';
import {DevicesStore} from './DevicesStore.svelte.js';
import {LinksStore} from './LinksStore.svelte.js';
import {NoticesStore} from './NoticesStore.svelte.js';
import {ParamsetStore} from './ParamsetStore.svelte.js';
import {RadioStore} from './RadioStore.svelte.js';

/**
 * The stores the tabs of task 8 added, exercised directly - mostly on the paths a component test
 * cannot reach comfortably: the failure of every request, and the state that survives it.
 */

function setup(): {transport: MockTransport; notices: NoticesStore} {
    const transport = new MockTransport({demo: true});
    return {transport, notices: new NoticesStore(transport)};
}

describe('ParamsetStore', () => {
    it('caches a description and asks for it once', async () => {
        const {transport, notices} = setup();
        const store = new ParamsetStore(transport, notices);

        const first = await store.describe('BidCos-RF', 'MEQ0123456:1', 'MASTER');
        const second = await store.describe('BidCos-RF', 'MEQ0123456:1', 'MASTER');

        //  proxies the cached object, so identity is the cache key, not the reference.
        expect(first).toEqual(second);
        expect(transport.countOf('paramset.description')).toBe(1);
        expect(store.description('BidCos-RF', 'MEQ0123456:1', 'MASTER')).toEqual(first);
    });

    it('never caches the values - the diff must compare against what the device holds now', async () => {
        const {transport, notices} = setup();
        const store = new ParamsetStore(transport, notices);

        await store.read('BidCos-RF', 'MEQ0123456:1', 'MASTER');
        await store.read('BidCos-RF', 'MEQ0123456:1', 'MASTER');
        expect(transport.countOf('paramset.get')).toBe(2);
    });

    it('reports a failing description and answers undefined from open()', async () => {
        const {transport, notices} = setup();
        transport.fail('paramset.description', 'Unknown instance');
        const store = new ParamsetStore(transport, notices);

        expect(await store.open('BidCos-RF', 'X:1', 'MASTER')).toBeUndefined();
        expect(store.loading).toBe(false);
        expect(notices.items.at(-1)?.message).toContain('Unknown instance');
    });

    it('still opens when only the values fail - an empty paramset is a usable form', async () => {
        const {transport, notices} = setup();
        transport.fail('paramset.get', 'Generic error');
        const store = new ParamsetStore(transport, notices);

        const opened = await store.open('BidCos-RF', 'MEQ0123456:1', 'MASTER');
        expect(opened?.values).toEqual({});
        expect(Object.keys(opened?.description ?? {})).toContain('LOGGING');
    });

    it('reports a rejected write and empties the results', async () => {
        const {transport, notices} = setup();
        transport.fail('paramset.put', 'Invalid parameter or value');
        const store = new ParamsetStore(transport, notices);

        expect(await store.put('BidCos-RF', ['A:1'], 'MASTER', {LOGGING: 1})).toEqual([]);
        expect(store.results).toEqual([]);
        expect(store.writing).toBe(false);
        expect(notices.items.at(-1)?.message).toContain('Invalid parameter');
    });

    it('reports a rejected link write', async () => {
        const {transport, notices} = setup();
        transport.fail('paramset.putLink', 'Unknown paramset');
        const store = new ParamsetStore(transport, notices);

        expect(await store.putLink('BidCos-RF', [{sender: 'A:1', receiver: 'B:1'}], {})).toEqual([]);
        expect(notices.items.at(-1)?.message).toContain('Unknown paramset');
    });

    it('reports a failing setValue and getValue', async () => {
        const {transport, notices} = setup();
        transport.fail('value.set', 'read only').fail('value.get', 'Unknown parameter');
        const store = new ParamsetStore(transport, notices);

        expect(await store.setValue('BidCos-RF', 'A:1', 'STATE', true)).toBe(false);
        expect(await store.getValue('BidCos-RF', 'A:1', 'STATE')).toBeUndefined();
        expect(notices.items).toHaveLength(2);
    });

    it('reads a value and clears the results', async () => {
        const {transport, notices} = setup();
        transport.result('value.get', 42);
        const store = new ParamsetStore(transport, notices);

        expect(await store.getValue('BidCos-RF', 'A:1', 'LEVEL')).toBe(42);
        await store.put('BidCos-RF', ['MEQ0123456:1'], 'MASTER', {LOGGING: 0});
        expect(store.results).toHaveLength(1);
        store.clearResults();
        expect(store.results).toEqual([]);
    });
});

describe('DevicesStore actions', () => {
    it('reports every refused action and changes nothing', async () => {
        const {transport, notices} = setup();
        transport
            .fail('devices.delete', 'DontDelete')
            .fail('devices.replace', 'Failure')
            .fail('devices.replaceable', 'Failure')
            .fail('devices.restoreConfig', 'Generic error')
            .fail('devices.clearConfigCache', 'Generic error')
            .fail('devices.installMode.set', 'Failure')
            .fail('devices.installMode.get', 'Failure')
            .fail('devices.repairConfig', 'Failure')
            .fail('devices.installFirmware', 'Failure');
        const store = new DevicesStore(transport, notices);

        expect(await store.remove('BidCos-RF', 'A', 5)).toBe(false);
        expect(await store.replace('BidCos-RF', 'A', 'B')).toBe(false);
        expect(await store.replaceable('BidCos-RF', 'A')).toEqual([]);
        expect(await store.restoreConfig('BidCos-RF', 'A')).toBe(false);
        expect(await store.clearConfigCache('BidCos-RF', 'A')).toBe(false);
        expect(await store.setInstallMode('BidCos-RF', true)).toBe(false);
        expect(await store.installModeSeconds('BidCos-RF')).toBe(0);
        expect(await store.repairConfig('BidCos-RF', 'A')).toBeUndefined();
        expect(await store.installFirmware('BidCos-RF', 'A')).toBe(false);
        expect(store.firmwareBusy).toEqual([]);
        expect(notices.items.length).toBeGreaterThanOrEqual(9);
    });

    it('carries out the actions that succeed and reloads what changed', async () => {
        const {transport, notices} = setup();
        transport
            .result('devices.delete', null)
            .result('devices.replace', true)
            .result('devices.restoreConfig', null)
            .result('devices.clearConfigCache', null)
            .result('devices.installMode.set', null)
            .result('devices.installMode.get', 42);
        const store = new DevicesStore(transport, notices);

        expect(await store.remove('BidCos-RF', 'A', 5)).toBe(true);
        expect(await store.replace('BidCos-RF', 'A', 'B')).toBe(true);
        expect(await store.restoreConfig('BidCos-RF', 'A')).toBe(true);
        expect(await store.clearConfigCache('BidCos-RF', 'A')).toBe(true);
        expect(await store.setInstallMode('BidCos-RF', true, {seconds: 60})).toBe(true);
        expect(await store.installModeSeconds('BidCos-RF')).toBe(42);
        // delete and replace both re-read the device list
        expect(transport.countOf('devices.list')).toBe(2);
    });

    it('does nothing for an empty updateFirmware list', async () => {
        const {transport, notices} = setup();
        const store = new DevicesStore(transport, notices);
        expect(await store.updateFirmware('BidCos-RF', [])).toEqual([]);
        expect(transport.countOf('devices.updateFirmware')).toBe(0);
    });

    it('drops the busy mark once the device reports the available firmware', async () => {
        const {transport, notices} = setup();
        transport.result('devices.updateFirmware', [true]);
        const store = new DevicesStore(transport, notices);

        await store.load('BidCos-RF');
        await store.updateFirmware('BidCos-RF', ['KEQ0345678', 'LEQ0456789']);
        // LEQ0456789 has no AVAILABLE_FIRMWARE at all, so nothing is pending for it.
        expect(store.firmwareBusy).toEqual(['KEQ0345678']);
        expect(store.firmwarePending('BidCos-RF')).toBe(true);

        transport.respond('devices.list', () => [{ADDRESS: 'KEQ0345678', TYPE: 'HM-CC-RT-DN', FIRMWARE: '1.11'}]);
        await store.load('BidCos-RF', {refresh: true});
        expect(store.firmwareBusy).toEqual([]);
        expect(store.firmwarePending('BidCos-RF')).toBe(false);
    });

    it('settles nothing for an interface it has never loaded', () => {
        const {transport, notices} = setup();
        const store = new DevicesStore(transport, notices);
        store.settleFirmware('nope');
        expect(store.firmwareBusy).toEqual([]);
    });

    it('reports the VALUES description of a reportValueUsage target and stops on the first fault', async () => {
        const {transport, notices} = setup();
        transport.fail('paramset.description', 'Unknown instance');
        const store = new DevicesStore(transport, notices);

        expect(await store.reportValueUsage('BidCos-RF', ['A:1'], 1)).toBe(0);
        expect(notices.items.at(-1)?.message).toContain('Unknown instance');
    });
});

describe('LinksStore', () => {
    it('adds one link per combination and reloads once', async () => {
        const {transport, notices} = setup();
        transport.result('links.add', null);
        const store = new LinksStore(transport, notices);

        expect(await store.add('BidCos-RF', ['A:1', 'A:2'], ['B:1'])).toBe(2);
        expect(transport.countOf('links.add')).toBe(2);
        expect(transport.countOf('links.list')).toBe(1);
    });

    it('reports a refused addLink and does not reload when nothing was created', async () => {
        const {transport, notices} = setup();
        transport.fail('links.add', 'Failure');
        const store = new LinksStore(transport, notices);

        expect(await store.add('BidCos-RF', ['A:1'], ['B:1'])).toBe(0);
        expect(transport.countOf('links.list')).toBe(0);
        expect(notices.items.at(-1)?.message).toContain('Failure');
    });

    it('reports a refused removeLink, setLinkInfo, getLinkInfo and activateLinkParamset', async () => {
        const {transport, notices} = setup();
        transport
            .fail('links.remove', 'Unknown instance')
            .fail('links.info.set', 'Failure')
            .fail('links.info.get', 'Failure')
            .fail('links.activate', 'Generic error');
        const store = new LinksStore(transport, notices);

        expect(await store.remove('BidCos-RF', [{sender: 'A:1', receiver: 'B:1'}])).toBe(0);
        expect(await store.setInfo('BidCos-RF', 'A:1', 'B:1', 'n', 'd')).toBe(false);
        expect(await store.info('BidCos-RF', 'A:1', 'B:1')).toBeUndefined();
        expect(await store.activate('BidCos-RF', 'B:1', 'A:1', true)).toBe(false);
        expect(notices.items).toHaveLength(4);
    });

    it('finds the defective links by their FLAGS (#79)', async () => {
        const {transport, notices} = setup();
        transport.respond('links.list', () => [
            {SENDER: 'A:1', RECEIVER: 'B:1', FLAGS: 2},
            {SENDER: 'A:2', RECEIVER: 'B:1', FLAGS: 0},
            {SENDER: 'A:3', RECEIVER: 'B:1'},
        ]);
        const store = new LinksStore(transport, notices);
        await store.load('BidCos-RF');

        expect(store.defective('BidCos-RF').map((link) => link.SENDER)).toEqual(['A:1']);
        expect(store.forAddress('BidCos-RF', 'B:1')).toHaveLength(3);
    });
});

describe('RadioStore', () => {
    it('reports a refused listBidcosInterfaces and rssiInfo but stays usable', async () => {
        const {transport, notices} = setup();
        transport.fail('bidcos.interfaces', 'Generic error').fail('rssi.get', 'unknown method name');
        const store = new RadioStore(transport, notices);

        await store.load('HmIP-RF');
        expect(store.gateways('HmIP-RF')).toEqual([]);
        expect(store.pair('HmIP-RF', 'A', 'B')).toBeUndefined();
        expect(store.peersOf('HmIP-RF', 'A')).toEqual([]);
        expect(store.bestGatewayFor('HmIP-RF', 'A')).toBeUndefined();
        expect(store.loading).toBe(false);
        expect(notices.items).toHaveLength(2);
    });

    it('does nothing without an interface name', async () => {
        const {transport, notices} = setup();
        const store = new RadioStore(transport, notices);
        await store.load('');
        expect(transport.countOf('bidcos.interfaces')).toBe(0);
    });

    it('ignores an event that is not an RSSI value', async () => {
        const {transport, notices} = setup();
        const store = new RadioStore(transport, notices);
        await store.load('BidCos-RF');

        transport.emit('rpc.event', {
            timestamp: 0,
            interfaceName: 'BidCos-RF',
            method: 'event',
            address: 'MEQ0123456:1',
            datapoint: 'STATE',
            value: true,
        });
        transport.emit('rpc.event', {timestamp: 0, interfaceName: 'BidCos-RF', method: 'listDevices'});
        transport.emit('rpc.event', {
            timestamp: 0,
            interfaceName: 'BidCos-RF',
            method: 'newDevices',
            address: 'A',
            datapoint: 'RSSI_DEVICE',
            value: [] as unknown as number,
        });

        expect(store.pair('BidCos-RF', 'MEQ0123456', 'BidCoS-RF')?.rx).toBe(-52);
        store.dispose();
    });

    it('reports a refused setBidcosInterface', async () => {
        const {transport, notices} = setup();
        transport.fail('bidcos.setInterface', 'Failure');
        const store = new RadioStore(transport, notices);

        expect(await store.setBidcosInterface('BidCos-RF', 'A', 'BidCoS-RF', false)).toBe(false);
        expect(notices.items.at(-1)?.message).toContain('Failure');
    });
});

describe('ConsoleStore', () => {
    it('loads the catalogue once per interface and reports a refusal', async () => {
        const {transport, notices} = setup();
        const store = new ConsoleStore(transport, notices);

        await store.load('BidCos-RF');
        await store.load('BidCos-RF');
        expect(transport.countOf('rpc.methods')).toBe(1);
        expect(store.method('BidCos-RF', 'listDevices')?.help).toContain('device descriptions');
        expect(store.of('nope')).toEqual([]);

        transport.fail('rpc.methods', 'unknown method name');
        await store.load('HmIP-RF');
        expect(notices.items.at(-1)?.message).toContain('unknown method name');
    });

    it('does not load a catalogue for no interface', async () => {
        const {transport, notices} = setup();
        const store = new ConsoleStore(transport, notices);
        await store.load('');
        expect(transport.countOf('rpc.methods')).toBe(0);
    });

    it('records a call, a fault and keeps the history bounded', async () => {
        const {transport, notices} = setup();
        const store = new ConsoleStore(transport, notices, {max: 2, now: () => 1000});

        const ok = await store.call('BidCos-RF', 'listDevices', []);
        expect(ok.ok).toBe(true);
        expect(ok.durationMs).toBe(0);

        transport.fail('rpc.call', {message: 'Unknown instance', kind: 'rpc', faultCode: -2});
        const failed = await store.call('BidCos-RF', 'getParamset', ['A:1', 'MASTER']);
        expect(failed.ok).toBe(false);
        expect(failed.faultCode).toBe(-2);
        // A console fault is an answer, not a notice.
        expect(notices.items).toEqual([]);

        await store.call('BidCos-RF', 'listDevices', []);
        expect(store.history).toHaveLength(2);
        expect(store.running).toBe(false);

        store.clear();
        expect(store.history).toEqual([]);
    });

    it('survives a rejection that is not an ApiError', async () => {
        const {transport, notices} = setup();
        transport.respond('rpc.call', () => {
            throw 'boom';
        });
        const store = new ConsoleStore(transport, notices);

        const failed = await store.call('BidCos-RF', 'listDevices', []);
        expect(failed.ok).toBe(false);
        expect(failed.error).toBe('boom');
    });
});
