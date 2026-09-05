/**
 * How a browser gets the token the API socket wants.
 *
 * The backend's `ApiWebSocketServer.authorise()` accepts a token as `?token=` on the upgrade URL or
 * as a `Sec-WebSocket-Protocol` entry. The UI's `createTransport()` sends neither: it opens
 * `ws://<host>/<base>api` and knows nothing about tokens, and the browser `WebSocket` API cannot
 * set headers. So the page load hands the token over as a **cookie**, which the browser then
 * replays on the upgrade request of the same origin all by itself - the whole mechanism needs no
 * change in `packages/ui`.
 *
 * ```
 *   GET /            ->  200 index.html + Set-Cookie: hmm_token=...; Path=/; HttpOnly; SameSite=Strict
 *   GET /api  (ws)   ->  Cookie: hmm_token=...   ->  rewritten to /api?token=...  ->  101
 *   GET /api  (ws)   ->  no cookie, no ?token=   ->  401 from the backend's verifyClient
 * ```
 *
 * Who may be handed a cookie is the part that matters. `issueCookie` defaults to **on for a
 * loopback bind and off otherwise**: on `127.0.0.1` the machine boundary is the only thing between
 * a caller and the socket anyway, and development and the Playwright e2e of task 14 need the
 * browser to just work; on any other bind - and behind the CCU's lighttpd in task 13 - the cookie
 * has to come from `settings.cgi` after its `tclrega.so` session check, and this process must not
 * give one to whoever asks for the page.
 *
 * `?token=` keeps working for everything that is not a browser: `curl`, the e2e helper, and the
 * addon's CGI if it would rather put the token in the page than in a cookie.
 */

import {randomBytes} from 'node:crypto';

/** The cookie the page load sets and the upgrade request replays. */
export const TOKEN_COOKIE = 'hmm_token';

/**
 * D-32: the cookie the `rega` login issues instead.
 *
 * It is a *second* door to the same socket, not a replacement: the addon's `settings.cgi` keeps
 * handing out the token cookie after its WebUI session check, and a browser that has one is let in
 * without ever seeing the login page. Both are translated into the `?token=` the backend
 * understands on the upgrade request, so `packages/ui` still knows nothing about any of it.
 */
export const SESSION_COOKIE = 'hmm_session';

/** A fresh token: 32 hex characters, from the CSPRNG. */
export function createToken(): string {
    return randomBytes(16).toString('hex');
}

/** The value of `name` in a `Cookie:` header, or `undefined`. */
export function readCookie(header: string | undefined, name: string): string | undefined {
    if (!header) {
        return undefined;
    }
    for (const part of header.split(';')) {
        const index = part.indexOf('=');
        if (index === -1) {
            continue;
        }
        if (part.slice(0, index).trim() === name) {
            return decodeURIComponent(part.slice(index + 1).trim());
        }
    }
    return undefined;
}

/** The `Set-Cookie` value for a token, scoped to the base path the UI is served under. */
export function tokenCookie(token: string, base: string, secure = false): string {
    const parts = [`${TOKEN_COOKIE}=${encodeURIComponent(token)}`, `Path=${base}`, 'HttpOnly', 'SameSite=Strict'];
    if (secure) {
        parts.push('Secure');
    }
    return parts.join('; ');
}

/**
 * The `Set-Cookie` value for a session (D-32).
 *
 * `Max-Age` mirrors the server-side expiry and is re-sent on every page load, which is what makes
 * the sliding expiry visible to the browser as well: a tab that is being used keeps its cookie
 * alive, one that is not loses it at the same moment the host forgets the session.
 */
export function sessionCookie(id: string, base: string, maxAgeSeconds: number, secure = false): string {
    const parts = [
        `${SESSION_COOKIE}=${encodeURIComponent(id)}`,
        `Path=${base}`,
        `Max-Age=${String(Math.max(0, Math.floor(maxAgeSeconds)))}`,
        'HttpOnly',
        'SameSite=Strict',
    ];
    if (secure) {
        parts.push('Secure');
    }
    return parts.join('; ');
}

/** The `Set-Cookie` that ends a session in the browser as well; what logout answers with. */
export function clearedSessionCookie(base: string, secure = false): string {
    const parts = [`${SESSION_COOKIE}=`, `Path=${base}`, 'Max-Age=0', 'HttpOnly', 'SameSite=Strict'];
    if (secure) {
        parts.push('Secure');
    }
    return parts.join('; ');
}

/** Does the bind address mean "this machine only"? */
export function isLoopbackHost(host: string): boolean {
    const bare = host.replace(/^\[|]$/g, '').toLowerCase();
    return bare === 'localhost' || bare === '::1' || bare === '::ffff:127.0.0.1' || /^127\./.test(bare);
}

/** Does the request URL already carry a token? */
export function hasTokenQuery(url: string | undefined): boolean {
    return new URL(url ?? '/', 'http://localhost').searchParams.has('token');
}

/** The same URL with `token=<token>` appended - what the cookie is translated into. */
export function withTokenQuery(url: string | undefined, token: string): string {
    const parsed = new URL(url ?? '/', 'http://localhost');
    parsed.searchParams.set('token', token);
    return `${parsed.pathname}${parsed.search}`;
}

/**
 * Translates a valid token cookie into the `?token=` the backend understands, in place.
 *
 * Called on the upgrade request before `ws` sees it. It only ever *adds* the configured token to a
 * request that already proved it has it; a request with neither cookie nor query is left untouched
 * and the backend's own `verifyClient` answers it with a real 401.
 */
export function applyCookieToken(
    request: {url?: string | undefined; headers: {cookie?: string | undefined}},
    token: string | undefined,
): void {
    if (token === undefined || token === '' || hasTokenQuery(request.url)) {
        return;
    }
    if (readCookie(request.headers.cookie, TOKEN_COOKIE) === token) {
        request.url = withTokenQuery(request.url, token);
    }
}

/**
 * The same for the session cookie of D-32: a valid session opens the API socket exactly like the
 * token cookie does.
 *
 * `isValid` is the host's session store. The token itself never reaches the browser in this mode -
 * the session id is what the browser holds, and the host translates it here for the backend, which
 * only ever knew about tokens.
 */
export function applySessionToken(
    request: {url?: string | undefined; headers: {cookie?: string | undefined}},
    token: string | undefined,
    isValid: (id: string) => boolean,
): void {
    if (token === undefined || token === '' || hasTokenQuery(request.url)) {
        return;
    }
    const id = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (id !== undefined && id !== '' && isValid(id)) {
        request.url = withTokenQuery(request.url, token);
    }
}
