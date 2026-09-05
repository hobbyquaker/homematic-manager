import {readFileSync} from 'node:fs';

import {describe, expect, it} from 'vitest';

import type {ParameterDescription, ParamsetDescription} from './description.js';
import {DEFAULT_MAX_STRING_LENGTH, validateParamset, validateValue} from './validate.js';

const fixtures = JSON.parse(
    readFileSync(new URL('../../test/fixtures/paramset-descriptions.json', import.meta.url), 'utf8'),
) as Record<string, ParamsetDescription>;

function param(key: string, name: string): ParameterDescription {
    const found = (fixtures[key] ?? {})[name];
    if (!found) {
        throw new Error(`fixture ${key} has no parameter ${name}`);
    }
    return found;
}

const codes = (problems: {code: string}[]): string[] => problems.map((problem) => problem.code);

const BOOL = {TYPE: 'BOOL', OPERATIONS: 3};
const INTEGER = {TYPE: 'INTEGER', OPERATIONS: 3, MIN: 0, MAX: 10};
const FLOAT = {TYPE: 'FLOAT', OPERATIONS: 3, MIN: 0, MAX: 10};
const STRING = {TYPE: 'STRING', OPERATIONS: 3};
const ENUM = {TYPE: 'ENUM', OPERATIONS: 3, MIN: 0, MAX: 2, VALUE_LIST: ['OFF', 'ON', 'AUTO']};
const READ_ONLY = {TYPE: 'INTEGER', OPERATIONS: 5};

describe('the two refusals that matter most', () => {
    it('refuses a parameter the description does not have (issue #98)', () => {
        const problems = validateValue('NOT_A_PARAM', 1, undefined);
        expect(codes(problems)).toEqual(['unknown-parameter']);
        expect(problems[0]?.message).toContain('NOT_A_PARAM');
    });

    it('refuses a parameter without the write bit', () => {
        expect(codes(validateValue('P', 1, READ_ONLY))).toEqual(['not-writable']);
    });

    it('accepts a read-only parameter when the caller says it is not writing', () => {
        expect(validateValue('P', 1, READ_ONLY, {requireWritable: false})).toEqual([]);
    });
});

describe('validateValue BOOL and ACTION', () => {
    it('accepts booleans only', () => {
        expect(validateValue('P', true, BOOL)).toEqual([]);
        expect(validateValue('P', false, {TYPE: 'ACTION', OPERATIONS: 2})).toEqual([]);
        expect(codes(validateValue('P', 1, BOOL))).toEqual(['wrong-type']);
        expect(codes(validateValue('P', 'true', BOOL))).toEqual(['wrong-type']);
    });
});

describe('validateValue INTEGER and FLOAT', () => {
    it('accepts values inside the bounds', () => {
        expect(validateValue('P', 5, INTEGER)).toEqual([]);
        expect(validateValue('P', 5.5, FLOAT)).toEqual([]);
        expect(validateValue('P', {explicitDouble: 5.5}, FLOAT)).toEqual([]);
    });

    it('refuses the bounds being missed', () => {
        expect(codes(validateValue('P', -1, INTEGER))).toEqual(['below-min']);
        expect(codes(validateValue('P', 11, INTEGER))).toEqual(['above-max']);
        expect(validateValue('P', 11, INTEGER)[0]?.limit).toBe(10);
    });

    it('refuses a non-number', () => {
        expect(codes(validateValue('P', '5', INTEGER))).toEqual(['wrong-type']);
        expect(codes(validateValue('P', true, FLOAT))).toEqual(['wrong-type']);
        // the CCU sends null for a value it has never seen; it must not become 0
        const problems = validateValue('P', null as unknown as number, INTEGER);
        expect(codes(problems)).toEqual(['wrong-type']);
        expect(problems[0]?.message).toContain('null');
    });

    it('refuses a fractional INTEGER but accepts a fractional FLOAT', () => {
        expect(codes(validateValue('P', 5.5, INTEGER))).toEqual(['wrong-type']);
        expect(validateValue('P', 5.5, FLOAT)).toEqual([]);
    });

    it('refuses NaN and Infinity, which XML-RPC cannot encode', () => {
        expect(codes(validateValue('P', Number.NaN, FLOAT))).toEqual(['not-finite']);
        expect(codes(validateValue('P', Number.POSITIVE_INFINITY, FLOAT))).toEqual(['not-finite']);
        expect(codes(validateValue('P', {explicitDouble: Number.NaN}, FLOAT))).toEqual(['not-finite']);
        expect(codes(validateValue('P', Number.NaN, INTEGER))).toEqual(['not-finite']);
    });

    it('accepts a value without bounds at all', () => {
        expect(validateValue('P', 1e9, {TYPE: 'FLOAT', OPERATIONS: 3})).toEqual([]);
    });

    it('accepts the SPECIAL value even though it is above MAX (issue #96)', () => {
        const offTime = param('BidCos-RF/HM-LC-Sw1-Pl-CT-R1/2.5/8/SWITCH/LINK', 'LONG_OFF_TIME');
        expect(offTime.MAX).toBe(108000);
        expect(validateValue('LONG_OFF_TIME', 111600, offTime)).toEqual([]);
        expect(codes(validateValue('LONG_OFF_TIME', 111599, offTime))).toEqual(['above-max']);
    });

    it('accepts the wired SPECIAL value on the wired device', () => {
        const offTime = param('BidCos-Wired/HMW-LC-Dim1L-DR/3.03/11/DIMMER/LINK', 'LONG_OFF_TIME');
        expect(offTime.MAX).toBe(982980);
        expect(validateValue('LONG_OFF_TIME', 16383000, offTime)).toEqual([]);
        // 111600 is the BidCos-RF "not used" value; on a wired device it is an ordinary duration
        expect(validateValue('LONG_OFF_TIME', 111600, offTime)).toEqual([]);
        expect(codes(validateValue('LONG_OFF_TIME', 16383001, offTime))).toEqual(['above-max']);
    });
});

describe('validateValue ENUM', () => {
    it('accepts a name from VALUE_LIST and an index inside it', () => {
        expect(validateValue('P', 'AUTO', ENUM)).toEqual([]);
        expect(validateValue('P', 2, ENUM)).toEqual([]);
    });

    it('refuses a name that is not in the list', () => {
        const problems = validateValue('P', 'NOPE', ENUM);
        expect(codes(problems)).toEqual(['not-in-value-list']);
        expect(problems[0]?.limit).toBe('OFF, ON, AUTO');
    });

    it('refuses an index outside the list', () => {
        expect(codes(validateValue('P', 9, ENUM))).toEqual(['not-in-value-list']);
        expect(codes(validateValue('P', -1, ENUM))).toEqual(['not-in-value-list']);
    });

    it('refuses a value that is neither a name nor a whole index', () => {
        expect(codes(validateValue('P', true, ENUM))).toEqual(['wrong-type']);
        expect(codes(validateValue('P', 1.5, ENUM))).toEqual(['wrong-type']);
    });

    it('refuses a name when there is no VALUE_LIST to check it against', () => {
        expect(codes(validateValue('P', 'AUTO', {TYPE: 'ENUM', OPERATIONS: 3}))).toEqual(['not-in-value-list']);
    });

    it('falls back to MIN/MAX for an ENUM without a VALUE_LIST', () => {
        const noList = {TYPE: 'ENUM', OPERATIONS: 3, MIN: 0, MAX: 2};
        expect(validateValue('P', 1, noList)).toEqual([]);
        expect(codes(validateValue('P', 3, noList))).toEqual(['above-max']);
    });

    it('honours the HmIP name bounds', () => {
        const base = param('HmIP-RF/HmIP-PDT/1.4.8/2/DIMMER_VIRTUAL_RECEIVER/LINK', 'SHORT_ON_TIME_BASE');
        expect(validateValue('SHORT_ON_TIME_BASE', 'BASE_1_H', base)).toEqual([]);
        expect(codes(validateValue('SHORT_ON_TIME_BASE', 'BASE_2_H', base))).toEqual(['not-in-value-list']);
    });
});

describe('validateValue STRING', () => {
    it('accepts a string of sane length', () => {
        expect(validateValue('P', 'abc', STRING)).toEqual([]);
        expect(validateValue('P', 'x'.repeat(DEFAULT_MAX_STRING_LENGTH), STRING)).toEqual([]);
    });

    it('refuses a longer one', () => {
        const problems = validateValue('P', 'x'.repeat(DEFAULT_MAX_STRING_LENGTH + 1), STRING);
        expect(codes(problems)).toEqual(['string-too-long']);
        expect(problems[0]?.limit).toBe(DEFAULT_MAX_STRING_LENGTH);
    });

    it('honours a caller-supplied limit', () => {
        expect(codes(validateValue('P', 'abcd', STRING, {maxStringLength: 3}))).toEqual(['string-too-long']);
    });

    it('refuses a non-string', () => {
        expect(codes(validateValue('P', 5, STRING))).toEqual(['wrong-type']);
    });
});

describe('validateValue with an undocumented type', () => {
    const weird = {TYPE: 'DOUBLE', OPERATIONS: 3};

    it('accepts any scalar', () => {
        expect(validateValue('P', 'x', weird)).toEqual([]);
        expect(validateValue('P', 1, weird)).toEqual([]);
        expect(validateValue('P', true, weird)).toEqual([]);
    });

    it('refuses a structure', () => {
        expect(codes(validateValue('P', {explicitDouble: 1}, {TYPE: 'DOUBLE', OPERATIONS: 3}))).toEqual([]);
        expect(codes(validateValue('P', {notADouble: 1} as unknown as number, weird))).toEqual(['wrong-type']);
    });
});

describe('validateParamset', () => {
    const description: ParamsetDescription = {
        A: INTEGER,
        B: STRING,
        C: READ_ONLY,
    };

    it('is empty for a clean set', () => {
        expect(validateParamset({A: 1, B: 'x'}, description)).toEqual([]);
    });

    it('collects every problem instead of stopping at the first', () => {
        const problems = validateParamset({A: 99, B: 5, C: 1, D: 1}, description);
        expect(problems.map((problem) => `${problem.param}:${problem.code}`)).toEqual([
            'A:above-max',
            'B:wrong-type',
            'C:not-writable',
            'D:unknown-parameter',
        ]);
    });

    it('does not complain about parameters that are simply not being written', () => {
        expect(validateParamset({}, description)).toEqual([]);
    });
});
