import type {AppConfig, InterfaceState, WriteLogEntry} from '@homematic-manager/core';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {
    DEMO_CONFIG,
    DEMO_DEVICES,
    DEMO_INTERFACE_STATES,
    DEMO_NAMES,
    DEMO_SERVICE_MESSAGES,
} from '../transport/demoData.js';
import {MockTransport} from '../transport/MockTransport.js';

import {AppStore, LANGUAGE_STORAGE_KEY, THEME_STORAGE_KEY, type StorageLike} from './AppStore.svelte.js';
import {DevicesStore} from './DevicesStore.svelte.js';
import {EventsStore} from './EventsStore.svelte.js';
import {InterfacesStore} from './InterfacesStore.svelte.js';
import {LinksStore} from './LinksStore.svelte.js';
import {NamesStore} from './NamesStore.svelte.js';
import {NoticesStore} from './NoticesStore.svelte.js';
import {ServiceMessagesStore} from './ServiceMessagesStore.svelte.js';
import {createStores} from './Stores.svelte.js';
import {WriteLogStore} from './WriteLogStore.svelte.js';

class MemoryStorage implements StorageLike {
    readonly map = new Map<string, string>();
    getItem(key: string): string | null {
        return this.map.get(key) ?? null;
    }
    setItem(key: string, value: string): void {
        this.map.set(key, value);
    }
}

/** A hash "location" plus its listeners, so the route can be driven without a browser. */
function fakeRouter(initial = '') {
    const handlers = new Set<() => void>();
    const location = {
        _hash: initial,
        get hash(): string {
            return this._hash;
        },
        set hash(value: string) {
            this._hash = value;
        },
    };
    return {
        location,
        onHashChange: (handler: () => void) => {
            handlers.add(handler);
            return () => handlers.delete(handler);
        },
        navigate(hash: string) {
            location._hash = hash;
            for (const handler of handlers) {
                handler();
            }
        },
        get listeners(): number {
            return handlers.size;
        },
    };
}

describe('NoticesStore', () => {
    it('collects backend notices', () => {
        const transport = new MockTransport();
        const notices = new NoticesStore(transport, {now: () => 5});
        transport.emit('notice', {level: 'warn', message: 'ReGa is not answering', interfaceName: 'ReGa'});

        expect(notices.items).toEqual([
            {id: 1, level: 'warn', message: 'ReGa is not answering', interfaceName: 'ReGa', timestamp: 5},
        ]);
    });

    it('turns a rejected request into an error notice, with the fault code', () => {
        const notices = new NoticesStore(new MockTransport());
        notices.fromError({message: 'Unknown parameter', kind: 'rpc', faultCode: -5, faultString: 'no such param'});
        notices.fromError(new Error('offline'), 'devices.list');

        expect(notices.items[0]?.message).toBe('Unknown parameter (no such param, -5)');
        expect(notices.items[1]?.message).toBe('devices.list: offline');
        expect(notices.items.every((notice) => notice.level === 'error')).toBe(true);
    });

    it('drops the oldest notice above the maximum, dismisses and clears', () => {
        const notices = new NoticesStore(new MockTransport(), {max: 2});
        notices.push('info', 'one');
        const second = notices.push('info', 'two');
        notices.push('info', 'three');

        expect(notices.items.map((notice) => notice.message)).toEqual(['two', 'three']);
        notices.dismiss(second);
        expect(notices.items.map((notice) => notice.message)).toEqual(['three']);
        notices.clear();
        expect(notices.items).toEqual([]);
    });

    it('stops listening after dispose', () => {
        const transport = new MockTransport();
        const notices = new NoticesStore(transport);
        notices.dispose();
        transport.emit('notice', {level: 'info', message: 'ignored'});
        expect(notices.items).toEqual([]);
        expect(transport.listenerCount('notice')).toBe(0);
    });

    /**
     * D-34: the toasts piled up into a wall. The cap is a *view* - what leaves the screen is still
     * held and counted, because an error never expires and must not be pushed out of existence by
     * five status messages.
     */
    it('shows at most five and counts the rest', () => {
        const notices = new NoticesStore(new MockTransport());
        for (let index = 1; index <= 7; index += 1) {
            notices.push('error', `error ${index}`);
        }

        expect(notices.items).toHaveLength(7);
        expect(notices.visible.map((notice) => notice.message)).toEqual([
            'error 3',
            'error 4',
            'error 5',
            'error 6',
            'error 7',
        ]);
        expect(notices.hidden).toBe(2);
    });

    it('has nothing hidden while the stack is short', () => {
        const notices = new NoticesStore(new MockTransport());
        notices.push('error', 'one');
        expect(notices.visible.map((notice) => notice.message)).toEqual(['one']);
        expect(notices.hidden).toBe(0);
    });

    it('expires an info toast, gives a warning longer and keeps an error until it is dismissed', async () => {
        vi.useFakeTimers();
        try {
            const notices = new NoticesStore(new MockTransport(), {infoTtlMs: 5000, warnTtlMs: 15_000});
            notices.push('info', 'written');
            notices.push('warn', 'ReGa is slow');
            const failure = notices.push('error', 'putParamset failed');

            await vi.advanceTimersByTimeAsync(5000);
            expect(notices.items.map((notice) => notice.message)).toEqual(['ReGa is slow', 'putParamset failed']);

            await vi.advanceTimersByTimeAsync(10_000);
            expect(notices.items.map((notice) => notice.message)).toEqual(['putParamset failed']);

            await vi.advanceTimersByTimeAsync(600_000);
            expect(notices.items).toHaveLength(1);

            notices.dismiss(failure);
            expect(notices.items).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('never expires anything when the lifetimes are zero', async () => {
        vi.useFakeTimers();
        try {
            const notices = new NoticesStore(new MockTransport(), {infoTtlMs: 0, warnTtlMs: 0});
            notices.push('info', 'stays');
            notices.push('warn', 'stays too');
            await vi.advanceTimersByTimeAsync(600_000);
            expect(notices.items).toHaveLength(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('forgets the timer of a dismissed notice, so a later one keeps its own lifetime', async () => {
        vi.useFakeTimers();
        try {
            const notices = new NoticesStore(new MockTransport(), {infoTtlMs: 1000});
            const first = notices.push('info', 'one');
            notices.dismiss(first);
            notices.push('info', 'two');

            await vi.advanceTimersByTimeAsync(999);
            expect(notices.items.map((notice) => notice.message)).toEqual(['two']);
            await vi.advanceTimersByTimeAsync(1);
            expect(notices.items).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('AppStore', () => {
    let transport: MockTransport;
    let notices: NoticesStore;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
        notices = new NoticesStore(transport);
    });

    it('reads the 2.x hash on construction and writes it back on a tab change', () => {
        const router = fakeRouter('#/HmIP-RF/links');
        const app = new AppStore(transport, notices, {
            location: router.location,
            onHashChange: router.onHashChange,
            storage: new MemoryStorage(),
        });

        expect(app.selectedInterface).toBe('HmIP-RF');
        expect(app.tab).toBe('links');

        app.setTab('events');
        expect(router.location.hash).toBe('#/HmIP-RF/events');
        app.setInterface('BidCos-RF');
        expect(router.location.hash).toBe('#/BidCos-RF/events');
    });

    it('follows an external hash change and stops after dispose', () => {
        const router = fakeRouter('');
        const app = new AppStore(transport, notices, {
            location: router.location,
            onHashChange: router.onHashChange,
            storage: new MemoryStorage(),
        });
        expect(app.tab).toBe('devices');

        router.navigate('#/BidCos-RF/rssi');
        expect(app.selectedInterface).toBe('BidCos-RF');
        expect(app.tab).toBe('rssi');

        app.dispose();
        expect(router.listeners).toBe(0);
        router.navigate('#/BidCos-RF/console');
        expect(app.tab).toBe('rssi');
    });

    it('mirrors the transport connection', () => {
        const app = new AppStore(transport, notices, {storage: new MemoryStorage()});
        expect(app.connected).toBe(true);
        transport.setConnected(false);
        expect(app.connected).toBe(false);
    });

    it('loads the configuration, takes its language and selects the first interface', async () => {
        const router = fakeRouter('');
        const app = new AppStore(transport, notices, {
            location: router.location,
            onHashChange: router.onHashChange,
            storage: new MemoryStorage(),
        });
        await app.load();

        expect(app.loading).toBe(false);
        expect(app.host).toBe('demo.local');
        expect(app.language).toBe('de');
        expect(app.selectedInterface).toBe('BidCos-RF');
        // The demo CCU has five configured interfaces, one per state the popup draws; the two with
        // devices come first, which is why the route lands on BidCos-RF.
        expect(app.configuredInterfaces).toEqual(['BidCos-RF', 'HmIP-RF', 'BidCos-Wired', 'CUxD', 'VirtualDevices']);
        expect(router.location.hash).toBe('#/BidCos-RF/devices');
        expect(app.configDialogOpen).toBe(false);
    });

    it('keeps a locally chosen language when the configuration says otherwise', async () => {
        const storage = new MemoryStorage();
        storage.setItem(LANGUAGE_STORAGE_KEY, 'en');
        const app = new AppStore(transport, notices, {location: fakeRouter().location, storage});
        expect(app.language).toBe('en');
        await app.load();
        expect(app.language).toBe('en');
    });

    /**
     * D-36, task 22: from strong to weak - a choice made in this browser, then the profile, then
     * the browser's own order with English behind it. The 2.x default was German, whatever the
     * browser asked for, and this is the test that says it is not any more.
     */
    describe('the language it starts in (D-36)', () => {
        const withBrowser = (languages: readonly string[], storage = new MemoryStorage()): AppStore =>
            new AppStore(transport, notices, {location: fakeRouter().location, storage, languages});

        it('follows the browser when nothing was chosen anywhere', () => {
            expect(withBrowser(['de-DE', 'en-US']).language).toBe('de');
            expect(withBrowser(['en-GB']).language).toBe('en');
            expect(withBrowser(['fr-FR']).language).toBe('en');
            expect(withBrowser(['de-DE']).languageChoice).toBe('auto');
        });

        it('takes the profile over the browser', async () => {
            const app = withBrowser(['en-GB']);
            expect(app.language).toBe('en');
            // the demo profile stores German
            await app.load();
            expect(app.languageChoice).toBe('de');
            expect(app.language).toBe('de');
        });

        it('follows the browser for a profile that stores no language at all', async () => {
            const app = withBrowser(['de-DE']);
            const connection = {...DEMO_CONFIG.connection};
            delete connection.language;
            transport.result('config.get', {...DEMO_CONFIG, connection});
            await app.load();
            expect(app.languageChoice).toBe('auto');
            expect(app.language).toBe('de');
        });

        it('follows the browser for a profile that stores `auto`', async () => {
            const app = withBrowser(['fr', 'de']);
            transport.result('config.get', {
                ...DEMO_CONFIG,
                connection: {...DEMO_CONFIG.connection, language: 'auto' as const},
            });
            await app.load();
            expect(app.language).toBe('de');
        });

        it('lets the choice made in this browser win over both', async () => {
            const storage = new MemoryStorage();
            storage.setItem(LANGUAGE_STORAGE_KEY, 'en');
            const app = withBrowser(['de-DE'], storage);
            await app.load();
            expect(app.language).toBe('en');
        });

        it('stores `auto` rather than clearing the key, and resolves it again', () => {
            const storage = new MemoryStorage();
            const app = withBrowser(['de-DE'], storage);

            app.setLanguage('en');
            expect(app.language).toBe('en');
            expect(storage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');

            app.setLanguage('auto');
            expect(storage.getItem(LANGUAGE_STORAGE_KEY)).toBe('auto');
            expect(app.languageChoice).toBe('auto');
            expect(app.language).toBe('de');
        });

        it('restores `auto` from storage and does not let the profile override it', async () => {
            const storage = new MemoryStorage();
            storage.setItem(LANGUAGE_STORAGE_KEY, 'auto');
            const app = withBrowser(['en-GB'], storage);
            await app.load();
            expect(app.languageChoice).toBe('auto');
            expect(app.language).toBe('en');
        });
    });

    it('opens the settings dialog when no host is configured', async () => {
        const unconfigured: AppConfig = {
            ...DEMO_CONFIG,
            connection: {...DEMO_CONFIG.connection, host: '', interfaces: []},
        };
        transport.result('config.get', unconfigured);
        const app = new AppStore(transport, notices, {location: fakeRouter().location, storage: new MemoryStorage()});
        await app.load();

        expect(app.configDialogOpen).toBe(true);
        expect(app.selectedInterface).toBe('');
    });

    it('reports a failing config.get as a notice and still stops loading', async () => {
        transport.fail('config.get', 'backend is not up');
        const app = new AppStore(transport, notices, {location: fakeRouter().location, storage: new MemoryStorage()});
        await app.load();

        expect(app.loading).toBe(false);
        expect(notices.items[0]?.message).toContain('backend is not up');
    });

    it('saves a connection, closes the dialog and reports a failure', async () => {
        const app = new AppStore(transport, notices, {location: fakeRouter().location, storage: new MemoryStorage()});
        await app.load();
        app.configDialogOpen = true;

        await expect(app.save({...DEMO_CONFIG.connection, host: 'ccu3'})).resolves.toBe(true);
        expect(app.host).toBe('ccu3');
        expect(app.configDialogOpen).toBe(false);

        transport.fail('config.set', 'port in use');
        await expect(app.save(DEMO_CONFIG.connection)).resolves.toBe(false);
        expect(notices.items.at(-1)?.message).toContain('port in use');
    });

    it('discovers CCUs and clears the caches', async () => {
        const app = new AppStore(transport, notices, {location: fakeRouter().location, storage: new MemoryStorage()});
        await app.load();
        await app.discover();
        expect(app.config?.discovered).toHaveLength(1);

        await app.clearCaches();
        expect(transport.countOf('config.clearCaches')).toBe(1);

        transport.fail('config.discover', 'no answer');
        transport.fail('config.clearCaches', 'busy');
        await app.discover();
        await app.clearCaches();
        expect(notices.items).toHaveLength(2);
    });

    it('persists theme and language and cycles the theme', () => {
        const storage = new MemoryStorage();
        const app = new AppStore(transport, notices, {location: fakeRouter().location, storage});

        expect(app.theme).toBe('system');
        app.cycleTheme();
        expect(app.theme).toBe('light');
        app.cycleTheme();
        expect(app.theme).toBe('dark');
        app.cycleTheme();
        expect(app.theme).toBe('system');
        expect(storage.getItem(THEME_STORAGE_KEY)).toBe('system');

        app.setLanguage('en');
        expect(storage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
    });

    it('restores a stored theme and language', () => {
        const storage = new MemoryStorage();
        storage.setItem(THEME_STORAGE_KEY, 'dark');
        storage.setItem(LANGUAGE_STORAGE_KEY, 'en');
        const app = new AppStore(transport, notices, {location: fakeRouter().location, storage});
        expect(app.theme).toBe('dark');
        expect(app.language).toBe('en');
    });

    it('works without a storage at all', () => {
        const app = new AppStore(transport, notices, {location: fakeRouter().location, storage: undefined});
        expect(() => app.setTheme('dark')).not.toThrow();
        expect(app.theme).toBe('dark');
    });

    it('takes over a config pushed as an event', async () => {
        const app = new AppStore(transport, notices, {location: fakeRouter().location, storage: new MemoryStorage()});
        await app.load();
        transport.emit('config.changed', {...DEMO_CONFIG, version: '3.0.0-dev.9'});
        expect(app.config?.version).toBe('3.0.0-dev.9');
    });
});

describe('InterfacesStore', () => {
    it('loads the states and the ReGa status', async () => {
        const transport = new MockTransport({demo: true});
        const store = new InterfacesStore(transport, new NoticesStore(transport));
        await store.load();

        expect(store.states).toEqual(DEMO_INTERFACE_STATES);
        expect(store.typeOf('BidCos-RF')).toBe('BidCos-RF');
        expect(store.typeOf('Homegear')).toBe('');
        expect(store.isConnected('BidCos-RF')).toBe(true);
        expect(store.isConnected('Homegear')).toBe(false);
        // the demo has a BidCos-Wired that is not there; an absent interface is not a fault
        expect(store.isConnected('BidCos-Wired')).toBe(false);
        // ... but its VirtualDevices is configured, present and unsubscribed, and that is one
        expect(store.isConnected('VirtualDevices')).toBe(false);
        expect(store.allConnected).toBe(false);
        expect(store.rega?.reachable).toBe(true);
        expect(store.loading).toBe(false);
    });

    it('degrades a ReGa failure to a status instead of an error (D-2)', async () => {
        const transport = new MockTransport({demo: true});
        const notices = new NoticesStore(transport);
        transport.fail('rega.state', 'connection refused');
        const store = new InterfacesStore(transport, notices);
        await store.load();

        expect(store.rega).toMatchObject({reachable: false});
        expect(notices.items).toEqual([]);
    });

    it('follows interfaces.changed and stops after dispose', () => {
        const transport = new MockTransport();
        const store = new InterfacesStore(transport, new NoticesStore(transport));
        const down: InterfaceState[] = [{...DEMO_INTERFACE_STATES[0]!, connected: false}];
        transport.emit('interfaces.changed', down);
        expect(store.allConnected).toBe(false);

        transport.emit('rega.changed', {enabled: false, reachable: false, names: 0});
        expect(store.rega?.enabled).toBe(false);

        store.dispose();
        transport.emit('interfaces.changed', DEMO_INTERFACE_STATES);
        expect(store.states).toEqual(down);
    });

    it('reports a failing interfaces.list and reconnect', async () => {
        const transport = new MockTransport({demo: true});
        const notices = new NoticesStore(transport);
        const store = new InterfacesStore(transport, notices);
        transport.fail('interfaces.list', 'no backend');
        transport.fail('interfaces.reconnect', 'busy');
        await store.load();
        await store.reconnect('BidCos-RF');

        expect(notices.items).toHaveLength(2);
        expect(store.allConnected).toBe(false);
    });

    it('reconnects', async () => {
        const transport = new MockTransport({demo: true});
        const store = new InterfacesStore(transport, new NoticesStore(transport));
        await store.reconnect();
        expect(transport.lastCall('interfaces.reconnect')).toEqual([undefined]);
    });
});

describe('DevicesStore', () => {
    it('builds a DeviceIndex per interface and keeps them apart', async () => {
        const transport = new MockTransport({demo: true});
        const store = new DevicesStore(transport, new NoticesStore(transport));
        await store.load('BidCos-RF');
        await store.load('HmIP-RF');

        expect(store.index('BidCos-RF')?.size).toBe(DEMO_DEVICES['BidCos-RF'].length);
        expect(store.devices('BidCos-RF').map((device) => device.ADDRESS)).toContain('MEQ0123456');
        expect(store.devices('HmIP-RF').map((device) => device.ADDRESS)).not.toContain('MEQ0123456');
        expect(store.channels('BidCos-RF', 'MEQ0123456').map((channel) => channel.ADDRESS)).toEqual([
            'MEQ0123456:0',
            'MEQ0123456:1',
        ]);
        expect(store.isLoading('BidCos-RF')).toBe(false);
    });

    it('does nothing for an empty interface name', async () => {
        const transport = new MockTransport({demo: true});
        const store = new DevicesStore(transport, new NoticesStore(transport));
        await store.load('');
        await store.ensure('');
        expect(transport.countOf('devices.list')).toBe(0);
        expect(store.devices('')).toEqual([]);
        expect(store.channels('', 'X')).toEqual([]);
    });

    it('loads once with ensure() and again with load()', async () => {
        const transport = new MockTransport({demo: true});
        const store = new DevicesStore(transport, new NoticesStore(transport));
        await store.ensure('BidCos-RF');
        await store.ensure('BidCos-RF');
        expect(transport.countOf('devices.list')).toBe(1);

        await store.load('BidCos-RF', {refresh: true});
        expect(transport.countOf('devices.list')).toBe(2);
        expect(transport.lastCall('devices.list')).toEqual(['BidCos-RF', {refresh: true}]);
    });

    it('reloads on devices.changed, but only for an interface it already knows', async () => {
        const transport = new MockTransport({demo: true});
        const store = new DevicesStore(transport, new NoticesStore(transport));
        await store.load('BidCos-RF');

        transport.emit('devices.changed', {interfaceName: 'HmIP-RF', kind: 'new', addresses: []});
        expect(transport.countOf('devices.list')).toBe(1);

        transport.emit('devices.changed', {interfaceName: 'BidCos-RF', kind: 'new', addresses: ['NEW0000001']});
        await vi.waitFor(() => expect(transport.countOf('devices.list')).toBe(2));

        store.dispose();
        transport.emit('devices.changed', {interfaceName: 'BidCos-RF', kind: 'deleted', addresses: []});
        expect(transport.countOf('devices.list')).toBe(2);
    });

    it('reports a failing list and forgets indexes', async () => {
        const transport = new MockTransport({demo: true});
        const notices = new NoticesStore(transport);
        const store = new DevicesStore(transport, notices);
        await store.load('BidCos-RF');
        await store.load('HmIP-RF');

        store.forget('HmIP-RF');
        expect(store.index('HmIP-RF')).toBeUndefined();
        expect(store.index('BidCos-RF')).toBeDefined();
        store.forget();
        expect(store.indexes).toEqual({});

        transport.fail('devices.list', 'interface not answering');
        await store.load('BidCos-RF');
        expect(notices.items[0]?.message).toContain('interface not answering');
        expect(store.isLoading('BidCos-RF')).toBe(false);
    });
});

describe('NamesStore', () => {
    it('loads names and falls back to the address', async () => {
        const transport = new MockTransport({demo: true});
        const store = new NamesStore(transport, new NoticesStore(transport));
        await store.load();

        expect(store.nameOf('MEQ0123456')).toBe('Licht Küche');
        expect(store.name('MEQ0123456')).toBe('Licht Küche');
        expect(store.nameOf('UNKNOWN0001')).toBe('UNKNOWN0001');
        expect(store.name('UNKNOWN0001')).toBeUndefined();
        expect(store.size).toBe(Object.keys(DEMO_NAMES).length);
    });

    it('renames and follows names.changed until dispose', async () => {
        const transport = new MockTransport({demo: true});
        const store = new NamesStore(transport, new NoticesStore(transport));
        await expect(store.rename([{address: 'MEQ0123456', name: 'Licht Flur'}])).resolves.toBe(true);
        expect(store.nameOf('MEQ0123456')).toBe('Licht Flur');

        transport.emit('names.changed', {'AAA:1': 'Pushed'});
        expect(store.nameOf('AAA:1')).toBe('Pushed');

        store.dispose();
        transport.emit('names.changed', {});
        expect(store.nameOf('AAA:1')).toBe('Pushed');
    });

    it('reports failures of both calls', async () => {
        const transport = new MockTransport({demo: true});
        const notices = new NoticesStore(transport);
        const store = new NamesStore(transport, notices);
        transport.fail('names.get', 'ReGa down');
        transport.fail('names.set', 'ReGa down');
        await store.load();
        await expect(store.rename([{address: 'A', name: 'B'}])).resolves.toBe(false);
        expect(notices.items).toHaveLength(2);
    });
});

describe('LinksStore', () => {
    it('loads links per interface and finds those of one address', async () => {
        const transport = new MockTransport({demo: true});
        const store = new LinksStore(transport, new NoticesStore(transport));
        await store.ensure('BidCos-RF');
        await store.ensure('BidCos-RF');

        expect(transport.countOf('links.list')).toBe(1);
        expect(store.of('BidCos-RF')).toHaveLength(2);
        expect(store.of('HmIP-RF')).toEqual([]);
        expect(store.forAddress('BidCos-RF', 'MEQ0123456:1')).toHaveLength(1);
        expect(store.forAddress('BidCos-RF', 'JEQ0234567:1')).toHaveLength(1);
        expect(store.forAddress('BidCos-RF', 'NOBODY:1')).toEqual([]);
    });

    it('does nothing without an interface, forgets and reports failures', async () => {
        const transport = new MockTransport({demo: true});
        const notices = new NoticesStore(transport);
        const store = new LinksStore(transport, notices);
        await store.load('');
        await store.ensure('');
        expect(transport.countOf('links.list')).toBe(0);

        await store.load('BidCos-RF');
        await store.load('HmIP-RF');
        store.forget('HmIP-RF');
        expect(store.links['HmIP-RF']).toBeUndefined();
        store.forget();
        expect(store.links).toEqual({});

        transport.fail('links.list', 'getLinks failed');
        await store.load('BidCos-RF');
        expect(notices.items[0]?.message).toContain('getLinks failed');
        expect(store.isLoading('BidCos-RF')).toBe(false);
    });
});

describe('ServiceMessagesStore', () => {
    it('loads, counts per interface and acknowledges', async () => {
        const transport = new MockTransport({demo: true});
        const store = new ServiceMessagesStore(transport, new NoticesStore(transport));
        await store.load();

        expect(store.messages).toEqual(DEMO_SERVICE_MESSAGES);
        expect(store.countOf('BidCos-RF')).toBe(2);
        expect(store.countOf('HmIP-RF')).toBe(0);
        expect(store.of('BidCos-RF')).toHaveLength(2);

        await expect(store.acknowledge('BidCos-RF', 'KEQ0345678:0', 'STICKY_UNREACH')).resolves.toBe(true);
        expect(transport.lastCall('serviceMessages.ack')).toEqual(['BidCos-RF', 'KEQ0345678:0', 'STICKY_UNREACH']);
    });

    it('follows serviceMessages.changed until dispose and reports failures', async () => {
        const transport = new MockTransport({demo: true});
        const notices = new NoticesStore(transport);
        const store = new ServiceMessagesStore(transport, notices);

        transport.emit('serviceMessages.changed', []);
        expect(store.messages).toEqual([]);
        store.dispose();
        transport.emit('serviceMessages.changed', DEMO_SERVICE_MESSAGES);
        expect(store.messages).toEqual([]);

        transport.fail('serviceMessages.list', 'not supported');
        transport.fail('serviceMessages.ack', 'setValue failed');
        await store.load('BidCos-RF');
        await expect(store.acknowledge('BidCos-RF', 'A:0', 'STICKY_UNREACH')).resolves.toBe(false);
        expect(notices.items).toHaveLength(2);
        expect(store.loading).toBe(false);
    });
});

describe('EventsStore', () => {
    it('collects pushed events newest first and drops the oldest above the capacity', () => {
        const transport = new MockTransport();
        const store = new EventsStore(transport, new NoticesStore(transport), {capacity: 3});

        for (let index = 0; index < 4; index += 1) {
            transport.emit('rpc.event', {
                timestamp: index,
                interfaceName: 'BidCos-RF',
                method: 'event',
                address: `A:${index}`,
                datapoint: 'STATE',
                value: index,
            });
        }

        expect(store.size).toBe(3);
        expect(store.records.map((record) => record.address)).toEqual(['A:3', 'A:2', 'A:1']);
        expect(store.buffer.capacity).toBe(3);
    });

    it('filters with core’s event filter and counts per address', () => {
        const transport = new MockTransport();
        const store = new EventsStore(transport, new NoticesStore(transport));
        store.push({timestamp: 1, interfaceName: 'BidCos-RF', method: 'event', address: 'A:1', datapoint: 'STATE'});
        store.push({timestamp: 2, interfaceName: 'HmIP-RF', method: 'event', address: 'B:1', datapoint: 'LEVEL'});
        store.push({timestamp: 3, interfaceName: 'BidCos-RF', method: 'event', address: 'A:1', datapoint: 'PRESS'});

        expect(store.filtered({interfaceName: 'BidCos-RF'})).toHaveLength(2);
        expect(store.filtered({datapoint: 'level'})).toHaveLength(1);
        expect(store.countFor('A:1')).toBe(2);
        expect(store.countFor('C:1')).toBe(0);
    });

    it('loads the backend’s recent events and clears both sides', async () => {
        const transport = new MockTransport({demo: true});
        const store = new EventsStore(transport, new NoticesStore(transport));
        await store.load('BidCos-RF', 100);
        expect(transport.lastCall('events.recent')).toEqual(['BidCos-RF', 100]);
        expect(store.size).toBeGreaterThan(0);

        await store.clear();
        expect(store.size).toBe(0);
        expect(transport.countOf('events.clear')).toBe(1);
    });

    it('reports failures and stops listening after dispose', async () => {
        const transport = new MockTransport({demo: true});
        const notices = new NoticesStore(transport);
        const store = new EventsStore(transport, notices);
        transport.fail('events.recent', 'no buffer');
        transport.fail('events.clear', 'no buffer');
        await store.load();
        await store.clear();
        expect(notices.items).toHaveLength(2);

        store.dispose();
        transport.emit('rpc.event', {timestamp: 9, interfaceName: 'BidCos-RF', method: 'event'});
        expect(store.size).toBe(0);
    });
});

describe('WriteLogStore', () => {
    const entry = (id: number, ok = true): WriteLogEntry => ({
        id,
        timestamp: id,
        interfaceName: 'BidCos-RF',
        method: 'putParamset',
        params: ['A:1', 'MASTER', {}],
        ok,
        durationMs: 10,
    });

    it('appends what the backend logs, newest first, capped', () => {
        const transport = new MockTransport();
        const store = new WriteLogStore(transport, new NoticesStore(transport), {max: 2});
        transport.emit('writeLog.appended', entry(1));
        transport.emit('writeLog.appended', entry(2));
        transport.emit('writeLog.appended', entry(3));

        expect(store.entries.map((item) => item.id)).toEqual([2, 3]);
        expect(store.newestFirst.map((item) => item.id)).toEqual([3, 2]);
    });

    it('tracks in-flight writes and the bulk progress', () => {
        const transport = new MockTransport();
        const store = new WriteLogStore(transport, new NoticesStore(transport), {now: () => 42});
        expect(store.busy).toBe(false);

        const id = store.beginPending('BidCos-RF', 'putParamset', ['A:1', 'MASTER', {}]);
        expect(store.pending[0]).toMatchObject({id, method: 'putParamset', startedAt: 42});
        expect(store.busy).toBe(true);
        store.endPending(id);
        expect(store.busy).toBe(false);

        transport.emit('write.progress', {done: 1, total: 3});
        expect(store.progress).toEqual({done: 1, total: 3});
        expect(store.busy).toBe(true);
        transport.emit('write.progress', {done: 3, total: 3});
        expect(store.progress).toBeUndefined();
    });

    it('loads and clears, reports failures and stops after dispose', async () => {
        const transport = new MockTransport({demo: true});
        const notices = new NoticesStore(transport);
        const store = new WriteLogStore(transport, notices);
        await store.load(50);
        expect(transport.lastCall('writeLog.list')).toEqual([50]);
        expect(store.entries).toHaveLength(2);

        await store.clear();
        expect(store.entries).toEqual([]);

        transport.fail('writeLog.list', 'no log');
        transport.fail('writeLog.clear', 'no log');
        await store.load();
        await store.clear();
        expect(notices.items).toHaveLength(2);

        store.dispose();
        transport.emit('writeLog.appended', entry(9));
        expect(store.entries).toEqual([]);
    });
});

describe('Stores', () => {
    it('starts up in the 2.x order and loads the selected interface', async () => {
        const transport = new MockTransport({demo: true});
        const router = fakeRouter('');
        const stores = createStores(transport, {
            location: router.location,
            onHashChange: router.onHashChange,
            storage: new MemoryStorage(),
        });
        await stores.start();

        expect(stores.app.selectedInterface).toBe('BidCos-RF');
        expect(stores.i18n.language).toBe('de');
        expect(stores.devices.index('BidCos-RF')?.size).toBe(DEMO_DEVICES['BidCos-RF'].length);
        expect(stores.links.of('BidCos-RF')).toHaveLength(2);
        expect(stores.names.nameOf('MEQ0123456')).toBe('Licht Küche');
        expect(stores.serviceMessages.messages).toHaveLength(2);
        expect(stores.nameOf('nothing')).toBe('nothing');
        expect(stores.tabs).toEqual(['devices', 'links', 'rssi', 'console', 'messages', 'events']);

        stores.dispose();
        expect(transport.listenerCount('rpc.event')).toBe(0);
        expect(transport.listenerCount('notice')).toBe(0);
    });

    it('falls back to the devices tab when the new interface has no such tab', async () => {
        const transport = new MockTransport({demo: true});
        transport.result('interfaces.list', [
            {...DEMO_INTERFACE_STATES[0]!},
            {...DEMO_INTERFACE_STATES[1]!, name: 'BidCos-Wired', type: 'BidCos-Wired'},
        ]);
        const router = fakeRouter('#/BidCos-RF/rssi');
        const stores = createStores(transport, {
            location: router.location,
            onHashChange: router.onHashChange,
            storage: new MemoryStorage(),
        });
        await stores.start();
        expect(stores.app.tab).toBe('rssi');

        await stores.selectInterface('BidCos-Wired');
        expect(stores.app.tab).toBe('devices');
        expect(router.location.hash).toBe('#/BidCos-Wired/devices');
    });

    it('selectInterface with no interface loads nothing', async () => {
        const transport = new MockTransport({demo: true});
        const stores = createStores(transport, {location: fakeRouter().location, storage: new MemoryStorage()});
        await stores.selectInterface('');
        expect(transport.countOf('devices.list')).toBe(0);
    });

    it('refresh reloads the selected interface without its caches', async () => {
        const transport = new MockTransport({demo: true});
        const stores = createStores(transport, {location: fakeRouter().location, storage: new MemoryStorage()});
        await stores.start();
        transport.reset();
        await stores.refresh();

        expect(transport.lastCall('devices.list')).toEqual(['BidCos-RF', {refresh: true}]);
        expect(transport.countOf('links.list')).toBe(1);
        expect(transport.countOf('interfaces.list')).toBe(1);

        await stores.selectInterface('');
        transport.reset();
        await stores.refresh();
        expect(transport.calls).toEqual([]);
    });
});
