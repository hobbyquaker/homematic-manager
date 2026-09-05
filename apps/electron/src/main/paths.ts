/**
 * Where everything lives, in development and in a packaged app.
 *
 * The backend reads its data with `fs` through `data.file`, so it needs real directories, not
 * bundle URLs - and the two layouts differ: in development `data/dist` is a sibling of
 * `apps/electron` in the checkout, in a packaged app it is `resources/data` next to the asar (see
 * `extraResources` in electron-builder.yml, and `asarUnpack` for the same reason).
 *
 * Pure string work, injected inputs, no Electron: the test can check both layouts on any OS.
 */

import path from 'node:path';

export interface PathInputs {
    /** `app.isPackaged`. */
    readonly packaged: boolean;
    /** `process.resourcesPath`; only meaningful when packaged. */
    readonly resourcesPath: string;
    /** `app.getAppPath()`: the checkout's `apps/electron` in development. */
    readonly appPath: string;
    /** `app.getPath('userData')`. */
    readonly userData: string;
}

export interface HostPaths {
    /** The generated device metadata of task 9; `data.file` serves it under the prefix `data`. */
    readonly data: string;
    /** The bundled webp subset of the device images (D-10). */
    readonly icons: string;
    /** The disk cache of device images fetched from the CCU (D-10). */
    readonly images: string;
    /** `userData/logs`, where the unhandled-error log goes. */
    readonly logs: string;
    /** The profile directory the backend gets as its `dataDir`. */
    readonly userData: string;
    /** Host-owned settings that are not part of the backend's configuration. */
    readonly hostSettingsFile: string;
}

/**
 * The directories for one run.
 *
 * `data.file` is given two roots, `data` and `images`, and nothing else - which is why the cache
 * directory is next to the profile rather than inside the data directory: the app writes to one
 * and only reads from the other.
 */
export function resolvePaths(inputs: PathInputs): HostPaths {
    const data = inputs.packaged
        ? path.join(inputs.resourcesPath, 'data')
        : path.resolve(inputs.appPath, '..', '..', 'data', 'dist');
    return {
        data,
        icons: path.join(data, 'icons'),
        images: path.join(inputs.userData, 'images'),
        logs: path.join(inputs.userData, 'logs'),
        userData: inputs.userData,
        hostSettingsFile: path.join(inputs.userData, 'host.json'),
    };
}

/** What the backend's `fileRoots` option is given: the prefixes the UI may read under. */
export function fileRoots(paths: HostPaths): Record<string, string> {
    return {data: paths.data, images: paths.images};
}
