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
 *    At the start (task 56, D-52) an `init` that is refused or times out is not left to the watchdog:
 *    it is tried again after 1, 2, 4 and 8 s and then every 2 s, and the interface shows *waiting*.
 *    HmIP-RF has a liveness ping of its own besides (B-56, D-53): after 30 s of silence it is
 *    pinged, and a missing PONG 10 s later means hmipserver has restarted - it reads its handler
 *    list back but sends nothing until the client calls `init` again - so the interface shows
 *    *reconnecting* and is subscribed again on the quick schedule of the start.
 * 3. `init(url, '')` on shutdown, so the CCU stops calling a process that is gone - with a hard
 *    timeout, because 2.x's `stop()` waited for an unreachable CCU and only a second `stop()` (or
 *    the 15 s fallback timer) got the app closed.
 *
 * What is different from 2.x: the interface list is **explicit** (D-13, plus user-defined
 * interfaces), and the port probe is a background job whose result is a hint for the configuration
 * dialog. 2.x probed six ports with a 5 s timeout each before the window became usable, which is
 * the root of the "endless loading" issues #121, #126, #128 and #134.
 */

import type {
    CallbackPins,
    CallbackWarning,
    ConnectionConfig,
    InterfaceState,
    ResolvedInterface,
    RpcProtocol,
} from '@homematic-manager/core';
import {
    INTERFACE_NAMES,
    PONG_TIMEOUT_SECONDS,
    callbackPinOption,
    interfaceDefinition,
    interfacePort,
    isKnownInterface,
} from '@homematic-manager/core';

import {
    configError,
    connectionError,
    errorMessage,
    isAddressInUse,
    isConnectionRefused,
    isNotAnswering,
} from '../errors.js';
import {interfaceTargets, type InterfaceTarget} from '../config/defaults.js';
import {RpcClient, type RpcCallRecord, type RpcClientOptions} from '../rpc/client.js';
import {CallbackServers, type CallbackHandler, type CallbackServerSet} from '../rpc/server.js';
import {
    describeCallbackAddresses,
    ipv4ToNumber,
    localIPv4Addresses,
    pickCallbackAddress,
    probePortState,
    staticNetwork,
    systemNetwork,
    withTimeout,
    type CallbackNetwork,
    type PortProbe,
} from '../util/net.js';

/** How often the watchdog looks at every interface. 2.x used the same 15 s. */
export const WATCHDOG_INTERVAL_MS = 15_000;

/**
 * Task 48: the manager's own calls - `init`, de-init, `ping` - are the backend's business whatever
 * asked for the connection, so they name their origin instead of inheriting a request's context
 * (a `config.set` from the settings dialog is a UI action; the watchdog it starts is not).
 */
const BACKGROUND = {origin: 'background'} as const;

/** Where an interface process on this very box calls back (#144). */
export const LOOPBACK_IP = '127.0.0.1';

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
 * Task 56 (D-52): the waits between the `init` attempts of an interface that refuses or does not
 * answer at the start, before {@link START_RETRY_INTERVAL_MS} takes over.
 *
 * On openccu-lite the addon may start before the interface processes (`runtime.start: "early"`):
 * a Raspberry Pi 3 measured the first `init` 45 s before hmipserver answered, and on the 15 s watchdog
 * ticks with the doubling back-off below HmIP-RF was asked again only 17 s after it was there.
 */
export const START_RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000];

/**
 * Task 56 (D-57): the wait between two start attempts after {@link START_RETRY_DELAYS_MS}.
 *
 * D-52 had 15 s here. Measured on openccu-lite with the addon started early, that made HmIP-RF on a
 * Raspberry Pi 4 connect 2-3 s *later* than when the addon waits for hmipserver, because hmipserver
 * came up between two attempts 15 s apart; with 2 s it connected 9.6 s earlier. A refused
 * connection on the loopback every 2 s for at most the start window costs nothing.
 */
export const START_RETRY_INTERVAL_MS = 2000;

/**
 * Task 56: how long after `start()` (or a D-31 resubscribe) an interface that has not answered yet
 * is *waiting* rather than missing. Two minutes cover a Raspberry Pi 3 booting with the addon
 * started early, where the interface processes come up about 50 s after it. After the window the
 * interface is treated as before: "not present" or "not answering", said once, and tried with the
 * back-off up to {@link MAX_INIT_BACKOFF_MS} - a CCU without a wired gateway never runs `hs485d`.
 */
export const START_WINDOW_MS = 120_000;

/** Task 56: the wait before start attempt number `attempt` (1 for the first retry). */
export function startRetryDelay(attempt: number): number {
    return START_RETRY_DELAYS_MS[attempt - 1] ?? START_RETRY_INTERVAL_MS;
}

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
    /**
     * Milliseconds since epoch of the last event, ping answer or successful `init` - for the state
     * the UI shows, never for a timeout (B-65: see {@link lastSeenMono}).
     */
    lastEvent: number;
    /**
     * B-65: the same moment on the monotonic clock, which the watchdog measures the silence
     * against. On the wall clock a box without a real-time clock, whose date NTP moves months
     * forward a few seconds after the start, made every interface look silent once and re-`init`ed
     * it. `-Infinity` until the first one, so an interface never heard of is due at once.
     */
    lastSeenMono: number;
    /** Consecutive failed `init` calls; 0 as soon as one succeeds. */
    failures: number;
    /** On the monotonic clock (B-65): the moment before which the watchdog does not try `init` again. */
    retryAt: number;
    /** Task 56: failed `init` attempts while waiting at the start; 0 once it answered. */
    waitingAttempts: number;
    /** Task 56: the timer of the next start attempt, which the watchdog then leaves alone. */
    retryTimer: ReturnType<typeof setTimeout> | undefined;
    /** Task 56: `init` succeeded since the last start - its failures are an outage, not a start. */
    answered: boolean;
    /**
     * Task 56, B-56: when the current window of quick retries began, on the monotonic clock - the
     * start (or a D-31 resubscribe) for every interface, or the moment a liveness ping went
     * unanswered for this one.
     */
    windowStart: number;
    /** B-56: the last event on the monotonic clock, for the liveness ping. */
    lastEventMono: number;
    /**
     * B-56: an event arrived since the last successful `init`. Only then does a missing PONG mean
     * that the subscription was lost: an interface that never reached us - a callback address the
     * CCU cannot reach - would otherwise be re-`init`ed every 40 s, and hmipserver re-sends every
     * device at each `init` (occu#45).
     */
    heardSinceInit: boolean;
    /** B-56: the timer of the next liveness check, and the one waiting for its PONG. */
    livenessTimer: ReturnType<typeof setTimeout> | undefined;
    /** B-56: lost its subscription (no PONG) and is being subscribed again. */
    reconnecting: boolean;
    /** B-56: a liveness ping is out and its PONG is being waited for. */
    awaitingPong: boolean;
}

export interface InterfaceManagerOptions {
    readonly connection: ConnectionConfig;
    /** What the callback servers do with an incoming call. */
    readonly handler: CallbackHandler;
    readonly onStateChanged: (states: InterfaceState[]) => void;
    readonly onNotice: (level: 'debug' | 'info' | 'warn' | 'error', message: string, interfaceName?: string) => void;
    /** Called after a successful `init`; the backend fills its caches there. */
    readonly onConnected?: (interfaceName: string) => void | Promise<void>;
    readonly onCall?: (record: RpcCallRecord) => void;
    /** Task 48: the origin of a call that names none, handed to every client (the backend's request context). */
    readonly originOf?: RpcClientOptions['originOf'];
    readonly now?: () => number;
    /**
     * Task 56: a clock that only moves forward, for the start window. The wall clock is no use
     * there: a box without a real-time clock boots with a date months old and NTP moves it forward
     * a few seconds after the start (seen on a Raspberry Pi 4, where the jump ended the window at
     * once). Defaults to `performance.now()`.
     */
    readonly monotonicNow?: () => number;
    readonly rpcTimeoutMs?: number;
    readonly watchdogIntervalMs?: number;
    /**
     * First wait after a failed `init`; it doubles per further failure up to
     * {@link MAX_INIT_BACKOFF_MS}. Defaults to the watchdog interval, so nothing changes for an
     * interface that fails once and then works.
     */
    readonly initBackoffMs?: number;
    /**
     * Task 56: how long after the start a refused or unanswered `init` means *waiting*; defaults to
     * {@link START_WINDOW_MS}. `0` turns the quick start retries off.
     */
    readonly startWindowMs?: number;
    /**
     * B-56: overrides the liveness ping interval of every interface that has one (HmIP-RF, 30 s in
     * the table); `0` turns the liveness ping off. The PONG timeout is {@link pongTimeoutMs}.
     */
    readonly pingIntervalMs?: number;
    /** B-56: how long the PONG may take; defaults to {@link PONG_TIMEOUT_SECONDS}. */
    readonly pongTimeoutMs?: number;
    /** Address to bind the callback servers to; left out, {@link callbackBindHost} decides. */
    readonly callbackHost?: string;
    /**
     * Task 35 (D-43): the callback ports taken while the connection's are `0`. The CCU addon sets a
     * fixed pair; the desktop app, npm and Docker leave this out and keep the kernel's free port.
     */
    readonly defaultCallbackPorts?: {readonly xmlrpc: number; readonly binrpc: number};
    /**
     * Task 38: the callback fields the host set at start. Only used to name the option in the log
     * line of a fixed port that cannot be opened.
     */
    readonly callbackPins?: CallbackPins;
    /** Injected by the tests. */
    readonly createClient?: (options: RpcClientOptions) => RpcClient;
    readonly createCallbackServers?: (handler: CallbackHandler) => CallbackServerSet;
    readonly probe?: (host: string, port: number) => Promise<PortProbe>;
    /**
     * Injected for the callback address; defaults to this machine's IPv4 addresses. A list given
     * here has no netmasks, so the automatic choice is its first entry (or the loopback for a CCU
     * on the loopback) unless {@link network} is given as well.
     */
    readonly localAddresses?: () => string[];
    /** B-53: the interfaces, name lookup and route probe the automatic callback address is worked out from. */
    readonly network?: CallbackNetwork;
    /**
     * B-53: take a set callback address as it is, even when it is no address of this machine - the
     * host set it at start (task 38) or runs in a container, where the Docker host's address is the
     * one that works. No fallback and no warning then.
     */
    readonly keepConfiguredCallbackIp?: boolean;
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

/**
 * Where the callback servers listen when the host names no address of its own (task 35).
 *
 * Where the interface processes are told to call back on the loopback - the CCU itself (`local`)
 * with no address configured (#144), or the loopback configured by hand - nothing has to reach the
 * servers from anywhere else, and they listen on `127.0.0.1` only. It matters more with the addon's
 * fixed ports: a listener on every interface would be a known port on the LAN of every CCU whose
 * firewall is open, and anything on that LAN could send it events. Everywhere else the CCU is
 * across a network and `undefined` keeps `0.0.0.0`.
 */
export function callbackBindHost(connection: ConnectionConfig): string | undefined {
    const {ip} = connection.callback;
    return ip === LOOPBACK_IP || (ip === '' && connection.local === true) ? LOOPBACK_IP : undefined;
}

/** Connects, watches and disconnects every configured interface. */
export class InterfaceManager {
    readonly #options: InterfaceManagerOptions;
    readonly #now: () => number;
    readonly #monotonicNow: () => number;
    readonly #interfaces = new Map<string, ManagedInterface>();
    readonly #servers: CallbackServerSet;
    /**
     * Task 38: protocols whose fixed callback port could not be opened. Their interfaces are not
     * subscribed - an `init` with a URL nobody listens on would only look like a working one - and
     * a later `init` attempt tries the port again.
     */
    readonly #callbackFailures = new Map<RpcProtocol, {port: number; inUse: boolean; message: string}>();
    readonly #reopening = new Map<RpcProtocol, Promise<boolean>>();

    #watchdog: ReturnType<typeof setInterval> | undefined;
    /** B-53: the callback address of the last connect, and what did not fit about the configured one. */
    #callback: {ip: string; warning?: CallbackWarning} | undefined;
    #callbackRefresh: Promise<{ip: string; warning?: CallbackWarning}> | undefined;
    /** B-53: the warning last logged, so a watchdog round does not log it again. */
    #callbackNoted = '';
    #detected: string[] = [];
    #stopping = false;
    #idle = false;

    constructor(options: InterfaceManagerOptions) {
        this.#options = options;
        this.#now = options.now ?? (() => Date.now());
        this.#monotonicNow = options.monotonicNow ?? (() => performance.now());
        this.#servers = (options.createCallbackServers ?? ((handler) => this.#defaultServers(handler)))(
            options.handler,
        );
    }

    #defaultServers(handler: CallbackHandler): CallbackServerSet {
        const callback = this.#options.connection.callback;
        const host = this.#options.callbackHost ?? callbackBindHost(this.#options.connection);
        return new CallbackServers({
            handler,
            ...(host === undefined ? {} : {host}),
            ports: {xmlrpc: callback.xmlrpcPort, binrpc: callback.binrpcPort},
            ...(this.#options.defaultCallbackPorts === undefined
                ? {}
                : {defaultPorts: this.#options.defaultCallbackPorts}),
            onError: (error) => {
                this.#options.onNotice('error', `callback server: ${errorMessage(error)}`);
            },
            // a warning, not an error: the subscription works on the free port, only the fixed URL
            // that keeps the handler lists short is gone until the next start
            onFallback: (protocol, port, error) => {
                this.#options.onNotice(
                    'warn',
                    `callback server: the default ${protocol} port ${String(port)} is taken, a free port is used until the next start (${errorMessage(error)})`,
                );
            },
        });
    }

    /**
     * The address the interface processes are told to call back on.
     *
     * Issue #144: on the CCU itself (`local`, which is what the addon sets) that is `127.0.0.1`.
     * The first LAN address of the box worked, but it is the wrong answer twice over: it is the
     * one address that changes - a new lease, another network - while `init` registrations survive
     * such a change in the interface process's handler list, and every other local subscriber on a
     * CCU registers on the loopback, which is what a look at that list expects to see.
     *
     * B-53 (#162, #165): with no address set, the one in the CCU's network, else the one the route
     * to the CCU leaves from, else the first one that is not link-local - worked out again at every
     * `init`. Until the first `init` this is the same choice without the name lookup and the route.
     */
    get callbackIp(): string {
        return this.#callback?.ip ?? this.#immediateCallbackIp();
    }

    /** B-53: the callback address set in the settings that does not fit, as of the last connect. */
    get callbackWarning(): CallbackWarning | undefined {
        return this.#callback?.warning;
    }

    /** Read through a method, so that the check after an `await` is not narrowed away. */
    #hasStopped(): boolean {
        return this.#stopping;
    }

    #network(): CallbackNetwork {
        if (this.#options.network !== undefined) {
            return this.#options.network;
        }
        const injected = this.#options.localAddresses;
        return injected === undefined ? systemNetwork() : staticNetwork(injected);
    }

    #immediateCallbackIp(): string {
        const {host, local, callback} = this.#options.connection;
        if (callback.ip !== '') {
            return callback.ip;
        }
        if (local === true) {
            return LOOPBACK_IP;
        }
        const literal = ipv4ToNumber(host) === undefined ? undefined : host;
        return pickCallbackAddress(host, literal, this.#network().interfaces(), undefined).auto.address;
    }

    /** B-53: works the callback address out once for every `init` that runs at the same time. */
    #refreshCallback(): Promise<{ip: string; warning?: CallbackWarning}> {
        this.#callbackRefresh ??= this.#resolveCallback().finally(() => {
            this.#callbackRefresh = undefined;
        });
        return this.#callbackRefresh;
    }

    async #resolveCallback(): Promise<{ip: string; warning?: CallbackWarning}> {
        const {host, local, callback} = this.#options.connection;
        const configured = callback.ip;
        let result: {ip: string; warning?: CallbackWarning};
        if (local === true) {
            // the addon: the loopback, or what was set - nothing on the CCU itself is second-guessed
            result = {ip: configured === '' ? LOOPBACK_IP : configured};
        } else if (
            configured !== '' &&
            (this.#options.keepConfiguredCallbackIp === true || configured === LOOPBACK_IP)
        ) {
            result = {ip: configured};
        } else {
            let info;
            try {
                info = await describeCallbackAddresses(host, this.#network());
            } catch {
                // the lookups never reject; an interface list that throws leaves the old rule
                info = undefined;
            }
            if (info === undefined) {
                result = {ip: configured === '' ? (localIPv4Addresses()[0] ?? LOOPBACK_IP) : configured};
            } else if (configured === '') {
                result = {ip: info.auto.address};
            } else {
                const candidate = info.addresses.find((entry) => entry.address === configured);
                const auto = info.auto.address;
                if (candidate === undefined) {
                    result = {ip: auto, warning: {address: configured, reason: 'notLocal', auto}};
                } else if (info.hostAddress !== undefined && !candidate.inSubnet && configured !== auto) {
                    result = {ip: configured, warning: {address: configured, reason: 'otherNetwork', auto}};
                } else {
                    result = {ip: configured};
                }
            }
        }
        this.#callback = result;
        this.#noteCallbackWarning(result.warning);
        return result;
    }

    /** B-53: a warning is logged when it appears or changes, not at every watchdog `init`. */
    #noteCallbackWarning(warning: CallbackWarning | undefined): void {
        const key = warning === undefined ? '' : `${warning.reason} ${warning.address} ${warning.auto}`;
        if (key === this.#callbackNoted) {
            return;
        }
        this.#callbackNoted = key;
        if (warning === undefined) {
            return;
        }
        this.#options.onNotice(
            'warn',
            warning.reason === 'notLocal'
                ? `callback address ${warning.address} from the settings is no address of this machine any more - ` +
                      `the automatic address ${warning.auto} is used instead; choose "Automatic" in the settings to keep it that way`
                : `callback address ${warning.address} from the settings is not in the CCU's network - ` +
                      `the CCU may not reach it and send no events; the automatic address would be ${warning.auto}`,
        );
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
            try {
                await this.#servers.ensure(protocol);
            } catch (error) {
                // a free port (0, or task 35's fallback failing too) that cannot be had is what it was
                const port = this.#fixedCallbackPort(protocol);
                if (port === 0) {
                    throw error;
                }
                this.#noteCallbackFailure(protocol, port, error);
            }
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
            this.#clearRetryTimer(entry);
            this.#clearLivenessTimer(entry);
            entry.reconnecting = false;
            entry.lastEvent = 0;
            entry.lastSeenMono = Number.NEGATIVE_INFINITY;
            entry.failures = 0;
            entry.retryAt = 0;
            entry.waitingAttempts = 0;
            entry.answered = false;
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
        this.#options.onStateChanged(this.states());
    }

    /** D-31: subscribe again after {@link unsubscribe}. Idempotent. */
    async subscribe(): Promise<void> {
        if (!this.#idle) {
            return;
        }
        this.#idle = false;
        // task 56: a resubscribe is a start too - the interface processes may have gone meanwhile
        const now = this.#monotonicNow();
        for (const entry of this.#interfaces.values()) {
            entry.windowStart = now;
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
        // B-65: silence and back-off are measured on the monotonic clock, never on the date
        const now = this.#monotonicNow();
        const work: Promise<void>[] = [];
        for (const entry of this.#interfaces.values()) {
            const timeout = entry.target.resolved.pingTimeoutSeconds * 1000;
            const elapsed = now - entry.lastSeenMono;
            if (elapsed > timeout) {
                this.#update(entry, {connected: false});
                // an interface that is not there at all is not asked again on every round, and one
                // waiting at the start has a timer of its own (task 56)
                if (entry.retryAt <= now && entry.retryTimer === undefined) {
                    work.push(this.#init(entry.name));
                }
            } else if (entry.target.resolved.ping && elapsed > timeout / 1.5 - 1000) {
                work.push(this.#ping(entry));
            }
        }
        await Promise.all(work);
        this.#options.onStateChanged(this.states());
    }

    /**
     * A callback arrived; the interface is alive.
     *
     * B-56: only an `event` proves that the subscription delivers. A device callback (`newDevices`,
     * `deleteDevices`, …) does not: a restarted hmipserver announces its devices to the handler it
     * read back, and then sends it no event at all (measured on a Raspberry Pi 4, 16 s after the
     * restart). Such a callback that nobody asked for is the moment to check, so the liveness ping
     * goes out at once.
     */
    noteEvent(interfaceName: string, kind: 'event' | 'device' = 'event'): void {
        const entry = this.#interfaces.get(interfaceName);
        if (!entry) {
            return;
        }
        entry.lastEvent = this.#now();
        entry.lastSeenMono = this.#monotonicNow();
        if (kind === 'event') {
            entry.lastEventMono = this.#monotonicNow();
            entry.heardSinceInit = true;
        } else if (!entry.awaitingPong && entry.livenessTimer !== undefined && entry.state.subscribing !== true) {
            this.#armLiveness(entry, 0, true);
        }
        if (!entry.state.connected) {
            this.#update(entry, {connected: true, error: undefined, unreachable: false});
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
                this.#clearRetryTimer(entry);
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
        for (const entry of this.#interfaces.values()) {
            this.#clearRetryTimer(entry);
            this.#clearLivenessTimer(entry);
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
     * Probes the well-known ports of every built-in interface on the configured host, and the port
     * of every configured user-defined interface where it is configured, in the background. Nothing
     * waits for this; the result is a hint for the configuration dialog and a mark for an interface
     * that is configured and not connected.
     *
     * B-28: only a *refused* port makes an interface "not present". Until beta.15 a probe that timed
     * out counted the same, and a user-defined interface - which the built-in probe never looks at -
     * was marked absent whenever it was not connected at that moment: a slow CCU-Jack or a remote
     * CUxD on a box that was still booting disappeared from the popup's healthy states until the next
     * start. A port that does not answer marks the interface as not answering, and it stays what it is.
     */
    async probeInterfaces(): Promise<string[]> {
        const connection = this.#options.connection;
        const probe = this.#options.probe ?? ((host, port) => probePortState(host, port, {timeoutMs: 2000}));
        const results = new Map<string, PortProbe>();
        const extraProbes = connection.interfaces
            .filter((name) => !isKnownInterface(name))
            .map(async (name) => {
                const entry = this.#interfaces.get(name);
                if (entry) {
                    results.set(name, await probe(entry.state.host, entry.state.port));
                }
            });
        const builtInProbes = INTERFACE_NAMES.map(async (name) => {
            const definition = interfaceDefinition(name);
            if (definition) {
                results.set(name, await probe(connection.host, interfacePort(definition, {tls: connection.tls})));
            }
        });
        await Promise.all([...builtInProbes, ...extraProbes]);
        this.#detected = INTERFACE_NAMES.filter((name) => results.get(name) === 'open');

        for (const name of connection.interfaces) {
            const result = results.get(name);
            const known = this.#interfaces.get(name);
            // task 56: an interface waiting at the start is expected not to answer yet
            if (this.isConnected(name) || result === undefined || result === 'open' || known?.state.waiting === true) {
                continue;
            }
            const where = known === undefined ? connection.host : `${known.state.host}:${String(known.state.port)}`;
            if (result === 'refused') {
                // an interface whose `init` already refused says the same thing; one notice is enough
                if (known?.state.absent !== true) {
                    this.#options.onNotice('warn', `${name}: the port is closed on ${where}`, name);
                }
                if (known) {
                    this.#update(known, {absent: true, unreachable: false});
                }
            } else {
                // and one whose `init` timed out has said this already
                if (known?.state.unreachable !== true) {
                    this.#options.onNotice(
                        'warn',
                        `${name}: ${where} does not answer - kept as configured and tried again`,
                        name,
                    );
                }
                if (known) {
                    this.#update(known, {absent: false, unreachable: true});
                }
            }
        }
        this.#options.onStateChanged(this.states());
        return this.detected;
    }

    /** `init(url, '')` with a hard timeout; a CCU that is gone must not hold anything up. */
    async #deregister(entry: ManagedInterface): Promise<void> {
        if (!entry.target.resolved.init || this.#callbackFailures.has(entry.target.resolved.protocol)) {
            return;
        }
        // the URL it was registered with: the automatic address may have moved since (B-53)
        const url = entry.state.callbackUrl ?? this.#callbackUrl(entry.target.resolved.protocol);
        try {
            await withTimeout(entry.client.call('init', [url, ''], BACKGROUND), SHUTDOWN_TIMEOUT_MS, () =>
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
            ...(this.#options.originOf === undefined ? {} : {originOf: this.#options.originOf}),
        };
        const client = (this.#options.createClient ?? ((clientOptions) => new RpcClient(clientOptions)))(options);
        return {
            name: resolved.name,
            target,
            client,
            lastEvent: 0,
            lastSeenMono: Number.NEGATIVE_INFINITY,
            failures: 0,
            retryAt: 0,
            waitingAttempts: 0,
            retryTimer: undefined,
            answered: false,
            windowStart: this.#monotonicNow(),
            lastEventMono: 0,
            heardSinceInit: false,
            livenessTimer: undefined,
            reconnecting: false,
            awaitingPong: false,
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

    /** The port the connection fixes for a protocol; `0` when it leaves the choice to the host. */
    #fixedCallbackPort(protocol: RpcProtocol): number {
        const {callback} = this.#options.connection;
        return protocol === 'binrpc' ? callback.binrpcPort : callback.xmlrpcPort;
    }

    /**
     * Task 38: a fixed callback port that cannot be opened is loud, once, and never replaced by a
     * free port. In a container a free port is exactly the one nobody published, and behind a
     * firewall the one nobody opened: the interfaces would be subscribed and silent.
     */
    #noteCallbackFailure(protocol: RpcProtocol, port: number, error: unknown): void {
        const inUse = isAddressInUse(error);
        const field = protocol === 'binrpc' ? 'binrpcPort' : 'xmlrpcPort';
        const source =
            this.#options.callbackPins?.[field] === true
                ? callbackPinOption(field)
                : `connection.callback.${field} in the settings`;
        const what = inUse ? 'is in use' : 'cannot be opened';
        this.#callbackFailures.set(protocol, {port, inUse, message: `callback port ${String(port)} ${what}`});
        this.#options.onNotice(
            'error',
            `callback server: the ${protocol} port ${String(port)} set by ${source} ${what} - the ${protocol} ` +
                `interfaces are not subscribed and get no events, and no free port is taken instead ` +
                `(${errorMessage(error)})`,
        );
    }

    /** Task 38: one more try at a failed fixed port, shared by every interface of the protocol. */
    #reopenCallbackServer(protocol: RpcProtocol): Promise<boolean> {
        const pending = this.#reopening.get(protocol);
        if (pending) {
            return pending;
        }
        const attempt = this.#servers
            .ensure(protocol)
            .then(
                (port) => {
                    this.#callbackFailures.delete(protocol);
                    this.#options.onNotice('info', `callback server: the ${protocol} port ${String(port)} is open now`);
                    return true;
                },
                () => false,
            )
            .finally(() => {
                this.#reopening.delete(protocol);
            });
        this.#reopening.set(protocol, attempt);
        return attempt;
    }

    /** Task 38: an interface whose callback server is not there; backs off like a failed `init`, silently. */
    #noteNoCallbackServer(entry: ManagedInterface, failure: {port: number; inUse: boolean; message: string}): void {
        entry.failures += 1;
        const base = this.#options.initBackoffMs ?? WATCHDOG_INTERVAL_MS;
        entry.retryAt = this.#monotonicNow() + Math.min(base * 2 ** (entry.failures - 1), MAX_INIT_BACKOFF_MS);
        this.#update(entry, {
            connected: false,
            error: failure.message,
            absent: false,
            unreachable: false,
            subscribing: false,
            callbackUrl: undefined,
            callbackFailure: {port: failure.port, inUse: failure.inUse},
        });
        this.#options.onStateChanged(this.states());
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
            entry.lastSeenMono = this.#monotonicNow();
            return;
        }
        const failure = this.#callbackFailures.get(resolved.protocol);
        // the first attempt comes straight after the failed bind in `start()`; only a retry binds again
        if (failure !== undefined && (entry.failures === 0 || !(await this.#reopenCallbackServer(resolved.protocol)))) {
            this.#noteNoCallbackServer(entry, this.#callbackFailures.get(resolved.protocol) ?? failure);
            return;
        }
        const callback = await this.#refreshCallback();
        // a name lookup may take seconds; a manager stopped meanwhile subscribes nothing any more
        if (this.#hasStopped()) {
            return;
        }
        const url = this.#servers.callbackUrl(resolved.protocol, callback.ip);
        this.#update(entry, {callbackUrl: url, callbackFailure: undefined, callbackWarning: callback.warning});
        try {
            await entry.client.call('init', [url, resolved.ident], BACKGROUND);
            entry.lastEvent = this.#now();
            entry.lastSeenMono = this.#monotonicNow();
            entry.lastEventMono = entry.lastSeenMono;
            entry.heardSinceInit = false;
            const wasFailing = entry.failures > 0;
            const waited = entry.waitingAttempts;
            const wasReconnecting = entry.reconnecting;
            entry.failures = 0;
            entry.retryAt = 0;
            entry.waitingAttempts = 0;
            entry.answered = true;
            entry.reconnecting = false;
            // hmipserver re-sends every device on `init` (occu#45), so the grids are not complete
            // until the sweep below is through; the UI shows "subscribing" until then
            this.#update(entry, {
                connected: true,
                error: undefined,
                absent: false,
                unreachable: false,
                subscribing: true,
                waiting: false,
                reconnecting: false,
            });
            this.#armLiveness(entry);
            if (wasFailing) {
                this.#options.onNotice('info', `${interfaceName}: answering again`, interfaceName);
            } else if (wasReconnecting) {
                this.#options.onNotice(
                    'info',
                    waited > 0
                        ? `${interfaceName}: subscribed again, attempt ${String(waited + 1)}`
                        : `${interfaceName}: subscribed again`,
                    interfaceName,
                );
            } else if (waited > 0) {
                this.#options.onNotice(
                    'info',
                    `${interfaceName}: answering, attempt ${String(waited + 1)} at the start`,
                    interfaceName,
                );
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
     * the first one is the normal state of BidCos-Wired on a CCU without a wired gateway. A timeout
     * or a host without a route is the second one, `unreachable` (B-28).
     */
    #noteInitFailure(entry: ManagedInterface, error: unknown): void {
        const message = errorMessage(error);
        const absent = isConnectionRefused(error);
        const unreachable = !absent && isNotAnswering(error);
        if ((absent || unreachable) && this.#inStartWindow(entry)) {
            this.#noteWaiting(entry, message, absent);
            return;
        }
        const first = entry.failures === 0;
        entry.failures += 1;
        entry.reconnecting = false;
        const base = this.#options.initBackoffMs ?? WATCHDOG_INTERVAL_MS;
        const wait = Math.min(base * 2 ** (entry.failures - 1), MAX_INIT_BACKOFF_MS);
        entry.retryAt = this.#monotonicNow() + wait;
        this.#update(entry, {
            connected: false,
            error: message,
            absent,
            unreachable,
            subscribing: false,
            waiting: false,
            reconnecting: false,
        });
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

    /**
     * Task 56: is a failure of this interface part of the start? Only until it answered once, and
     * only within the window: a process that goes away later is an outage, not a slow boot.
     */
    #inStartWindow(entry: ManagedInterface): boolean {
        const window = this.#options.startWindowMs ?? START_WINDOW_MS;
        return !entry.answered && window > 0 && this.#monotonicNow() - entry.windowStart < window;
    }

    /**
     * Task 56 (D-52): the interface refused or did not answer at the start. On openccu-lite that
     * only means its process has not started yet, so it is *waiting*, not missing: one info line,
     * the retries at debug level, and the next attempt on a timer of its own after
     * {@link startRetryDelay} rather than at a watchdog tick after the back-off.
     */
    #noteWaiting(entry: ManagedInterface, message: string, refused: boolean): void {
        entry.waitingAttempts += 1;
        const delay = startRetryDelay(entry.waitingAttempts);
        entry.retryAt = this.#monotonicNow() + delay;
        this.#update(entry, {
            connected: false,
            error: message,
            absent: false,
            unreachable: false,
            subscribing: false,
            // B-56: an interface that lost its subscription keeps saying so while it waits
            waiting: !entry.reconnecting,
            reconnecting: entry.reconnecting,
        });
        const where = `${entry.state.host}:${String(entry.state.port)}`;
        if (entry.waitingAttempts === 1) {
            this.#options.onNotice(
                'info',
                refused
                    ? `${entry.name}: nothing is listening on ${where} yet - waiting for it`
                    : `${entry.name}: ${where} does not answer yet - waiting for it`,
                entry.name,
            );
        } else {
            this.#options.onNotice(
                'debug',
                `${entry.name}: still waiting (attempt ${String(entry.waitingAttempts)}: ${message})`,
                entry.name,
            );
        }
        this.#clearRetryTimer(entry);
        if (this.#stopping || this.#idle) {
            return;
        }
        const timer = setTimeout(() => {
            entry.retryTimer = undefined;
            void this.#init(entry.name);
        }, delay);
        if (typeof timer.unref === 'function') {
            timer.unref();
        }
        entry.retryTimer = timer;
    }

    /**
     * B-56 (D-53): the liveness ping of an interface that has one (HmIP-RF). After
     * `pingIntervalSeconds` without an event it is pinged; the PONG is an event, and when none has
     * arrived {@link PONG_TIMEOUT_SECONDS} later although the interface did reach us since its
     * last `init`, the subscription is lost. A ping that fails outright (the process is gone) is
     * the same thing - the timer decides, not the call.
     */
    #armLiveness(entry: ManagedInterface, delay?: number, now = false): void {
        this.#clearLivenessTimer(entry);
        const interval = this.#options.pingIntervalMs ?? entry.target.resolved.pingIntervalSeconds * 1000;
        if (interval <= 0 || this.#stopping || this.#idle) {
            return;
        }
        this.#setLivenessTimer(entry, delay ?? interval, () => {
            const silent = this.#monotonicNow() - entry.lastEventMono;
            if (!now && silent < interval) {
                this.#armLiveness(entry, interval - silent);
                return;
            }
            const sentAt = this.#monotonicNow();
            entry.awaitingPong = true;
            entry.client.call('ping', ['hmm'], BACKGROUND).catch(() => {
                // no PONG will come either; the timer below says what that means
            });
            this.#setLivenessTimer(entry, this.#options.pongTimeoutMs ?? PONG_TIMEOUT_SECONDS * 1000, () => {
                entry.awaitingPong = false;
                if (entry.lastEventMono >= sentAt) {
                    // the next ping is due 30 s after the PONG, not after this check
                    this.#armLiveness(entry, Math.max(0, interval - (this.#monotonicNow() - entry.lastEventMono)));
                    return;
                }
                if (!entry.heardSinceInit) {
                    // it never reached us since the `init`, which a new one would not change
                    this.#armLiveness(entry);
                    return;
                }
                this.#noteLost(entry);
            });
        });
    }

    #setLivenessTimer(entry: ManagedInterface, delay: number, action: () => void): void {
        const timer = setTimeout(() => {
            entry.livenessTimer = undefined;
            if (!this.#stopping && !this.#idle && this.#interfaces.get(entry.name) === entry) {
                action();
            }
        }, delay);
        if (typeof timer.unref === 'function') {
            timer.unref();
        }
        entry.livenessTimer = timer;
    }

    #clearLivenessTimer(entry: ManagedInterface): void {
        entry.awaitingPong = false;
        if (entry.livenessTimer !== undefined) {
            clearTimeout(entry.livenessTimer);
            entry.livenessTimer = undefined;
        }
    }

    /**
     * B-56: the liveness ping went unanswered. The subscription is gone - after an hmipserver
     * restart the process is back (or on its way) but sends nothing to us - so the interface is
     * *reconnecting* and subscribed again at once, and while `init` is refused or does not answer
     * it is tried on the quick schedule of the start, for as long as the start window.
     */
    #noteLost(entry: ManagedInterface): void {
        const seconds = Math.round((this.#options.pongTimeoutMs ?? PONG_TIMEOUT_SECONDS * 1000) / 1000);
        entry.reconnecting = true;
        entry.answered = false;
        entry.waitingAttempts = 0;
        entry.windowStart = this.#monotonicNow();
        this.#clearRetryTimer(entry);
        this.#update(entry, {connected: false, reconnecting: true, waiting: false, subscribing: false});
        this.#options.onNotice(
            'info',
            `${entry.name}: no answer to a ping within ${String(seconds)} s - subscribing again`,
            entry.name,
        );
        this.#options.onStateChanged(this.states());
        void this.#init(entry.name);
    }

    #clearRetryTimer(entry: ManagedInterface): void {
        if (entry.retryTimer !== undefined) {
            clearTimeout(entry.retryTimer);
            entry.retryTimer = undefined;
        }
    }

    async #ping(entry: ManagedInterface): Promise<void> {
        try {
            await entry.client.call('ping', ['hmm'], BACKGROUND);
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
            unreachable?: boolean;
            subscribing?: boolean;
            idle?: boolean;
            waiting?: boolean;
            reconnecting?: boolean;
            callbackUrl?: string | undefined;
            callbackFailure?: {port: number; inUse: boolean} | undefined;
            callbackWarning?: CallbackWarning | undefined;
        },
    ): void {
        const state: InterfaceState = {
            ...entry.state,
            ...(changes.connected === undefined ? {} : {connected: changes.connected}),
            ...(entry.lastEvent > 0 ? {lastEvent: entry.lastEvent} : {}),
        };
        setFlag(state, 'absent', changes.absent);
        setFlag(state, 'unreachable', changes.unreachable);
        setFlag(state, 'subscribing', changes.subscribing);
        setFlag(state, 'idle', changes.idle);
        setFlag(state, 'waiting', changes.waiting);
        setFlag(state, 'reconnecting', changes.reconnecting);
        if ('error' in changes) {
            if (changes.error === undefined) {
                delete (state as {error?: string}).error;
            } else {
                state.error = changes.error;
            }
        }
        if ('callbackUrl' in changes) {
            if (changes.callbackUrl === undefined) {
                delete (state as {callbackUrl?: string}).callbackUrl;
            } else {
                state.callbackUrl = changes.callbackUrl;
            }
        }
        if ('callbackFailure' in changes) {
            if (changes.callbackFailure === undefined) {
                delete (state as {callbackFailure?: unknown}).callbackFailure;
            } else {
                state.callbackFailure = changes.callbackFailure;
            }
        }
        if ('callbackWarning' in changes) {
            if (changes.callbackWarning === undefined) {
                delete (state as {callbackWarning?: unknown}).callbackWarning;
            } else {
                state.callbackWarning = {...changes.callbackWarning};
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
function setFlag(
    state: InterfaceState,
    key: 'absent' | 'unreachable' | 'subscribing' | 'idle' | 'waiting' | 'reconnecting',
    value: boolean | undefined,
): void {
    if (value === true) {
        state[key] = true;
    } else if (value === false) {
        // `delete state[key]` with a computed key is banned by the rule set; this is the same thing
        Reflect.deleteProperty(state, key);
    }
}
