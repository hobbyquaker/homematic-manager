import type {DeviceDescription} from '@homematic-manager/core';
import {describe, expect, it} from 'vitest';

import {MockTransport} from '../transport/MockTransport.js';
import {
    isRouterCapable,
    maintenanceAddress,
    routerCount,
    routingEnabled,
    routingTableAddress,
} from '../util/routers.js';

import {DevicesStore} from './DevicesStore.svelte.js';
import {NoticesStore} from './NoticesStore.svelte.js';
import {RoutersStore} from './RoutersStore.svelte.js';

const BSM = '000A1B2C3D4E5F';
const PSM = '0001D709A1B2C3';

describe('the router helpers (task 97)', () => {
    it('takes ROUTER_MODULE_ENABLED for the capability, never ENABLE_ROUTING', () => {
        expect(isRouterCapable({ROUTER_MODULE_ENABLED: {TYPE: 'BOOL', OPERATIONS: 3, FLAGS: 1}})).toBe(true);
        // what a battery device or a BBL on an old firmware has: it may use a router, it is none
        expect(isRouterCapable({ENABLE_ROUTING: {TYPE: 'BOOL', OPERATIONS: 3, FLAGS: 1}})).toBe(false);
        expect(isRouterCapable(undefined)).toBe(false);
        expect(isRouterCapable({})).toBe(false);
    });

    it('reads the switch from the values, tolerant of how an interface sends a boolean', () => {
        expect(routingEnabled({ROUTER_MODULE_ENABLED: true})).toBe(true);
        expect(routingEnabled({ROUTER_MODULE_ENABLED: false})).toBe(false);
        expect(routingEnabled({ROUTER_MODULE_ENABLED: 1})).toBe(true);
        expect(routingEnabled({ROUTER_MODULE_ENABLED: '1'})).toBe(true);
        expect(routingEnabled({ROUTER_MODULE_ENABLED: 'true'})).toBe(true);
        expect(routingEnabled({ROUTER_MODULE_ENABLED: 0})).toBe(false);
        expect(routingEnabled({ENABLE_ROUTING: true})).toBeUndefined();
        expect(routingEnabled(undefined)).toBeUndefined();
    });

    it('finds the routing table where PARAMSETS lists it, on the device or its channel 0', () => {
        const device: DeviceDescription = {ADDRESS: 'A', TYPE: 'T', PARAMSETS: ['MASTER']};
        const channel: DeviceDescription = {
            ADDRESS: 'A:0',
            TYPE: 'MAINTENANCE',
            PARAMSETS: ['MASTER', 'ROUTING_TABLE'],
        };
        expect(routingTableAddress(device, channel)).toBe('A:0');
        expect(routingTableAddress({...device, PARAMSETS: ['MASTER', 'ROUTING_TABLE']}, channel)).toBe('A');
        // neither lists it: there is nothing to read, and asking anyway goes on air for nothing
        expect(routingTableAddress(device, {...channel, PARAMSETS: ['MASTER', 'VALUES']})).toBeUndefined();
        expect(routingTableAddress(device, undefined)).toBeUndefined();
        expect(maintenanceAddress('A')).toBe('A:0');
    });

    it('counts the routers that route among the capable ones', () => {
        expect(
            routerCount([
                {address: 'A', enabled: true},
                {address: 'B', enabled: false},
                {address: 'C', enabled: undefined},
            ]),
        ).toEqual({routing: 1, capable: 3});
        expect(routerCount([])).toEqual({routing: 0, capable: 0});
    });
});

function setup(): {transport: MockTransport; devices: DevicesStore; routers: RoutersStore; notices: NoticesStore} {
    const transport = new MockTransport({demo: true});
    const notices = new NoticesStore(transport);
    const devices = new DevicesStore(transport, notices);
    const routers = new RoutersStore(transport, notices, devices);
    return {transport, devices, routers, notices};
}

function masterReads(transport: MockTransport): string[] {
    return transport.calls
        .filter((call) => call.method === 'paramset.get' && call.params[2] === 'MASTER')
        .map((call) => String(call.params[1]));
}

describe('the routers store (task 97)', () => {
    it('reads the values of the capable devices only, and the description once per kind', async () => {
        const {transport, devices, routers} = setup();
        await devices.load('HmIP-RF');
        await routers.ensure('HmIP-RF');

        expect(routers.routers('HmIP-RF')).toEqual([
            {address: PSM, enabled: false},
            {address: BSM, enabled: true},
        ]);
        expect(routers.isRouting('HmIP-RF', BSM)).toBe(true);
        expect(routers.isRouting('HmIP-RF', PSM)).toBe(false);
        expect(routers.isRouting('HmIP-RF', '0001D8A9B7C6D5')).toBe(false);
        expect(routers.hasRead('HmIP-RF')).toBe(true);
        // the values: channel 0 of the two capable devices, nothing else
        expect(masterReads(transport).sort()).toEqual([`${PSM}:0`, `${BSM}:0`]);
        // the three smoke detectors are one kind: one description for them, not three
        const described = transport.calls
            .filter((call) => call.method === 'paramset.description')
            .map((call) => String(call.params[1]));
        expect(described.filter((address) => address.startsWith('0001D3C900000'))).toHaveLength(1);
        expect(described.every((address) => address.endsWith(':0'))).toBe(true);
    });

    it('asks nothing again on a second ensure, and only the capable devices again on load', async () => {
        const {transport, devices, routers} = setup();
        await devices.load('HmIP-RF');
        await routers.ensure('HmIP-RF');
        transport.reset();

        await routers.ensure('HmIP-RF');
        expect(transport.calls).toHaveLength(0);

        await routers.load('HmIP-RF');
        expect(masterReads(transport).sort()).toEqual([`${PSM}:0`, `${BSM}:0`]);
        // the kinds are known: no description is asked for again
        expect(transport.countOf('paramset.description')).toBe(0);
    });

    it('waits for a read in flight instead of starting a second one', async () => {
        const {transport, devices, routers} = setup();
        await devices.load('HmIP-RF');
        await Promise.all([routers.ensure('HmIP-RF'), routers.ensure('HmIP-RF')]);
        expect(masterReads(transport)).toHaveLength(2);
    });

    it('does nothing for an interface whose devices are not loaded', async () => {
        const {transport, routers} = setup();
        await routers.ensure('HmIP-RF');
        expect(transport.calls).toHaveLength(0);
        expect(routers.routers('HmIP-RF')).toEqual([]);
        expect(routers.hasRead('HmIP-RF')).toBe(false);
    });

    it('keeps a device whose values could not be read as capable with an unknown state, and says so once', async () => {
        const {transport, devices, routers, notices} = setup();
        await devices.load('HmIP-RF');
        transport.fail('paramset.get', 'timeout');
        await routers.ensure('HmIP-RF');
        expect(routers.routers('HmIP-RF')).toEqual([
            {address: PSM, enabled: undefined},
            {address: BSM, enabled: undefined},
        ]);
        expect(notices.items).toHaveLength(1);
        expect(notices.items[0]?.message).toContain('ROUTER_MODULE_ENABLED');
    });

    it('treats a refused description as not capable, without a notice, and asks again next time', async () => {
        const {transport, devices, routers, notices} = setup();
        await devices.load('HmIP-RF');
        transport.fail('paramset.description', 'refused');
        await routers.ensure('HmIP-RF');
        expect(routers.routers('HmIP-RF')).toEqual([]);
        expect(notices.items).toHaveLength(0);
    });

    it('writes exactly ROUTER_MODULE_ENABLED to channel 0 and keeps the new state', async () => {
        const {transport, devices, routers} = setup();
        await devices.load('HmIP-RF');
        await routers.ensure('HmIP-RF');

        expect(await routers.setRouting('HmIP-RF', PSM, true)).toBe(true);
        expect(transport.lastCall('paramset.put')).toEqual([
            'HmIP-RF',
            [`${PSM}:0`],
            'MASTER',
            {ROUTER_MODULE_ENABLED: true},
        ]);
        expect(routers.isRouting('HmIP-RF', PSM)).toBe(true);
        expect(routers.writing).toBe('');
    });

    it('reports a refused write and leaves the state as it was', async () => {
        const {transport, devices, routers, notices} = setup();
        await devices.load('HmIP-RF');
        await routers.ensure('HmIP-RF');
        transport.respond('paramset.put', (interfaceName, addresses, paramset, values) =>
            addresses.map((address) => ({
                interfaceName,
                address,
                paramset,
                sent: values,
                ok: false,
                problems: [],
                faultCode: -1,
                faultString: 'Failure',
            })),
        );
        expect(await routers.setRouting('HmIP-RF', BSM, false)).toBe(false);
        expect(routers.isRouting('HmIP-RF', BSM)).toBe(true);
        expect(notices.items.at(-1)?.message).toContain('Failure');

        transport.fail('paramset.put', 'connection lost');
        expect(await routers.setRouting('HmIP-RF', BSM, false)).toBe(false);
        expect(routers.isRouting('HmIP-RF', BSM)).toBe(true);
        expect(routers.writing).toBe('');
    });
});
