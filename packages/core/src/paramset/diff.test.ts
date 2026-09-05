import {readFileSync} from 'node:fs';

import {describe, expect, it} from 'vitest';

import type {ParamsetDescription} from './description.js';
import {diffParamset} from './diff.js';

const fixtures = JSON.parse(
    readFileSync(new URL('../../test/fixtures/paramset-descriptions.json', import.meta.url), 'utf8'),
) as Record<string, ParamsetDescription>;

const switchMaster = fixtures['BidCos-RF/HM-LC-Sw1-Pl-CT-R1/2.5/8/SWITCH/MASTER'] ?? {};

const description: ParamsetDescription = {
    COUNT: {TYPE: 'INTEGER', OPERATIONS: 3, MIN: 0, MAX: 10},
    LEVEL: {TYPE: 'FLOAT', OPERATIONS: 3, MIN: 0, MAX: 1, UNIT: '100%'},
    MODE: {TYPE: 'ENUM', OPERATIONS: 3, MIN: 0, MAX: 2, VALUE_LIST: ['OFF', 'ON', 'AUTO']},
    NAME: {TYPE: 'STRING', OPERATIONS: 3},
    ACTIVE: {TYPE: 'BOOL', OPERATIONS: 3},
    SERIAL: {TYPE: 'STRING', OPERATIONS: 5},
};

const original = {COUNT: 1, LEVEL: 0.5, MODE: 1, NAME: 'a', ACTIVE: false, SERIAL: 'X'};

describe('diffParamset, the default: changed parameters only', () => {
    it('sends nothing when nothing changed', () => {
        const diff = diffParamset(original, {COUNT: 1, LEVEL: 0.5, MODE: 1, NAME: 'a', ACTIVE: false}, description);
        expect(diff.values).toEqual({});
        expect(diff.changed).toEqual([]);
        expect(diff.problems).toEqual([]);
        expect(diff.skipped.map((entry) => entry.reason)).toEqual([
            'unchanged',
            'unchanged',
            'unchanged',
            'unchanged',
            'unchanged',
        ]);
    });

    it('sends only what changed', () => {
        const diff = diffParamset(original, {COUNT: 2, LEVEL: 0.5, NAME: 'a'}, description);
        expect(diff.values).toEqual({COUNT: 2});
        expect(diff.changed).toEqual(['COUNT']);
        expect(diff.skipped).toEqual([
            {param: 'LEVEL', reason: 'unchanged'},
            {param: 'NAME', reason: 'unchanged'},
        ]);
    });

    it('sees through the string a form field delivers', () => {
        expect(diffParamset(original, {COUNT: '1'}, description).changed).toEqual([]);
        expect(diffParamset(original, {COUNT: '2'}, description).values).toEqual({COUNT: 2});
    });

    it('sees through the explicitDouble wrapper when comparing floats', () => {
        expect(diffParamset(original, {LEVEL: '0.5'}, description).changed).toEqual([]);
        expect(diffParamset(original, {LEVEL: '0.6'}, description).values).toEqual({LEVEL: {explicitDouble: 0.6}});
    });

    it('sees through the enum encoding: the name and the index are the same value', () => {
        expect(diffParamset(original, {MODE: 'ON'}, description).changed).toEqual([]);
        expect(diffParamset(original, {MODE: 'AUTO'}, description).values).toEqual({MODE: 2});
        expect(diffParamset(original, {MODE: 'AUTO'}, description, {enumAs: 'name'}).values).toEqual({MODE: 'AUTO'});
        expect(diffParamset(original, {MODE: 'ON'}, description, {enumAs: 'name'}).changed).toEqual([]);
    });

    it('treats a parameter the device never reported as changed', () => {
        const diff = diffParamset({}, {COUNT: 1}, description);
        expect(diff.values).toEqual({COUNT: 1});
    });
});

describe('diffParamset refusals', () => {
    it('never sends a parameter the description does not have', () => {
        const diff = diffParamset(original, {NOPE: 1}, description);
        expect(diff.values).toEqual({});
        expect(diff.skipped).toEqual([{param: 'NOPE', reason: 'unknown-parameter'}]);
        expect(diff.problems.map((problem) => problem.code)).toEqual(['unknown-parameter']);
    });

    it('never sends a read-only parameter, and says so when it was asked to', () => {
        const diff = diffParamset(original, {SERIAL: 'Y'}, description);
        expect(diff.values).toEqual({});
        expect(diff.skipped).toEqual([{param: 'SERIAL', reason: 'not-writable'}]);
        expect(diff.problems.map((problem) => problem.code)).toEqual(['not-writable']);
    });

    it('never sends an out-of-range value', () => {
        const diff = diffParamset(original, {COUNT: 99}, description);
        expect(diff.values).toEqual({});
        expect(diff.skipped).toEqual([{param: 'COUNT', reason: 'invalid'}]);
        expect(diff.problems.map((problem) => problem.code)).toEqual(['above-max']);
    });

    it('never sends an unparseable number as NaN', () => {
        const diff = diffParamset(original, {LEVEL: 'not a number'}, description);
        // the cast turns it into 0, which is a legal value here, so it is written as 0 and not NaN
        expect(diff.values).toEqual({LEVEL: {explicitDouble: 0}});
    });

    it('never sends an enum value that is not in VALUE_LIST', () => {
        const diff = diffParamset(original, {MODE: 'NOPE'}, description);
        expect(diff.values).toEqual({});
        expect(diff.problems.map((problem) => problem.code)).toEqual(['not-in-value-list']);
    });

    it('honours a caller-supplied string limit', () => {
        const diff = diffParamset(original, {NAME: 'abcd'}, description, {maxStringLength: 3});
        expect(diff.values).toEqual({});
        expect(diff.problems.map((problem) => problem.code)).toEqual(['string-too-long']);
    });

    it('collects several problems and still sends the parameters that are fine', () => {
        const diff = diffParamset(original, {COUNT: 99, NAME: 'b', NOPE: 1}, description);
        expect(diff.values).toEqual({NAME: 'b'});
        expect(diff.problems.map((problem) => problem.code)).toEqual(['above-max', 'unknown-parameter']);
    });
});

describe('diffParamset with writeAll', () => {
    it('sends every writable parameter of the description', () => {
        const diff = diffParamset(original, {COUNT: 2}, description, {writeAll: true});
        expect(diff.values).toEqual({
            COUNT: 2,
            LEVEL: {explicitDouble: 0.5},
            MODE: 1,
            NAME: 'a',
            ACTIVE: false,
        });
        expect(diff.changed).toEqual(['COUNT', 'LEVEL', 'MODE', 'NAME', 'ACTIVE']);
    });

    it('still leaves out the read-only parameter, and without complaining', () => {
        const diff = diffParamset(original, {}, description, {writeAll: true});
        expect(diff.values['SERIAL']).toBeUndefined();
        expect(diff.skipped).toEqual([{param: 'SERIAL', reason: 'not-writable'}]);
        expect(diff.problems).toEqual([]);
    });

    it('falls back to DEFAULT for a parameter the device never reported', () => {
        const diff = diffParamset({}, {}, {COUNT: {TYPE: 'INTEGER', OPERATIONS: 3, DEFAULT: 7}}, {writeAll: true});
        expect(diff.values).toEqual({COUNT: 7});
    });

    it('still refuses an unknown parameter that was passed in', () => {
        const diff = diffParamset(original, {NOPE: 1}, description, {writeAll: true});
        expect(diff.values['NOPE']).toBeUndefined();
        expect(diff.problems.map((problem) => problem.code)).toEqual(['unknown-parameter']);
    });
});

describe('diffParamset against a real description', () => {
    it('writes one changed MASTER parameter of a BidCos-RF switch', () => {
        const current = {
            TRANSMIT_TRY_MAX: 6,
            POWERUP_ACTION: 0,
            STATUSINFO_MINDELAY: 2,
            STATUSINFO_RANDOM: 1,
            AES_ACTIVE: false,
        };
        const diff = diffParamset(current, {...current, POWERUP_ACTION: 'POWERUP_ON'}, switchMaster);
        expect(diff.values).toEqual({POWERUP_ACTION: 1});
        expect(diff.problems).toEqual([]);
    });

    it('accepts the SPECIAL value of a real LINK parameter that is above MAX', () => {
        const link = fixtures['BidCos-RF/HM-LC-Sw1-Pl-CT-R1/2.5/8/SWITCH/LINK'] ?? {};
        const diff = diffParamset({LONG_OFF_TIME: 60}, {LONG_OFF_TIME: 111600}, link);
        expect(diff.values).toEqual({LONG_OFF_TIME: {explicitDouble: 111600}});
        expect(diff.problems).toEqual([]);
    });
});
