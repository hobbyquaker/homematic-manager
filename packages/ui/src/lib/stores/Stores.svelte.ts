import type {Transport} from '@homematic-manager/core';

import type {DataSource} from '@homematic-manager/core';

import type {HostBridge} from '../host/types.js';
import {I18n} from '../i18n/i18n.svelte.js';

import {AppStore, type AppStoreOptions} from './AppStore.svelte.js';
import {ChangeSetStore} from './ChangeSetStore.svelte.js';
import {ConsoleStore} from './ConsoleStore.svelte.js';
import {DevicesStore} from './DevicesStore.svelte.js';
import {EventsStore} from './EventsStore.svelte.js';
import {HostStore} from './HostStore.svelte.js';
import {InterfacesStore} from './InterfacesStore.svelte.js';
import {MetaStore} from './MetaStore.svelte.js';
import {LinksStore} from './LinksStore.svelte.js';
import {NamesStore} from './NamesStore.svelte.js';
import {NoticesStore} from './NoticesStore.svelte.js';
import {ParamsetStore} from './ParamsetStore.svelte.js';
import {RadioStore} from './RadioStore.svelte.js';
import {ServiceMessagesStore} from './ServiceMessagesStore.svelte.js';
import {TaxonomyStore} from './TaxonomyStore.svelte.js';
import {UnreachStore} from './UnreachStore.svelte.js';
import {isStoreTabId, storeTabs, tabsForInterface, type TabId} from './routing.js';
import {RpcLogStore} from './RpcLogStore.svelte.js';

export interface StoresOptions extends AppStoreOptions {
    /** Passed to the events ring buffer; the tests use a small one. */
    readonly eventCapacity?: number | undefined;
    /** The Electron host bridge. Absent in `apps/web`, the addon and every test that has no host. */
    readonly hostBridge?: HostBridge | undefined;
    /** Where to look for `window.__HMM_HOST__` when no bridge is injected. */
    readonly hostScope?: Record<string, unknown> | undefined;
    /** The device metadata of task 9; by default read over the transport's `data.file`. */
    readonly dataSource?: DataSource | undefined;
}

/**
 * Everything the shell needs, built around one `Transport`.
 *
 * The transport is injected, never imported: a component test builds this with a `MockTransport`
 * and gets the whole app state without a socket, and the Electron renderer builds it with the IPC
 * bridge the preload handed over. There is no module-level singleton anywhere in `lib/stores`.
 */
export class Stores {
    readonly transport: Transport;
    readonly i18n: I18n;
    readonly notices: NoticesStore;
    readonly app: AppStore;
    readonly interfaces: InterfacesStore;
    readonly devices: DevicesStore;
    readonly names: NamesStore;
    readonly links: LinksStore;
    readonly serviceMessages: ServiceMessagesStore;
    /** Issue #26: how often each device went unreachable. */
    readonly unreach: UnreachStore;
    readonly events: EventsStore;
    readonly rpcLog: RpcLogStore;
    readonly host: HostStore;
    readonly meta: MetaStore;
    /** D-40, task 25: rooms, functions and the state of the store they come from. */
    readonly taxonomy: TaxonomyStore;
    readonly paramsets: ParamsetStore;
    readonly radio: RadioStore;
    readonly console: ConsoleStore;
    /** Issue #124: what is staged and not written yet. */
    readonly changeSet: ChangeSetStore;

    constructor(transport: Transport, options: StoresOptions = {}) {
        this.transport = transport;
        this.notices = new NoticesStore(transport);
        this.app = new AppStore(transport, this.notices, options);
        this.i18n = new I18n(this.app.language);
        this.interfaces = new InterfacesStore(transport, this.notices);
        this.devices = new DevicesStore(transport, this.notices);
        this.names = new NamesStore(transport, this.notices);
        this.links = new LinksStore(transport, this.notices);
        this.serviceMessages = new ServiceMessagesStore(transport, this.notices);
        this.unreach = new UnreachStore(transport, this.notices);
        this.events = new EventsStore(transport, this.notices, {
            ...(options.eventCapacity === undefined ? {} : {capacity: options.eventCapacity}),
        });
        this.rpcLog = new RpcLogStore(transport, this.notices);
        this.meta = new MetaStore(transport, {
            ...(options.dataSource === undefined ? {} : {source: options.dataSource}),
        });
        this.taxonomy = new TaxonomyStore(transport, this.notices);
        this.paramsets = new ParamsetStore(transport, this.notices);
        this.radio = new RadioStore(transport, this.notices);
        this.console = new ConsoleStore(transport, this.notices);
        this.changeSet = new ChangeSetStore(transport, this.notices, this.rpcLog);
        this.host = new HostStore({
            ...(options.hostBridge === undefined ? {} : {bridge: options.hostBridge}),
            ...(options.hostScope === undefined ? {} : {scope: options.hostScope}),
        });
    }

    /**
     * The tabs the selected interface offers, in the 2.7 order - or, when the metadata store is the
     * selection, the store's own tabs (rooms and functions on ReGaHSS, the tree on occulited).
     */
    get tabs(): TabId[] {
        if (this.app.storeSelected) {
            return storeTabs(this.taxonomy.state);
        }
        return tabsForInterface(this.interfaces.typeOf(this.app.selectedInterface));
    }

    /** The friendly name of an address, or the address - the Name column of every grid. */
    readonly nameOf = (address: string): string => this.names.nameOf(address);

    /**
     * Start-up, in the order 2.x used: configuration first (it decides the interfaces and the
     * language), then names, then whatever the selected interface needs.
     */
    async start(): Promise<void> {
        await this.app.load();
        this.i18n.language = this.app.language;
        // The CCU string tables are 3 MB per language and nothing waits for them: a dialog that
        // opens before they arrive shows the CCU's identifiers and re-renders when they do.
        void this.meta.setLanguage(this.app.language).catch(() => undefined);
        // The host is optional and must never hold up the CCU work, so its failure is swallowed.
        void this.host.load().catch(() => undefined);
        await Promise.all([this.interfaces.load(), this.names.load(), this.rpcLog.load(), this.taxonomy.load()]);
        // A bookmark of the store's pages (`#/%23store/rooms`) on a host that has no store, or
        // whose store does not answer: the first interface, as an unknown name in the hash gets.
        const selected =
            this.app.storeSelected && storeTabs(this.taxonomy.state).length === 0
                ? (this.app.configuredInterfaces[0] ?? '')
                : this.app.selectedInterface;
        await this.selectInterface(selected);
    }

    /**
     * Switches the interface and loads what the tabs need. A tab the new interface does not offer
     * falls back to Devices, exactly as `initDaemon` did for BidCos-Wired.
     *
     * The metadata store is a selection too (`STORE_INTERFACE`): it loads nothing of the interface
     * stores, opens on its first tab, and hands the interface its tab back on the way out.
     */
    async selectInterface(interfaceName: string): Promise<void> {
        const wasStore = this.app.storeSelected;
        this.app.setInterface(interfaceName);
        if (this.app.storeSelected) {
            if (!isStoreTabId(this.app.tab) || !this.tabs.includes(this.app.tab)) {
                this.app.setTab(this.tabs[0] ?? 'metadata');
            }
            return;
        }
        if (wasStore || isStoreTabId(this.app.tab)) {
            this.app.setTab(this.app.interfaceTab);
        }
        if (!this.tabs.includes(this.app.tab)) {
            this.app.setTab('devices');
        }
        if (interfaceName === '') {
            return;
        }
        await Promise.all([
            this.devices.ensure(interfaceName),
            this.links.ensure(interfaceName),
            this.serviceMessages.load(),
            this.events.load(),
        ]);
    }

    /** Reloads everything of the selected interface, ignoring the backend's caches. */
    async refresh(): Promise<void> {
        const interfaceName = this.app.selectedInterface;
        if (interfaceName === '' || this.app.storeSelected) {
            return;
        }
        await Promise.all([
            this.devices.load(interfaceName, {refresh: true}),
            this.links.load(interfaceName),
            this.serviceMessages.load(),
            this.interfaces.load(),
        ]);
    }

    dispose(): void {
        this.radio.dispose();
        this.host.dispose();
        this.rpcLog.dispose();
        this.events.dispose();
        this.serviceMessages.dispose();
        this.taxonomy.dispose();
        this.names.dispose();
        this.devices.dispose();
        this.interfaces.dispose();
        this.app.dispose();
        this.notices.dispose();
    }
}

export function createStores(transport: Transport, options: StoresOptions = {}): Stores {
    return new Stores(transport, options);
}
