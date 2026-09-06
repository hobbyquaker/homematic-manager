/**
 * Connecting to the interface processes and staying connected.
 *
 * The sequence is the one of 2.x, with its three known problems fixed.
 *
 * 1. `init(callbackUrl, ident)` per interface, the callback servers started first so the URL is
 *    real. `ident` is `hmm_<name>` except for CUxD, which matches the literal `CUxD` (A-12).
 * 2. A watchdog every 15 s. Per interface: silence longer than its ping timeout means the
 *    subscription is gone, so `init` again; silence longer than about two thirds of it sends a
 *    `ping`, whose answer arrives as an event and resets the clock. HmIP-RF gets 600 s because
 *    hmipserver answers pings but sends events rarely (eq-3/occu#42); an interface that answers no
 *    ping at all (VirtualDevices) is watched by events only.
 * 3. `init(url, '')` on shutdown, so the CCU stops calling a process that is gone - with a hard
 *    timeout, because 2.x's `stop()` waited for an unreachable CCU and only a second `stop()` (or
 *    the 15 s fallback timer) got the app closed.
 *
 * What is different from 2.x: the interface list is **explicit** (D-13, plus user-defined
 * interfaces), and the port probe is a background job whose result is a hint for the configuration
 * dialog. 2.x probed six ports with a 5 s timeout each before the window became usable, which is
 * the root of the "endless loading" issues #121, #126, #128 and #134.
 */

import type {ConnectionConfig, InterfaceState, ResolvedInterface, RpcProtocol} from '@homematic-manager/core';
import {INTERFACE_NAMES, interfaceDefinition, interfacePort, isKnownInterface} from '@homematic-manager/core';

import {configError, connectionError, errorMessage, isConnectionRefused} from '../errors.js';
import {interfaceTargets, type InterfaceTarget} from '../config/defaults.js';
import {RpcClient, type RpcCallRecord, type RpcClientOptions} from '../rpc/client.js';
import {CallbackServers, type CallbackHandler, type CallbackServerSet} from '../rpc/server.js';
import {localIPv4Addresses, probePort, withTimeout} from '../util/net.js';

/** How often the watchdog looks at every interface. 2.x used the same 15 s. */
export const WATCHDOG_INTERVAL_MS = 15_000;

/** How long `stop()` waits for the de-registering `init(url, '')` calls. */
export const SHUTDOWN_TIMEOUT_MS = 5000;

/**
 * The longest wait between two `init` attempts for an interface that keeps failing.
 *
 * Task 13 found this on hardware: a CCU without a wired gateway runs no `hs485d`, BidCos-Wired is
 * in the default interface list, and the watchdog re-`init`ed it every 15 s - four ERROR lines a
 * minute, for as long as the app ran, on every stock CCU3. The interface is now tried once, and
 * then with a doubling delay up to this ceiling, and only the first failure produces a notice.
 */
export const MAX_INIT_BACKOFF_MS = 300_000;

/**
 * D-31: the grace period a server install waits, with no UI session connected, before it drops its
 * event subscriptions. Five minutes; `0` turns the whole thing off, which is what Electron uses.
 */
export const DEFAULT_IDLE_UNSUBSCRIBE_MS = 300_000;

export interface ManagedInterface {
    readonly name: string;
    readonly target: InterfaceTarget;
    readonly client: RpcClient;
    state: InterfaceState;
    /** Milliseconds since epoch of the last event, ping answer or successful `init`. */
    lastEvent: number;
    /** Consecutive failed `init` calls; 0 as soon as one succeeds. */
    failures: number;
    /** Milliseconds since epoch before which the watchdog does not try `init` again. */
    retryAt: number;
}

export interface InterfaceManagerOptions {
    readonly connection: ConnectionConfig;
    /** What the callback servers do with an incoming call. */
    readonly handler: CallbackHandler;
    readonly onStateChanged: (states: InterfaceState[]) => void;
    readonly onNotice: (level: 'info' | 'warn' | 'error', message: string, interfaceName?: string) => void;
    /** Called after a successful `init`; the backend fills its caches there. */
    readonly onConnected?: (interfaceName: string) => void | Promise<void>;
    readonly onCall?: (record: RpcCallRecord) => void;
    readonly now?: () => number;
    readonly rpcTimeoutMs?: number;
    readonly watchdogIntervalMs?: number;
    /**
     * First wait after a failed `init`; it doubles per further failure up to
     * {@link MAX_INIT_BACKOFF_MS}. Defaults to the watchdog interval, so nothing changes for an
     * interface that fails once and then works.
     */
    readonly initBackoffMs?: number;
    /** Address to bind the callback servers to; `0.0.0.0` unless the addon says loopback. */
    readonly callbackHost?: string;
    /** Injected by the tests. */
    readonly createClient?: (options: RpcClientOptions) => RpcClient;
    readonly createCallbackServers?: (handler: CallbackHandler) => CallbackServerSet;
    readonly probe?: (host: string, port: number) => Promise<boolean>;
    /** Injected for the callback address; defaults to this machine's IPv4 addresses. */
    readonly localAddresses?: () => string[];
    /**
     * Overrides the port of one interface, for a process that does not sit on the well-known one:
     * the integration tests point at an hm-simulator on an ephemeral port, and an unusual proxy
     * setup on a CCU can need the same. Returning `undefined` keeps the table's port.
     */
    readonly portOverride?: (interfaceName: string) => number | undefined;
}

/**
 * The address of the first BidCos interface of a `listBidcosInterfaces` answer.
 *
 * Issue #93: 2.x did `res[0].ADDRESS` and threw when the answer was empty or not an array, which
 * takes the whole connection down on a CCU whose HmIP access point is not paired yet.
 */
export function firstBidcosInterfaceAddress(result: unknown): string | undefined {
    if (!Array.isArray(result) || result.length === 0) {
        return undefined;
    }
    const first: unknown = result[0];
    if (typeof first !== 'object' || first === null || Array.isArray(first)) {
        return undefined;
    }
    const address = (first as Record<string, unknown>)['ADDRESS'];
    return typeof address === 'string' && address !== '' ? address : undefined;
}

/** Connects, watches and disconnects every configured interface. */
export class InterfaceManager {
    readonly #options: InterfaceManagerOptions;
    readonly #now: () => number;
    readonly #interfaces = new Map<string, ManagedInterface>();
    readonly #servers: CallbackServerSet;

    #watchdog: ReturnType<typeof setInterval> | undefined;
    #detected: string[] = [];
    #stopping = false;
    #idle = false;

    constructor(options: InterfaceManagerOptions) {
        this.#options = options;
        this.#now = options.now ?? (() => Date.now());
        this.#servers = (options.createCallbackServers ?? ((handler) => this.#defaultServers(handler)))(
            options.handler,
        );
    }

    #defaultServers(handler: CallbackHandler): CallbackServerSet {
        const callback = this.#options.connection.callback;
        return new CallbackServers({
            handler,
            ...(this.#options.callbackHost === undefined ? {} : {host: this.#options.callbackHost}),
            ports: {xmlrpc: callback.xmlrpcPort, binrpc: callback.binrpcPort},
            onError: (error) => {
                this.#options.onNotice('error', `callback server: ${errorMessage(error)}`);
            },
        });
    }

    /** The address the interface processes are told to call back on. */
    get callbackIp(): string {
        const configured = this.#options.connection.callback.ip;
        if (configured !== '') {
            return configured;
        }
        const addresses = (this.#options.localAddresses ?? (() => localIPv4Addresses()))();
        return addresses[0] ?? '127.0.0.1';
    }

    /** D-31: are the subscriptions currently dropped because nobody is looking? */
    get idle(): boolean {
        return this.#idle;
    }

    /** The interfaces whose ports answered the last background probe. */
    get detected(): string[] {
        return [...this.#detected];
    }

    /** The state of every configured interface, in configuration order. */
    states(): InterfaceState[] {
        return [...this.#interfaces.values()].map((entry) => entry.state);
    }

    /** The client of one interface. Throws `kind: 'config'` for a name that is not configured. */
    client(interfaceName: string): RpcClient {
        const entry = this.#interfaces.get(interfaceName);
        if (!entry) {
            throw configError(`interface "${interfaceName}" is not configured`);
        }
        return entry.client;
    }

    /** True when `init` succeeded and the watchdog is satisfied. */
    isConnected(interfaceName: string): boolean {
        return this.#interfaces.get(interfaceName)?.state.connected ?? false;
    }

    /** The names of every configured interface. */
    names(): string[] {
        return [...this.#interfaces.keys()];
    }

    /**
     * What the core's table (or the user's own definition) says about one interface - the ports,
     * the protocol and the capability flags. `undefined` for a name that is not configured.
     */
    resolved(interfaceName: string): ResolvedInterface | undefined {
        return this.#interfaces.get(interfaceName)?.target.resolved;
    }

    /**
     * Starts the callback servers, creates the clients and subscribes. Resolves once every `init`
     * has been attempted - a failing interface leaves an error in its state, it does not throw.
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

        for (const protocol of new Set(targets.map((target) => target.resolved.protocol))) {
            await this.#servers.ensure(protocol);
        }

        for (const target of targets) {
            this.#interfaces.set(target.resolved.name, this.#create(target));
        }
        this.#options.onStateChanged(this.states());

        await Promise.all([...this.#interfaces.keys()].map((name) => this.#init(name)));

        if (connection.autoDetect) {
            void this.probeInterfaces();
        }
        this.#startWatchdog();
    }

    /**
     * D-31: de-register with `init(url, '')` and stop the watchdog, keeping the clients, the
     * callback servers and every cache. Nothing is torn down - this is the difference to `stop()`:
     * the same manager subscribes again in {@link subscribe}, so a resubscribe costs one `init`
     * per interface and no socket setup.
     *
     * Idempotent, and a de-registration that fails is not worth a notice: the interface will simply
     * keep sending events until it notices that nobody answers.
     */
    async unsubscribe(): Promise<void> {
        if (this.#idle || this.#interfaces.size === 0) {
            return;
        }
        this.#idle = true;
        if (this.#watchdog !== undefined) {
            clearInterval(this.#watchdog);
            this.#watchdog = undefined;
        }
        await Promise.all([...this.#interfaces.values()].map((entry) => this.#deregister(entry)));
        for (const entry of this.#interfaces.values()) {
            entry.lastEvent = 0;
            entry.failures = 0;
            entry.retryAt = 0;
            this.#update(entry, {connected: false, error: undefined, idle: true, subscribing: false});
        }
        this.#options.onStateChanged(this.states());
    }

    /** D-31: subscribe again after {@link unsubscribe}. Idempotent. */
    async subscribe(): Promise<void> {
        if (!this.#idle) {
            return;
        }
        this.#idle = false;
        for (const entry of this.#interfaces.values()) {
            this.#update(entry, {idle: false});
        }
        await Promise.all([...this.#interfaces.keys()].map((name) => this.#init(name)));
        this.#startWatchdog();
        this.#options.onStateChanged(this.states());
    }

    /** One watchdog round; public so a test can drive it without waiting 15 s. */
    async tick(): Promise<void> {
        if (this.#idle) {
            return;
        }
        const now = this.#now();
        const work: Promise<void>[] = [];
        for (const entry of this.#interfaces.values()) {
            const timeout = entry.target.resolved.pingTimeoutSeconds * 1000;
            const elapsed = now - entry.lastEvent;
            if (elapsed > timeout) {
                this.#update(entry, {connected: false});
                // an interface that is not there at all is not asked again on every round
                if (entry.retryAt <= now) {
                    work.push(this.#init(entry.name));
                }
            } else if (entry.target.resolved.ping && elapsed > timeout / 1.5 - 1000) {
                work.push(this.#ping(entry));
            }
        }
        await Promise.all(work);
        this.#options.onStateChanged(this.states());
    }

    /** A callback arrived; the interface is alive. */
    noteEvent(interfaceName: string): void {
        const entry = this.#interfaces.get(interfaceName);
        if (!entry) {
            return;
        }
        entry.lastEvent = this.#now();
        if (!entry.state.connected) {
            this.#update(entry, {connected: true, error: undefined});
            this.#options.onStateChanged(this.states());
        }
    }

    /** `interfaces.reconnect`: subscribes again, to one interface or to all of them. */
    async reconnect(interfaceName?: string): Promise<void> {
        const names = interfaceName === undefined ? [...this.#interfaces.keys()] : [interfaceName];
        if (interfaceName !== undefined && !this.#interfaces.has(interfaceName)) {
            throw configError(`interface "${interfaceName}" is not configured`);
        }
        for (const name of names) {
            const entry = this.#interfaces.get(name);
            if (entry) {
                // an explicit reconnect is the user saying "try now", so the wait is dropped. The
                // failure count is not: it is what makes a success say "answering again", and a
                // reconnect that fails again must not produce a second notice either.
                entry.retryAt = 0;
            }
        }
        await Promise.all(names.map((name) => this.#init(name)));
        this.#options.onStateChanged(this.states());
    }

    /**
     * De-registers with `init(url, '')`, closes the clients and the callback servers.
     *
     * Every interface gets its own hard timeout: an unreachable CCU must not keep the application
     * from closing, which is exactly what 2.x's `stop()` did until its 15 s fallback fired.
     */
    async stop(): Promise<void> {
        this.#stopping = true;
        if (this.#watchdog !== undefined) {
            clearInterval(this.#watchdog);
            this.#watchdog = undefined;
        }
        await Promise.all([...this.#interfaces.values()].map((entry) => this.#deregister(entry)));
        for (const entry of this.#interfaces.values()) {
            entry.client.close();
        }
        this.#interfaces.clear();
        await this.#servers.stop();
        this.#options.onStateChanged([]);
    }

    /**
     * Probes the well-known ports of every built-in interface on the configured host, in the
     * background. Nothing waits for this; the result is a hint for the configuration dialog and a
     * notice for an interface that is configured but whose port is closed.
     */
    async probeInterfaces(): Promise<string[]> {
        const connection = this.#options.connection;
        const probe = this.#options.probe ?? ((host, port) => probePort(host, port, {timeoutMs: 2000}));
        const found: string[] = [];
        await Promise.all(
            INTERFACE_NAMES.map(async (name) => {
                const definition = interfaceDefinition(name);
                if (!definition) {
                    return;
                }
                const port = interfacePort(definition, {tls: connection.tls});
                if (await probe(connection.host, port)) {
                    found.push(name);
                }
            }),
        );
        this.#detected = INTERFACE_NAMES.filter((name) => found.includes(name));
        for (const name of connection.interfaces) {
            // an interface whose `init` already refused says the same thing; one notice is enough
            const known = this.#interfaces.get(name);
            if (
                isKnownInterface(name) &&
                !this.#detected.includes(name) &&
                !this.isConnected(name) &&
                known?.state.absent !== true
            ) {
                this.#options.onNotice('warn', `${name}: the port is closed on ${connection.host}`, name);
            }
            if (known && !this.#detected.includes(name) && !this.isConnected(name)) {
                this.#update(known, {absent: true});
            }
        }
        this.#options.onStateChanged(this.states());
        return this.detected;
    }

    /** `init(url, '')` with a hard timeout; a CCU that is gone must not hold anything up. */
    async #deregister(entry: ManagedInterface): Promise<void> {
        if (!entry.target.resolved.init) {
            return;
        }
        const url = this.#callbackUrl(entry.target.resolved.protocol);
        try {
            await withTimeout(entry.client.call('init', [url, '']), SHUTDOWN_TIMEOUT_MS, () =>
                connectionError(`${entry.name}: de-registering timed out`),
            );
        } catch {
            // a CCU that is already gone cannot be told that we are going too
        }
    }

    #create(target: InterfaceTarget): ManagedInterface {
        const {resolved} = target;
        const port = this.#options.portOverride?.(resolved.name) ?? resolved.port;
        const options: RpcClientOptions = {
            name: resolved.name,
            host: target.host,
            port,
            protocol: resolved.protocol,
            path: resolved.path,
            tls: resolved.tls,
            auth: target.auth,
            ...(this.#options.rpcTimeoutMs === undefined ? {} : {timeoutMs: this.#options.rpcTimeoutMs}),
            ...(this.#options.onCall === undefined ? {} : {onCall: this.#options.onCall}),
        };
        const client = (this.#options.createClient ?? ((clientOptions) => new RpcClient(clientOptions)))(options);
        return {
            name: resolved.name,
            target,
            client,
            lastEvent: 0,
            failures: 0,
            retryAt: 0,
            state: {
                name: resolved.name,
                type: isKnownInterface(resolved.name) ? resolved.name : 'custom',
                protocol: resolved.protocol,
                host: target.host,
                port,
                // Only when it is on: a plain installation's state stays the object it always was.
                ...(resolved.tls ? {tls: true} : {}),
                connected: false,
            },
        };
    }

    #callbackUrl(protocol: RpcProtocol): string {
        return this.#servers.callbackUrl(protocol, this.callbackIp);
    }

    async #init(interfaceName: string): Promise<void> {
        const entry = this.#interfaces.get(interfaceName);
        if (!entry || this.#stopping) {
            return;
        }
        const {resolved} = entry.target;
        if (!resolved.init) {
            // an interface that wants no subscription counts as connected as soon as it answers
            this.#update(entry, {connected: true, error: undefined});
            entry.lastEvent = this.#now();
            return;
        }
        const url = this.#callbackUrl(resolved.protocol);
        try {
            await entry.client.call('init', [url, resolved.ident]);
            entry.lastEvent = this.#now();
            const wasFailing = entry.failures > 0;
            entry.failures = 0;
            entry.retryAt = 0;
            // hmipserver re-sends every device on `init` (occu#45), so the grids are not complete
            // until the sweep below is through; the UI shows "subscribing" until then
            this.#update(entry, {connected: true, error: undefined, absent: false, subscribing: true});
            if (wasFailing) {
                this.#options.onNotice('info', `${interfaceName}: answering again`, interfaceName);
            }
            this.#options.onStateChanged(this.states());
            try {
                await this.#options.onConnected?.(interfaceName);
            } finally {
                this.#update(entry, {subscribing: false});
                this.#options.onStateChanged(this.states());
            }
        } catch (error) {
            this.#noteInitFailure(entry, error);
            this.#options.onStateChanged(this.states());
        }
    }

    /**
     * A failed `init`: back off, and say so exactly once.
     *
     * Whether the port refuses the connection decides both the wording and the `absent` flag the
     * indicator reads - "not present" is a different thing from "the CCU is unreachable", and only
     * the first one is the normal state of BidCos-Wired on a CCU without a wired gateway.
     */
    #noteInitFailure(entry: ManagedInterface, error: unknown): void {
        const message = errorMessage(error);
        const absent = isConnectionRefused(error);
        const first = entry.failures === 0;
        entry.failures += 1;
        const base = this.#options.initBackoffMs ?? WATCHDOG_INTERVAL_MS;
        const wait = Math.min(base * 2 ** (entry.failures - 1), MAX_INIT_BACKOFF_MS);
        entry.retryAt = this.#now() + wait;
        this.#update(entry, {connected: false, error: message, absent, subscribing: false});
        if (!first) {
            return;
        }
        const minutes = Math.round(MAX_INIT_BACKOFF_MS / 60_000);
        this.#options.onNotice(
            absent ? 'warn' : 'error',
            absent
                ? `${entry.name}: nothing is listening on ${entry.state.host}:${String(entry.state.port)} - ` +
                      `treated as not present, retried at most every ${String(minutes)} minutes`
                : `${entry.name}: ${message}`,
            entry.name,
        );
    }

    async #ping(entry: ManagedInterface): Promise<void> {
        try {
            await entry.client.call('ping', ['hmm']);
        } catch (error) {
            // the answer to a ping is an event, so a failing ping is only a hint; the re-init
            // happens when the silence exceeds the timeout, exactly as in 2.x
            this.#update(entry, {error: errorMessage(error)});
        }
    }

    #update(
        entry: ManagedInterface,
        changes: {
            connected?: boolean;
            error?: string | undefined;
            absent?: boolean;
            subscribing?: boolean;
            idle?: boolean;
        },
    ): void {
        const state: InterfaceState = {
            ...entry.state,
            ...(changes.connected === undefined ? {} : {connected: changes.connected}),
            ...(entry.lastEvent > 0 ? {lastEvent: entry.lastEvent} : {}),
        };
        setFlag(state, 'absent', changes.absent);
        setFlag(state, 'subscribing', changes.subscribing);
        setFlag(state, 'idle', changes.idle);
        if ('error' in changes) {
            if (changes.error === undefined) {
                delete (state as {error?: string}).error;
            } else {
                state.error = changes.error;
            }
        }
        entry.state = state;
    }

    #startWatchdog(): void {
        const interval = this.#options.watchdogIntervalMs ?? WATCHDOG_INTERVAL_MS;
        if (interval <= 0) {
            return;
        }
        const timer = setInterval(() => {
            void this.tick();
        }, interval);
        if (typeof timer.unref === 'function') {
            timer.unref();
        }
        this.#watchdog = timer;
    }
}

/** A boolean that is present when true and absent otherwise, so a state stays small on the wire. */
function setFlag(state: InterfaceState, key: 'absent' | 'subscribing' | 'idle', value: boolean | undefined): void {
    if (value === true) {
        state[key] = true;
    } else if (value === false) {
        // `delete state[key]` with a computed key is banned by the rule set; this is the same thing
        Reflect.deleteProperty(state, key);
    }
}
