import type {ApiEvents, RpcLogEntry, RpcValue, Transport} from '@homematic-manager/core';

import type {NoticesStore} from './NoticesStore.svelte.js';

/** A write that has been sent and has no answer yet. */
export interface PendingWrite {
    readonly id: number;
    readonly interfaceName: string;
    readonly method: string;
    readonly params: RpcValue[];
    /** Milliseconds since epoch. */
    readonly startedAt: number;
}

export interface RpcLogStoreOptions {
    /** How many finished entries are kept in the drawer. */
    readonly max?: number;
    readonly now?: () => number;
}

/**
 * The session RPC log, and the in-flight writes on top of it.
 *
 * This replaces the modal `dialog-rpc` of 2.x. That dialog blocked the whole window for every
 * single call, queued the calls behind itself (`rpcDialogShift`) and, when one failed, left the
 * user with a modal they had to dismiss before they could see anything else. The same information
 * - method, parameters, result or fault, duration - now goes into a drawer that can stay open, and
 * a bulk write reports through `write.progress` instead of a stack of modals.
 *
 * Task 48: the backend logs every outgoing call, not only the writes - the keep-alive, the
 * `init`s, the `listDevices` sweeps included - and says where each came from. The background
 * ones are frequent and rarely what a user is looking for, so the drawer can hide them; the
 * switch lives here so the drawer and whoever else lists the log agree.
 */
export class RpcLogStore {
    entries = $state<RpcLogEntry[]>([]);
    pending = $state<PendingWrite[]>([]);
    /** Progress of the running bulk write, or `undefined` when none is running. */
    progress = $state<ApiEvents['write.progress'] | undefined>(undefined);
    /** Task 48: leave the backend's own calls out of the drawer. */
    hideBackground = $state(false);

    readonly #transport: Transport;
    readonly #notices: NoticesStore;
    readonly #max: number;
    readonly #now: () => number;
    readonly #unsubscribe: Array<() => void> = [];
    #nextPendingId = 1;

    constructor(transport: Transport, notices: NoticesStore, options: RpcLogStoreOptions = {}) {
        this.#transport = transport;
        this.#notices = notices;
        this.#max = options.max ?? 200;
        this.#now = options.now ?? (() => Date.now());
        this.#unsubscribe.push(
            transport.on('rpcLog.appended', (entry) => {
                this.append(entry);
            }),
            transport.on('write.progress', (progress) => {
                this.progress = progress.done >= progress.total ? undefined : progress;
            }),
        );
    }

    /** True while anything is in flight - what the drawer's spinner and the header dot show. */
    get busy(): boolean {
        return this.pending.length > 0 || this.progress !== undefined;
    }

    /** The finished entries, newest first. */
    get newestFirst(): RpcLogEntry[] {
        return [...this.entries].reverse();
    }

    /** What the drawer shows: newest first, without the background calls when they are hidden. */
    get visible(): RpcLogEntry[] {
        const all = this.newestFirst;
        return this.hideBackground ? all.filter((entry) => entry.origin !== 'background') : all;
    }

    append(entry: RpcLogEntry): void {
        const entries = [...this.entries, entry];
        this.entries = entries.length > this.#max ? entries.slice(entries.length - this.#max) : entries;
    }

    /**
     * Records a write the UI just sent, so the drawer can show it as running. Returns the id to
     * pass to {@link endPending} when the answer arrives.
     */
    beginPending(interfaceName: string, method: string, params: RpcValue[]): number {
        const id = this.#nextPendingId;
        this.#nextPendingId += 1;
        this.pending = [...this.pending, {id, interfaceName, method, params, startedAt: this.#now()}];
        return id;
    }

    endPending(id: number): void {
        this.pending = this.pending.filter((write) => write.id !== id);
    }

    async load(limit?: number): Promise<void> {
        try {
            this.entries = await this.#transport.request('rpcLog.list', limit);
        } catch (error) {
            this.#notices.fromError(error, 'rpcLog.list');
        }
    }

    /**
     * Cancels the running bulk write. Task 6 item 4 wants a bulk operation to be stoppable; the
     * backend answers with how many targets it dropped, and the progress event that follows closes
     * the modal.
     */
    async cancel(interfaceName?: string): Promise<number> {
        try {
            return await this.#transport.request('write.cancel', interfaceName);
        } catch (error) {
            this.#notices.fromError(error, 'write.cancel');
            return 0;
        }
    }

    async clear(): Promise<void> {
        this.entries = [];
        try {
            await this.#transport.request('rpcLog.clear');
        } catch (error) {
            this.#notices.fromError(error, 'rpcLog.clear');
        }
    }

    dispose(): void {
        for (const off of this.#unsubscribe) {
            off();
        }
        this.#unsubscribe.length = 0;
    }
}
