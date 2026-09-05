/**
 * The callback servers the interface processes call back into after `init(url, ident)`.
 *
 * One xmlrpc and one binrpc server, both optional - only the protocols the configured interfaces
 * actually use are started, and a port of `0` lets the operating system pick one (2.x hunted for a
 * free port with `nextport` starting at 2000 and wrote the result into its configuration).
 *
 * Every callback carries the `ident` that was passed to `init` as its first parameter, which is how
 * one server serves every interface; `interfaceNameFromIdent()` maps it back. An unknown method is
 * answered with an empty string and reported, never with a fault: an interface process that gets a
 * fault from its logic layer may drop the subscription.
 *
 * `listDevices` is answered from our own device cache, in the reduced shape 2.x sent for HmIP
 * (`main.js:494-545`): hmipserver compares the list it gets with its own and re-sends what is
 * missing, and sending back the full description of 400 channels over XML-RPC is both slow and, for
 * the `HmIP-RCV-50` pseudo-device, wrong.
 */

import binrpc from 'binrpc';
import xmlrpc from 'homematic-xmlrpc';

import {interfaceNameFromIdent, type DeviceDescription, type RpcProtocol, type RpcValue} from '@homematic-manager/core';

import {connectionError, errorMessage} from '../errors.js';

/** What the backend does with an incoming callback. Every method may be async. */
export interface CallbackHandler {
    event(interfaceName: string, address: string, datapoint: string, value: RpcValue): void;
    newDevices(interfaceName: string, devices: DeviceDescription[]): void;
    deleteDevices(interfaceName: string, addresses: string[]): void;
    replaceDevice(interfaceName: string, oldAddress: string, newAddress: string): void;
    readdedDevice(interfaceName: string, addresses: string[]): void;
    updateDevice(interfaceName: string, address: string, hint: number): void;
    /** The answer to `listDevices`, from the device cache. */
    listDevices(interfaceName: string): RpcValue[];
    /** A method we do not implement; answered with an empty string anyway. */
    unknownMethod?(method: string, params: RpcValue[]): void;
}

/** The callback methods this server answers, in the order `system.listMethods` returns them. */
export const CALLBACK_METHODS: readonly string[] = [
    'system.multicall',
    'system.listMethods',
    'event',
    'newDevices',
    'deleteDevices',
    'replaceDevice',
    'readdedDevice',
    'updateDevice',
    'listDevices',
];

/**
 * The subset of a device description hmipserver needs in the `listDevices` answer, exactly as 2.x
 * built it. Falsy fields are dropped, and the CCU's own `HmIP-RCV-50` never appears.
 */
const HMIP_LIST_DEVICES_FIELDS: readonly (keyof DeviceDescription)[] = [
    'ADDRESS',
    'VERSION',
    'AES_ACTIVE',
    'CHILDREN',
    'DIRECTION',
    'FIRMWARE',
    'FLAGS',
    'GROUP',
    'INDEX',
    'INTERFACE',
    'LINK_SOURCE_ROLES',
    'LINK_TARGET_ROLES',
    'PARAMSETS',
    'PARENT',
    'PARENT_TYPE',
    'RF_ADDRESS',
    'ROAMING',
    'RX_MODE',
    'TEAM',
    'TEAM_CHANNELS',
    'TEAM_TAG',
    'TYPE',
];

/** The reduced HmIP shape of one description; `undefined` for a device that must not be listed. */
export function hmipListDevicesEntry(description: DeviceDescription): Record<string, RpcValue> | undefined {
    if (description.TYPE === 'HmIP-RCV-50' || description.PARENT_TYPE === 'HmIP-RCV-50') {
        return undefined;
    }
    const entry: Record<string, RpcValue> = {};
    for (const field of HMIP_LIST_DEVICES_FIELDS) {
        const value = description[field] as unknown;
        // 2.x drops every falsy field, which is what keeps the answer small
        if (value !== undefined && value !== '' && value !== 0 && value !== false && value !== null) {
            entry[field] = value as RpcValue;
        }
    }
    return entry;
}

/** The `listDevices` answer for one interface: full descriptions, reduced entries for HmIP. */
export function listDevicesAnswer(interfaceName: string, descriptions: readonly DeviceDescription[]): RpcValue[] {
    if (interfaceName !== 'HmIP-RF') {
        return descriptions.map((description) => ({ADDRESS: description.ADDRESS, VERSION: description.VERSION ?? 0}));
    }
    const answer: RpcValue[] = [];
    for (const description of descriptions) {
        const entry = hmipListDevicesEntry(description);
        if (entry) {
            answer.push(entry);
        }
    }
    return answer;
}

export interface CallbackServerOptions {
    readonly protocol: RpcProtocol;
    /** Interface to bind to; `0.0.0.0` unless the host says otherwise (the addon binds loopback). */
    readonly host?: string;
    /** `0` lets the operating system pick a free port. */
    readonly port: number;
    readonly handler: CallbackHandler;
    /** Reported, never thrown: a callback that fails must not take the server down. */
    readonly onError?: (error: unknown) => void;
}

/** One callback server. Start it, read `port`, put that into the `init` URL. */
export class CallbackServer {
    readonly protocol: RpcProtocol;
    readonly host: string;

    readonly #handler: CallbackHandler;
    readonly #requestedPort: number;
    readonly #onError: (error: unknown) => void;

    #port = 0;
    #xmlrpcServer: ReturnType<typeof xmlrpc.createServer> | undefined;
    #binrpcServer: ReturnType<typeof binrpc.createServer> | undefined;

    constructor(options: CallbackServerOptions) {
        this.protocol = options.protocol;
        this.host = options.host ?? '0.0.0.0';
        this.#requestedPort = options.port;
        this.#handler = options.handler;
        this.#onError = options.onError ?? (() => undefined);
    }

    /** The port the server actually listens on; 0 until it is started. */
    get port(): number {
        return this.#port;
    }

    /** Binds the socket. Rejects with `kind: 'connection'` when the port is taken. */
    async start(): Promise<number> {
        this.#port = await (this.protocol === 'binrpc' ? this.#startBinrpc() : this.#startXmlrpc());
        return this.#port;
    }

    async stop(): Promise<void> {
        const xmlrpcServer = this.#xmlrpcServer;
        const binrpcServer = this.#binrpcServer;
        this.#xmlrpcServer = undefined;
        this.#binrpcServer = undefined;
        // a server whose bind failed was never listening; closing it throws, and that is not news
        try {
            await xmlrpcServer?.close();
            await binrpcServer?.close();
        } catch (error) {
            this.#onError(error);
        }
        this.#port = 0;
    }

    /**
     * Answers one call. Exported through the class so the transports and the tests can drive the
     * dispatch without a socket.
     */
    dispatch(method: string, params: readonly RpcValue[]): RpcValue {
        switch (method) {
            case 'system.listMethods':
                return [...CALLBACK_METHODS];
            case 'system.multicall':
                return this.#multicall(params);
            case 'listDevices':
                return this.#handler.listDevices(this.#interfaceOf(params));
            case 'event':
                this.#handler.event(
                    this.#interfaceOf(params),
                    asString(params[1]),
                    asString(params[2]),
                    params[3] ?? '',
                );
                return '';
            case 'newDevices':
                this.#handler.newDevices(this.#interfaceOf(params), asDescriptions(params[1]));
                return '';
            case 'deleteDevices':
                this.#handler.deleteDevices(this.#interfaceOf(params), asStrings(params[1]));
                return '';
            case 'replaceDevice':
                this.#handler.replaceDevice(this.#interfaceOf(params), asString(params[1]), asString(params[2]));
                return '';
            case 'readdedDevice':
                this.#handler.readdedDevice(this.#interfaceOf(params), asStrings(params[1]));
                return '';
            case 'updateDevice':
                this.#handler.updateDevice(
                    this.#interfaceOf(params),
                    asString(params[1]),
                    typeof params[2] === 'number' ? params[2] : 0,
                );
                return '';
            default:
                this.#handler.unknownMethod?.(method, [...params]);
                return '';
        }
    }

    #multicall(params: readonly RpcValue[]): RpcValue[] {
        const calls: unknown[] = Array.isArray(params[0]) ? params[0] : [];
        const results: RpcValue[] = [];
        for (const call of calls) {
            if (typeof call !== 'object' || call === null || Array.isArray(call)) {
                results.push('');
                continue;
            }
            const entry = call as {methodName?: unknown; params?: unknown};
            const inner: unknown[] = Array.isArray(entry.params) ? entry.params : [];
            results.push(this.#safeDispatch(asString(entry.methodName), inner as RpcValue[]));
        }
        return results;
    }

    #safeDispatch(method: string, params: readonly RpcValue[]): RpcValue {
        try {
            return this.dispatch(method, params);
        } catch (error) {
            this.#onError(error);
            return '';
        }
    }

    /** The interface a callback belongs to; the ident is always the first parameter. */
    #interfaceOf(params: readonly RpcValue[]): string {
        return interfaceNameFromIdent(asString(params[0])) ?? asString(params[0]);
    }

    #startXmlrpc(): Promise<number> {
        return new Promise<number>((resolve, reject) => {
            const server = xmlrpc.createServer({host: this.host, port: this.#requestedPort});
            this.#xmlrpcServer = server;
            server.on('error', (error: Error) => {
                reject(
                    connectionError(
                        `xmlrpc callback server on port ${String(this.#requestedPort)}: ${error.message}`,
                        error,
                    ),
                );
                this.#onError(error);
            });
            server.on('listening', () => {
                const address = server.httpServer.address();
                resolve(typeof address === 'object' && address !== null ? address.port : this.#requestedPort);
            });
            server.on('NotFound', (method: string, params: RpcValue[] | undefined) => {
                this.#handler.unknownMethod?.(method, params ?? []);
            });
            for (const method of CALLBACK_METHODS) {
                server.on(method, (_error, params: RpcValue[] | undefined, callback) => {
                    callback(null, this.#safeDispatch(method, params ?? []));
                });
            }
        });
    }

    #startBinrpc(): Promise<number> {
        return new Promise<number>((resolve, reject) => {
            const server = binrpc.createServer({host: this.host, port: this.#requestedPort});
            this.#binrpcServer = server;
            server.on('error', (error: Error) => {
                reject(
                    connectionError(
                        `binrpc callback server on port ${String(this.#requestedPort)}: ${error.message}`,
                        error,
                    ),
                );
                this.#onError(error);
            });
            server.on('listening', () => {
                const address = server.server.address();
                resolve(typeof address === 'object' && address !== null ? address.port : this.#requestedPort);
            });
            server.on('NotFound', (method, params) => {
                this.#handler.unknownMethod?.(method ?? '', (params as RpcValue[] | undefined) ?? []);
            });
            for (const method of CALLBACK_METHODS) {
                server.on(method, (_error, params: RpcValue[] | undefined, callback) => {
                    callback(null, this.#safeDispatch(method, params ?? []));
                });
            }
        });
    }
}

/** A parameter as a string; a struct or an array becomes JSON rather than `[object Object]`. */
function asString(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    if (value === undefined || value === null) {
        return '';
    }
    if (typeof value === 'object') {
        return JSON.stringify(value);
    }
    return typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
}

function asStrings(value: unknown): string[] {
    return Array.isArray(value) ? value.map((entry) => asString(entry)) : [];
}

function asDescriptions(value: unknown): DeviceDescription[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const descriptions: DeviceDescription[] = [];
    for (const entry of value as unknown[]) {
        if (
            typeof entry === 'object' &&
            entry !== null &&
            !Array.isArray(entry) &&
            typeof (entry as Record<string, unknown>)['ADDRESS'] === 'string'
        ) {
            descriptions.push(entry as unknown as DeviceDescription);
        }
    }
    return descriptions;
}

/** What the interface manager needs of the callback servers; a test substitutes its own. */
export interface CallbackServerSet {
    /** Starts the server of a protocol if it is not running, and returns its port. */
    ensure(protocol: RpcProtocol): Promise<number>;
    port(protocol: RpcProtocol): number;
    /** The `init` URL for that protocol and the address the CCU should call back on. */
    callbackUrl(protocol: RpcProtocol, ip: string): string;
    stop(): Promise<void>;
}

/**
 * The two callback servers, started only for the protocols that are actually needed.
 *
 * The URL an interface is told to call back on differs by protocol - `http://` for xmlrpc,
 * `xmlrpc_bin://` for binrpc - and the ports differ too, which is why 2.x kept two of everything.
 */
export class CallbackServers implements CallbackServerSet {
    readonly #servers = new Map<RpcProtocol, CallbackServer>();
    readonly #handler: CallbackHandler;
    readonly #host: string;
    readonly #ports: {xmlrpc: number; binrpc: number};
    readonly #onError: (error: unknown) => void;

    constructor(options: {
        handler: CallbackHandler;
        host?: string;
        ports: {xmlrpc: number; binrpc: number};
        onError?: (error: unknown) => void;
    }) {
        this.#handler = options.handler;
        this.#host = options.host ?? '0.0.0.0';
        this.#ports = options.ports;
        this.#onError = options.onError ?? (() => undefined);
    }

    /** Starts the server for a protocol if it is not running yet, and returns its port. */
    async ensure(protocol: RpcProtocol): Promise<number> {
        const running = this.#servers.get(protocol);
        if (running) {
            return running.port;
        }
        const server = new CallbackServer({
            protocol,
            host: this.#host,
            port: protocol === 'binrpc' ? this.#ports.binrpc : this.#ports.xmlrpc,
            handler: this.#handler,
            onError: this.#onError,
        });
        this.#servers.set(protocol, server);
        try {
            return await server.start();
        } catch (error) {
            this.#servers.delete(protocol);
            throw error;
        }
    }

    /** The port of a running server, or 0. */
    port(protocol: RpcProtocol): number {
        return this.#servers.get(protocol)?.port ?? 0;
    }

    /** The `init` URL for an interface of this protocol, given the address it should call back on. */
    callbackUrl(protocol: RpcProtocol, ip: string): string {
        const scheme = protocol === 'binrpc' ? 'xmlrpc_bin://' : 'http://';
        return `${scheme}${ip}:${String(this.port(protocol))}`;
    }

    async stop(): Promise<void> {
        const servers = [...this.#servers.values()];
        this.#servers.clear();
        for (const server of servers) {
            try {
                await server.stop();
            } catch (error) {
                this.#onError(new Error(errorMessage(error)));
            }
        }
    }
}
