/**
 * Device images (D-10): `<base>images/<deviceType>`.
 *
 * The chain - memory, disk cache, the CCU's four candidate URLs, the bundled webp subset, nothing -
 * is `@homematic-manager/backend`'s `DeviceImageService` and is documented there. It used to live
 * here, and a second, wrong copy lived in `apps/electron`; task 15 moved it into the backend so
 * that both hosts fetch the same pictures from the same places (task 11 and task 13 had both asked
 * for that).
 *
 * This module is the npm package's view of it: the tarball bundles the backend (D-29), so a
 * consumer of `homematic-manager` cannot import those symbols from anywhere else.
 *
 * The disk cache is `<data-dir>/images/`, which is also the `images` root the backend's `data.file`
 * is given, so a picture fetched here is readable through the API as well.
 */

export {
    cacheFileName,
    CCU_IMAGE_BASE,
    ccuImagePaths,
    ccuOrigin,
    DEFAULT_IMAGE_TIMEOUT_MS,
    DeviceImageService,
    imageMimeType,
    isSafeIconName,
    MEMORY_CACHE_LIMIT,
    readIconMapFile,
    UNKNOWN_DEVICE_KEY,
    type DeviceImage,
    type DeviceImageLog,
    type DeviceImageServiceOptions,
    type DeviceImageSource,
    type ImageUpstream,
} from '@homematic-manager/backend';
