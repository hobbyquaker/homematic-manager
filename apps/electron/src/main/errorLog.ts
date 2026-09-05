/**
 * Unhandled errors: one line in a file, one dialog, never a crash loop.
 *
 * 2.x used `electron-unhandled`, and only when `showUnhandled` was set in the configuration -
 * which meant that for everyone else an exception in the main process was simply gone. The
 * opposite failure is just as bad: an error that repeats fifty times a second behind a modal
 * dialog makes the app impossible to quit.
 *
 * So: everything is appended to `userData/logs/main.log`, and the *first* one also opens a dialog.
 * Later ones only go to the file, and the dialog says where the file is.
 *
 * No Electron here either - the dialog is a callback, which is what lets the test check the
 * "only once" rule without a window.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface ErrorLogOptions {
    /** `userData/logs`. */
    readonly dir: string;
    readonly file?: string;
    /** Rotate when the file passes this; one generation is kept as `.1`. */
    readonly maxBytes?: number;
    readonly now?: () => Date;
}

/** An append-only text log with one rotation. */
export class ErrorLog {
    readonly file: string;

    readonly #maxBytes: number;
    readonly #now: () => Date;

    constructor(options: ErrorLogOptions) {
        this.file = path.join(options.dir, options.file ?? 'main.log');
        this.#maxBytes = options.maxBytes ?? 1_000_000;
        this.#now = options.now ?? (() => new Date());
    }

    /** Appends one entry and returns the message that was logged. */
    append(scope: string, value: unknown): string {
        const message = describe(value);
        const line = `${this.#now().toISOString()} ${scope}: ${message}\n`;
        try {
            fs.mkdirSync(path.dirname(this.file), {recursive: true});
            this.#rotate();
            fs.appendFileSync(this.file, line);
        } catch {
            // Nothing sensible left to do; the console is all there is.
            process.stderr.write(line);
        }
        return message;
    }

    /** The last `limit` bytes of the log, for a bug report. */
    tail(limit = 8192): string {
        try {
            const content = fs.readFileSync(this.file, 'utf8');
            return content.length <= limit ? content : content.slice(content.length - limit);
        } catch {
            return '';
        }
    }

    #rotate(): void {
        let size: number;
        try {
            size = fs.statSync(this.file).size;
        } catch {
            // No file yet, or none we can look at; nothing to rotate either way.
            return;
        }
        if (size < this.#maxBytes) {
            return;
        }
        try {
            fs.renameSync(this.file, `${this.file}.1`);
        } catch {
            // A rotation that fails means the file keeps growing; not worth a second failure.
        }
    }
}

export interface ErrorHandlerOptions {
    readonly log: ErrorLog;
    /** Shows the dialog. Called for the first error only. */
    readonly showDialog: (message: string, logFile: string) => void;
    /** Defaults to the real one; the test passes its own emitter. */
    readonly target?: NodeJS.EventEmitter;
}

/**
 * Catches `uncaughtException` and `unhandledRejection` for the life of the process.
 *
 * Returns a `report()` so that everything else in main - a backend that fails to open, a window
 * that fails to load - can go down the same path instead of inventing its own.
 */
export function installErrorHandlers(options: ErrorHandlerOptions): {
    report: (scope: string, error: unknown) => void;
    dispose: () => void;
} {
    const target = options.target ?? process;
    let shown = false;

    const report = (scope: string, error: unknown): void => {
        const message = options.log.append(scope, error);
        if (shown) {
            return;
        }
        shown = true;
        try {
            options.showDialog(message, options.log.file);
        } catch {
            // A dialog that cannot be shown must not become the next unhandled error.
        }
    };

    const onException = (error: unknown): void => report('uncaughtException', error);
    const onRejection = (reason: unknown): void => report('unhandledRejection', reason);
    target.on('uncaughtException', onException);
    target.on('unhandledRejection', onRejection);

    return {
        report,
        dispose: () => {
            target.off('uncaughtException', onException);
            target.off('unhandledRejection', onRejection);
        },
    };
}

function describe(value: unknown): string {
    if (value instanceof Error) {
        return value.stack ?? `${value.name}: ${value.message}`;
    }
    if (typeof value === 'object' && value !== null) {
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }
    return String(value);
}
