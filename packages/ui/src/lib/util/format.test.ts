import {describe, expect, it} from 'vitest';

import {formatDateTime, formatDuration, formatParams, formatRpcValue, formatTime} from './format.js';

describe('formatRpcValue', () => {
    it('keeps scalars as they are and turns structs into compact JSON', () => {
        expect(formatRpcValue('OFF')).toBe('OFF');
        expect(formatRpcValue(21.5)).toBe('21.5');
        expect(formatRpcValue(true)).toBe('true');
        expect(formatRpcValue(undefined)).toBe('');
        expect(formatRpcValue({LEVEL: 0.5})).toBe('{"LEVEL":0.5}');
        expect(formatRpcValue([1, 'a'])).toBe('[1,"a"]');
    });
});

describe('formatTime and formatDateTime', () => {
    const timestamp = Date.parse('2026-09-05T09:57:02Z');

    it('prints a 24-hour time and a date plus time', () => {
        expect(formatTime(timestamp, 'de-DE')).toMatch(/^\d{2}:\d{2}:\d{2}$/);
        expect(formatDateTime(timestamp, 'de-DE')).toMatch(/^\d.*\d{2}:\d{2}:\d{2}$/);
    });
});

describe('formatDuration', () => {
    it('switches from milliseconds to seconds at one second', () => {
        expect(formatDuration(0)).toBe('0 ms');
        expect(formatDuration(184.4)).toBe('184 ms');
        expect(formatDuration(999)).toBe('999 ms');
        expect(formatDuration(1000)).toBe('1.00 s');
        expect(formatDuration(1902)).toBe('1.90 s');
    });
});

describe('formatParams', () => {
    it('prints the parameter list the way the 2.x RPC dialog did', () => {
        expect(formatParams(['MEQ0123456:1', 'MASTER', {LOGGING: 1}])).toBe('MEQ0123456:1, MASTER, {"LOGGING":1}');
        expect(formatParams([])).toBe('');
        expect(formatParams([true, 60])).toBe('true, 60');
    });
});
