import {describe, expect, it} from 'vitest';

import {isExplicitDouble, sameValue, unwrapNumber} from './values.js';

describe('isExplicitDouble', () => {
    it('recognises the wrapper', () => {
        expect(isExplicitDouble({explicitDouble: 1.5})).toBe(true);
    });

    it('rejects everything else', () => {
        expect(isExplicitDouble(1.5)).toBe(false);
        expect(isExplicitDouble('1.5')).toBe(false);
        expect(isExplicitDouble(null)).toBe(false);
        expect(isExplicitDouble(undefined)).toBe(false);
        expect(isExplicitDouble({})).toBe(false);
        expect(isExplicitDouble({explicitDouble: '1.5'})).toBe(false);
    });
});

describe('unwrapNumber', () => {
    it('unwraps numbers and the wrapper', () => {
        expect(unwrapNumber(3)).toBe(3);
        expect(unwrapNumber({explicitDouble: 3.5})).toBe(3.5);
    });

    it('gives undefined for values that are not numbers', () => {
        expect(unwrapNumber('3')).toBeUndefined();
        expect(unwrapNumber(true)).toBeUndefined();
        expect(unwrapNumber(undefined)).toBeUndefined();
    });
});

describe('sameValue', () => {
    it('sees through the explicitDouble wrapper', () => {
        expect(sameValue({explicitDouble: 1}, 1)).toBe(true);
        expect(sameValue(1, {explicitDouble: 1})).toBe(true);
        expect(sameValue({explicitDouble: 1}, {explicitDouble: 1})).toBe(true);
        expect(sameValue({explicitDouble: 1}, {explicitDouble: 2})).toBe(false);
    });

    it('never equates a number with a string or a boolean', () => {
        expect(sameValue(1, '1')).toBe(false);
        expect(sameValue(1, true)).toBe(false);
        expect(sameValue(0, undefined)).toBe(false);
    });

    it('compares the remaining values strictly', () => {
        expect(sameValue('a', 'a')).toBe(true);
        expect(sameValue('a', 'b')).toBe(false);
        expect(sameValue(true, true)).toBe(true);
        expect(sameValue(undefined, undefined)).toBe(true);
    });
});
