import {describe, expect, it} from 'vitest';

import {createTranslator} from '@homematic-manager/core';

import {CATALOGUE} from '../i18n/uiMessages.js';

import {LOCAL_NETWORK_HINT, looksLikeLocalNetworkBlock, testMayBeLocalNetworkBlock} from './localNetwork.js';

describe('the Local Network hint (B-91, #169)', () => {
    it('is in German and English, and names the setting', () => {
        expect(createTranslator('de', {catalogue: CATALOGUE}).t(LOCAL_NETWORK_HINT)).toBe(
            'macOS blockiert womöglich das lokale Netzwerk: Homematic Manager unter Systemeinstellungen → Datenschutz & Sicherheit → Lokales Netzwerk erlauben, dann die App beenden und neu starten',
        );
        expect(createTranslator('en', {catalogue: CATALOGUE}).t(LOCAL_NETWORK_HINT)).toBe(LOCAL_NETWORK_HINT);
        expect(LOCAL_NETWORK_HINT).toContain('System Settings → Privacy & Security → Local Network');
    });

    it.each([
        ['connect EHOSTUNREACH 192.168.131.9:42001', true],
        ['BidCos-RF: init failed: connect EHOSTDOWN 10.0.0.9:2001', true],
        ['connect ECONNREFUSED 192.168.131.9:2001', false],
        ['the request timed out', false],
        ['getaddrinfo ENOTFOUND ccu.local', false],
        ['NOEHOSTUNREACH', false],
    ])('on macOS, "%s" calls for the hint: %s', (message, expected) => {
        expect(looksLikeLocalNetworkBlock('darwin', message)).toBe(expected);
    });

    it.each(['linux', 'win32', undefined])('never on %s', (platform) => {
        expect(looksLikeLocalNetworkBlock(platform, 'connect EHOSTUNREACH 192.168.131.9:42001')).toBe(false);
        expect(testMayBeLocalNetworkBlock(platform, 'timeout')).toBe(false);
    });

    it('not without a message', () => {
        expect(looksLikeLocalNetworkBlock('darwin', undefined)).toBe(false);
    });

    it.each([
        // occulite-client folds EHOSTUNREACH into `timeout`: what #169's connection test said
        ['timeout', true],
        ['EHOSTUNREACH', true],
        ['EHOSTDOWN', true],
        ['refused', false],
        ['dns', false],
        ['reset', false],
        ['certificate', false],
        ['error', false],
        [undefined, false],
    ])('the connection test\'s reason "%s" calls for it on macOS: %s', (reason, expected) => {
        expect(testMayBeLocalNetworkBlock('darwin', reason)).toBe(expected);
    });
});
