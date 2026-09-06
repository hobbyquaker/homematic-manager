/**
 * The `occulite` provider: names, rooms and functions from an openccu-lite box, and written back
 * to it.
 *
 * The shape of it is the one openccu-lite's porting kit prescribes and the one their own
 * `occulited` expects: **snapshot once, then follow the change stream**, and re-snapshot when the
 * stream says the history is gone (`resync`), when a whole store was imported, or when a revision
 * arrives that is not the next one. Nothing polls. A rename made in another frontend, or by another
 * person in another browser, is in this application's grid inside a second.
 *
 * Failure is degradation, never an exception (their invariant 5, our D-2):
 *
 * - the box is off → the last snapshot from the cache file, `reachable: false`, one notice, and a
 *   reconnect loop with a backoff;
 * - the credential is refused (401) → no names rather than no application, one notice, and a retry
 *   on the next reconnect;
 * - the credential may read but not write (403) → the names are shown and `writable` is false, so
 *   the UI can say why the rename button does nothing.
 *
 * The snapshot is persisted where the ReGa provider persists its names, for the same reason: a
 * restart while the box is unreachable must not leave the grid nameless.
 */

import {
    applyEvent,
    emptyDocument,
    isMetaError,
    parseDocument,
    summariseAll,
    type MetaDocument,
    type MetaImportMode,
    type MetaNodePatch,
    type MetaState,
} from '@homematic-manager/core';

import {errorMessage} from '../errors.js';
import {readJsonFile, writeJsonFile} from '../util/jsonFile.js';
import {MetaApiClient} from './client.js';
import type {MetadataProvider, MetaMembershipEntry, MetaNameEntry, MetaProviderEvents} from './provider.js';

/** First wait before the event stream is opened again, in milliseconds. */
export const RECONNECT_MIN_MS = 2000;

/** Longest wait between two attempts. A box that is being updated is back well inside a minute. */
export const RECONNECT_MAX_MS = 60_000;

export interface OcculiteProviderOptions extends MetaProviderEvents {
    readonly client: MetaApiClient;
    /** `<cacheDir>/occulite-meta.json`: the last snapshot, so a restart without the box has names. */
    readonly cacheFile?: string;
    /** `occulited 0.1.0`, from the detection call. */
    readonly implementation?: string;
    readonly reconnectMinMs?: number;
    readonly reconnectMaxMs?: number;
    /** Injected by the tests in place of `setTimeout`. */
    readonly wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export class OcculiteProvider implements MetadataProvider {
    readonly kind = 'occulite' as const;
    readonly #options: OcculiteProviderOptions;
    readonly #client: MetaApiClient;
    #document: MetaDocument = emptyDocument();
    #reachable = false;
    #writable = true;
    #error: string | undefined;
    #abort: AbortController | undefined;
    #loop: Promise<void> | undefined;
    /** So that the same failure is not written into the log every two seconds. */
    #lastNotice = '';
    /** Ends the wait between two attempts at the event stream; set while the loop is sleeping. */
    #wake: (() => void) | undefined;

    constructor(options: OcculiteProviderOptions) {
        this.#options = options;
        this.#client = options.client;
    }

    state(): MetaState {
        return {
            provider: 'occulite',
            reachable: this.#reachable,
            writable: this.#writable,
            revision: this.#document.revision,
            objects: Object.keys(this.#document.objects).length,
            url: this.#client.baseUrl,
            ...(this.#options.implementation === undefined ? {} : {implementation: this.#options.implementation}),
            ...(this.#error === undefined ? {} : {error: this.#error}),
        };
    }

    document(): MetaDocument {
        return this.#document;
    }

    /**
     * The cached snapshot first, then the box.
     *
     * In that order on purpose: the cache is instant and the box may be a second away, and a grid
     * that shows the names it had a moment ago and then corrects them is better than one that shows
     * addresses while a request is in flight.
     */
    async start(): Promise<void> {
        await this.#loadCache();
        this.#abort = new AbortController();
        const signal = this.#abort.signal;
        await this.#refresh();
        this.#loop = this.#follow(signal);
    }

    async stop(): Promise<void> {
        this.#abort?.abort();
        this.#abort = undefined;
        try {
            await this.#loop;
        } catch {
            // the loop ends by being aborted; that is not a failure
        }
        this.#loop = undefined;
    }

    /**
     * A fresh snapshot, on demand - the credential changed, or a host asked for one.
     *
     * It also ends the wait before the next attempt at the event stream. On the box the first page
     * load is what hands the addon a session at all, and without this the store would be read at
     * once but only *followed* after the backoff had run out.
     */
    async refresh(): Promise<void> {
        await this.#refresh();
        this.#wake?.();
    }

    async setNames(entries: readonly MetaNameEntry[]): Promise<void> {
        if (entries.length === 0) {
            return;
        }
        const sets: Record<string, {name: string}> = {};
        for (const entry of entries) {
            sets[entry.ref] = {name: entry.name};
        }
        await this.#write(() => this.#client.bulk(sets));
    }

    async setMembership(entries: readonly MetaMembershipEntry[]): Promise<void> {
        if (entries.length === 0) {
            return;
        }
        const sets: Record<string, {enums: readonly string[]}> = {};
        for (const entry of entries) {
            sets[entry.ref] = {enums: entry.paths};
        }
        await this.#write(() => this.#client.bulk(sets));
    }

    async createEnum(id: string, name: Readonly<Record<string, string>>): Promise<void> {
        await this.#write(() => this.#client.createEnum(id, name));
    }

    async updateEnum(id: string, name: Readonly<Record<string, string>>): Promise<void> {
        await this.#write(() => this.#client.updateEnum(id, name));
    }

    async deleteEnum(id: string, detach: boolean): Promise<void> {
        await this.#write(() => this.#client.deleteEnum(id, detach ? 'detach' : 'refuse'));
    }

    async createNode(
        enumId: string,
        parent: string | null,
        id: string,
        name: string,
        options: {readonly icon?: string; readonly position?: number},
    ): Promise<string> {
        await this.#write(() =>
            this.#client.createNode(enumId, {
                parent,
                id,
                name,
                ...(options.icon === undefined ? {} : {icon: options.icon}),
                ...(options.position === undefined ? {} : {position: options.position}),
            }),
        );
        return `${parent ?? enumId}/${id}`;
    }

    async updateNode(path: string, patch: MetaNodePatch): Promise<void> {
        await this.#write(() => this.#client.updateNode(path, patch));
    }

    async deleteNode(path: string, detach: boolean): Promise<void> {
        await this.#write(() => this.#client.deleteNode(path, detach ? 'detach' : 'refuse'));
    }

    async import(document: unknown, mode: MetaImportMode): Promise<void> {
        await this.#write(() => this.#client.import(document, mode));
    }

    /**
     * One write, then a fresh snapshot.
     *
     * The snapshot rather than trusting the event stream: a write is a user action, they are rare,
     * and the alternative is a UI whose own change appears only if the stream happens to be up. A
     * 403 is turned into `writable: false` so the state says *why*, and is then re-thrown for the
     * caller to show.
     */
    async #write<T>(call: () => Promise<T>): Promise<T> {
        try {
            const answer = await call();
            if (!this.#writable) {
                this.#writable = true;
                this.#options.onStateChanged(this.state());
            }
            await this.#refresh();
            return answer;
        } catch (error) {
            if (isMetaError(error) && error.code === 'forbidden') {
                this.#writable = false;
                this.#error = error.message;
                this.#options.onStateChanged(this.state());
            }
            throw error;
        }
    }

    /** `GET /snapshot`, with every failure turned into a state instead of an exception. */
    async #refresh(): Promise<void> {
        try {
            const document = await this.#client.snapshot();
            this.#document = document;
            this.#reachable = true;
            this.#error = undefined;
            this.#lastNotice = '';
            // told before it is persisted, and on purpose: the document is already visible to every
            // reader, so a listener that hears about it one `await` later would be looking at a
            // change nobody announced
            this.#options.onStateChanged(this.state());
            this.#options.onChanged();
            await this.#saveCache();
        } catch (error) {
            this.#fail(error);
        }
    }

    /**
     * The change stream, for as long as the provider is running.
     *
     * Every reconnect resumes at the revision this provider holds. The box replays what it still
     * has and answers `resync` when it does not, which is the one case where a snapshot is fetched
     * again - together with `import`, which means the whole store was replaced.
     */
    async #follow(signal: AbortSignal): Promise<void> {
        // read through a function: `aborted` changes while this loop is awaiting, and neither the
        // type checker's narrowing nor the lint rule that follows it can know that
        const aborted = (): boolean => signal.aborted;
        let wait = this.#options.reconnectMinMs ?? RECONNECT_MIN_MS;
        while (!aborted()) {
            try {
                for await (const event of this.#client.events(this.#document.revision, signal)) {
                    wait = this.#options.reconnectMinMs ?? RECONNECT_MIN_MS;
                    if (!this.#reachable) {
                        this.#reachable = true;
                        this.#error = undefined;
                        this.#options.onStateChanged(this.state());
                    }
                    const next = applyEvent(this.#document, event);
                    if (next === 'resync') {
                        await this.#refresh();
                        continue;
                    }
                    if (next.revision === this.#document.revision) {
                        // a replayed event we already had
                        continue;
                    }
                    this.#document = next;
                    this.#options.onStateChanged(this.state());
                    this.#options.onChanged();
                    await this.#saveCache();
                }
            } catch (error) {
                if (aborted()) {
                    return;
                }
                this.#fail(error);
            }
            if (aborted()) {
                return;
            }
            await this.#sleep(wait, signal);
            wait = Math.min(wait * 2, this.#options.reconnectMaxMs ?? RECONNECT_MAX_MS);
            // a reconnect is also the moment to try the credential again: a token that was added on
            // the box while this was running starts working without a restart here
            if (!aborted() && !this.#reachable) {
                await this.#refresh();
            }
        }
    }

    #fail(error: unknown): void {
        const message = isMetaError(error) ? error.message : errorMessage(error);
        this.#reachable = false;
        this.#error = message;
        this.#options.onStateChanged(this.state());
        if (message !== this.#lastNotice) {
            this.#lastNotice = message;
            this.#options.onNotice('warn', `the openccu-lite metadata store is not answering: ${message}`);
        }
    }

    async #loadCache(): Promise<void> {
        if (this.#options.cacheFile === undefined) {
            return;
        }
        const raw = await readJsonFile<unknown>(this.#options.cacheFile);
        if (raw === undefined) {
            return;
        }
        try {
            this.#document = parseDocument(raw);
            this.#options.onChanged();
        } catch {
            // a cache file that cannot be read is a cache file, not a store: it is replaced by the
            // next snapshot and nobody needs to hear about it
        }
    }

    async #saveCache(): Promise<void> {
        if (this.#options.cacheFile === undefined) {
            return;
        }
        try {
            await writeJsonFile(this.#options.cacheFile, this.#document);
        } catch (error) {
            this.#options.onNotice('warn', `the metadata cache could not be written: ${errorMessage(error)}`);
        }
    }

    #sleep(ms: number, signal: AbortSignal): Promise<void> {
        if (this.#options.wait) {
            return this.#options.wait(ms, signal);
        }
        return new Promise((resolve) => {
            const done = (): void => {
                clearTimeout(timer);
                this.#wake = undefined;
                resolve();
            };
            const timer = setTimeout(done, ms);
            timer.unref();
            this.#wake = done;
            signal.addEventListener('abort', done, {once: true});
        });
    }
}

/** Every object of the current document as the UI shows it. Re-exported for the backend's reads. */
export {summariseAll};
