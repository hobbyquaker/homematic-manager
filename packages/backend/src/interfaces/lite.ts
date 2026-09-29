/**
 * Task 72: the interfaces of an openccu-lite system, reached from off the system.
 *
 * A CCU calls its clients back, so `manager.ts` runs callback servers and subscribes to every
 * interface process with `init`. openccu-lite does not call a remote client at all (its D-70): the
 * requests go to the system's web port - lite-rpc's JSON-RPC path, one per interface, with the
 * profile's API token - and the events come from a stream the client opens itself. occulite-client
 * owns that stream and its reliability: reconnect with backoff, resume by the last event id, a
 * `resync` after a gap or another boot of the system. What is left here is this application's:
 *
 * - the {@link Interfaces} surface the backend talks to, so the write queue, the RPC log and every
 *   `ApiMethods` handler are the same code on both paths;
 * - the stream's events handed to the very same {@link CallbackHandler} the callback servers feed,
 *   so the grids, the service messages and the event log do not know where an event came from;
 * - the state per interface as the popup shows it, from the system's interface list and the
 *   client's status;
 * - the errors as the backend knows them: a fault of the interface process stays a fault, a
 *   scope the token lacks is said as such and never taken for a lost connection (task 78's tiers).
 *
 * The CCU path is untouched: on the system itself the addon keeps its loopback callbacks
 * (maintainer, 2026-09-27: "remote only"), and a CCU never gets here at all.
 */

import {
    OccuLite,
    OccuLiteError,
    parseRef,
    type DeviceDescription as LiteDeviceDescription,
    type Options as OccuLiteOptions,
    type Transport,
    type ValueEvent,
} from 'occulite-client';

import {
    isExplicitDouble,
    isKnownInterface,
    normaliseDescription,
    type ConnectionConfig,
    type DeviceDescription,
    type InterfaceState,
    type ResolvedInterface,
    type RpcOrigin,
    type RpcValue,
} from '@homematic-manager/core';

import {interfaceTargets, type InterfaceTarget} from '../config/defaults.js';
import {BackendError, configError, connectionError, errorMessage, rpcFaultError} from '../errors.js';
import type {RpcCallOptions, RpcCallRecord, RpcOutValue} from '../rpc/client.js';
import type {CallbackHandler} from '../rpc/server.js';
import type {InterfaceLink, Interfaces} from './manager.js';

/**
 * The waits between two attempts to reach a system that does not answer: quick at first (it may be
 * booting), then a minute. A remote system that is off for the night is not asked every two seconds.
 */
export const LITE_RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000, 15_000, 30_000, 60_000];

/** How long one request may take; the same as the CCU path's clients. */
export const LITE_RPC_TIMEOUT_MS = 20_000;

/** How long the first picture - the version, the credential, the interfaces, the values - may take. */
export const LITE_CONNECT_TIMEOUT_MS = 30_000;

export interface LiteInterfacesOptions {
    readonly connection: ConnectionConfig;
    /** Where the system answered the detection: `https://…` when it redirected there (B-67). */
    readonly baseUrl: string;
    /** The profile's API token (`metaToken`); paired, or made on the system's API tokens page. */
    readonly token: string;
    /** The transport with the profile's certificate trust (`systemTransport`). */
    readonly transport: Transport;
    /** What the stream's events become - the same handler the callback servers feed. */
    readonly handler: CallbackHandler;
    readonly onStateChanged: (states: InterfaceState[]) => void;
    readonly onNotice: (level: 'debug' | 'info' | 'warn' | 'error', message: string, interfaceName?: string) => void;
    /** Called once an interface is reachable - the backend fills its caches there. */
    readonly onConnected?: (interfaceName: string) => void | Promise<void>;
    readonly onCall?: (record: RpcCallRecord) => void;
    /** Task 48: the origin of a call that names none (the backend's request context). */
    readonly originOf?: () => RpcOrigin;
    readonly now?: () => number;
    readonly rpcTimeoutMs?: number;
    readonly connectTimeoutMs?: number;
    /** The retry schedule after a system that does not answer; {@link LITE_RETRY_DELAYS_MS}. */
    readonly retryDelaysMs?: readonly number[];
    /** Injected by the tests. */
    readonly createClient?: (options: OccuLiteOptions) => OccuLite;
}

interface LiteEntry {
    readonly name: string;
    readonly target: InterfaceTarget;
    state: InterfaceState;
    lastEvent: number;
}

/**
 * A value as lite-rpc's JSON path takes it. The core writes a `FLOAT` as `{explicitDouble: n}` for
 * the XML-RPC and BIN-RPC encoders; the JSON path types a double as `{"double": n}` where the system
 * says it understands that (`json_double`, openccu-lite task 196's S2), and takes the plain number
 * everywhere else - a fraction is a double either way, only a whole number needs the hint.
 */
export function toWire(value: RpcOutValue, typedDouble: boolean): unknown {
    if (isExplicitDouble(value)) {
        return typedDouble ? {double: value.explicitDouble} : value.explicitDouble;
    }
    if (Array.isArray(value)) {
        return value.map((entry) => toWire(entry, typedDouble));
    }
    if (typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toWire(entry, typedDouble)]));
    }
    return value;
}

/**
 * An answer of the JSON path as an `RpcValue`: JSON has `null` where XML-RPC has an empty string
 * (a method without a result), and nothing else the contract does not know.
 */
export function fromWire(value: unknown): RpcValue {
    if (value === null || value === undefined) {
        return '';
    }
    if (Array.isArray(value)) {
        return value.map((entry) => fromWire(entry));
    }
    if (typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, fromWire(entry)]),
        );
    }
    if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
        return value;
    }
    // a bigint, a symbol or a function cannot come out of JSON; said rather than swallowed
    return typeof value === 'bigint' ? value.toString() : '';
}

/** Is this stream event a device's report - and not the system confirming a value it holds? */
function isDeviceEvent(event: ValueEvent): boolean {
    return event.source === undefined || event.source === 'event';
}

/** The interfaces of an openccu-lite system, over occulite-client. */
export class LiteInterfaces implements Interfaces {
    readonly #options: LiteInterfacesOptions;
    readonly #now: () => number;
    readonly #entries = new Map<string, LiteEntry>();
    readonly #url: URL;

    #box: OccuLite | undefined;
    /** Counts the clients opened; a handler of an older client says nothing. */
    #generation = 0;
    #retryTimer: ReturnType<typeof setTimeout> | undefined;
    #attempts = 0;
    #stopping = false;
    #idle = false;
    /** Whether the running client has reached `ready` at least once. */
    #ready = false;

    constructor(options: LiteInterfacesOptions) {
        this.#options = options;
        this.#now = options.now ?? (() => Date.now());
        this.#url = new URL(options.baseUrl);
    }

    get idle(): boolean {
        return this.#idle;
    }

    /** The client in use, for a test and for the backend's values (task 68). */
    get box(): OccuLite | undefined {
        return this.#box;
    }

    states(): InterfaceState[] {
        return [...this.#entries.values()].map((entry) => entry.state);
    }

    client(interfaceName: string): InterfaceLink {
        const entry = this.#entries.get(interfaceName);
        if (!entry) {
            throw configError(`interface "${interfaceName}" is not configured`);
        }
        return {
            call: (method, params = [], options = {}) => this.#call(entry, method, params, options),
        };
    }

    isConnected(interfaceName: string): boolean {
        return this.#entries.get(interfaceName)?.state.connected ?? false;
    }

    names(): string[] {
        return [...this.#entries.keys()];
    }

    resolved(interfaceName: string): ResolvedInterface | undefined {
        return this.#entries.get(interfaceName)?.target.resolved;
    }

    /**
     * Builds the entries and opens the client. Resolves once the first attempt is through - a
     * system that does not answer leaves an error in every state and is tried again; it does not
     * throw.
     */
    async start(): Promise<void> {
        const connection = this.#options.connection;
        if (connection.host === '') {
            throw configError('no CCU address configured');
        }
        const targets = interfaceTargets(connection);
        if (targets.length === 0) {
            throw configError('no interface selected');
        }
        const port = Number(this.#url.port) || (this.#url.protocol === 'https:' ? 443 : 80);
        for (const target of targets) {
            const {name} = target.resolved;
            this.#entries.set(name, {
                name,
                target,
                lastEvent: 0,
                state: {
                    name,
                    type: isKnownInterface(name) ? name : 'custom',
                    protocol: target.resolved.protocol,
                    host: this.#url.hostname,
                    port,
                    ...(this.#url.protocol === 'https:' ? {tls: true} : {}),
                    lite: true,
                    connected: false,
                    waiting: true,
                },
            });
        }
        this.#changed();
        await this.#open();
    }

    /** D-31: closes the stream and forgets nothing; {@link subscribe} opens it again. */
    async unsubscribe(): Promise<void> {
        if (this.#idle || this.#entries.size === 0) {
            return;
        }
        this.#idle = true;
        this.#closeBox();
        for (const entry of this.#entries.values()) {
            entry.lastEvent = 0;
            this.#update(entry, {
                connected: false,
                error: undefined,
                idle: true,
                subscribing: false,
                unreachable: false,
                waiting: false,
                reconnecting: false,
            });
        }
        this.#changed();
        await Promise.resolve();
    }

    async subscribe(): Promise<void> {
        if (!this.#idle) {
            return;
        }
        this.#idle = false;
        for (const entry of this.#entries.values()) {
            this.#update(entry, {idle: false, waiting: true});
        }
        this.#changed();
        await this.#open();
    }

    /**
     * `interfaces.reconnect`: the user saying "try now". A client that is not up is opened again at
     * once (a token pasted after a refusal, a system that came back); one that is up re-reads the
     * interface's devices, which is all a subscription-less path has to redo.
     */
    async reconnect(interfaceName?: string): Promise<void> {
        if (interfaceName !== undefined && !this.#entries.has(interfaceName)) {
            throw configError(`interface "${interfaceName}" is not configured`);
        }
        if (
            this.#box === undefined ||
            !this.#ready ||
            this.#box.status === 'offline' ||
            this.#box.status === 'closed'
        ) {
            this.#clearRetry();
            await this.#open();
            return;
        }
        const names = interfaceName === undefined ? [...this.#entries.keys()] : [interfaceName];
        await Promise.all(names.filter((name) => this.#running(name)).map((name) => this.#connected(name)));
        this.#changed();
    }

    /** Closes the stream; nothing is de-registered, because nothing was registered. */
    async stop(): Promise<void> {
        this.#stopping = true;
        this.#clearRetry();
        this.#closeBox();
        this.#entries.clear();
        this.#options.onStateChanged([]);
        await Promise.resolve();
    }

    noteEvent(interfaceName: string, kind: 'event' | 'device' = 'event'): void {
        const entry = this.#entries.get(interfaceName);
        if (!entry) {
            return;
        }
        entry.lastEvent = this.#now();
        if (kind === 'event' && !entry.state.connected && this.#ready && this.#running(interfaceName)) {
            this.#update(entry, {connected: true, error: undefined, unreachable: false, reconnecting: false});
        }
        this.#changed();
    }

    /*
     * the client
     */

    #closeBox(): void {
        this.#box?.close();
        this.#box = undefined;
        this.#ready = false;
    }

    #clearRetry(): void {
        if (this.#retryTimer !== undefined) {
            clearTimeout(this.#retryTimer);
            this.#retryTimer = undefined;
        }
    }

    /** Opens a fresh client; the old one is closed. Resolves when it is ready or has failed. */
    async #open(): Promise<void> {
        if (this.#stopping || this.#idle) {
            return;
        }
        this.#closeBox();
        this.#clearRetry();
        const generation = ++this.#generation;
        const debug = (message: string): void => {
            this.#options.onNotice('debug', `occulite-client: ${message}`);
        };
        const options: OccuLiteOptions = {
            url: this.#options.baseUrl,
            auth: {token: this.#options.token},
            transport: this.#options.transport,
            interfaces: [...this.#entries.keys()],
            // the state store at connect (task 68's timestamps); no sweep of every channel - the
            // grids read a paramset when they need it, as on a CCU, and rfd asks a BidCos device on
            // the air for each such call. No metadata: the provider follows that stream itself, and
            // the system allows two streams per token (task 196), which this and that one are.
            values: true,
            meta: false,
            // the backend lists the devices itself when an interface comes up (as after an `init`),
            // so the client is not asked to fetch them a second time
            devices: false,
            timeout: this.#options.rpcTimeoutMs ?? LITE_RPC_TIMEOUT_MS,
            connectTimeout: this.#options.connectTimeoutMs ?? LITE_CONNECT_TIMEOUT_MS,
            log: {debug, info: debug, warn: debug, error: debug},
        };
        const box = (this.#options.createClient ?? ((clientOptions) => new OccuLite(clientOptions)))(options);
        this.#box = box;
        const current = (): boolean => this.#box === box && this.#generation === generation && !this.#stopping;
        box.on('value', (event: ValueEvent) => {
            if (current() && isDeviceEvent(event)) {
                this.#options.handler.event(event.interface, event.address, event.key, fromWire(event.value));
            }
        });
        box.on(
            'devices',
            (event: {kind: string; interface: string; refs: string[]; descriptions?: LiteDeviceDescription[]}) => {
                if (current()) {
                    void this.#onDevices(box, event);
                }
            },
        );
        box.on('interface', (event: {interface: string; state: string}) => {
            if (current()) {
                this.#onInterface(event.interface, event.state);
            }
        });
        box.on('status', (event: {state: OccuLite['status']}) => {
            if (current()) {
                this.#onStatus(event.state);
            }
        });
        box.on('resync', (event: {reason: string}) => {
            if (current()) {
                this.#options.onNotice(
                    'info',
                    `the system's event stream was resynchronised (${event.reason}); the devices are read again`,
                );
                void this.#connectAll();
            }
        });
        box.on('error', (error: unknown) => {
            if (current()) {
                this.#options.onNotice('debug', `occulite-client: ${errorMessage(error)}`);
            }
        });
        try {
            await box.ready();
        } catch (error) {
            if (current()) {
                this.#noteFailure(error);
            }
            return;
        }
        if (!current()) {
            return;
        }
        this.#attempts = 0;
        this.#ready = true;
        if (box.mode === 'names-only') {
            // a token from the metadata store's days: it reads names and nothing else. Not tried
            // again - a token does not grow scopes by waiting - and said once, where it is fixed
            const message =
                'the API token reads names only (it lacks rpc:read): pair this application with the system, ' +
                'or grant the token more access on its API tokens page';
            for (const entry of this.#entries.values()) {
                this.#update(entry, {connected: false, error: message, waiting: false, unreachable: false});
            }
            this.#options.onNotice('error', message);
            this.#changed();
            return;
        }
        this.#options.onNotice(
            'info',
            `connected to ${box.info.implementation ?? 'the openccu-lite system'} at ${this.#options.baseUrl} ` +
                `(${box.interfaces.filter((entry) => entry.running).length} of ${String(box.interfaces.length)} interfaces running)`,
        );
        this.#applyInterfaces();
        await this.#connectAll();
    }

    /** The interface list of the client, into the states: running, stopped, or not on this system. */
    #applyInterfaces(): void {
        const box = this.#box;
        if (box === undefined) {
            return;
        }
        for (const entry of this.#entries.values()) {
            const info = box.interfaces.find((candidate) => candidate.name === entry.name);
            if (info === undefined) {
                this.#update(entry, {
                    connected: false,
                    error: `${entry.name}: the system runs no such interface`,
                    absent: true,
                    unreachable: false,
                    waiting: false,
                    reconnecting: false,
                });
            } else if (!info.running) {
                this.#update(entry, {
                    connected: false,
                    error: `${entry.name}: the interface process is not running on the system`,
                    absent: false,
                    unreachable: false,
                    waiting: false,
                    reconnecting: false,
                });
            } else {
                this.#update(entry, {
                    connected: true,
                    error: undefined,
                    absent: false,
                    unreachable: false,
                    waiting: false,
                    reconnecting: false,
                });
            }
        }
        this.#changed();
    }

    #running(interfaceName: string): boolean {
        return this.#box?.interfaces.some((entry) => entry.name === interfaceName && entry.running) === true;
    }

    /** Every running interface is "connected": the backend fills its caches. */
    async #connectAll(): Promise<void> {
        await Promise.all(
            [...this.#entries.keys()].filter((name) => this.#running(name)).map((name) => this.#connected(name)),
        );
    }

    /**
     * The counterpart of a successful `init`: the backend lists the devices and the service
     * messages. `subscribing` while it runs, so the UI says so until the grids are complete.
     */
    async #connected(interfaceName: string): Promise<void> {
        const entry = this.#entries.get(interfaceName);
        const box = this.#box;
        if (entry === undefined || box === undefined) {
            return;
        }
        entry.lastEvent = this.#now();
        this.#update(entry, {
            connected: true,
            error: undefined,
            subscribing: true,
            waiting: false,
            reconnecting: false,
            absent: false,
            unreachable: false,
        });
        this.#changed();
        try {
            await this.#options.onConnected?.(interfaceName);
        } finally {
            if (this.#box === box && this.#entries.get(interfaceName) === entry) {
                this.#update(entry, {subscribing: false});
                this.#changed();
            }
        }
    }

    /** A failed connect: what it was, said once, and the next attempt where one makes sense. */
    #noteFailure(error: unknown): void {
        const code = error instanceof OccuLiteError ? error.code : '';
        const message = errorMessage(error);
        const first = this.#attempts === 0;
        this.#attempts += 1;
        let text: string;
        let retry = true;
        let unreachable = false;
        switch (code) {
            case 'unauthenticated':
                text = `the openccu-lite system at ${this.#options.baseUrl} refuses the API token: pair this application with it again, or check the token`;
                retry = false;
                break;
            case 'certificate':
                text = `the certificate of ${this.#options.baseUrl} is not trusted: ${message}`;
                retry = false;
                break;
            case 'unsupported':
                text = `${this.#options.baseUrl}: ${message}`;
                break;
            default:
                text = `${this.#options.baseUrl} does not answer: ${message}`;
                unreachable = true;
        }
        for (const entry of this.#entries.values()) {
            this.#update(entry, {
                connected: false,
                error: text,
                unreachable,
                waiting: retry && unreachable,
                reconnecting: false,
                subscribing: false,
            });
        }
        this.#changed();
        this.#options.onNotice(first ? (retry ? 'warn' : 'error') : 'debug', text);
        if (!retry || this.#stopping || this.#idle) {
            return;
        }
        const delays = this.#options.retryDelaysMs ?? LITE_RETRY_DELAYS_MS;
        const delay = delays[Math.min(this.#attempts - 1, delays.length - 1)] ?? 60_000;
        const timer = setTimeout(() => {
            this.#retryTimer = undefined;
            void this.#open();
        }, delay);
        if (typeof timer.unref === 'function') {
            timer.unref();
        }
        this.#retryTimer = timer;
    }

    /*
     * the stream
     */

    #onStatus(status: OccuLite['status']): void {
        switch (status) {
            case 'degraded':
                // the stream is being reopened; the requests still work, so the state says
                // "reconnecting" rather than "gone" - which is what a lost subscription is on a CCU
                for (const entry of this.#entries.values()) {
                    if (entry.state.connected) {
                        this.#update(entry, {connected: false, reconnecting: true});
                    }
                }
                this.#changed();
                break;
            case 'ready':
                if (this.#ready) {
                    // back from `degraded`: the client resumed the stream, or re-read after a gap
                    // (then `resync` follows and the devices are read again)
                    this.#applyInterfaces();
                }
                break;
            case 'offline': {
                const message = `the openccu-lite system at ${this.#options.baseUrl} refuses the API token: pair this application with it again, or check the token`;
                for (const entry of this.#entries.values()) {
                    this.#update(entry, {connected: false, error: message, reconnecting: false, waiting: false});
                }
                this.#changed();
                this.#options.onNotice('error', message);
                break;
            }
            default:
                break;
        }
    }

    /** An interface process came up, went down, or the system gained or lost an interface. */
    #onInterface(interfaceName: string, state: string): void {
        const entry = this.#entries.get(interfaceName);
        if (entry === undefined) {
            return;
        }
        switch (state) {
            case 'up':
            case 'added':
            case 'restarted':
                if (this.#ready) {
                    this.#options.onNotice('info', `${interfaceName}: the interface process is up`, interfaceName);
                    void this.#connected(interfaceName);
                }
                break;
            case 'down':
                this.#update(entry, {
                    connected: false,
                    error: `${interfaceName}: the interface process is not running on the system`,
                    reconnecting: false,
                    absent: false,
                });
                this.#changed();
                this.#options.onNotice('warn', `${interfaceName}: the interface process is down`, interfaceName);
                break;
            case 'removed':
                this.#update(entry, {
                    connected: false,
                    error: `${interfaceName}: the system runs no such interface`,
                    absent: true,
                    reconnecting: false,
                });
                this.#changed();
                break;
            default:
                break;
        }
    }

    /** A device callback of the CCU, as the stream reports it. */
    async #onDevices(
        box: OccuLite,
        event: {kind: string; interface: string; refs: string[]; descriptions?: LiteDeviceDescription[]},
    ): Promise<void> {
        const handler = this.#options.handler;
        const addresses = event.refs.map((ref) => parseRef(ref).address);
        switch (event.kind) {
            case 'new': {
                let descriptions = event.descriptions;
                if (descriptions === undefined) {
                    // the live event carries the addresses only; the descriptions come from listDevices
                    try {
                        const wanted = new Set(addresses);
                        const list = await box.call<LiteDeviceDescription[]>(event.interface, 'listDevices');
                        descriptions = (Array.isArray(list) ? list : []).filter((entry) => wanted.has(entry.ADDRESS));
                    } catch (error) {
                        this.#options.onNotice(
                            'warn',
                            `${event.interface}: listDevices after newDevices failed: ${errorMessage(error)}`,
                            event.interface,
                        );
                        return;
                    }
                    if (this.#box !== box) {
                        return;
                    }
                }
                handler.newDevices(
                    event.interface,
                    descriptions.map((entry) => normaliseDescription(entry as unknown as DeviceDescription)),
                );
                break;
            }
            case 'deleted':
                handler.deleteDevices(event.interface, addresses);
                break;
            case 'replaced':
                if (addresses.length >= 2) {
                    handler.replaceDevice(event.interface, addresses[0] ?? '', addresses[1] ?? '');
                }
                break;
            case 'readded':
                handler.readdedDevice(event.interface, addresses);
                break;
            case 'updated':
                for (const address of addresses) {
                    handler.updateDevice(event.interface, address, 0);
                }
                break;
            default:
                break;
        }
    }

    /*
     * requests
     */

    async #call(
        entry: LiteEntry,
        method: string,
        params: readonly RpcOutValue[],
        options: RpcCallOptions,
    ): Promise<RpcValue> {
        // resolved before the first await: the context that asked is the one that counts (task 48)
        const origin = options.origin ?? this.#options.originOf?.() ?? 'background';
        const started = this.#now();
        const box = this.#box;
        try {
            if (box === undefined) {
                throw connectionError(`${entry.name}: not connected to the openccu-lite system`);
            }
            const typed = box.capabilities.json_double === true;
            const result = fromWire(
                await box.call(
                    entry.name,
                    method,
                    params.map((value) => toWire(value, typed)),
                ),
            );
            this.#record(entry.name, method, params, started, origin, {ok: true, result});
            return result;
        } catch (error) {
            const failure = this.#asBackendError(entry.name, method, error);
            this.#record(entry.name, method, params, started, origin, {ok: false, error: failure.message});
            throw failure;
        }
    }

    /**
     * What occulite-client threw, as the backend knows it: a fault of the interface process keeps its
     * code (`kind: 'rpc'`); a scope the token lacks is a matter of the configuration (`kind:
     * 'config'`), said per call and never as a lost connection - the interface is fine, the token
     * may read but not switch (task 78's tiers); everything else is the connection's.
     */
    #asBackendError(interfaceName: string, method: string, error: unknown): BackendError {
        if (error instanceof BackendError) {
            return error;
        }
        if (error instanceof OccuLiteError) {
            switch (error.code) {
                case 'rpc-fault':
                    return rpcFaultError(interfaceName, {faultCode: error.faultCode ?? -1, faultString: error.message});
                case 'forbidden':
                    return configError(
                        `${interfaceName}: the API token may not call ${method}` +
                            (error.scope === undefined ? '' : ` (it lacks ${error.scope})`) +
                            ' - pair this application with the system again with more access, or grant it on the API tokens page',
                    );
                case 'unauthenticated':
                    return configError(`${interfaceName}: the openccu-lite system refuses the API token`);
                case 'timeout':
                    return connectionError(`${interfaceName}: ${method} timed out`, error);
                default:
                    return connectionError(`${interfaceName}: ${error.message}`, error);
            }
        }
        return connectionError(`${interfaceName}: ${errorMessage(error)}`, error);
    }

    #record(
        interfaceName: string,
        method: string,
        params: readonly RpcOutValue[],
        started: number,
        origin: RpcOrigin,
        outcome: {ok: true; result: RpcValue} | {ok: false; error: string},
    ): void {
        this.#options.onCall?.({
            interfaceName,
            method,
            params: [...params],
            ok: outcome.ok,
            ...(outcome.ok ? {result: outcome.result} : {error: outcome.error}),
            durationMs: Math.max(0, this.#now() - started),
            timestamp: started,
            origin,
        });
    }

    /*
     * state
     */

    #changed(): void {
        this.#options.onStateChanged(this.states());
    }

    #update(
        entry: LiteEntry,
        changes: {
            connected?: boolean;
            error?: string | undefined;
            absent?: boolean;
            unreachable?: boolean;
            subscribing?: boolean;
            idle?: boolean;
            waiting?: boolean;
            reconnecting?: boolean;
        },
    ): void {
        const state: InterfaceState = {
            ...entry.state,
            ...(changes.connected === undefined ? {} : {connected: changes.connected}),
            ...(entry.lastEvent > 0 ? {lastEvent: entry.lastEvent} : {}),
        };
        for (const key of ['absent', 'unreachable', 'subscribing', 'idle', 'waiting', 'reconnecting'] as const) {
            const value = changes[key];
            if (value === true) {
                state[key] = true;
            } else if (value === false) {
                Reflect.deleteProperty(state, key);
            }
        }
        if ('error' in changes) {
            if (changes.error === undefined) {
                delete (state as {error?: string}).error;
            } else {
                state.error = changes.error;
            }
        }
        entry.state = state;
    }
}
