/**
 * The `Transport` of the contract, implemented without a wire.
 *
 * Electron's main process holds the backend in-process and could call it directly, but the UI is
 * written against `Transport` and nothing else - so main uses this to serve the renderer through
 * IPC (task 11) and the tests use it to drive the whole backend without a socket. The only
 * difference to the WebSocket transport is that nothing is serialised, so a test that passes here
 * and fails there has found a value that is not JSON.
 */

import type {ApiEventName, ApiEvents, ApiMethodName, ApiParams, ApiResult, Transport} from '@homematic-manager/core';

import type {Backend} from './backend.js';

/** A `Transport` that calls the backend directly. */
export class InProcessTransport implements Transport {
    readonly #backend: Backend;
    readonly #connectionListeners = new Set<(connected: boolean) => void>();
    #connected = true;

    constructor(backend: Backend) {
        this.#backend = backend;
    }

    get connected(): boolean {
        return this.#connected;
    }

    request<M extends ApiMethodName>(method: M, ...params: ApiParams<M>): Promise<ApiResult<M>> {
        return this.#backend.request(method, ...params);
    }

    on<E extends ApiEventName>(event: E, handler: (payload: ApiEvents[E]) => void): () => void {
        return this.#backend.on(event, handler);
    }

    onConnectionChange(handler: (connected: boolean) => void): () => void {
        this.#connectionListeners.add(handler);
        return () => {
            this.#connectionListeners.delete(handler);
        };
    }

    /**
     * The host says when the backend goes away - Electron main calls this before it quits, so the
     * renderer can grey itself out instead of waiting for a request that never returns.
     */
    setConnected(connected: boolean): void {
        if (this.#connected === connected) {
            return;
        }
        this.#connected = connected;
        for (const handler of [...this.#connectionListeners]) {
            handler(connected);
        }
    }
}
