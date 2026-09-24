/**
 * Reading and writing the JSON files the backend persists (configuration, device cache, paramset
 * descriptions, names, write log).
 *
 * Two properties matter and 2.x had neither. **Atomic**: `persist-json` wrote straight over the
 * file unless `{secure: true}` was passed (the app did not pass it), so a crash mid-write left an
 * empty `config` and the user's CCU address was gone. Here everything goes to `<file>.tmp` and is
 * renamed, which is atomic within a directory on every platform we support. **Debounced**: 2.x
 * rewrote the whole device cache on every `newDevices` callback; a CCU that reports 400 devices in
 * a burst wrote the file 400 times.
 *
 * A read failure is never fatal: a missing or corrupt file means "no cache yet".
 */

import fs from 'node:fs/promises';
import path from 'node:path';

/** Reads and parses a JSON file; `undefined` when it is missing, unreadable or not JSON. */
export async function readJsonFile<T>(file: string): Promise<T | undefined> {
    let text: string;
    try {
        text = await fs.readFile(file, 'utf8');
    } catch {
        return undefined;
    }
    try {
        return JSON.parse(text) as T;
    } catch {
        return undefined;
    }
}

/**
 * B-43: the write in progress per file. Two writes of one file that overlapped shared its `.tmp`:
 * the first rename took it away and the second failed with ENOENT (quick successive room
 * assignments on the metadata cache). Writes of one file now wait for each other, in call order.
 */
const writesInProgress = new Map<string, Promise<void>>();

/**
 * Writes a JSON file atomically, creating the directory if it does not exist. Writes of the same
 * file run one after another in call order, so the last call's value is what stays; the value is
 * serialised at the call.
 */
export async function writeJsonFile(file: string, value: unknown): Promise<void> {
    const text = `${JSON.stringify(value, null, 2)}\n`;
    const previous = writesInProgress.get(file) ?? Promise.resolve();
    const write = previous.then(async () => {
        await fs.mkdir(path.dirname(file), {recursive: true});
        const temporary = `${file}.tmp`;
        await fs.writeFile(temporary, text, 'utf8');
        await fs.rename(temporary, file);
    });
    // the next write waits for this one whether it worked or not; the caller hears the error
    const settled = write.catch(() => undefined);
    writesInProgress.set(file, settled);
    void settled.then(() => {
        if (writesInProgress.get(file) === settled) {
            writesInProgress.delete(file);
        }
    });
    return write;
}

/** Removes a file; a missing file is not an error. */
export async function removeFile(file: string): Promise<void> {
    try {
        await fs.rm(file, {force: true});
    } catch {
        // a directory we may not write to: nothing we can do, and nothing worth failing for
    }
}

export interface DebouncedJsonFileOptions {
    /** How long to collect changes before writing. */
    readonly delayMs?: number;
    /** Reported instead of thrown: a cache that cannot be written must not break the session. */
    readonly onError?: (error: unknown) => void;
}

/**
 * One JSON file that is written at most every `delayMs`, with the newest value winning.
 *
 * `flush()` writes immediately and is what `Backend.stop()` calls, so nothing is lost when the app
 * closes right after a change.
 */
export class DebouncedJsonFile<T> {
    readonly file: string;

    readonly #delayMs: number;
    readonly #onError: (error: unknown) => void;

    #pending: {value: T} | undefined;
    #timer: ReturnType<typeof setTimeout> | undefined;
    #writing: Promise<void> = Promise.resolve();

    constructor(file: string, options: DebouncedJsonFileOptions = {}) {
        this.file = file;
        this.#delayMs = options.delayMs ?? 500;
        this.#onError = options.onError ?? (() => undefined);
    }

    /** Reads the file; `undefined` when there is nothing usable. */
    async read(): Promise<T | undefined> {
        return readJsonFile<T>(this.file);
    }

    /** Schedules a write. Calling it again before the timer fires replaces the value. */
    save(value: T): void {
        this.#pending = {value};
        if (this.#timer !== undefined) {
            return;
        }
        const timer = setTimeout(() => {
            this.#timer = undefined;
            void this.flush();
        }, this.#delayMs);
        if (typeof timer.unref === 'function') {
            timer.unref();
        }
        this.#timer = timer;
    }

    /** True while a scheduled write has not happened yet. */
    get dirty(): boolean {
        return this.#pending !== undefined;
    }

    /** Writes whatever is pending, now, and waits for it. */
    async flush(): Promise<void> {
        if (this.#timer !== undefined) {
            clearTimeout(this.#timer);
            this.#timer = undefined;
        }
        const pending = this.#pending;
        this.#pending = undefined;
        if (!pending) {
            return this.#writing;
        }
        this.#writing = this.#writing.then(async () => {
            try {
                await writeJsonFile(this.file, pending.value);
            } catch (error) {
                this.#onError(error);
            }
        });
        return this.#writing;
    }

    /** Drops a scheduled write without performing it, and deletes the file. */
    async remove(): Promise<void> {
        if (this.#timer !== undefined) {
            clearTimeout(this.#timer);
            this.#timer = undefined;
        }
        this.#pending = undefined;
        await this.#writing;
        await removeFile(this.file);
    }
}
