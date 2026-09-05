import {readFileSync} from 'node:fs';

import {describe, expect, it} from 'vitest';

import {
    decodeParameterFlags,
    enumIndex,
    enumList,
    enumName,
    isEvent,
    isKnownParameterType,
    isReadable,
    isSpecialValue,
    isWritable,
    numericBound,
    OPERATIONS,
    parameterOrder,
    PARAMETER_TYPES,
    PARAMSET_NAMES,
    specialValue,
    type ParameterDescription,
    type ParamsetDescription,
} from './description.js';

const fixtures = JSON.parse(
    readFileSync(new URL('../../test/fixtures/paramset-descriptions.json', import.meta.url), 'utf8'),
) as Record<string, ParamsetDescription>;

const bidcosSwitchLink = fixtures['BidCos-RF/HM-LC-Sw1-Pl-CT-R1/2.5/8/SWITCH/LINK'] ?? {};
const hmipDimmerLink = fixtures['HmIP-RF/HmIP-PDT/1.4.8/2/DIMMER_VIRTUAL_RECEIVER/LINK'] ?? {};

/** Reads a parameter out of a fixture; a missing one is a broken fixture, not a test failure. */
function param(description: ParamsetDescription, name: string): ParameterDescription {
    const found = description[name];
    if (!found) {
        throw new Error(`fixture has no parameter ${name}`);
    }
    return found;
}

describe('the parameter type list', () => {
    it('names the six types the CCU documents', () => {
        expect(PARAMETER_TYPES).toEqual(['BOOL', 'ACTION', 'INTEGER', 'FLOAT', 'ENUM', 'STRING']);
        expect(isKnownParameterType('FLOAT')).toBe(true);
        expect(isKnownParameterType('DOUBLE')).toBe(false);
    });

    it('names the four paramsets', () => {
        expect(PARAMSET_NAMES).toEqual(['MASTER', 'VALUES', 'LINK', 'SERVICE']);
    });
});

describe('OPERATIONS', () => {
    it('decodes the three bits', () => {
        const readOnly = {TYPE: 'INTEGER', OPERATIONS: OPERATIONS.READ};
        expect(isReadable(readOnly)).toBe(true);
        expect(isWritable(readOnly)).toBe(false);
        expect(isEvent(readOnly)).toBe(false);

        const readWriteEvent = {TYPE: 'INTEGER', OPERATIONS: 7};
        expect(isReadable(readWriteEvent)).toBe(true);
        expect(isWritable(readWriteEvent)).toBe(true);
        expect(isEvent(readWriteEvent)).toBe(true);
    });

    it('says no for a parameter with no operations at all', () => {
        const none = {TYPE: 'INTEGER', OPERATIONS: 0};
        expect(isReadable(none)).toBe(false);
        expect(isWritable(none)).toBe(false);
        expect(isEvent(none)).toBe(false);
    });
});

describe('decodeParameterFlags', () => {
    it('decodes the five documented bits', () => {
        expect(decodeParameterFlags(31)).toEqual({
            visible: true,
            internal: true,
            transform: true,
            service: true,
            sticky: true,
        });
    });

    it('is all false for zero and for a missing FLAGS', () => {
        expect(decodeParameterFlags(0).visible).toBe(false);
        expect(decodeParameterFlags(undefined)).toEqual({
            visible: false,
            internal: false,
            transform: false,
            service: false,
            sticky: false,
        });
    });
});

describe('enum access', () => {
    const description = {TYPE: 'ENUM', OPERATIONS: 3, VALUE_LIST: ['OFF', 'ON', 'AUTO']};

    it('reads VALUE_LIST', () => {
        expect(enumList(description)).toEqual(['OFF', 'ON', 'AUTO']);
    });

    it('has no list without a description or without VALUE_LIST', () => {
        expect(enumList(undefined)).toBeUndefined();
        expect(enumList({TYPE: 'ENUM', OPERATIONS: 3})).toBeUndefined();
    });

    it('maps names to indexes and back', () => {
        expect(enumIndex(description, 'AUTO')).toBe(2);
        expect(enumName(description, 0)).toBe('OFF');
    });

    it('reports an unknown name and an out-of-range index', () => {
        expect(enumIndex(description, 'NOPE')).toBeUndefined();
        expect(enumIndex({TYPE: 'ENUM', OPERATIONS: 3}, 'OFF')).toBeUndefined();
        expect(enumName(description, 9)).toBeUndefined();
    });
});

describe('numericBound', () => {
    it('passes numeric bounds through', () => {
        const factor = param(hmipDimmerLink, 'SHORT_ON_TIME_FACTOR');
        expect(numericBound(factor, 'MIN')).toBe(0);
        expect(numericBound(factor, 'MAX')).toBe(31);
    });

    it('resolves the HmIP enum name bounds through VALUE_LIST', () => {
        const base = param(hmipDimmerLink, 'SHORT_ON_TIME_BASE');
        expect(base.MIN).toBe('BASE_100_MS');
        expect(numericBound(base, 'MIN')).toBe(0);
        expect(numericBound(base, 'MAX')).toBe(7);
    });

    it('has no bound where there is none, and none for a string bound of a non-enum', () => {
        expect(numericBound({TYPE: 'INTEGER', OPERATIONS: 3}, 'MIN')).toBeUndefined();
        expect(numericBound({TYPE: 'STRING', OPERATIONS: 3, MIN: ''}, 'MIN')).toBeUndefined();
    });
});

describe('SPECIAL values', () => {
    it('finds the NOT_USED entry of a real BidCos-RF LINK parameter', () => {
        const offTime = param(bidcosSwitchLink, 'LONG_OFF_TIME');
        expect(offTime.MAX).toBe(108000);
        expect(specialValue(offTime, 111600)).toEqual({ID: 'NOT_USED', VALUE: 111600});
        expect(isSpecialValue(offTime, 111600)).toBe(true);
        expect(isSpecialValue(offTime, 60)).toBe(false);
    });

    it('has no special value without a SPECIAL list or for a non-number', () => {
        expect(specialValue({TYPE: 'FLOAT', OPERATIONS: 3}, 1)).toBeUndefined();
        expect(specialValue(param(bidcosSwitchLink, 'LONG_OFF_TIME'), 'NOT_USED')).toBeUndefined();
    });
});

describe('parameterOrder', () => {
    it('sorts by TAB_ORDER', () => {
        const description: ParamsetDescription = {
            B: {TYPE: 'INTEGER', OPERATIONS: 3, TAB_ORDER: 1},
            A: {TYPE: 'INTEGER', OPERATIONS: 3, TAB_ORDER: 2},
        };
        expect(parameterOrder(description)).toEqual(['B', 'A']);
    });

    it('puts parameters without a TAB_ORDER last and sorts equals alphabetically', () => {
        const description: ParamsetDescription = {
            Z: {TYPE: 'INTEGER', OPERATIONS: 3},
            B: {TYPE: 'INTEGER', OPERATIONS: 3, TAB_ORDER: 1},
            A: {TYPE: 'INTEGER', OPERATIONS: 3, TAB_ORDER: 1},
            Y: {TYPE: 'INTEGER', OPERATIONS: 3},
        };
        expect(parameterOrder(description)).toEqual(['A', 'B', 'Y', 'Z']);
    });

    it('sorts two equal-ranked parameters the same way whichever order they arrive in', () => {
        const rank: ParameterDescription = {TYPE: 'INTEGER', OPERATIONS: 3, TAB_ORDER: 1};
        expect(parameterOrder({A: rank, B: rank})).toEqual(['A', 'B']);
        expect(parameterOrder({B: rank, A: rank})).toEqual(['A', 'B']);
    });

    it('orders a real description without throwing', () => {
        expect(parameterOrder(bidcosSwitchLink)[0]).toBe('UI_HINT');
    });
});
