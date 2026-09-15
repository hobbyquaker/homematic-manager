/**
 * The session RPC log: every outgoing call of the session, and the write list that decides what
 * is paced.
 *
 * 2.x had no log at all except the debug option `rpcLogFolder` (`main.js:830-838`), which dumped
 * every `putParamset` as a JSON file. That option is the right forensic tool for a device that
 * ended up in `CONFIG_PENDING` and it is kept, verbatim in file name and content. On top of it
 * every write was recorded in a ring the UI shows and exports (task 6, item 5) - and since task 48
 * every call is: the maintainer wants to see *every* outgoing RPC call in the one global log, the
 * reads, the keep-alive and the `init`s included, each with where it came from (`origin`) so the
 * background traffic can be hidden rather than left out.
 *
 * What bounds it, because the keep-alive runs every few seconds on several interfaces and a
 * `listDevices` answer is hundreds of kilobytes: a ring of {@link DEFAULT_CAPACITY} entries, a
 * byte budget over the whole ring ({@link DEFAULT_BUDGET_BYTES}) that evicts the oldest entries
 * first, and a cap per answer ({@link DEFAULT_RESULT_CAP_BYTES}) above which only a preview and
 * the size are kept. Parameters are never cut - a write's parameters are what went on the wire -
 * but the secrets among them are: a passphrase or a device key has no business in a log.
 *
 * Only the writes are persisted (`write-log.json`, as before task 48): they are the history that
 * matters after a restart; the reads of the previous session are noise, and a CCU's flash does not
 * want a `ping` written to it every few seconds.
 *
 * Which calls count as writes is a fixed list: it decides what is paced (`WriteQueue`), what is
 * persisted, and what a `rpc.call` from the console is allowed to do without a warning.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import type {RpcLogEntry, RpcOrigin, RpcValue} from '@homematic-manager/core';

import {DebouncedJsonFile} from '../util/jsonFile.js';
import type {RpcCallRecord} from './client.js';

/**
 * The RPC methods that change something on the CCU or on a device.
 *
 * Everything not in here is a read: it bypasses the write queue and is not persisted. The list is
 * the eQ-3 method catalogue of the core (`RPC_METHODS`) filtered by hand - `getLinks` and
 * `rssiInfo` read, `addLink` and `setBidcosInterface` do not.
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

/** How many entries the ring keeps. */
export const DEFAULT_CAPACITY = 1000;
/** The byte budget of the whole ring, measured as the JSON length of its entries. */
export const DEFAULT_BUDGET_BYTES = 4 * 1024 * 1024;
/** An answer bigger than this is kept as a preview with its size. */
export const DEFAULT_RESULT_CAP_BYTES = 8 * 1024;
/** How much of a capped answer the preview shows. */
const PREVIEW_CHARS = 512;

/** What a secret is logged as. */
export const REDACTED = '***';

/**
 * Methods whose every parameter is a secret: `changeKey(passphrase)` sets the BidCos security key,
 * `setTempKey(passphrase)` the temporary one for pairing.
 */
const SECRET_METHODS: ReadonlySet<string> = new Set(['changeKey', 'setTempKey']);

/**
 * The parameters as the log keeps them. A struct with a `KEY` in it is a whitelist entry of
 * `setInstallModeWithWhitelist` (the HmIP device key from the sticker); the key goes, the rest -
 * `ADDRESS`, `KEY_MODE` - stays, so the log still says which device was admitted.
 */
export function redactParams(method: string, params: readonly RpcValue[]): RpcValue[] {
    if (SECRET_METHODS.has(method)) {
        return params.map(() => REDACTED);
    }
    if (method === 'setInstallModeWithWhitelist') {
        return params.map((param) => redactKeys(param));
    }
    return [...params];
}

function redactKeys(value: RpcValue): RpcValue {
    if (Array.isArray(value)) {
        return value.map((entry) => redactKeys(entry));
    }
    if (typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, key === 'KEY' ? REDACTED : entry]));
    }
    return value;
}

export interface RpcLogOptions {
    /** How many entries the ring keeps. */
    readonly capacity?: number;
    /** The byte budget of the ring; the oldest entries go when it is exceeded. */
    readonly budgetBytes?: number;
    /** An answer over this many bytes of JSON is kept as a preview with its size. */
    readonly resultCapBytes?: number;
    /** `<cache>/write-log.json`; omit to keep the log in memory only. Only the writes go there. */
    readonly file?: string;
    /** The 2.x `rpcLogFolder`: every `putParamset` is dumped there as JSON. Empty = off. */
    readonly rpcLogFolder?: string;
    readonly onAppended?: (entry: RpcLogEntry) => void;
    readonly onError?: (error: unknown) => void;
    readonly writeDelayMs?: number;
}

/** Every outgoing RPC call of this session, newest last. */
export class RpcLog {
    readonly #capacity: number;
    readonly #budgetBytes: number;
    readonly #resultCapBytes: number;
    /** Oldest first; a plain array rather than the core's ring, because the byte budget evicts from the front too. */
    #entries: Array<{entry: RpcLogEntry; bytes: number}> = [];
    #bytes = 0;
    readonly #file: DebouncedJsonFile<RpcLogEntry[]> | undefined;
    readonly #onAppended: (entry: RpcLogEntry) => void;
    readonly #onError: (error: unknown) => void;
    #rpcLogFolder: string;
    #nextId = 1;

    constructor(options: RpcLogOptions = {}) {
        this.#capacity = options.capacity ?? DEFAULT_CAPACITY;
        this.#budgetBytes = options.budgetBytes ?? DEFAULT_BUDGET_BYTES;
        this.#resultCapBytes = options.resultCapBytes ?? DEFAULT_RESULT_CAP_BYTES;
        this.#onAppended = options.onAppended ?? (() => undefined);
        this.#onError = options.onError ?? (() => undefined);
        this.#rpcLogFolder = options.rpcLogFolder ?? '';
        this.#file =
            options.file === undefined
                ? undefined
                : new DebouncedJsonFile<RpcLogEntry[]>(options.file, {
                      delayMs: options.writeDelayMs ?? 500,
                      ...(options.onError ? {onError: options.onError} : {}),
                  });
    }

    /** The folder the `putParamset` dumps go to; empty switches them off. */
    setRpcLogFolder(folder: string): void {
        this.#rpcLogFolder = folder;
    }

    /** Records one finished call and returns its entry. */
    append(record: RpcCallRecord): RpcLogEntry {
        const entry: RpcLogEntry = {
            id: this.#nextId,
            timestamp: record.timestamp,
            interfaceName: record.interfaceName,
            method: record.method,
            // an explicit-double wrapper is JSON like everything else; the log keeps it verbatim
            // so that a CONFIG_PENDING can be traced back to exactly what went on the wire
            params: redactParams(record.method, record.params as unknown as RpcValue[]),
            ok: record.ok,
            ...this.#resultOf(record.result),
            ...(record.error === undefined ? {} : {error: record.error}),
            durationMs: record.durationMs,
            origin: record.origin,
        };
        this.#nextId += 1;
        this.#push(entry);
        if (isWriteMethod(entry.method)) {
            this.#persist();
        }
        this.#onAppended(entry);
        void this.#dump(record);
        return entry;
    }

    /** The newest `limit` entries, oldest first. */
    list(limit?: number): RpcLogEntry[] {
        const entries = this.#entries.map((item) => item.entry);
        return limit === undefined || limit >= entries.length ? entries : entries.slice(entries.length - limit);
    }

    clear(): void {
        this.#entries = [];
        this.#bytes = 0;
        this.#persist();
    }

    get size(): number {
        return this.#entries.length;
    }

    /** The JSON length of everything in the ring - what the budget is measured against. */
    get bytes(): number {
        return this.#bytes;
    }

    /** Reads the writes of the previous session, if there is a file. */
    async load(): Promise<void> {
        const stored: unknown = await this.#file?.read();
        if (!Array.isArray(stored)) {
            return;
        }
        for (const entry of stored as unknown[]) {
            if (typeof entry === 'object' && entry !== null && typeof (entry as RpcLogEntry).id === 'number') {
                // a file from before task 48 has no origin; a persisted entry is a write, and a
                // write the user did not ask for does not exist
                const stored = entry as Omit<RpcLogEntry, 'origin'> & {origin?: RpcOrigin};
                const loaded: RpcLogEntry = {...stored, origin: stored.origin ?? 'ui'};
                this.#push(loaded);
                this.#nextId = Math.max(this.#nextId, loaded.id + 1);
            }
        }
    }

    async flush(): Promise<void> {
        await this.#file?.flush();
    }

    #push(entry: RpcLogEntry): void {
        const bytes = JSON.stringify(entry).length;
        this.#entries.push({entry, bytes});
        this.#bytes += bytes;
        while (this.#entries.length > this.#capacity || (this.#bytes > this.#budgetBytes && this.#entries.length > 1)) {
            const evicted = this.#entries.shift();
            if (evicted) {
                this.#bytes -= evicted.bytes;
            }
        }
    }

    /** The answer as the entry keeps it: whole under the cap, a preview and its size above. */
    #resultOf(result: RpcValue | undefined): {result?: RpcValue; resultBytes?: number} {
        if (result === undefined) {
            return {};
        }
        const json = JSON.stringify(result);
        if (json.length <= this.#resultCapBytes) {
            return {result};
        }
        return {result: `${json.slice(0, PREVIEW_CHARS)}…`, resultBytes: json.length};
    }

    #persist(): void {
        this.#file?.save(this.#entries.map((item) => item.entry).filter((entry) => isWriteMethod(entry.method)));
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
