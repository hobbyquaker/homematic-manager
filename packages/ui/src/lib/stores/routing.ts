/**
 * The hash route, unchanged from 2.7: `#/<interface>/<tab>`.
 *
 * `initDaemon()` in the old renderer read `location.hash.slice(1).split('/')`, took `[1]` as the
 * interface and `[2]` as the tab, and wrote the same shape back on every tab switch. Bookmarks and
 * the links people put in forum posts use it, so the format is kept exactly (D-3) - only the
 * parsing is now a pure function with tests instead of three copies inline.
 */

import type {MetaState} from '@homematic-manager/core';

/** The six tabs of 2.7, in the order the tab bar shows them. */
export const TAB_IDS = ['devices', 'links', 'rssi', 'console', 'messages', 'events'] as const;

/**
 * Task 57: the one tab 2.7 never had. The heating groups of the `VirtualDevices` interface are
 * created, changed and deleted here - on openccu-lite only, through the box's system API, so the
 * tab exists only while the connection has that API ({@link tabsForInterface}'s option).
 */
export const GROUPS_TAB = 'groups';

export type InterfaceTabId = (typeof TAB_IDS)[number] | typeof GROUPS_TAB;

/**
 * The tabs of the metadata store when it is the selection (the maintainer, 2026-09-10: "mach
 * ReGaHSS doch zu einem eigenen interface"). ReGaHSS keeps rooms and functions as two flat lists
 * and gets a tab for each; occulited keeps a tree of taxonomies and gets one tab for the tree.
 */
export const STORE_TAB_IDS = ['rooms', 'functions', 'metadata'] as const;

export type StoreTabId = (typeof STORE_TAB_IDS)[number];

export type TabId = InterfaceTabId | StoreTabId;

export const DEFAULT_TAB: InterfaceTabId = 'devices';

/**
 * The name under which the metadata store sits in the interface picker and in the hash
 * (`#/%23store/rooms`). A `#` cannot start the name of an interface process - the CCU's are
 * `BidCos-RF`, `HmIP-RF`, `VirtualDevices` and the like, and a user-defined one is typed into a
 * form that a hash would only confuse - so the name cannot collide with a real one.
 */
export const STORE_INTERFACE = '#store';

export function isStoreInterface(interfaceName: string): boolean {
    return interfaceName === STORE_INTERFACE;
}

export function isStoreTabId(value: string): value is StoreTabId {
    return (STORE_TAB_IDS as readonly string[]).includes(value);
}

/**
 * Which tabs the store offers, from its state: none without a store or while it does not answer,
 * "Rooms" and "Functions" for a provider whose taxonomies are flat lists (ReGaHSS, task 27), and
 * one "Metadata" tree for every store that nests (occulited, and this profile's own store, which
 * is the same document model).
 */
export function storeTabs(state: MetaState | undefined): StoreTabId[] {
    if (state === undefined || !state.reachable) {
        return [];
    }
    return state.flat === true ? ['rooms', 'functions'] : ['metadata'];
}

export interface Route {
    /** Empty when the hash names no interface. */
    readonly interfaceName: string;
    readonly tab: TabId;
}

export function isTabId(value: string): value is TabId {
    return (TAB_IDS as readonly string[]).includes(value) || value === GROUPS_TAB || isStoreTabId(value);
}

/** `#/BidCos-RF/links` -> `{interfaceName: 'BidCos-RF', tab: 'links'}`. */
export function parseHash(hash: string): Route {
    const parts = hash.replace(/^#/, '').split('/');
    const interfaceName = decodeURIComponent(parts[1] ?? '');
    const tab = decodeURIComponent(parts[2] ?? '');
    return {interfaceName, tab: isTabId(tab) ? tab : DEFAULT_TAB};
}

/** The inverse. An empty interface produces an empty hash, exactly as 2.x did. */
export function formatHash(interfaceName: string, tab: TabId): string {
    if (interfaceName === '') {
        return '';
    }
    return `#/${encodeURIComponent(interfaceName)}/${tab}`;
}

export interface TabOptions {
    /**
     * Task 57: the connection has openccu-lite's groups API. The `VirtualDevices` interface then
     * gets the Groups tab, right after its devices - whether or not its RPC connection is up, because
     * the tab reads the box's API and not the group process (openccu-lite B-169: remotely the
     * process cannot be reached yet, and the groups can still be edited).
     */
    readonly heatingGroups?: boolean;
}

/**
 * Which tabs an interface offers. 2.x hid the tabs an interface cannot serve through the `dselect`
 * classes: links only for BidCos, RSSI only for BidCos-RF, service messages not for BidCos-Wired.
 * HmIP got everything, which is why the class list on the `#links` tab reads BidCos-only but
 * `initDaemon` showed all of them again for HmIP.
 */
export function tabsForInterface(interfaceType: string, options: TabOptions = {}): InterfaceTabId[] {
    switch (interfaceType) {
        case 'BidCos-Wired':
            return ['devices', 'links', 'console', 'events'];
        case 'CUxD':
            return ['devices', 'console', 'events'];
        case 'BidCos-RF':
            return [...TAB_IDS];
        case 'VirtualDevices':
            return options.heatingGroups === true
                ? ['devices', GROUPS_TAB, 'links', 'console', 'messages', 'events']
                : ['devices', 'links', 'console', 'messages', 'events'];
        default:
            // #155: HmIP has no `rssiInfo`, but it has the levels - they arrive as `RSSI_DEVICE`
            // and `RSSI_PEER` of the maintenance channel, which is what 2.x showed in its Funk tab
            // for HmIP and what the backend's matrix is built from. OpenCCU's WebUI assembles its
            // own HmIP list the same way. Everything user-defined keeps the shorter set: nothing
            // there answers `listBidcosInterfaces`.
            if (/hmip/i.test(interfaceType)) {
                return ['devices', 'links', 'rssi', 'console', 'messages', 'events'];
            }
            return ['devices', 'links', 'console', 'messages', 'events'];
    }
}
