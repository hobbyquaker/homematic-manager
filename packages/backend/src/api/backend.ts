/**
 * The backend: one class that implements every method of `ApiMethods` and pushes every event of
 * `ApiEvents`.
 *
 * Everything below it - clients, callback servers, caches, ReGa, the write queue - is wired here
 * and nowhere else, and everything above it (Electron IPC in task 11, WebSocket in task 12) is a
 * transport that forwards `ApiFrame`s. The UI never sees a socket, a file or an RPC library.
 *
 * Two rules run through the whole class. **Reads never queue**: only writes are paced, so opening a
 * paramset editor is immediate where 2.x waited three seconds per call. And **nothing rejects
 * except through `ApiError`**: a CCU that is off, a ReGa that asks for a password, a cache file
 * that cannot be written - each becomes a typed rejection or a `notice` event, never an exception
 * that reaches the host process (2.x's `getRegaNames` threw inside a callback and took the Electron
 * main process with it, issue #127).
 */

import path from 'node:path';

import {
    RPC_METHOD_NAMES,
    RSSI_UNKNOWN,
    countsAsServiceMessage,
    isAcknowledgeable,
    isKnownInterface,
    maintenanceAddress,
    mergeMethodHelp,
    methodsFor,
    callbackPinOption,
    type AppConfig,
    type ApiEventName,
    type CallbackAddressInfo,
    type CallbackPins,
    type ApiEvents,
    type ApiMethodName,
    type ApiMethods,
    type ApiParams,
    type ApiResult,
    type BidcosInterfaceInfo,
    type DeviceDescription,
    type EventRecord,
    type InstallModeOptions,
    type Language,
    type HeatingGroupsState,
    type LinkRecord,
    type MetaEnum,
    type MetaImportMode,
    type MetaNodePatch,
    type MetaSnapshot,
    type MetaState,
    type NameMap,
    type Paramset,
    type ParamsetDescription,
    type ParamsetValue,
    type RpcMethodInfo,
    type RepairConfigOptions,
    type WriteOptions,
    type RpcValue,
    type RpcWriteValue,
    type RssiInfo,
    type ServiceMessage,
    type ConfigSetOptions,
    normaliseDescription,
    repairMisdecodedUtf8,
} from '@homematic-manager/core';

import {CacheStore} from '../cache/store.js';
import {ConfigStore, type ConfigStoreOptions} from '../config/store.js';
import {LinkTemplateStore} from '../config/linkTemplates.js';
import {validateConnection, writePaceFor} from '../config/defaults.js';
import {DataFileServer} from '../data/files.js';
import {installModeCalls} from '../devices/installMode.js';
import {discoverCcus, type DiscoverOptions} from '../discovery/discover.js';
import {
    BackendError,
    configError,
    connectionError,
    errorMessage,
    internalError,
    isMethodUnsupported,
    validationError,
} from '../errors.js';
import {
    InterfaceManager,
    LOOPBACK_IP,
    callbackBindHost,
    firstBidcosInterfaceAddress,
    type InterfaceManagerOptions,
} from '../interfaces/manager.js';
import {HeatingGroupsClient} from '../groups/client.js';
import {MetaService, type MetaServiceOptions} from '../meta/service.js';
import {RegaService, type RegaServiceOptions} from '../rega/client.js';
import type {RpcCallRecord, RpcOutValue} from '../rpc/client.js';
import {listDevicesAnswer, type CallbackHandler} from '../rpc/server.js';
import {ApiEventEmitter} from '../util/emitter.js';
import {describeCallbackAddresses, staticNetwork, systemNetwork, type CallbackNetwork} from '../util/net.js';
import {RpcLog, isWriteMethod} from '../rpc/log.js';
import {currentOrigin, runWithOrigin} from '../rpc/origin.js';
import {ParamsetWriter} from '../write/paramset.js';
import {ConfigRepair} from '../write/repair.js';
import {WriteQueue} from '../write/queue.js';

/** How often the BidCos service messages are polled while the connection is up. */
export const SERVICE_MESSAGE_POLL_MS = 300_000;

/** How long the HmIP `getParamset(:0, VALUES)` sweep waits for the device list to settle. */
export const HMIP_SWEEP_DELAY_MS = 1000;

/**
 * An HmIP interface, by name or by interface type - the same rule the UI's settings dialog uses to
 * count the messages it asks about (task 34), so the question and the writes agree.
 */
function isHmipInterface(name: string, type: string): boolean {
    return /hmip/i.test(name) || /hmip/i.test(type);
}

/** Task 38: how a log line names a callback field. */
const CALLBACK_FIELD_WORDS: Readonly<Record<keyof CallbackPins, string>> = {
    ip: 'callback address',
    xmlrpcPort: 'XML-RPC callback port',
    binrpcPort: 'BIN-RPC callback port',
};

export interface BackendOptions extends Omit<ConfigStoreOptions, 'version'> {
    /** `AppConfig.version`; the host passes its package version. */
    readonly version?: string;
    /** Roots `data.file` may read from, keyed by the prefix the UI uses. */
    readonly fileRoots?: Readonly<Record<string, string>>;
    readonly callbackHost?: string;
    /**
     * Task 35 (D-43): the callback ports taken while the connection's are `0` - the CCU addon's fixed
     * pair. A property of the host, not of the profile: it is never written to `config.json`, and
     * `AppConfig.callbackDefaultPorts` reports it so the settings dialog can say what `0` means.
     */
    readonly defaultCallbackPorts?: {readonly xmlrpc: number; readonly binrpc: number};
    /**
     * Task 38: the host runs in a container (the image sets `HMM_IN_CONTAINER`). Where its callback
     * servers listen beyond the loopback, `AppConfig.publishCallbackPorts` tells the interface
     * popup to say that the callback ports must be published unchanged.
     */
    readonly inContainer?: boolean;
    /**
     * B-53: the interfaces, name lookup and route probe the automatic callback address comes from.
     * Absent, the machine's own - or, where `localAddresses` is injected, that list alone.
     */
    readonly network?: CallbackNetwork;
    readonly rpcTimeoutMs?: number;
    readonly watchdogIntervalMs?: number;
    readonly serviceMessagePollMs?: number;
    /**
     * D-31: how long the backend waits, with no UI session connected, before it drops its event
     * subscriptions (`init('')` per interface, watchdog and service-message poll stopped, caches
     * and configuration kept). The next session that connects subscribes again.
     *
     * `0` or omitted turns it off, which is the Electron case: `InProcessTransport` never reports
     * a session, so the count is always zero and a grace period would unsubscribe a running window.
     * Only a transport that really counts sessions - `ApiWebSocketServer` - may switch this on.
     */
    readonly idleUnsubscribeMs?: number;
    readonly hmipSweepDelayMs?: number;
    readonly cacheWriteDelayMs?: number;
    readonly now?: () => number;
    /** Injected by the tests in place of the real world. */
    readonly createInterfaceManager?: (options: InterfaceManagerOptions) => InterfaceManager;
    readonly createRega?: (options: RegaServiceOptions) => RegaService;
    /** D-40: injected by the tests, and by the integration test that runs a real occulited. */
    readonly metaOptions?: Partial<MetaServiceOptions>;
    readonly discover?: (options: DiscoverOptions) => Promise<AppConfig['discovered']>;
    readonly interfaceManagerOptions?: Partial<InterfaceManagerOptions>;
    readonly regaOptions?: Partial<RegaServiceOptions>;
}

/** Implements the whole contract. `open()` loads, `start()` connects, `stop()` disconnects. */
export class Backend {
    readonly events: ApiEventEmitter;

    readonly #options: BackendOptions;
    readonly #config: ConfigStore;
    readonly #queue: WriteQueue;
    readonly #rpcLog: RpcLog;
    readonly #unknownMethodsSeen = new Set<string>();
    readonly #writer: ParamsetWriter;
    readonly #repair: ConfigRepair;
    readonly #files: DataFileServer;
    /** Issue #21: the saved link templates of this profile directory. */
    readonly #linkTemplates: LinkTemplateStore;
    readonly #now: () => number;
    readonly #methodCache = new Map<string, RpcMethodInfo[]>();

    #caches: CacheStore;
    #manager: InterfaceManager | undefined;
    #rega: RegaService | undefined;
    /** D-40: the metadata store of this connection - this profile's own, or an openccu-lite box. */
    #meta: MetaService | undefined;
    /** D-40: the session a host with a login knows about; writes to the box go out as this one. */
    #metaSession: string | undefined;
    /**
     * D-40: the detection, in flight.
     *
     * The probe is **not** awaited by `#connect`: a host that swallows packets on port 80 - a
     * firewall, a CCU that is off, a WSL loopback - would otherwise hold the whole connection up
     * for the detection timeout while the interfaces are already there. Everything that needs the
     * store waits for this promise instead, and the UI hears about it through `meta.changed`.
     */
    #metaReady: Promise<void> | undefined;
    #serviceMessageTimer: ReturnType<typeof setInterval> | undefined;
    #hmipSweepTimer: ReturnType<typeof setTimeout> | undefined;
    #hmipSweepRunning = false;
    #stopped = false;
    #sessions = 0;
    /**
     * Interfaces that were asked `getServiceMessages` once and answered that they do not have it.
     * Only user-defined interfaces can land in here - the built-in ones are decided by the core's
     * table - and it is emptied whenever the connection is rebuilt.
     */
    readonly #noServiceMessages = new Set<string>();
    /**
     * B-26 (#158): interfaces whose last `getServiceMessages` failed for a reason that may pass - a
     * timeout, a process that is restarting. The failure is logged when the interface lands in
     * here and not again until a call succeeds; before, the five-minute poll logged it every round.
     */
    readonly #serviceMessageFailures = new Set<string>();
    /**
     * B-26 (#158): the `system.listMethods` answer of a user-defined interface, asked once and
     * dropped when the interface subscribes again - a re-`init` may be a restarted, updated process.
     * `undefined` inside means "no usable list", and the method is then tried once, as before.
     */
    readonly #listedMethods = new Map<string, Promise<ReadonlySet<string> | undefined>>();
    /** B-26: interfaces that do not have `system.listMethods` itself; kept for the connection. */
    readonly #noListMethods = new Set<string>();
    #idleTimer: ReturnType<typeof setTimeout> | undefined;
    /** Task 38: the saved callback values a pinned one replaces are logged by the first `start()` only. */
    #pinsReported = false;

    private constructor(options: BackendOptions, config: ConfigStore, caches: CacheStore) {
        this.#options = options;
        this.#config = config;
        this.#caches = caches;
        this.#now = options.now ?? (() => Date.now());
        this.#linkTemplates = new LinkTemplateStore({
            file: path.join(options.dataDir, 'link-templates.json'),
            ...(options.now === undefined ? {} : {now: options.now}),
        });
        this.events = new ApiEventEmitter((event, error) => {
            // an event handler of the UI must not be able to break the backend
            process.emitWarning(`handler of ${event} threw: ${errorMessage(error)}`);
        });
        this.#queue = new WriteQueue({
            paceFor: (interfaceName) => writePaceFor(interfaceName, this.#config.connection.writePaceMs),
        });
        this.#rpcLog = new RpcLog({
            file: config.cacheFile('write-log.json'),
            rpcLogFolder: config.connection.rpcLogFolder,
            onAppended: (entry) => {
                this.events.emit('rpcLog.appended', entry);
            },
            onError: (error) => {
                this.#notice('warn', `RPC log: ${errorMessage(error)}`);
            },
            ...(options.cacheWriteDelayMs === undefined ? {} : {writeDelayMs: options.cacheWriteDelayMs}),
        });
        this.#writer = new ParamsetWriter({
            index: (interfaceName) => this.#caches.devices.index(interfaceName),
            describe: (interfaceName, address, paramset) => this.#describe(interfaceName, address, paramset),
            read: (interfaceName, method, params) => this.#read(interfaceName, method, params),
            write: (interfaceName, method, params) => this.#write(interfaceName, method, params),
            onProgress: (progress) => {
                this.events.emit('write.progress', progress);
            },
        });
        this.#repair = new ConfigRepair({
            index: (interfaceName) => this.#caches.devices.index(interfaceName),
            describe: (interfaceName, address, paramset) => this.#describe(interfaceName, address, paramset),
            read: (interfaceName, method, params) => this.#read(interfaceName, method, params),
            write: (interfaceName, method, params) => this.#write(interfaceName, method, params),
            onProgress: (progress) => {
                this.events.emit('write.progress', progress);
            },
        });
        this.#files = new DataFileServer({roots: options.fileRoots ?? {}});
    }

    /** Loads the configuration and the caches. Does not connect; `start()` does. */
    static async open(options: BackendOptions): Promise<Backend> {
        const config = await ConfigStore.open({...options, version: options.version ?? '3.0.0-dev.0'});
        const caches = new CacheStore({
            cacheDir: config.cacheDir,
            ...(options.now === undefined ? {} : {now: options.now}),
            ...(options.cacheWriteDelayMs === undefined ? {} : {writeDelayMs: options.cacheWriteDelayMs}),
        });
        await caches.load();
        const backend = new Backend(options, config, caches);
        await backend.#rpcLog.load();
        await backend.#linkTemplates.load();
        return backend;
    }

    /** Subscribes to an event of the contract. */
    on<E extends ApiEventName>(event: E, handler: (payload: ApiEvents[E]) => void): () => void {
        return this.events.on(event, handler);
    }

    /** Connects to the configured CCU. A connection that cannot be made becomes a notice. */
    async start(): Promise<void> {
        this.#stopped = false;
        if (this.#config.importedFromLegacy) {
            this.#notice('info', 'the configuration of Homematic Manager 2.x was imported');
        }
        if (!this.#pinsReported) {
            // Task 38: once per process - the value in config.json stays, it only has no effect
            this.#pinsReported = true;
            for (const {field, saved, pinned} of this.#config.ignoredCallback) {
                this.#notice(
                    'info',
                    `callback: the saved ${CALLBACK_FIELD_WORDS[field]} ${String(saved)} is ignored, ` +
                        `${callbackPinOption(field)} sets ${String(pinned)}`,
                );
            }
        }
        const problems = validateConnection(this.#config.connection);
        if (problems.length > 0) {
            this.#notice('info', `not connecting: ${problems.join(', ')}`);
            return;
        }
        await this.#connect();
    }

    /** De-registers, closes every socket and flushes the caches. */
    async stop(): Promise<void> {
        this.#stopped = true;
        this.#clearTimers();
        this.#queue.cancel();
        await this.#manager?.stop();
        this.#manager = undefined;
        this.#rega = undefined;
        // D-40: before the caches are flushed, and awaited even when it is only the detection that
        // is still in flight. A store that finishes loading after this would apply its names, ask
        // for a cache write and put a file back into a directory the caller has already taken
        // apart - which is how CI found this, as an ENOTEMPTY in a suite that has nothing to do
        // with metadata.
        await this.#metaReady?.catch(() => undefined);
        this.#metaReady = undefined;
        await this.#meta?.stop();
        this.#meta = undefined;
        await this.#caches.flush();
        await this.#rpcLog.flush();
        this.events.clear();
    }

    /**
     * D-31: how many UI sessions a transport currently holds.
     *
     * `ApiWebSocketServer` calls this on every connect and disconnect. When the count reaches zero
     * and stays there for `idleUnsubscribeMs`, every interface is de-registered with `init('')` -
     * a CCU should not push events at a page nobody has open, and on the addon those events cost
     * the CCU's own CPU. The first session to connect again subscribes, and the interfaces report
     * `subscribing` until their `listDevices` sweep is through.
     *
     * `InProcessTransport` never calls it, so Electron never goes idle whatever the option says.
     */
    noteSessions(count: number): void {
        const previous = this.#sessions;
        this.#sessions = Math.max(0, count);
        if (this.#idleTimer !== undefined) {
            clearTimeout(this.#idleTimer);
            this.#idleTimer = undefined;
        }
        if (this.#sessions > 0) {
            if (previous === 0) {
                void runWithOrigin('background', () => this.#resubscribe());
            }
            return;
        }
        const grace = this.#options.idleUnsubscribeMs ?? 0;
        if (grace <= 0 || this.#stopped) {
            return;
        }
        const timer = setTimeout(() => {
            this.#idleTimer = undefined;
            void runWithOrigin('background', () => this.#unsubscribeIdle());
        }, grace);
        if (typeof timer.unref === 'function') {
            timer.unref();
        }
        this.#idleTimer = timer;
    }

    async #unsubscribeIdle(): Promise<void> {
        const manager = this.#manager;
        if (!manager || this.#sessions > 0 || this.#stopped || manager.idle) {
            return;
        }
        this.#clearTimers();
        await manager.unsubscribe();
        this.events.emit('interfaces.changed', manager.states());
        this.#notice('info', 'no user interface is open: the event subscriptions were dropped (D-31)');
    }

    async #resubscribe(): Promise<void> {
        const manager = this.#manager;
        if (!manager || !manager.idle || this.#stopped) {
            return;
        }
        this.#notice('info', 'a user interface connected: subscribing to the interfaces again');
        await manager.subscribe();
        this.events.emit('interfaces.changed', manager.states());
        this.#startServiceMessagePolling();
    }

    /**
     * The one entry point of the contract. Every rejection is an `ApiError`; the transports put it
     * on the wire unchanged.
     */
    async request<M extends ApiMethodName>(method: M, ...params: ApiParams<M>): Promise<ApiResult<M>> {
        try {
            // Task 48: everything a request awaits is a UI action for the RPC log; the console's
            // own call is the console's. Whatever runs outside a request is background work.
            return await runWithOrigin(method === 'rpc.call' ? 'console' : 'ui', () => this.#dispatch(method, params));
        } catch (error) {
            throw error instanceof BackendError ? error : internalError(errorMessage(error), error);
        }
    }

    async #dispatch(method: ApiMethodName, params: unknown[]): Promise<unknown> {
        // `JSON.stringify(['x', undefined])` is `["x",null]`: an omitted optional parameter reaches
        // us as `null` over the WebSocket and as `undefined` over Electron IPC, which uses the
        // structured clone algorithm. No method of the contract takes `null` as a meaningful
        // argument, so the two mean the same thing here. Without this, `serviceMessages.list()`
        // from the web UI asked for the interface *named* `null` and got an empty list - the
        // refresh button emptied a list the backend still had (found by the e2e suite of task 14).
        const normalised = params.map((value) => (value === null ? undefined : value));
        // the positional tuple of the contract; `never` fits every parameter type of every method,
        // and the tuple form keeps `noUncheckedIndexedAccess` from adding `undefined` to each slot
        const p = normalised as [never, never, never, never, never];
        switch (method) {
            case 'config.get':
                return this.#configWithDetected();
            case 'config.set':
                return this.#setConfig(p[0], params[1] as ConfigSetOptions | undefined);
            case 'config.discover':
                return this.#discover();
            case 'config.clearCaches':
                return this.#clearCaches();
            case 'config.callbackAddresses':
                return this.#callbackAddresses(p[0]);

            case 'interfaces.list':
                return this.#manager?.states() ?? [];
            case 'interfaces.reconnect':
                await this.#requireManager().reconnect(p[0]);
                return null;
            case 'rega.state':
                return this.#rega?.state ?? {enabled: this.#config.connection.rega, reachable: false, names: 0};

            case 'devices.list':
                return this.#listDevices(p[0], p[1]);
            case 'devices.description':
                return this.#deviceDescription(p[0], p[1]);
            case 'devices.delete':
                return this.#deleteDevice(p[0], p[1], p[2]);
            case 'devices.replace':
                return Boolean(await this.#write(p[0], 'replaceDevice', [p[1], p[2]]));
            case 'devices.reportValueUsage':
                return Number(await this.#write(p[0], 'reportValueUsage', [p[1], p[2], p[3]]));
            case 'devices.restoreConfig':
                await this.#write(p[0], 'restoreConfigToDevice', [p[1]]);
                return null;
            case 'devices.clearConfigCache':
                await this.#write(p[0], 'clearConfigCache', [p[1]]);
                return null;
            case 'devices.repairConfig':
                return this.#repair.repair(p[0], p[1], (params[2] as RepairConfigOptions | undefined) ?? {});
            case 'devices.updateFirmware':
                return asBooleans(await this.#write(p[0], 'updateFirmware', [p[1]]));
            case 'devices.installFirmware':
                return Boolean(await this.#write(p[0], 'installFirmware', [p[1]]));
            case 'devices.installMode.set':
                return this.#setInstallMode(p[0], p[1], p[2]);
            case 'devices.installMode.get':
                return Number(await this.#read(p[0], 'getInstallMode', []));
            case 'devices.replaceable':
                return asDescriptions(await this.#read(p[0], 'listReplaceableDevices', [p[1]]));

            case 'names.get':
                return this.#caches.names.all();
            case 'names.set':
                return this.#setNames(p[0]);

            case 'meta.state':
                return this.#metaState();
            case 'meta.get':
                return this.#metaSnapshot();
            case 'meta.enums':
                return (await this.#requireMeta()).enums();
            case 'meta.objects':
                return (await this.#requireMeta()).objects();
            case 'meta.setMembership':
                await (await this.#requireMeta()).setMembership(p[0]);
                return null;
            case 'meta.assign':
                await (await this.#requireMeta()).assign(p[0], p[1], p[2]);
                return null;
            case 'meta.enum.create':
                await (await this.#requireMeta()).createEnum(p[0], p[1]);
                return null;
            case 'meta.enum.update':
                await (await this.#requireMeta()).updateEnum(p[0], p[1]);
                return null;
            case 'meta.enum.delete':
                await (await this.#requireMeta()).deleteEnum(p[0], p[1] === true);
                return null;
            case 'meta.node.create':
                return (await this.#requireMeta()).createNode(
                    p[0],
                    // absent means "at the root"; see the contract for why it is not `null` here.
                    // Read from `params` and not from `p`, whose slots are `never`: this is the one
                    // place that has to tell "absent" from a value, and `never` cannot.
                    (params[1] as string | undefined) ?? null,
                    p[2],
                    (params[3] as {icon?: string; position?: number} | undefined) ?? {},
                );
            case 'meta.node.update':
                await (await this.#requireMeta()).updateNode(p[0], params[1] as MetaNodePatch);
                return null;
            case 'meta.node.delete':
                await (await this.#requireMeta()).deleteNode(p[0], p[1] === true);
                return null;
            case 'meta.refresh': {
                const meta = await this.#requireMeta();
                await meta.refresh();
                return meta.state();
            }
            case 'meta.pairing': {
                // task 66: no store yet, or a store that is not the system's, is "nothing to say"
                await this.#metaReady?.catch(() => undefined);
                return (await this.#meta?.hmipPairing()) ?? null;
            }
            case 'meta.export':
                return (await this.#requireMeta()).document();
            case 'meta.import':
                await (await this.#requireMeta()).import(p[0], (params[1] as MetaImportMode | undefined) ?? 'replace');
                return null;

            case 'groups.state':
                return this.#groupsState();
            case 'groups.list':
                return (await this.#requireGroups()).list();
            case 'groups.types':
                return (await this.#requireGroups()).types();
            case 'groups.get':
                return (await this.#requireGroups()).get(p[0]);
            case 'groups.create':
                return (await this.#requireGroups()).create(p[0], p[1], p[2]);
            case 'groups.update':
                // `undefined` keeps a field, so these two are read from `params`, like `meta.node.create`'s -
                // and a `null`, which is what the WebSocket makes of an omitted argument, means the same
                return (await this.#requireGroups()).update(p[0], {
                    name: (params[1] as string | null | undefined) ?? undefined,
                    members: (params[2] as string[] | null | undefined) ?? undefined,
                });
            case 'groups.delete':
                return (await this.#requireGroups()).remove(p[0]);

            case 'paramset.get':
                return this.#getParamset(p[0], p[1], p[2]);
            case 'paramset.description':
                return this.#describe(p[0], p[1], p[2]);
            case 'paramset.put':
                return this.#writer.put(p[0], p[1], p[2], p[3], (params[4] as WriteOptions | undefined) ?? {});
            case 'paramset.putLink':
                return this.#writer.putLink(p[0], p[1], p[2], (params[3] as WriteOptions | undefined) ?? {});
            case 'value.set':
                await this.#writer.setValue(p[0], p[1], p[2], p[3]);
                return null;
            case 'value.get':
                return this.#read(p[0], 'getValue', [p[1], p[2]]);

            case 'links.list':
                return asLinks(await this.#read(p[0], 'getLinks', []));
            case 'links.add':
                await this.#write(p[0], 'addLink', [
                    p[1],
                    p[2],
                    (params[3] as string | undefined) ?? '',
                    (params[4] as string | undefined) ?? '',
                ]);
                return null;
            case 'links.remove':
                await this.#write(p[0], 'removeLink', [p[1], p[2]]);
                return null;
            case 'links.info.get':
                return asLink(await this.#read(p[0], 'getLinkInfo', [p[1], p[2]]), p[1], p[2]);
            case 'links.info.set':
                await this.#write(p[0], 'setLinkInfo', [p[1], p[2], p[3], p[4]]);
                return null;
            case 'links.activate':
                await this.#write(p[0], 'activateLinkParamset', [p[1], p[2], p[3]]);
                return null;
            case 'links.peers':
                return asStrings(await this.#read(p[0], 'getLinkPeers', [p[1]]));

            case 'rssi.get':
                return this.#rssi(p[0]);
            case 'bidcos.interfaces':
                return asBidcosInterfaces(await this.#read(p[0], 'listBidcosInterfaces', []));
            case 'bidcos.setInterface':
                await this.#write(p[0], 'setBidcosInterface', [p[1], p[2], p[3]]);
                return null;

            case 'teams.list':
                return asDescriptions(await this.#read(p[0], 'listTeams', []));
            case 'teams.set':
                // a write: it changes the device, so it goes through the paced queue like one
                await this.#write(p[0], 'setTeam', [p[1], p[2]]);
                await this.#refreshDevices(p[0]);
                return null;

            case 'rega.confirmInbox':
                return (await (this.#rega?.confirmInbox() ?? Promise.resolve([]))).map((entry) => entry.address);

            case 'linkTemplates.list':
                return this.#linkTemplates.list(p[0]);
            case 'linkTemplates.save':
                return this.#linkTemplates.save(p[0]);
            case 'linkTemplates.remove':
                return this.#linkTemplates.remove(p[0]);

            case 'unreach.list':
                return this.#caches.unreach.list(p[0]);
            case 'unreach.reset':
                return this.#resetUnreach(p[0], p[1]);
            case 'serviceMessages.list':
                return this.#serviceMessages(p[0]);
            case 'serviceMessages.refresh':
                return this.#refreshAllServiceMessages(p[0]);
            case 'serviceMessages.ack':
                return this.#acknowledge(p[0], p[1], p[2]);

            case 'events.recent':
                return this.#recentEvents(p[0], p[1]);
            case 'events.clear':
                this.#caches.events.clear();
                return null;

            case 'rpc.call':
                return this.#consoleCall(p[0], p[1], p[2]);
            case 'rpc.methods':
                return this.#methods(p[0]);

            case 'write.cancel':
                return this.#queue.cancel(p[0]);
            case 'rpcLog.list':
                return this.#rpcLog.list(p[0]);
            case 'rpcLog.clear':
                this.#rpcLog.clear();
                return null;

            case 'data.file':
                return this.#files.read(p[0]);

            case 'session.info':
                // D-32: a session belongs to a transport, not to the backend. Every transport that
                // has no login - Electron's in-process one, a web host in token mode - leaves this
                // answer alone, and the UI shows no user and no logout link for it.
                return null;
            default:
                throw configError(`unknown API method "${String(method)}"`);
        }
    }

    /*
     * connection
     */

    #requireManager(): InterfaceManager {
        if (!this.#manager) {
            throw configError('not connected to a CCU');
        }
        return this.#manager;
    }

    /**
     * Task 48: the connection is background work even when a `config.set` from the settings dialog
     * asks for it - the watchdog, the callback servers and the polling timers it creates would
     * otherwise inherit that request's origin for the rest of the session.
     */
    #connect(): Promise<void> {
        return runWithOrigin('background', () => this.#connectNow());
    }

    async #connectNow(): Promise<void> {
        const connection = this.#config.connection;
        this.#noServiceMessages.clear();
        this.#serviceMessageFailures.clear();
        this.#listedMethods.clear();
        this.#noListMethods.clear();
        const manager = (this.#options.createInterfaceManager ?? ((options) => new InterfaceManager(options)))({
            connection,
            handler: this.#callbackHandler(),
            onStateChanged: (states) => {
                this.events.emit('interfaces.changed', states);
            },
            onNotice: (level, message, interfaceName) => {
                this.#notice(level, message, interfaceName);
            },
            onConnected: (interfaceName) =>
                runWithOrigin('background', () => this.#onInterfaceConnected(interfaceName)),
            onCall: (record) => {
                this.#onCall(record);
            },
            originOf: currentOrigin,
            ...(this.#options.callbackHost === undefined ? {} : {callbackHost: this.#options.callbackHost}),
            ...(this.#options.defaultCallbackPorts === undefined
                ? {}
                : {defaultCallbackPorts: this.#options.defaultCallbackPorts}),
            ...(this.#config.callbackPins === undefined ? {} : {callbackPins: this.#config.callbackPins}),
            ...(this.#options.rpcTimeoutMs === undefined ? {} : {rpcTimeoutMs: this.#options.rpcTimeoutMs}),
            ...(this.#options.watchdogIntervalMs === undefined
                ? {}
                : {watchdogIntervalMs: this.#options.watchdogIntervalMs}),
            ...(this.#options.localAddresses === undefined ? {} : {localAddresses: this.#options.localAddresses}),
            ...(this.#options.network === undefined ? {} : {network: this.#options.network}),
            ...(this.#keepsConfiguredCallbackIp() ? {keepConfiguredCallbackIp: true} : {}),
            ...(this.#options.now === undefined ? {} : {now: this.#options.now}),
            ...this.#options.interfaceManagerOptions,
        });
        this.#manager = manager;

        this.#rega = (this.#options.createRega ?? ((options) => new RegaService(options)))({
            host: connection.host,
            enabled: connection.rega,
            tls: connection.tls,
            auth: connection.auth,
            // ReGa's client takes a language for the WebUI placeholder translation, which is off
            // here anyway (`translate: false`). `auto` is not a language, so an unset profile
            // leaves the client at its own default rather than sending a word it cannot parse.
            ...(connection.language === undefined || connection.language === 'auto'
                ? {}
                : {language: connection.language}),
            names: this.#caches.names,
            onStateChanged: (state) => {
                this.events.emit('rega.changed', state);
            },
            onNotice: (level, message) => {
                this.#notice(level, message);
            },
            ...this.#options.regaOptions,
        });

        try {
            await manager.start();
        } catch (error) {
            this.#manager = undefined;
            this.#notice('error', errorMessage(error));
            return;
        }

        if (await this.#rega.refreshNames()) {
            this.#caches.saveNames();
            this.events.emit('names.changed', this.#caches.names.all());
        }
        this.#metaReady = this.#startMeta(connection);
        this.#startServiceMessagePolling();
    }

    async #disconnect(): Promise<void> {
        this.#clearTimers();
        this.#queue.cancel();
        await this.#manager?.stop();
        this.#manager = undefined;
        this.#rega = undefined;
        // the detection may still be in flight; stopping a provider that is not there yet would
        // leave its event stream running behind the disconnect
        await this.#metaReady?.catch(() => undefined);
        this.#metaReady = undefined;
        await this.#meta?.stop();
        this.#meta = undefined;
        this.#methodCache.clear();
    }

    /**
     * D-40: picks the metadata provider for this connection and starts it.
     *
     * After the interfaces, because the ref of an address (`<interface>.<address>`) is resolved
     * from the device caches and those are filled by the `listDevices` sweep the interfaces do on
     * connect. Before that the store's names are still applied - they are keyed by ref, and the
     * address half of a ref never needs an interface to be readable.
     */
    async #startMeta(connection: AppConfig['connection']): Promise<void> {
        try {
            const meta = await MetaService.create({
                connection,
                dataDir: this.#options.dataDir,
                cacheDir: this.#config.cacheDir,
                names: this.#caches.names,
                interfaceOf: (address) => this.#interfaceOf(address),
                // task 27: ReGa as the store of rooms and functions on a CCU. Read through the
                // service that is current at call time - a reconnect replaces it.
                rega:
                    this.#rega === undefined || !connection.rega
                        ? undefined
                        : {
                              available: this.#rega.available,
                              exec: (script) => this.#requireRega().exec(script),
                          },
                onChanged: () => {
                    this.#onMetaChanged();
                },
                onStateChanged: (state) => {
                    this.events.emit('meta.changed', state);
                },
                onNotice: (level, message) => {
                    this.#notice(level, message);
                },
                ...this.#options.metaOptions,
            });
            if (this.#stopped) {
                // stopped while the box was being probed; starting the provider now would open an
                // event stream nobody will ever close
                return;
            }
            meta.setSessionCredential(this.#metaSession);
            this.#meta = meta;
            await meta.start();
            this.#onMetaChanged();
        } catch (error) {
            // D-2 in its metadata shape: a store that cannot be opened costs the taxonomy, never
            // the application
            this.#notice('warn', `the metadata store could not be opened: ${errorMessage(error)}`);
        }
    }

    #requireRega(): RegaService {
        if (!this.#rega) {
            throw configError('ReGa is not connected');
        }
        return this.#rega;
    }

    /** The store changed - locally, or on the box because somebody else edited it. */
    #onMetaChanged(): void {
        const meta = this.#meta;
        if (!meta || this.#stopped) {
            return;
        }
        this.#caches.saveNames();
        this.events.emit('names.changed', this.#caches.names.all());
        this.events.emit('meta.enums.changed', meta.enums());
        this.events.emit('meta.objects.changed', meta.objects());
    }

    /** Which interface reports an address; the ref of the metadata store is built from it. */
    #interfaceOf(address: string): string | undefined {
        const device = address.split(':')[0] ?? address;
        for (const interfaceName of this.#caches.devices.interfaces()) {
            if (this.#caches.devices.get(interfaceName, address) ?? this.#caches.devices.get(interfaceName, device)) {
                return interfaceName;
            }
        }
        return undefined;
    }

    /**
     * D-40: the session of the person looking at the page, for the writes to an openccu-lite box.
     *
     * The shell of the box hands an addon page the user's session as `?sid=@xxxxxxxxxx@`, and that
     * session is a valid credential for the metadata API. The addon reads with the box's local
     * token, which is read-only by design, and writes as the user - so nothing renames a device
     * unless a person asked for it. Hosts without a login never call this.
     */
    noteMetaSession(sid: string | undefined): void {
        this.#metaSession = sid;
        this.#meta?.setSessionCredential(sid);
    }

    #clearTimers(): void {
        if (this.#idleTimer !== undefined) {
            clearTimeout(this.#idleTimer);
            this.#idleTimer = undefined;
        }
        if (this.#serviceMessageTimer !== undefined) {
            clearInterval(this.#serviceMessageTimer);
            this.#serviceMessageTimer = undefined;
        }
        if (this.#hmipSweepTimer !== undefined) {
            clearTimeout(this.#hmipSweepTimer);
            this.#hmipSweepTimer = undefined;
        }
    }

    /** Fills the caches of an interface that has just subscribed. */
    async #onInterfaceConnected(interfaceName: string): Promise<void> {
        // B-26: a (re-)`init` may be a restarted process, so its method list is asked again
        this.#listedMethods.delete(interfaceName);
        try {
            await this.#refreshDevices(interfaceName);
        } catch (error) {
            this.#notice('warn', `${interfaceName}: listDevices failed: ${errorMessage(error)}`, interfaceName);
        }
        if (interfaceName === 'HmIP-RF') {
            await this.#findCentralAddress(interfaceName);
            this.#scheduleHmipSweep();
        } else {
            await this.#refreshServiceMessages(interfaceName);
        }
    }

    /** Issue #93: an answer that is not a list of interfaces must not take the connection down. */
    async #findCentralAddress(interfaceName: string): Promise<void> {
        try {
            const address = firstBidcosInterfaceAddress(await this.#read(interfaceName, 'listBidcosInterfaces', []));
            if (address === undefined) {
                this.#notice('info', `${interfaceName}: no access point in listBidcosInterfaces`, interfaceName);
                return;
            }
            this.#caches.rssi(interfaceName).setCentralAddress(address);
        } catch (error) {
            this.#notice(
                'warn',
                `${interfaceName}: listBidcosInterfaces failed: ${errorMessage(error)}`,
                interfaceName,
            );
        }
    }

    /*
     * the callbacks
     */

    #callbackHandler(): CallbackHandler {
        return {
            event: (interfaceName, address, datapoint, value) => {
                this.#onEvent(interfaceName, address, datapoint, value);
            },
            newDevices: (interfaceName, devices) => {
                const addresses = this.#caches.devices.add(interfaceName, devices);
                this.#caches.saveDevices();
                this.#recordDeviceEvent(interfaceName, 'newDevices', devices as unknown as RpcValue);
                this.events.emit('devices.changed', {interfaceName, kind: 'new', addresses});
                if (interfaceName === 'HmIP-RF') {
                    this.#scheduleHmipSweep();
                }
                // Issue #54: a device that has just been paired sits in the CCU's inbox until
                // somebody confirms it in the WebUI. Opt-in and ReGa-only (D-2): without ReGa the
                // call answers with an empty list and nothing happened.
                if (addresses.length > 0 && this.#config.connection.autoConfirmRegaInbox === true) {
                    void this.#rega?.confirmInbox();
                }
            },
            deleteDevices: (interfaceName, addresses) => {
                const removed = this.#caches.devices.remove(interfaceName, addresses);
                this.#caches.saveDevices();
                this.#recordDeviceEvent(interfaceName, 'deleteDevices', addresses);
                this.events.emit('devices.changed', {interfaceName, kind: 'deleted', addresses: removed});
            },
            replaceDevice: (interfaceName, oldAddress, newAddress) => {
                const addresses = this.#caches.devices.replaceDevice(interfaceName, oldAddress, newAddress);
                this.#caches.names.rename(oldAddress, newAddress);
                this.#caches.saveDevices();
                this.#caches.saveNames();
                this.#recordDeviceEvent(interfaceName, 'replaceDevice', [oldAddress, newAddress]);
                this.events.emit('devices.changed', {interfaceName, kind: 'replaced', addresses});
                this.events.emit('names.changed', this.#caches.names.all());
            },
            readdedDevice: (interfaceName, addresses) => {
                this.events.emit('devices.changed', {interfaceName, kind: 'refreshed', addresses});
            },
            updateDevice: (interfaceName, address) => {
                this.events.emit('devices.changed', {interfaceName, kind: 'refreshed', addresses: [address]});
            },
            listDevices: (interfaceName) => listDevicesAnswer(interfaceName, this.#caches.devices.list(interfaceName)),
            readyConfig: () => {
                // documented, harmless, and not worth a toast
            },
            unknownMethod: (methodName) => {
                // once per method and session: the CCU repeats such calls on every init, and a
                // toast per repeat was the first thing a beta tester saw
                if (this.#unknownMethodsSeen.has(methodName)) {
                    return;
                }
                this.#unknownMethodsSeen.add(methodName);
                this.#notice('info', `an interface called ${methodName}, which this program does not use`);
            },
        };
    }

    #onEvent(interfaceName: string, address: string, datapoint: string, value: RpcValue): void {
        this.#manager?.noteEvent(interfaceName);
        const record: EventRecord = {
            timestamp: this.#now(),
            interfaceName,
            method: 'event',
            address,
            datapoint,
            value,
        };
        this.#caches.events.push(record);
        this.events.emit('rpc.event', record);

        if (isScalar(value)) {
            if (
                countsAsServiceMessage(datapoint, value) &&
                this.#caches.serviceMessages.apply(interfaceName, address, datapoint, value)
            ) {
                this.events.emit('serviceMessages.changed', this.#caches.listServiceMessages());
            }
            this.#noteUnreach(interfaceName, address, datapoint, value);
            if (interfaceName === 'HmIP-RF') {
                this.#caches.rssi(interfaceName).applyHmipValue(address.split(':')[0] ?? address, datapoint, value);
            }
        }
    }

    /**
     * Issue #26: count the outage, and acknowledge it when the user asked for that.
     *
     * The order matters: the counter is written first, so switching the auto-acknowledge on never
     * costs information. The acknowledgement itself is the ordinary `serviceMessages.ack` path - a
     * `setValue` through the paced write queue - and its failure is a notice, never an exception:
     * a device that is unreachable is not going to take a write either, which is the normal case
     * here and not worth an error dialog.
     */
    #noteUnreach(
        interfaceName: string,
        address: string,
        datapoint: string,
        value: RpcValue,
        options: {acknowledge?: boolean} = {},
    ): void {
        if (!this.#caches.unreach.note(interfaceName, address, datapoint, value, this.#now())) {
            return;
        }
        this.#caches.saveUnreach();
        this.events.emit('unreach.changed', this.#caches.unreach.list());
        if (
            options.acknowledge !== false &&
            datapoint === 'STICKY_UNREACH' &&
            value === true &&
            this.#config.connection.autoAckStickyUnreach === true
        ) {
            void this.#acknowledge(interfaceName, address, datapoint).catch((error: unknown) => {
                this.#notice(
                    'info',
                    `${address}: STICKY_UNREACH could not be acknowledged automatically: ${errorMessage(error)}`,
                    interfaceName,
                );
            });
        }
    }

    #resetUnreach(interfaceName?: string, address?: string): null {
        this.#caches.unreach.reset(interfaceName, address);
        this.#caches.saveUnreach();
        this.events.emit('unreach.changed', this.#caches.unreach.list());
        return null;
    }

    #recordDeviceEvent(interfaceName: string, method: EventRecord['method'], payload: RpcValue): void {
        this.#manager?.noteEvent(interfaceName);
        const record: EventRecord = {timestamp: this.#now(), interfaceName, method, payload};
        this.#caches.events.push(record);
        this.events.emit('rpc.event', record);
    }

    /*
     * RPC
     */

    #onCall(record: RpcCallRecord): void {
        this.#rpcLog.append(record);
    }

    /** A read: straight to the interface, never queued. */
    async #read(interfaceName: string, method: string, params: readonly RpcOutValue[]): Promise<RpcValue> {
        return this.#requireManager().client(interfaceName).call(method, params);
    }

    /** A write: through the paced queue of that interface. */
    async #write(interfaceName: string, method: string, params: readonly RpcOutValue[]): Promise<RpcValue> {
        const client = this.#requireManager().client(interfaceName);
        // Task 48: the queue runs a task from the timer that drained it, which is the *previous*
        // task's context; the origin is the one of whoever enqueued, so it is taken here.
        const origin = currentOrigin();
        return this.#queue.enqueue(interfaceName, () => client.call(method, params, {origin}));
    }

    /*
     * configuration
     */

    #configWithDetected(): AppConfig {
        return this.#withHostFacts(this.#config.config);
    }

    /**
     * What the host adds to the stored configuration before anybody sees it: task 35's callback
     * ports a `0` stands for. Added to every `AppConfig` that leaves the backend - `config.get`,
     * `config.set` and both `config.changed` events - so the dialog never loses the hint on a save.
     */
    #withHostFacts(config: AppConfig): AppConfig {
        const ports = this.#options.defaultCallbackPorts;
        const pins = this.#config.callbackPins;
        // Task 38: a container whose callback servers listen on the loopback only has nothing to publish
        const bindHost = this.#options.callbackHost ?? callbackBindHost(config.connection);
        const publish = this.#options.inContainer === true && bindHost !== LOOPBACK_IP;
        return {
            ...config,
            ...(ports === undefined ? {} : {callbackDefaultPorts: {xmlrpc: ports.xmlrpc, binrpc: ports.binrpc}}),
            ...(pins === undefined ? {} : {callbackPinned: {...pins}}),
            ...(publish ? {publishCallbackPorts: true} : {}),
        };
    }

    async #setConfig(connection: unknown, options?: ConfigSetOptions): Promise<AppConfig> {
        const previousHost = this.#config.connection.host;
        // Task 34 (#147, D-42): the messages the settings dialog asked about, taken before the
        // reconnect, and only on the save that switches the auto-acknowledge from off to on.
        const existing =
            options?.acknowledgeExisting === true && this.#config.connection.autoAckStickyUnreach !== true
                ? this.#stickyUnreachMessages()
                : [];
        await this.#disconnect();
        const config = this.#withHostFacts(await this.#config.setConnection(connection));
        this.#rpcLog.setRpcLogFolder(config.connection.rpcLogFolder);
        if (config.connection.host !== previousHost) {
            await this.#caches.flush();
            this.#caches = new CacheStore({
                cacheDir: this.#config.cacheDir,
                ...(this.#options.now === undefined ? {} : {now: this.#options.now}),
                ...(this.#options.cacheWriteDelayMs === undefined
                    ? {}
                    : {writeDelayMs: this.#options.cacheWriteDelayMs}),
            });
            await this.#caches.load();
        }
        this.events.emit('config.changed', config);
        if (!this.#stopped && validateConnection(config.connection).length === 0) {
            await this.#connect();
            // after the reconnect, because a write needs the interface; not awaited, so the
            // settings dialog closes as quickly as ever and the writes show up in the RPC log
            if (
                existing.length > 0 &&
                config.connection.autoAckStickyUnreach === true &&
                config.connection.host === previousHost
            ) {
                void this.#acknowledgeExisting(existing);
            }
        }
        return config;
    }

    /**
     * Task 34: the `STICKY_UNREACH` messages in the list, without HmIP's.
     *
     * D-42 says nothing is acknowledged on HmIP: hmipserver has no such flag on real hardware, and
     * where one appears anyway (a simulator, a future firmware) this is not the switch that should
     * start writing to those devices.
     */
    #stickyUnreachMessages(): ServiceMessage[] {
        const states = this.#manager?.states() ?? [];
        return this.#caches.listServiceMessages().filter((message) => {
            if (message.datapoint !== 'STICKY_UNREACH' || message.value === false) {
                return false;
            }
            const type = states.find((state) => state.name === message.interfaceName)?.type ?? '';
            return !isHmipInterface(message.interfaceName, type);
        });
    }

    /**
     * Task 34 (#147, D-42): acknowledges the messages that were in the list when the option was
     * switched on, one after another, each with exactly the write of the acknowledge button
     * (`#acknowledge`, the paced `setValue`). A message that is gone by now - the device came back
     * and somebody acknowledged it, or the edge above got there first - is skipped rather than
     * written twice. A failure is a notice and the write log's red line, as for the edge.
     */
    async #acknowledgeExisting(messages: readonly ServiceMessage[]): Promise<void> {
        for (const message of messages) {
            const listed = this.#caches
                .listServiceMessages(message.interfaceName)
                .some((entry) => entry.address === message.address && entry.datapoint === message.datapoint);
            if (!listed || this.#stopped) {
                continue;
            }
            try {
                await this.#acknowledge(message.interfaceName, message.address, message.datapoint);
            } catch (error) {
                this.#notice(
                    'info',
                    `${message.address}: STICKY_UNREACH could not be acknowledged: ${errorMessage(error)}`,
                    message.interfaceName,
                );
            }
        }
    }

    /**
     * B-53: a callback address set at start (task 38) or inside a container is taken as it is - the
     * Docker host's address is none of the container's, and it is still the right one.
     */
    #keepsConfiguredCallbackIp(): boolean {
        return this.#options.inContainer === true || this.#config.callbackPins?.ip === true;
    }

    #network(): CallbackNetwork {
        if (this.#options.network !== undefined) {
            return this.#options.network;
        }
        const injected = this.#options.localAddresses;
        return injected === undefined ? systemNetwork() : staticNetwork(injected);
    }

    /** B-53: `config.callbackAddresses` - for the host being typed, or the configured one. */
    async #callbackAddresses(host: unknown): Promise<CallbackAddressInfo> {
        const {connection} = this.#config;
        const target = typeof host === 'string' ? host.trim() : connection.host;
        const info = await describeCallbackAddresses(target, this.#network(), connection.local === true);
        return this.#keepsConfiguredCallbackIp() ? {...info, keepsConfigured: true} : info;
    }

    async #discover(): Promise<AppConfig['discovered']> {
        const discover = this.#options.discover ?? ((options) => discoverCcus(options));
        const found = await discover({tls: this.#config.connection.tls});
        this.#config.setDiscovered(found);
        this.events.emit('config.changed', this.#withHostFacts(this.#config.config));
        return found;
    }

    async #clearCaches(): Promise<null> {
        await this.#caches.clear();
        this.#methodCache.clear();
        this.events.emit('names.changed', {});
        this.events.emit('serviceMessages.changed', []);
        for (const interfaceName of this.#manager?.names() ?? []) {
            this.events.emit('devices.changed', {interfaceName, kind: 'refreshed', addresses: []});
        }
        return null;
    }

    /*
     * devices
     */

    async #listDevices(interfaceName: string, options?: {refresh?: boolean}): Promise<DeviceDescription[]> {
        if (options?.refresh === true || !this.#caches.devices.has(interfaceName)) {
            await this.#refreshDevices(interfaceName);
        }
        return this.#caches.devices.list(interfaceName);
    }

    async #refreshDevices(interfaceName: string): Promise<DeviceDescription[]> {
        const answer = asDescriptions(await this.#read(interfaceName, 'listDevices', []));
        this.#caches.devices.replace(interfaceName, answer);
        this.#caches.saveDevices();
        this.events.emit('devices.changed', {
            interfaceName,
            kind: 'refreshed',
            addresses: answer.map((entry) => entry.ADDRESS),
        });
        return answer;
    }

    async #deviceDescription(interfaceName: string, address: string): Promise<DeviceDescription> {
        const cached = this.#caches.devices.get(interfaceName, address);
        if (cached) {
            return cached;
        }
        const answer: unknown = await this.#read(interfaceName, 'getDeviceDescription', [address]);
        if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) {
            throw connectionError(`${interfaceName}: no description for ${address}`);
        }
        return answer as unknown as DeviceDescription;
    }

    async #deleteDevice(interfaceName: string, address: string, flags: number): Promise<null> {
        await this.#write(interfaceName, 'deleteDevice', [address, flags]);
        const removed = this.#caches.devices.remove(interfaceName, [address]);
        this.#caches.saveDevices();
        this.events.emit('devices.changed', {interfaceName, kind: 'deleted', addresses: removed});
        return null;
    }

    async #setInstallMode(interfaceName: string, on: boolean, options?: InstallModeOptions): Promise<null> {
        const effective: InstallModeOptions = {...options};
        if (interfaceName === 'HmIP-RF') {
            // Task 28, measured in the lab: hmipserver's third `setInstallMode` parameter is a String,
            // and `setInstallMode(true, 30, 1)` got an empty HTTP reply and no install mode at all.
            // BidCos's mode integer never reaches HmIP, whoever asks for it.
            delete effective.mode;
        }
        for (const call of installModeCalls(on, effective)) {
            await this.#write(interfaceName, call.method, call.params);
        }
        return null;
    }

    /*
     * names
     */

    async #setNames(entries: readonly {address: string; name: string}[]): Promise<NameMap> {
        const written = this.#caches.names.set(entries);
        this.#caches.saveNames();
        // task 27: with ReGa as the metadata store the provider writes the rename itself, and a
        // second `Name()` through the name service would be the same script twice - but only for
        // the objects the provider holds, and only while ReGa answers it; anything else still goes
        // the way it always did (found by the e2e suite: a rename lost for good is worse than one
        // script twice)
        const meta = this.#meta;
        const held = meta?.kind === 'rega' && meta.state().reachable ? meta.document().objects : undefined;
        const throughNames =
            held === undefined
                ? written
                : written.filter((entry) => {
                      const ref = meta?.refFor(entry.address);
                      return ref === undefined || !(ref in held);
                  });
        if (throughNames.length > 0) {
            await this.#rega?.rename(throughNames);
        }
        // D-40: and into the metadata store, which on an openccu-lite box is the box's own. The
        // local cache is written first either way, so a store that refuses the write still leaves
        // the name where the user typed it - and the refusal is reported rather than swallowed.
        await this.#meta?.setNames(written);
        const names = this.#caches.names.all();
        this.events.emit('names.changed', names);
        return names;
    }

    /*
     * the metadata store (D-40)
     */

    /** The state, even before a connection exists - the settings dialog asks for it either way. */
    #metaState(): MetaState {
        return (
            this.#meta?.state() ?? {
                provider:
                    this.#config.connection.metaProvider === 'occulite' ||
                    this.#config.connection.metaProvider === 'rega'
                        ? this.#config.connection.metaProvider
                        : 'local',
                reachable: false,
                writable: false,
                revision: 0,
                objects: 0,
            }
        );
    }

    #metaSnapshot(): MetaSnapshot {
        const meta = this.#meta;
        return {
            state: this.#metaState(),
            enums: (meta?.enums() as Record<string, MetaEnum> | undefined) ?? {},
            objects: meta?.objects() ?? {},
        };
    }

    /**
     * The store, or a typed refusal.
     *
     * There is no connection without one - `#connect` always builds a provider, the `local` one
     * when there is no box - so this only fires before the first connect, which is exactly when a
     * UI should be told "not connected" rather than shown an empty taxonomy.
     */
    async #requireMeta(): Promise<MetaService> {
        await this.#metaReady?.catch(() => undefined);
        if (!this.#meta) {
            throw configError('the metadata store is not open yet: connect to a system first');
        }
        return this.#meta;
    }

    /*
     * the heating groups of openccu-lite (task 57)
     */

    /**
     * The client for the box's groups API, or `undefined` where there is no box. Built per call: it
     * is a handful of closures over the store's URL and credential, and the credential changes
     * when the person's session arrives (`noteMetaSession`).
     */
    async #groupsClient(): Promise<HeatingGroupsClient | undefined> {
        await this.#metaReady?.catch(() => undefined);
        const meta = this.#meta;
        const baseUrl = meta?.boxUrl;
        if (meta === undefined || baseUrl === undefined) {
            return undefined;
        }
        return new HeatingGroupsClient({
            baseUrl,
            credential: () => meta.boxCredential(),
            ...(this.#options.metaOptions?.fetch === undefined ? {} : {fetch: this.#options.metaOptions.fetch}),
        });
    }

    /** `groups.state`: no box is an answer, not an error - it is what every CCU says. */
    async #groupsState(): Promise<HeatingGroupsState> {
        const client = await this.#groupsClient();
        if (client === undefined) {
            return {available: false, reason: 'no-box'};
        }
        return client.probe();
    }

    async #requireGroups(): Promise<HeatingGroupsClient> {
        const client = await this.#groupsClient();
        if (client === undefined) {
            throw configError(
                'heating groups are edited on openccu-lite only: this connection is not to such a system',
            );
        }
        return client;
    }

    /*
     * paramsets
     */

    async #getParamset(interfaceName: string, address: string, paramset: string): Promise<Paramset> {
        const answer: unknown = await this.#read(interfaceName, 'getParamset', [address, paramset]);
        const values: Record<string, ParamsetValue> = {};
        if (typeof answer === 'object' && answer !== null && !Array.isArray(answer)) {
            for (const [name, value] of Object.entries(answer)) {
                if (isScalar(value)) {
                    values[name] = value;
                }
            }
        }
        if (interfaceName === 'HmIP-RF' && address.endsWith(':0')) {
            this.#applyHmipMaintenance(interfaceName, address, values);
        }
        return values;
    }

    /**
     * The paramset description, from the cache where the identity is known.
     *
     * A link paramset is addressed by the peer's address; it is cached under the identity of the
     * channel with the paramset name `LINK`, because the link paramset of a channel does not depend
     * on which peer it is written for.
     */
    async #describe(interfaceName: string, address: string, paramset: string): Promise<ParamsetDescription> {
        const index = this.#caches.devices.index(interfaceName);
        const description = index.get(address);
        const isLink = paramset !== 'MASTER' && paramset !== 'VALUES' && paramset !== 'SERVICE';
        const identity = description
            ? this.#caches.descriptions.identity(
                  interfaceName,
                  description,
                  isLink ? 'LINK' : paramset,
                  index.parentOf(address),
              )
            : undefined;
        const cached = this.#caches.descriptions.get(identity);
        if (cached) {
            return cached;
        }
        // eQ-3 takes MASTER/VALUES/LINK here, never a peer address - that is only a paramset *key*
        const answer: unknown = await this.#read(interfaceName, 'getParamsetDescription', [
            address,
            isLink ? 'LINK' : paramset,
        ]);
        if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) {
            throw connectionError(`${interfaceName}: no paramset description for ${address} ${paramset}`);
        }
        const fetched = answer as unknown as ParamsetDescription;
        this.#caches.descriptions.set(identity, fetched);
        if (this.#caches.descriptions.dirty) {
            this.#caches.saveDescriptions();
        }
        return fetched;
    }

    /*
     * radio, service messages, events
     */

    async #rssi(interfaceName: string): Promise<RssiInfo> {
        const store = this.#caches.rssi(interfaceName);
        if (interfaceName !== 'HmIP-RF') {
            store.applyRssiInfo(asRssiRaw(await this.#read(interfaceName, 'rssiInfo', [])));
        }
        const matrix: RssiInfo = {};
        for (const [address, peers] of Object.entries(store.toJSON())) {
            const row: Record<string, [number, number]> = {};
            for (const [peer, pair] of Object.entries(peers)) {
                row[peer] = [pair.rx ?? RSSI_UNKNOWN, pair.tx ?? RSSI_UNKNOWN];
            }
            matrix[address] = row;
        }
        return matrix;
    }

    #serviceMessages(interfaceName?: string): ServiceMessage[] {
        return this.#caches.listServiceMessages(interfaceName);
    }

    /**
     * Issue #146: what the refresh button of the service-message tab asks for.
     *
     * The list itself comes out of the cache, which the events and a five-minute poll keep up to
     * date; pressing refresh re-read that cache and therefore changed nothing at all - "Refresh
     * Button ohne Funktion". This makes the round trip the button promises: `getServiceMessages`
     * on every connected interface that has the method, and the `:0` sweep on HmIP, which is where
     * its messages come from. Failures are notices, as everywhere else here - an interface that
     * does not answer must not turn the button into an error dialog.
     */
    async #refreshAllServiceMessages(interfaceName?: string): Promise<ServiceMessage[]> {
        const names = (this.#manager?.names() ?? []).filter(
            (name) =>
                (interfaceName === undefined || name === interfaceName) && this.#manager?.isConnected(name) === true,
        );
        for (const name of names) {
            if (name === 'HmIP-RF') {
                await this.sweepHmip(name);
            } else {
                await this.#refreshServiceMessages(name);
            }
        }
        return this.#serviceMessages(interfaceName);
    }

    /**
     * Does it make sense to ask this interface for its service messages?
     *
     * The built-in answer comes from the core's table: hmipserver has no `getServiceMessages` (the
     * HmIP sweep below reads the `:0` channels instead), the group process behind `VirtualDevices`
     * answers it with invalid XML-RPC, and CUxD with a fault and a warning in the CCU's syslog
     * (B-26, #158). A user-defined interface is judged by its own `system.listMethods` where that
     * gives a list, and is otherwise asked once and then remembered for this session - see
     * {@link isMethodUnsupported}.
     */
    async #hasServiceMessages(interfaceName: string): Promise<boolean> {
        if (this.#noServiceMessages.has(interfaceName)) {
            return false;
        }
        if (this.#manager?.resolved(interfaceName)?.serviceMessages === false) {
            return false;
        }
        // the table is measured for the built-in processes; asking rfd for its method list after
        // every `init` would buy nothing
        if (isKnownInterface(interfaceName)) {
            return true;
        }
        const listed = await this.#methodList(interfaceName);
        return listed === undefined || listed.has('getServiceMessages');
    }

    /**
     * B-26 (#158): the methods a user-defined interface lists in `system.listMethods`, or
     * `undefined` when it gave no usable list.
     *
     * Asked once and shared by concurrent callers; the answer is dropped when the interface
     * subscribes again. A process that does not have `system.listMethods` either is remembered for
     * the connection, so it is not asked after every re-`init`; any other failure is forgotten, and
     * the next caller asks again.
     */
    #methodList(interfaceName: string): Promise<ReadonlySet<string> | undefined> {
        if (this.#noListMethods.has(interfaceName)) {
            return Promise.resolve(undefined);
        }
        const cached = this.#listedMethods.get(interfaceName);
        if (cached) {
            return cached;
        }
        const pending: Promise<ReadonlySet<string> | undefined> = this.#read(
            interfaceName,
            'system.listMethods',
            [],
        ).then(
            (answer) => {
                const names = asStrings(answer);
                return names.length === 0 ? undefined : new Set(names);
            },
            (error: unknown) => {
                if (isMethodUnsupported(error)) {
                    this.#noListMethods.add(interfaceName);
                }
                if (this.#listedMethods.get(interfaceName) === pending) {
                    this.#listedMethods.delete(interfaceName);
                }
                return undefined;
            },
        );
        this.#listedMethods.set(interfaceName, pending);
        return pending;
    }

    /** Reads the BidCos service messages of one interface into the store. */
    async #refreshServiceMessages(interfaceName: string): Promise<void> {
        if (!(await this.#hasServiceMessages(interfaceName))) {
            return;
        }
        try {
            const answer = await this.#read(interfaceName, 'getServiceMessages', []);
            if (this.#serviceMessageFailures.delete(interfaceName)) {
                this.#notice('info', `${interfaceName}: getServiceMessages answers again`, interfaceName);
            }
            if (!Array.isArray(answer)) {
                return;
            }
            const tuples: [string, string, ParamsetValue][] = [];
            for (const entry of answer) {
                if (
                    Array.isArray(entry) &&
                    typeof entry[0] === 'string' &&
                    typeof entry[1] === 'string' &&
                    isScalar(entry[2])
                ) {
                    tuples.push([entry[0], entry[1], entry[2]]);
                }
            }
            this.#caches.serviceMessages.replaceInterface(interfaceName, tuples);
            this.events.emit('serviceMessages.changed', this.#caches.listServiceMessages());
            // #26: a sticky flag can be raised while nothing was listening, so the poll counts too.
            // `note()` is edge-triggered, so the same flag on every round is one outage.
            for (const [address, datapoint, value] of tuples) {
                this.#noteUnreach(interfaceName, address, datapoint, value);
            }
        } catch (error) {
            // "you do not have this method" is not a failure worth a line - and worth even less
            // once a minute, which is what the re-`init` of an interface that sends no events made
            // of it on hardware (task 17). Remembered, and never asked again this session.
            if (isMethodUnsupported(error)) {
                this.#noServiceMessages.add(interfaceName);
                this.#serviceMessageFailures.delete(interfaceName);
                return;
            }
            // B-26 (#158): once per interface until a call succeeds again, not once per poll
            if (this.#serviceMessageFailures.has(interfaceName)) {
                return;
            }
            this.#serviceMessageFailures.add(interfaceName);
            this.#notice('info', `${interfaceName}: getServiceMessages failed: ${errorMessage(error)}`, interfaceName);
        }
    }

    #startServiceMessagePolling(): void {
        const interval = this.#options.serviceMessagePollMs ?? SERVICE_MESSAGE_POLL_MS;
        if (interval <= 0) {
            return;
        }
        const timer = setInterval(() => {
            void runWithOrigin('background', () => this.pollServiceMessages());
        }, interval);
        if (typeof timer.unref === 'function') {
            timer.unref();
        }
        this.#serviceMessageTimer = timer;
    }

    /** One polling round; public so a test does not have to wait five minutes. */
    async pollServiceMessages(): Promise<void> {
        for (const interfaceName of this.#manager?.names() ?? []) {
            if (this.#manager?.isConnected(interfaceName) === true) {
                // `#refreshServiceMessages` decides whether the interface has the method at all
                await this.#refreshServiceMessages(interfaceName);
            }
        }
    }

    /**
     * The HmIP sweep of 2.x (`hmipGetRssi`): hmipserver reports neither `rssiInfo` nor
     * `getServiceMessages`, so both are read out of the `VALUES` paramset of every `:0` channel.
     * Debounced, because the device list arrives in bursts, and sequential, so a CCU with 200 HmIP
     * devices is not hit with 200 parallel calls.
     */
    #scheduleHmipSweep(): void {
        if (this.#hmipSweepTimer !== undefined) {
            clearTimeout(this.#hmipSweepTimer);
        }
        const timer = setTimeout(() => {
            this.#hmipSweepTimer = undefined;
            void runWithOrigin('background', () => this.sweepHmip());
        }, this.#options.hmipSweepDelayMs ?? HMIP_SWEEP_DELAY_MS);
        if (typeof timer.unref === 'function') {
            timer.unref();
        }
        this.#hmipSweepTimer = timer;
    }

    /** One sweep; public so a test can run it without the timer. */
    async sweepHmip(interfaceName = 'HmIP-RF'): Promise<void> {
        if (this.#hmipSweepRunning || this.#stopped || this.#manager?.isConnected(interfaceName) !== true) {
            return;
        }
        this.#hmipSweepRunning = true;
        let changed = false;
        try {
            for (const description of this.#caches.devices.list(interfaceName)) {
                if (!description.ADDRESS.endsWith(':0')) {
                    continue;
                }
                try {
                    const values = await this.#getParamset(interfaceName, description.ADDRESS, 'VALUES');
                    changed = this.#applyHmipMaintenance(interfaceName, description.ADDRESS, values) || changed;
                } catch {
                    // a device that is not reachable simply has no values; the sweep goes on
                }
            }
        } finally {
            this.#hmipSweepRunning = false;
        }
        if (changed) {
            this.events.emit('serviceMessages.changed', this.#caches.listServiceMessages());
        }
    }

    /**
     * Files the RSSI, the service messages and the unreach state of a `getParamset(<device>:0,
     * VALUES)` answer.
     *
     * Task 34 (B-9): the unreach state goes through `#noteUnreach` like the BidCos poll's, so the
     * Funk tab counts the outages of HmIP devices that no event reported. `UNREACH` is what says
     * whether the device is away now; `STICKY_UNREACH` is only read where there is no `UNREACH`,
     * because a standing sticky flag next to `UNREACH: false` would count the same outage again on
     * every sweep. Nothing is acknowledged from here: a sweep is a read, and HmIP has nothing to
     * acknowledge (D-42).
     */
    #applyHmipMaintenance(interfaceName: string, address: string, values: Paramset): boolean {
        const device = address.split(':')[0] ?? address;
        this.#caches.rssi(interfaceName).applyHmipParamset(device, values);
        const changed = this.#caches.serviceMessages.applyParamset(interfaceName, address, values);
        const datapoint = 'UNREACH' in values ? 'UNREACH' : 'STICKY_UNREACH';
        const value = values[datapoint];
        if (value !== undefined) {
            this.#noteUnreach(interfaceName, address, datapoint, value, {acknowledge: false});
        }
        return changed;
    }

    /**
     * Acknowledging a service message writes its datapoint. An `ACTION` is confirmed with `true`,
     * everything else - `STICKY_UNREACH` and its relatives - with `false`.
     */
    async #acknowledge(interfaceName: string, address: string, datapoint: string): Promise<null> {
        if (!isAcknowledgeable(datapoint)) {
            throw validationError(`${datapoint} cannot be acknowledged`);
        }
        const description = await this.#describe(interfaceName, address, 'VALUES');
        const parameter = description[datapoint];
        const value: RpcWriteValue = parameter?.TYPE === 'ACTION';
        await this.#writer.setValue(interfaceName, address, datapoint, value);
        if (this.#caches.serviceMessages.clear(interfaceName, address, datapoint)) {
            this.events.emit('serviceMessages.changed', this.#caches.listServiceMessages());
        }
        // Issue #94: the datapoint write above is the acknowledgement that matters, and it happened
        // whether ReGa exists or not. This clears the CCU's own alarm on top, so the WebUI stops
        // showing a message the user has already dealt with here. D-2: silent when ReGa is off.
        void this.#rega?.acknowledgeAlarm(interfaceName, address, datapoint);
        return null;
    }

    #recentEvents(interfaceName?: string, limit?: number): EventRecord[] {
        const all = this.#caches.events.toArray();
        const filtered =
            interfaceName === undefined ? all : all.filter((entry) => entry.interfaceName === interfaceName);
        return limit === undefined || limit >= filtered.length ? filtered : filtered.slice(filtered.length - limit);
    }

    /*
     * the console
     */

    /** `rpc.call`: anything the user typed. A write goes through the queue and into the log. */
    async #consoleCall(interfaceName: string, method: string, params: RpcValue[]): Promise<RpcValue> {
        if (typeof method !== 'string' || method === '') {
            throw validationError('no method given');
        }
        return isWriteMethod(method)
            ? this.#write(interfaceName, method, params)
            : this.#read(interfaceName, method, params);
    }

    /**
     * The method catalogue of an interface: its own `system.listMethods` merged with the core's
     * documented catalogue, plus whatever `system.methodHelp` adds. Cached per interface for the
     * session - it is 50 round trips and the answer does not change while a process runs.
     */
    async #methods(interfaceName: string): Promise<RpcMethodInfo[]> {
        const cached = this.#methodCache.get(interfaceName);
        if (cached) {
            return cached;
        }
        let names: string[];
        try {
            names = asStrings(await this.#read(interfaceName, 'system.listMethods', []));
        } catch {
            names = [...RPC_METHOD_NAMES];
        }
        if (names.length === 0) {
            names = [...RPC_METHOD_NAMES];
        }
        // Which slot the interface's own `system.methodHelp` text goes into, not a UI language: the
        // shipped catalogue is the German eQ-3 specification and an interface process answers in
        // the CCU's language, so an unset or `auto` profile keeps German here (D-36 is about the
        // UI, which asks for its own texts through the catalogue in `packages/core`).
        const configured = this.#config.connection.language;
        const language: Language = configured === undefined || configured === 'auto' ? 'de' : configured;
        const methods = await Promise.all(
            methodsFor(names).map(async (method) => {
                let merged = method;
                try {
                    const help = await this.#read(interfaceName, 'system.methodHelp', [method.name]);
                    if (typeof help === 'string' && help !== '') {
                        merged = mergeMethodHelp(method.name, help, language);
                    }
                } catch {
                    // an interface without methodHelp keeps the shipped text
                }
                const info: RpcMethodInfo = {
                    name: merged.name,
                    ...(merged.help[language] === undefined ? {} : {help: merged.help[language]}),
                    params: merged.params.map((parameter) => ({
                        name: parameter.name,
                        type: parameter.type,
                        ...(parameter.optional === undefined ? {} : {optional: true}),
                        ...(parameter.values === undefined ? {} : {values: Object.values(parameter.values)}),
                    })),
                };
                return info;
            }),
        );
        this.#methodCache.set(interfaceName, methods);
        return methods;
    }

    #notice(level: 'debug' | 'info' | 'warn' | 'error', message: string, interfaceName?: string): void {
        this.events.emit('notice', {
            level,
            message,
            ...(interfaceName === undefined ? {} : {interfaceName}),
        });
    }
}

/*
 * the shapes an interface answers with, checked rather than trusted
 */

/** An XML-RPC struct, as opposed to an array or a scalar. */
function isStruct(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is ParamsetValue {
    return typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string';
}

function asStrings(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function asBooleans(value: unknown): boolean[] {
    return Array.isArray(value) ? value.map((entry) => Boolean(entry)) : [];
}

function asDescriptions(value: unknown): DeviceDescription[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const descriptions: DeviceDescription[] = [];
    for (const entry of value) {
        if (isStruct(entry) && typeof entry['ADDRESS'] === 'string') {
            // #143: the list fields of a description are made into lists here, once, for every
            // interface - the group process sends `PARAMSETS` as a string on some boxes.
            descriptions.push(normaliseDescription(entry as unknown as DeviceDescription));
        }
    }
    return descriptions;
}

function asLinks(value: unknown): LinkRecord[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const links: LinkRecord[] = [];
    for (const entry of value) {
        if (isStruct(entry) && typeof entry['SENDER'] === 'string' && typeof entry['RECEIVER'] === 'string') {
            links.push(withLinkText(entry as unknown as LinkRecord));
        }
    }
    return links;
}

function asLink(value: unknown, sender: string, receiver: string): LinkRecord {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return withLinkText({SENDER: sender, RECEIVER: receiver, ...(value as unknown as Partial<LinkRecord>)});
    }
    return {SENDER: sender, RECEIVER: receiver};
}

/**
 * B-23 (#156): a link's `NAME` and `DESCRIPTION` are UTF-8 in rfd - the WebUI's default description
 * "Standardverknüpfung" and our own `setLinkInfo` alike - and the XML-RPC client reads them as
 * ISO-8859-1. Repaired here, once, for both reads; a BIN-RPC answer (its library decodes UTF-8) and
 * a real ISO-8859-1 text pass through unchanged.
 */
function withLinkText(link: LinkRecord): LinkRecord {
    return {
        ...link,
        ...(typeof link.NAME === 'string' ? {NAME: repairMisdecodedUtf8(link.NAME)} : {}),
        ...(typeof link.DESCRIPTION === 'string' ? {DESCRIPTION: repairMisdecodedUtf8(link.DESCRIPTION)} : {}),
    };
}

function asBidcosInterfaces(value: unknown): BidcosInterfaceInfo[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const interfaces: BidcosInterfaceInfo[] = [];
    for (const entry of value) {
        if (isStruct(entry) && typeof entry['ADDRESS'] === 'string') {
            interfaces.push(entry as unknown as BidcosInterfaceInfo);
        }
    }
    return interfaces;
}

function asRssiRaw(value: unknown): Record<string, Record<string, unknown[]>> {
    const raw: Record<string, Record<string, unknown[]>> = {};
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return raw;
    }
    for (const [address, peers] of Object.entries(value as Record<string, unknown>)) {
        if (typeof peers !== 'object' || peers === null || Array.isArray(peers)) {
            continue;
        }
        const row: Record<string, unknown[]> = {};
        for (const [peer, pair] of Object.entries(peers)) {
            if (Array.isArray(pair)) {
                row[peer] = pair;
            }
        }
        raw[address] = row;
    }
    return raw;
}

/** Re-exported so a host can name the maintenance channel without importing the core. */
export {maintenanceAddress};

/** The methods of the contract, for a transport that wants to validate a frame. */
export const API_METHOD_NAMES: readonly ApiMethodName[] = [
    'config.get',
    'config.set',
    'config.discover',
    'config.clearCaches',
    'config.callbackAddresses',
    'interfaces.list',
    'interfaces.reconnect',
    'rega.state',
    'devices.list',
    'devices.description',
    'devices.delete',
    'devices.replace',
    'devices.reportValueUsage',
    'devices.restoreConfig',
    'devices.clearConfigCache',
    'devices.repairConfig',
    'devices.updateFirmware',
    'devices.installFirmware',
    'devices.installMode.set',
    'devices.installMode.get',
    'devices.replaceable',
    'names.get',
    'names.set',
    'groups.state',
    'groups.list',
    'groups.types',
    'groups.get',
    'groups.create',
    'groups.update',
    'groups.delete',
    'meta.state',
    'meta.get',
    'meta.enums',
    'meta.objects',
    'meta.setMembership',
    'meta.assign',
    'meta.enum.create',
    'meta.enum.update',
    'meta.enum.delete',
    'meta.node.create',
    'meta.node.update',
    'meta.node.delete',
    'meta.refresh',
    'meta.pairing',
    'meta.export',
    'meta.import',
    'paramset.get',
    'paramset.description',
    'paramset.put',
    'paramset.putLink',
    'value.set',
    'value.get',
    'links.list',
    'links.add',
    'links.remove',
    'links.info.get',
    'links.info.set',
    'links.activate',
    'links.peers',
    'rssi.get',
    'bidcos.interfaces',
    'bidcos.setInterface',
    'teams.list',
    'teams.set',
    'rega.confirmInbox',
    'linkTemplates.list',
    'linkTemplates.save',
    'linkTemplates.remove',
    'unreach.list',
    'unreach.reset',
    'serviceMessages.list',
    'serviceMessages.refresh',
    'serviceMessages.ack',
    'events.recent',
    'events.clear',
    'rpc.call',
    'rpc.methods',
    'write.cancel',
    'rpcLog.list',
    'rpcLog.clear',
    'data.file',
    'session.info',
] satisfies readonly (keyof ApiMethods)[];
