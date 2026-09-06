import {render, screen} from '@testing-library/svelte';
import {describe, expect, it, vi} from 'vitest';

import DeviceImage from '../components/DeviceImage.svelte';
import {HostStore} from '../stores/HostStore.svelte.js';

import {getHostBridge, HOST_BRIDGE_GLOBAL, isHostBridge} from './hostBridge.js';
import type {HostBridge, HostInfo, HostUpdateState} from './types.js';

const info: HostInfo = {
    version: '3.0.0-dev.0',
    electron: '44.2.0',
    chrome: '140.0.0',
    node: '22.20.0',
    platform: 'linux',
    arch: 'x64',
    packaged: true,
    userData: '/home/u/.config/homematic-manager',
    logFile: '/home/u/.config/homematic-manager/error.log',
};

const idle: HostUpdateState = {phase: 'idle', dismissed: false};

interface FakeBridge extends HostBridge {
    fireSystemTheme(dark: boolean): void;
    fireUpdate(state: HostUpdateState): void;
    fireMenu(action: 'settings'): void;
    themeCalls(): string[];
    offCount(): number;
}

function fakeBridge(overrides: Partial<HostBridge> = {}): FakeBridge {
    const themeHandlers = new Set<(dark: boolean) => void>();
    const updateHandlers = new Set<(state: HostUpdateState) => void>();
    const menuHandlers = new Set<(action: 'settings') => void>();
    const themeCalls: string[] = [];
    let offCalls = 0;
    const bridge = {
        info: () => Promise.resolve(info),
        deviceImageUrl: (type: string) => `hmm-image://device/${encodeURIComponent(type)}`,
        setTheme: (source: string) => {
            themeCalls.push(source);
            return Promise.resolve();
        },
        onSystemTheme(handler: (dark: boolean) => void) {
            themeHandlers.add(handler);
            return () => {
                offCalls += 1;
                themeHandlers.delete(handler);
            };
        },
        onMenuAction(handler: (action: 'settings') => void) {
            menuHandlers.add(handler);
            return () => menuHandlers.delete(handler);
        },
        update: {
            state: () => Promise.resolve(idle),
            check: () => Promise.resolve({phase: 'available', version: '3.1.0', dismissed: false} as HostUpdateState),
            download: () =>
                Promise.resolve({phase: 'downloading', version: '3.1.0', percent: 12, dismissed: false} as const),
            installOnQuit: () => Promise.resolve({phase: 'installOnQuit', version: '3.1.0', dismissed: false} as const),
            dismiss: () => Promise.resolve({phase: 'available', version: '3.1.0', dismissed: true} as const),
            on(handler: (state: HostUpdateState) => void) {
                updateHandlers.add(handler);
                return () => {
                    offCalls += 1;
                    updateHandlers.delete(handler);
                };
            },
        },
        ...overrides,
    } as HostBridge;
    return Object.assign(bridge, {
        fireSystemTheme: (dark: boolean) => themeHandlers.forEach((handler) => handler(dark)),
        fireUpdate: (state: HostUpdateState) => updateHandlers.forEach((handler) => handler(state)),
        fireMenu: (action: 'settings') => menuHandlers.forEach((handler) => handler(action)),
        themeCalls: () => themeCalls,
        offCount: () => offCalls,
    }) as FakeBridge;
}

describe('the host bridge', () => {
    it('recognises the real shape and refuses everything else', () => {
        expect(isHostBridge(fakeBridge())).toBe(true);
        expect(isHostBridge(undefined)).toBe(false);
        expect(isHostBridge(null)).toBe(false);
        expect(isHostBridge({})).toBe(false);
        expect(isHostBridge({info: () => undefined, deviceImageUrl: () => ''})).toBe(false);
    });

    it('refuses a preload that has everything but the updater', () => {
        const rest: Record<string, unknown> = {...fakeBridge()};
        delete rest['update'];
        expect(isHostBridge(rest)).toBe(false);
        expect(isHostBridge({...rest, update: {}})).toBe(false);
        expect(isHostBridge({...rest, update: null})).toBe(false);
    });

    it('reads the bridge off a scope, and answers undefined for a plain browser', () => {
        const bridge = fakeBridge();
        expect(getHostBridge({[HOST_BRIDGE_GLOBAL]: bridge})).toBe(bridge);
        expect(getHostBridge({})).toBeUndefined();
        expect(getHostBridge({[HOST_BRIDGE_GLOBAL]: {nope: true}})).toBeUndefined();
    });
});

describe('HostStore with a host', () => {
    it('loads info and update state, and follows both event streams', async () => {
        const bridge = fakeBridge();
        const store = new HostStore({bridge});

        expect(store.available).toBe(true);
        await store.load();
        expect(store.info?.electron).toBe('44.2.0');
        expect(store.update).toEqual(idle);

        bridge.fireSystemTheme(true);
        expect(store.systemDark).toBe(true);

        bridge.fireUpdate({phase: 'downloaded', version: '3.1.0', dismissed: false});
        expect(store.update?.phase).toBe('downloaded');

        store.dispose();
        expect(bridge.offCount()).toBe(2);
    });

    it('shows an update notice only for the phases that are news, and never a dismissed one', async () => {
        const bridge = fakeBridge();
        const store = new HostStore({bridge});

        for (const phase of ['disabled', 'idle', 'checking', 'error'] as const) {
            bridge.fireUpdate({phase, dismissed: false});
            expect(store.updateNotice, phase).toBeUndefined();
        }
        for (const phase of ['available', 'downloading', 'downloaded', 'installOnQuit'] as const) {
            bridge.fireUpdate({phase, version: '3.1.0', dismissed: false});
            expect(store.updateNotice?.phase, phase).toBe(phase);
        }
        bridge.fireUpdate({phase: 'available', version: '3.1.0', dismissed: true});
        expect(store.updateNotice).toBeUndefined();

        await store.checkForUpdate();
        expect(store.update?.phase).toBe('available');
        await store.downloadUpdate();
        expect(store.update?.percent).toBe(12);
        await store.installUpdateOnQuit();
        expect(store.update?.phase).toBe('installOnQuit');
        await store.dismissUpdate();
        expect(store.update?.dismissed).toBe(true);
    });

    it('passes the theme on and forwards menu actions', async () => {
        const bridge = fakeBridge();
        const store = new HostStore({bridge});
        const seen: string[] = [];
        const off = store.onMenuAction((action) => seen.push(action));

        await store.setTheme('dark');
        bridge.fireMenu('settings');
        expect(bridge.themeCalls()).toEqual(['dark']);
        expect(seen).toEqual(['settings']);
        off();
        bridge.fireMenu('settings');
        expect(seen).toEqual(['settings']);
    });

    it('builds the device image URL of D-10', () => {
        const store = new HostStore({bridge: fakeBridge()});
        expect(store.deviceImageUrl('HmIP-BSM')).toBe('hmm-image://device/HmIP-BSM');
        expect(store.deviceImageUrl('')).toBeUndefined();
    });
});

describe('HostStore without a host', () => {
    it('is inert: every call resolves, nothing throws; images come from the web host route', async () => {
        const store = new HostStore({scope: {}});

        expect(store.available).toBe(false);
        expect(store.deviceImageUrl('HmIP-BSM')).toBe('images/HmIP-BSM');
        expect(store.deviceImageUrl('HM-LC-Sw1-Pl CT')).toBe('images/HM-LC-Sw1-Pl%20CT');
        expect(store.deviceImageUrl('')).toBeUndefined();
        expect(store.updateNotice).toBeUndefined();

        await store.load();
        await store.setTheme('light');
        await store.checkForUpdate();
        await store.downloadUpdate();
        await store.installUpdateOnQuit();
        await store.dismissUpdate();
        expect(store.info).toBeUndefined();
        expect(store.update).toBeUndefined();

        const off = store.onMenuAction(vi.fn());
        off();
        store.dispose();
    });
});

describe('DeviceImage', () => {
    it('draws the host image when there is one', () => {
        render(DeviceImage, {props: {deviceType: 'HmIP-BSM', src: 'hmm-image://device/HmIP-BSM', testId: 'img'}});
        const image = screen.getByTestId<HTMLImageElement>('img');
        expect(image.tagName).toBe('IMG');
        expect(image.getAttribute('src')).toBe('hmm-image://device/HmIP-BSM');
        expect(image.alt).toBe('HmIP-BSM');
    });

    it('falls back to a labelled placeholder without a host', () => {
        render(DeviceImage, {props: {deviceType: 'HM-LC-Sw1-Pl-CT-R1', testId: 'img'}});
        const placeholder = screen.getByTestId('img');
        expect(placeholder.tagName).toBe('SPAN');
        // The vendor prefix is dropped, so two devices of the same family stay apart.
        expect(placeholder.textContent).toBe('LC');
        expect(placeholder.getAttribute('role')).toBe('img');
    });

    it('has no accessible name for a channel row, which has no device type', () => {
        render(DeviceImage, {props: {testId: 'img'}});
        const placeholder = screen.getByTestId('img');
        expect(placeholder.textContent).toBe('');
        expect(placeholder.getAttribute('role')).toBeNull();
    });
});
