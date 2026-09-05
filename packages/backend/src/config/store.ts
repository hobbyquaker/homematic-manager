/**
 * Where the backend keeps its state on disk.
 *
 * Everything lives under one injected profile directory - Electron passes `app.getPath('userData')`
 * (task 11), the web host and the addon pass their own, and a test passes a temporary directory:
 *
 * ```
 * <dataDir>/config.json                    the AppConfig
 * <dataDir>/cache/<host>/devices.json      device descriptions per interface
 * <dataDir>/cache/<host>/descriptions.json paramset descriptions by identity
 * <dataDir>/cache/<host>/names.json        the local name store
 * <dataDir>/cache/<host>/write-log.json    the session write log
 * ```
 *
 * The cache directory is keyed by host so that switching between two CCUs does not mix their
 * device lists - 2.x achieved the same with the `_<ccuAddress>` suffix on every persist-json key.
 * D-17's one-time import of the 2.x configuration happens exactly when there is no `config.json`
 * yet, which is the only definition of "first start" that survives a reinstall.
 */

import path from 'node:path';

import type {AppConfig, ConnectionConfig, DiscoveredCcu} from '@homematic-manager/core';

import {localIPv4Addresses} from '../util/net.js';
import {readJsonFile, writeJsonFile} from '../util/jsonFile.js';
import {defaultConnection, normaliseConnection} from './defaults.js';
import {importLegacyConnection, type LegacyEnvironment} from './legacyImport.js';

/** A host as a directory name: everything unusual becomes `_`. */
export function hostKey(host: string): string {
    const key = host
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '_');
    return key === '' ? 'unconfigured' : key;
}

export interface ConfigStoreOptions {
    /** The profile directory; created on the first write. */
    readonly dataDir: string;
    /** `AppConfig.version`, the app's version string. */
    readonly version: string;
    /** Injected for the tests. */
    readonly localAddresses?: () => string[];
    /** Import the 2.x configuration when there is none of our own (D-17). Default: yes. */
    readonly importLegacy?: boolean;
    /** Where the 2.x configuration is looked for; injected by the tests. */
    readonly legacyEnvironment?: LegacyEnvironment;
}

/** The persisted `AppConfig` plus the derived fields the UI wants with it. */
export class ConfigStore {
    readonly dataDir: string;
    readonly file: string;

    readonly #version: string;
    readonly #localAddresses: () => string[];

    #connection: ConnectionConfig;
    #discovered: DiscoveredCcu[] = [];
    /** True when the connection came from the 2.x configuration on this start (D-17). */
    #importedFromLegacy = false;

    private constructor(options: ConfigStoreOptions, connection: ConnectionConfig, imported: boolean) {
        this.dataDir = options.dataDir;
        this.file = path.join(options.dataDir, 'config.json');
        this.#version = options.version;
        this.#localAddresses = options.localAddresses ?? (() => localIPv4Addresses());
        this.#connection = connection;
        this.#importedFromLegacy = imported;
    }

    /** Loads the configuration, importing the 2.x one when this is the first start (D-17). */
    static async open(options: ConfigStoreOptions): Promise<ConfigStore> {
        const file = path.join(options.dataDir, 'config.json');
        const stored = await readJsonFile<{connection?: unknown}>(file);
        if (stored !== undefined) {
            return new ConfigStore(options, normaliseConnection(stored.connection), false);
        }
        const base = defaultConnection();
        const imported =
            options.importLegacy === false
                ? undefined
                : await importLegacyConnection(base, options.legacyEnvironment ?? {});
        const store = new ConfigStore(options, imported ?? base, imported !== undefined);
        await store.save();
        return store;
    }

    get importedFromLegacy(): boolean {
        return this.#importedFromLegacy;
    }

    get connection(): ConnectionConfig {
        return this.#connection;
    }

    /** What `config.get` answers. */
    get config(): AppConfig {
        return {
            version: this.#version,
            connection: this.#connection,
            localAddresses: this.#localAddresses(),
            discovered: this.#discovered,
        };
    }

    /** Replaces the connection and persists it. */
    async setConnection(connection: unknown): Promise<AppConfig> {
        this.#connection = normaliseConnection(connection);
        this.#importedFromLegacy = false;
        await this.save();
        return this.config;
    }

    /** The result of the last UDP discovery; kept in memory only. */
    setDiscovered(discovered: readonly DiscoveredCcu[]): void {
        this.#discovered = [...discovered];
    }

    /** The cache directory of the configured host. */
    get cacheDir(): string {
        return path.join(this.dataDir, 'cache', hostKey(this.#connection.host));
    }

    /** One file inside the cache directory of the configured host. */
    cacheFile(name: string): string {
        return path.join(this.cacheDir, name);
    }

    async save(): Promise<void> {
        await writeJsonFile(this.file, {version: this.#version, connection: this.#connection});
    }
}
