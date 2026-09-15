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

/** A call to put back into the console's form: an entry of the RPC log, "opened in console". */
export interface ConsoleRecall {
    readonly interfaceName: string;
    readonly method: string;
    readonly params: readonly RpcValue[];
}

export interface ConsoleStoreOptions {
    readonly now?: () => number;
}

/**
 * The RPC console: which methods an interface offers, and the one call in flight.
 *
 * The method list comes from the backend, which merges the shipped catalogue with the interface's
 * own `system.listMethods` and `system.methodHelp` - so a CUxD or a Homegear that offers other
 * methods gets a usable console without any vendor-specific code (D-20).
 *
 * Task 48: the console keeps no history of its own any more. Every call it makes is in the global
 * RPC log like every other outgoing call (the maintainer: "we have our global rpc protokoll"),
 * and an entry there can be opened in the console - that is {@link recall}, which the console
 * page takes up when it is shown for the entry's interface.
 */
export class ConsoleStore {
    methods = $state<Record<string, RpcMethodInfo[]>>({});
    running = $state(false);
    /** The log entry to put into the form next, until the console page has taken it. */
    pendingRecall = $state<ConsoleRecall | undefined>(undefined);

    readonly #transport: Transport;
    readonly #notices: NoticesStore;
    readonly #now: () => number;
    #nextId = 1;

    constructor(transport: Transport, notices: NoticesStore, options: ConsoleStoreOptions = {}) {
        this.#transport = transport;
        this.#notices = notices;
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
     * Sends one call. A fault is a result, not an exception: the console exists to see what an
     * interface answers, including its faults, so nothing here becomes a toast. The call itself
     * lands in the RPC log through the backend, as every outgoing call does.
     */
    async call(interfaceName: string, method: string, params: RpcValue[]): Promise<ConsoleCall> {
        this.running = true;
        const started = this.#now();
        const id = this.#nextId;
        this.#nextId += 1;
        try {
            const result = await this.#transport.request('rpc.call', interfaceName, method, params);
            return {
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
            return {
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
    }

    /** "Open in console" on an RPC log entry: kept until the console page for that interface takes it. */
    recall(call: ConsoleRecall): void {
        this.pendingRecall = {interfaceName: call.interfaceName, method: call.method, params: [...call.params]};
    }

    /** The console page's side: the recall for its interface, if there is one, and it is consumed. */
    takeRecall(interfaceName: string): ConsoleRecall | undefined {
        const pending = this.pendingRecall;
        if (pending === undefined || pending.interfaceName !== interfaceName) {
            return undefined;
        }
        this.pendingRecall = undefined;
        return pending;
    }
}
