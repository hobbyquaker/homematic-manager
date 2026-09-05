/**
 * Everything the backend keeps about one CCU, and what of it survives a restart.
 *
 * Persisted (per host, under `<dataDir>/cache/<host>/`): the device descriptions, the paramset
 * descriptions and the local names. Not persisted: RSSI, service messages and the event buffer -
 * all three are a snapshot of the radio's current state and a stale one is worse than none.
 *
 * The three files are written debounced (`DebouncedJsonFile`), so a CCU that reports 400 devices in
 * one burst causes one write, not 400 as 2.x did.
 */

import {
    RingBuffer,
    RssiStore,
    ServiceMessageStore,
    type EventRecord,
    type ServiceMessage,
} from '@homematic-manager/core';

import {DebouncedJsonFile} from '../util/jsonFile.js';
import {DeviceCache} from './devices.js';
import {ParamsetDescriptionCache} from './descriptions.js';
import {NameStore} from './names.js';

export interface CacheStoreOptions {
    /** `<dataDir>/cache/<host>`; created on the first write. */
    readonly cacheDir: string;
    /** Injected clock, so the tests get stable timestamps. */
    readonly now?: () => number;
    /** How many events the ring keeps; the 2.x grid held 8192. */
    readonly eventBufferSize?: number;
    /** Debounce of the cache files. */
    readonly writeDelayMs?: number;
    /** A cache that cannot be written is reported, never thrown. */
    readonly onError?: (error: unknown) => void;
}

/** The caches of one connection. */
export class CacheStore {
    readonly devices = new DeviceCache();
    readonly descriptions = new ParamsetDescriptionCache();
    readonly names = new NameStore();
    readonly serviceMessages: ServiceMessageStore;
    readonly events: RingBuffer<EventRecord>;

    readonly #rssi = new Map<string, RssiStore>();
    readonly #now: () => number;
    readonly #deviceFile: DebouncedJsonFile<unknown>;
    readonly #descriptionFile: DebouncedJsonFile<unknown>;
    readonly #nameFile: DebouncedJsonFile<unknown>;

    constructor(options: CacheStoreOptions) {
        this.#now = options.now ?? (() => Date.now());
        this.serviceMessages = new ServiceMessageStore({now: this.#now});
        this.events = new RingBuffer<EventRecord>(options.eventBufferSize);
        const fileOptions = {
            delayMs: options.writeDelayMs ?? 500,
            ...(options.onError ? {onError: options.onError} : {}),
        };
        this.#deviceFile = new DebouncedJsonFile(`${options.cacheDir}/devices.json`, fileOptions);
        this.#descriptionFile = new DebouncedJsonFile(`${options.cacheDir}/descriptions.json`, fileOptions);
        this.#nameFile = new DebouncedJsonFile(`${options.cacheDir}/names.json`, fileOptions);
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

    /** Reads the three persisted caches. Never throws; a missing file means "nothing cached". */
    async load(): Promise<void> {
        this.devices.load(await this.#deviceFile.read());
        this.descriptions.load(await this.#descriptionFile.read());
        this.names.load(await this.#nameFile.read());
    }

    saveDevices(): void {
        this.#deviceFile.save(this.devices.toJSON());
    }

    saveDescriptions(): void {
        this.#descriptionFile.save(this.descriptions.toJSON());
        this.descriptions.markClean();
    }

    saveNames(): void {
        this.#nameFile.save(this.names.toJSON());
    }

    /** Writes whatever is pending; part of `Backend.stop()`. */
    async flush(): Promise<void> {
        await Promise.all([this.#deviceFile.flush(), this.#descriptionFile.flush(), this.#nameFile.flush()]);
    }

    /** `config.clearCaches`: empties everything in memory and removes the three files. */
    async clear(): Promise<void> {
        this.devices.clear();
        this.descriptions.clear();
        this.names.clear();
        this.#rssi.clear();
        this.events.clear();
        for (const interfaceName of this.serviceMessages.list().map((message) => message.interfaceName)) {
            this.serviceMessages.replaceInterface(interfaceName, []);
        }
        await Promise.all([this.#deviceFile.remove(), this.#descriptionFile.remove(), this.#nameFile.remove()]);
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
