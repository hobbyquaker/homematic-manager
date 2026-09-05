import {describe, expect, it} from 'vitest';

import * as core from './index.js';

describe('@homematic-manager/core', () => {
    it('exports its package name', () => {
        expect(core.PACKAGE).toBe('@homematic-manager/core');
    });

    it('exports the CCU model', () => {
        expect(core.INTERFACE_NAMES).toContain('HmIP-RF');
        expect(core.parseAddress('A:1').index).toBe(1);
        expect(new core.DeviceIndex('BidCos-RF').size).toBe(0);
        expect(core.decodeLinkFlags(0).broken).toBe(false);
    });

    it('exports the write path', () => {
        expect(core.castValue('1', {TYPE: 'INTEGER', OPERATIONS: 3})).toBe(1);
        expect(core.validateValue('P', 1, undefined)).toHaveLength(1);
        expect(core.diffParamset({}, {}, {}).values).toEqual({});
        expect(core.enumEncodingFor('HmIP-RF')).toBe('name');
        expect(core.MAX_BASE_FACTOR_SECONDS).toBe(111600);
        expect(core.unitLabel({TYPE: 'FLOAT', OPERATIONS: 3, UNIT: '100%'})).toBe('%');
    });

    it('exports the easy-mode engine and the data contract', () => {
        expect(new core.EasyModeEngine(new core.MemoryDataSource())).toBeInstanceOf(core.EasyModeEngine);
        expect(core.DATA_FILES.manifest).toBe('manifest.json');
        expect(core.UI_HINT).toBe('UI_HINT');
    });

    it('exports the state models', () => {
        expect(new core.ServiceMessageStore().size).toBe(0);
        expect(new core.RssiStore().centralAddress).toBeUndefined();
        expect(new core.RingBuffer(4).capacity).toBe(4);
        expect(core.RSSI_UNKNOWN).toBe(65536);
    });

    it('exports the texts and the RPC catalogue', () => {
        expect(core.createTranslator('de').t('Devices')).toBe('Geräte');
        expect(new core.TranslationLookup().channelType('SWITCH')).toBe('SWITCH');
        expect(core.RPC_METHOD_NAMES).toHaveLength(51);
    });
});
