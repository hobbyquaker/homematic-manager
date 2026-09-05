import type {LinkRecord, Transport} from '@homematic-manager/core';

import type {NoticesStore} from './NoticesStore.svelte.js';

/** The direct links of every interface that has been visited. */
export class LinksStore {
    links = $state<Record<string, LinkRecord[]>>({});
    loading = $state<Record<string, boolean>>({});

    readonly #transport: Transport;
    readonly #notices: NoticesStore;

    constructor(transport: Transport, notices: NoticesStore) {
        this.#transport = transport;
        this.#notices = notices;
    }

    of(interfaceName: string): LinkRecord[] {
        return this.links[interfaceName] ?? [];
    }

    isLoading(interfaceName: string): boolean {
        return this.loading[interfaceName] === true;
    }

    /** The links one channel takes part in, as sender or as receiver. */
    forAddress(interfaceName: string, address: string): LinkRecord[] {
        return this.of(interfaceName).filter((link) => link.SENDER === address || link.RECEIVER === address);
    }

    async load(interfaceName: string): Promise<void> {
        if (interfaceName === '') {
            return;
        }
        this.loading = {...this.loading, [interfaceName]: true};
        try {
            this.links = {...this.links, [interfaceName]: await this.#transport.request('links.list', interfaceName)};
        } catch (error) {
            this.#notices.fromError(error, `links.list ${interfaceName}`);
        } finally {
            this.loading = {...this.loading, [interfaceName]: false};
        }
    }

    async ensure(interfaceName: string): Promise<void> {
        if (interfaceName === '' || this.links[interfaceName] || this.isLoading(interfaceName)) {
            return;
        }
        await this.load(interfaceName);
    }

    forget(interfaceName?: string): void {
        if (interfaceName === undefined) {
            this.links = {};
            return;
        }
        this.links = Object.fromEntries(Object.entries(this.links).filter(([name]) => name !== interfaceName));
    }
}
