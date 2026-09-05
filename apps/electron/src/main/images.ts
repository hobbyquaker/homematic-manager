/**
 * Device images (D-10) for the Electron host.
 *
 * The chain itself - memory, disk cache, the CCU's four candidate URLs, the bundled webp subset,
 * nothing - is `@homematic-manager/backend`'s `DeviceImageService`. This host used to carry its
 * own copy, and that copy asked `/config/img/devices/50/<file>` only: task 13 measured on two
 * firmwares that **none** of the 278 file names of `device-icons.json` exists under that name, so
 * the desktop app never showed a picture from a CCU at all and fell through to the bundled subset,
 * which covers BidCos types only. Task 15 deleted the copy; what is left here is the wiring.
 *
 * All this module adds is the bridge from the service's two log levels to the host's error log
 * (`errorLog.append('images', ...)`), which is what the About dialog's log panel shows.
 */

import type {DeviceImageLog} from '@homematic-manager/backend';

export {
    cacheFileName,
    CCU_IMAGE_BASE,
    ccuImagePaths,
    ccuOrigin,
    DeviceImageService,
    imageMimeType,
    isSafeIconName,
    type DeviceImage,
    type DeviceImageLog,
    type DeviceImageServiceOptions,
    type ImageUpstream,
} from '@homematic-manager/backend';

/** Just enough of `ConnectionConfig` to build a URL to the CCU's web server. */
export interface ImageConnection {
    readonly host: string;
    readonly tls?: boolean;
    readonly auth?: {user: string; password: string} | undefined;
}

/**
 * A log for the image service that appends to the host's error log.
 *
 * `debug` is dropped: a missing picture is normal (a Homegear has no `/config/img` at all) and the
 * error log is a user-facing panel, not a trace. `warn` is what the service uses for the two things
 * a user can act on - a CCU that refuses the connection and a cache directory it cannot write.
 */
export function imageLog(append: (message: string) => void): DeviceImageLog {
    return {
        warn: (...parts: unknown[]) => append(parts.map(format).join(' ')),
        debug: () => undefined,
    };
}

function format(part: unknown): string {
    if (typeof part === 'string') {
        return part;
    }
    if (part instanceof Error) {
        return part.message;
    }
    try {
        return JSON.stringify(part) ?? String(part);
    } catch {
        return String(part);
    }
}
