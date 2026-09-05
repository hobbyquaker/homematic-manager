import {describe, expect, it} from 'vitest';

import type {DeviceDescription} from '@homematic-manager/core';

import {DeviceCache} from './devices.js';

const device = (address: string, overrides: Partial<DeviceDescription> = {}): DeviceDescription => ({
    ADDRESS: address,
    TYPE: 'HmIP-PDT',
    FIRMWARE: '1.4.8',
    VERSION: 1,
    CHILDREN: [`${address}:0`, `${address}:1`],
    ...overrides,
});

const channel = (device_: string, index: number, type = 'SWITCH_TRANSCEIVER'): DeviceDescription => ({
    ADDRESS: `${device_}:${String(index)}`,
    TYPE: type,
    PARENT: device_,
    PARENT_TYPE: 'HmIP-PDT',
    VERSION: 1,
});

function filled(): DeviceCache {
    const cache = new DeviceCache();
    cache.replace('HmIP-RF', [device('ABC1'), channel('ABC1', 0, 'MAINTENANCE'), channel('ABC1', 1)]);
    return cache;
}

describe('DeviceCache', () => {
    it('is empty until something is stored', () => {
        const cache = new DeviceCache();
        expect(cache.interfaces()).toEqual([]);
        expect(cache.has('HmIP-RF')).toBe(false);
        expect(cache.list('HmIP-RF')).toEqual([]);
        expect(cache.size('HmIP-RF')).toBe(0);
        expect(cache.get('HmIP-RF', 'ABC1')).toBeUndefined();
    });

    it('replaces everything an interface has', () => {
        const cache = filled();
        expect(cache.interfaces()).toEqual(['HmIP-RF']);
        expect(cache.size('HmIP-RF')).toBe(3);
        cache.replace('HmIP-RF', [device('DEF1')]);
        expect(cache.list('HmIP-RF').map((entry) => entry.ADDRESS)).toEqual(['DEF1']);
    });

    it('gives an index that knows parents and identities', () => {
        const cache = filled();
        const index = cache.index('HmIP-RF');
        expect(index.parentOf('ABC1:1')?.ADDRESS).toBe('ABC1');
        expect(index.paramsetIdentity('ABC1:1', 'MASTER')).toBe('HmIP-RF/HmIP-PDT/1.4.8/1/SWITCH_TRANSCEIVER/MASTER');
        // the same object as long as nothing changed
        expect(cache.index('HmIP-RF')).toBe(index);
    });

    it('rebuilds the index after a change', () => {
        const cache = filled();
        const before = cache.index('HmIP-RF');
        cache.add('HmIP-RF', [device('DEF1')]);
        expect(cache.index('HmIP-RF')).not.toBe(before);
        expect(cache.index('HmIP-RF').has('DEF1')).toBe(true);
    });

    it('adds new devices and reports what was touched', () => {
        const cache = new DeviceCache();
        expect(cache.add('BidCos-RF', [device('LEQ1'), channel('LEQ1', 1)])).toEqual(['LEQ1', 'LEQ1:1']);
        expect(cache.add('BidCos-RF', [])).toEqual([]);
        expect(cache.size('BidCos-RF')).toBe(2);
    });

    it('deletes a device with all of its channels', () => {
        const cache = filled();
        expect(cache.remove('HmIP-RF', ['ABC1']).sort()).toEqual(['ABC1', 'ABC1:0', 'ABC1:1']);
        expect(cache.size('HmIP-RF')).toBe(0);
    });

    it('deletes a single channel without its siblings', () => {
        const cache = filled();
        expect(cache.remove('HmIP-RF', ['ABC1:1'])).toEqual(['ABC1:1']);
        expect(cache.size('HmIP-RF')).toBe(2);
    });

    it('ignores a delete for an unknown interface or address', () => {
        const cache = filled();
        expect(cache.remove('BidCos-RF', ['LEQ1'])).toEqual([]);
        expect(cache.remove('HmIP-RF', ['NOPE'])).toEqual([]);
    });

    it('replaceDevice drops the old device and names the new one', () => {
        const cache = filled();
        expect(cache.replaceDevice('HmIP-RF', 'ABC1', 'DEF1').sort()).toEqual(['ABC1', 'ABC1:0', 'ABC1:1', 'DEF1']);
        expect(cache.has('HmIP-RF')).toBe(true);
        expect(cache.get('HmIP-RF', 'DEF1')).toBeUndefined();
    });

    it('clears one interface or all of them', () => {
        const cache = filled();
        cache.replace('BidCos-RF', [device('LEQ1')]);
        cache.clear('HmIP-RF');
        expect(cache.interfaces()).toEqual(['BidCos-RF']);
        cache.clear();
        expect(cache.interfaces()).toEqual([]);
    });

    it('round-trips through JSON', () => {
        const cache = filled();
        const snapshot = JSON.parse(JSON.stringify(cache.toJSON())) as unknown;
        const restored = new DeviceCache();
        restored.load(snapshot);
        expect(restored.list('HmIP-RF').map((entry) => entry.ADDRESS)).toEqual(['ABC1', 'ABC1:0', 'ABC1:1']);
        expect(restored.index('HmIP-RF').parentOf('ABC1:1')?.ADDRESS).toBe('ABC1');
    });

    it('survives a snapshot that is not one', () => {
        const cache = filled();
        cache.load('nonsense');
        expect(cache.interfaces()).toEqual([]);
        cache.load({'HmIP-RF': 'nope', 'BidCos-RF': {a: 1, b: {ADDRESS: 'LEQ1'}}});
        expect(cache.list('BidCos-RF').map((entry) => entry.ADDRESS)).toEqual(['LEQ1']);
    });
});
