/**
 * The `local` metadata provider: names, rooms and functions in this profile.
 *
 * It is the same {@link MetaStore} the conformance corpus runs against, persisted to
 * `<dataDir>/meta.json` - the **profile** directory and not the per-CCU cache, for the reason the
 * link templates live there too (task 15): a taxonomy is the user's own work, it is not derived
 * from any CCU, `config.clearCaches` may not throw it away and moving the profile to another
 * installation has to take it along.
 *
 * On a system that has neither ReGa nor a box this is where a name lives; on a CCU it is where the
 * taxonomy lives while the names come from ReGa. Nothing here talks to anything.
 */

import {
    MetaStore,
    emptyDocument,
    parseDocument,
    type MetaDocument,
    type MetaImportMode,
    type MetaNodePatch,
    type MetaState,
} from '@homematic-manager/core';

import {errorMessage} from '../errors.js';
import {readJsonFile, writeJsonFile} from '../util/jsonFile.js';
import type {MetadataProvider, MetaMembershipEntry, MetaNameEntry, MetaProviderEvents} from './provider.js';

export interface LocalMetaProviderOptions extends MetaProviderEvents {
    /** `<dataDir>/meta.json`. */
    readonly file: string;
}

export class LocalMetaProvider implements MetadataProvider {
    readonly kind = 'local' as const;
    readonly #options: LocalMetaProviderOptions;
    #store = new MetaStore();

    constructor(options: LocalMetaProviderOptions) {
        this.#options = options;
    }

    state(): MetaState {
        return {
            provider: 'local',
            reachable: true,
            writable: true,
            revision: this.#store.revision,
            objects: this.#store.size,
        };
    }

    /**
     * Reads the file. A broken one is reported and replaced by an empty store rather than left to
     * fail every read afterwards - the names in the grid then come from the name cache alone, which
     * is the degradation D-2 asks for everywhere else too.
     */
    async start(): Promise<void> {
        const raw = await readJsonFile<unknown>(this.#options.file);
        if (raw === undefined) {
            this.#store = new MetaStore();
            this.#options.onStateChanged(this.state());
            return;
        }
        try {
            this.#store = new MetaStore({document: parseDocument(raw)});
        } catch (error) {
            this.#store = new MetaStore({document: emptyDocument()});
            this.#options.onNotice('warn', `${this.#options.file} could not be read: ${errorMessage(error)}`);
        }
        this.#options.onStateChanged(this.state());
        this.#options.onChanged();
    }

    stop(): Promise<void> {
        return Promise.resolve();
    }

    /** Nothing to read again: this store is in this process. */
    refresh(): Promise<void> {
        return Promise.resolve();
    }

    document(): MetaDocument {
        return this.#store.document();
    }

    async setNames(entries: readonly MetaNameEntry[]): Promise<void> {
        const sets: Record<string, {name: string}> = {};
        for (const entry of entries) {
            sets[entry.ref] = {name: entry.name};
        }
        await this.#apply(() => this.#store.bulk(sets).changed);
    }

    async setMembership(entries: readonly MetaMembershipEntry[]): Promise<void> {
        const sets: Record<string, {enums: readonly string[]}> = {};
        for (const entry of entries) {
            sets[entry.ref] = {enums: entry.paths};
        }
        await this.#apply(() => this.#store.bulk(sets).changed);
    }

    async createEnum(id: string, name: Readonly<Record<string, string>>): Promise<void> {
        await this.#apply(() => this.#store.createEnum(id, name).changed);
    }

    async updateEnum(id: string, name: Readonly<Record<string, string>>): Promise<void> {
        await this.#apply(() => this.#store.updateEnum(id, name).changed);
    }

    async deleteEnum(id: string, detach: boolean): Promise<void> {
        await this.#apply(() => this.#store.deleteEnum(id, detach ? 'detach' : 'refuse').changed);
    }

    async createNode(
        enumId: string,
        parent: string | null,
        id: string,
        name: string,
        options: {readonly icon?: string; readonly position?: number},
    ): Promise<string> {
        await this.#apply(() => this.#store.createNode(enumId, parent, id, name, options).changed);
        return `${parent ?? enumId}/${id}`;
    }

    async updateNode(path: string, patch: MetaNodePatch): Promise<void> {
        await this.#apply(() => this.#store.updateNode(path, patch).changed);
    }

    async deleteNode(path: string, detach: boolean): Promise<void> {
        await this.#apply(() => this.#store.deleteNode(path, detach ? 'detach' : 'refuse').changed);
    }

    async import(document: unknown, mode: MetaImportMode): Promise<void> {
        await this.#apply(() => this.#store.import(document, mode).changed);
    }

    /** One write: apply, persist when it changed anything, tell the backend. */
    async #apply(write: () => boolean): Promise<void> {
        const changed = write();
        if (!changed) {
            return;
        }
        await this.#save();
        this.#options.onStateChanged(this.state());
        this.#options.onChanged();
    }

    async #save(): Promise<void> {
        try {
            await writeJsonFile(this.#options.file, this.#store.document());
        } catch (error) {
            this.#options.onNotice('warn', `${this.#options.file} could not be written: ${errorMessage(error)}`);
        }
    }
}
