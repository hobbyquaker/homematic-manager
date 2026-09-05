import type {ServiceMessage, Transport} from '@homematic-manager/core';
import {isAcknowledgeable} from '@homematic-manager/core';

import {defaultStorage, type StorageLike} from './AppStore.svelte.js';
import type {NoticesStore} from './NoticesStore.svelte.js';

/** Where the quiet-mode choice of issue #102 is kept. */
export const QUIET_STORAGE_KEY = 'hmm.serviceMessages.quiet';

export interface ServiceMessagesStoreOptions {
    /** `localStorage` by default; the tests pass a `Map`-backed stub. */
    readonly storage?: StorageLike | undefined;
}

/**
 * The service messages of every interface.
 *
 * The count in the tab label comes from here. 2.x popped a modal for every new message, which is
 * how it managed to close a paramset dialog the user was in the middle of (#77) - new messages now
 * land in the list and, at most, in a toast.
 */
export class ServiceMessagesStore {
    messages = $state<ServiceMessage[]>([]);
    loading = $state(false);
    /**
     * Quiet mode (#102): the list and the tab counter still update, only the toast is suppressed.
     * 2.x had no way to stop the modal that popped up for every message.
     */
    quiet = $state(false);

    readonly #transport: Transport;
    readonly #notices: NoticesStore;
    readonly #storage: StorageLike | undefined;
    readonly #unsubscribe: () => void;
    /** `<interface>|<address>|<datapoint>` of everything that has already been announced. */
    #announced: string[] = [];
    /** The first list is the state of the world, not news; nothing is announced for it. */
    #seeded = false;

    constructor(transport: Transport, notices: NoticesStore, options: ServiceMessagesStoreOptions = {}) {
        this.#transport = transport;
        this.#notices = notices;
        this.#storage = options.storage === undefined ? defaultStorage() : options.storage;
        this.quiet = this.#storage?.getItem(QUIET_STORAGE_KEY) === 'true';
        this.#unsubscribe = transport.on('serviceMessages.changed', (messages) => {
            this.apply(asList(messages));
        });
    }

    /**
     * Takes a new list and announces what is new in it.
     *
     * Issue #77: 2.x opened a modal for every arriving message, which closed whatever dialog the
     * user was in the middle of - a half-filled paramset editor included. A toast cannot do that,
     * and quiet mode turns even the toast off.
     */
    apply(messages: ServiceMessage[]): void {
        const known = this.#announced;
        const fresh = messages.filter((message) => !known.includes(keyOf(message)));
        this.messages = messages;
        this.#announced = messages.map((message) => keyOf(message));
        if (!this.#seeded) {
            // Opening the app is not the moment to be told about six messages one toast at a time;
            // the tab counter and the list already say so.
            this.#seeded = true;
            return;
        }
        if (this.quiet) {
            return;
        }
        for (const message of fresh) {
            this.#notices.push('warn', `${message.address} ${message.datapoint}`, message.interfaceName);
        }
    }

    setQuiet(quiet: boolean): void {
        this.quiet = quiet;
        this.#storage?.setItem(QUIET_STORAGE_KEY, String(quiet));
    }

    /** The messages of an interface that `serviceMessages.ack` can actually clear. */
    acknowledgeable(interfaceName: string): ServiceMessage[] {
        return this.of(interfaceName).filter((message) => isAcknowledgeable(message.datapoint));
    }

    of(interfaceName: string): ServiceMessage[] {
        return this.messages.filter((message) => message.interfaceName === interfaceName);
    }

    countOf(interfaceName: string): number {
        return this.of(interfaceName).length;
    }

    async load(interfaceName?: string): Promise<void> {
        this.loading = true;
        try {
            this.apply(asList(await this.#transport.request('serviceMessages.list', interfaceName)));
        } catch (error) {
            this.#notices.fromError(error, 'serviceMessages.list');
        } finally {
            this.loading = false;
        }
    }

    /** Acknowledges one message by writing its datapoint; the backend answers with the new list. */
    async acknowledge(interfaceName: string, address: string, datapoint: string): Promise<boolean> {
        try {
            await this.#transport.request('serviceMessages.ack', interfaceName, address, datapoint);
            return true;
        } catch (error) {
            this.#notices.fromError(error, `serviceMessages.ack ${address} ${datapoint}`);
            return false;
        }
    }

    /**
     * Acknowledges a whole selection. `STICKY_UNREACH` and `SABOTAGE` are the two the CCU lets an
     * application clear by writing the datapoint; everything else goes away when the cause does.
     */
    async acknowledgeMany(messages: ReadonlyArray<ServiceMessage>): Promise<number> {
        let done = 0;
        for (const message of messages) {
            if (!isAcknowledgeable(message.datapoint)) {
                continue;
            }
            if (await this.acknowledge(message.interfaceName, message.address, message.datapoint)) {
                done += 1;
            }
        }
        if (done > 0) {
            await this.load();
        }
        return done;
    }

    dispose(): void {
        this.#unsubscribe();
    }
}

function keyOf(message: ServiceMessage): string {
    return `${message.interfaceName}|${message.address}|${message.datapoint}`;
}

/**
 * `getServiceMessages` on rfd answers the empty **string** when there is nothing, not an empty
 * array (task 6, measured on hardware). The backend normalises its own reads, but an event carries
 * whatever the interface process produced, and one `.filter()` on a string is a blank tab.
 */
function asList(messages: unknown): ServiceMessage[] {
    return Array.isArray(messages) ? (messages as ServiceMessage[]) : [];
}
