/**
 * One RPC client per interface process: XML-RPC over HTTP(S) or eQ-3's binary BIN-RPC.
 *
 * Three things this adds over calling the libraries directly.
 *
 * **Promises with a timeout.** `binrpc` has a response timeout of its own, `homematic-xmlrpc` has
 * none at all - a CCU that accepts the TCP connection and then says nothing leaves the callback
 * pending forever, which is how 2.x's RPC dialog could sit on "in progress" until the app was
 * killed. Every call here rejects after `timeoutMs`.
 *
 * **One fault shape.** `homematic-xmlrpc` throws an `Error` carrying `faultCode`/`faultString`;
 * `binrpc` decodes a fault (message type `0xff`) into an ordinary result struct with those two
 * fields and does not tell the caller that it was a fault. Both become a `BackendError` with
 * `kind: 'rpc'` and the fault code intact.
 *
 * **ISO-8859-1.** The interface processes speak ISO-8859-1 and their XML carries no encoding
 * declaration, so `responseEncoding: 'latin1'` is set on every XML-RPC client; without it a `°C`
 * unit arrives as the replacement character, which is the mojibake 2.x showed and which
 * `unitLabel()` in the core still repairs. See the README for what remains broken in the libraries
 * (BIN-RPC decodes strings as UTF-8, and both request paths write UTF-8).
 */

import binrpc from 'binrpc';
import xmlrpc from 'homematic-xmlrpc';

import type {RpcProtocol, RpcValue} from '@homematic-manager/core';

import {BackendError, connectionError, isRpcFault, rpcFaultError} from '../errors.js';
import {withTimeout} from '../util/net.js';

/** What the write log and the RPC console record for one call. */
export interface RpcCallRecord {
    readonly interfaceName: string;
    readonly method: string;
    readonly params: RpcValue[];
    readonly ok: boolean;
    readonly result?: RpcValue;
    readonly error?: string;
    readonly durationMs: number;
    /** Milliseconds since epoch. */
    readonly timestamp: number;
}

/** Anything that answers `methodCall`; the tests pass a fake instead of a socket. */
export interface RpcTransport {
    methodCall(
        method: string,
        params: RpcValue[],
        callback: (error: Error | null | undefined, value?: RpcValue) => void,
    ): void;
    /** Not every library has one; the client closes what it can. */
    close?: () => void;
}

export interface RpcClientOptions {
    /** The interface name, for error messages and the call log. */
    readonly name: string;
    readonly host: string;
    readonly port: number;
    readonly protocol: RpcProtocol;
    readonly path?: string;
    readonly tls?: boolean;
    readonly auth?: {readonly user: string; readonly password: string} | undefined;
    /** How long a call may take before it rejects with `kind: 'connection'`. */
    readonly timeoutMs?: number;
    /** Encoding of an XML-RPC answer; `latin1` unless a test says otherwise. */
    readonly encoding?: string;
    /** A CCU's TLS certificate is self-signed, so this is false by default. */
    readonly rejectUnauthorized?: boolean;
    /** Called for every finished call - the write log and the console history hang off it. */
    readonly onCall?: (record: RpcCallRecord) => void;
    /** Injected by the tests in place of the real libraries. */
    readonly createTransport?: (options: RpcClientOptions) => RpcTransport;
}

export const DEFAULT_RPC_TIMEOUT_MS = 20_000;

/** The interface processes answer in ISO-8859-1; Node's `latin1` is exactly that. */
export const INTERFACE_ENCODING = 'latin1';

function createTransport(options: RpcClientOptions): RpcTransport {
    if (options.protocol === 'binrpc') {
        const client = binrpc.createClient({
            host: options.host,
            port: options.port,
            responseTimeout: options.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS,
        });
        return {
            methodCall: (method, params, callback) => {
                client.methodCall(method, params as never, callback as never);
            },
            close: () => {
                // the library reconnects from the socket's own close/end/error handlers, so they
                // have to go before the socket does, or a closed client dials again 2.5 s later
                const {socket} = client;
                socket.removeAllListeners();
                socket.on('error', () => undefined);
                socket.destroy();
                client.connect = () => undefined;
            },
        };
    }
    const clientOptions = {
        host: options.host,
        port: options.port,
        path: options.path ?? '/',
        responseEncoding: options.encoding ?? INTERFACE_ENCODING,
        rejectUnauthorized: options.rejectUnauthorized ?? false,
        ...(options.auth ? {basic_auth: {user: options.auth.user, pass: options.auth.password}} : {}),
    };
    const client = options.tls === true ? xmlrpc.createSecureClient(clientOptions) : xmlrpc.createClient(clientOptions);
    return {
        methodCall: (method, params, callback) => {
            client.methodCall(method, params as never, callback as never);
        },
    };
}

/** A promise-shaped RPC client for one interface process. */
export class RpcClient {
    readonly name: string;
    readonly host: string;
    readonly port: number;
    readonly protocol: RpcProtocol;

    readonly #transport: RpcTransport;
    readonly #timeoutMs: number;
    readonly #onCall: (record: RpcCallRecord) => void;
    #closed = false;

    constructor(options: RpcClientOptions) {
        this.name = options.name;
        this.host = options.host;
        this.port = options.port;
        this.protocol = options.protocol;
        this.#timeoutMs = options.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
        this.#onCall = options.onCall ?? (() => undefined);
        this.#transport = (options.createTransport ?? createTransport)(options);
    }

    /** A short description for error messages: `HmIP-RF (ccu.lan:2010, xmlrpc)`. */
    get description(): string {
        return `${this.name} (${this.host}:${String(this.port)}, ${this.protocol})`;
    }

    /**
     * Calls a method. Rejects with a `BackendError`: `kind: 'rpc'` for a fault the interface
     * answered, `kind: 'connection'` for a timeout or a socket problem.
     */
    async call(method: string, params: readonly RpcValue[] = []): Promise<RpcValue> {
        if (this.#closed) {
            throw connectionError(`${this.description}: the client is closed`);
        }
        const started = Date.now();
        try {
            const result = await withTimeout(this.#invoke(method, [...params]), this.#timeoutMs, () =>
                connectionError(`${this.description}: ${method} timed out after ${String(this.#timeoutMs)} ms`),
            );
            this.#record(method, params, started, {ok: true, result});
            return result;
        } catch (error) {
            const failure = this.#asBackendError(method, error);
            this.#record(method, params, started, {ok: false, error: failure.message});
            throw failure;
        }
    }

    /** Closes the underlying socket, if the library has one. */
    close(): void {
        this.#closed = true;
        this.#transport.close?.();
    }

    get closed(): boolean {
        return this.#closed;
    }

    #invoke(method: string, params: RpcValue[]): Promise<RpcValue> {
        return new Promise<RpcValue>((resolve, reject) => {
            let settled = false;
            this.#transport.methodCall(method, params, (error, value) => {
                if (settled) {
                    return;
                }
                settled = true;
                if (error !== null && error !== undefined) {
                    reject(error);
                    return;
                }
                // binrpc hands a fault (message type 0xff) back as an ordinary struct
                if (isRpcFault(value)) {
                    reject(rpcFaultError(`${this.description}: ${method}`, value));
                    return;
                }
                resolve(value ?? '');
            });
        });
    }

    #asBackendError(method: string, error: unknown): BackendError {
        if (error instanceof BackendError) {
            return error;
        }
        if (isRpcFault(error)) {
            return rpcFaultError(`${this.description}: ${method}`, error);
        }
        const message = error instanceof Error ? error.message : String(error);
        return connectionError(`${this.description}: ${method} failed: ${message}`, error);
    }

    #record(
        method: string,
        params: readonly RpcValue[],
        started: number,
        outcome: {ok: boolean; result?: RpcValue; error?: string},
    ): void {
        this.#onCall({
            interfaceName: this.name,
            method,
            params: [...params],
            ok: outcome.ok,
            ...(outcome.result === undefined ? {} : {result: outcome.result}),
            ...(outcome.error === undefined ? {} : {error: outcome.error}),
            durationMs: Date.now() - started,
            timestamp: started,
        });
    }
}
