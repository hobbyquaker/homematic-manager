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

/** How many toasts are on screen at once; the rest collapse into a counter (D-34). */
export const VISIBLE_NOTICES = 5;

/** An informational toast is gone after this long, unless it was dismissed first. */
export const INFO_TTL_MS = 5_000;

/** A warning stays three times as long: it is worth reading, but not worth a click. */
export const WARN_TTL_MS = 15_000;

export interface NoticesStoreOptions {
    /** How many notices are kept at all; the oldest is dropped. */
    readonly max?: number;
    readonly now?: () => number;
    /** Lifetime of an `info` toast in ms; `0` keeps it until it is dismissed. */
    readonly infoTtlMs?: number;
    /** Lifetime of a `warn` toast in ms; `0` keeps it until it is dismissed. */
    readonly warnTtlMs?: number;
}

/**
 * Everything the user should see but must not be interrupted by.
 *
 * 2.x had `dialogAlert()`: a modal that closed whatever else was open, which is how a service
 * message arriving mid-edit could throw away a half-filled paramset dialog (#77). Here a backend
 * `notice` event and a rejected request both become a dismissable toast, and nothing steals focus.
 *
 * D-34, after the first look at a dev build: the toasts piled into a wall that covered the bottom
 * of the window and stayed there. Three rules now keep the stack short, and they are deliberately
 * different per level:
 *
 * - an `info` toast is a receipt ("this write went out"). It has been read by the time the next
 *   thing happens, so it expires on its own after {@link INFO_TTL_MS}.
 * - a `warn` gets {@link WARN_TTL_MS} - long enough to notice, short enough not to accumulate.
 * - an `error` never expires. Something failed; the user decides when that is dealt with.
 *
 * The last rule is why the on-screen cap ({@link VISIBLE_NOTICES}) is a *view* and not a drop: an
 * error must not be able to vanish behind five status messages, so what leaves the screen when the
 * sixth toast arrives stays in `items` and is counted. As the info toasts expire, the errors
 * underneath surface again on their own.
 */
export class NoticesStore {
    items = $state<Notice[]>([]);

    readonly #max: number;
    readonly #now: () => number;
    readonly #infoTtlMs: number;
    readonly #warnTtlMs: number;
    readonly #unsubscribe: () => void;
    // Bookkeeping for the expiry timers, deliberately not reactive: nothing renders from it, and a
    // SvelteMap here would invalidate the toast stack on every timer that starts or is cleared.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- see above
    readonly #timers = new Map<number, ReturnType<typeof setTimeout>>();
    #nextId = 1;

    constructor(transport: Transport, options: NoticesStoreOptions = {}) {
        this.#max = options.max ?? 20;
        this.#now = options.now ?? (() => Date.now());
        this.#infoTtlMs = options.infoTtlMs ?? INFO_TTL_MS;
        this.#warnTtlMs = options.warnTtlMs ?? WARN_TTL_MS;
        this.#unsubscribe = transport.on('notice', (notice) => {
            this.push(notice.level, notice.message, notice.interfaceName);
        });
    }

    /** The newest {@link VISIBLE_NOTICES} - what the toast stack draws. */
    get visible(): Notice[] {
        return this.items.slice(Math.max(0, this.items.length - VISIBLE_NOTICES));
    }

    /** How many are held but not on screen; the "n more" counter. */
    get hidden(): number {
        return Math.max(0, this.items.length - VISIBLE_NOTICES);
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
        const dropped = items.length > this.#max ? items.slice(0, items.length - this.#max) : [];
        for (const gone of dropped) {
            this.#stopTimer(gone.id);
        }
        this.items = dropped.length > 0 ? items.slice(dropped.length) : items;
        this.#startTimer(id, level);
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
        this.#stopTimer(id);
        this.items = this.items.filter((notice) => notice.id !== id);
    }

    clear(): void {
        for (const id of [...this.#timers.keys()]) {
            this.#stopTimer(id);
        }
        this.items = [];
    }

    dispose(): void {
        this.clear();
        this.#unsubscribe();
    }

    /** The lifetime of a level, `0` for "until dismissed". */
    #ttl(level: Notice['level']): number {
        if (level === 'info') {
            return this.#infoTtlMs;
        }
        return level === 'warn' ? this.#warnTtlMs : 0;
    }

    #startTimer(id: number, level: Notice['level']): void {
        const ttl = this.#ttl(level);
        if (ttl <= 0) {
            return;
        }
        const timer = setTimeout(() => {
            this.#timers.delete(id);
            this.items = this.items.filter((notice) => notice.id !== id);
        }, ttl);
        // A toast must never be the reason a Node process (the jsdom test run) stays alive.
        (timer as unknown as {unref?: () => void}).unref?.();
        this.#timers.set(id, timer);
    }

    #stopTimer(id: number): void {
        const timer = this.#timers.get(id);
        if (timer !== undefined) {
            clearTimeout(timer);
            this.#timers.delete(id);
        }
    }
}
