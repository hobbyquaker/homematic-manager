import {readFileSync} from 'node:fs';

import {describe, expect, it} from 'vitest';

import type {ParamsetDescription} from './description.js';
import {
    CELSIUS,
    DOUBLE_ENCODED_CELSIUS,
    displayBounds,
    displayFactor,
    fromDisplayValue,
    isPercentUnit,
    MOJIBAKE_CELSIUS,
    PERCENT_UNIT,
    toDisplayValue,
    unitLabel,
} from './units.js';

const fixtures = JSON.parse(
    readFileSync(new URL('../../test/fixtures/paramset-descriptions.json', import.meta.url), 'utf8'),
) as Record<string, ParamsetDescription>;

const climate = fixtures['BidCos-RF/HM-CC-RT-DN/1.4/29/CLIMATECONTROL_RT_TRANSCEIVER/VALUES'] ?? {};

describe('unitLabel', () => {
    it('shows 100% as a plain percent sign', () => {
        expect(unitLabel({TYPE: 'FLOAT', OPERATIONS: 3, UNIT: PERCENT_UNIT})).toBe('%');
    });

    it('repairs the mis-decoded degree sign', () => {
        expect(unitLabel({TYPE: 'FLOAT', OPERATIONS: 3, UNIT: MOJIBAKE_CELSIUS})).toBe(CELSIUS);
        expect(unitLabel({TYPE: 'FLOAT', OPERATIONS: 3, UNIT: DOUBLE_ENCODED_CELSIUS})).toBe(CELSIUS);
    });

    it('repairs the degree sign of a real HM-CC-RT-DN description', () => {
        const temperature = climate['ACTUAL_TEMPERATURE'];
        expect(temperature?.UNIT).toBe(MOJIBAKE_CELSIUS);
        expect(unitLabel(temperature)).toBe('°C');
    });

    it('swallows the empty and the quoted-empty unit', () => {
        expect(unitLabel({TYPE: 'FLOAT', OPERATIONS: 3, UNIT: ''})).toBe('');
        expect(unitLabel({TYPE: 'FLOAT', OPERATIONS: 3, UNIT: '""'})).toBe('');
        expect(unitLabel({TYPE: 'FLOAT', OPERATIONS: 3})).toBe('');
        expect(unitLabel(undefined)).toBe('');
    });

    it('passes an ordinary unit through', () => {
        expect(unitLabel({TYPE: 'FLOAT', OPERATIONS: 3, UNIT: 's'})).toBe('s');
    });
});

describe('the 100% unit', () => {
    const percent = {TYPE: 'FLOAT', OPERATIONS: 3, UNIT: PERCENT_UNIT, MIN: 0, MAX: 1};
    const seconds = {TYPE: 'FLOAT', OPERATIONS: 3, UNIT: 's', MIN: 0, MAX: 10};

    it('is recognised', () => {
        expect(isPercentUnit(percent)).toBe(true);
        expect(isPercentUnit(seconds)).toBe(false);
        expect(isPercentUnit(undefined)).toBe(false);
    });

    it('scales by 100 in both directions', () => {
        expect(displayFactor(percent)).toBe(100);
        expect(displayFactor(seconds)).toBe(1);
        expect(toDisplayValue(0.5, percent)).toBe(50);
        expect(fromDisplayValue(50, percent)).toBe(0.5);
        expect(toDisplayValue(5, seconds)).toBe(5);
        expect(fromDisplayValue(5, seconds)).toBe(5);
    });

    it('does not leave floating point dirt behind', () => {
        expect(toDisplayValue(0.07, percent)).toBe(7);
        expect(fromDisplayValue(7, percent)).toBe(0.07);
    });

    it('passes a missing value through', () => {
        expect(toDisplayValue(undefined, percent)).toBeUndefined();
        expect(fromDisplayValue(undefined, percent)).toBeUndefined();
    });

    it('leaves a non-finite value alone rather than inventing one', () => {
        expect(toDisplayValue(Number.POSITIVE_INFINITY, percent)).toBe(Number.POSITIVE_INFINITY);
    });

    it('converts MIN and MAX for a spin box', () => {
        expect(displayBounds(percent)).toEqual({min: 0, max: 100});
        expect(displayBounds({TYPE: 'INTEGER', OPERATIONS: 3, MAX: 7})).toEqual({max: 7});
        expect(displayBounds({TYPE: 'STRING', OPERATIONS: 3})).toEqual({});
    });
});
