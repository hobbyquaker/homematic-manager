/**
 * The WebSocket transport: `ApiFrame` JSON over `ws`, one backend shared by every socket.
 *
 * Task 12 mounts this in `apps/web` next to the static UI, and task 13 puts the same process on the
 * CCU behind lighttpd. It can bind its own HTTP server, attach to one the host already has, or -
 * with `noServer` - let the host route the upgrades and hand over only the ones that are the API's.
 *
 * **Token auth from the start** (task 12): the CCU addon issues a token from its session-checked
 * CGI, and without one the socket is closed with 4401 before it can send a frame. A backend with no
 * token configured accepts everyone, which is the desktop case where the socket is on loopback.
 *
 * Every event of the backend is fanned out to every socket; the requests of a socket are answered
 * on that socket. A frame that is not a frame closes nothing - it is answered with an error where
 * it has an id, and dropped where it has not.
 */

import type {IncomingMessage, Server as HttpServer} from 'node:http';
import type {Duplex} from 'node:stream';

import {WebSocketServer, type WebSocket} from 'ws';

import type {ApiEventName, ApiMethodName, ApiParams, SessionInfo} from '@homematic-manager/core';

import type {Backend} from '../api/backend.js';
import {toApiError} from '../errors.js';
import {decodeFrame, encodeFrame, errorFrame, responseFrame} from './codec.js';

/** Close code for a socket that did not present a valid token. */
export const UNAUTHORIZED_CLOSE_CODE = 4401;

export interface ApiWebSocketServerOptions {
    readonly backend: Backend;
    /** Bind an own server on this port; `0` picks a free one. Ignored when `server` is given. */
    readonly port?: number;
    readonly host?: string;
    /** Attach to an HTTP server the host already runs (apps/web, the addon). */
    readonly server?: HttpServer;
    /**
     * Bind nothing and take the upgrades the host routes here with {@link
     * ApiWebSocketServer.handleUpgrade}. Wins over `server` and `port`.
     *
     * This is what a host with more than one WebSocket wants: attached to an HTTP server, `ws`
     * answers every upgrade of a *foreign* path with a 400 and there is no way to tell it not to,
     * which kills a vite HMR socket or a second proxied endpoint on the same origin.
     */
    readonly noServer?: boolean;
    /** The path the socket lives on. Not consulted in `noServer` mode - the host routes. */
    readonly path?: string;
    /**
     * The token a client has to present, as `?token=` or in the `sec-websocket-protocol` header.
     * Omitted or empty means no authentication.
     */
    readonly token?: string;
    /**
     * Send a ping frame to every idle client this often and terminate one that does not answer
     * before the next ping is due. `0` or omitted turns the heartbeat off.
     *
     * A proxied socket needs it: lighttpd in front of the CCU addon (task 13) cuts a connection
     * that was quiet for `server.max-read-idle` (60 s by default), and a socket that died with the
     * network - a CCU rebooting, a laptop suspending - is otherwise only noticed when the next
     * request is written into it. Browsers answer a ping on their own, so no client needs to know.
     */
    readonly keepAliveMs?: number;
    /**
     * D-32: who this upgrade belongs to, asked once per socket.
     *
     * A session is a property of the *connection*, not of the backend - the backend serves every
     * socket the same way and knows nothing about cookies. The host that has a login (`apps/web`
     * with `--auth-mode rega`) reads its session cookie here, and the answer is what `session.info`
     * returns on that socket and nothing else. Without this option every socket answers `null`,
     * which is the desktop, npm and Docker case.
     */
    readonly sessionInfo?: (request: {
        url?: string | undefined;
        headers: IncomingMessage['headers'];
    }) => SessionInfo | null;
    readonly onError?: (error: unknown) => void;
}

/** Serves the contract over WebSocket. */
export class ApiWebSocketServer {
    readonly path: string;

    readonly #options: ApiWebSocketServerOptions;
    readonly #sockets = new Set<WebSocket>();
    /** D-32: the session each socket was opened with, for `session.info`. */
    readonly #sessions = new WeakMap<WebSocket, SessionInfo>();
    readonly #unsubscribe: () => void;
    #server: WebSocketServer | undefined;

    constructor(options: ApiWebSocketServerOptions) {
        this.#options = options;
        this.path = options.path ?? '/api';
        this.#unsubscribe = options.backend.events.onAny((event, payload) => {
            this.broadcast(event, payload);
        });
    }

    /** The port the server listens on; 0 when it was attached to someone else's server. */
    get port(): number {
        if (this.#options.server || this.#options.noServer) {
            return 0;
        }
        const address = this.#server?.address();
        return typeof address === 'object' && address !== null ? address.port : 0;
    }

    /** How many clients are connected. */
    get clients(): number {
        return this.#sockets.size;
    }

    /** Binds (or attaches) and starts accepting connections. */
    start(): Promise<number> {
        return new Promise<number>((resolve, reject) => {
            const verifyClient = (
                info: {req: IncomingMessage},
                callback: (accept: boolean, code?: number, message?: string) => void,
            ): void => {
                // refusing during the handshake gives the client a real 401 instead of a socket
                // that opens and closes again, which is what lighttpd in front of the addon needs
                callback(this.authorise({url: info.req.url, headers: info.req.headers}), 401, 'Unauthorized');
            };
            const server = new WebSocketServer(
                this.#options.noServer
                    ? {noServer: true, verifyClient}
                    : this.#options.server
                      ? {server: this.#options.server, path: this.path, verifyClient}
                      : {
                            port: this.#options.port ?? 0,
                            host: this.#options.host ?? '127.0.0.1',
                            path: this.path,
                            verifyClient,
                        },
            );
            this.#server = server;
            server.on('error', (error: Error) => {
                this.#options.onError?.(error);
                reject(error);
            });
            server.on('connection', (socket, request) => {
                this.#accept(socket, request);
            });
            if (this.#options.noServer || this.#options.server) {
                resolve(0);
            } else {
                server.on('listening', () => {
                    resolve(this.port);
                });
            }
        });
    }

    /**
     * Takes over an upgrade the host has routed here (`noServer` mode). An unauthorised one is
     * answered with a 401 before a socket exists; every other path stays the host's business.
     */
    handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
        const server = this.#server;
        if (!server) {
            throw new Error('handleUpgrade before start()');
        }
        if (!this.#options.noServer) {
            throw new Error('handleUpgrade needs the noServer option');
        }
        // `verifyClient` runs inside this call, so the 401 of an unauthorised upgrade is ws's own
        server.handleUpgrade(request, socket, head, (client) => {
            server.emit('connection', client, request);
        });
    }

    /** Closes every socket and the server. */
    async stop(): Promise<void> {
        this.#unsubscribe();
        for (const socket of [...this.#sockets]) {
            socket.close();
        }
        this.#sockets.clear();
        // not `noteSessions(0)`: the host is shutting down, and starting an idle grace period for a
        // backend that is about to be stopped would only leave a timer behind
        const server = this.#server;
        this.#server = undefined;
        if (!server) {
            return;
        }
        await new Promise<void>((resolve) => {
            server.close(() => {
                resolve();
            });
        });
    }

    /** Pushes an event to every connected client. */
    broadcast(event: ApiEventName, payload: unknown): void {
        if (this.#sockets.size === 0) {
            return;
        }
        const frame = encodeFrame({t: 'ev', n: event, d: payload});
        for (const socket of this.#sockets) {
            this.#send(socket, frame);
        }
    }

    /** Is this request allowed in? Public so a host can use the same rule for its HTTP routes. */
    authorise(request: {url?: string | undefined; headers: Record<string, unknown>}): boolean {
        const expected = this.#options.token;
        if (expected === undefined || expected === '') {
            return true;
        }
        const url = new URL(request.url ?? '/', 'http://localhost');
        if (url.searchParams.get('token') === expected) {
            return true;
        }
        const protocol = request.headers['sec-websocket-protocol'];
        const offered = typeof protocol === 'string' ? protocol.split(',').map((entry) => entry.trim()) : [];
        return offered.includes(expected) || offered.includes(`token.${expected}`);
    }

    #accept(socket: WebSocket, request: IncomingMessage): void {
        if (!this.authorise({url: request.url, headers: request.headers})) {
            socket.close(UNAUTHORIZED_CLOSE_CODE, 'unauthorized');
            return;
        }
        const session = this.#options.sessionInfo?.({url: request.url, headers: request.headers}) ?? undefined;
        if (session) {
            this.#sessions.set(socket, session);
        }
        this.#sockets.add(socket);
        // D-31: the backend counts sessions, not sockets it knows nothing about. This is the only
        // transport that has any - `InProcessTransport` never reports one, which is why Electron
        // never idles out.
        this.#options.backend.noteSessions(this.#sockets.size);
        socket.on('close', () => {
            this.#sockets.delete(socket);
            this.#options.backend.noteSessions(this.#sockets.size);
        });
        socket.on('error', (error: Error) => {
            this.#options.onError?.(error);
        });
        socket.on('message', (data: unknown) => {
            void this.#handle(socket, data);
        });
        this.#keepAlive(socket);
    }

    /**
     * Pings this socket every `keepAliveMs` and terminates it when a pong is still missing when the
     * next ping is due - so a dead peer costs at most two intervals, and a live but silent one
     * keeps every proxy in between convinced that the connection is in use.
     */
    #keepAlive(socket: WebSocket): void {
        const interval = this.#options.keepAliveMs ?? 0;
        if (interval <= 0) {
            return;
        }
        let answered = true;
        socket.on('pong', () => {
            answered = true;
        });
        const timer = setInterval(() => {
            if (socket.readyState !== socket.OPEN) {
                return;
            }
            if (!answered) {
                // `terminate()` and not `close()`: the peer has already proven it is not listening
                socket.terminate();
                return;
            }
            answered = false;
            try {
                socket.ping();
            } catch (error) {
                this.#options.onError?.(error);
            }
        }, interval);
        // a heartbeat is not a reason for the process to stay alive
        timer.unref();
        socket.once('close', () => {
            clearInterval(timer);
        });
    }

    async #handle(socket: WebSocket, data: unknown): Promise<void> {
        const frame = decodeFrame(data);
        if (!frame || frame.t !== 'req') {
            // a frame we cannot even read has no id to answer on; dropping it is all that is left
            return;
        }
        try {
            // D-32: the one method the transport answers itself. It is a property of this socket -
            // the backend would have to be told about cookies to answer it, and it must not be.
            const result =
                frame.m === 'session.info'
                    ? (this.#sessions.get(socket) ?? null)
                    : await this.#options.backend.request(frame.m, ...(frame.p as ApiParams<ApiMethodName>));
            this.#send(socket, encodeFrame(responseFrame(frame.id, result)));
        } catch (error) {
            this.#send(socket, encodeFrame(errorFrame(frame.id, toApiError(error))));
        }
    }

    #send(socket: WebSocket, frame: string): void {
        if (socket.readyState !== socket.OPEN) {
            return;
        }
        try {
            socket.send(frame);
        } catch (error) {
            this.#options.onError?.(error);
        }
    }
}

/**
 * The upgrade guard for a host that runs its own HTTP server and wants to refuse an unauthorised
 * upgrade before `ws` sees it (the addon does, so lighttpd gets a clean 401).
 */
export function refuseUnauthorised(socket: Duplex): void {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
}
