import {readFileSync} from 'node:fs';

import {describe, expect, it} from 'vitest';

import type {ParameterDescription, ParamsetDescription} from './description.js';
import type {DurationPair} from './time.js';
import {
    decodeDuration,
    decodeTime,
    durationUnitIndex,
    encodeDuration,
    encodeTime,
    findDurationPairs,
    findTimePairs,
    isNotUsed,
    maxDurationSeconds,
    MAX_BASE_FACTOR_SECONDS,
    MAX_TIME_FACTOR,
    notUsedValue,
    readDurationPair,
    readTimePair,
    TIME_BASE_NAMES,
    TIME_BASES,
    timeBaseIndex,
    timeBaseSeconds,
    writeDurationPair,
    writeTimePair,
} from './time.js';

const fixtures = JSON.parse(
    readFileSync(new URL('../../test/fixtures/paramset-descriptions.json', import.meta.url), 'utf8'),
) as Record<string, ParamsetDescription>;

function param(description: ParamsetDescription, name: string): ParameterDescription {
    const found = description[name];
    if (!found) {
        throw new Error(`fixture has no parameter ${name}`);
    }
    return found;
}

const bidcosLink = fixtures['BidCos-RF/HM-LC-Sw1-Pl-CT-R1/2.5/8/SWITCH/LINK'] ?? {};
const wiredLink = fixtures['BidCos-Wired/HMW-LC-Dim1L-DR/3.03/11/DIMMER/LINK'] ?? {};
const hmipLink = fixtures['HmIP-RF/HmIP-PDT/1.4.8/2/DIMMER_VIRTUAL_RECEIVER/LINK'] ?? {};

describe('the time base table', () => {
    it('matches the VALUE_LIST a real HmIP description carries', () => {
        expect(param(hmipLink, 'SHORT_ON_TIME_BASE').VALUE_LIST).toEqual(TIME_BASE_NAMES);
    });

    it('has eight bases from a tenth of a second to an hour', () => {
        expect(TIME_BASES).toEqual([0.1, 1, 5, 10, 60, 300, 600, 3600]);
        expect(TIME_BASES).toHaveLength(TIME_BASE_NAMES.length);
    });

    it('has a maximum of BASE_1_H times 31', () => {
        expect(MAX_BASE_FACTOR_SECONDS).toBe(3600 * MAX_TIME_FACTOR);
    });
});

describe('timeBaseIndex', () => {
    it('accepts an index (BidCos) and a name (HmIP)', () => {
        expect(timeBaseIndex(0)).toBe(0);
        expect(timeBaseIndex(7)).toBe(7);
        expect(timeBaseIndex('BASE_1_H')).toBe(7);
        expect(timeBaseIndex('BASE_100_MS')).toBe(0);
    });

    it('rejects everything else', () => {
        expect(timeBaseIndex(8)).toBeUndefined();
        expect(timeBaseIndex(-1)).toBeUndefined();
        expect(timeBaseIndex(1.5)).toBeUndefined();
        expect(timeBaseIndex('BASE_2_H')).toBeUndefined();
        expect(timeBaseIndex(true)).toBeUndefined();
        expect(timeBaseIndex(undefined)).toBeUndefined();
    });

    it('translates a base into seconds', () => {
        expect(timeBaseSeconds('BASE_1_M')).toBe(60);
        expect(timeBaseSeconds(0)).toBe(0.1);
        expect(timeBaseSeconds('nope')).toBeUndefined();
    });
});

describe('decodeTime', () => {
    it('multiplies base and factor', () => {
        expect(decodeTime('BASE_1_S', 30)?.seconds).toBe(30);
        expect(decodeTime(4, 5)?.seconds).toBe(300);
        expect(decodeTime('BASE_100_MS', 3)?.seconds).toBe(0.3);
    });

    it('reports the maximum as infinite', () => {
        const decoded = decodeTime('BASE_1_H', 31);
        expect(decoded?.seconds).toBe(MAX_BASE_FACTOR_SECONDS);
        expect(decoded?.infinite).toBe(true);
        expect(decodeTime('BASE_1_H', 30)?.infinite).toBe(false);
        expect(decodeTime('BASE_10_M', 31)?.infinite).toBe(false);
    });

    it('carries base index, base and factor', () => {
        expect(decodeTime('BASE_5_S', 2)).toEqual({seconds: 10, baseIndex: 2, base: 5, factor: 2, infinite: false});
    });

    it('refuses a broken pair rather than inventing a duration', () => {
        expect(decodeTime('BASE_2_H', 1)).toBeUndefined();
        expect(decodeTime(undefined, 1)).toBeUndefined();
        expect(decodeTime('BASE_1_S', 32)).toBeUndefined();
        expect(decodeTime('BASE_1_S', -1)).toBeUndefined();
        expect(decodeTime('BASE_1_S', 1.5)).toBeUndefined();
        expect(decodeTime('BASE_1_S', '5')).toBeUndefined();
        expect(decodeTime('BASE_1_S', undefined)).toBeUndefined();
    });
});

describe('encodeTime', () => {
    it('picks the smallest base that hits the value exactly', () => {
        expect(encodeTime(0.3)).toMatchObject({baseIndex: 0, factor: 3, exact: true});
        expect(encodeTime(30)).toMatchObject({baseIndex: 1, factor: 30, exact: true});
        // 60 * 1 s would need factor 60, which does not fit, so the 5 s base wins
        expect(encodeTime(60)).toMatchObject({baseIndex: 2, factor: 12, exact: true});
    });

    it('uses a coarser base when the factor would not fit', () => {
        // 45 s is 45 * 1 s, but the factor stops at 31, so 5 s * 9 is the exact answer
        expect(encodeTime(45)).toMatchObject({base: 5, factor: 9, exact: true});
        expect(encodeTime(3600)).toMatchObject({base: 300, factor: 12, exact: true});
    });

    it('encodes the infinite value', () => {
        expect(encodeTime(MAX_BASE_FACTOR_SECONDS)).toMatchObject({
            baseIndex: 7,
            factor: 31,
            infinite: true,
            exact: true,
        });
    });

    it('encodes zero as factor zero', () => {
        expect(encodeTime(0)).toMatchObject({factor: 0, seconds: 0, exact: true});
    });

    it('reports an inexact result instead of pretending', () => {
        // 0.15 s sits between two steps of the finest base; the device gets 0.1 s
        const encoded = encodeTime(0.15);
        expect(encoded?.exact).toBe(false);
        expect(encoded?.seconds).toBe(0.1);
    });

    it('refuses what the encoding cannot hold', () => {
        expect(encodeTime(-1)).toBeUndefined();
        expect(encodeTime(Number.NaN)).toBeUndefined();
        expect(encodeTime(Number.POSITIVE_INFINITY)).toBeUndefined();
        expect(encodeTime(MAX_BASE_FACTOR_SECONDS + 1)).toBeUndefined();
    });

    it('round-trips through decodeTime', () => {
        for (const seconds of [0, 0.1, 1, 5, 31, 45, 300, 3600, 111600]) {
            const encoded = encodeTime(seconds);
            expect(encoded?.exact).toBe(true);
            expect(decodeTime(encoded?.baseIndex, encoded?.factor)?.seconds).toBe(seconds);
        }
    });
});

describe('time pairs in a description', () => {
    it('finds every base/factor pair of a real HmIP LINK paramset', () => {
        const pairs = findTimePairs(hmipLink);
        expect(pairs.map((pair) => pair.name).sort()).toEqual([
            'LONG_OFF',
            'LONG_OFFDELAY',
            'LONG_ON',
            'LONG_ONDELAY',
            'LONG_RAMPOFF',
            'LONG_RAMPON',
            'SHORT_OFF',
            'SHORT_OFFDELAY',
            'SHORT_ON',
            'SHORT_ONDELAY',
            'SHORT_RAMPOFF',
            'SHORT_RAMPON',
        ]);
        expect(pairs[0]?.baseParam.endsWith('_TIME_BASE')).toBe(true);
        expect(pairs[0]?.factorParam.endsWith('_TIME_FACTOR')).toBe(true);
    });

    it('finds none where the times are plain FLOAT seconds', () => {
        expect(findTimePairs(bidcosLink)).toEqual([]);
    });

    it('ignores a base without its factor', () => {
        expect(findTimePairs({ON_TIME_BASE: {TYPE: 'ENUM', OPERATIONS: 3}})).toEqual([]);
    });

    it('reads a pair out of a paramset', () => {
        const pair = {name: 'SHORT_ON', baseParam: 'SHORT_ON_TIME_BASE', factorParam: 'SHORT_ON_TIME_FACTOR'};
        expect(readTimePair({SHORT_ON_TIME_BASE: 'BASE_1_M', SHORT_ON_TIME_FACTOR: 2}, pair)?.seconds).toBe(120);
        expect(readTimePair({}, pair)).toBeUndefined();
    });

    it('writes a pair as base index and factor', () => {
        const pair = {name: 'SHORT_ON', baseParam: 'SHORT_ON_TIME_BASE', factorParam: 'SHORT_ON_TIME_FACTOR'};
        // 2 min is written as 24 * 5 s, the finest base that can express it
        expect(writeTimePair(120, pair)).toEqual({SHORT_ON_TIME_BASE: 2, SHORT_ON_TIME_FACTOR: 24});
        expect(writeTimePair(-1, pair)).toBeUndefined();
    });
});

describe('the "not used" value (issue #96)', () => {
    it('is 111600 s on BidCos-RF, where MAX is 108000', () => {
        const offTime = param(bidcosLink, 'LONG_OFF_TIME');
        expect(offTime.MAX).toBe(108000);
        expect(notUsedValue(offTime)).toBe(111600);
        expect(notUsedValue(offTime)).toBe(MAX_BASE_FACTOR_SECONDS);
        expect(isNotUsed(offTime, 111600)).toBe(true);
        expect(isNotUsed(offTime, 108000)).toBe(false);
    });

    it('is 16383000 s on BidCos-Wired, where MAX is 982980 - the WebUI is right there, not 2.x', () => {
        const offTime = param(wiredLink, 'LONG_OFF_TIME');
        expect(offTime.MAX).toBe(982980);
        expect(notUsedValue(offTime)).toBe(16383000);
        expect(isNotUsed(offTime, 111600)).toBe(false);
    });

    it('is the base/factor maximum on HmIP, where the description has no SPECIAL', () => {
        const base = param(hmipLink, 'LONG_OFF_TIME_BASE');
        const factor = param(hmipLink, 'LONG_OFF_TIME_FACTOR');
        expect(notUsedValue(base)).toBeUndefined();
        expect(decodeTime(base.DEFAULT, factor.DEFAULT)?.seconds).toBe(MAX_BASE_FACTOR_SECONDS);
        expect(decodeTime(base.DEFAULT, factor.DEFAULT)?.infinite).toBe(true);
    });

    it('has no not-used value where the parameter has no SPECIAL list at all', () => {
        expect(notUsedValue({TYPE: 'FLOAT', OPERATIONS: 3})).toBeUndefined();
        expect(notUsedValue(undefined)).toBeUndefined();
        expect(isNotUsed({TYPE: 'FLOAT', OPERATIONS: 3}, 111600)).toBe(false);
    });

    it('ignores a SPECIAL entry that is not NOT_USED', () => {
        const description = {TYPE: 'FLOAT', OPERATIONS: 3, SPECIAL: [{ID: 'INFINITE', VALUE: 1}]};
        expect(notUsedValue(description)).toBeUndefined();
    });
});

describe('duration pairs beyond *_TIME_BASE (task 10)', () => {
    const hmipMaster = fixtures['HmIP-RF/HmIPW-DRS8/1.2.4/1/SWITCH_VIRTUAL_RECEIVER/MASTER'] ?? {};

    /** The pair by its prefix, so the tests can stay free of non-null assertions. */
    function durationPair(description: ParamsetDescription, name: string): DurationPair {
        const found = findDurationPairs(description).find((pair) => pair.name === name);
        if (!found) {
            throw new Error(`description has no duration pair ${name}`);
        }
        return found;
    }

    it('finds the base/factor pairs of a real HmIP LINK description, with the same names', () => {
        const pairs = findDurationPairs(hmipLink);
        expect(pairs.every((pair) => pair.kind === 'base-factor')).toBe(true);
        expect(pairs.map((pair) => pair.name).sort()).toEqual(
            findTimePairs(hmipLink)
                .map((pair) => pair.name)
                .sort(),
        );
        const shortOn = durationPair(hmipLink, 'SHORT_ON');
        expect(shortOn.unitParam).toBe('SHORT_ON_TIME_BASE');
        expect(shortOn.countParam).toBe('SHORT_ON_TIME_FACTOR');
        expect(shortOn.maxCount).toBe(MAX_TIME_FACTOR);
        expect(shortOn.units.map((unit) => unit.name)).toEqual(TIME_BASE_NAMES);
        expect(shortOn.units.map((unit) => unit.seconds)).toEqual([...TIME_BASES]);
    });

    it('finds a base/factor pair that is not called *_TIME_BASE', () => {
        // SWITCHING_INTERVAL_BASE/_FACTOR on BidCos-RF and 01_WP_DURATION_BASE/_FACTOR inside an
        // HmIP week profile are the same eight steps under another prefix; findTimePairs, which
        // matches the `_TIME_BASE` suffix, sees neither.
        const description: ParamsetDescription = {
            SWITCHING_INTERVAL_BASE: {TYPE: 'INTEGER', OPERATIONS: 3, MIN: 0, MAX: 7},
            SWITCHING_INTERVAL_FACTOR: {TYPE: 'INTEGER', OPERATIONS: 3, MIN: 0, MAX: 31},
        };
        expect(findTimePairs(description)).toEqual([]);
        const pair = durationPair(description, 'SWITCHING_INTERVAL');
        expect(pair.kind).toBe('base-factor');
        // No VALUE_LIST: the BidCos shape, the eight fixed steps addressed by index.
        expect(pair.units.map((unit) => unit.seconds)).toEqual([...TIME_BASES]);
        expect(decodeDuration(4, 15, pair)?.seconds).toBe(900);
    });

    it('ignores a *_BASE whose VALUE_LIST is not the time base table', () => {
        const description: ParamsetDescription = {
            COLOR_BASE: {TYPE: 'ENUM', OPERATIONS: 3, VALUE_LIST: ['RED', 'GREEN']},
            COLOR_FACTOR: {TYPE: 'INTEGER', OPERATIONS: 3, MIN: 0, MAX: 31},
        };
        expect(findDurationPairs(description)).toEqual([]);
    });

    it('ignores a *_BASE without a factor next to it', () => {
        expect(findDurationPairs({ON_TIME_BASE: {TYPE: 'INTEGER', OPERATIONS: 3}})).toEqual([]);
    });

    it('falls back to 0..31 for a factor whose description carries no MAX', () => {
        const pair = durationPair(
            {
                ON_TIME_BASE: {TYPE: 'INTEGER', OPERATIONS: 3},
                ON_TIME_FACTOR: {TYPE: 'INTEGER', OPERATIONS: 3},
            },
            'ON',
        );
        expect(pair.maxCount).toBe(MAX_TIME_FACTOR);
    });

    it('finds the HmIP unit/value pairs of a real MASTER description', () => {
        expect(
            findDurationPairs(hmipMaster)
                .map((pair) => pair.name)
                .sort(),
        ).toEqual(['POWERUP_OFFDELAY', 'POWERUP_OFFTIME', 'POWERUP_ONDELAY', 'POWERUP_ONTIME']);
        const onDelay = durationPair(hmipMaster, 'POWERUP_ONDELAY');
        expect(onDelay.kind).toBe('unit-value');
        expect(onDelay.unitParam).toBe('POWERUP_ONDELAY_UNIT');
        expect(onDelay.countParam).toBe('POWERUP_ONDELAY_VALUE');
        expect(onDelay.maxCount).toBe(31);
        expect(onDelay.units).toEqual([
            {name: '100MS', seconds: 0.1},
            {name: '1S', seconds: 1},
            {name: '5S', seconds: 5},
            {name: '10S', seconds: 10},
            {name: '1M', seconds: 60},
            {name: '5M', seconds: 300},
            {name: '10M', seconds: 600},
            {name: 'H', seconds: 3600},
        ]);
    });

    it('leaves an enum that is not a duration alone - CELSIUS|FAHRENHEIT is a unit too', () => {
        const description: ParamsetDescription = {
            DISPLAY_TEMPERATUR_UNIT: {TYPE: 'ENUM', OPERATIONS: 3, VALUE_LIST: ['CELSIUS', 'FAHRENHEIT']},
            DISPLAY_TEMPERATUR_VALUE: {TYPE: 'INTEGER', OPERATIONS: 3, MIN: 0, MAX: 100},
        };
        expect(findDurationPairs(description)).toEqual([]);
    });

    it('needs both halves, a VALUE_LIST and a numeric MAX on the count', () => {
        const unit: ParameterDescription = {TYPE: 'ENUM', OPERATIONS: 3, VALUE_LIST: ['S', 'M']};
        expect(findDurationPairs({A_UNIT: unit})).toEqual([]);
        expect(
            findDurationPairs({A_UNIT: {TYPE: 'ENUM', OPERATIONS: 3}, A_VALUE: {TYPE: 'INTEGER', OPERATIONS: 3}}),
        ).toEqual([]);
        expect(findDurationPairs({A_UNIT: unit, A_VALUE: {TYPE: 'INTEGER', OPERATIONS: 3}})).toEqual([]);
        expect(
            findDurationPairs({
                A_UNIT: {TYPE: 'ENUM', OPERATIONS: 3, VALUE_LIST: []},
                A_VALUE: {TYPE: 'INTEGER', OPERATIONS: 3, MAX: 10},
            }),
        ).toEqual([]);
    });

    it('reads a unit/value pair by enum name and by index', () => {
        const pair = durationPair(hmipMaster, 'POWERUP_ONTIME');
        // HmIP answers getParamset with the index, the description carries the name; both work.
        expect(readDurationPair({POWERUP_ONTIME_UNIT: '1M', POWERUP_ONTIME_VALUE: 5}, pair)?.seconds).toBe(300);
        expect(readDurationPair({POWERUP_ONTIME_UNIT: 4, POWERUP_ONTIME_VALUE: 5}, pair)?.seconds).toBe(300);
        expect(durationUnitIndex('10M', pair)).toBe(6);
        expect(durationUnitIndex('NOPE', pair)).toBeUndefined();
        expect(durationUnitIndex(9, pair)).toBeUndefined();
        expect(durationUnitIndex(true, pair)).toBeUndefined();
    });

    it('reports a malformed half instead of inventing a duration', () => {
        const pair = durationPair(hmipMaster, 'POWERUP_ONTIME');
        expect(readDurationPair({POWERUP_ONTIME_UNIT: '1M'}, pair)).toBeUndefined();
        expect(readDurationPair({POWERUP_ONTIME_UNIT: '1M', POWERUP_ONTIME_VALUE: 32}, pair)).toBeUndefined();
        expect(readDurationPair({POWERUP_ONTIME_UNIT: '1M', POWERUP_ONTIME_VALUE: -1}, pair)).toBeUndefined();
        expect(readDurationPair({POWERUP_ONTIME_UNIT: '1M', POWERUP_ONTIME_VALUE: 1.5}, pair)).toBeUndefined();
        expect(readDurationPair({POWERUP_ONTIME_VALUE: 5}, pair)).toBeUndefined();
    });

    it('marks the pair maximum, which is what "for ever" means on the wire', () => {
        const pair = durationPair(hmipMaster, 'POWERUP_ONTIME');
        expect(readDurationPair({POWERUP_ONTIME_UNIT: 'H', POWERUP_ONTIME_VALUE: 31}, pair)?.maximal).toBe(true);
        expect(maxDurationSeconds(pair)).toBe(MAX_BASE_FACTOR_SECONDS);
        expect(maxDurationSeconds({...pair, units: []})).toBe(0);
    });

    it('encodes seconds into the finest unit whose count still fits', () => {
        const pair = durationPair(hmipMaster, 'POWERUP_ONTIME');
        expect(encodeDuration(300, pair)).toMatchObject({unitIndex: 3, count: 30, seconds: 300, exact: true});
        expect(writeDurationPair(300, pair)).toEqual({POWERUP_ONTIME_UNIT: 3, POWERUP_ONTIME_VALUE: 30});
    });

    it('says so when the pair cannot express the value exactly, and picks the closest', () => {
        const pair = durationPair(hmipMaster, 'POWERUP_ONTIME');
        const encoded = encodeDuration(7.05, pair);
        expect(encoded?.exact).toBe(false);
        expect(encoded?.seconds).toBe(7);
        // Above what the pair can hold it clamps to the maximum rather than refusing.
        expect(encodeDuration(999_999, pair)?.seconds).toBe(MAX_BASE_FACTOR_SECONDS);
    });

    it('refuses a nonsensical duration', () => {
        const pair = durationPair(hmipMaster, 'POWERUP_ONTIME');
        expect(encodeDuration(-1, pair)).toBeUndefined();
        expect(encodeDuration(Number.NaN, pair)).toBeUndefined();
        expect(writeDurationPair(-1, pair)).toBeUndefined();
        expect(encodeDuration(5, {...pair, units: []})).toBeUndefined();
    });

    it('reads a base/factor pair the same way, so one picker serves both encodings', () => {
        const pair = durationPair(hmipLink, 'SHORT_ON');
        expect(readDurationPair({SHORT_ON_TIME_BASE: 'BASE_1_M', SHORT_ON_TIME_FACTOR: 5}, pair)?.seconds).toBe(300);
        expect(writeDurationPair(300, pair)).toEqual({SHORT_ON_TIME_BASE: 3, SHORT_ON_TIME_FACTOR: 30});
    });
});
