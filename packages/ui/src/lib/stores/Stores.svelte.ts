import type {Transport} from '@homematic-manager/core';

import {I18n} from '../i18n/i18n.svelte.js';

import {AppStore, type AppStoreOptions} from './AppStore.svelte.js';
import {DevicesStore} from './DevicesStore.svelte.js';
import {EventsStore} from './EventsStore.svelte.js';
import {InterfacesStore} from './InterfacesStore.svelte.js';
import {LinksStore} from './LinksStore.svelte.js';
import {NamesStore} from './NamesStore.svelte.js';
import {NoticesStore} from './NoticesStore.svelte.js';
import {ServiceMessagesStore} from './ServiceMessagesStore.svelte.js';
import {tabsForInterface, type TabId} from './routing.js';
import {WriteLogStore} from './WriteLogStore.svelte.js';

export interface StoresOptions extends AppStoreOptions {
    /** Passed to the events ring buffer; the tests use a small one. */
    readonly eventCapacity?: number | undefined;
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
    readonly events: EventsStore;
    readonly writeLog: WriteLogStore;

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
        this.events = new EventsStore(transport, this.notices, {
            ...(options.eventCapacity === undefined ? {} : {capacity: options.eventCapacity}),
        });
        this.writeLog = new WriteLogStore(transport, this.notices);
    }

    /** The tabs the selected interface offers, in the 2.7 order. */
    get tabs(): TabId[] {
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
        await Promise.all([this.interfaces.load(), this.names.load(), this.writeLog.load()]);
        await this.selectInterface(this.app.selectedInterface);
    }

    /**
     * Switches the interface and loads what the tabs need. A tab the new interface does not offer
     * falls back to Devices, exactly as `initDaemon` did for BidCos-Wired.
     */
    async selectInterface(interfaceName: string): Promise<void> {
        this.app.setInterface(interfaceName);
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
        if (interfaceName === '') {
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
        this.writeLog.dispose();
        this.events.dispose();
        this.serviceMessages.dispose();
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
