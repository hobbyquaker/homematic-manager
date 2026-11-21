import type {InterfaceState, RegaState, Transport} from '@homematic-manager/core';

import type {NoticesStore} from './NoticesStore.svelte.js';

/**
 * Which interface processes answer, and whether ReGa does.
 *
 * This is what the header's ✔/✕ marks and the Radio tab's interface grid read. ReGa is optional
 * (D-2): `reachable: false` is a status, never an error, and never stops anything.
 */
export class InterfacesStore {
    states = $state<InterfaceState[]>([]);
    /** B-104: whether the states have been read (or pushed) once; until then nobody knows what is absent. */
    known = $state(false);
    rega = $state<RegaState | undefined>(undefined);
    loading = $state(false);
    /**
     * Task 115: each interface's `system.listMethods`, fetched once when first asked for; `null`
     * when it gave no usable list. Missing while the answer is on its way.
     */
    methodNames = $state<Record<string, readonly string[] | null>>({});
    // bookkeeping only: what has been asked for must not re-run the views that ask
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- see above
    readonly #methodsRequested = new Set<string>();

    readonly #transport: Transport;
    readonly #notices: NoticesStore;
    readonly #unsubscribe: Array<() => void> = [];

    constructor(transport: Transport, notices: NoticesStore) {
        this.#transport = transport;
        this.#notices = notices;
        this.#unsubscribe.push(
            transport.on('interfaces.changed', (states) => {
                this.states = states;
                this.known = true;
            }),
            transport.on('rega.changed', (rega) => {
                this.rega = rega;
            }),
        );
    }

    get(name: string): InterfaceState | undefined {
        return this.states.find((state) => state.name === name);
    }

    /** The interface's `type`, which decides the tabs and the device columns; `''` if unknown. */
    typeOf(name: string): string {
        return this.get(name)?.type ?? '';
    }

    /**
     * Task 115: the methods the interface lists, `undefined` while unknown or without a usable list.
     * The first call starts the request; the answer lands in {@link methodNames}.
     */
    methodsOf(name: string): readonly string[] | undefined {
        if (name !== '' && !this.#methodsRequested.has(name)) {
            this.#methodsRequested.add(name);
            void this.#transport.request('interfaces.methodNames', name).then(
                (names) => {
                    this.methodNames = {...this.methodNames, [name]: names};
                },
                () => {
                    // no list is the old rule; ask again on the next look
                    this.#methodsRequested.delete(name);
                },
            );
        }
        return this.methodNames[name] ?? undefined;
    }

    /**
     * B-104: the interface is configured but the system has no such process - BidCos-RF on an
     * openccu-lite system in the HmIP-only mode, BidCos-Wired without a wired gateway. Nothing is
     * read from it.
     */
    isAbsent(name: string): boolean {
        return this.get(name)?.absent === true;
    }

    /**
     * B-104: whether a view may read from the interface by itself - once the states are known, and
     * not when it is absent. A view that mounted before the start had read them asked an absent
     * BidCos-RF for its links, its gateways and its methods.
     */
    readable(name: string): boolean {
        return name !== '' && this.known && !this.isAbsent(name);
    }

    isConnected(name: string): boolean {
        return this.get(name)?.connected === true;
    }

    /**
     * True when every interface that exists on this system answers - the header's overall state.
     *
     * An interface the backend marked `absent` does not count: its port refuses the connection, so
     * the process is not installed at all. BidCos-Wired is in the default list and missing on every
     * CCU without a wired gateway, and treating that as "something is wrong" would put a warning on
     * a perfectly healthy system (task 13, task 15).
     */
    get allConnected(): boolean {
        const present = this.states.filter((state) => state.absent !== true);
        return present.length > 0 && present.every((state) => state.connected);
    }

    async load(): Promise<void> {
        this.loading = true;
        try {
            this.states = await this.#transport.request('interfaces.list');
        } catch (error) {
            this.#notices.fromError(error, 'interfaces.list');
        } finally {
            this.loading = false;
            // a failed list is known as well: nothing is absent then, as before B-104
            this.known = true;
        }
        try {
            this.rega = await this.#transport.request('rega.state');
        } catch (error) {
            // D-2: a ReGa that does not answer is a status, not a failure of the app.
            this.rega = {enabled: true, reachable: false, names: 0, error: String(error)};
        }
    }

    async reconnect(interfaceName?: string): Promise<void> {
        try {
            await this.#transport.request('interfaces.reconnect', interfaceName);
        } catch (error) {
            this.#notices.fromError(error, 'interfaces.reconnect');
        }
    }

    dispose(): void {
        for (const off of this.#unsubscribe) {
            off();
        }
        this.#unsubscribe.length = 0;
    }
}
