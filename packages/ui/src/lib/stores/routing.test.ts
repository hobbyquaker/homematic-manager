import {describe, expect, it} from 'vitest';

import {DEFAULT_TAB, formatHash, isTabId, parseHash, TAB_IDS, tabsForInterface} from './routing.js';

describe('the 2.x hash route', () => {
    it('keeps the six tabs in the 2.7 order', () => {
        expect(TAB_IDS).toEqual(['devices', 'links', 'rssi', 'console', 'messages', 'events']);
        expect(DEFAULT_TAB).toBe('devices');
        expect(isTabId('rssi')).toBe(true);
        expect(isTabId('paramset')).toBe(false);
    });

    it('parses #/<interface>/<tab>', () => {
        expect(parseHash('#/BidCos-RF/links')).toEqual({interfaceName: 'BidCos-RF', tab: 'links'});
        expect(parseHash('/BidCos-RF/links')).toEqual({interfaceName: 'BidCos-RF', tab: 'links'});
        expect(parseHash('#/HmIP-RF')).toEqual({interfaceName: 'HmIP-RF', tab: 'devices'});
        expect(parseHash('')).toEqual({interfaceName: '', tab: 'devices'});
        expect(parseHash('#/BidCos-RF/nonsense')).toEqual({interfaceName: 'BidCos-RF', tab: 'devices'});
    });

    it('round-trips an interface name that needs encoding', () => {
        const hash = formatHash('CUxD Test', 'console');
        expect(hash).toBe('#/CUxD%20Test/console');
        expect(parseHash(hash)).toEqual({interfaceName: 'CUxD Test', tab: 'console'});
    });

    it('produces an empty hash without an interface, as 2.x did', () => {
        expect(formatHash('', 'devices')).toBe('');
    });
});

describe('tabsForInterface', () => {
    it('gives BidCos-RF everything and takes the RSSI matrix from the rest', () => {
        expect(tabsForInterface('BidCos-RF')).toEqual([...TAB_IDS]);
        expect(tabsForInterface('HmIP-RF')).toEqual(['devices', 'links', 'console', 'messages', 'events']);
        expect(tabsForInterface('BidCos-Wired')).toEqual(['devices', 'links', 'console', 'events']);
        expect(tabsForInterface('CUxD')).toEqual(['devices', 'console', 'events']);
        expect(tabsForInterface('')).not.toContain('rssi');
    });
});
