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

import type {AppConfig, SessionInfo} from '@homematic-manager/core';
import {ApiWebSocketServer, Backend, RegaAuthenticator, type BackendOptions} from '@homematic-manager/backend';

import {
    applyCookieToken,
    applySessionToken,
    clearedSessionCookie,
    createToken,
    isLoopbackHost,
    readCookie,
    SESSION_COOKIE,
    sessionCookie,
    TOKEN_COOKIE,
    tokenCookie,
} from './auth.js';
import {DeviceImageService, readIconMapFile, type ImageUpstream} from './images.js';
import {
    clientAddress,
    parseLoginForm,
    pickLanguage,
    readBody,
    renderLoginPage,
    type LoginError,
    type LoginLanguage,
} from './login.js';
import {createLogger, silentLogger, type Logger, type LogLevel} from './log.js';
import {defaultDataDir, defaultMetadataDir, defaultUiDir, packageVersion} from './paths.js';
import {proxyRequest, proxyUpgrade} from './proxy.js';
import {RateLimiter, SessionStore, type Session} from './sessions.js';
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

/**
 * D-32: how a browser is let in.
 *
 * `token` is what tasks 12 and 13 built and stays the default everywhere: the token comes from the
 * command line, the environment or the addon's session-checked `settings.cgi`. `rega` puts a login
 * page in front of the UI and checks the credentials against the CCU itself - which only works
 * *on* the CCU, because both services it asks are loopback-only.
 */
export type AuthMode = 'token' | 'rega';

/** What the login endpoint asks. `RegaAuthenticator` is the real one; a test passes a fake. */
export interface CredentialChecker {
    authenticate(user: string, password: string): Promise<{name: string; level: number} | undefined>;
}

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
    /**
     * D-31: milliseconds with no WebSocket session before the backend de-registers from the
     * interface processes. `0` (the default here; the CLI's default is five minutes) is off.
     */
    readonly idleUnsubscribeMs?: number;
    /** `http://127.0.0.1:5173` - proxy everything that is not the API to a vite dev server. */
    readonly uiDevServer?: string | undefined;
    /** The token clients have to present. Generated when auth is on and none is given. */
    readonly token?: string | undefined;
    /** Off means every client is let in; the desktop case on loopback. Default: on. */
    readonly auth?: boolean;
    /** Hand the token to the browser as a cookie on the page load. Default: loopback binds only. */
    readonly issueCookie?: boolean | undefined;
    /** D-32: `token` (the default) or `rega` - a login page checked against the CCU's own users. */
    readonly authMode?: AuthMode | undefined;
    /** D-32: how long a login session lives without being used; sliding. Default 24 h. */
    readonly sessionTtlMs?: number | undefined;
    /** D-32: injected by the tests in place of the real ReGa and UDP check. */
    readonly authenticator?: CredentialChecker | undefined;
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
    readonly images: DeviceImageService;
    /** The URL a browser should open, base path included. */
    readonly url: string;
    readonly port: number;
    readonly base: string;
    /** `undefined` when auth is off. */
    readonly token: string | undefined;
    /** D-32: how a browser is let in. */
    readonly authMode: AuthMode;
    /** D-32: the login sessions; `undefined` in `token` mode, where there are none. */
    readonly sessions: SessionStore | undefined;
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
    const authMode = options.authMode ?? 'token';
    requireLocalForRega(authMode, options, auth);

    // D-32: everything the login needs, and nothing at all in `token` mode
    const sessions = authMode === 'rega' ? new SessionStore(sessionStoreOptions(options)) : undefined;
    const loginLimit = authMode === 'rega' ? new RateLimiter() : undefined;
    const credentials =
        authMode === 'rega'
            ? (options.authenticator ??
              new RegaAuthenticator({
                  onNotice: (level, message) => log[level](`login: ${message}`),
              }))
            : undefined;

    let connection: AppConfig['connection'] | undefined;
    let backend: Backend | undefined;
    if (!demo) {
        await ensureDataDir(dataDir);
        backend = await Backend.open({
            dataDir,
            version: options.version ?? packageVersion(),
            fileRoots: {data: metadataDir, images: imageCacheDir},
            // D-31: only this host switches it on. `Backend` counts sessions, `ApiWebSocketServer`
            // reports them, and Electron's in-process transport reports none - so an Electron
            // window can never be idled out however the backend is configured.
            ...(options.idleUnsubscribeMs === undefined ? {} : {idleUnsubscribeMs: options.idleUnsubscribeMs}),
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

    const images = new DeviceImageService({
        icons: () => readIconMapFile(path.join(metadataDir, 'device-icons.json'), log),
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

        // D-32: the login is the one route that takes a POST, and the one route that is reachable
        // without a session - it is what hands one out
        if (sessions && rest === 'login') {
            if (method === 'POST') {
                await handleLogin(request, response);
                return;
            }
            if (method === 'GET' || method === 'HEAD') {
                sendLoginPage(request, response, 200, url.searchParams.get('lang'));
                return;
            }
        }

        if (method !== 'GET' && method !== 'HEAD') {
            response.writeHead(405, {Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8'});
            response.end('method not allowed\n');
            return;
        }

        let session: Session | undefined;
        if (sessions) {
            if (rest === 'logout') {
                sessions.remove(readCookie(request.headers.cookie, SESSION_COOKIE));
                response.writeHead(302, {
                    Location: `${base}login`,
                    'Set-Cookie': clearedSessionCookie(base, isHttps(request)),
                    'Cache-Control': 'no-store',
                });
                response.end();
                return;
            }
            session = sessions.get(readCookie(request.headers.cookie, SESSION_COOKIE));
            if (!session && !hasValidToken(request)) {
                // the page itself becomes the login form; anything else - assets, metadata, images -
                // is answered with a plain 401, because a login page in place of a stylesheet only
                // confuses a browser. The `settings.cgi` hand-over of task 13 never lands here: its
                // token cookie is accepted above, and the WebUI session it checked is why.
                if (rest === '' || rest === 'index.html') {
                    sendLoginPage(request, response, 200);
                } else {
                    unauthorised(response);
                }
                return;
            }
        }

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

        await serveStatic(
            request,
            response,
            uiDir,
            rest === '' ? 'index.html' : rest,
            method,
            // D-32: the sliding expiry, told to the browser as well - a tab in use keeps its
            // cookie alive, one that is not loses it when the host forgets the session
            session === undefined
                ? undefined
                : {'Set-Cookie': sessionCookie(session.id, base, (sessions?.ttlMs ?? 0) / 1000, isHttps(request))},
        );
    }

    /** The login form, in the language the visitor asked for or the browser prefers. */
    function sendLoginPage(
        request: IncomingMessage,
        response: ServerResponse,
        status: number,
        language?: string | null,
        error?: LoginError,
        user?: string,
    ): void {
        const chosen: LoginLanguage =
            language === 'de' || language === 'en'
                ? language
                : pickLanguage(language, request.headers['accept-language']);
        const body = renderLoginPage({base, language: chosen, error, user});
        response.writeHead(status, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Length': String(Buffer.byteLength(body)),
            // never cached: it is a form, and the page it replaces comes back the moment there is
            // a session
            'Cache-Control': 'no-store',
        });
        response.end(request.method === 'HEAD' ? undefined : body);
    }

    /**
     * The form's `POST`: rate limit, credentials, cookie, redirect.
     *
     * A wrong password and an unknown user leave by exactly the same door, and the failure is
     * counted against the *source*, never against the user name - locking out the CCU's admin by
     * guessing at it would be a denial of service anybody could run.
     */
    async function handleLogin(request: IncomingMessage, response: ServerResponse): Promise<void> {
        const form = parseLoginForm(await readBody(request), request.headers['accept-language']);
        const source = clientAddress(request);
        if (loginLimit?.blocked(source)) {
            log.warn(`login: too many failed attempts from ${source}`);
            sendLoginPage(request, response, 429, form.language, 'rate-limited', form.user);
            return;
        }
        let user: {name: string; level: number} | undefined;
        let failure: LoginError = 'credentials';
        try {
            user = form.user === '' ? undefined : await credentials?.authenticate(form.user, form.password);
        } catch (error) {
            // `RegaAuthenticator` answers "no" rather than throwing, so this is the unexpected case
            log.error('login failed:', error);
            failure = 'unavailable';
        }
        if (!user) {
            loginLimit?.fail(source);
            log.warn(`login: refused an attempt from ${source}`);
            sendLoginPage(request, response, 401, form.language, failure, form.user);
            return;
        }
        loginLimit?.clear(source);
        const session = (sessions as SessionStore).create(user.name, user.level);
        log.info(`login: ${user.name} (level ${String(user.level)}) from ${source}`);
        response.writeHead(302, {
            Location: base,
            'Set-Cookie': sessionCookie(session.id, base, (sessions as SessionStore).ttlMs / 1000, isHttps(request)),
            'Cache-Control': 'no-store',
        });
        response.end();
    }

    /** The token cookie of task 13 - `settings.cgi`'s hand-over still opens every door. */
    function hasValidToken(request: IncomingMessage): boolean {
        return token !== undefined && readCookie(request.headers.cookie, TOKEN_COOKIE) === token;
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
        extraHeaders?: Record<string, string> | undefined,
    ): Promise<void> {
        const file = await resolveStaticFile(root, relative);
        if (file === undefined) {
            notFound(response);
            return;
        }
        const isIndex = path.basename(file) === 'index.html' && root === uiDir;
        const headers = {
            ...(isIndex && issueCookie && token !== undefined ? {'Set-Cookie': tokenCookie(token, base)} : {}),
            ...(isIndex ? extraHeaders : undefined),
        };
        await sendFile(response, file, {
            method,
            ifNoneMatch: request.headers['if-none-match'],
            ...(Object.keys(headers).length > 0 ? {headers} : {}),
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
              // D-32: `session.info` is answered per socket, from the cookie this upgrade carried
              ...(sessions === undefined ? {} : {sessionInfo: (request) => sessionInfoOf(sessions, request)}),
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
            // D-32: and a login session opens the same socket, in the same way
            if (sessions) {
                applySessionToken(request, token, (id) => sessions.get(id) !== undefined);
            }
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
        // the sessions live in this process only, so stopping it is a logout for all of them
        sessions?.clear();
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
        authMode,
        sessions,
        close,
    };
}

/** Ensures the profile directory exists before the backend writes into it. */
export async function ensureDataDir(dataDir: string): Promise<void> {
    await fs.mkdir(path.join(dataDir, 'images'), {recursive: true});
}

/**
 * D-32: `rega` is refused anywhere it could not work, with the reason.
 *
 * Both services the login asks - ReGa's script port and the authentication daemon on UDP 1998 -
 * listen on the CCU's loopback and nowhere else (D-28 is the same story for BIN-RPC). A host that
 * is not *on* the CCU cannot reach either of them, so an npm or Docker install that asks for this
 * mode would show a login page that can never say yes. Failing at start-up with a sentence that
 * says why is the only useful answer.
 */
export function requireLocalForRega(authMode: AuthMode, options: WebHostOptions, auth: boolean): void {
    if (authMode !== 'rega') {
        return;
    }
    if (options.local !== true) {
        throw new Error(
            "--auth-mode rega needs --local: the CCU's ReGa (8183) and its authentication daemon (udp 1998) " +
                "listen on the CCU's own loopback, so the login can only be checked by a process running on the " +
                'CCU itself - the addon. Every other install type uses --auth-mode token.',
        );
    }
    if (!auth) {
        throw new Error(
            '--auth-mode rega cannot be combined with --no-auth: without a token the api socket lets everyone ' +
                'in anyway, and the login page would guard nothing.',
        );
    }
}

/** The session of an upgrade request, for the transport's `session.info`. */
export function sessionInfoOf(
    sessions: SessionStore,
    request: {headers: {cookie?: string | undefined}},
): SessionInfo | null {
    const session = sessions.get(readCookie(request.headers.cookie, SESSION_COOKIE));
    return session ? {user: session.user, level: session.level} : null;
}

/** Was this request made over TLS? Only then may a cookie carry `Secure` and still arrive. */
function isHttps(request: IncomingMessage): boolean {
    if ((request.socket as {encrypted?: boolean}).encrypted === true) {
        return true;
    }
    // behind a proxy that terminates TLS - the CCU's lighttpd on 443, or a reverse proxy
    const forwarded = request.headers['x-forwarded-proto'];
    const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return (value ?? '').split(',')[0]?.trim().toLowerCase() === 'https';
}

function sessionStoreOptions(options: WebHostOptions): {ttlMs?: number} {
    return options.sessionTtlMs === undefined || options.sessionTtlMs <= 0 ? {} : {ttlMs: options.sessionTtlMs};
}

function notFound(response: ServerResponse): void {
    response.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
    response.end('not found\n');
}

/** What everything that is not the page itself gets while there is no session. */
function unauthorised(response: ServerResponse): void {
    response.writeHead(401, {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store'});
    response.end('unauthorized\n');
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
    if (wantsHost || wantsLocal) {
        log.info(`connection: host=${connection.host}${connection.local === true ? ' (local)' : ''}`);
    }
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
