/**
 * Device images (D-10).
 *
 * The CCU carries a PNG for every device type under `/config/img/devices/50/`, and that is where
 * the pictures in the device grid come from. They are not redistributable, so the app fetches them
 * from the CCU the user is connected to and keeps them in a cache under `userData/images`; a small
 * webp subset ships with the app for people on Homegear or a bare rfd, who have no CCU to ask.
 *
 * Order per lookup: the disk cache, then the CCU, then the bundled subset. Nothing here blocks the
 * UI - the renderer asks through the `hmm-image://` protocol and gets a picture or a 404, and a
 * CCU that is off simply means the bundled fallback or no image at all.
 *
 * The module imports nothing from Electron: `fetch`, the two directories and the connection are
 * injected, which is what lets the test drive the whole chain without a network.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

/** What the cache hands back, ready for a `Response`. */
export interface DeviceImage {
    readonly mime: string;
    readonly body: Buffer;
    /** Where it came from, for the log and for the test. */
    readonly source: 'cache' | 'ccu' | 'bundled';
}

/** Just enough of `ConnectionConfig` to build a URL to the CCU's web server. */
export interface ImageConnection {
    readonly host: string;
    readonly tls?: boolean;
    readonly auth?: {user: string; password: string} | undefined;
}

export interface DeviceImageCacheOptions {
    /** Where fetched images are kept, normally `<userData>/images`. */
    readonly cacheDir: string;
    /** The bundled webp subset, normally `<resources>/data/icons`. */
    readonly bundledDir: string;
    /** `data/dist/device-icons.json`: device type -> file name on the CCU. */
    readonly iconMap: () => Promise<Readonly<Record<string, string>>>;
    /** The CCU to ask, or `undefined` while none is configured. */
    readonly connection: () => ImageConnection | undefined;
    /** Injected by the test. */
    readonly fetch?: typeof globalThis.fetch;
    /** The CCU's image size directory. 50 is what 2.x used in the grid. */
    readonly size?: number;
    /** Give up on a CCU that does not answer; a picture is never worth a hanging window. */
    readonly timeoutMs?: number;
    readonly onError?: (message: string) => void;
}

const MIME: Readonly<Record<string, string>> = {
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
};

/** The content type for a file name, or `undefined` for one we would not serve. */
export function mimeOf(file: string): string | undefined {
    return MIME[path.extname(file).toLowerCase()];
}

/**
 * A file name from `device-icons.json`, as a name and nothing else.
 *
 * The map is generated data, but it decides a path under the cache directory and a URL on the CCU,
 * so it is treated as input: anything with a separator or a `..` in it is refused rather than
 * cleaned up.
 */
export function isSafeIconName(file: string): boolean {
    return /^[A-Za-z0-9][A-Za-z0-9._@ +-]*$/.test(file) && !file.includes('..') && mimeOf(file) !== undefined;
}

/** The URL of the CCU's web server, or `undefined` when no host is configured. */
export function ccuOrigin(connection: ImageConnection | undefined): string | undefined {
    if (!connection?.host) {
        return undefined;
    }
    return `${connection.tls === true ? 'https' : 'http'}://${connection.host}`;
}

/** Device images, cached on disk. One instance per app; the protocol handler is its only user. */
export class DeviceImageCache {
    readonly #options: DeviceImageCacheOptions;
    readonly #fetch: typeof globalThis.fetch;
    readonly #inFlight = new Map<string, Promise<DeviceImage | undefined>>();
    #map: Promise<Readonly<Record<string, string>>> | undefined;

    constructor(options: DeviceImageCacheOptions) {
        this.#options = options;
        this.#fetch = options.fetch ?? globalThis.fetch;
    }

    /**
     * The image of a device type, or `undefined` when there is none anywhere. Two requests for the
     * same type while one is in flight share the answer - the device grid asks for a hundred rows
     * at once and most of them are the same handful of types.
     */
    async get(deviceType: string): Promise<DeviceImage | undefined> {
        const running = this.#inFlight.get(deviceType);
        if (running) {
            return running;
        }
        const pending = this.#resolve(deviceType).finally(() => this.#inFlight.delete(deviceType));
        this.#inFlight.set(deviceType, pending);
        return pending;
    }

    /** The file name the CCU knows this device type under. */
    async fileFor(deviceType: string): Promise<string | undefined> {
        this.#map ??= this.#options.iconMap().catch((error: unknown) => {
            this.#map = undefined;
            this.#report(`device-icons.json could not be read: ${message(error)}`);
            return {};
        });
        const map = await this.#map;
        const file = map[deviceType] ?? map[deviceType.toUpperCase()];
        if (file === undefined) {
            return undefined;
        }
        return isSafeIconName(file) ? file : undefined;
    }

    async #resolve(deviceType: string): Promise<DeviceImage | undefined> {
        const file = await this.fileFor(deviceType);
        if (file === undefined) {
            return undefined;
        }
        return (await this.#fromCache(file)) ?? (await this.#fromCcu(file)) ?? (await this.#bundled(file));
    }

    async #fromCache(file: string): Promise<DeviceImage | undefined> {
        try {
            const body = await fs.readFile(path.join(this.#options.cacheDir, file));
            return {mime: mimeOf(file) ?? 'application/octet-stream', body, source: 'cache'};
        } catch {
            return undefined;
        }
    }

    async #fromCcu(file: string): Promise<DeviceImage | undefined> {
        const origin = ccuOrigin(this.#options.connection());
        if (origin === undefined) {
            return undefined;
        }
        const size = this.#options.size ?? 50;
        // Ten upstream entries live in the CCU's `coupling/` subdirectory; the map has no path.
        const urls = [
            `${origin}/config/img/devices/${size}/${file}`,
            `${origin}/config/img/devices/${size}/coupling/${file}`,
        ];
        for (const url of urls) {
            const body = await this.#download(url);
            if (body === undefined) {
                continue;
            }
            await this.#store(file, body);
            return {mime: mimeOf(file) ?? 'application/octet-stream', body, source: 'ccu'};
        }
        return undefined;
    }

    async #download(url: string): Promise<Buffer | undefined> {
        const auth = this.#options.connection()?.auth;
        const headers: Record<string, string> = auth
            ? {authorization: `Basic ${Buffer.from(`${auth.user}:${auth.password}`).toString('base64')}`}
            : {};
        try {
            const response = await this.#fetch(url, {
                headers,
                signal: AbortSignal.timeout(this.#options.timeoutMs ?? 5000),
            });
            if (!response.ok) {
                return undefined;
            }
            return Buffer.from(await response.arrayBuffer());
        } catch (error) {
            this.#report(`${url}: ${message(error)}`);
            return undefined;
        }
    }

    async #store(file: string, body: Buffer): Promise<void> {
        const target = path.join(this.#options.cacheDir, file);
        try {
            await fs.mkdir(this.#options.cacheDir, {recursive: true});
            await fs.writeFile(`${target}.tmp`, body);
            await fs.rename(`${target}.tmp`, target);
        } catch (error) {
            this.#report(`${target} could not be written: ${message(error)}`);
        }
    }

    async #bundled(file: string): Promise<DeviceImage | undefined> {
        // The subset is webp; the map names the CCU's png.
        const webp = `${path.basename(file, path.extname(file))}.webp`;
        try {
            const body = await fs.readFile(path.join(this.#options.bundledDir, webp));
            return {mime: 'image/webp', body, source: 'bundled'};
        } catch {
            return undefined;
        }
    }

    #report(text: string): void {
        this.#options.onError?.(text);
    }
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
