import type {LinkRecord, Transport} from '@homematic-manager/core';
import {decodeLinkFlags} from '@homematic-manager/core';

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

    /** The links whose `FLAGS` say one side could not be written - issue #79. */
    defective(interfaceName: string): LinkRecord[] {
        return this.of(interfaceName).filter((link) => decodeLinkFlags(link.FLAGS).broken);
    }

    /**
     * `addLink` for every sender/receiver combination, as 2.x's `createLinks` did. Returns how many
     * were created; a failure is reported and the rest are still attempted.
     */
    async add(
        interfaceName: string,
        senders: readonly string[],
        receivers: readonly string[],
        name?: string,
        description?: string,
    ): Promise<number> {
        const pairs = senders.flatMap((sender) =>
            receivers.map((receiver) => ({
                sender,
                receiver,
                ...(name === undefined ? {} : {name}),
                ...(description === undefined ? {} : {description}),
            })),
        );
        return this.addPairs(interfaceName, pairs);
    }

    /**
     * `addLink` for a list of pairs that each carry their own name and description - issue #87.
     *
     * 2.7 had one name field for the whole dialog, so creating one sender against six blinds gave
     * six links called the same thing, and telling them apart afterwards meant opening each one and
     * renaming it. The pairs are created in the order they are given.
     */
    async addPairs(
        interfaceName: string,
        pairs: ReadonlyArray<{sender: string; receiver: string; name?: string; description?: string}>,
    ): Promise<number> {
        let created = 0;
        for (const pair of pairs) {
            try {
                await this.#transport.request(
                    'links.add',
                    interfaceName,
                    pair.sender,
                    pair.receiver,
                    pair.name,
                    pair.description,
                );
                created += 1;
            } catch (error) {
                this.#notices.fromError(error, `addLink ${pair.sender} ${pair.receiver}`);
            }
        }
        if (created > 0) {
            await this.load(interfaceName);
        }
        return created;
    }

    /** `removeLink` for a whole selection - issue #80; 2.x could only remove the selected row. */
    async remove(interfaceName: string, links: ReadonlyArray<{sender: string; receiver: string}>): Promise<number> {
        let removed = 0;
        for (const link of links) {
            try {
                await this.#transport.request('links.remove', interfaceName, link.sender, link.receiver);
                removed += 1;
            } catch (error) {
                this.#notices.fromError(error, `removeLink ${link.sender} ${link.receiver}`);
            }
        }
        if (removed > 0) {
            await this.load(interfaceName);
        }
        return removed;
    }

    async info(interfaceName: string, sender: string, receiver: string): Promise<LinkRecord | undefined> {
        try {
            return await this.#transport.request('links.info.get', interfaceName, sender, receiver);
        } catch (error) {
            this.#notices.fromError(error, `getLinkInfo ${sender} ${receiver}`);
            return undefined;
        }
    }

    /** `setLinkInfo` - the name and description of one link. */
    async setInfo(
        interfaceName: string,
        sender: string,
        receiver: string,
        name: string,
        description: string,
    ): Promise<boolean> {
        try {
            await this.#transport.request('links.info.set', interfaceName, sender, receiver, name, description);
            await this.load(interfaceName);
            return true;
        } catch (error) {
            this.#notices.fromError(error, `setLinkInfo ${sender} ${receiver}`);
            return false;
        }
    }

    /**
     * `activateLinkParamset` - the "play" buttons. It makes the receiver do what the link would do
     * on a short (or long) press, without touching the sender; BidCos-RF only.
     */
    async activate(interfaceName: string, receiver: string, sender: string, long: boolean): Promise<boolean> {
        try {
            await this.#transport.request('links.activate', interfaceName, receiver, sender, long);
            return true;
        } catch (error) {
            this.#notices.fromError(error, `activateLinkParamset ${receiver} ${sender}`);
            return false;
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
