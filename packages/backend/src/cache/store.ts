/**
 * Everything the backend keeps about one CCU, and what of it survives a restart.
 *
 * Persisted (per host, under `<dataDir>/cache/<host>/`): the device descriptions, the paramset
 * descriptions, the local names and the unreach counters of #26. Not persisted: RSSI, service
 * messages and the event buffer - all three are a snapshot of the radio's current state and a stale
 * one is worse than none. The unreach counters are the opposite: they are a history, and a history
 * that is thrown away on restart answers no question at all.
 *
 * The files are written debounced (`DebouncedJsonFile`), so a CCU that reports 400 devices in one
 * burst causes one write, not 400 as 2.x did, and a file whose content did not change is not
 * written at all (`writeJsonFile`). The paramset descriptions are one file per interface and device
 * type under `descriptions/`; the single `descriptions.json` of 3.5 and older is read once, split
 * and removed. The unreach counters wait a minute before they are written: a device that flaps
 * produces an edge per minute or more, and losing the last minute of counts to a power cut costs
 * less than writing the file after each one.
 */

import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
    RingBuffer,
    RssiStore,
    ServiceMessageStore,
    type EventRecord,
    type ServiceMessage,
} from '@homematic-manager/core';

import {DebouncedJsonFile, readJsonFile, removeFile, writeJsonFile} from '../util/jsonFile.js';
import {DeviceCache} from './devices.js';
import {ParamsetDescriptionCache} from './descriptions.js';
import {NameStore} from './names.js';
import {UnreachCache} from './unreach.js';

export interface CacheStoreOptions {
    /** `<dataDir>/cache/<host>`; created on the first write. */
    readonly cacheDir: string;
    /** Injected clock, so the tests get stable timestamps. */
    readonly now?: () => number;
    /** How many events the ring keeps; the 2.x grid held 8192. */
    readonly eventBufferSize?: number;
    /** Debounce of the cache files. */
    readonly writeDelayMs?: number;
    /** Debounce of `unreach.json`; a minute by default, `writeDelayMs` when only that is given. */
    readonly unreachWriteDelayMs?: number;
    /** A cache that cannot be written is reported, never thrown. */
    readonly onError?: (error: unknown) => void;
}

/** How long the unreach counters wait before they are written. */
export const UNREACH_WRITE_DELAY_MS = 60_000;

/** A file name made of anything: letters, digits, `-` and `_` stay, the rest is `%xx`, lower-cased. */
function safeName(name: string): string {
    const safe = [...Buffer.from(name, 'utf8')]
        .map((byte) => {
            const char = String.fromCharCode(byte);
            return /[A-Za-z0-9_-]/.test(char) ? char : `%${byte.toString(16).padStart(2, '0')}`;
        })
        .join('');
    return (safe === '' ? '%' : safe).toLowerCase();
}

/** The `.json` files one level below the shard directory; none when it does not exist. */
async function shardFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    let interfaces: string[];
    try {
        interfaces = await fs.readdir(dir);
    } catch {
        return files;
    }
    for (const interfaceDir of interfaces.sort()) {
        let names: string[];
        try {
            names = await fs.readdir(path.join(dir, interfaceDir));
        } catch {
            continue;
        }
        for (const name of names.sort()) {
            if (name.endsWith('.json')) {
                files.push(path.join(dir, interfaceDir, name));
            }
        }
    }
    return files;
}

/** The caches of one connection. */
export class CacheStore {
    readonly devices = new DeviceCache();
    readonly descriptions = new ParamsetDescriptionCache();
    readonly names = new NameStore();
    /** Issue #26: how often each device went unreachable. Persisted - that is the whole point. */
    readonly unreach = new UnreachCache();
    readonly serviceMessages: ServiceMessageStore;
    readonly events: RingBuffer<EventRecord>;

    readonly #rssi = new Map<string, RssiStore>();
    readonly #now: () => number;
    readonly #deviceFile: DebouncedJsonFile<unknown>;
    readonly #descriptionFiles = new Map<string, DebouncedJsonFile<unknown>>();
    readonly #nameFile: DebouncedJsonFile<unknown>;
    readonly #unreachFile: DebouncedJsonFile<unknown>;
    readonly #cacheDir: string;
    readonly #fileOptions: {delayMs: number; onError?: (error: unknown) => void};

    constructor(options: CacheStoreOptions) {
        this.#now = options.now ?? (() => Date.now());
        this.serviceMessages = new ServiceMessageStore({now: this.#now});
        this.events = new RingBuffer<EventRecord>(options.eventBufferSize);
        const fileOptions = {
            delayMs: options.writeDelayMs ?? 500,
            ...(options.onError ? {onError: options.onError} : {}),
        };
        this.#cacheDir = options.cacheDir;
        this.#fileOptions = fileOptions;
        this.#deviceFile = new DebouncedJsonFile(`${options.cacheDir}/devices.json`, fileOptions);
        this.#nameFile = new DebouncedJsonFile(`${options.cacheDir}/names.json`, fileOptions);
        this.#unreachFile = new DebouncedJsonFile(`${options.cacheDir}/unreach.json`, {
            ...fileOptions,
            delayMs: options.unreachWriteDelayMs ?? options.writeDelayMs ?? UNREACH_WRITE_DELAY_MS,
        });
    }

    /** The directory of the description shards. */
    get #descriptionDir(): string {
        return path.join(this.#cacheDir, 'descriptions');
    }

    /** The single description file of 3.5 and older. */
    get #legacyDescriptionFile(): string {
        return path.join(this.#cacheDir, 'descriptions.json');
    }

    /**
     * The file of one shard: `descriptions/<interface>/<type>.<hash>.json`. The name is the device
     * type made safe for every file system, lower-cased, and the hash of the exact type keeps two
     * types that differ only in case (`HMIP-eTRV`, `HmIP-eTRV`) apart where names do not.
     */
    #descriptionFile(shard: string): DebouncedJsonFile<unknown> {
        const existing = this.#descriptionFiles.get(shard);
        if (existing) {
            return existing;
        }
        const separator = shard.indexOf('/');
        const interfaceName = shard.slice(0, separator);
        const deviceType = shard.slice(separator + 1);
        const hash = createHash('sha256').update(deviceType).digest('hex').slice(0, 8);
        const file = new DebouncedJsonFile<unknown>(
            path.join(this.#descriptionDir, safeName(interfaceName), `${safeName(deviceType)}.${hash}.json`),
            this.#fileOptions,
        );
        this.#descriptionFiles.set(shard, file);
        return file;
    }

    /** The RSSI matrix of one interface; created on first use. */
    rssi(interfaceName: string): RssiStore {
        const existing = this.#rssi.get(interfaceName);
        if (existing) {
            return existing;
        }
        const store = new RssiStore();
        this.#rssi.set(interfaceName, store);
        return store;
    }

    /** Reads the persisted caches. Never throws; a missing file means "nothing cached". */
    async load(): Promise<void> {
        this.devices.load(await this.#deviceFile.read());
        await this.#loadDescriptions();
        this.names.load(await this.#nameFile.read());
        this.unreach.load(await this.#unreachFile.read());
    }

    /** Every shard file, then the single file of 3.5 and older, which is split once and removed. */
    async #loadDescriptions(): Promise<void> {
        this.descriptions.load(undefined);
        for (const file of await shardFiles(this.#descriptionDir)) {
            this.descriptions.merge(await readJsonFile(file));
        }
        const legacy = await readJsonFile<unknown>(this.#legacyDescriptionFile);
        if (legacy === undefined) {
            return;
        }
        this.descriptions.merge(legacy);
        this.descriptions.takeDirty();
        try {
            await Promise.all(
                this.descriptions
                    .shards()
                    .map((shard) =>
                        writeJsonFile(this.#descriptionFile(shard).file, this.descriptions.shardSnapshot(shard)),
                    ),
            );
            await removeFile(this.#legacyDescriptionFile);
        } catch (error) {
            // the old file stays and is split again next time; the cache in memory is complete
            this.#fileOptions.onError?.(error);
        }
    }

    saveDevices(): void {
        this.#deviceFile.save(this.devices.toJSON());
    }

    /** Writes the shards that gained (or lost) something, and only those. */
    saveDescriptions(): void {
        for (const shard of this.descriptions.takeDirty()) {
            const snapshot = this.descriptions.shardSnapshot(shard);
            const file = this.#descriptionFile(shard);
            if (Object.keys(snapshot).length === 0) {
                void file.remove();
            } else {
                file.save(snapshot);
            }
        }
    }

    saveNames(): void {
        this.#nameFile.save(this.names.toJSON());
    }

    saveUnreach(): void {
        this.#unreachFile.save(this.unreach.toJSON());
    }

    /** Writes whatever is pending; part of `Backend.stop()`. */
    async flush(): Promise<void> {
        await Promise.all([
            this.#deviceFile.flush(),
            ...[...this.#descriptionFiles.values()].map((file) => file.flush()),
            this.#nameFile.flush(),
            this.#unreachFile.flush(),
        ]);
    }

    /** `config.clearCaches`: empties everything in memory and removes the three files. */
    async clear(): Promise<void> {
        this.devices.clear();
        this.descriptions.clear();
        this.names.clear();
        this.unreach.clear();
        this.#rssi.clear();
        this.events.clear();
        for (const interfaceName of this.serviceMessages.list().map((message) => message.interfaceName)) {
            this.serviceMessages.replaceInterface(interfaceName, []);
        }
        this.descriptions.takeDirty();
        await Promise.all([
            this.#deviceFile.remove(),
            ...[...this.#descriptionFiles.values()].map((file) => file.remove()),
            this.#nameFile.remove(),
            this.#unreachFile.remove(),
            removeFile(this.#legacyDescriptionFile),
        ]);
        this.#descriptionFiles.clear();
        // shards of another session (a type this one never touched) go with the directory
        await fs.rm(this.#descriptionDir, {recursive: true, force: true}).catch(() => undefined);
    }

    /** The service messages in the shape the contract asks for. */
    listServiceMessages(interfaceName?: string): ServiceMessage[] {
        const records =
            interfaceName === undefined
                ? this.serviceMessages.list()
                : this.serviceMessages.forInterface(interfaceName);
        return records.map((record) => ({
            interfaceName: record.interfaceName,
            address: record.address,
            datapoint: record.datapoint,
            value: record.value,
            since: record.timestamp,
        }));
    }
}
