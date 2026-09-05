/**
 * Connecting to an hm-simulator over real sockets: xmlrpc and binrpc, TLS, basic auth, the
 * init/ping/re-init watchdog, the recovery after `dropConnection()`, the callbacks and the caches.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

import {simulatorAvailable, startBackend, startSimulator, waitFor} from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any -- hm-simulator ships no types */

const running: {close: () => unknown}[] = [];

afterEach(async () => {
    for (const item of running.splice(0)) {
        await item.close();
    }
});

async function bothRunning(options: Parameters<typeof startSimulator>[0] = {}): Promise<{
    sim: any;
    harness: Awaited<ReturnType<typeof startBackend>>;
}> {
    const sim = await startSimulator(options);
    running.push({close: () => sim.close()});
    const harness = await startBackend(sim);
    running.unshift({close: () => harness.close()});
    return {sim, harness};
}

describe.skipIf(!simulatorAvailable)('connecting to hm-simulator', () => {
    it('subscribes to the binrpc and the xmlrpc interface and fills the device cache', async () => {
        const {sim, harness} = await bothRunning();
        const states = await harness.backend.request('interfaces.list');
        expect(states.map((state) => [state.name, state.protocol, state.connected])).toEqual([
            ['BidCos-RF', 'binrpc', true],
            ['HmIP-RF', 'xmlrpc', true],
        ]);

        const bidcos = await harness.backend.request('devices.list', 'BidCos-RF');
        expect(bidcos.map((device) => device.ADDRESS)).toContain('LEQ0000001:1');
        const hmip = await harness.backend.request('devices.list', 'HmIP-RF');
        expect(hmip.map((device) => device.ADDRESS)).toContain('0001D3C99ABCDE:3');

        // the simulator recorded our init with the ident of the core's table
        expect(Object.keys(sim.clients.rfd ?? {}).length + Object.keys(sim.clients.hmip ?? {}).length).toBeGreaterThan(
            0,
        );
    });

    it('speaks binrpc to an interface that offers it', async () => {
        const sim = await startSimulator();
        running.push({close: () => sim.close()});
        const harness = await startBackend(sim, {connect: false, backend: {rpcTimeoutMs: 500}});
        running.unshift({close: () => harness.close()});
        await harness.backend.request('config.set', {
            host: '127.0.0.1',
            interfaces: ['CUxD'],
            autoDetect: false,
            rega: false,
            callback: {ip: '127.0.0.1', xmlrpcPort: 0, binrpcPort: 0},
            extraInterfaces: [],
        } as never);
        // CUxD is not started by the simulator, so this is the "interface is not there" path
        const states = await harness.backend.request('interfaces.list');
        expect(states[0]?.protocol).toBe('binrpc');
        expect(states[0]?.connected).toBe(false);
        expect(harness.notices.some((notice) => notice.level === 'error')).toBe(true);
    });

    it('connects through TLS with a self-signed certificate', async () => {
        const sim = await startSimulator({tls: true});
        running.push({close: () => sim.close()});
        // the remote view (D-28): TLS lives on lighttpd's ports, local mode would bypass it
        const harness = await startBackend(sim, {
            connection: {tls: true, local: false, interfaces: ['HmIP-RF'], rega: false},
        });
        running.unshift({close: () => harness.close()});
        const states = await harness.backend.request('interfaces.list');
        expect(states.every((state) => state.connected)).toBe(true);
        expect((await harness.backend.request('devices.list', 'HmIP-RF')).length).toBeGreaterThan(0);
    });

    it('connects with basic auth, and fails without it', async () => {
        const sim = await startSimulator({auth: {username: 'Admin', password: 's3cret'}});
        running.push({close: () => sim.close()});

        const wrong = await startBackend(sim, {
            connection: {interfaces: ['HmIP-RF'], rega: false, auth: {user: 'Admin', password: 'nope'}},
        });
        running.unshift({close: () => wrong.close()});
        expect((await wrong.backend.request('interfaces.list')).every((state) => state.connected)).toBe(false);

        const right = await startBackend(sim, {
            connection: {interfaces: ['HmIP-RF'], rega: false, auth: {user: 'Admin', password: 's3cret'}},
        });
        running.unshift({close: () => right.close()});
        expect((await right.backend.request('interfaces.list')).every((state) => state.connected)).toBe(true);
    });

    it('receives events and files service messages and RSSI from them', async () => {
        const {sim, harness} = await bothRunning();
        const events: unknown[] = [];
        harness.backend.on('rpc.event', (event) => events.push(event));

        sim.fireEvent('rfd', 'LEQ0000001:1', 'STATE', true);
        sim.fireEvent('hmip', '0001D3C99ABCDE:0', 'STICKY_UNREACH', true);
        sim.fireEvent('hmip', '0001D3C99ABCDE:0', 'RSSI_DEVICE', -55);
        await waitFor(() => events.length >= 3);

        const recent = await harness.backend.request('events.recent', 'BidCos-RF');
        expect(recent.some((entry) => entry.datapoint === 'STATE' && entry.value === true)).toBe(true);
        expect(await harness.backend.request('serviceMessages.list', 'HmIP-RF')).toEqual([
            expect.objectContaining({address: '0001D3C99ABCDE:0', datapoint: 'STICKY_UNREACH'}),
        ]);
        const matrix = await harness.backend.request('rssi.get', 'HmIP-RF');
        const central = Object.keys(matrix).find((address) => address in matrix && address.startsWith('XEQ'));
        expect(central).toBeDefined();
    });

    it('follows newDevices and deleteDevices callbacks', async () => {
        const {sim, harness} = await bothRunning();
        const changes: string[] = [];
        harness.backend.on('devices.changed', (change) => changes.push(change.kind));

        sim.addDevice(
            'rfd',
            {
                ADDRESS: 'LEQ0000002',
                TYPE: 'HM-LC-Sw1-Pl',
                VERSION: 1,
                FIRMWARE: '2.8',
                CHILDREN: ['LEQ0000002:1'],
                PARAMSETS: ['MASTER'],
            },
            {
                ADDRESS: 'LEQ0000002:1',
                TYPE: 'SWITCH',
                VERSION: 1,
                PARENT: 'LEQ0000002',
                PARENT_TYPE: 'HM-LC-Sw1-Pl',
                PARAMSETS: ['MASTER', 'VALUES'],
                INDEX: 1,
            },
        );
        await waitFor(() => changes.includes('new'));
        expect((await harness.backend.request('devices.list', 'BidCos-RF')).map((d) => d.ADDRESS)).toContain(
            'LEQ0000002',
        );

        sim.removeDevice('rfd', 'LEQ0000002');
        await waitFor(() => changes.includes('deleted'));
        expect((await harness.backend.request('devices.list', 'BidCos-RF')).map((d) => d.ADDRESS)).not.toContain(
            'LEQ0000002',
        );
    });

    it('re-inits after a dropped connection and is usable again', async () => {
        const {sim, harness} = await bothRunning();
        await sim.dropConnection('hmip');

        // the interface process restarted: the subscription is gone until the watchdog re-inits.
        //  is that step, done by hand so the test does not wait 15 s.
        let connected = false;
        await waitFor(async () => {
            await harness.backend.request('interfaces.reconnect', 'HmIP-RF');
            const states = await harness.backend.request('interfaces.list');
            connected = states.find((state) => state.name === 'HmIP-RF')?.connected === true;
            return connected;
        });
        expect(connected).toBe(true);
        expect((await harness.backend.request('devices.list', 'HmIP-RF', {refresh: true})).length).toBeGreaterThan(0);
    });

    it('answers listDevices from the cache and survives the HmIP delete/add cycle of a re-init', async () => {
        const {harness} = await bothRunning();
        const before = await harness.backend.request('devices.list', 'HmIP-RF');
        expect(before.length).toBeGreaterThan(0);

        // hmipserver asks its logic layer for listDevices on every init and then re-sends every
        // HmIP device - it deletes them first (eq-3/occu#45), which is what the cache has to
        // survive. This is the same sequence the "sticky unreach on first connect" report of #98
        // describes, so it is worth having as a regression test.
        await harness.backend.request('interfaces.reconnect', 'HmIP-RF');
        await waitFor(async () => (await harness.backend.request('devices.list', 'HmIP-RF')).length === before.length);
        const after = await harness.backend.request('devices.list', 'HmIP-RF');
        expect(after.map((device) => device.ADDRESS)).toEqual(before.map((device) => device.ADDRESS));
    });

    it('reads the ReGa names and renames through the mock', async () => {
        const {sim, harness} = await bothRunning();
        const state = await harness.backend.request('rega.state');
        expect(state).toMatchObject({enabled: true, reachable: true});
        expect(await harness.backend.request('names.get')).toMatchObject({LEQ0000001: 'Steckdose'});

        await harness.backend.request('names.set', [{address: 'LEQ0000001', name: 'Kaffeemaschine'}]);
        await waitFor(() => (sim.regaSim.renames as unknown[]).length > 0);
        expect((sim.regaSim.renames as {id: number; name: string}[])[0]).toMatchObject({
            id: 1000,
            name: 'Kaffeemaschine',
        });
        expect(await harness.backend.request('names.get')).toMatchObject({LEQ0000001: 'Kaffeemaschine'});
    });

    it('degrades to the local names when there is no ReGa (D-2)', async () => {
        const sim = await startSimulator({rega: false});
        running.push({close: () => sim.close()});
        const harness = await startBackend(sim);
        running.unshift({close: () => harness.close()});
        const state = await harness.backend.request('rega.state');
        expect(state.enabled).toBe(true);
        expect(state.reachable).toBe(false);
        await harness.backend.request('names.set', [{address: 'LEQ0000001', name: 'Lokal'}]);
        expect(await harness.backend.request('names.get')).toMatchObject({LEQ0000001: 'Lokal'});
        expect((await harness.backend.request('interfaces.list')).every((entry) => entry.connected)).toBe(true);
    });

    it('persists the caches per host and reads them back in the next session', async () => {
        const sim = await startSimulator();
        running.push({close: () => sim.close()});
        const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-persist-'));

        const first = await startBackend(sim, {dataDir});
        await first.backend.request('devices.list', 'HmIP-RF');
        await first.backend.request('paramset.description', 'HmIP-RF', '0001D3C99ABCDE:3', 'MASTER');
        await first.backend.request('names.set', [{address: 'LEQ0000001:1', name: 'Persisted'}]);
        await first.backend.stop();

        const cacheDir = path.join(dataDir, 'cache', '127.0.0.1');
        expect(await fs.readdir(cacheDir)).toEqual(
            expect.arrayContaining(['devices.json', 'descriptions.json', 'names.json']),
        );

        const second = await startBackend(sim, {dataDir, connect: false});
        running.unshift({close: () => second.close()});
        expect(await second.backend.request('names.get')).toMatchObject({'LEQ0000001:1': 'Persisted'});
        await fs.rm(dataDir, {recursive: true, force: true});
    });
});
