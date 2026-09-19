import type {
    ApiError,
    ApiEventName,
    ApiEvents,
    ApiMethodName,
    ApiParams,
    ApiResult,
    LinkTemplate,
    MetaEnum,
    MetaObjectView,
    MetaState,
    Transport,
} from '@homematic-manager/core';
import {findNode, MetaStore, parseDocument, parsePath, slugId, summarise} from '@homematic-manager/core';

import {
    DEMO_BIDCOS_INTERFACES,
    DEMO_HMIP_INTERFACES,
    DEMO_CONFIG,
    demoCallbackAddresses,
    DEMO_DATA_FILES,
    DEMO_DEVICES,
    DEMO_EVENTS,
    DEMO_INTERFACE_STATES,
    DEMO_LINKS,
    DEMO_META,
    DEMO_NAMES,
    DEMO_REGA_STATE,
    DEMO_TEAMS,
    DEMO_RPC_METHODS,
    DEMO_RSSI,
    DEMO_SERVICE_MESSAGES,
    DEMO_UNREACH,
    DEMO_RPC_LOG,
    demoDescription,
    demoParamset,
    isDemoInterface,
} from './demoData.js';
import {ApiRequestError} from './error.js';

/** One recorded request. `params` is the positional tuple the contract defines. */
export interface RecordedCall {
    readonly method: ApiMethodName;
    readonly params: readonly unknown[];
}

export type MockHandler<M extends ApiMethodName> = (...params: ApiParams<M>) => ApiResult<M> | Promise<ApiResult<M>>;

type AnyHandler = (...params: never[]) => unknown;

export interface MockTransportOptions {
    /** Start disconnected, e.g. to test the "Disconnected" overlay. */
    readonly connected?: boolean;
    /** Register the demo fixture's answers. Off by default so a test starts from nothing. */
    readonly demo?: boolean;
}

/**
 * The `Transport` of the contract, scriptable and without a socket.
 *
 * It is what every store and component test talks to, and what demo mode runs on. Handlers are
 * registered per method (`respond`), events are pushed by hand (`emit`), and every request is
 * recorded (`calls`) so a test can assert that the UI asked for exactly what it should have asked
 * for - the 2.x renderer's habit of firing the same `listDevices` three times per tab switch is
 * the kind of thing this is meant to catch.
 */
export class MockTransport implements Transport {
    /** Every request in order, oldest first. */
    readonly calls: RecordedCall[] = [];

    readonly #handlers = new Map<ApiMethodName, AnyHandler>();
    readonly #listeners = new Map<ApiEventName, Set<(payload: never) => void>>();
    readonly #connectionListeners = new Set<(connected: boolean) => void>();
    #connected: boolean;

    constructor(options: MockTransportOptions = {}) {
        this.#connected = options.connected ?? true;
        if (options.demo === true) {
            this.useDemoData();
        }
    }

    get connected(): boolean {
        return this.#connected;
    }

    /** Registers the answer for one method; a second call replaces the first. */
    respond<M extends ApiMethodName>(method: M, handler: MockHandler<M>): this {
        this.#handlers.set(method, handler as AnyHandler);
        return this;
    }

    /**
     * The handler registered for a method, so a test can answer a few calls itself and hand every
     * other one to the demo data. Throws when there is none, like an unanswered request.
     */
    handlerFor<M extends ApiMethodName>(method: M): MockHandler<M> {
        const handler = this.#handlers.get(method);
        if (!handler) {
            throw new ApiRequestError({message: `no mock handler for ${method}`, kind: 'internal'});
        }
        return handler as unknown as MockHandler<M>;
    }

    /** Registers a constant answer - the common case in a component test. */
    result<M extends ApiMethodName>(method: M, value: ApiResult<M>): this {
        return this.respond(method, (() => value) as MockHandler<M>);
    }

    /**
     * Makes one method reject, so the notice and error paths can be exercised. Not generic: the
     * handler never produces a result, so there is no method type to relate anything to.
     */
    fail(method: ApiMethodName, error: ApiError | string): this {
        const apiError: ApiError = typeof error === 'string' ? {message: error, kind: 'internal'} : error;
        return this.respond(method, (() => {
            throw new ApiRequestError(apiError);
        }) as MockHandler<ApiMethodName>);
    }

    /** Pushes an event to every subscriber, exactly as the backend's event stream would. */
    emit<E extends ApiEventName>(event: E, payload: ApiEvents[E]): void {
        const handlers = this.#listeners.get(event);
        if (!handlers) {
            return;
        }
        for (const handler of [...handlers]) {
            (handler as (value: ApiEvents[E]) => void)(payload);
        }
    }

    /** Flips the transport-level connection and notifies the subscribers. */
    setConnected(connected: boolean): void {
        if (this.#connected === connected) {
            return;
        }
        this.#connected = connected;
        for (const handler of [...this.#connectionListeners]) {
            handler(connected);
        }
    }

    /** How often a method was requested. */
    countOf(method: ApiMethodName): number {
        return this.calls.filter((call) => call.method === method).length;
    }

    /** The parameters of the last request of a method, or `undefined` if it was never made. */
    lastCall<M extends ApiMethodName>(method: M): ApiParams<M> | undefined {
        for (let index = this.calls.length - 1; index >= 0; index -= 1) {
            const call = this.calls[index];
            if (call && call.method === method) {
                return call.params as ApiParams<M>;
            }
        }
        return undefined;
    }

    /** Drops the recorded calls; the handlers and subscribers stay. */
    reset(): void {
        this.calls.length = 0;
    }

    async request<M extends ApiMethodName>(method: M, ...params: ApiParams<M>): Promise<ApiResult<M>> {
        this.calls.push({method, params});
        const handler = this.#handlers.get(method);
        if (!handler) {
            throw new ApiRequestError({message: `no mock handler for ${method}`, kind: 'internal'});
        }
        return (await (handler as (...args: unknown[]) => Promise<ApiResult<M>>)(...params)) as ApiResult<M>;
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

    /** How many subscribers a given event has - a leak check for the stores' `dispose()`. */
    listenerCount(event: ApiEventName): number {
        return this.#listeners.get(event)?.size ?? 0;
    }

    /** Registers answers for everything the demo fixture covers. */
    useDemoData(): this {
        this.result('config.get', DEMO_CONFIG);
        this.respond('config.set', (connection) => ({...DEMO_CONFIG, connection}));
        this.result('config.discover', DEMO_CONFIG.discovered);
        this.result('config.clearCaches', null);
        this.respond('config.callbackAddresses', (host) => demoCallbackAddresses(host));
        this.result('interfaces.list', DEMO_INTERFACE_STATES);
        this.result('interfaces.reconnect', null);
        this.result('rega.state', DEMO_REGA_STATE);
        this.respond('devices.list', (interfaceName) =>
            isDemoInterface(interfaceName) ? DEMO_DEVICES[interfaceName] : [],
        );
        this.result('names.get', DEMO_NAMES);
        this.respond('names.set', (entries) => {
            const names = {...DEMO_NAMES};
            for (const entry of entries) {
                names[entry.address] = entry.name;
            }
            return names;
        });
        this.respond('links.list', (interfaceName) =>
            isDemoInterface(interfaceName) ? DEMO_LINKS[interfaceName] : [],
        );
        this.respond('rssi.get', (interfaceName) => (isDemoInterface(interfaceName) ? DEMO_RSSI[interfaceName] : {}));
        // #155: hmipserver answers `listBidcosInterfaces` with its access point, not with the
        // BidCos coprocessor - the Funk tab of an HmIP interface groups its columns under that one.
        this.respond('bidcos.interfaces', (interfaceName) =>
            interfaceName === 'HmIP-RF' ? DEMO_HMIP_INTERFACES : DEMO_BIDCOS_INTERFACES,
        );
        this.respond('serviceMessages.list', (interfaceName) =>
            interfaceName === undefined
                ? DEMO_SERVICE_MESSAGES
                : DEMO_SERVICE_MESSAGES.filter((message) => message.interfaceName === interfaceName),
        );
        // #146: the same answer, but the call the refresh button makes is its own method - the
        // demo has no interface process to read again.
        this.respond('serviceMessages.refresh', (interfaceName) =>
            interfaceName === undefined
                ? DEMO_SERVICE_MESSAGES
                : DEMO_SERVICE_MESSAGES.filter((message) => message.interfaceName === interfaceName),
        );
        this.result('serviceMessages.ack', null);
        this.result('rega.confirmInbox', []);
        this.respond('teams.list', (interfaceName) => (interfaceName === 'BidCos-RF' ? DEMO_TEAMS : []));
        this.result('teams.set', null);
        this.respond('unreach.list', (interfaceName) =>
            interfaceName === undefined
                ? DEMO_UNREACH
                : DEMO_UNREACH.filter((entry) => entry.interfaceName === interfaceName),
        );
        this.result('unreach.reset', null);
        // Issue #21: the demo keeps its link templates in memory, so saving and applying one
        // works in the browser demo exactly as it does against a backend.
        const templates: LinkTemplate[] = [];
        this.respond('linkTemplates.list', (identity) =>
            identity === undefined ? templates : templates.filter((entry) => entry.identity === identity),
        );
        this.respond('linkTemplates.save', (template) => {
            const index = templates.findIndex((entry) => entry.name === template.name);
            if (index === -1) {
                templates.push(template);
            } else {
                templates[index] = template;
            }
            return templates;
        });
        this.respond('linkTemplates.remove', (name) => {
            const index = templates.findIndex((entry) => entry.name === name);
            if (index !== -1) {
                templates.splice(index, 1);
            }
            return templates;
        });
        this.respond('events.recent', (interfaceName) =>
            interfaceName === undefined
                ? DEMO_EVENTS
                : DEMO_EVENTS.filter((event) => event.interfaceName === interfaceName),
        );
        this.result('events.clear', null);
        this.result('rpcLog.list', DEMO_RPC_LOG);
        this.result('rpcLog.clear', null);
        this.result('rpc.methods', DEMO_RPC_METHODS);
        this.respond('rpc.call', (_interfaceName, method, params) => ({method, params}));
        this.respond('paramset.description', (_interfaceName, address, paramset) => demoDescription(address, paramset));
        this.respond('paramset.get', (_interfaceName, address, paramset) => demoParamset(address, paramset));
        this.respond('paramset.put', (interfaceName, addresses, paramset, values) =>
            addresses.map((address) => ({
                interfaceName,
                address,
                paramset,
                sent: values,
                ok: true,
                problems: [],
                durationMs: 42,
            })),
        );
        this.respond('paramset.putLink', (interfaceName, links, values) =>
            links.map((link) => ({
                interfaceName,
                address: link.receiver,
                peer: link.sender,
                paramset: 'LINK',
                sent: values.receiverToSender ?? values.senderToReceiver ?? {},
                ok: true,
                problems: [],
                durationMs: 42,
            })),
        );
        this.result('value.set', null);
        this.result('devices.installMode.set', null);
        this.result('devices.installMode.get', 0);
        this.respond('devices.repairConfig', (interfaceName, address, options) => ({
            interfaceName,
            address,
            configPendingBefore: true,
            configPendingAfter: options?.dryRun === true ? true : false,
            channels: [
                {
                    address: `${address}:1`,
                    unknown: [],
                    corrected: [
                        {
                            parameter: 'TRANSMIT_TRY_MAX',
                            stored: 62,
                            replacement: 10,
                            reason: 'above MAX 10',
                        },
                    ],
                    write: {
                        interfaceName,
                        address: `${address}:1`,
                        paramset: 'MASTER',
                        sent: {TRANSMIT_TRY_MAX: 10},
                        ok: true,
                        problems: [],
                    },
                },
            ],
            unrepairable: [],
            ...(options?.bidcosRecovery === undefined || options.bidcosRecovery === 'none'
                ? {}
                : {bidcosRecovery: options.bidcosRecovery}),
        }));
        this.result('links.add', null);
        this.result('links.remove', null);
        this.result('links.info.set', null);
        this.result('links.activate', null);
        this.respond('links.info.get', (interfaceName, sender, receiver) => {
            const links = isDemoInterface(interfaceName) ? DEMO_LINKS[interfaceName] : [];
            return (
                links.find((link) => link.SENDER === sender && link.RECEIVER === receiver) ?? {
                    SENDER: sender,
                    RECEIVER: receiver,
                }
            );
        });
        this.respond('links.peers', (interfaceName, address) => {
            const links = isDemoInterface(interfaceName) ? DEMO_LINKS[interfaceName] : [];
            return links
                .filter((link) => link.SENDER === address || link.RECEIVER === address)
                .map((link) => (link.SENDER === address ? link.RECEIVER : link.SENDER));
        });
        this.respond('data.file', (path) => {
            const file = DEMO_DATA_FILES[path];
            if (file === undefined) {
                throw new ApiRequestError({message: `no demo data file ${path}`, kind: 'config'});
            }
            return file;
        });
        this.useDemoMeta();
        // D-32: the demo runs in a browser with no host and therefore no login. `null` is the
        // answer every install type but the CCU addon in `--auth-mode rega` gives, and it is what
        // makes the header show no user and no logout link.
        this.result('session.info', null);
        return this;
    }

    /**
     * D-40, task 25: the metadata store of the demo, in memory and alive.
     *
     * Core's `MetaStore` is the same class the backend's `local` provider and the conformance
     * corpus run, so a room created, moved or deleted in the browser demo behaves as it would
     * against a backend - one revision per write, `has-members` on a delete that would orphan
     * memberships - and the three events go out exactly as the backend sends them.
     */
    useDemoMeta(): this {
        const store = new MetaStore({document: parseDocument(structuredClone(DEMO_META))});
        const state = (): MetaState => ({
            provider: 'local',
            reachable: true,
            writable: true,
            revision: store.revision,
            objects: store.size,
        });
        const objects = (): Record<string, MetaObjectView> => {
            const document = store.document();
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
        };
        const enums = (): Record<string, MetaEnum> => structuredClone(store.enums()) as Record<string, MetaEnum>;
        const changed = (): void => {
            this.emit('meta.changed', state());
            this.emit('meta.enums.changed', enums());
            this.emit('meta.objects.changed', objects());
        };
        this.respond('meta.state', state);
        this.respond('meta.get', () => ({state: state(), enums: enums(), objects: objects()}));
        this.respond('meta.enums', enums);
        this.respond('meta.objects', objects);
        this.respond('meta.setMembership', (entries) => {
            const sets: Record<string, {enums: string[]}> = {};
            for (const entry of entries) {
                sets[entry.ref] = {enums: entry.paths};
            }
            store.bulk(sets);
            changed();
            return null;
        });
        this.respond('meta.assign', (refs, path, on) => {
            const sets: Record<string, {name?: string; enums: string[]}> = {};
            for (const ref of refs) {
                const current = store.find(ref);
                const paths = current?.enums ?? [];
                const has = paths.includes(path);
                if (has === on) {
                    continue;
                }
                const next = on ? [...paths, path] : paths.filter((entry) => entry !== path);
                const address = ref.slice(ref.indexOf('.') + 1);
                sets[ref] = current ? {enums: next} : {name: DEMO_NAMES[address] ?? address, enums: next};
            }
            store.bulk(sets);
            changed();
            return null;
        });
        this.respond('meta.enum.create', (id, name) => {
            store.createEnum(id, name);
            changed();
            return null;
        });
        this.respond('meta.enum.update', (id, name) => {
            store.updateEnum(id, name);
            changed();
            return null;
        });
        this.respond('meta.enum.delete', (id, detach) => {
            store.deleteEnum(id, detach === true ? 'detach' : 'refuse');
            changed();
            return null;
        });
        this.respond('meta.node.create', (enumId, parent, name, options) => {
            const tree = store.getEnum(enumId).tree;
            const parsed = parent === undefined ? undefined : parsePath(parent);
            const siblings = parsed === undefined ? tree : (findNode(tree, parsed.ids)?.children ?? []);
            const id = slugId(
                name,
                siblings.map((node) => node.id),
            );
            store.createNode(enumId, parent ?? null, id, name, options ?? {});
            changed();
            return `${parent ?? enumId}/${id}`;
        });
        this.respond('meta.node.update', (path, patch) => {
            store.updateNode(path, patch);
            changed();
            return null;
        });
        this.respond('meta.node.delete', (path, detach) => {
            store.deleteNode(path, detach === true ? 'detach' : 'refuse');
            changed();
            return null;
        });
        this.respond('meta.refresh', () => {
            changed();
            return state();
        });
        this.respond('meta.export', () => store.document());
        this.respond('meta.import', (document, mode) => {
            store.import(document, mode ?? 'replace');
            changed();
            return null;
        });
        return this;
    }
}
