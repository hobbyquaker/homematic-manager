import {hmipKeyToHex} from '@homematic-manager/core';
import {describe, expect, it} from 'vitest';

import {DEFAULT_INSTALL_SECONDS, installModeCalls, installSeconds, normaliseSgtin} from './installMode.js';

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

    it('sends the same KEY for the printed key and the QR code of one device (B-72)', () => {
        // a made-up key: its printed base-32 form and the 32 hex digits a QR code would hold
        const whitelist = (key: string): unknown =>
            installModeCalls(true, {hmipKeyMode: 'KEY', hmipKey: {sgtin: '3014F711A000000000001234', key}});
        const expected = [
            {
                method: 'setInstallModeWithWhitelist',
                params: [
                    true,
                    60,
                    [
                        {
                            ADDRESS: '3014F711A000000000001234',
                            KEY_MODE: 'LOCAL',
                            KEY: '3A7C51E0B94D26F81C05AE7392D4B61F',
                        },
                    ],
                ],
            },
        ];
        expect(whitelist('1TGJ8-Y1FAE-4UW1R-1EFFF-9E9EHZ')).toEqual(expected);
        expect(whitelist('3A7C51E0B94D26F81C05AE7392D4B61F')).toEqual(expected);
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

    /**
     * Task 28: pairing any HmIP device without its SGTIN. hmipserver's `setInstallMode` takes a
     * String as its third parameter, so the call has exactly two - the lab's hmipserver answered
     * `setInstallMode(true, 30)` with an empty value and `getInstallMode` with the seconds left.
     */
    it('arms HmIP for any device with exactly two arguments', () => {
        const calls = installModeCalls(true, {seconds: 30, hmipKeyMode: 'ANY'});
        expect(calls).toEqual([{method: 'setInstallMode', params: [true, 30]}]);
        expect(calls[0]?.params).toHaveLength(2);
    });

    it('never lets a leftover SGTIN, key, mode or serial become a third argument in ANY mode', () => {
        expect(
            installModeCalls(true, {
                hmipKeyMode: 'ANY',
                hmipKey: {sgtin: '3014F711A000000000001234', key: 'AAAAAAAAAAAA'},
                mode: 2,
                tempKey: 'K',
                address: 'LEQ0123456',
            }),
        ).toEqual([{method: 'setInstallMode', params: [true, DEFAULT_INSTALL_SECONDS]}]);
    });

    it('switches the install mode off in ANY mode as in every other', () => {
        expect(installModeCalls(false, {hmipKeyMode: 'ANY'})).toEqual([{method: 'setInstallMode', params: [false]}]);
    });

    /**
     * Task 28's second trap: hmipserver matches the whitelist as an exact string, and only
     * `setInstallModeWithWhitelist` upper-cases what it is given. A lower-case SGTIN must never
     * leave the backend lower-case, whichever key mode sent it.
     */
    it('upper-cases the SGTIN of both whitelist modes', () => {
        for (const hmipKeyMode of ['KEY', 'SGTIN'] as const) {
            const [call] = installModeCalls(true, {
                hmipKeyMode,
                hmipKey: {sgtin: '3014f711a000000000001234', key: 'aaaaaaaaaaaa'},
            });
            expect(call?.method).toBe('setInstallModeWithWhitelist');
            const [entry] = call?.params[2] as [Record<string, string>];
            expect(entry['ADDRESS']).toBe('3014F711A000000000001234');
        }
    });
});
