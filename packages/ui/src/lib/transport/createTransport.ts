import type {Transport} from '@homematic-manager/core';

import {MockTransport} from './MockTransport.js';
import {WebSocketTransport} from './WebSocketTransport.js';

/** The global an Electron preload sets to hand the renderer its IPC transport (task 11). */
export const HOST_TRANSPORT_GLOBAL = '__HMM_TRANSPORT__';

/** Just enough of `window.location` to build the WebSocket URL; a test passes a literal. */
export interface LocationLike {
    readonly protocol: string;
    readonly host: string;
    readonly pathname: string;
    readonly search: string;
}

export interface CreateTransportOptions {
    /** Defaults to `globalThis`. */
    readonly host?: Record<string, unknown> | undefined;
    /** Defaults to `window.location`. */
    readonly location?: LocationLike | undefined;
    /** Forces the demo transport regardless of the URL. */
    readonly demo?: boolean | undefined;
    /** Last path segment of the API endpoint. `api` by default. */
    readonly path?: string | undefined;
}

/**
 * The endpoint of the WebSocket API for a page location.
 *
 * The path is relative to the directory the page was served from, so the same bundle works at
 * `/` (apps/web), at `/addons/hmm/` behind the CCU's lighttpd (task 13) and at any other prefix
 * without a build-time base URL.
 */
export function apiUrl(location: LocationLike, path = 'api'): string {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const directory = location.pathname.replace(/[^/]*$/, '');
    return `${protocol}//${location.host}${directory}${path}`;
}

/** Is demo mode selected - by `?demo` in the URL or by the `VITE_HMM_DEMO` build flag? */
export function isDemoRequested(location: LocationLike | undefined): boolean {
    // `vite/client` types `import.meta.env` as always present, so the `?.` reads as pointless -
    // but this module is also loaded outside a vite build, where it is not. It has to stay written
    // exactly like this: vite replaces the literal text of `import.meta.env[...]` at build time,
    // and reading it through a variable first would leave the flag unreplaced.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- see above
    if (import.meta.env?.['VITE_HMM_DEMO'] === 'true') {
        return true;
    }
    if (!location) {
        return false;
    }
    return new URLSearchParams(location.search).has('demo');
}

/**
 * The transport this page should use.
 *
 * 1. Whatever the host injected as `window.__HMM_TRANSPORT__` - the Electron preload puts its
 *    context-isolated IPC bridge there, and it always wins.
 * 2. The demo fixture when the URL says `?demo` or the bundle was built with `VITE_HMM_DEMO`.
 * 3. Otherwise a WebSocket to the page's own origin.
 */
export function createTransport(options: CreateTransportOptions = {}): Transport {
    const host = options.host ?? (globalThis as unknown as Record<string, unknown>);
    const injected = host[HOST_TRANSPORT_GLOBAL];
    if (isTransport(injected)) {
        return injected;
    }
    const location =
        options.location ?? (typeof window === 'undefined' ? undefined : (window.location as LocationLike));
    if (options.demo === true || isDemoRequested(location)) {
        return new MockTransport({demo: true});
    }
    if (!location) {
        throw new Error('createTransport needs a location when there is no window and no injected transport');
    }
    return new WebSocketTransport({url: apiUrl(location, options.path ?? 'api')});
}

function isTransport(value: unknown): value is Transport {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Partial<Transport>;
    return (
        typeof candidate.request === 'function' &&
        typeof candidate.on === 'function' &&
        typeof candidate.onConnectionChange === 'function'
    );
}
