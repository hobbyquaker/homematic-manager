/**
 * `createWebHost()`: the backend as a local HTTP + WebSocket server that also serves the built UI.
 *
 * One origin, one port, four routes under a configurable base path:
 *
 * | route | what it is |
 * | --- | --- |
 * | `<base>api` | the WebSocket of `ApiWebSocketServer` - the only thing the UI talks to |
 * | `<base>images/<deviceType>` | device pictures from the CCU, cached, with the bundled fallback |
 * | `<base>data/...` | `data/dist` as plain files: metadata, profiles, translations, icons |
 * | `<base>...` | the built UI (`packages/ui/dist`), or a vite dev server in development |
 *
 * The base path is what makes the same process work at `/` on a development machine and under
 * `/addons/hmm/` behind the CCU's lighttpd in task 13; the UI needs no build-time base because it
 * builds with `base: './'` and `createTransport()` derives the socket URL from the page's own
 * directory.
 *
 * `data/dist` is served as **static files**, not through the backend's `data.file`: it is 9 MB of
 * JSON that the browser should cache and range-request like any other asset, and pushing it through
 * the socket as base64 would put it in the same queue as the RPC traffic. `data.file` still works -
 * the same directory is injected as the `data` file root, and `<data-dir>/images` as the `images`
 * one - so an Electron renderer and a browser see the same two roots under the same names.
 */

import fs from 'node:fs/promises';
import http from 'node:http';
import type {IncomingMessage, ServerResponse} from 'node:http';
import type {Socket} from 'node:net';
import path from 'node:path';

import type {AppConfig} from '@homematic-manager/core';
import {ApiWebSocketServer, Backend, type BackendOptions} from '@homematic-manager/backend';

import {applyCookieToken, createToken, isLoopbackHost, tokenCookie} from './auth.js';
import {ImageService, type ImageUpstream} from './images.js';
import {createLogger, silentLogger, type Logger, type LogLevel} from './log.js';
import {defaultDataDir, defaultMetadataDir, defaultUiDir, packageVersion} from './paths.js';
import {proxyRequest, proxyUpgrade} from './proxy.js';
import {resolveStaticFile, sendFile} from './static.js';

/** The port the CLI binds by default - 8090, next to nothing else a Homematic user runs. */
export const DEFAULT_PORT = 8090;

/** Loopback by default: this is a development and addon host, never an exposed web server. */
export const DEFAULT_HOST = '127.0.0.1';

/** How long `close()` waits for `backend.stop()` before it gives up and exits anyway. */
export const SHUTDOWN_TIMEOUT_MS = 5000;

/**
 * How often an idle API socket is pinged. Below lighttpd's `server.max-read-idle` /
 * `max-write-idle` default of 60 s, which is what would otherwise cut the proxied socket of the
 * CCU addon (task 13) after a minute without traffic.
 */
export const KEEPALIVE_INTERVAL_MS = 25_000;

export interface WebHostOptions {
    readonly port?: number;
    readonly host?: string;
    /** URL prefix everything is served under; `/` by default, `/addons/hmm/` on the CCU. */
    readonly base?: string;
    /** The backend's profile directory. */
    readonly dataDir?: string;
    /** The built UI. Ignored when `uiDevServer` is set. */
    readonly uiDir?: string;
    /** `data/dist`. */
    readonly metadataDir?: string;
    /** `http://127.0.0.1:5173` - proxy everything that is not the API to a vite dev server. */
    readonly uiDevServer?: string | undefined;
    /** The token clients have to present. Generated when auth is on and none is given. */
    readonly token?: string | undefined;
    /** Off means every client is let in; the desktop case on loopback. Default: on. */
    readonly auth?: boolean;
    /** Hand the token to the browser as a cookie on the page load. Default: loopback binds only. */
    readonly issueCookie?: boolean | undefined;
    /** Serve the UI in demo mode and start no backend at all. */
    readonly demo?: boolean;
    /** Written to `ConnectionConfig.host` when it differs from what is configured. */
    readonly ccu?: string | undefined;
    /** Written to `ConnectionConfig.local` - the addon's "we run on the CCU" mode. */
    readonly local?: boolean | undefined;
    /**
     * Written to `ConnectionConfig.callback`. A host that cannot see the address the CCU reaches it
     * on has to be told: a container on a bridge network sees `172.17.0.x`, and an `init` that
     * announces that address gets no events at all. With `--network host` none of this is needed.
     */
    readonly callbackIp?: string | undefined;
    /** Fixed callback ports, so a container can publish them. `0` picks a free one. */
    readonly callbackXmlrpcPort?: number | undefined;
    readonly callbackBinrpcPort?: number | undefined;
    /** How long `close()` waits for `backend.stop()`. */
    readonly shutdownTimeoutMs?: number;
    /** How often an idle api socket is pinged; `0` turns the heartbeat off. */
    readonly keepAliveMs?: number;
    readonly logLevel?: LogLevel;
    readonly log?: Logger;
    readonly version?: string;
    /** Merged into `Backend.open()`; the tests inject their fakes through it. */
    readonly backendOptions?: Partial<BackendOptions>;
    /** Injected by the image-proxy tests. */
    readonly fetch?: typeof globalThis.fetch;
}

export interface WebHost {
    readonly server: http.Server;
    /** `undefined` in demo mode - there is nothing to talk to. */
    readonly backend: Backend | undefined;
    readonly api: ApiWebSocketServer | undefined;
    readonly images: ImageService;
    /** The URL a browser should open, base path included. */
    readonly url: string;
    readonly port: number;
    readonly base: string;
    /** `undefined` when auth is off. */
    readonly token: string | undefined;
    close(): Promise<void>;
}

/** `/` stays `/`, everything else becomes `/x/y/`. */
export function normaliseBase(base: string | undefined): string {
    const trimmed = (base ?? '/').trim();
    if (trimmed === '' || trimmed === '/') {
        return '/';
    }
    return `/${trimmed.replace(/^\/+/, '').replace(/\/+$/, '')}/`;
}

/** The host part of the URL a human should open; `0.0.0.0` is not one. */
export function displayHost(host: string): string {
    if (host === '0.0.0.0' || host === '' || host === '::' || host === '::0') {
        return '127.0.0.1';
    }
    return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

/** Starts the HTTP server, the API socket and (unless `demo`) the backend. */
export async function createWebHost(options: WebHostOptions = {}): Promise<WebHost> {
    const base = normaliseBase(options.base);
    const host = options.host ?? DEFAULT_HOST;
    const demo = options.demo ?? false;
    const log = options.log ?? (options.logLevel ? createLogger({level: options.logLevel}) : silentLogger);
    const dataDir = options.dataDir ?? defaultDataDir();
    const uiDir = options.uiDir ?? defaultUiDir();
    const metadataDir = options.metadataDir ?? defaultMetadataDir();
    const imageCacheDir = path.join(dataDir, 'images');
    const devTarget = options.uiDevServer ? new URL(options.uiDevServer) : undefined;
    const auth = options.auth ?? true;
    const token = auth ? (options.token ?? createToken()) : undefined;
    const issueCookie = options.issueCookie ?? isLoopbackHost(host);
    const apiPath = `${base}api`;

    let connection: AppConfig['connection'] | undefined;
    let backend: Backend | undefined;
    if (!demo) {
        await ensureDataDir(dataDir);
        backend = await Backend.open({
            dataDir,
            version: options.version ?? packageVersion(),
            fileRoots: {data: metadataDir, images: imageCacheDir},
            ...options.backendOptions,
        });
        backend.on('notice', (notice) => {
            log[notice.level](`backend: ${notice.message}`);
        });
        // the image proxy needs the CCU's address on every miss; `config.get` is a request, so the
        // last configuration is kept here and refreshed by the event the backend emits anyway
        backend.on('config.changed', (config) => {
            connection = config.connection;
        });
        connection = (await backend.request('config.get')).connection;
        await applyConnectionOptions(backend, options, log);
        await backend.start();
    }

    const images = new ImageService({
        iconMapFile: path.join(metadataDir, 'device-icons.json'),
        fallbackDir: path.join(metadataDir, 'icons'),
        cacheDir: imageCacheDir,
        upstream: () => upstreamOf(connection),
        log,
        ...(options.fetch ? {fetch: options.fetch} : {}),
    });

    // an upgraded socket is no longer one of the server's connections, so `closeAllConnections()`
    // does not reach the proxied HMR socket of development mode and `close()` would wait forever
    const sockets = new Set<Socket>();

    const server = http.createServer((request, response) => {
        void handle(request, response).catch((error: unknown) => {
            log.error('request failed:', error);
            if (!response.headersSent) {
                response.writeHead(500, {'Content-Type': 'text/plain; charset=utf-8'});
            }
            response.end('internal error\n');
        });
    });

    async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
        const method = request.method ?? 'GET';
        if (method !== 'GET' && method !== 'HEAD') {
            response.writeHead(405, {Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8'});
            response.end('method not allowed\n');
            return;
        }
        const url = new URL(request.url ?? '/', 'http://localhost');
        const pathname = url.pathname;
        if (base !== '/' && `${pathname}/` === base) {
            response.writeHead(301, {Location: `${base}${url.search}`});
            response.end();
            return;
        }
        if (!pathname.startsWith(base)) {
            notFound(response);
            return;
        }
        const rest = pathname.slice(base.length);

        if (rest === 'api' || rest.startsWith('api/')) {
            // the API is a WebSocket; a plain GET on it is a mistake worth naming
            response.writeHead(426, {'Content-Type': 'text/plain; charset=utf-8', Upgrade: 'websocket'});
            response.end('the api endpoint is a websocket\n');
            return;
        }

        if (rest.startsWith('images/')) {
            await serveImage(response, decodeURIComponent(rest.slice('images/'.length)), method);
            return;
        }

        if (rest.startsWith('data/')) {
            await serveStatic(request, response, metadataDir, rest.slice('data/'.length), method);
            return;
        }

        if (demo && rest === '' && !url.searchParams.has('demo')) {
            // the UI enters demo mode on `?demo`; the redirect is what makes `--demo` self-contained
            response.writeHead(302, {Location: `${base}?demo`});
            response.end();
            return;
        }

        if (devTarget) {
            proxyRequest({target: devTarget, log}, request, response);
            return;
        }

        await serveStatic(request, response, uiDir, rest === '' ? 'index.html' : rest, method);
    }

    async function serveImage(response: ServerResponse, deviceType: string, method: string): Promise<void> {
        const image = deviceType === '' ? undefined : await images.get(deviceType);
        if (!image) {
            notFound(response);
            return;
        }
        response.writeHead(200, {
            'Content-Type': image.mime,
            'Content-Length': String(image.body.length),
            // a device picture changes when the CCU's firmware does, which is rare and never silent
            'Cache-Control': 'public, max-age=86400',
            'X-Hmm-Image-Source': image.source,
        });
        response.end(method === 'HEAD' ? undefined : image.body);
    }

    async function serveStatic(
        request: IncomingMessage,
        response: ServerResponse,
        root: string,
        relative: string,
        method: string,
    ): Promise<void> {
        const file = await resolveStaticFile(root, relative);
        if (file === undefined) {
            notFound(response);
            return;
        }
        const isIndex = path.basename(file) === 'index.html' && root === uiDir;
        await sendFile(response, file, {
            method,
            ifNoneMatch: request.headers['if-none-match'],
            ...(isIndex && issueCookie && token !== undefined
                ? {headers: {'Set-Cookie': tokenCookie(token, base)}}
                : {}),
        });
    }

    /*
     * The upgrade routing belongs to the host, not to `ws`: attached to an HTTP server,
     * `WebSocketServer` answers every upgrade of a path that is not its own with a 400, which would
     * kill vite's HMR socket in development. `noServer` leaves the routing here and gets handed
     * only the upgrades that are the API's; everything else is proxied or refused below.
     *
     * `keepAliveMs` pings an idle socket so lighttpd in front of the addon (task 13) does not cut
     * it for being quiet, and drops one whose peer has stopped answering.
     */
    const api = backend
        ? new ApiWebSocketServer({
              backend,
              noServer: true,
              path: apiPath,
              keepAliveMs: options.keepAliveMs ?? KEEPALIVE_INTERVAL_MS,
              ...(token === undefined ? {} : {token}),
              onError: (error) => log.warn('api socket:', error),
          })
        : undefined;
    await api?.start();

    server.on('connection', (socket: Socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
    });

    server.on('upgrade', (request, socket, head) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
        if (api && pathname === apiPath) {
            // no origin check on purpose: lighttpd forwards the browser's Origin and its own Host
            // unchanged (task 13), and the token - not the origin - is what guards this socket
            applyCookieToken(request, token);
            api.handleUpgrade(request, socket, head);
            return;
        }
        if (devTarget) {
            proxyUpgrade({target: devTarget, log}, request, socket, head);
            return;
        }
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(options.port ?? DEFAULT_PORT, host, () => {
            server.off('error', reject);
            resolve();
        });
    });

    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;

    let closed = false;
    const close = async (): Promise<void> => {
        if (closed) {
            return;
        }
        closed = true;
        await api?.stop();
        await new Promise<void>((resolve) => {
            server.close(() => resolve());
            for (const socket of sockets) {
                socket.destroy();
            }
        });
        if (backend) {
            const limit = options.shutdownTimeoutMs ?? SHUTDOWN_TIMEOUT_MS;
            await withTimeout(backend.stop(), limit, () =>
                log.warn(`the backend did not stop within ${limit} ms; exiting anyway`),
            );
        }
    };

    return {
        server,
        backend,
        api,
        images,
        url: `http://${displayHost(host)}:${port}${base}`,
        port,
        base,
        token,
        close,
    };
}

/** Ensures the profile directory exists before the backend writes into it. */
export async function ensureDataDir(dataDir: string): Promise<void> {
    await fs.mkdir(path.join(dataDir, 'images'), {recursive: true});
}

function notFound(response: ServerResponse): void {
    response.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
    response.end('not found\n');
}

function upstreamOf(connection: AppConfig['connection'] | undefined): ImageUpstream | undefined {
    if (!connection || connection.host === '') {
        return undefined;
    }
    return {
        host: connection.host,
        tls: connection.tls,
        ...(connection.auth ? {auth: connection.auth} : {}),
    };
}

/** `--ccu`, `--local` and the callback options win over what `config.json` holds. */
async function applyConnectionOptions(backend: Backend, options: WebHostOptions, log: Logger): Promise<void> {
    const wantsHost = options.ccu !== undefined && options.ccu !== '';
    const wantsLocal = options.local !== undefined;
    const callback = {
        ...(options.callbackIp === undefined ? {} : {ip: options.callbackIp}),
        ...(options.callbackXmlrpcPort === undefined ? {} : {xmlrpcPort: options.callbackXmlrpcPort}),
        ...(options.callbackBinrpcPort === undefined ? {} : {binrpcPort: options.callbackBinrpcPort}),
    };
    const wantsCallback = Object.keys(callback).length > 0;
    if (!wantsHost && !wantsLocal && !wantsCallback) {
        return;
    }
    const config: AppConfig = await backend.request('config.get');
    const connection = {
        ...config.connection,
        ...(wantsHost ? {host: options.ccu as string} : {}),
        ...(wantsLocal ? {local: options.local as boolean} : {}),
        callback: {...config.connection.callback, ...callback},
    };
    if (
        connection.host === config.connection.host &&
        connection.local === config.connection.local &&
        connection.callback.ip === config.connection.callback.ip &&
        connection.callback.xmlrpcPort === config.connection.callback.xmlrpcPort &&
        connection.callback.binrpcPort === config.connection.callback.binrpcPort
    ) {
        return;
    }
    log.info(`connection: host=${connection.host}${connection.local === true ? ' (local)' : ''}`);
    if (wantsCallback) {
        const {ip, xmlrpcPort, binrpcPort} = connection.callback;
        log.info(`callback: ${ip === '' ? 'auto' : ip} xmlrpc=${String(xmlrpcPort)} binrpc=${String(binrpcPort)}`);
    }
    await backend.request('config.set', connection);
}

async function withTimeout(work: Promise<unknown>, ms: number, onTimeout: () => void): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), ms);
        timer.unref?.();
    });
    const result = await Promise.race([work.then(() => 'done' as const), timeout]);
    if (timer) {
        clearTimeout(timer);
    }
    if (result === 'timeout') {
        onTimeout();
    }
}
