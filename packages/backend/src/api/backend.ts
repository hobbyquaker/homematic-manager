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

import {
    RPC_METHOD_NAMES,
    RSSI_UNKNOWN,
    countsAsServiceMessage,
    isAcknowledgeable,
    maintenanceAddress,
    mergeMethodHelp,
    methodsFor,
    type AppConfig,
    type ApiEventName,
    type ApiEvents,
    type ApiMethodName,
    type ApiMethods,
    type ApiParams,
    type ApiResult,
    type BidcosInterfaceInfo,
    type DeviceDescription,
    type EventRecord,
    type InstallModeOptions,
    type LinkRecord,
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
} from '@homematic-manager/core';

import {CacheStore} from '../cache/store.js';
import {ConfigStore, type ConfigStoreOptions} from '../config/store.js';
import {validateConnection, writePaceFor} from '../config/defaults.js';
import {DataFileServer} from '../data/files.js';
import {installModeCalls} from '../devices/installMode.js';
import {discoverCcus, type DiscoverOptions} from '../discovery/discover.js';
import {BackendError, configError, connectionError, errorMessage, internalError, validationError} from '../errors.js';
import {InterfaceManager, firstBidcosInterfaceAddress, type InterfaceManagerOptions} from '../interfaces/manager.js';
import {RegaService, type RegaServiceOptions} from '../rega/client.js';
import type {RpcCallRecord, RpcOutValue} from '../rpc/client.js';
import {listDevicesAnswer, type CallbackHandler} from '../rpc/server.js';
import {ApiEventEmitter} from '../util/emitter.js';
import {WriteLog} from '../write/log.js';
import {isWriteMethod} from '../write/log.js';
import {ParamsetWriter} from '../write/paramset.js';
import {ConfigRepair} from '../write/repair.js';
import {WriteQueue} from '../write/queue.js';

/** How often the BidCos service messages are polled while the connection is up. */
export const SERVICE_MESSAGE_POLL_MS = 300_000;

/** How long the HmIP `getParamset(:0, VALUES)` sweep waits for the device list to settle. */
export const HMIP_SWEEP_DELAY_MS = 1000;

export interface BackendOptions extends Omit<ConfigStoreOptions, 'version'> {
    /** `AppConfig.version`; the host passes its package version. */
    readonly version?: string;
    /** Roots `data.file` may read from, keyed by the prefix the UI uses. */
    readonly fileRoots?: Readonly<Record<string, string>>;
    readonly callbackHost?: string;
    readonly rpcTimeoutMs?: number;
    readonly watchdogIntervalMs?: number;
    readonly serviceMessagePollMs?: number;
    readonly hmipSweepDelayMs?: number;
    readonly cacheWriteDelayMs?: number;
    readonly now?: () => number;
    /** Injected by the tests in place of the real world. */
    readonly createInterfaceManager?: (options: InterfaceManagerOptions) => InterfaceManager;
    readonly createRega?: (options: RegaServiceOptions) => RegaService;
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
    readonly #writeLog: WriteLog;
    readonly #writer: ParamsetWriter;
    readonly #repair: ConfigRepair;
    readonly #files: DataFileServer;
    readonly #now: () => number;
    readonly #methodCache = new Map<string, RpcMethodInfo[]>();

    #caches: CacheStore;
    #manager: InterfaceManager | undefined;
    #rega: RegaService | undefined;
    #serviceMessageTimer: ReturnType<typeof setInterval> | undefined;
    #hmipSweepTimer: ReturnType<typeof setTimeout> | undefined;
    #hmipSweepRunning = false;
    #stopped = false;

    private constructor(options: BackendOptions, config: ConfigStore, caches: CacheStore) {
        this.#options = options;
        this.#config = config;
        this.#caches = caches;
        this.#now = options.now ?? (() => Date.now());
        this.events = new ApiEventEmitter((event, error) => {
            // an event handler of the UI must not be able to break the backend
            process.emitWarning(`handler of ${event} threw: ${errorMessage(error)}`);
        });
        this.#queue = new WriteQueue({
            paceFor: (interfaceName) => writePaceFor(interfaceName, this.#config.connection.writePaceMs),
        });
        this.#writeLog = new WriteLog({
            file: config.cacheFile('write-log.json'),
            rpcLogFolder: config.connection.rpcLogFolder,
            onAppended: (entry) => {
                this.events.emit('writeLog.appended', entry);
            },
            onError: (error) => {
                this.#notice('warn', `write log: ${errorMessage(error)}`);
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
        await backend.#writeLog.load();
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
        await this.#caches.flush();
        await this.#writeLog.flush();
        this.events.clear();
    }

    /**
     * The one entry point of the contract. Every rejection is an `ApiError`; the transports put it
     * on the wire unchanged.
     */
    async request<M extends ApiMethodName>(method: M, ...params: ApiParams<M>): Promise<ApiResult<M>> {
        try {
            return await this.#dispatch(method, params);
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
                return this.#setConfig(p[0]);
            case 'config.discover':
                return this.#discover();
            case 'config.clearCaches':
                return this.#clearCaches();

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

            case 'serviceMessages.list':
                return this.#serviceMessages(p[0]);
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
            case 'writeLog.list':
                return this.#writeLog.list(p[0]);
            case 'writeLog.clear':
                this.#writeLog.clear();
                return null;

            case 'data.file':
                return this.#files.read(p[0]);
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

    async #connect(): Promise<void> {
        const connection = this.#config.connection;
        const manager = (this.#options.createInterfaceManager ?? ((options) => new InterfaceManager(options)))({
            connection,
            handler: this.#callbackHandler(),
            onStateChanged: (states) => {
                this.events.emit('interfaces.changed', states);
            },
            onNotice: (level, message, interfaceName) => {
                this.#notice(level, message, interfaceName);
            },
            onConnected: (interfaceName) => this.#onInterfaceConnected(interfaceName),
            onCall: (record) => {
                this.#onCall(record);
            },
            ...(this.#options.callbackHost === undefined ? {} : {callbackHost: this.#options.callbackHost}),
            ...(this.#options.rpcTimeoutMs === undefined ? {} : {rpcTimeoutMs: this.#options.rpcTimeoutMs}),
            ...(this.#options.watchdogIntervalMs === undefined
                ? {}
                : {watchdogIntervalMs: this.#options.watchdogIntervalMs}),
            ...(this.#options.localAddresses === undefined ? {} : {localAddresses: this.#options.localAddresses}),
            ...(this.#options.now === undefined ? {} : {now: this.#options.now}),
            ...this.#options.interfaceManagerOptions,
        });
        this.#manager = manager;

        this.#rega = (this.#options.createRega ?? ((options) => new RegaService(options)))({
            host: connection.host,
            enabled: connection.rega,
            tls: connection.tls,
            auth: connection.auth,
            language: connection.language,
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
        this.#startServiceMessagePolling();
    }

    async #disconnect(): Promise<void> {
        this.#clearTimers();
        this.#queue.cancel();
        await this.#manager?.stop();
        this.#manager = undefined;
        this.#rega = undefined;
        this.#methodCache.clear();
    }

    #clearTimers(): void {
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
            unknownMethod: (methodName) => {
                this.#notice('info', `an interface called the unknown method ${methodName}`);
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
            if (interfaceName === 'HmIP-RF') {
                this.#caches.rssi(interfaceName).applyHmipValue(address.split(':')[0] ?? address, datapoint, value);
            }
        }
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
        this.#writeLog.append(record);
    }

    /** A read: straight to the interface, never queued. */
    async #read(interfaceName: string, method: string, params: readonly RpcOutValue[]): Promise<RpcValue> {
        return this.#requireManager().client(interfaceName).call(method, params);
    }

    /** A write: through the paced queue of that interface. */
    async #write(interfaceName: string, method: string, params: readonly RpcOutValue[]): Promise<RpcValue> {
        const client = this.#requireManager().client(interfaceName);
        return this.#queue.enqueue(interfaceName, () => client.call(method, params));
    }

    /*
     * configuration
     */

    #configWithDetected(): AppConfig {
        return this.#config.config;
    }

    async #setConfig(connection: unknown): Promise<AppConfig> {
        const previousHost = this.#config.connection.host;
        await this.#disconnect();
        const config = await this.#config.setConnection(connection);
        this.#writeLog.setRpcLogFolder(config.connection.rpcLogFolder);
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
        }
        return config;
    }

    async #discover(): Promise<AppConfig['discovered']> {
        const discover = this.#options.discover ?? ((options) => discoverCcus(options));
        const found = await discover({tls: this.#config.connection.tls});
        this.#config.setDiscovered(found);
        this.events.emit('config.changed', this.#config.config);
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
        for (const call of installModeCalls(on, options ?? {})) {
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
        await this.#rega?.rename(written);
        const names = this.#caches.names.all();
        this.events.emit('names.changed', names);
        return names;
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

    /** Reads the BidCos service messages of one interface into the store. */
    async #refreshServiceMessages(interfaceName: string): Promise<void> {
        try {
            const answer = await this.#read(interfaceName, 'getServiceMessages', []);
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
        } catch (error) {
            this.#notice('info', `${interfaceName}: getServiceMessages failed: ${errorMessage(error)}`, interfaceName);
        }
    }

    #startServiceMessagePolling(): void {
        const interval = this.#options.serviceMessagePollMs ?? SERVICE_MESSAGE_POLL_MS;
        if (interval <= 0) {
            return;
        }
        const timer = setInterval(() => {
            void this.pollServiceMessages();
        }, interval);
        if (typeof timer.unref === 'function') {
            timer.unref();
        }
        this.#serviceMessageTimer = timer;
    }

    /** One polling round; public so a test does not have to wait five minutes. */
    async pollServiceMessages(): Promise<void> {
        for (const interfaceName of this.#manager?.names() ?? []) {
            if (interfaceName !== 'HmIP-RF' && this.#manager?.isConnected(interfaceName) === true) {
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
            void this.sweepHmip();
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

    /** Files the RSSI and the service messages of a `getParamset(<device>:0, VALUES)` answer. */
    #applyHmipMaintenance(interfaceName: string, address: string, values: Paramset): boolean {
        const device = address.split(':')[0] ?? address;
        this.#caches.rssi(interfaceName).applyHmipParamset(device, values);
        return this.#caches.serviceMessages.applyParamset(interfaceName, address, values);
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
        const language = this.#config.connection.language;
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

    #notice(level: 'info' | 'warn' | 'error', message: string, interfaceName?: string): void {
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
            descriptions.push(entry as unknown as DeviceDescription);
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
            links.push(entry as unknown as LinkRecord);
        }
    }
    return links;
}

function asLink(value: unknown, sender: string, receiver: string): LinkRecord {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return {SENDER: sender, RECEIVER: receiver, ...(value as unknown as Partial<LinkRecord>)};
    }
    return {SENDER: sender, RECEIVER: receiver};
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
    'serviceMessages.list',
    'serviceMessages.ack',
    'events.recent',
    'events.clear',
    'rpc.call',
    'rpc.methods',
    'write.cancel',
    'writeLog.list',
    'writeLog.clear',
    'data.file',
] satisfies readonly (keyof ApiMethods)[];
