/**
 * Where a CCU serves a device picture from.
 *
 * The same chain as `packages/backend/src/images/deviceImages.ts` - that module is the source of
 * truth, this is its copy for the tools, which are plain `.mjs` and do not build against the
 * TypeScript packages.
 *
 * Task 13 measured it on two CCU firmwares, against all 278 distinct file names of
 * `dist/device-icons.json`:
 *
 * | url | files found |
 * | --- | --- |
 * | `/config/img/devices/250/<file>` | 267 |
 * | `/config/img/devices/250/coupling/<file>` | 11 |
 * | `/config/img/devices/50/<base>_thumb<ext>` | 254 |
 * | `/config/img/devices/50/<file>` | **0** |
 *
 * The `50` directory holds the WebUI's list thumbnails and suffixes every name with `_thumb`. This
 * tool used to ask for `50/<file>` (with `250` reachable only through a `--size` option nobody
 * passed), so it downloaded nothing at all from a CCU.
 */

/** Where the CCU keeps its device pictures, in one directory per size. */
export const CCU_IMAGE_BASE = '/config/img/devices';

/**
 * The URLs to try for one file of `device-icons.json`, best first.
 *
 * @param {string} root the CCU's origin, without a trailing slash
 * @param {string} file a file name from `device-icons.json`
 * @returns {string[]}
 */
export function ccuImageUrls(root, file) {
    const dot = file.lastIndexOf('.');
    const base = dot === -1 ? file : file.slice(0, dot);
    const extension = dot === -1 ? '.png' : file.slice(dot);
    return [
        `${root}${CCU_IMAGE_BASE}/250/${file}`,
        `${root}${CCU_IMAGE_BASE}/250/coupling/${file}`,
        `${root}${CCU_IMAGE_BASE}/50/${base}_thumb${extension}`,
        `${root}${CCU_IMAGE_BASE}/50/${file}`,
    ];
}
