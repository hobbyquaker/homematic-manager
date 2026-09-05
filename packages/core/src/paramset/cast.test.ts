import {readFileSync} from 'node:fs';

import {describe, expect, it} from 'vitest';

import {castValue, enumEncodingFor} from './cast.js';
import type {ParameterDescription, ParamsetDescription} from './description.js';

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

const BOOL = {TYPE: 'BOOL', OPERATIONS: 3};
const ACTION = {TYPE: 'ACTION', OPERATIONS: 2};
const INTEGER = {TYPE: 'INTEGER', OPERATIONS: 3, MIN: 0, MAX: 10};
const FLOAT = {TYPE: 'FLOAT', OPERATIONS: 3, MIN: 0, MAX: 10};
const STRING = {TYPE: 'STRING', OPERATIONS: 3};
const ENUM = {TYPE: 'ENUM', OPERATIONS: 3, MIN: 0, MAX: 2, VALUE_LIST: ['OFF', 'ON', 'AUTO']};

describe('enumEncodingFor', () => {
    // A-1 refuted in the lab on 2026-09-05: hmipserver and rfd both take the name and the index,
    // and both answer getParamset with the index - so the index is what a changed-only diff can
    // compare against. See docs/config-pending.md.
    it('wants the index on every interface', () => {
        expect(enumEncodingFor('HmIP-RF')).toBe('index');
        expect(enumEncodingFor('BidCos-RF')).toBe('index');
        expect(enumEncodingFor('BidCos-Wired')).toBe('index');
        expect(enumEncodingFor('CUxD')).toBe('index');
        expect(enumEncodingFor('my-own-rfd')).toBe('index');
    });
});

describe('castValue without a description', () => {
    it('stringifies numbers and passes the rest through', () => {
        expect(castValue(5)).toBe('5');
        expect(castValue('on')).toBe('on');
        expect(castValue(true)).toBe(true);
    });

    it('stringifies anything it cannot pass on', () => {
        expect(castValue(null)).toBe('null');
        expect(castValue(undefined)).toBe('undefined');
    });
});

describe('castValue BOOL and ACTION', () => {
    it('takes the string "false" as false', () => {
        expect(castValue('false', BOOL)).toBe(false);
        expect(castValue('false', ACTION)).toBe(false);
    });

    it('takes the string "0" and the number 0 as false', () => {
        expect(castValue('0', BOOL)).toBe(false);
        expect(castValue(0, BOOL)).toBe(false);
        expect(castValue('', BOOL)).toBe(false);
    });

    it('takes anything else present as true', () => {
        expect(castValue('true', BOOL)).toBe(true);
        expect(castValue('on', BOOL)).toBe(true);
        expect(castValue('1', BOOL)).toBe(true);
        expect(castValue(1, BOOL)).toBe(true);
        expect(castValue(true, BOOL)).toBe(true);
    });

    it('takes an absent value as false', () => {
        expect(castValue(undefined, BOOL)).toBe(false);
        expect(castValue(null, BOOL)).toBe(false);
    });

    it('casts a real BOOL parameter', () => {
        expect(castValue('false', param('BidCos-RF/HM-LC-Sw1-Pl-CT-R1/2.5/8/SWITCH/MASTER', 'AES_ACTIVE'))).toBe(false);
    });
});

describe('castValue FLOAT', () => {
    it('wraps the number so XML-RPC encodes a double', () => {
        expect(castValue('1.5', FLOAT)).toEqual({explicitDouble: 1.5});
        expect(castValue(2, FLOAT)).toEqual({explicitDouble: 2});
    });

    it('can hand out the plain number for comparisons', () => {
        expect(castValue('1.5', FLOAT, {explicitDouble: false})).toBe(1.5);
    });

    it('never produces NaN', () => {
        expect(castValue('', FLOAT)).toEqual({explicitDouble: 0});
        expect(castValue('abc', FLOAT)).toEqual({explicitDouble: 0});
        expect(castValue(undefined, FLOAT)).toEqual({explicitDouble: 0});
        expect(castValue(true, FLOAT)).toEqual({explicitDouble: 0});
    });

    it('never produces Infinity, which parseFloat happily returns', () => {
        expect(Number.parseFloat('1e999')).toBe(Number.POSITIVE_INFINITY);
        expect(castValue('1e999', FLOAT)).toEqual({explicitDouble: 0});
        expect(castValue(Number.POSITIVE_INFINITY, FLOAT)).toEqual({explicitDouble: 0});
    });

    it('clamps only when asked', () => {
        expect(castValue(99, FLOAT)).toEqual({explicitDouble: 99});
        expect(castValue(99, FLOAT, {clamp: true})).toEqual({explicitDouble: 10});
        expect(castValue(-5, FLOAT, {clamp: true})).toEqual({explicitDouble: 0});
        expect(castValue(5, FLOAT, {clamp: true})).toEqual({explicitDouble: 5});
    });

    it('does not clamp against a bound that is not a number', () => {
        const bounds = {TYPE: 'FLOAT', OPERATIONS: 3, MIN: 'LOW', MAX: 'HIGH'};
        expect(castValue(99, bounds, {clamp: true})).toEqual({explicitDouble: 99});
    });
});

describe('castValue INTEGER', () => {
    it('parses and truncates', () => {
        expect(castValue('7', INTEGER)).toBe(7);
        expect(castValue(7.9, INTEGER)).toBe(7);
        expect(castValue('7.9', INTEGER)).toBe(7);
    });

    it('turns booleans into 0 and 1', () => {
        expect(castValue(true, INTEGER)).toBe(1);
        expect(castValue(false, INTEGER)).toBe(0);
    });

    it('never produces NaN', () => {
        expect(castValue('abc', INTEGER)).toBe(0);
        expect(castValue(undefined, INTEGER)).toBe(0);
    });

    it('clamps when asked', () => {
        expect(castValue(99, INTEGER, {clamp: true})).toBe(10);
        expect(castValue(-1, INTEGER, {clamp: true})).toBe(0);
    });
});

describe('castValue STRING', () => {
    it('stringifies whatever it gets', () => {
        expect(castValue('abc', STRING)).toBe('abc');
        expect(castValue(5, STRING)).toBe('5');
        expect(castValue(true, STRING)).toBe('true');
    });
});

describe('castValue ENUM', () => {
    it('sends the index to BidCos', () => {
        expect(castValue('AUTO', ENUM, {enumAs: 'index'})).toBe(2);
        expect(castValue(2, ENUM, {enumAs: 'index'})).toBe(2);
        expect(castValue('2', ENUM, {enumAs: 'index'})).toBe(2);
    });

    it('defaults to the index', () => {
        expect(castValue('AUTO', ENUM)).toBe(2);
    });

    it('sends the name to HmIP, whichever form it is given', () => {
        expect(castValue(2, ENUM, {enumAs: 'name'})).toBe('AUTO');
        expect(castValue('2', ENUM, {enumAs: 'name'})).toBe('AUTO');
        expect(castValue('AUTO', ENUM, {enumAs: 'name'})).toBe('AUTO');
    });

    it('leaves a value the list does not have as it was, for validate to reject', () => {
        expect(castValue(9, ENUM, {enumAs: 'name'})).toBe('9');
        // never silently the first enum value, which `parseInt('NOPE') || 0` would produce
        expect(castValue('NOPE', ENUM, {enumAs: 'name'})).toBe('NOPE');
        expect(castValue('NOPE', ENUM, {enumAs: 'index'})).toBe('NOPE');
        expect(castValue(undefined, ENUM, {enumAs: 'index'})).toBe('undefined');
    });

    it('takes a boolean as an index, the way INTEGER does', () => {
        expect(castValue(true, ENUM, {enumAs: 'name'})).toBe('ON');
        expect(castValue(false, ENUM, {enumAs: 'index'})).toBe(0);
    });

    it('treats an ENUM without a VALUE_LIST as an integer', () => {
        const noList = {TYPE: 'ENUM', OPERATIONS: 3, MIN: 0, MAX: 2};
        expect(castValue('1', noList)).toBe(1);
        expect(castValue('1', noList, {enumAs: 'name'})).toBe(1);
    });

    it('clamps an enum index when asked', () => {
        expect(castValue(9, ENUM, {enumAs: 'index', clamp: true})).toBe(2);
    });

    it('casts a real HmIP time base both ways', () => {
        const base = param('HmIP-RF/HmIP-PDT/1.4.8/2/DIMMER_VIRTUAL_RECEIVER/LINK', 'SHORT_ON_TIME_BASE');
        expect(castValue(7, base, {enumAs: 'name'})).toBe('BASE_1_H');
        expect(castValue('BASE_1_H', base, {enumAs: 'index'})).toBe(7);
    });

    it('casts a real BidCos enum by index', () => {
        const action = param('BidCos-RF/HM-LC-Sw1-Pl-CT-R1/2.5/8/SWITCH/MASTER', 'POWERUP_ACTION');
        expect(castValue('POWERUP_ON', action)).toBe(1);
    });
});

describe('castValue with an undocumented type', () => {
    it('sends a string rather than risking an object on the wire', () => {
        expect(castValue(5, {TYPE: 'DOUBLE', OPERATIONS: 3})).toBe('5');
    });
});

/**
 * Task 19: the `setValue` bug. The paramset dialog cast a value before sending it, the backend cast
 * what arrived, and the `{explicitDouble}` wrapper of the first cast turned into `NaN` and then
 * into `0` in the second - every float was written as zero. The dialog no longer pre-casts, and a
 * second cast can no longer destroy a value either.
 */
describe('castValue is idempotent', () => {
    it('unwraps an already cast FLOAT instead of stringifying the wrapper', () => {
        expect(castValue(castValue('1.5', FLOAT), FLOAT)).toEqual({explicitDouble: 1.5});
        expect(castValue({explicitDouble: 0.5}, FLOAT, {explicitDouble: false})).toBe(0.5);
    });

    it('leaves the other types where the first cast put them', () => {
        expect(castValue(castValue('7', INTEGER), INTEGER)).toBe(7);
        expect(castValue(castValue('true', BOOL), BOOL)).toBe(true);
        expect(castValue(castValue('AUTO', ENUM), ENUM)).toBe(2);
        expect(castValue(castValue('abc', STRING), STRING)).toBe('abc');
    });

    it('takes the wrapper for the other types too, rather than [object Object]', () => {
        expect(castValue({explicitDouble: 3}, INTEGER)).toBe(3);
        expect(castValue({explicitDouble: 3}, STRING)).toBe('3');
        expect(castValue({explicitDouble: 1}, ENUM)).toBe(1);
        expect(castValue({explicitDouble: 1})).toBe('1');
    });
});
