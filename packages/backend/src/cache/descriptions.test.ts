import {describe, expect, it} from 'vitest';

import type {DeviceDescription, ParamsetDescription} from '@homematic-manager/core';

import {ParamsetDescriptionCache} from './descriptions.js';

const description: ParamsetDescription = {
    STATE: {TYPE: 'BOOL', OPERATIONS: 7, FLAGS: 1, DEFAULT: false},
};

const device: DeviceDescription = {ADDRESS: 'ABC1', TYPE: 'HmIP-PDT', FIRMWARE: '1.4.8', VERSION: 1};
const channel: DeviceDescription = {
    ADDRESS: 'ABC1:1',
    TYPE: 'SWITCH_TRANSCEIVER',
    PARENT: 'ABC1',
    VERSION: 1,
};

describe('ParamsetDescriptionCache', () => {
    it('builds the identity of a device and of a channel', () => {
        const cache = new ParamsetDescriptionCache();
        expect(cache.identity('HmIP-RF', device, 'MASTER', undefined)).toBe('HmIP-RF/HmIP-PDT/1.4.8/1//MASTER');
        expect(cache.identity('HmIP-RF', channel, 'VALUES', device)).toBe(
            'HmIP-RF/HmIP-PDT/1.4.8/1/SWITCH_TRANSCEIVER/VALUES',
        );
    });

    it('has no identity for a channel whose device is missing', () => {
        const cache = new ParamsetDescriptionCache();
        expect(cache.identity('HmIP-RF', channel, 'VALUES', undefined)).toBeUndefined();
    });

    it('stores and reads a description', () => {
        const cache = new ParamsetDescriptionCache();
        const identity = cache.identity('HmIP-RF', device, 'MASTER', undefined);
        expect(cache.has(identity)).toBe(false);
        cache.set(identity, description);
        expect(cache.get(identity)).toBe(description);
        expect(cache.has(identity)).toBe(true);
        expect(cache.size).toBe(1);
    });

    it('never stores or reads under an undefined identity', () => {
        const cache = new ParamsetDescriptionCache();
        cache.set(undefined, description);
        expect(cache.size).toBe(0);
        expect(cache.get(undefined)).toBeUndefined();
        expect(cache.has(undefined)).toBe(false);
    });

    it('tracks whether anything has to be written', () => {
        const cache = new ParamsetDescriptionCache();
        expect(cache.dirty).toBe(false);
        cache.set('HmIP-RF/x///y/MASTER', description);
        expect(cache.dirty).toBe(true);
        cache.markClean();
        expect(cache.dirty).toBe(false);
    });

    it('clears one interface by the prefix of the identity', () => {
        const cache = new ParamsetDescriptionCache();
        cache.set('HmIP-RF/a/1/1//MASTER', description);
        cache.set('BidCos-RF/b/1/1//MASTER', description);
        cache.clear('HmIP-RF');
        expect(cache.size).toBe(1);
        expect(cache.has('BidCos-RF/b/1/1//MASTER')).toBe(true);
        cache.clear();
        expect(cache.size).toBe(0);
    });

    it('round-trips through JSON and survives a broken snapshot', () => {
        const cache = new ParamsetDescriptionCache();
        cache.set('HmIP-RF/a/1/1//MASTER', description);
        const restored = new ParamsetDescriptionCache();
        restored.load(JSON.parse(JSON.stringify(cache.toJSON())) as unknown);
        expect(restored.get('HmIP-RF/a/1/1//MASTER')).toEqual(description);
        expect(restored.dirty).toBe(false);
        restored.load('nonsense');
        expect(restored.size).toBe(0);
        restored.load({good: {STATE: {}}, bad: 'no'});
        expect(restored.size).toBe(1);
    });
});
