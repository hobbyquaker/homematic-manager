import type {
    ApiError,
    ApiEventName,
    ApiEvents,
    ApiFrame,
    ApiMethodName,
    ApiParams,
    ApiResult,
    Transport,
} from '@homematic-manager/core';

import {ApiRequestError, isApiError} from './error.js';

/** The part of `WebSocket` this transport uses; a test supplies its own. */
export interface WebSocketLike {
    readonly readyState: number;
    send(data: string): void;
    close(code?: number, reason?: string): void;
    onopen: ((event: unknown) => void) | null;
    onclose: ((event: unknown) => void) | null;
    onerror: ((event: unknown) => void) | null;
    onmessage: ((event: {data: unknown}) => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

/** `WebSocket.OPEN`; spelled out so the transport does not need the global to exist. */
const OPEN = 1;

export interface WebSocketTransportOptions {
    /** `ws://host/api` or `wss://host/addons/hmm/api`. */
    readonly url: string;
    /** Defaults to `new WebSocket(url)`. */
    readonly factory?: WebSocketFactory;
    /** How long a request may wait for its answer, and for the socket to open. 30 s by default. */
    readonly requestTimeoutMs?: number;
    /** Reconnect after a close. On by default; a test that asserts on one socket turns it off. */
    readonly reconnect?: boolean;
    /** First reconnect delay; doubles up to `maxBackoffMs`. */
    readonly minBackoffMs?: number;
    readonly maxBackoffMs?: number;
    /** Open the socket in the constructor. On by default. */
    readonly autoConnect?: boolean;
}

interface Pending {
    readonly method: ApiMethodName;
    readonly resolve: (value: never) => void;
    readonly reject: (error: ApiRequestError) => void;
    timer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * `ApiFrame` JSON over a WebSocket: what `apps/web` (task 12) and the CCU addon (task 13) serve.
 *
 * Requests get an increasing id and a timeout, events are dispatched by name, and a lost socket is
 * reconnected with exponential backoff. Every pending request of a dropped socket rejects with
 * `kind: 'connection'` rather than hanging - 2.x had no such thing, which is why its RPC dialog
 * could sit on "in progress" forever after the CCU rebooted.
 */
export class WebSocketTransport implements Transport {
    readonly url: string;

    readonly #factory: WebSocketFactory;
    readonly #requestTimeoutMs: number;
    readonly #reconnect: boolean;
    readonly #minBackoffMs: number;
    readonly #maxBackoffMs: number;

    readonly #pending = new Map<number, Pending>();
    readonly #listeners = new Map<ApiEventName, Set<(payload: never) => void>>();
    readonly #connectionListeners = new Set<(connected: boolean) => void>();
    readonly #openWaiters = new Set<{resolve: () => void; reject: (error: ApiRequestError) => void}>();

    #socket: WebSocketLike | undefined;
    #connected = false;
    #closed = false;
    #nextId = 1;
    #backoffMs: number;
    #reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(options: WebSocketTransportOptions) {
        this.url = options.url;
        this.#factory = options.factory ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
        this.#requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
        this.#reconnect = options.reconnect ?? true;
        this.#minBackoffMs = options.minBackoffMs ?? 500;
        this.#maxBackoffMs = options.maxBackoffMs ?? 15_000;
        this.#backoffMs = this.#minBackoffMs;
        if (options.autoConnect ?? true) {
            this.connect();
        }
    }

    get connected(): boolean {
        return this.#connected;
    }

    /** The delay before the next reconnect attempt; visible so a test can assert the backoff. */
    get backoffMs(): number {
        return this.#backoffMs;
    }

    /** Opens the socket. Does nothing when one is already open or opening. */
    connect(): void {
        this.#closed = false;
        if (this.#socket) {
            return;
        }
        const socket = this.#factory(this.url);
        this.#socket = socket;
        socket.onopen = () => {
            this.#backoffMs = this.#minBackoffMs;
            this.#setConnected(true);
            for (const waiter of [...this.#openWaiters]) {
                this.#openWaiters.delete(waiter);
                waiter.resolve();
            }
        };
        socket.onmessage = (event) => {
            this.#handleMessage(event.data);
        };
        socket.onerror = () => {
            // A socket error is always followed by a close; the close does the work.
        };
        socket.onclose = () => {
            this.#handleClose();
        };
    }

    /** Closes the socket for good: no reconnect, every pending request rejects. */
    close(): void {
        this.#closed = true;
        if (this.#reconnectTimer !== undefined) {
            clearTimeout(this.#reconnectTimer);
            this.#reconnectTimer = undefined;
        }
        const socket = this.#socket;
        this.#socket = undefined;
        socket?.close();
        this.#failAll('transport closed');
        this.#setConnected(false);
    }

    async request<M extends ApiMethodName>(method: M, ...params: ApiParams<M>): Promise<ApiResult<M>> {
        await this.#whenOpen(method);
        const socket = this.#socket;
        if (!socket || socket.readyState !== OPEN) {
            throw new ApiRequestError({message: `not connected to ${this.url}`, kind: 'connection'});
        }
        const id = this.#nextId;
        this.#nextId += 1;
        const frame: ApiFrame = {t: 'req', id, m: method, p: params as unknown[]};
        return new Promise<ApiResult<M>>((resolve, reject) => {
            const pending: Pending = {
                method,
                resolve: resolve as (value: never) => void,
                reject,
                timer: undefined,
            };
            pending.timer = setTimeout(() => {
                this.#pending.delete(id);
                reject(
                    new ApiRequestError({
                        message: `${method} timed out after ${this.#requestTimeoutMs} ms`,
                        kind: 'connection',
                    }),
                );
            }, this.#requestTimeoutMs);
            this.#pending.set(id, pending);
            try {
                socket.send(JSON.stringify(frame));
            } catch (error) {
                this.#settle(id, undefined, {
                    message: error instanceof Error ? error.message : String(error),
                    kind: 'connection',
                });
            }
        });
    }

    on<E extends ApiEventName>(event: E, handler: (payload: ApiEvents[E]) => void): () => void {
        const handlers = this.#listeners.get(event) ?? new Set<(payload: never) => void>();
        handlers.add(handler as (payload: never) => void);
        this.#listeners.set(event, handlers);
        return () => {
            handlers.delete(handler as (payload: never) => void);
        };
    }

    onConnectionChange(handler: (connected: boolean) => void): () => void {
        this.#connectionListeners.add(handler);
        return () => {
            this.#connectionListeners.delete(handler);
        };
    }

    #whenOpen(method: ApiMethodName): Promise<void> {
        if (this.#connected) {
            return Promise.resolve();
        }
        if (this.#closed) {
            return Promise.reject(new ApiRequestError({message: 'transport closed', kind: 'connection'}));
        }
        return new Promise<void>((resolve, reject) => {
            const waiter = {
                resolve: () => {
                    clearTimeout(timer);
                    resolve();
                },
                reject: (error: ApiRequestError) => {
                    clearTimeout(timer);
                    reject(error);
                },
            };
            const timer = setTimeout(() => {
                this.#openWaiters.delete(waiter);
                reject(
                    new ApiRequestError({
                        message: `${method} gave up waiting for ${this.url}`,
                        kind: 'connection',
                    }),
                );
            }, this.#requestTimeoutMs);
            this.#openWaiters.add(waiter);
        });
    }

    #handleMessage(data: unknown): void {
        if (typeof data !== 'string') {
            return;
        }
        // `unknown` and not `as ApiFrame`: the assertion would tell the compiler the guard below
        // is pointless, when the guard is the only thing standing between `JSON.parse('5')` and a
        // property access on a number.
        let parsed: unknown;
        try {
            parsed = JSON.parse(data);
        } catch {
            return;
        }
        if (typeof parsed !== 'object' || parsed === null) {
            return;
        }
        const frame = parsed as ApiFrame;
        switch (frame.t) {
            case 'res':
                this.#settle(frame.id, frame.r, undefined);
                break;
            case 'err':
                this.#settle(
                    frame.id,
                    undefined,
                    isApiError(frame.e) ? frame.e : {message: 'malformed error frame', kind: 'internal'},
                );
                break;
            case 'ev': {
                const handlers = this.#listeners.get(frame.n);
                if (handlers) {
                    for (const handler of [...handlers]) {
                        (handler as (payload: unknown) => void)(frame.d);
                    }
                }
                break;
            }
            default:
                break;
        }
    }

    #settle(id: number, result: unknown, error: ApiError | undefined): void {
        const pending = this.#pending.get(id);
        if (!pending) {
            return;
        }
        this.#pending.delete(id);
        if (pending.timer !== undefined) {
            clearTimeout(pending.timer);
        }
        if (error) {
            pending.reject(new ApiRequestError(error));
        } else {
            (pending.resolve as (value: unknown) => void)(result);
        }
    }

    #handleClose(): void {
        this.#socket = undefined;
        this.#setConnected(false);
        this.#failAll(`connection to ${this.url} was lost`);
        if (this.#closed || !this.#reconnect) {
            return;
        }
        const delay = this.#backoffMs;
        this.#backoffMs = Math.min(this.#backoffMs * 2, this.#maxBackoffMs);
        this.#reconnectTimer = setTimeout(() => {
            this.#reconnectTimer = undefined;
            this.connect();
        }, delay);
    }

    #failAll(message: string): void {
        for (const [id, pending] of [...this.#pending]) {
            this.#pending.delete(id);
            if (pending.timer !== undefined) {
                clearTimeout(pending.timer);
            }
            pending.reject(new ApiRequestError({message, kind: 'connection'}));
        }
        for (const waiter of [...this.#openWaiters]) {
            this.#openWaiters.delete(waiter);
            waiter.reject(new ApiRequestError({message, kind: 'connection'}));
        }
    }

    #setConnected(connected: boolean): void {
        if (this.#connected === connected) {
            return;
        }
        this.#connected = connected;
        for (const handler of [...this.#connectionListeners]) {
            handler(connected);
        }
    }
}
