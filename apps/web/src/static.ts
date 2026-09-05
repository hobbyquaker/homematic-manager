/**
 * Static files from one directory, and nothing else.
 *
 * The whole UI is a `index.html` plus hashed assets (`packages/ui` builds with `base: './'`), and
 * `data/dist` is JSON and webp - so this needs a MIME table, conditional requests and a firm
 * refusal of everything that tries to leave the root. It deliberately does **not** do directory
 * listings, `..` normalisation tricks or an `index.html` fallback for arbitrary paths: the UI
 * routes on the hash (`#/<interface>/<tab>`), so a 404 for `/nope` is a 404 and not the app shell.
 *
 * The traversal check is the one from the backend's `DataFileServer`: resolve the candidate, follow
 * symlinks, and require the result to still be inside the root.
 */

import fs from 'node:fs/promises';
import type {ServerResponse} from 'node:http';
import path from 'node:path';

/** What the UI bundle, the metadata and the icon cache are made of. */
export const MIME_TYPES: Readonly<Record<string, string>> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.wasm': 'application/wasm',
};

/** One year, which is what an asset whose name contains its content hash may claim. */
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** Everything else: revalidate, so a rebuilt `index.html` is picked up at once. */
export const REVALIDATE_CACHE_CONTROL = 'no-cache';

export function mimeType(file: string): string {
    return MIME_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Does this file name carry a content hash, so it may be cached forever?
 *
 * vite writes `assets/index-C9tqDdX1.js`; the suffix is base64url of at least eight characters. A
 * hand-written `logo-v2.svg` does not match, and gets the revalidating header instead.
 */
export function isImmutableAsset(file: string): boolean {
    return /-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(path.basename(file));
}

/** Is `candidate` inside `root`, and not the root itself? */
export function isInside(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * The absolute path of `relative` inside `root`, or `undefined` when it may not be served: a
 * traversal, a NUL byte, an undecodable escape, a directory, or a file that is not there.
 */
export async function resolveStaticFile(root: string, relative: string): Promise<string | undefined> {
    let decoded: string;
    try {
        decoded = decodeURIComponent(relative);
    } catch {
        return undefined;
    }
    if (decoded.includes('\0')) {
        return undefined;
    }
    const segments = decoded.split('/').filter((segment) => segment !== '' && segment !== '.');
    if (segments.length === 0 || segments.includes('..')) {
        return undefined;
    }
    const resolvedRoot = path.resolve(root);
    const candidate = path.resolve(resolvedRoot, ...segments);
    if (!isInside(resolvedRoot, candidate)) {
        return undefined;
    }
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
        // realpath first: a symlink inside the root that points out of it must not get through
        const real = await fs.realpath(candidate);
        const realRoot = await fs.realpath(resolvedRoot);
        if (!isInside(realRoot, real)) {
            return undefined;
        }
        stat = await fs.stat(real);
    } catch {
        return undefined;
    }
    return stat.isFile() ? candidate : undefined;
}

/** A weak validator built from what a `stat` knows; enough to answer a reload with a 304. */
export function etagOf(size: number, mtimeMs: number): string {
    return `W/"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`;
}

export interface SendFileOptions {
    /** `HEAD` sends the headers and no body. */
    readonly method?: string | undefined;
    readonly ifNoneMatch?: string | undefined;
    /** Extra headers - the token cookie of the page load. */
    readonly headers?: Readonly<Record<string, string>> | undefined;
}

/** Writes a file with its MIME type, its caching headers and a 304 when the client has it. */
export async function sendFile(response: ServerResponse, file: string, options: SendFileOptions = {}): Promise<void> {
    const stat = await fs.stat(file);
    const etag = etagOf(stat.size, stat.mtimeMs);
    const headers: Record<string, string> = {
        'Content-Type': mimeType(file),
        'Cache-Control': isImmutableAsset(file) ? IMMUTABLE_CACHE_CONTROL : REVALIDATE_CACHE_CONTROL,
        ETag: etag,
        'Last-Modified': new Date(stat.mtimeMs).toUTCString(),
        ...options.headers,
    };
    if (options.ifNoneMatch === etag) {
        response.writeHead(304, headers);
        response.end();
        return;
    }
    headers['Content-Length'] = String(stat.size);
    response.writeHead(200, headers);
    if (options.method === 'HEAD') {
        response.end();
        return;
    }
    response.end(await fs.readFile(file));
}
