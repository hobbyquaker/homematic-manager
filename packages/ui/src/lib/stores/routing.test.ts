import {describe, expect, it} from 'vitest';

import {
    DEFAULT_TAB,
    formatHash,
    isStoreInterface,
    isStoreTabId,
    isTabId,
    parseHash,
    STORE_INTERFACE,
    STORE_TAB_IDS,
    storeTabs,
    TAB_IDS,
    tabsForInterface,
} from './routing.js';

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
        // #155: HmIP has the levels too, from the maintenance channel - 2.x showed them
        expect(tabsForInterface('HmIP-RF')).toEqual(['devices', 'links', 'rssi', 'console', 'messages', 'events']);
        expect(tabsForInterface('HmIPW')).toContain('rssi');
        // a user-defined interface answers no listBidcosInterfaces, so it keeps the shorter set
        expect(tabsForInterface('CCU-Jack')).toEqual(['devices', 'links', 'console', 'messages', 'events']);
        expect(tabsForInterface('BidCos-Wired')).toEqual(['devices', 'links', 'console', 'events']);
        expect(tabsForInterface('CUxD')).toEqual(['devices', 'console', 'events']);
        expect(tabsForInterface('')).not.toContain('rssi');
    });

    /**
     * Task 57: the heating groups live on VirtualDevices and only on openccu-lite, whose system API
     * makes them. Without that API the interface keeps the set it always had; with it the Groups tab
     * follows the devices - and only there: no other interface has groups to edit.
     */
    it('gives VirtualDevices the Groups tab when the connection has the groups API, and nobody else', () => {
        expect(tabsForInterface('VirtualDevices')).toEqual(['devices', 'links', 'console', 'messages', 'events']);
        expect(tabsForInterface('VirtualDevices', {heatingGroups: false})).not.toContain('groups');
        expect(tabsForInterface('VirtualDevices', {heatingGroups: true})).toEqual([
            'devices',
            'groups',
            'links',
            'console',
            'messages',
            'events',
        ]);
        expect(tabsForInterface('BidCos-RF', {heatingGroups: true})).toEqual([...TAB_IDS]);
        expect(tabsForInterface('HmIP-RF', {heatingGroups: true})).not.toContain('groups');
        // the hash `#/VirtualDevices/groups` parses, so a bookmark of the tab works
        expect(isTabId('groups')).toBe(true);
        expect(parseHash('#/VirtualDevices/groups')).toEqual({interfaceName: 'VirtualDevices', tab: 'groups'});
    });
});

describe('the metadata store as a selection (2026-09-10)', () => {
    it('has a reserved name that no interface process can carry, and it survives the hash', () => {
        expect(STORE_INTERFACE.startsWith('#')).toBe(true);
        expect(isStoreInterface(STORE_INTERFACE)).toBe(true);
        expect(isStoreInterface('BidCos-RF')).toBe(false);
        const hash = formatHash(STORE_INTERFACE, 'rooms');
        expect(hash).toBe('#/%23store/rooms');
        expect(parseHash(hash)).toEqual({interfaceName: STORE_INTERFACE, tab: 'rooms'});
    });

    it('knows the three store tabs beside the six of 2.7', () => {
        expect(STORE_TAB_IDS).toEqual(['rooms', 'functions', 'metadata']);
        expect(TAB_IDS).not.toContain('rooms');
        expect(isTabId('metadata')).toBe(true);
        expect(isStoreTabId('metadata')).toBe(true);
        expect(isStoreTabId('devices')).toBe(false);
        expect(parseHash('#/%23store/metadata').tab).toBe('metadata');
    });

    it('offers two lists for a flat store, one tree for a nesting one, nothing without a store', () => {
        const state = {provider: 'rega' as const, reachable: true, writable: true, revision: 1, objects: 0};
        expect(storeTabs({...state, flat: true})).toEqual(['rooms', 'functions']);
        expect(storeTabs({...state, provider: 'occulite'})).toEqual(['metadata']);
        expect(storeTabs({...state, provider: 'local'})).toEqual(['metadata']);
        expect(storeTabs({...state, reachable: false, flat: true})).toEqual([]);
        expect(storeTabs(undefined)).toEqual([]);
    });
});
