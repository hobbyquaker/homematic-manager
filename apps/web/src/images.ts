/**
 * Device images (D-10): `<base>images/<deviceType>` - fetched from the connected CCU, cached on
 * disk, and falling back to the small webp subset that ships in `data/dist/icons/`.
 *
 * Which file belongs to a device type is the mapping `data/dist/device-icons.json` of task 9. That
 * mapping is also what makes the bundled fallback work: `data/scripts/icons-subset.mjs` wrote the
 * same base names as webp, so `4_hm-lc-sw1-fm.png` on the CCU is `4_hm-lc-sw1-fm.webp` here.
 *
 * *Where* the CCU serves that file from was measured on the lab CCU during task 13, against all 278
 * distinct file names in the mapping:
 *
 * | url | files found |
 * | --- | --- |
 * | `/config/img/devices/250/<file>` | 267 |
 * | `/config/img/devices/250/coupling/<file>` | 11 |
 * | `/config/img/devices/50/<base>_thumb<ext>` | 254 |
 * | `/config/img/devices/50/<file>` | **0** |
 *
 * The `50` directory holds the WebUI's list thumbnails and suffixes every name with `_thumb`, so
 * the single `50/<file>` this used to ask for never existed and every picture came from the bundled
 * subset - which only covers the BidCos types, so an HmIP device had none at all. The two `250`
 * shapes together cover all 278, and are tried first; the `_thumb` shape stays as a fallback in
 * case a firmware differs, and the historical one is kept because it costs nothing.
 *
 * The order is memory -> disk -> CCU -> bundled -> 404. A CCU that is off therefore costs one
 * failed request per device type and then serves the bundled picture, and a Homegear or bare rfd
 * installation - which has no `/config/img` at all - only ever sees the bundled one (D-2: the app
 * has to work fully without a CCU's web server).
 *
 * The disk cache is `<data-dir>/images/`, which is also the `images` root the backend's `data.file`
 * is given, so a picture fetched here is readable through the API as well.
 *
 * **Known limitation**: with `tls` the CCU's certificate is self-signed, and `fetch` has no
 * per-request way to accept it. Such a request fails and the bundled picture is served instead.
 * The addon of task 13 runs on the CCU and talks plain http to `127.0.0.1`, so it is unaffected.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import type {Logger} from './log.js';
import {silentLogger} from './log.js';
import {mimeType} from './static.js';

/** Where the CCU keeps its device pictures, in one directory per size. */
export const CCU_IMAGE_BASE = '/config/img/devices';

/**
 * The urls to try for one file of `device-icons.json`, best first. See the table at the top for
 * what each of them is worth on a real CCU.
 */
export function ccuImagePaths(iconFile: string): string[] {
    const parsed = path.parse(iconFile);
    const extension = parsed.ext === '' ? '.png' : parsed.ext;
    return [
        `${CCU_IMAGE_BASE}/250/${iconFile}`,
        `${CCU_IMAGE_BASE}/250/coupling/${iconFile}`,
        `${CCU_IMAGE_BASE}/50/${parsed.name}_thumb${extension}`,
        `${CCU_IMAGE_BASE}/50/${iconFile}`,
    ];
}

/** The key `device-icons.json` uses for "no idea what this is". */
export const UNKNOWN_DEVICE_KEY = 'DEVICE';

/** How long a fetch from the CCU may take before the bundled picture wins. */
export const DEFAULT_IMAGE_TIMEOUT_MS = 5000;

/** How many pictures are kept decoded in memory; the rest is one `readFile` away. */
export const MEMORY_CACHE_LIMIT = 200;

/** The CCU to ask, as the image service needs it. */
export interface ImageUpstream {
    readonly host: string;
    readonly tls?: boolean | undefined;
    readonly auth?: {user: string; password: string} | undefined;
}

export interface ImageServiceOptions {
    /** `data/dist/device-icons.json`. */
    readonly iconMapFile: string;
    /** `data/dist/icons` - the bundled webp subset. */
    readonly fallbackDir: string;
    /** `<data-dir>/images` - what was fetched from the CCU. */
    readonly cacheDir: string;
    /** The current connection, read fresh on every miss: the CCU can change while we run. */
    readonly upstream: () => ImageUpstream | undefined;
    readonly fetch?: typeof globalThis.fetch;
    readonly timeoutMs?: number;
    readonly log?: Logger;
}

export interface DeviceImage {
    readonly mime: string;
    readonly body: Buffer;
    readonly source: 'memory' | 'disk' | 'ccu' | 'bundled';
}

/** A file name that cannot escape the cache directory, whatever the device type looked like. */
export function cacheFileName(deviceType: string, iconFile: string): string {
    const extension = path.extname(iconFile) || '.png';
    return `${deviceType.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120)}${extension}`;
}

/** Serves `<base>images/<deviceType>`. */
export class ImageService {
    readonly #options: ImageServiceOptions;
    readonly #log: Logger;
    readonly #memory = new Map<string, DeviceImage>();
    #icons: Record<string, string> | undefined;

    constructor(options: ImageServiceOptions) {
        this.#options = options;
        this.#log = options.log ?? silentLogger;
    }

    /** The device-type to file-name mapping, read once. */
    async icons(): Promise<Record<string, string>> {
        if (this.#icons) {
            return this.#icons;
        }
        try {
            const parsed: unknown = JSON.parse(await fs.readFile(this.#options.iconMapFile, 'utf8'));
            this.#icons = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : {};
        } catch (error) {
            this.#log.warn(`device-icons.json is not readable (${this.#options.iconMapFile}):`, error);
            this.#icons = {};
        }
        return this.#icons;
    }

    /** The picture for a device type, or `undefined` when there is not even a fallback. */
    async get(deviceType: string): Promise<DeviceImage | undefined> {
        const cached = this.#memory.get(deviceType);
        if (cached) {
            return {...cached, source: 'memory'};
        }
        const icons = await this.icons();
        // openccu-data keys the mapping by the upper-cased type; the CCU reports `HM-LC-Sw1-Pl`
        const iconFile = icons[deviceType] ?? icons[deviceType.toUpperCase()] ?? icons[UNKNOWN_DEVICE_KEY];
        if (iconFile === undefined) {
            return undefined;
        }
        const cacheFile = path.join(this.#options.cacheDir, cacheFileName(deviceType, iconFile));
        const fromDisk = await readIfPresent(cacheFile);
        if (fromDisk) {
            return this.#remember(deviceType, {mime: mimeType(cacheFile), body: fromDisk, source: 'disk'});
        }
        const fetched = await this.#fetch(iconFile);
        if (fetched) {
            await this.#store(cacheFile, fetched);
            return this.#remember(deviceType, {mime: mimeType(iconFile), body: fetched, source: 'ccu'});
        }
        const fallbackFile = path.join(this.#options.fallbackDir, `${path.parse(iconFile).name}.webp`);
        const fallback = await readIfPresent(fallbackFile);
        if (fallback) {
            // deliberately not written to the cache directory: it is not what the CCU would send,
            // and a CCU that comes back later has to be able to replace it
            return this.#remember(deviceType, {mime: 'image/webp', body: fallback, source: 'bundled'});
        }
        this.#log.debug(`no image for device type ${deviceType} (${iconFile})`);
        return undefined;
    }

    async #fetch(iconFile: string): Promise<Buffer | undefined> {
        const upstream = this.#options.upstream();
        if (!upstream || upstream.host === '') {
            return undefined;
        }
        const request = this.#options.fetch ?? globalThis.fetch;
        const scheme = upstream.tls === true ? 'https' : 'http';
        const headers: Record<string, string> = {};
        if (upstream.auth) {
            const credentials = Buffer.from(`${upstream.auth.user}:${upstream.auth.password}`).toString('base64');
            headers['Authorization'] = `Basic ${credentials}`;
        }
        for (const candidate of ccuImagePaths(iconFile)) {
            const url = `${scheme}://${upstream.host}${candidate}`;
            try {
                const response = await request(url, {
                    headers,
                    signal: AbortSignal.timeout(this.#options.timeoutMs ?? DEFAULT_IMAGE_TIMEOUT_MS),
                });
                if (response.ok) {
                    return Buffer.from(await response.arrayBuffer());
                }
                this.#log.debug(`${url} answered ${response.status}`);
            } catch (error) {
                // a refused connection or a timeout is about the CCU, not about this file name:
                // trying the other three would only multiply the wait before the bundled picture
                this.#log.debug(`${url} failed:`, error);
                return undefined;
            }
        }
        return undefined;
    }

    async #store(file: string, body: Buffer): Promise<void> {
        try {
            await fs.mkdir(path.dirname(file), {recursive: true});
            await fs.writeFile(file, body);
        } catch (error) {
            // a read-only profile directory is a nuisance, never a reason to fail the request
            this.#log.warn(`image cache is not writable (${file}):`, error);
        }
    }

    #remember(deviceType: string, image: DeviceImage): DeviceImage {
        if (this.#memory.size >= MEMORY_CACHE_LIMIT) {
            const oldest = this.#memory.keys().next();
            if (!oldest.done) {
                this.#memory.delete(oldest.value);
            }
        }
        this.#memory.set(deviceType, image);
        return image;
    }
}

async function readIfPresent(file: string): Promise<Buffer | undefined> {
    try {
        return await fs.readFile(file);
    } catch {
        return undefined;
    }
}
