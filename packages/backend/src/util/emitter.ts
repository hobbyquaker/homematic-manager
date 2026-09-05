/**
 * The event side of the API contract.
 *
 * `ApiEvents` names the payload of every event the backend pushes; this emitter is typed by it, so
 * a typo in an event name or a payload that does not fit is a compile error rather than an event
 * the UI never receives. Node's own `EventEmitter` would have done the work but not the typing, and
 * it throws on an unhandled `error` event - which is exactly what a backend must not do.
 */

import type {ApiEventName, ApiEvents} from '@homematic-manager/core';

export type ApiEventHandler<E extends ApiEventName> = (payload: ApiEvents[E]) => void;

/** Anything that lets a caller subscribe to the backend's events. */
export interface ApiEventSource {
    on<E extends ApiEventName>(event: E, handler: ApiEventHandler<E>): () => void;
}

/** A typed fan-out; a throwing handler never stops the others. */
export class ApiEventEmitter implements ApiEventSource {
    readonly #handlers = new Map<ApiEventName, Set<(payload: never) => void>>();
    readonly #any = new Set<(event: ApiEventName, payload: unknown) => void>();
    readonly #onHandlerError: (event: ApiEventName, error: unknown) => void;

    constructor(onHandlerError: (event: ApiEventName, error: unknown) => void = () => undefined) {
        this.#onHandlerError = onHandlerError;
    }

    /** Subscribes; the returned function unsubscribes. */
    on<E extends ApiEventName>(event: E, handler: ApiEventHandler<E>): () => void {
        const handlers = this.#handlers.get(event) ?? new Set<(payload: never) => void>();
        handlers.add(handler as (payload: never) => void);
        this.#handlers.set(event, handlers);
        return () => {
            handlers.delete(handler as (payload: never) => void);
        };
    }

    /** Subscribes to every event; used by the transports, which forward all of them. */
    onAny(handler: <E extends ApiEventName>(event: E, payload: ApiEvents[E]) => void): () => void {
        this.#any.add(handler as (event: ApiEventName, payload: unknown) => void);
        return () => {
            this.#any.delete(handler as (event: ApiEventName, payload: unknown) => void);
        };
    }

    /** How many handlers listen to an event; a test asserts that nothing leaks. */
    listenerCount(event: ApiEventName): number {
        return this.#handlers.get(event)?.size ?? 0;
    }

    emit<E extends ApiEventName>(event: E, payload: ApiEvents[E]): void {
        for (const handler of [...(this.#handlers.get(event) ?? [])]) {
            try {
                (handler as (value: ApiEvents[E]) => void)(payload);
            } catch (error) {
                this.#onHandlerError(event, error);
            }
        }
        for (const handler of [...this.#any]) {
            try {
                handler(event, payload);
            } catch (error) {
                this.#onHandlerError(event, error);
            }
        }
    }

    /** Drops every subscription; part of `Backend.stop()`. */
    clear(): void {
        this.#handlers.clear();
        this.#any.clear();
    }
}
