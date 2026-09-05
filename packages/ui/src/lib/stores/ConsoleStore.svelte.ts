import type {RpcMethodInfo, RpcValue, Transport} from '@homematic-manager/core';

import type {NoticesStore} from './NoticesStore.svelte.js';

/** One call of the console, with what came back. */
export interface ConsoleCall {
    readonly id: number;
    readonly timestamp: number;
    readonly interfaceName: string;
    readonly method: string;
    readonly params: readonly RpcValue[];
    readonly ok: boolean;
    readonly result?: RpcValue;
    readonly error?: string;
    readonly faultCode?: number;
    readonly durationMs: number;
}

export interface ConsoleStoreOptions {
    /** How many calls the history keeps. */
    readonly max?: number;
    readonly now?: () => number;
}

/**
 * The RPC console: which methods an interface offers, and what the console has called so far.
 *
 * The method list comes from the backend, which merges the shipped catalogue with the interface's
 * own `system.listMethods` and `system.methodHelp` - so a CUxD or a Homegear that offers other
 * methods gets a usable console without any vendor-specific code (D-20).
 */
export class ConsoleStore {
    methods = $state<Record<string, RpcMethodInfo[]>>({});
    history = $state<ConsoleCall[]>([]);
    running = $state(false);

    readonly #transport: Transport;
    readonly #notices: NoticesStore;
    readonly #max: number;
    readonly #now: () => number;
    #nextId = 1;

    constructor(transport: Transport, notices: NoticesStore, options: ConsoleStoreOptions = {}) {
        this.#transport = transport;
        this.#notices = notices;
        this.#max = options.max ?? 50;
        this.#now = options.now ?? (() => Date.now());
    }

    of(interfaceName: string): RpcMethodInfo[] {
        return this.methods[interfaceName] ?? [];
    }

    method(interfaceName: string, name: string): RpcMethodInfo | undefined {
        return this.of(interfaceName).find((entry) => entry.name === name);
    }

    /** Loads the catalogue of an interface once. */
    async load(interfaceName: string): Promise<void> {
        if (interfaceName === '' || this.methods[interfaceName]) {
            return;
        }
        try {
            this.methods = {
                ...this.methods,
                [interfaceName]: await this.#transport.request('rpc.methods', interfaceName),
            };
        } catch (error) {
            this.#notices.fromError(error, `rpc.methods ${interfaceName}`);
        }
    }

    /**
     * Sends one call and records it. A fault is a result, not an exception: the console exists to
     * see what an interface answers, including its faults, so nothing here becomes a toast.
     */
    async call(interfaceName: string, method: string, params: RpcValue[]): Promise<ConsoleCall> {
        this.running = true;
        const started = this.#now();
        const id = this.#nextId;
        this.#nextId += 1;
        let entry: ConsoleCall;
        try {
            const result = await this.#transport.request('rpc.call', interfaceName, method, params);
            entry = {
                id,
                timestamp: started,
                interfaceName,
                method,
                params,
                ok: true,
                result,
                durationMs: this.#now() - started,
            };
        } catch (error) {
            const fault = error as {message?: string; faultCode?: number};
            entry = {
                id,
                timestamp: started,
                interfaceName,
                method,
                params,
                ok: false,
                error: fault.message ?? String(error),
                ...(fault.faultCode === undefined ? {} : {faultCode: fault.faultCode}),
                durationMs: this.#now() - started,
            };
        } finally {
            this.running = false;
        }
        const history = [entry, ...this.history];
        this.history = history.length > this.#max ? history.slice(0, this.#max) : history;
        return entry;
    }

    clear(): void {
        this.history = [];
    }
}
