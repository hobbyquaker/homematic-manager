import {describe, expect, it} from 'vitest';

import {normaliseRssiInfo, normaliseRssiValue, RSSI_UNKNOWN, rssiClass, rssiColor, RssiStore} from './index.js';

describe('normaliseRssiValue', () => {
    it('keeps a real measurement', () => {
        expect(normaliseRssiValue(-60)).toBe(-60);
        expect(normaliseRssiValue(0)).toBe(0);
    });

    it('drops the "unknown" placeholder and anything that is not a finite number', () => {
        expect(normaliseRssiValue(RSSI_UNKNOWN)).toBeUndefined();
        expect(normaliseRssiValue(undefined)).toBeUndefined();
        expect(normaliseRssiValue('')).toBeUndefined();
        expect(normaliseRssiValue(Number.NaN)).toBeUndefined();
    });
});

describe('normaliseRssiInfo', () => {
    it('turns the rssiInfo answer into a matrix', () => {
        expect(
            normaliseRssiInfo({
                'BidCoS-RF': {MEQ0123456: [-58, -61]},
                MEQ0123456: {'BidCoS-RF': [-61, -58]},
            }),
        ).toEqual({
            'BidCoS-RF': {MEQ0123456: {rx: -58, tx: -61}},
            MEQ0123456: {'BidCoS-RF': {rx: -61, tx: -58}},
        });
    });

    it('drops the halves the interface does not know', () => {
        expect(normaliseRssiInfo({A: {B: [RSSI_UNKNOWN, -70]}})).toEqual({A: {B: {tx: -70}}});
        expect(normaliseRssiInfo({A: {B: [-70, RSSI_UNKNOWN]}})).toEqual({A: {B: {rx: -70}}});
        expect(normaliseRssiInfo({A: {B: []}})).toEqual({A: {B: {}}});
    });

    it('copes with an empty answer', () => {
        expect(normaliseRssiInfo({})).toEqual({});
        expect(normaliseRssiInfo({A: {}})).toEqual({A: {}});
    });
});

describe('rssiClass', () => {
    it('grades a signal', () => {
        expect(rssiClass(-10)).toBe('good');
        expect(rssiClass(-20)).toBe('good');
        expect(rssiClass(-60)).toBe('medium');
        expect(rssiClass(-100)).toBe('medium');
        expect(rssiClass(-101)).toBe('bad');
        expect(rssiClass(-130)).toBe('bad');
    });

    it('calls a missing value unknown', () => {
        expect(rssiClass(undefined)).toBe('unknown');
        expect(rssiClass(RSSI_UNKNOWN)).toBe('unknown');
    });
});

describe('rssiColor', () => {
    it('reproduces the 2.x gradient', () => {
        expect(rssiColor(-20)).toBe('#00ff00');
        expect(rssiColor(-100)).toBe('#ffff00');
        expect(rssiColor(-120)).toBe('#ff0000');
    });

    it('clamps both channels instead of producing nonsense', () => {
        expect(rssiColor(0)).toBe('#00ff00');
        expect(rssiColor(-200)).toBe('#ff0000');
    });

    it('has no colour for a value there is none for', () => {
        expect(rssiColor(undefined)).toBeUndefined();
        expect(rssiColor(RSSI_UNKNOWN)).toBeUndefined();
    });
});

describe('RssiStore with BidCos', () => {
    it('takes an rssiInfo answer and answers questions about it', () => {
        const store = new RssiStore();
        store.applyRssiInfo({'BidCoS-RF': {MEQ0123456: [-58, -61]}, MEQ0123456: {'BidCoS-RF': [-61, -58]}});
        expect(store.get('BidCoS-RF', 'MEQ0123456')).toEqual({rx: -58, tx: -61});
        expect(store.get('MEQ0123456', 'nope')).toBeUndefined();
        expect(store.get('nope', 'MEQ0123456')).toBeUndefined();
        expect(store.peersOf('MEQ0123456')).toEqual(['BidCoS-RF']);
        expect(store.peersOf('nope')).toEqual([]);
    });

    it('replaces the whole matrix on the next answer', () => {
        const store = new RssiStore();
        store.applyRssiInfo({A: {B: [-1, -2]}});
        store.applyRssiInfo({C: {D: [-3, -4]}});
        expect(Object.keys(store.toJSON())).toEqual(['C']);
    });

    it('hands out a copy', () => {
        const store = new RssiStore();
        store.applyRssiInfo({A: {B: [-1, -2]}});
        const copy = store.toJSON();
        delete copy['A'];
        expect(store.get('A', 'B')).toBeDefined();
    });
});

describe('RssiStore with HmIP', () => {
    const central = '3014F711A000000000000001';
    const device = '0001D3C99C1234';

    function store(): RssiStore {
        return new RssiStore({centralAddress: central});
    }

    it('files RSSI_DEVICE as what the access point receives from the device', () => {
        const rssi = store();
        expect(rssi.applyHmipValue(device, 'RSSI_DEVICE', -58)).toBe(true);
        expect(rssi.get(central, device)).toEqual({rx: -58});
        expect(rssi.get(device, central)).toEqual({tx: -58});
    });

    it('files RSSI_PEER the other way round', () => {
        const rssi = store();
        rssi.applyHmipValue(device, 'RSSI_PEER', -61);
        expect(rssi.get(device, central)).toEqual({rx: -61});
        expect(rssi.get(central, device)).toEqual({tx: -61});
    });

    it('completes both pairs when both values arrive', () => {
        const rssi = store();
        rssi.applyHmipValue(device, 'RSSI_DEVICE', -58);
        rssi.applyHmipValue(device, 'RSSI_PEER', -61);
        expect(rssi.get(central, device)).toEqual({rx: -58, tx: -61});
        expect(rssi.get(device, central)).toEqual({rx: -61, tx: -58});
    });

    it('ignores anything that is not an RSSI datapoint or not a usable value', () => {
        const rssi = store();
        expect(rssi.applyHmipValue(device, 'UNREACH', true)).toBe(false);
        expect(rssi.applyHmipValue(device, 'RSSI_DEVICE', RSSI_UNKNOWN)).toBe(false);
        expect(rssi.toJSON()).toEqual({});
    });

    it('drops values while the access point address is still unknown, and takes them afterwards', () => {
        const rssi = new RssiStore();
        expect(rssi.centralAddress).toBeUndefined();
        expect(rssi.applyHmipValue(device, 'RSSI_DEVICE', -58)).toBe(false);
        rssi.setCentralAddress(central);
        expect(rssi.centralAddress).toBe(central);
        expect(rssi.applyHmipValue(device, 'RSSI_DEVICE', -58)).toBe(true);
    });

    it('reads both values out of a maintenance paramset', () => {
        const rssi = store();
        expect(rssi.applyHmipParamset(device, {RSSI_DEVICE: -58, RSSI_PEER: -61, UNREACH: false})).toBe(true);
        expect(rssi.get(central, device)).toEqual({rx: -58, tx: -61});
    });

    it('reports no change for a maintenance paramset without usable RSSI values', () => {
        const rssi = store();
        expect(rssi.applyHmipParamset(device, {UNREACH: false})).toBe(false);
        expect(rssi.applyHmipParamset(device, {RSSI_DEVICE: RSSI_UNKNOWN})).toBe(false);
    });
});

describe('bestInterfaceFor (input for issue #69)', () => {
    const store = new RssiStore();
    store.applyRssiInfo({
        MEQ0123456: {'BidCoS-RF': [-80, -78], 'LEQ-LGW-01': [-60, -55], 'LEQ-LGW-02': [-90, RSSI_UNKNOWN]},
    });

    it('picks the interface that hears the device best', () => {
        expect(store.bestInterfaceFor('MEQ0123456', ['BidCoS-RF', 'LEQ-LGW-01', 'LEQ-LGW-02'])).toEqual({
            address: 'LEQ-LGW-01',
            rx: -60,
            tx: -55,
        });
    });

    it('keeps the best one whichever order the candidates come in', () => {
        expect(store.bestInterfaceFor('MEQ0123456', ['LEQ-LGW-01', 'BidCoS-RF'])?.address).toBe('LEQ-LGW-01');
        expect(store.bestInterfaceFor('MEQ0123456', ['BidCoS-RF', 'LEQ-LGW-01'])?.address).toBe('LEQ-LGW-01');
    });

    it('skips interfaces with no measurement at all', () => {
        expect(store.bestInterfaceFor('MEQ0123456', ['LEQ-LGW-02', 'BidCoS-RF'])?.address).toBe('BidCoS-RF');
    });

    it('has no answer for a device or a candidate list it knows nothing about', () => {
        expect(store.bestInterfaceFor('nope', ['BidCoS-RF'])).toBeUndefined();
        expect(store.bestInterfaceFor('MEQ0123456', [])).toBeUndefined();
        expect(store.bestInterfaceFor('MEQ0123456', ['LEQ-LGW-02'])).toBeUndefined();
    });
});
