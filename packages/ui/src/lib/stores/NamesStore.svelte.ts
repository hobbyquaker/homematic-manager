import type {NameMap, Transport} from '@homematic-manager/core';

import type {NoticesStore} from './NoticesStore.svelte.js';

/**
 * Friendly names for devices and channels.
 *
 * They come from ReGa when it is there and from the backend's local store when it is not (D-2), so
 * the UI must never assume an address has a name: `nameOf()` falls back to the address, which is
 * what the 2.x grid did with `names[address] || address`.
 */
export class NamesStore {
    names = $state<NameMap>({});

    readonly #transport: Transport;
    readonly #notices: NoticesStore;
    readonly #unsubscribe: () => void;

    constructor(transport: Transport, notices: NoticesStore) {
        this.#transport = transport;
        this.#notices = notices;
        this.#unsubscribe = transport.on('names.changed', (names) => {
            this.names = names;
        });
    }

    /** The name of an address, or `undefined` when nothing named it. */
    name(address: string): string | undefined {
        return this.names[address];
    }

    /** The name of an address, falling back to the address itself. */
    nameOf(address: string): string {
        return this.names[address] ?? address;
    }

    /** How many names are known - the ReGa status line in the settings dialog shows this. */
    get size(): number {
        return Object.keys(this.names).length;
    }

    async load(): Promise<void> {
        try {
            this.names = await this.#transport.request('names.get');
        } catch (error) {
            this.#notices.fromError(error, 'names.get');
        }
    }

    /** Renames one or more addresses; the backend answers with the complete map. */
    async rename(entries: Array<{address: string; name: string}>): Promise<boolean> {
        try {
            this.names = await this.#transport.request('names.set', entries);
            return true;
        } catch (error) {
            this.#notices.fromError(error, 'names.set');
            return false;
        }
    }

    dispose(): void {
        this.#unsubscribe();
    }
}
