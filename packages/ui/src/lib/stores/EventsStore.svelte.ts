import type {EventFilter, EventRecord, Transport} from '@homematic-manager/core';
import {DEFAULT_EVENT_BUFFER_SIZE, filterEvents, RingBuffer} from '@homematic-manager/core';

import type {NoticesStore} from './NoticesStore.svelte.js';

export interface EventsStoreOptions {
    /** 8192 by default, the number of rows the 2.x events grid kept. */
    readonly capacity?: number;
}

/**
 * The live event stream, in core's fixed-size ring buffer.
 *
 * The buffer is a plain class, so it is not reactive by itself; a version counter is bumped on
 * every push and `records` is derived from it. That way a busy CCU costs one array copy per render
 * instead of one per event - 2.x rebuilt the whole grid on a one-second timer for the same reason.
 */
export class EventsStore {
    readonly buffer: RingBuffer<EventRecord>;

    #version = $state(0);
    /** Newest first, which is the order the 2.x grid sorted by. */
    readonly records: EventRecord[] = $derived.by(() => {
        void this.#version;
        return this.buffer.toArray().reverse();
    });

    readonly #transport: Transport;
    readonly #notices: NoticesStore;
    readonly #unsubscribe: () => void;

    constructor(transport: Transport, notices: NoticesStore, options: EventsStoreOptions = {}) {
        this.buffer = new RingBuffer<EventRecord>(options.capacity ?? DEFAULT_EVENT_BUFFER_SIZE);
        this.#transport = transport;
        this.#notices = notices;
        this.#unsubscribe = transport.on('rpc.event', (record) => {
            this.push(record);
        });
    }

    get size(): number {
        void this.#version;
        return this.buffer.size;
    }

    push(record: EventRecord): void {
        this.buffer.push(record);
        this.#version += 1;
    }

    /** Newest first, narrowed by core's event filter. */
    filtered(filter: EventFilter): EventRecord[] {
        void this.#version;
        return filterEvents(this.buffer, filter).reverse();
    }

    /** How many events an address produced - the per-device counter of #129. */
    countFor(address: string): number {
        void this.#version;
        return this.buffer.filter((record) => record.address === address).length;
    }

    /** Fills the buffer from what the backend already saw before the UI connected. */
    async load(interfaceName?: string, limit?: number): Promise<void> {
        try {
            const records = await this.#transport.request('events.recent', interfaceName, limit);
            for (const record of records) {
                this.buffer.push(record);
            }
            this.#version += 1;
        } catch (error) {
            this.#notices.fromError(error, 'events.recent');
        }
    }

    /** Empties the buffer here and, if the backend keeps one, there too. */
    async clear(): Promise<void> {
        this.buffer.clear();
        this.#version += 1;
        try {
            await this.#transport.request('events.clear');
        } catch (error) {
            this.#notices.fromError(error, 'events.clear');
        }
    }

    dispose(): void {
        this.#unsubscribe();
    }
}
