import type {DeviceDescription, Transport} from '@homematic-manager/core';
import {DeviceIndex} from '@homematic-manager/core';

import type {NoticesStore} from './NoticesStore.svelte.js';

/**
 * The devices of every interface that has been visited, as core's immutable `DeviceIndex`.
 *
 * 2.x kept `listDevices`, `indexChannels`, `indexSourceRoles` and `indexTargetRoles` as globals and
 * rebuilt them while rendering the grid; switching interfaces mid-request could mix two interfaces'
 * devices into one index. Here every interface has its own index, and a late answer for an
 * interface is still stored under that interface - never under the one that happens to be selected.
 */
export class DevicesStore {
    /** Interface name -> index. Reassigned on every change so the components re-render. */
    indexes = $state<Record<string, DeviceIndex>>({});
    loading = $state<Record<string, boolean>>({});

    readonly #transport: Transport;
    readonly #notices: NoticesStore;
    readonly #unsubscribe: Array<() => void> = [];

    constructor(transport: Transport, notices: NoticesStore) {
        this.#transport = transport;
        this.#notices = notices;
        this.#unsubscribe.push(
            transport.on('devices.changed', (change) => {
                if (this.indexes[change.interfaceName]) {
                    void this.load(change.interfaceName, {refresh: false});
                }
            }),
        );
    }

    index(interfaceName: string): DeviceIndex | undefined {
        return this.indexes[interfaceName];
    }

    /** The devices of an interface, sorted by address; empty while nothing is loaded. */
    devices(interfaceName: string): DeviceDescription[] {
        return this.indexes[interfaceName]?.devices() ?? [];
    }

    channels(interfaceName: string, deviceAddress: string): DeviceDescription[] {
        return this.indexes[interfaceName]?.childrenOf(deviceAddress) ?? [];
    }

    isLoading(interfaceName: string): boolean {
        return this.loading[interfaceName] === true;
    }

    /** Loads (or reloads) one interface. `refresh` bypasses the backend's device cache. */
    async load(interfaceName: string, options: {refresh?: boolean} = {}): Promise<void> {
        if (interfaceName === '') {
            return;
        }
        this.loading = {...this.loading, [interfaceName]: true};
        try {
            const descriptions = await this.#transport.request('devices.list', interfaceName, {
                refresh: options.refresh ?? false,
            });
            this.indexes = {...this.indexes, [interfaceName]: new DeviceIndex(interfaceName, descriptions)};
        } catch (error) {
            this.#notices.fromError(error, `devices.list ${interfaceName}`);
        } finally {
            this.loading = {...this.loading, [interfaceName]: false};
        }
    }

    /** Ensures an interface is loaded once; a second call while it is present does nothing. */
    async ensure(interfaceName: string): Promise<void> {
        if (interfaceName === '' || this.indexes[interfaceName] || this.isLoading(interfaceName)) {
            return;
        }
        await this.load(interfaceName);
    }

    /** Drops one interface's index, or all of them. */
    forget(interfaceName?: string): void {
        if (interfaceName === undefined) {
            this.indexes = {};
            return;
        }
        this.indexes = Object.fromEntries(Object.entries(this.indexes).filter(([name]) => name !== interfaceName));
    }

    dispose(): void {
        for (const off of this.#unsubscribe) {
            off();
        }
        this.#unsubscribe.length = 0;
    }
}
