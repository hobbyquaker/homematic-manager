import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {CacheStore, UNREACH_WRITE_DELAY_MS} from './store.js';

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

        expect(await fs.readdir(dir)).toEqual(expect.arrayContaining(['devices.json', 'descriptions', 'names.json']));
        expect(await fs.readdir(path.join(dir, 'descriptions', 'hmip-rf'))).toEqual([
            expect.stringMatching(/^hmip-pdt\.[0-9a-f]{8}\.json$/),
        ]);

        const second = store();
        await second.load();
        expect(second.devices.list('HmIP-RF')).toHaveLength(1);
        expect(second.descriptions.size).toBe(1);
        expect(second.names.get('ABC1:1')).toBe('Lamp');
    });

    it('writes only the shard of the device type that gained a description', async () => {
        const first = store();
        first.descriptions.set('HmIP-RF/HmIP-PDT/1.4.8/1//MASTER', {A: {TYPE: 'BOOL', OPERATIONS: 7}});
        first.descriptions.set('BidCos-RF/HM-LC-Sw1-Pl/2.8/1//MASTER', {B: {TYPE: 'BOOL', OPERATIONS: 7}});
        first.saveDescriptions();
        await first.flush();
        const shard = async (iface: string): Promise<string> => {
            const [name] = await fs.readdir(path.join(dir, 'descriptions', iface));
            return path.join(dir, 'descriptions', iface, name ?? '');
        };
        const bidcos = await shard('bidcos-rf');
        const before = (await fs.stat(bidcos)).mtimeMs;

        const second = store();
        await second.load();
        expect(second.descriptions.size).toBe(2);
        second.descriptions.set('HmIP-RF/HmIP-PDT/1.4.8/1/SWITCH/VALUES', {C: {TYPE: 'BOOL', OPERATIONS: 5}});
        // the same description again: a device of a type already cached
        second.descriptions.set('BidCos-RF/HM-LC-Sw1-Pl/2.8/1//MASTER', {B: {TYPE: 'BOOL', OPERATIONS: 7}});
        await new Promise((resolve) => setTimeout(resolve, 20));
        second.saveDescriptions();
        await second.flush();

        expect((await fs.stat(bidcos)).mtimeMs).toBe(before);
        expect(Object.keys(JSON.parse(await fs.readFile(await shard('hmip-rf'), 'utf8')) as object)).toHaveLength(2);
    });

    it('keeps two device types that differ only in case in two files', async () => {
        const cache = store();
        cache.descriptions.set('HmIP-RF/HMIP-eTRV/1/1//MASTER', {A: {TYPE: 'BOOL', OPERATIONS: 7}});
        cache.descriptions.set('HmIP-RF/HmIP-eTRV/1/1//MASTER', {B: {TYPE: 'BOOL', OPERATIONS: 7}});
        cache.descriptions.set('HmIP-RF/odd type*?/1/1//MASTER', {C: {TYPE: 'BOOL', OPERATIONS: 7}});
        cache.saveDescriptions();
        await cache.flush();
        const names = await fs.readdir(path.join(dir, 'descriptions', 'hmip-rf'));
        expect(names).toHaveLength(3);
        expect(names.filter((name) => name.startsWith('hmip-etrv.'))).toHaveLength(2);
        expect(names.some((name) => name.startsWith('odd%20type%2a%3f.'))).toBe(true);
        const again = store();
        await again.load();
        expect(again.descriptions.size).toBe(3);
    });

    it('splits the single descriptions.json of 3.5 and older once and removes it', async () => {
        await fs.writeFile(
            path.join(dir, 'descriptions.json'),
            JSON.stringify({
                'HmIP-RF/HmIP-PDT/1.4.8/1//MASTER': {A: {TYPE: 'BOOL', OPERATIONS: 7}},
                'BidCos-RF/HM-LC-Sw1-Pl/2.8/1//MASTER': {B: {TYPE: 'BOOL', OPERATIONS: 7}},
            }),
        );
        const cache = store();
        await cache.load();
        expect(cache.descriptions.size).toBe(2);
        expect(cache.descriptions.dirty).toBe(false);
        expect(await fs.readdir(dir)).toEqual(['descriptions']);
        expect((await fs.readdir(path.join(dir, 'descriptions'))).sort()).toEqual(['bidcos-rf', 'hmip-rf']);
        const again = store();
        await again.load();
        expect(again.descriptions.size).toBe(2);
    });

    it('keeps the old file when the shards cannot be written, and reports it', async () => {
        await fs.writeFile(
            path.join(dir, 'descriptions.json'),
            JSON.stringify({'HmIP-RF/HmIP-PDT/1.4.8/1//MASTER': {A: {TYPE: 'BOOL', OPERATIONS: 7}}}),
        );
        // a file where the shard directory should be
        await fs.writeFile(path.join(dir, 'descriptions'), 'in the way');
        const errors: unknown[] = [];
        const cache = new CacheStore({cacheDir: dir, writeDelayMs: 0, onError: (error) => errors.push(error)});
        await cache.load();
        expect(cache.descriptions.size).toBe(1);
        expect(errors).toHaveLength(1);
        expect((await fs.readdir(dir)).sort()).toEqual(['descriptions', 'descriptions.json']);
    });

    it('removes a shard that lost all its descriptions', async () => {
        const cache = store();
        cache.descriptions.set('HmIP-RF/HmIP-PDT/1.4.8/1//MASTER', {A: {TYPE: 'BOOL', OPERATIONS: 7}});
        cache.descriptions.set('BidCos-RF/HM-LC-Sw1-Pl/2.8/1//MASTER', {B: {TYPE: 'BOOL', OPERATIONS: 7}});
        cache.saveDescriptions();
        await cache.flush();
        cache.descriptions.clear('HmIP-RF');
        cache.saveDescriptions();
        await cache.flush();
        await expect(fs.readdir(path.join(dir, 'descriptions', 'hmip-rf'))).resolves.toEqual([]);
        expect(await fs.readdir(path.join(dir, 'descriptions', 'bidcos-rf'))).toHaveLength(1);
    });

    it('does not write a device list that did not change', async () => {
        const cache = store();
        cache.devices.replace('HmIP-RF', [{ADDRESS: 'ABC1', TYPE: 'HmIP-PDT', VERSION: 1}]);
        cache.saveDevices();
        await cache.flush();
        const file = path.join(dir, 'devices.json');
        const before = (await fs.stat(file)).mtimeMs;
        await new Promise((resolve) => setTimeout(resolve, 20));
        const again = store();
        await again.load();
        again.devices.replace('HmIP-RF', [{ADDRESS: 'ABC1', TYPE: 'HmIP-PDT', VERSION: 1}]);
        again.saveDevices();
        await again.flush();
        expect((await fs.stat(file)).mtimeMs).toBe(before);
    });

    it('waits a minute with the unreach counters unless told otherwise', async () => {
        vi.useFakeTimers();
        try {
            const cache = new CacheStore({cacheDir: dir});
            cache.unreach.note('HmIP-RF', 'ABC1:0', 'UNREACH', true, 1);
            cache.saveUnreach();
            await vi.advanceTimersByTimeAsync(UNREACH_WRITE_DELAY_MS - 1000);
            await expect(fs.readdir(dir)).resolves.toEqual([]);
            await cache.flush();
            await expect(fs.readdir(dir)).resolves.toEqual(['unreach.json']);
        } finally {
            vi.useRealTimers();
        }
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
