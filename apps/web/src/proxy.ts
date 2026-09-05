/**
 * The development mode: everything that is not the API is passed through to a vite dev server.
 *
 * The alternative - run vite and the host side by side and let the browser talk to two origins -
 * does not work without changing `packages/ui`: `createTransport()` builds the socket URL from the
 * page's own location, so a page on `localhost:5173` opens `ws://localhost:5173/api`, which vite
 * answers with its own HMR socket. Proxying the other way round keeps one origin, and with it the
 * relative `api` path, the cookie and the base-path behaviour that production has.
 *
 * Both directions are needed: the HTTP requests for the module graph, and the upgrade of vite's
 * own HMR socket, which the client opens on the page's origin.
 */

import http from 'node:http';
import type {IncomingMessage, ServerResponse} from 'node:http';
import type {Duplex} from 'node:stream';

import type {Logger} from './log.js';
import {silentLogger} from './log.js';

/** Hop-by-hop headers a proxy must not forward (RFC 9110 7.6.1). */
const HOP_BY_HOP = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
]);

export interface ProxyOptions {
    readonly target: URL;
    readonly log?: Logger;
}

/** Forwards one request to the dev server and streams the answer back. */
export function proxyRequest(options: ProxyOptions, request: IncomingMessage, response: ServerResponse): void {
    const log = options.log ?? silentLogger;
    const upstream = http.request(
        {
            protocol: options.target.protocol,
            hostname: options.target.hostname,
            port: options.target.port,
            method: request.method ?? 'GET',
            path: request.url ?? '/',
            headers: forwardable(request.headers, options.target.host),
        },
        (answer) => {
            response.writeHead(answer.statusCode ?? 502, forwardable(answer.headers));
            answer.pipe(response);
        },
    );
    upstream.on('error', (error) => {
        log.warn(`dev server ${options.target.href} is not reachable:`, error);
        if (!response.headersSent) {
            response.writeHead(502, {'Content-Type': 'text/plain; charset=utf-8'});
        }
        response.end('the vite dev server is not reachable\n');
    });
    request.pipe(upstream);
}

/** Forwards an upgrade - vite's HMR socket - and pipes the two sockets into each other. */
export function proxyUpgrade(options: ProxyOptions, request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const log = options.log ?? silentLogger;
    const upstream = http.request({
        protocol: options.target.protocol,
        hostname: options.target.hostname,
        port: options.target.port,
        method: 'GET',
        path: request.url ?? '/',
        headers: {...request.headers, host: options.target.host},
    });
    upstream.on('upgrade', (answer, upstreamSocket, upstreamHead) => {
        socket.write(statusAndHeaders(answer));
        if (upstreamHead.length > 0) {
            socket.write(upstreamHead);
        }
        if (head.length > 0) {
            upstreamSocket.write(head);
        }
        // both directions, on error and on close: a half-dead pair would keep the dev server's
        // `close()` waiting forever, and an upgraded socket is not one `closeAllConnections()` sees
        for (const [one, other] of [
            [upstreamSocket, socket],
            [socket, upstreamSocket],
        ]) {
            one?.on('error', () => other?.destroy());
            one?.on('close', () => other?.destroy());
        }
        upstreamSocket.pipe(socket).pipe(upstreamSocket);
    });
    upstream.on('response', (answer) => {
        // the upstream refused to upgrade - a 401 from the token check, a 404 from a wrong path.
        // That answer is forwarded verbatim, which is what a browser needs to see and what
        // lighttpd's mod_proxy does; destroying the socket would turn it into a hang-up.
        socket.write(statusAndHeaders(answer));
        answer.pipe(socket);
    });
    upstream.on('error', (error) => {
        log.warn(`dev server upgrade to ${options.target.href} failed:`, error);
        socket.destroy();
    });
    upstream.end();
}

/** An answer as the raw bytes a socket that is no longer an HTTP response object needs. */
function statusAndHeaders(answer: IncomingMessage): string {
    const statusLine = `HTTP/1.1 ${answer.statusCode ?? 101} ${answer.statusMessage ?? 'Switching Protocols'}`;
    const lines = Object.entries(answer.headers).flatMap(([name, value]) =>
        (Array.isArray(value) ? value : [value]).map((entry) => `${name}: ${String(entry)}`),
    );
    return `${[statusLine, ...lines].join('\r\n')}\r\n\r\n`;
}

function forwardable(headers: http.IncomingHttpHeaders, host?: string): Record<string, string | string[]> {
    const result: Record<string, string | string[]> = {};
    for (const [name, value] of Object.entries(headers)) {
        if (value === undefined || HOP_BY_HOP.has(name.toLowerCase())) {
            continue;
        }
        result[name] = value;
    }
    if (host !== undefined) {
        result['host'] = host;
    }
    return result;
}
