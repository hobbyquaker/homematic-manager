/**
 * Where the three directories the host needs live: the profile directory it hands the backend, the
 * built UI it serves, and the generated device metadata of task 9.
 *
 * Every one of them is an option (`--data-dir`, `--ui-dir`, `--metadata-dir`); these are only the
 * defaults, and they have to be right in three very different layouts - the repository checkout, an
 * installed desktop machine, and the CCU addon of task 13, where `app/` holds the compiled host
 * next to `ui/` and `data/`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/** The directory this module was loaded from - `apps/web/dist`, or `apps/web/src` under vitest. */
export const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * The profile directory: `config.json` and the per-CCU caches.
 *
 * The same place Electron's `app.getPath('userData')` picks, so the desktop app and the web host
 * of a development machine share one configuration instead of quietly diverging.
 */
export function defaultDataDir(
    env: NodeJS.ProcessEnv = process.env,
    platform: NodeJS.Platform = process.platform,
    home: string = os.homedir(),
): string {
    if (platform === 'win32') {
        return path.join(env['APPDATA'] ?? path.join(home, 'AppData', 'Roaming'), 'homematic-manager');
    }
    if (platform === 'darwin') {
        return path.join(home, 'Library', 'Application Support', 'homematic-manager');
    }
    return path.join(env['XDG_CONFIG_HOME'] ?? path.join(home, '.config'), 'homematic-manager');
}

/** The first candidate that contains `marker`, or the last one so the error message is useful. */
export function firstExisting(candidates: readonly string[], marker: string, exists = defaultExists): string {
    for (const candidate of candidates) {
        if (exists(path.join(candidate, marker))) {
            return candidate;
        }
    }
    return candidates.at(-1) ?? '';
}

/** Candidates for the built UI, most specific first. */
export function uiDirCandidates(base: string = moduleDir): string[] {
    return [
        // the addon and any other packed layout: the bundle sits next to the compiled host
        path.join(base, 'ui'),
        path.join(base, '..', 'ui'),
        // the repository: apps/web/dist -> packages/ui/dist
        path.resolve(base, '..', '..', '..', 'packages', 'ui', 'dist'),
    ];
}

/** Candidates for `data/dist` - the generated device metadata, icons and translations of task 9. */
export function metadataDirCandidates(base: string = moduleDir): string[] {
    return [
        path.join(base, 'data'),
        path.join(base, '..', 'data'),
        path.resolve(base, '..', '..', '..', 'data', 'dist'),
    ];
}

/** The built UI: `<ui-dir>/index.html` has to exist, or the host serves nothing. */
export function defaultUiDir(base: string = moduleDir, exists = defaultExists): string {
    return firstExisting(uiDirCandidates(base), 'index.html', exists);
}

/** The generated metadata: recognised by its `manifest.json`. */
export function defaultMetadataDir(base: string = moduleDir, exists = defaultExists): string {
    return firstExisting(metadataDirCandidates(base), 'manifest.json', exists);
}

/** Fallback when `package.json` cannot be found next to the compiled host. */
export const FALLBACK_VERSION = '3.0.0-dev.0';

/**
 * The version of this package, read from `package.json` at runtime.
 *
 * Not `import ... with {type: 'json'}`: that would pull the file into `rootDir` and make the
 * compiled layout depend on where the manifest sits, which the addon package rearranges.
 */
export function packageVersion(base: string = moduleDir): string {
    for (const candidate of [path.join(base, 'package.json'), path.resolve(base, '..', 'package.json')]) {
        try {
            const parsed: unknown = JSON.parse(fs.readFileSync(candidate, 'utf8'));
            const version = (parsed as {version?: unknown}).version;
            if (typeof version === 'string') {
                return version;
            }
        } catch {
            // next candidate
        }
    }
    return FALLBACK_VERSION;
}

function defaultExists(candidate: string): boolean {
    return fs.existsSync(candidate);
}
