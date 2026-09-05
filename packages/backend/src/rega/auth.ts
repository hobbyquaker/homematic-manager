/**
 * D-32: checking CCU credentials the way the CCU itself does, for the addon's optional login.
 *
 * Two loopback-only services answer the two halves of the question, and neither of them is the
 * JSON-API (D-1):
 *
 * - **who is this?** `dom.GetObject(ID_USERS).Get("<name>")` through the ReGa script interface on
 *   8183 (`regaPort({local: true})`), which also yields `UserLevel()` - 8 admin, 2 user, 1 guest;
 * - **is this the password?** one UDP datagram `user:password` to the CCU's authentication daemon
 *   on 1998, which answers with a single `1` when it is and `0` when it is not.
 *
 * Both listen on 127.0.0.1 only, which is why D-32 makes this the *addon's* mode and nothing else's:
 * an npm or Docker install has neither of the two ports, however reachable the CCU is otherwise.
 *
 * The cache is not an optimisation, it is the fix for a bug RedMatic had (9.2.0,
 * `addon_files/redmatic/lib/rega-auth.js`, whose approach this follows): **ReGa runs scripts one at
 * a time**. A page load asks for the session several times in parallel, and a share of those script
 * calls timed out and came back as random 401s. So a user that was looked up once stays known for
 * 15 minutes, parallel lookups of one name share a single script run, and a user we already know
 * stays logged in while ReGa is busy, restarting or gone. The password check is *not* cached - it
 * is a datagram to a daemon that answers in a millisecond, and a cached password is a liability.
 *
 * Nothing here throws into a caller: a failure is `undefined` ("no", with a notice), which is also
 * what makes the login endpoint of `apps/web` unable to leak whether a user exists.
 */

import {createSocket} from 'node:dgram';

import {Rega} from 'homematic-rega';

import {regaPort} from '@homematic-manager/core';

import {errorMessage} from '../errors.js';

import {userLookupScript} from './scripts.js';

/** The CCU's authentication daemon. Loopback only, on every firmware. */
export const REGA_AUTH_PORT = 1998;

/** How long a looked-up user stays known without asking ReGa again. */
export const USER_CACHE_TTL_MS = 15 * 60 * 1000;

/** How long ReGa and the UDP daemon are given to answer. */
export const AUTH_TIMEOUT_MS = 5000;

/** A CCU user as ReGa describes it. `level` is `UserLevel()`: 8 admin, 2 user, 1 guest. */
export interface RegaUser {
    readonly name: string;
    readonly level: number;
}

/** The one method of the ReGa client this needs; the tests pass a fake ReGa. */
export interface RegaExec {
    exec(script: string): Promise<{output: string; objects: Record<string, string>}>;
}

export interface RegaAuthOptions {
    /** Always the CCU's own loopback in production; a test points it at its fakes. */
    readonly host?: string;
    /** ReGa's script port; `regaPort({local: true})` = 8183. */
    readonly port?: number;
    /** The authentication daemon's UDP port. */
    readonly authPort?: number;
    readonly cacheTtlMs?: number;
    readonly timeoutMs?: number;
    /** The ReGa client. Injected by the tests; built from `host`/`port` otherwise. */
    readonly rega?: RegaExec;
    /** Injected by the tests so the cache can be expired without waiting 15 minutes. */
    readonly now?: () => number;
    readonly onNotice?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

/**
 * Escapes a credential for the `user:password` datagram.
 *
 * The daemon splits on the first unescaped colon, so a colon inside either half has to be escaped -
 * and the backslash that does the escaping has to be escaped first. Exactly RedMatic's rule; a
 * password with a colon in it is otherwise silently the wrong password.
 */
export function escapeAuthField(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
}

/** The datagram the authentication daemon expects. */
export function authDatagram(user: string, password: string): Buffer {
    return Buffer.from(`${escapeAuthField(user)}:${escapeAuthField(password)}`, 'latin1');
}

interface CacheEntry {
    readonly user: RegaUser;
    /** When the lookup that produced it answered. */
    readonly at: number;
}

/**
 * Verifies CCU credentials against ReGa and the authentication daemon.
 *
 * One instance per host process; it holds the user cache, and that cache is the whole point.
 */
export class RegaAuthenticator {
    readonly #options: RegaAuthOptions;
    readonly #cache = new Map<string, CacheEntry>();
    readonly #pending = new Map<string, Promise<RegaUser | undefined>>();
    #rega: RegaExec | undefined;

    constructor(options: RegaAuthOptions = {}) {
        this.#options = options;
        this.#rega = options.rega;
    }

    get #host(): string {
        return this.#options.host ?? '127.0.0.1';
    }

    get #now(): number {
        return (this.#options.now ?? Date.now)();
    }

    /** How many users are currently known without asking ReGa. Test and log support. */
    get cached(): number {
        return this.#cache.size;
    }

    /**
     * The user, or `undefined` when the CCU does not know the name.
     *
     * Cached for `cacheTtlMs`, de-duplicated while a lookup is in flight, and - when ReGa cannot be
     * asked at all - answered from a stale cache entry rather than logging a known user out.
     */
    async lookup(name: string): Promise<RegaUser | undefined> {
        const cached = this.#cache.get(name);
        if (cached && this.#now - cached.at < (this.#options.cacheTtlMs ?? USER_CACHE_TTL_MS)) {
            return cached.user;
        }
        const inFlight = this.#pending.get(name);
        if (inFlight) {
            // ReGa runs one script at a time: a second script for the same name would only make
            // both of them slower, and this is what fixed RedMatic's random 401s
            return inFlight;
        }
        const lookup = this.#lookup(name, cached).finally(() => {
            this.#pending.delete(name);
        });
        this.#pending.set(name, lookup);
        return lookup;
    }

    /**
     * The user when name and password are right, `undefined` otherwise.
     *
     * The same `undefined` for an unknown user and for a wrong password, on purpose: the caller
     * cannot tell the two apart and therefore cannot be used to enumerate the CCU's user names.
     */
    async authenticate(name: string, password: string): Promise<RegaUser | undefined> {
        const user = await this.lookup(name);
        if (!user) {
            return undefined;
        }
        return (await this.checkPassword(name, password)) ? user : undefined;
    }

    /**
     * One datagram to the authentication daemon, one answer.
     *
     * Never rejects and never waits longer than `timeoutMs`: an unreachable daemon is a "no", the
     * same as a wrong password. On a CCU it is a loopback service that answers immediately.
     */
    checkPassword(name: string, password: string): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const socket = createSocket('udp4');
            let done = false;
            const finish = (result: boolean): void => {
                if (done) {
                    return;
                }
                done = true;
                clearTimeout(timer);
                try {
                    socket.close();
                } catch {
                    // already closing; the answer is what matters
                }
                resolve(result);
            };
            const timer = setTimeout(() => {
                this.#notice('warn', `the CCU authentication daemon on udp ${String(this.#authPort)} did not answer`);
                finish(false);
            }, this.#options.timeoutMs ?? AUTH_TIMEOUT_MS);
            timer.unref();
            socket.on('message', (message) => {
                finish(message.length === 1 && message.toString('latin1') === '1');
            });
            socket.on('error', (error: Error) => {
                this.#notice('warn', `the CCU authentication daemon could not be asked: ${errorMessage(error)}`);
                finish(false);
            });
            socket.send(authDatagram(name, password), this.#authPort, this.#host, (error) => {
                if (error) {
                    this.#notice('warn', `the CCU authentication daemon could not be asked: ${errorMessage(error)}`);
                    finish(false);
                }
            });
        });
    }

    /** Forgets everything that was looked up; the next request asks ReGa again. */
    clearCache(): void {
        this.#cache.clear();
    }

    get #authPort(): number {
        return this.#options.authPort ?? REGA_AUTH_PORT;
    }

    async #lookup(name: string, stale: CacheEntry | undefined): Promise<RegaUser | undefined> {
        const script = userLookupScript(name);
        if (script === undefined) {
            // a name that cannot go into a script literal is a name no CCU has
            return undefined;
        }
        try {
            const answer = await this.#client().exec(script);
            const user = readUser(name, answer.objects);
            if (user) {
                this.#cache.set(name, {user, at: this.#now});
            } else {
                this.#cache.delete(name);
            }
            return user;
        } catch (error) {
            // D-2 in its login shape: ReGa being down must not throw anybody out who is already
            // known. It does mean nobody new can log in until it answers again.
            this.#notice('warn', `the CCU user list could not be read from ReGa: ${errorMessage(error)}`);
            return stale?.user;
        }
    }

    #client(): RegaExec {
        this.#rega ??= new Rega({
            host: this.#host,
            port: this.#options.port ?? regaPort({local: true}),
            tls: false,
            translate: false,
            timeout: this.#options.timeoutMs ?? AUTH_TIMEOUT_MS,
        }) as RegaExec;
        return this.#rega;
    }

    #notice(level: 'info' | 'warn' | 'error', message: string): void {
        this.#options.onNotice?.(level, message);
    }
}

/**
 * The user out of what the lookup script left in its variables.
 *
 * ReGa returns an object variable as the object's `Name()`, so `user` coming back as the name that
 * was asked for is what "the user exists" looks like - RedMatic compares exactly this. Anything
 * else, including the empty string a missing object produces, means no.
 */
export function readUser(name: string, objects: Record<string, string>): RegaUser | undefined {
    if (objects['user'] !== name) {
        return undefined;
    }
    const level = Number.parseInt(objects['level'] ?? '', 10);
    return {name, level: Number.isFinite(level) ? level : 0};
}
