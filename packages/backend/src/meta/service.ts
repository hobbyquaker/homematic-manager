/**
 * D-40: which metadata provider is in charge, and everything the backend calls on it.
 *
 * The selection is openccu-lite's rule and no other: **`GET /api/meta/v1/version` on the configured
 * host**, once per connect. A box answers with `{"api":"meta",…}` and its store is used; a CCU
 * answers 404 or HTML and everything stays as it was. No `/VERSION` sniffing, no host names, no
 * ports - a user who moves a profile between a CCU and a box must not have to edit anything
 * (their invariant 2). `metaProvider: 'local'` skips the probe, `'occulite'` insists on the box.
 *
 * The service is also where the store's identity meets this application's. The store keys objects
 * by **ref** (`<interface>.<address>`); the grids, the caches and the whole existing API key names
 * by address, because a Homematic address is unique across the interfaces of one CCU in practice.
 * So the ref is resolved here, in one place, from the device caches - and never guessed anywhere
 * else.
 */

import path from 'node:path';

import {
    makeRef,
    parseRef,
    slugId,
    summarise,
    type ConnectionConfig,
    type MetaDocument,
    type MetaEnum,
    type MetaImportMode,
    type MetaNodePatch,
    type MetaObjectView,
    type MetaState,
    type MetaVersion,
} from '@homematic-manager/core';

import type {NameStore} from '../cache/names.js';
import {validationError} from '../errors.js';
import {MetaApiClient, DETECT_TIMEOUT_MS} from './client.js';
import {normaliseSid, readLocalToken} from './credentials.js';
import {LocalMetaProvider} from './localProvider.js';
import {OcculiteProvider} from './occuliteProvider.js';
import type {MetadataProvider, MetaMembershipEntry} from './provider.js';

/** One name to set, as the rest of the backend spells it: by address. */
export interface MetaNameChange {
    readonly address: string;
    readonly name: string;
}

export interface MetaServiceOptions {
    readonly connection: ConnectionConfig;
    /** The profile directory; the `local` store lives in it. */
    readonly dataDir: string;
    /** The per-CCU cache directory; the box's last snapshot lives in it. */
    readonly cacheDir: string;
    /** The name cache the whole application reads; the provider's names are applied to it. */
    readonly names: NameStore;
    /** Which interface a device or channel address belongs to, from the device caches. */
    readonly interfaceOf: (address: string) => string | undefined;
    /** The document changed: names, enums or objects. */
    readonly onChanged: () => void;
    readonly onStateChanged: (state: MetaState) => void;
    readonly onNotice: (level: 'info' | 'warn' | 'error', message: string) => void;
    /** Injected by the tests. */
    readonly localTokenFile?: string | undefined;
    readonly fetch?: typeof globalThis.fetch;
    readonly detectTimeoutMs?: number;
}

/**
 * The base URL of the box.
 *
 * `local` means "we are the addon on the box itself", where everything is behind the loopback
 * lighttpd; otherwise it is the configured host with the scheme the profile uses for the CCU.
 * `metaUrl` overrides both, for a reverse proxy on a strange port and for the integration tests.
 */
export function metaBaseUrl(connection: ConnectionConfig): string {
    const configured = (connection.metaUrl ?? '').trim();
    if (configured !== '') {
        return configured.replace(/\/$/, '');
    }
    if (connection.local === true) {
        return 'http://127.0.0.1';
    }
    const host = connection.host.trim();
    if (host === '') {
        return '';
    }
    return `${connection.tls ? 'https' : 'http'}://${host}`;
}

/** Everything the metadata store is, for one connection. */
export class MetaService {
    readonly #options: MetaServiceOptions;
    #provider: MetadataProvider;
    #version: MetaVersion | undefined;
    /** The session of the person looking at the page; writes go out as this one. */
    #sessionCredential: string | undefined;
    #localToken: string | undefined;

    private constructor(options: MetaServiceOptions, provider: MetadataProvider, version?: MetaVersion) {
        this.#options = options;
        this.#provider = provider;
        this.#version = version;
    }

    /**
     * Probes the box and builds the provider that fits.
     *
     * Never throws: a probe that fails means "no box", which is what every CCU, every Homegear and
     * every desktop answers, and the `local` provider is a complete answer to it.
     */
    static async create(options: MetaServiceOptions): Promise<MetaService> {
        const choice = options.connection.metaProvider ?? 'auto';
        const localToken = await readLocalToken(options.localTokenFile);
        const service = new MetaService(options, placeholderProvider(options));
        service.#localToken = localToken;

        if (choice === 'local') {
            service.#provider = service.#buildLocal();
            return service;
        }
        const baseUrl = metaBaseUrl(options.connection);
        const version =
            baseUrl === ''
                ? undefined
                : await service.#client(baseUrl).version(options.detectTimeoutMs ?? DETECT_TIMEOUT_MS);
        if (version === undefined) {
            if (choice === 'occulite') {
                options.onNotice(
                    'warn',
                    `no openccu-lite metadata API at ${baseUrl || 'the configured host'}: the profile asks for it, ` +
                        'so names and rooms stay in this profile until the box answers',
                );
            }
            service.#provider = service.#buildLocal();
            return service;
        }
        service.#version = version;
        options.onNotice(
            'info',
            `openccu-lite detected at ${baseUrl} (${version.implementation ?? 'metadata API v1'}): ` +
                'names, rooms and functions come from the box',
        );
        service.#provider = service.#buildOcculite(baseUrl, version);
        return service;
    }

    get kind(): 'local' | 'occulite' {
        return this.#provider.kind;
    }

    /** True when this connection talks to an openccu-lite box. */
    get onBox(): boolean {
        return this.#provider.kind === 'occulite';
    }

    state(): MetaState {
        return this.#provider.state();
    }

    document(): MetaDocument {
        return this.#provider.document();
    }

    enums(): Readonly<Record<string, MetaEnum>> {
        return this.#provider.document().enums;
    }

    /** Every object as the UI shows it: the name, the paths, and the paths as names. */
    objects(): Record<string, MetaObjectView> {
        const document = this.#provider.document();
        const views: Record<string, MetaObjectView> = {};
        for (const [ref, object] of Object.entries(document.objects)) {
            const summary = summarise(document.enums, object);
            views[ref] = {
                name: summary.name,
                enums: [...object.enums],
                rooms: [...summary.rooms],
                functions: [...summary.functions],
                ...(summary.orphaned ? {orphaned: true} : {}),
            };
        }
        return views;
    }

    async start(): Promise<void> {
        await this.#provider.start();
        this.applyNames();
    }

    async stop(): Promise<void> {
        await this.#provider.stop();
    }

    /**
     * The session the addon should write as (openccu-lite's embedding contract: `?sid=@…@`).
     *
     * Reads keep using the box's local token, which is read-only by design; a write is attributed
     * to the person who opened the page. Without a session the writes go out with whatever the
     * reads use, which on the box means the box answers 403 and the UI says so.
     */
    setSessionCredential(sid: string | undefined): void {
        const next = normaliseSid(sid);
        if (next === this.#sessionCredential) {
            return;
        }
        this.#sessionCredential = next;
        // On the box this is the moment the addon learns who is looking at the page, and without a
        // local token file it is the moment it gets a credential at all - so read everything again
        // rather than wait for the event stream's next reconnect. Never awaited and never thrown:
        // the caller is an HTTP request handler, and a box that refuses is a state, not an error.
        void this.#provider.refresh();
    }

    /** Copies the store's names into the name cache. Returns true when anything changed. */
    applyNames(): boolean {
        const document = this.#provider.document();
        const entries: {address: string; name: string}[] = [];
        for (const [ref, object] of Object.entries(document.objects)) {
            const parsed = parseRef(ref);
            if (parsed) {
                entries.push({address: parsed.address, name: object.name});
            }
        }
        return this.#options.names.applyMeta(entries);
    }

    /*
     * writes
     */

    /** The rename: what `names.set` writes into the store after the local cache has it. */
    async setNames(entries: readonly MetaNameChange[]): Promise<void> {
        const named = entries
            .map((entry) => ({ref: this.refFor(entry.address), name: entry.name}))
            .filter((entry): entry is {ref: string; name: string} => entry.ref !== undefined);
        if (named.length === 0) {
            return;
        }
        await this.#provider.setNames(named);
    }

    async setMembership(entries: readonly {ref: string; paths: readonly string[]}[]): Promise<void> {
        await this.#provider.setMembership(entries);
    }

    /**
     * The interaction of the whole feature: select rows, assign them to a room.
     *
     * One revision for the whole selection - the store is asked once with the complete membership
     * of every object, not once per object, so a consumer of the change stream sees one change and
     * the box writes its file once.
     */
    async assign(refs: readonly string[], nodePath: string, on: boolean): Promise<void> {
        const document = this.#provider.document();
        const entries: MetaMembershipEntry[] = [];
        for (const ref of refs) {
            const object = document.objects[ref];
            const current = object?.enums ?? [];
            const has = current.includes(nodePath);
            if (has === on) {
                continue;
            }
            const paths = on ? [...current, nodePath] : current.filter((path) => path !== nodePath);
            if (object === undefined && !on) {
                continue;
            }
            if (object === undefined) {
                // the store never invents objects, but it does hold metadata about an address the
                // interface reports; a channel that has no entry yet gets one with the name the
                // application already shows
                const parsed = parseRef(ref);
                const name = (parsed ? this.#options.names.get(parsed.address) : undefined) ?? parsed?.address ?? ref;
                await this.#provider.setNames([{ref, name}]);
            }
            entries.push({ref, paths});
        }
        await this.setMembership(entries);
    }

    async createEnum(id: string, name: Readonly<Record<string, string>>): Promise<void> {
        await this.#provider.createEnum(id, name);
    }

    async updateEnum(id: string, name: Readonly<Record<string, string>>): Promise<void> {
        await this.#provider.updateEnum(id, name);
    }

    async deleteEnum(id: string, detach: boolean): Promise<void> {
        await this.#provider.deleteEnum(id, detach);
    }

    /**
     * A node under a parent. The id is derived from the name and never changes afterwards, which is
     * what keeps every membership pointing at the same node when the room is renamed.
     */
    async createNode(
        enumId: string,
        parent: string | null | undefined,
        name: string,
        options: {readonly icon?: string; readonly position?: number} = {},
    ): Promise<string> {
        const document = this.#provider.document();
        const definition = document.enums[enumId];
        if (!definition) {
            throw validationError(`${enumId} is not a taxonomy of this store`);
        }
        const siblings = siblingIds(definition, parent, enumId);
        const id = slugId(name, siblings);
        return this.#provider.createNode(enumId, parent ?? null, id, name, options);
    }

    async updateNode(nodePath: string, patch: MetaNodePatch): Promise<void> {
        await this.#provider.updateNode(nodePath, patch);
    }

    async deleteNode(nodePath: string, detach: boolean): Promise<void> {
        await this.#provider.deleteNode(nodePath, detach);
    }

    async import(document: unknown, mode: MetaImportMode): Promise<void> {
        await this.#provider.import(document, mode);
    }

    /**
     * The ref of an address: the interface that reports it, or the one the store already uses.
     *
     * The second half matters after a restart with the box unreachable, and for a channel of a
     * device that has just been deleted: the store still has the entry, and a rename of it should
     * go to the same ref rather than to a new one.
     */
    refFor(address: string): string | undefined {
        const interfaceName = this.#options.interfaceOf(address);
        if (interfaceName !== undefined && interfaceName !== '') {
            return makeRef(interfaceName, address);
        }
        for (const ref of Object.keys(this.#provider.document().objects)) {
            if (parseRef(ref)?.address === address) {
                return ref;
            }
        }
        return undefined;
    }

    #client(baseUrl: string): MetaApiClient {
        return new MetaApiClient({
            baseUrl,
            credential: () => this.#readCredential(),
            writeCredential: () => this.#writeCredential(),
            ...(this.#options.fetch === undefined ? {} : {fetch: this.#options.fetch}),
        });
    }

    /**
     * Reads: the configured API token, else the box's local token, else the session.
     *
     * The token in the profile wins because it is the one a user off the box configured on purpose;
     * the local token is what an addon has without anybody configuring anything.
     */
    #readCredential(): string | undefined {
        const configured = (this.#options.connection.metaToken ?? '').trim();
        return configured !== '' ? configured : (this.#localToken ?? this.#sessionCredential);
    }

    /** Writes: the user's session first - the local token may not write, and should not. */
    #writeCredential(): string | undefined {
        const configured = (this.#options.connection.metaToken ?? '').trim();
        return this.#sessionCredential ?? (configured !== '' ? configured : this.#localToken);
    }

    #buildLocal(): MetadataProvider {
        return new LocalMetaProvider({
            file: path.join(this.#options.dataDir, 'meta.json'),
            onChanged: () => {
                this.applyNames();
                this.#options.onChanged();
            },
            onStateChanged: this.#options.onStateChanged,
            onNotice: this.#options.onNotice,
        });
    }

    #buildOcculite(baseUrl: string, version: MetaVersion): MetadataProvider {
        return new OcculiteProvider({
            client: this.#client(baseUrl),
            cacheFile: path.join(this.#options.cacheDir, 'occulite-meta.json'),
            ...(version.implementation === undefined ? {} : {implementation: version.implementation}),
            onChanged: () => {
                this.applyNames();
                this.#options.onChanged();
            },
            onStateChanged: this.#options.onStateChanged,
            onNotice: this.#options.onNotice,
        });
    }

    /** The version the box answered with, for the settings dialog and the log. */
    get version(): MetaVersion | undefined {
        return this.#version;
    }
}

/** The ids already taken among the siblings a new node would join. */
function siblingIds(definition: MetaEnum, parent: string | null | undefined, enumId: string): string[] {
    if (parent === null || parent === undefined || parent === enumId) {
        return definition.tree.map((node) => node.id);
    }
    const ids = parent.split('/').slice(1);
    let nodes = definition.tree;
    for (const id of ids) {
        const found = nodes.find((node) => node.id === id);
        if (!found) {
            return [];
        }
        nodes = found.children ?? [];
    }
    return nodes.map((node) => node.id);
}

/** A provider that exists only between `new` and the decision which one it really is. */
function placeholderProvider(options: MetaServiceOptions): MetadataProvider {
    return new LocalMetaProvider({
        file: path.join(options.dataDir, 'meta.json'),
        onChanged: options.onChanged,
        onStateChanged: options.onStateChanged,
        onNotice: options.onNotice,
    });
}
