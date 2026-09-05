/**
 * D-32: the sessions the `rega` login hands out, and the rate limit that guards it.
 *
 * A session is a random id, the CCU user it belongs to and an expiry that slides: every request
 * that presents it pushes the expiry out again, so a tab that is being used never logs itself out
 * and one that was left open over the weekend does. They live in memory only - a restart of the
 * host is a logout, which on the CCU is what a restart of the addon should be.
 *
 * The rate limit is per source and counts *failures* only: five within a minute and the sixth
 * attempt is refused without asking ReGa at all. It is deliberately not a lockout of the user -
 * that would let anybody lock the CCU's admin out by guessing at it - and it is per source, so one
 * browser fumbling its password does not stop another.
 */

import {randomBytes} from 'node:crypto';

/** How long a session lives without being used. 24 hours, as D-32 asks. */
export const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/** Failures per source per window before the login stops answering. */
export const LOGIN_FAILURE_LIMIT = 5;

/** The window those failures are counted in. */
export const LOGIN_FAILURE_WINDOW_MS = 60_000;

export interface Session {
    readonly id: string;
    readonly user: string;
    /** ReGa `UserLevel()`: 8 admin, 2 user, 1 guest. */
    readonly level: number;
    /** Epoch milliseconds; pushed out by every request that uses the session. */
    expiresAt: number;
}

export interface SessionStoreOptions {
    readonly ttlMs?: number;
    /** Injected by the tests so expiry can be reached without waiting a day. */
    readonly now?: () => number;
    /** Injected by the tests; the real one is the CSPRNG. */
    readonly createId?: () => string;
}

/** A session id: 32 bytes of CSPRNG as hex, which is not guessable and not enumerable. */
export function createSessionId(): string {
    return randomBytes(32).toString('hex');
}

/** The sessions of one host process. */
export class SessionStore {
    readonly ttlMs: number;
    readonly #sessions = new Map<string, Session>();
    readonly #now: () => number;
    readonly #createId: () => string;

    constructor(options: SessionStoreOptions = {}) {
        this.ttlMs = options.ttlMs ?? DEFAULT_SESSION_TTL_MS;
        this.#now = options.now ?? Date.now;
        this.#createId = options.createId ?? createSessionId;
    }

    get size(): number {
        return this.#sessions.size;
    }

    /** A new session for a user who has just proved who they are. */
    create(user: string, level: number): Session {
        this.sweep();
        const session: Session = {id: this.#createId(), user, level, expiresAt: this.#now() + this.ttlMs};
        this.#sessions.set(session.id, session);
        return session;
    }

    /**
     * The session behind an id, expiry slid forward - or `undefined` when there is none, which is
     * the answer for an unknown, a forged and an expired id alike.
     */
    get(id: string | undefined): Session | undefined {
        if (id === undefined || id === '') {
            return undefined;
        }
        const session = this.#sessions.get(id);
        if (!session) {
            return undefined;
        }
        const now = this.#now();
        if (session.expiresAt <= now) {
            this.#sessions.delete(id);
            return undefined;
        }
        session.expiresAt = now + this.ttlMs;
        return session;
    }

    /** Ends one session; `true` when there was one. */
    remove(id: string | undefined): boolean {
        return id === undefined ? false : this.#sessions.delete(id);
    }

    /** Drops what has expired. Called on every `create`, so the map cannot grow unboundedly. */
    sweep(): void {
        const now = this.#now();
        for (const [id, session] of this.#sessions) {
            if (session.expiresAt <= now) {
                this.#sessions.delete(id);
            }
        }
    }

    /** Ends every session. The host uses it when it shuts down. */
    clear(): void {
        this.#sessions.clear();
    }
}

export interface RateLimiterOptions {
    readonly limit?: number;
    readonly windowMs?: number;
    readonly now?: () => number;
}

/**
 * Counts failures per key inside a sliding window.
 *
 * Only failures are counted, and a success clears the key: a user who logs in correctly is never
 * slowed down by the four typos before it.
 */
export class RateLimiter {
    readonly limit: number;
    readonly windowMs: number;
    readonly #failures = new Map<string, number[]>();
    readonly #now: () => number;

    constructor(options: RateLimiterOptions = {}) {
        this.limit = options.limit ?? LOGIN_FAILURE_LIMIT;
        this.windowMs = options.windowMs ?? LOGIN_FAILURE_WINDOW_MS;
        this.#now = options.now ?? Date.now;
    }

    /** Has this source used up its attempts? */
    blocked(key: string): boolean {
        return this.#recent(key).length >= this.limit;
    }

    /** How many attempts this source has left before it is refused. */
    remaining(key: string): number {
        return Math.max(0, this.limit - this.#recent(key).length);
    }

    /** Records one failed attempt. */
    fail(key: string): void {
        const recent = this.#recent(key);
        recent.push(this.#now());
        this.#failures.set(key, recent);
    }

    /** Forgets a source's failures; called when it finally got in. */
    clear(key: string): void {
        this.#failures.delete(key);
    }

    #recent(key: string): number[] {
        const since = this.#now() - this.windowMs;
        const recent = (this.#failures.get(key) ?? []).filter((at) => at > since);
        // a source that has not failed recently must not stay in the map for ever
        if (recent.length === 0) {
            this.#failures.delete(key);
        }
        return recent;
    }
}
