/**
 * The session write log.
 *
 * 2.x had no log at all except the debug option `rpcLogFolder` (`main.js:830-838`), which dumped
 * every `putParamset` as a JSON file. That option is the right forensic tool for a device that
 * ended up in `CONFIG_PENDING` and it is kept, verbatim in file name and content; on top of it
 * every write is now recorded in a ring the UI can show and export (task 6, item 5).
 *
 * Which calls count as writes is a fixed list: it decides what is paced (`WriteQueue`), what is
 * logged, and what a `rpc.call` from the console is allowed to do without a warning.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import {RingBuffer, type WriteLogEntry} from '@homematic-manager/core';

import type {RpcCallRecord} from '../rpc/client.js';
import {DebouncedJsonFile} from '../util/jsonFile.js';

/**
 * The RPC methods that change something on the CCU or on a device.
 *
 * Everything not in here is a read: it bypasses the write queue and is not logged. The list is the
 * eQ-3 method catalogue of the core (`RPC_METHODS`) filtered by hand - `getLinks` and `rssiInfo`
 * read, `addLink` and `setBidcosInterface` do not.
 */
export const WRITE_METHODS: ReadonlySet<string> = new Set([
    'abortDeleteDevice',
    'activateLinkParamset',
    'addDevice',
    'addLink',
    'addVirtualDeviceInstance',
    'changeKey',
    'clearConfigCache',
    'deleteDevice',
    'determineParameter',
    'installFirmware',
    'putParamset',
    'removeLink',
    'replaceDevice',
    'reportValueUsage',
    'restoreConfigToDevice',
    'searchDevices',
    'setBidcosInterface',
    'setInstallMode',
    'setInstallModeWithWhitelist',
    'setInterfaceClock',
    'setLinkInfo',
    'setMetadata',
    'setRFLGWInfoLED',
    'setTeam',
    'setTempKey',
    'setValue',
    'updateFirmware',
]);

/** Does this method change something? */
export function isWriteMethod(method: string): boolean {
    return WRITE_METHODS.has(method);
}

export interface WriteLogOptions {
    /** How many entries the ring keeps. */
    readonly capacity?: number;
    /** `<cache>/write-log.json`; omit to keep the log in memory only. */
    readonly file?: string;
    /** The 2.x `rpcLogFolder`: every `putParamset` is dumped there as JSON. Empty = off. */
    readonly rpcLogFolder?: string;
    readonly onAppended?: (entry: WriteLogEntry) => void;
    readonly onError?: (error: unknown) => void;
    readonly writeDelayMs?: number;
}

/** Every write of this session, newest last. */
export class WriteLog {
    readonly #entries: RingBuffer<WriteLogEntry>;
    readonly #file: DebouncedJsonFile<WriteLogEntry[]> | undefined;
    readonly #onAppended: (entry: WriteLogEntry) => void;
    readonly #onError: (error: unknown) => void;
    #rpcLogFolder: string;
    #nextId = 1;

    constructor(options: WriteLogOptions = {}) {
        this.#entries = new RingBuffer<WriteLogEntry>(options.capacity ?? 1000);
        this.#onAppended = options.onAppended ?? (() => undefined);
        this.#onError = options.onError ?? (() => undefined);
        this.#rpcLogFolder = options.rpcLogFolder ?? '';
        this.#file =
            options.file === undefined
                ? undefined
                : new DebouncedJsonFile<WriteLogEntry[]>(options.file, {
                      delayMs: options.writeDelayMs ?? 500,
                      ...(options.onError ? {onError: options.onError} : {}),
                  });
    }

    /** The folder the `putParamset` dumps go to; empty switches them off. */
    setRpcLogFolder(folder: string): void {
        this.#rpcLogFolder = folder;
    }

    /** Records one finished call. Returns the entry, or `undefined` for a read. */
    append(record: RpcCallRecord): WriteLogEntry | undefined {
        if (!isWriteMethod(record.method)) {
            return undefined;
        }
        const entry: WriteLogEntry = {
            id: this.#nextId,
            timestamp: record.timestamp,
            interfaceName: record.interfaceName,
            method: record.method,
            // an explicit-double wrapper is JSON like everything else; the log keeps it verbatim
            // so that a CONFIG_PENDING can be traced back to exactly what went on the wire
            params: record.params as unknown as WriteLogEntry['params'],
            ok: record.ok,
            ...(record.result === undefined ? {} : {result: record.result}),
            ...(record.error === undefined ? {} : {error: record.error}),
            durationMs: record.durationMs,
        };
        this.#nextId += 1;
        this.#entries.push(entry);
        this.#persist();
        this.#onAppended(entry);
        void this.#dump(record);
        return entry;
    }

    /** The newest `limit` entries, oldest first. */
    list(limit?: number): WriteLogEntry[] {
        const entries = this.#entries.toArray();
        return limit === undefined || limit >= entries.length ? entries : entries.slice(entries.length - limit);
    }

    clear(): void {
        this.#entries.clear();
        this.#persist();
    }

    get size(): number {
        return this.#entries.size;
    }

    /** Reads the log of the previous session, if there is a file. */
    async load(): Promise<void> {
        const stored = await this.#file?.read();
        if (!Array.isArray(stored)) {
            return;
        }
        for (const entry of stored) {
            if (typeof entry === 'object' && entry !== null && typeof entry.id === 'number') {
                this.#entries.push(entry);
                this.#nextId = Math.max(this.#nextId, entry.id + 1);
            }
        }
    }

    async flush(): Promise<void> {
        await this.#file?.flush();
    }

    #persist(): void {
        this.#file?.save(this.#entries.toArray());
    }

    /** The 2.x dump: `<folder>/<epoch ms>_<interface>_<method>.json` with the parameters. */
    async #dump(record: RpcCallRecord): Promise<void> {
        if (this.#rpcLogFolder === '' || record.method !== 'putParamset') {
            return;
        }
        const file = path.join(
            this.#rpcLogFolder,
            `${String(record.timestamp)}_${record.interfaceName}_${record.method}.json`,
        );
        try {
            await fs.writeFile(file, JSON.stringify(record.params, null, '  '), 'utf8');
        } catch (error) {
            this.#onError(error);
        }
    }
}
