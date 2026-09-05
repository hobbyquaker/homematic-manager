import type {ServiceMessage, Transport} from '@homematic-manager/core';

import type {NoticesStore} from './NoticesStore.svelte.js';

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

    readonly #transport: Transport;
    readonly #notices: NoticesStore;
    readonly #unsubscribe: () => void;

    constructor(transport: Transport, notices: NoticesStore) {
        this.#transport = transport;
        this.#notices = notices;
        this.#unsubscribe = transport.on('serviceMessages.changed', (messages) => {
            this.messages = asList(messages);
        });
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
            this.messages = asList(await this.#transport.request('serviceMessages.list', interfaceName));
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

    dispose(): void {
        this.#unsubscribe();
    }
}

/**
 * `getServiceMessages` on rfd answers the empty **string** when there is nothing, not an empty
 * array (task 6, measured on hardware). The backend normalises its own reads, but an event carries
 * whatever the interface process produced, and one `.filter()` on a string is a blank tab.
 */
function asList(messages: unknown): ServiceMessage[] {
    return Array.isArray(messages) ? (messages as ServiceMessage[]) : [];
}
