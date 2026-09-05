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

/** Writes a JSON file atomically, creating the directory if it does not exist. */
export async function writeJsonFile(file: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(file), {recursive: true});
    const temporary = `${file}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, file);
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
