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
    rega = $state<RegaState | undefined>(undefined);
    loading = $state(false);

    readonly #transport: Transport;
    readonly #notices: NoticesStore;
    readonly #unsubscribe: Array<() => void> = [];

    constructor(transport: Transport, notices: NoticesStore) {
        this.#transport = transport;
        this.#notices = notices;
        this.#unsubscribe.push(
            transport.on('interfaces.changed', (states) => {
                this.states = states;
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

    isConnected(name: string): boolean {
        return this.get(name)?.connected === true;
    }

    /** True when every configured interface answers - the header's overall state. */
    get allConnected(): boolean {
        return this.states.length > 0 && this.states.every((state) => state.connected);
    }

    async load(): Promise<void> {
        this.loading = true;
        try {
            this.states = await this.#transport.request('interfaces.list');
        } catch (error) {
            this.#notices.fromError(error, 'interfaces.list');
        } finally {
            this.loading = false;
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
