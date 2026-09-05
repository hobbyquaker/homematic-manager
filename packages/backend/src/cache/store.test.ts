import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {CacheStore} from './store.js';

let dir: string;

beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-cache-'));
});

afterEach(async () => {
    await fs.rm(dir, {recursive: true, force: true});
});

const store = () => new CacheStore({cacheDir: dir, now: () => 1_700_000_000_000, writeDelayMs: 0});

describe('CacheStore', () => {
    it('keeps one RSSI matrix per interface', () => {
        const cache = store();
        const hmip = cache.rssi('HmIP-RF');
        expect(cache.rssi('HmIP-RF')).toBe(hmip);
        expect(cache.rssi('BidCos-RF')).not.toBe(hmip);
    });

    it('persists devices, descriptions and names and reads them back', async () => {
        const first = store();
        first.devices.replace('HmIP-RF', [{ADDRESS: 'ABC1', TYPE: 'HmIP-PDT', VERSION: 1}]);
        first.descriptions.set('HmIP-RF/HmIP-PDT/1.4.8/1//MASTER', {STATE: {TYPE: 'BOOL', OPERATIONS: 7}});
        first.names.set([{address: 'ABC1:1', name: 'Lamp'}]);
        first.saveDevices();
        first.saveDescriptions();
        first.saveNames();
        await first.flush();

        expect(await fs.readdir(dir)).toEqual(
            expect.arrayContaining(['devices.json', 'descriptions.json', 'names.json']),
        );

        const second = store();
        await second.load();
        expect(second.devices.list('HmIP-RF')).toHaveLength(1);
        expect(second.descriptions.size).toBe(1);
        expect(second.names.get('ABC1:1')).toBe('Lamp');
    });

    it('loads nothing when there is nothing', async () => {
        const cache = store();
        await cache.load();
        expect(cache.devices.interfaces()).toEqual([]);
        expect(cache.names.size).toBe(0);
    });

    it('reports service messages in the contract shape with the injected clock', () => {
        const cache = store();
        cache.serviceMessages.apply('HmIP-RF', 'ABC1:0', 'STICKY_UNREACH', true);
        cache.serviceMessages.apply('BidCos-RF', 'LEQ1:0', 'LOWBAT', true);
        expect(cache.listServiceMessages()).toEqual([
            {
                interfaceName: 'HmIP-RF',
                address: 'ABC1:0',
                datapoint: 'STICKY_UNREACH',
                value: true,
                since: 1_700_000_000_000,
            },
            {
                interfaceName: 'BidCos-RF',
                address: 'LEQ1:0',
                datapoint: 'LOWBAT',
                value: true,
                since: 1_700_000_000_000,
            },
        ]);
        expect(cache.listServiceMessages('BidCos-RF')).toHaveLength(1);
    });

    it('clears everything in memory and on disk', async () => {
        const cache = store();
        cache.devices.replace('HmIP-RF', [{ADDRESS: 'ABC1', TYPE: 'X'}]);
        cache.descriptions.set('a', {});
        cache.names.set([{address: 'A:1', name: 'x'}]);
        cache.rssi('HmIP-RF').setCentralAddress('XEQ1');
        cache.events.push({timestamp: 1, interfaceName: 'HmIP-RF', method: 'event'});
        cache.serviceMessages.apply('HmIP-RF', 'ABC1:0', 'STICKY_UNREACH', true);
        cache.saveDevices();
        cache.saveNames();
        cache.saveDescriptions();
        await cache.flush();

        await cache.clear();

        expect(cache.devices.interfaces()).toEqual([]);
        expect(cache.descriptions.size).toBe(0);
        expect(cache.names.size).toBe(0);
        expect(cache.events.size).toBe(0);
        expect(cache.listServiceMessages()).toEqual([]);
        expect(cache.rssi('HmIP-RF').centralAddress).toBeUndefined();
        await expect(fs.readdir(dir)).resolves.toEqual([]);
    });

    it('takes the default clock and buffer size', () => {
        const cache = new CacheStore({cacheDir: dir});
        cache.serviceMessages.apply('HmIP-RF', 'A:0', 'SABOTAGE', true);
        expect(cache.listServiceMessages()[0]?.since).toBeGreaterThan(1_600_000_000_000);
        expect(cache.events.capacity).toBe(8192);
    });
});
