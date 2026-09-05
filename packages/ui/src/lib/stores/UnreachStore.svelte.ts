import type {Transport, UnreachCounter} from '@homematic-manager/core';

import type {NoticesStore} from './NoticesStore.svelte.js';

/**
 * Issue #26: how often each device has gone unreachable, shown in the Funk tab.
 *
 * The counting and the persistence are the backend's (`UnreachCache`); this only mirrors them and
 * keeps the mirror up to date through `unreach.changed`, which the backend emits whenever a device
 * changes state or a counter is reset. Nothing here counts anything itself: two clients on the same
 * backend must see the same numbers.
 */
export class UnreachStore {
    counters = $state<UnreachCounter[]>([]);

    readonly #transport: Transport;
    readonly #notices: NoticesStore;
    readonly #unsubscribe: () => void;

    constructor(transport: Transport, notices: NoticesStore) {
        this.#transport = transport;
        this.#notices = notices;
        this.#unsubscribe = transport.on('unreach.changed', (counters) => {
            this.counters = counters;
        });
    }

    /** The counter of one device (a channel address is fine; the device is what counts). */
    countOf(interfaceName: string, address: string): number {
        const device = address.split(':')[0] ?? address;
        return (
            this.counters.find((entry) => entry.interfaceName === interfaceName && entry.address === device)?.count ?? 0
        );
    }

    /** Is that device unreachable right now? */
    isUnreach(interfaceName: string, address: string): boolean {
        const device = address.split(':')[0] ?? address;
        return (
            this.counters.find((entry) => entry.interfaceName === interfaceName && entry.address === device)
                ?.unreach === true
        );
    }

    of(interfaceName: string): UnreachCounter[] {
        return this.counters.filter((entry) => entry.interfaceName === interfaceName);
    }

    async load(): Promise<void> {
        try {
            this.counters = await this.#transport.request('unreach.list');
        } catch (error) {
            this.#notices.fromError(error, 'unreach.list');
        }
    }

    /** Resets one device, one interface or every counter. */
    async reset(interfaceName?: string, address?: string): Promise<boolean> {
        try {
            await this.#transport.request('unreach.reset', interfaceName, address);
            await this.load();
            return true;
        } catch (error) {
            this.#notices.fromError(error, 'unreach.reset');
            return false;
        }
    }

    dispose(): void {
        this.#unsubscribe();
    }
}
