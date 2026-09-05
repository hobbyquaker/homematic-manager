/**
 * `data.file`: the one method through which the UI reads files from disk.
 *
 * The UI needs two kinds of file it cannot fetch itself: the generated device metadata of task 9
 * (`data/dist/**.json`, loaded lazily per channel type through the core's `DataSource`) and cached
 * device images (D-10). Neither may turn into "read any file the backend user can read", so the
 * roots are injected by the host and every request is resolved against them: a path that leaves its
 * root, a root that is not configured or an extension that is not on the list is refused.
 *
 * Symlinks are resolved before the check, so a link inside a root that points outside it does not
 * get through either.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import {configError} from '../errors.js';

/** What may be read, and how it is returned. */
export const DATA_FILE_TYPES: Readonly<Record<string, 'json' | 'text' | 'binary'>> = {
    '.json': 'json',
    '.txt': 'text',
    '.md': 'text',
    '.csv': 'text',
    '.svg': 'text',
    '.png': 'binary',
    '.webp': 'binary',
    '.jpg': 'binary',
    '.jpeg': 'binary',
    '.gif': 'binary',
    '.ico': 'binary',
};

/** A binary file, as the transports can carry it. */
export interface BinaryFile {
    readonly path: string;
    readonly mime: string;
    readonly base64: string;
}

const MIME: Readonly<Record<string, string>> = {
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
};

export interface DataFileServerOptions {
    /**
     * The readable roots, keyed by the prefix the UI uses: `{data: '<repo>/data/dist', images:
     * '<userData>/images'}` makes `data/manifest.json` and `images/HmIP-PDT.webp` readable.
     */
    readonly roots: Readonly<Record<string, string>>;
}

/** Reads files from a fixed set of directories, and nothing else. */
export class DataFileServer {
    readonly #roots: Map<string, string>;

    constructor(options: DataFileServerOptions) {
        this.#roots = new Map(Object.entries(options.roots).map(([name, dir]) => [name, path.resolve(dir)]));
    }

    /** The configured prefixes, for a diagnostic. */
    get roots(): string[] {
        return [...this.#roots.keys()];
    }

    /**
     * Reads `<root>/<rest>`. JSON is parsed, text returned as a string, an image as
     * {@link BinaryFile}. Rejects with `kind: 'config'` for anything outside the roots.
     */
    async read(request: string): Promise<unknown> {
        const resolved = await this.#resolve(request);
        const kind = DATA_FILE_TYPES[path.extname(resolved).toLowerCase()];
        if (kind === undefined) {
            throw configError(`"${request}" has a file type that may not be read`);
        }
        if (kind === 'binary') {
            const content = await fs.readFile(resolved);
            const extension = path.extname(resolved).toLowerCase();
            return {
                path: request,
                mime: MIME[extension] ?? 'application/octet-stream',
                base64: content.toString('base64'),
            } satisfies BinaryFile;
        }
        const text = await fs.readFile(resolved, 'utf8');
        if (kind === 'text') {
            return text;
        }
        try {
            return JSON.parse(text) as unknown;
        } catch (error) {
            throw configError(`"${request}" is not valid JSON: ${error instanceof Error ? error.message : ''}`);
        }
    }

    async #resolve(request: string): Promise<string> {
        const normalised = request.replace(/\\/g, '/').replace(/^\/+/, '');
        const [prefix, ...rest] = normalised.split('/');
        const root = prefix === undefined ? undefined : this.#roots.get(prefix);
        if (root === undefined || rest.length === 0) {
            throw configError(`"${request}" is not under one of the readable roots (${this.roots.join(', ')})`);
        }
        const candidate = path.resolve(root, ...rest);
        const realRoot = await realpathOr(root);
        const real = await realpathOr(candidate);
        if (!isInside(realRoot, real) || !isInside(root, candidate)) {
            throw configError(`"${request}" leaves its root`);
        }
        return candidate;
    }
}

function isInside(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** The real path, or the path itself when it does not exist yet (the read fails afterwards). */
async function realpathOr(target: string): Promise<string> {
    try {
        return await fs.realpath(target);
    } catch {
        return target;
    }
}
