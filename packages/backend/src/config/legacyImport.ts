/**
 * D-17: on first start 3.0 imports the configuration of 2.x once; the 2.x caches are discarded.
 *
 * 2.x stored its configuration with `persist-json@1.2.0` under the name `hm-manager`, and that
 * package resolves its directory through `persist-path@1.0.x`:
 *
 * | platform | directory |
 * | --- | --- |
 * | Windows | `%APPDATA%\hm-manager\` |
 * | macOS | `~/Library/Preferences/hm-manager/` |
 * | anything else | `~/.hm-manager/` |
 *
 * The file is named after the key `pjson.load('config')`, so it is literally `config` **without an
 * extension** - the roadmap's "config.json" is the intent, not the file name. Both are read, the
 * extension-less one first, because that is what 2.7.1 actually wrote. Next to it sat
 * `devices_<ccu>`, `names_<ccu>` and `paramset-descriptions-v2_<ccu>`; those are the caches D-17
 * throws away, and nothing here touches them.
 *
 * Nothing is ever written back into the 2.x directory, and a broken or absent file simply means
 * "nothing to import".
 */

import os from 'node:os';
import path from 'node:path';

import type {ConnectionConfig} from '@homematic-manager/core';

import {readJsonFile} from '../util/jsonFile.js';
import {DEFAULT_WRITE_PACE_MS, LANGUAGES, normaliseConnection} from './defaults.js';

/** The 2.x configuration, as far as anything of it is carried over. */
export interface LegacyConfig {
    readonly ccuAddress?: unknown;
    readonly useTLS?: unknown;
    readonly useAuth?: unknown;
    readonly user?: unknown;
    readonly pass?: unknown;
    readonly language?: unknown;
    readonly rpcDelay?: unknown;
    readonly rpcLogFolder?: unknown;
    readonly rpcInitIp?: unknown;
}

export interface LegacyEnvironment {
    readonly platform?: NodeJS.Platform;
    readonly appData?: string | undefined;
    readonly home?: string;
}

/** The directory `persist-json('hm-manager')` used on this platform. */
export function legacyConfigDir(environment: LegacyEnvironment = {}): string {
    const platform = environment.platform ?? process.platform;
    const appData = environment.appData ?? process.env['APPDATA'];
    const home = environment.home ?? os.homedir();
    if (appData !== undefined && appData !== '') {
        return path.join(appData, 'hm-manager');
    }
    if (platform === 'darwin') {
        return path.join(home, 'Library', 'Preferences', 'hm-manager');
    }
    return path.join(home, '.hm-manager');
}

/** The candidate files, in the order they are tried. */
export function legacyConfigFiles(environment: LegacyEnvironment = {}): string[] {
    const dir = legacyConfigDir(environment);
    return [path.join(dir, 'config'), path.join(dir, 'config.json')];
}

/** Reads the 2.x configuration; `undefined` when there is none. */
export async function readLegacyConfig(environment: LegacyEnvironment = {}): Promise<LegacyConfig | undefined> {
    for (const file of legacyConfigFiles(environment)) {
        const config = await readJsonFile<LegacyConfig>(file);
        if (config !== undefined && typeof config === 'object') {
            return config;
        }
    }
    return undefined;
}

/**
 * Maps the 2.x fields onto a `ConnectionConfig`. Everything else - the probed `daemons`, the
 * window state, `showUnhandled`, the caches - is dropped on purpose.
 */
export function connectionFromLegacy(legacy: LegacyConfig, base: ConnectionConfig): ConnectionConfig {
    const connection: Record<string, unknown> = {
        ...base,
        host: typeof legacy.ccuAddress === 'string' ? legacy.ccuAddress.trim() : base.host,
        tls: legacy.useTLS === true,
        // A 2.x configuration that names a language carries a real choice, so it is imported; one
        // that does not leaves the field alone, and the UI follows the browser (D-36). 2.x had no
        // setting at all in its first versions, so "missing" is the common case.
        language: LANGUAGES.find((candidate) => candidate === legacy.language) ?? base.language,
        writePaceMs:
            typeof legacy.rpcDelay === 'number' && Number.isFinite(legacy.rpcDelay) && legacy.rpcDelay >= 0
                ? Math.round(legacy.rpcDelay)
                : DEFAULT_WRITE_PACE_MS,
        rpcLogFolder: typeof legacy.rpcLogFolder === 'string' ? legacy.rpcLogFolder : base.rpcLogFolder,
        callback: {
            ...base.callback,
            ip: typeof legacy.rpcInitIp === 'string' ? legacy.rpcInitIp : base.callback.ip,
        },
    };
    if (legacy.useAuth === true && typeof legacy.user === 'string' && legacy.user !== '') {
        connection['auth'] = {user: legacy.user, password: typeof legacy.pass === 'string' ? legacy.pass : ''};
    }
    return normaliseConnection(connection);
}

/**
 * The imported connection, or `undefined` when there is no 2.x configuration worth importing (no
 * file, or one without a CCU address - importing an empty host would only hide the setup dialog).
 */
export async function importLegacyConnection(
    base: ConnectionConfig,
    environment: LegacyEnvironment = {},
): Promise<ConnectionConfig | undefined> {
    const legacy = await readLegacyConfig(environment);
    if (!legacy) {
        return undefined;
    }
    const connection = connectionFromLegacy(legacy, base);
    return connection.host === '' ? undefined : connection;
}
