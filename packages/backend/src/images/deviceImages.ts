/**
 * Device images (D-10), one implementation for every host.
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
 * The `50` directory holds the WebUI's list thumbnails and suffixes every name with `_thumb`, so a
 * plain `50/<file>` never exists and every picture came from the bundled subset - which only covers
 * the BidCos types, so an HmIP device had none at all. The two `250` shapes together cover all 278
 * and are tried first; the `_thumb` shape stays as a fallback in case a firmware differs, and the
 * historical one is kept because it costs nothing.
 *
 * The order is memory -> disk -> CCU -> bundled -> none. A CCU that is off therefore costs one
 * failed request per device type and then serves the bundled picture, and a Homegear or bare rfd
 * installation - which has no `/config/img` at all - only ever sees the bundled one (D-2: the app
 * has to work fully without a CCU's web server).
 *
 * Task 11 and task 13 both asked for this to live in one place: `apps/electron` had a second copy
 * that still asked for `50/<file>` only, so the desktop app showed the bundled subset and nothing
 * else. The hosts keep their own wrappers (an HTTP route in `apps/web`, an `hmm-image://` protocol
 * handler in `apps/electron`) but the chain, the caching and the safety checks are this module.
 *
 * **Known limitation**: with `tls` the CCU's certificate is self-signed, and `fetch` has no
 * per-request way to accept it. Such a request fails and the bundled picture is served instead.
 * The addon of task 13 runs on the CCU and talks plain http to `127.0.0.1`, so it is unaffected.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

/** Where the CCU keeps its device pictures, in one directory per size. */
export const CCU_IMAGE_BASE = '/config/img/devices';

/** The key `device-icons.json` uses for "no idea what this is". */
export const UNKNOWN_DEVICE_KEY = 'DEVICE';

/** How long a fetch from the CCU may take before the bundled picture wins. */
export const DEFAULT_IMAGE_TIMEOUT_MS = 5000;

/** How many pictures are kept decoded in memory; the rest is one `readFile` away. */
export const MEMORY_CACHE_LIMIT = 200;

/** The content types the CCU's pictures and the bundled subset use. */
export const IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
};

/** The content type for a file name, or `undefined` for one we would not serve. */
export function imageMimeType(file: string): string | undefined {
    return IMAGE_MIME_TYPES[path.extname(file).toLowerCase()];
}

/**
 * A file name from `device-icons.json`, as a name and nothing else.
 *
 * The map is generated data, but it decides a path under the cache directory and a URL on the CCU,
 * so it is treated as input: anything with a separator or a `..` in it is refused rather than
 * cleaned up.
 */
export function isSafeIconName(file: string): boolean {
    return /^[A-Za-z0-9][A-Za-z0-9._@ +-]*$/.test(file) && !file.includes('..') && imageMimeType(file) !== undefined;
}

/**
 * The paths to try for one file of `device-icons.json`, best first. See the table at the top for
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

/** The CCU to ask, as the image service needs it. */
export interface ImageUpstream {
    readonly host: string;
    readonly tls?: boolean | undefined;
    readonly auth?: {user: string; password: string} | undefined;
}

/** The URL of the CCU's web server, or `undefined` when no host is configured. */
export function ccuOrigin(upstream: ImageUpstream | undefined): string | undefined {
    if (upstream === undefined || upstream.host === '') {
        return undefined;
    }
    return `${upstream.tls === true ? 'https' : 'http'}://${upstream.host}`;
}

/** A file name that cannot escape the cache directory, whatever the device type looked like. */
export function cacheFileName(deviceType: string, iconFile: string): string {
    const extension = path.extname(iconFile) || '.png';
    return `${deviceType.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120)}${extension}`;
}

/** Where a picture came from; `memory` and `disk` are the two cache levels. */
export type DeviceImageSource = 'memory' | 'disk' | 'ccu' | 'bundled';

export interface DeviceImage {
    readonly mime: string;
    readonly body: Buffer;
    readonly source: DeviceImageSource;
}

/**
 * The two levels this module logs at. `apps/web`'s `Logger` satisfies it as it is; the Electron
 * host wraps its error log.
 */
export interface DeviceImageLog {
    warn(...parts: unknown[]): void;
    debug(...parts: unknown[]): void;
}

const silentLog: DeviceImageLog = {warn: () => undefined, debug: () => undefined};

export interface DeviceImageServiceOptions {
    /** `data/dist/device-icons.json`, read once and kept; a failure means "no mapping". */
    readonly icons: () => Promise<Readonly<Record<string, string>>>;
    /** `data/dist/icons` - the bundled webp subset. */
    readonly fallbackDir: string;
    /** `<profile>/images` - what was fetched from the CCU. */
    readonly cacheDir: string;
    /** The current connection, read fresh on every miss: the CCU can change while we run. */
    readonly upstream: () => ImageUpstream | undefined;
    readonly fetch?: typeof globalThis.fetch;
    readonly timeoutMs?: number;
    readonly memoryLimit?: number;
    readonly log?: DeviceImageLog;
}

/**
 * Reads `device-icons.json`. Anything unreadable or unparsable is a warning and an empty mapping:
 * a missing picture is never a reason to fail a request.
 */
export async function readIconMapFile(
    file: string,
    log: DeviceImageLog = silentLog,
): Promise<Readonly<Record<string, string>>> {
    try {
        const parsed: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
        return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : {};
    } catch (error) {
        log.warn(`device-icons.json is not readable (${file}):`, error);
        return {};
    }
}

/** Device pictures, cached in memory and on disk. One instance per host. */
export class DeviceImageService {
    readonly #options: DeviceImageServiceOptions;
    readonly #log: DeviceImageLog;
    readonly #memory = new Map<string, DeviceImage>();
    readonly #inFlight = new Map<string, Promise<DeviceImage | undefined>>();
    #icons: Promise<Readonly<Record<string, string>>> | undefined;

    constructor(options: DeviceImageServiceOptions) {
        this.#options = options;
        this.#log = options.log ?? silentLog;
    }

    /** The device-type to file-name mapping, read once. */
    async icons(): Promise<Readonly<Record<string, string>>> {
        this.#icons ??= this.#options.icons().catch((error: unknown) => {
            this.#icons = undefined;
            this.#log.warn('device-icons.json could not be read:', error);
            return {};
        });
        return this.#icons;
    }

    /** The file name the CCU knows this device type under, or `undefined`. */
    async fileFor(deviceType: string): Promise<string | undefined> {
        const icons = await this.icons();
        // openccu-data keys the mapping by the upper-cased type; the CCU reports `HM-LC-Sw1-Pl`
        const file = icons[deviceType] ?? icons[deviceType.toUpperCase()] ?? icons[UNKNOWN_DEVICE_KEY];
        if (file === undefined) {
            return undefined;
        }
        return isSafeIconName(file) ? file : undefined;
    }

    /**
     * The picture for a device type, or `undefined` when there is not even a fallback. Two requests
     * for the same type while one is in flight share the answer - the device grid asks for a
     * hundred rows at once and most of them are the same handful of types.
     */
    async get(deviceType: string): Promise<DeviceImage | undefined> {
        const cached = this.#memory.get(deviceType);
        if (cached) {
            return {...cached, source: 'memory'};
        }
        const running = this.#inFlight.get(deviceType);
        if (running) {
            return running;
        }
        const pending = this.#resolve(deviceType).finally(() => this.#inFlight.delete(deviceType));
        this.#inFlight.set(deviceType, pending);
        return pending;
    }

    async #resolve(deviceType: string): Promise<DeviceImage | undefined> {
        const iconFile = await this.fileFor(deviceType);
        if (iconFile === undefined) {
            return undefined;
        }
        const cacheFile = path.join(this.#options.cacheDir, cacheFileName(deviceType, iconFile));
        const fromDisk = await readIfPresent(cacheFile);
        if (fromDisk) {
            return this.#remember(deviceType, {mime: mimeOrDefault(cacheFile), body: fromDisk, source: 'disk'});
        }
        const fetched = await this.#fetch(iconFile);
        if (fetched) {
            await this.#store(cacheFile, fetched);
            return this.#remember(deviceType, {mime: mimeOrDefault(iconFile), body: fetched, source: 'ccu'});
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
        const origin = ccuOrigin(this.#options.upstream());
        if (origin === undefined) {
            return undefined;
        }
        const request = this.#options.fetch ?? globalThis.fetch;
        const auth = this.#options.upstream()?.auth;
        const headers: Record<string, string> = auth
            ? {Authorization: `Basic ${Buffer.from(`${auth.user}:${auth.password}`).toString('base64')}`}
            : {};
        for (const candidate of ccuImagePaths(iconFile)) {
            const url = `${origin}${candidate}`;
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
                this.#log.warn(`${url} failed:`, error);
                return undefined;
            }
        }
        return undefined;
    }

    async #store(file: string, body: Buffer): Promise<void> {
        try {
            await fs.mkdir(path.dirname(file), {recursive: true});
            // written next to the target and renamed, so a crash mid-write cannot leave a
            // truncated picture that the disk level would then serve forever
            await fs.writeFile(`${file}.tmp`, body);
            await fs.rename(`${file}.tmp`, file);
        } catch (error) {
            // a read-only profile directory is a nuisance, never a reason to fail the request
            this.#log.warn(`image cache could not be written (${file}):`, error);
        }
    }

    #remember(deviceType: string, image: DeviceImage): DeviceImage {
        const limit = this.#options.memoryLimit ?? MEMORY_CACHE_LIMIT;
        if (this.#memory.size >= limit) {
            const oldest = this.#memory.keys().next();
            if (!oldest.done) {
                this.#memory.delete(oldest.value);
            }
        }
        this.#memory.set(deviceType, image);
        return image;
    }
}

function mimeOrDefault(file: string): string {
    return imageMimeType(file) ?? 'application/octet-stream';
}

async function readIfPresent(file: string): Promise<Buffer | undefined> {
    try {
        return await fs.readFile(file);
    } catch {
        return undefined;
    }
}
