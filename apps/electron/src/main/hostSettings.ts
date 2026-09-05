/**
 * The handful of settings that belong to the host and not to the backend.
 *
 * The backend's `config.json` is the CCU connection and nothing else, and its shape is the API
 * contract - a flag about the Electron updater has no place in it. So the host keeps its own
 * `host.json` next to it.
 *
 * There is exactly one setting today: `disableAutoUpdate` (D-16). Whoever repackages the app -
 * a distribution, a Nix expression, someone who builds it himself - ships an update channel the
 * updater must not fight with, and can turn it off either with this file or with the environment
 * variable `HMM_DISABLE_AUTO_UPDATE`, which needs no writable profile at all.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface HostSettings {
    /** Never check for updates, never notify, never install (D-16). */
    disableAutoUpdate: boolean;
}

export const DEFAULT_HOST_SETTINGS: HostSettings = {disableAutoUpdate: false};

/** The environment variable that turns the updater off without a file. */
export const DISABLE_AUTO_UPDATE_ENV = 'HMM_DISABLE_AUTO_UPDATE';

/** Reads `host.json`; anything unreadable or malformed is the default, never an error. */
export function readHostSettings(
    file: string,
    environment: Readonly<Record<string, string | undefined>> = process.env,
): HostSettings {
    const fromEnvironment = truthy(environment[DISABLE_AUTO_UPDATE_ENV]);
    let stored: unknown;
    try {
        stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        stored = undefined;
    }
    const value = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {};
    return {disableAutoUpdate: fromEnvironment || value['disableAutoUpdate'] === true};
}

/** Writes `host.json`. Used by nothing yet; the file is hand-written until task 8 has a switch. */
export function writeHostSettings(file: string, settings: HostSettings): void {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}

function truthy(value: string | undefined): boolean {
    return value !== undefined && value !== '' && value !== '0' && value.toLowerCase() !== 'false';
}
