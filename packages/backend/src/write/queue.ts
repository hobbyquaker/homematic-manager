/**
 * The paced write queue.
 *
 * Every write to an interface goes through it, every read goes past it. That split is the point:
 * 2.x serialised *everything* through one modal dialog with a fixed 3 s delay
 * (`main.js:47`, `homematic-manager.js:4619`), so opening a paramset editor took seconds and a
 * multi-apply to 100 channels took five minutes with the UI blocked. Reads are cheap and idempotent
 * and never need pacing; writes do, because an interface process that is fed faster than the radio
 * can carry queues configuration it may never deliver.
 *
 * One queue per interface, so a slow HmIP write does not hold up a BidCos one, and the pace is
 * per interface too (`writePaceFor()`: HmIP gets double).
 *
 * A bulk operation can be cancelled. `cancel()` rejects everything that has not started yet with
 * `kind: 'connection'` and lets the running task finish - a `putParamset` that is already on the
 * wire cannot be taken back, and pretending otherwise would be worse than waiting for it.
 */

import {BackendError} from '../errors.js';

interface QueuedTask {
    readonly run: () => void;
    readonly cancel: (error: BackendError) => void;
}

export interface WriteQueueOptions {
    /** The minimum pause before the next write of that interface. */
    readonly paceFor: (interfaceName: string) => number;
    /** Injected clock and timer, so a test does not wait. */
    readonly now?: () => number;
    readonly schedule?: (callback: () => void, ms: number) => void;
}

/** Rejected tasks carry this message; the UI shows it as a notice, not as a failed write. */
export const CANCELLED_MESSAGE = 'the write was cancelled';

export class WriteQueue {
    readonly #options: WriteQueueOptions;
    readonly #now: () => number;
    readonly #schedule: (callback: () => void, ms: number) => void;

    readonly #pending = new Map<string, QueuedTask[]>();
    readonly #running = new Set<string>();
    readonly #lastStart = new Map<string, number>();

    constructor(options: WriteQueueOptions) {
        this.#options = options;
        this.#now = options.now ?? (() => Date.now());
        this.#schedule =
            options.schedule ??
            ((callback, ms) => {
                const timer = setTimeout(callback, ms);
                if (typeof timer.unref === 'function') {
                    timer.unref();
                }
            });
    }

    /** How many tasks are waiting, over all interfaces. */
    get pending(): number {
        let total = 0;
        for (const queue of this.#pending.values()) {
            total += queue.length;
        }
        return total;
    }

    /** Queues a write. The promise settles with whatever the task does. */
    enqueue<T>(interfaceName: string, task: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const queue = this.#pending.get(interfaceName) ?? [];
            queue.push({
                run: () => {
                    this.#lastStart.set(interfaceName, this.#now());
                    task().then(
                        (value) => {
                            this.#finish(interfaceName);
                            resolve(value);
                        },
                        (error: unknown) => {
                            this.#finish(interfaceName);
                            reject(error instanceof Error ? error : new Error(String(error)));
                        },
                    );
                },
                cancel: reject,
            });
            this.#pending.set(interfaceName, queue);
            this.#drain(interfaceName);
        });
    }

    /**
     * Rejects everything that has not started. A task that is already running is left alone; its
     * result still arrives.
     */
    cancel(interfaceName?: string): number {
        const names = interfaceName === undefined ? [...this.#pending.keys()] : [interfaceName];
        let cancelled = 0;
        for (const name of names) {
            const queue = this.#pending.get(name) ?? [];
            this.#pending.set(name, []);
            for (const task of queue) {
                cancelled += 1;
                task.cancel(new BackendError({message: CANCELLED_MESSAGE, kind: 'connection'}));
            }
        }
        return cancelled;
    }

    #finish(interfaceName: string): void {
        this.#running.delete(interfaceName);
        this.#drain(interfaceName);
    }

    #drain(interfaceName: string): void {
        if (this.#running.has(interfaceName)) {
            return;
        }
        const queue = this.#pending.get(interfaceName);
        const next = queue?.shift();
        if (!next) {
            return;
        }
        this.#running.add(interfaceName);
        const pace = this.#options.paceFor(interfaceName);
        const since = this.#now() - (this.#lastStart.get(interfaceName) ?? Number.NEGATIVE_INFINITY);
        const wait = Math.max(0, pace - since);
        if (wait === 0) {
            next.run();
        } else {
            this.#schedule(() => next.run(), wait);
        }
    }
}
