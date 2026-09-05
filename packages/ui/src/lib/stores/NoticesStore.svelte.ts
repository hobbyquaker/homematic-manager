import type {ApiEvents, Transport} from '@homematic-manager/core';

import {toApiRequestError} from '../transport/error.js';

export interface Notice {
    readonly id: number;
    readonly level: ApiEvents['notice']['level'];
    readonly message: string;
    readonly interfaceName?: string;
    /** Milliseconds since epoch. */
    readonly timestamp: number;
}

export interface NoticesStoreOptions {
    /** How many notices are kept; the oldest is dropped. */
    readonly max?: number;
    readonly now?: () => number;
}

/**
 * Everything the user should see but must not be interrupted by.
 *
 * 2.x had `dialogAlert()`: a modal that closed whatever else was open, which is how a service
 * message arriving mid-edit could throw away a half-filled paramset dialog (#77). Here a backend
 * `notice` event and a rejected request both become a dismissable toast, and nothing steals focus.
 */
export class NoticesStore {
    items = $state<Notice[]>([]);

    readonly #max: number;
    readonly #now: () => number;
    readonly #unsubscribe: () => void;
    #nextId = 1;

    constructor(transport: Transport, options: NoticesStoreOptions = {}) {
        this.#max = options.max ?? 20;
        this.#now = options.now ?? (() => Date.now());
        this.#unsubscribe = transport.on('notice', (notice) => {
            this.push(notice.level, notice.message, notice.interfaceName);
        });
    }

    /** Adds a notice and returns its id. */
    push(level: Notice['level'], message: string, interfaceName?: string): number {
        const id = this.#nextId;
        this.#nextId += 1;
        const notice: Notice = {
            id,
            level,
            message,
            timestamp: this.#now(),
            ...(interfaceName === undefined ? {} : {interfaceName}),
        };
        const items = [...this.items, notice];
        this.items = items.length > this.#max ? items.slice(items.length - this.#max) : items;
        return id;
    }

    /**
     * Turns anything a request rejected with into an error notice. `context` prefixes the message
     * with what was being attempted, the way the 2.x alert put the daemon and method in front.
     */
    fromError(error: unknown, context?: string): number {
        const apiError = toApiRequestError(error);
        const fault =
            apiError.faultCode === undefined
                ? ''
                : ` (${apiError.faultString ?? apiError.message}, ${String(apiError.faultCode)})`;
        const message = `${context === undefined ? '' : `${context}: `}${apiError.message}${fault}`;
        return this.push('error', message);
    }

    dismiss(id: number): void {
        this.items = this.items.filter((notice) => notice.id !== id);
    }

    clear(): void {
        this.items = [];
    }

    dispose(): void {
        this.#unsubscribe();
    }
}
