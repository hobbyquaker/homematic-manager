import {describe, expect, it} from 'vitest';

import {
    DEFAULT_INSTALL_SECONDS,
    HMIP_KEY_CHARS,
    hmipKeyToHex,
    installModeCalls,
    installSeconds,
    normaliseSgtin,
} from './installMode.js';

describe('hmipKeyToHex', () => {
    it('keeps a key that is already 32 hex digits', () => {
        const hex = '0123456789ABCDEF0123456789ABCDEF';
        expect(hmipKeyToHex(hex)).toBe(hex);
        expect(hmipKeyToHex(hex.toLowerCase())).toBe(hex);
    });

    it('converts the printed base-32 key to 32 hex digits', () => {
        const converted = hmipKeyToHex('AAAAAAAAAAAAAAAAAAAAAAAAAA');
        expect(converted).toMatch(/^[0-9A-F]{32}$/);
        expect(hmipKeyToHex('0000000000000000000000000')).toBe('0'.repeat(32));
    });

    it('ignores the grouping dashes and the case', () => {
        expect(hmipKeyToHex('aaaa-aaaa-aaaa')).toBe(hmipKeyToHex('AAAAAAAAAAAA'));
    });

    it('skips a character the alphabet does not contain', () => {
        // D, I, O and V are not in eQ-3's alphabet; they must not shift the result
        expect(hmipKeyToHex('ADA')).toMatch(/^[0-9A-F]{32}$/);
        expect(HMIP_KEY_CHARS).not.toContain('D');
        expect(HMIP_KEY_CHARS).toHaveLength(32);
    });
});

describe('normaliseSgtin and installSeconds', () => {
    it('normalises an SGTIN', () => {
        expect(normaliseSgtin(' 3014-f711-a000-0000-0000-1234 ')).toBe('3014F711A00000000000 1234'.replace(' ', ''));
    });

    it('keeps the duration inside what the CCU accepts', () => {
        expect(installSeconds(undefined)).toBe(DEFAULT_INSTALL_SECONDS);
        expect(installSeconds(0)).toBe(DEFAULT_INSTALL_SECONDS);
        expect(installSeconds(Number.NaN)).toBe(DEFAULT_INSTALL_SECONDS);
        expect(installSeconds(30)).toBe(30);
        expect(installSeconds(30.4)).toBe(30);
        expect(installSeconds(9999)).toBe(300);
    });
});

describe('installModeCalls', () => {
    it('switches the install mode off', () => {
        expect(installModeCalls(false)).toEqual([{method: 'setInstallMode', params: [false]}]);
        expect(installModeCalls(false, {seconds: 60})).toEqual([{method: 'setInstallMode', params: [false]}]);
    });

    it('opens the plain install mode with a duration', () => {
        expect(installModeCalls(true, {seconds: 120})).toEqual([{method: 'setInstallMode', params: [true, 120]}]);
    });

    it('passes the BidCos mode through', () => {
        expect(installModeCalls(true, {seconds: 60, mode: 2})).toEqual([
            {method: 'setInstallMode', params: [true, 60, 2]},
        ]);
    });

    it('sets a temporary key first (#20)', () => {
        expect(installModeCalls(true, {seconds: 60, mode: 2, tempKey: 'ABC'})).toEqual([
            {method: 'setTempKey', params: ['ABC']},
            {method: 'setInstallMode', params: [true, 60, 2]},
        ]);
    });

    it('adds a device by its serial number instead of opening the mode', () => {
        expect(installModeCalls(true, {address: 'LEQ0123456'})).toEqual([
            {method: 'addDevice', params: ['LEQ0123456', 1]},
        ]);
        expect(installModeCalls(true, {address: 'LEQ0123456', mode: 2})).toEqual([
            {method: 'addDevice', params: ['LEQ0123456', 2]},
        ]);
    });

    it('uses the HmIP whitelist with the SGTIN and the converted key', () => {
        const [call] = installModeCalls(true, {
            seconds: 60,
            hmipKey: {sgtin: '3014-f711-a000-0000-0000-1234', key: 'AAAA-AAAA-AAAA'},
        });
        expect(call?.method).toBe('setInstallModeWithWhitelist');
        expect(call?.params[0]).toBe(true);
        expect(call?.params[1]).toBe(60);
        const [entry] = call?.params[2] as [Record<string, string>];
        expect(entry).toEqual({
            ADDRESS: '3014F711A000000000001234',
            KEY_MODE: 'LOCAL',
            KEY: hmipKeyToHex('AAAAAAAAAAAA'),
        });
    });

    it('sends the SGTIN alone when the key mode says so', () => {
        const [call] = installModeCalls(true, {
            hmipKeyMode: 'SGTIN',
            hmipKey: {sgtin: '3014F711A000000000001234', key: 'ignored'},
        });
        expect(call?.params[2]).toEqual([{ADDRESS: '3014F711A000000000001234'}]);
    });

    it('sends the SGTIN alone when there is no key', () => {
        const [call] = installModeCalls(true, {hmipKey: {sgtin: 'ABC', key: ''}});
        expect(call?.params[2]).toEqual([{ADDRESS: 'ABC'}]);
    });

    it('falls back to the plain mode for an empty SGTIN', () => {
        expect(installModeCalls(true, {hmipKey: {sgtin: '', key: 'x'}})).toEqual([
            {method: 'setInstallMode', params: [true, DEFAULT_INSTALL_SECONDS]},
        ]);
    });
});
