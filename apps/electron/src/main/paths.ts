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
    /**
     * `app.getAppPath()`. Not the checkout's `apps/electron` as reliably as task 11 assumed: it is
     * that only when Electron is started with a directory, and `out/main` when it is started with
     * the built bundle, which is how the smoke test and `npm run preview` start it.
     */
    readonly appPath: string;
    /** `app.getPath('userData')`. */
    readonly userData: string;
    /** The directory of the main bundle itself; the search for `data/dist` starts here. */
    readonly mainDir?: string;
    /** Injected so the test can describe a tree without building one. */
    readonly exists?: (candidate: string) => boolean;
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
    const data = inputs.packaged ? path.join(inputs.resourcesPath, 'data') : developmentDataDir(inputs);
    return {
        data,
        icons: path.join(data, 'icons'),
        images: path.join(inputs.userData, 'images'),
        logs: path.join(inputs.userData, 'logs'),
        userData: inputs.userData,
        hostSettingsFile: path.join(inputs.userData, 'host.json'),
    };
}

/**
 * Where `data/dist` is in a checkout, found rather than assumed.
 *
 * Two guesses at a fixed depth were wrong, and both silently: `apps/electron` up two is the
 * checkout when Electron was started with a directory, and `apps/electron/out/main` up two is
 * `apps/electron/data/dist`, which does not exist. Nothing complains about that - the images just
 * stop appearing, and `data/device-icons.json` reads as an empty map - which is how assertion 6 of
 * the smoke test came back 404 for a device type the bundled subset has.
 *
 * So the directory is searched for instead, upwards from the main bundle: the first ancestor with
 * a `data/dist` in it wins. When there is none, the old formula is the answer, because a wrong
 * path that is looked for is still better than no path at all.
 */
function developmentDataDir(inputs: PathInputs): string {
    const fallback = path.resolve(inputs.appPath, '..', '..', 'data', 'dist');
    const exists = inputs.exists;
    if (exists === undefined) {
        return fallback;
    }
    let directory = path.resolve(inputs.mainDir ?? inputs.appPath);
    for (;;) {
        const candidate = path.join(directory, 'data', 'dist');
        if (exists(candidate)) {
            return candidate;
        }
        const parent = path.dirname(directory);
        if (parent === directory) {
            return fallback;
        }
        directory = parent;
    }
}

/** What the backend's `fileRoots` option is given: the prefixes the UI may read under. */
export function fileRoots(paths: HostPaths): Record<string, string> {
    return {data: paths.data, images: paths.images};
}
