/**
 * The smallest logger that is still useful: four levels, one line each, stderr for `error` and
 * `warn` so a shell pipeline can separate them.
 *
 * No dependency on purpose - this process runs on a CCU3 where every module costs an inode
 * (task 13), and the host has nothing to log that would need more than a timestamp and a level.
 */

/** Log levels, most severe first; a level enables itself and everything above it. */
export const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Logger {
    error(...parts: unknown[]): void;
    warn(...parts: unknown[]): void;
    info(...parts: unknown[]): void;
    debug(...parts: unknown[]): void;
}

export interface CreateLoggerOptions {
    readonly level?: LogLevel;
    /** Where the lines go; a test passes its own. */
    readonly write?: (level: LogLevel, line: string) => void;
    readonly now?: () => Date;
}

/** Is `candidate` one of the four level names? */
export function isLogLevel(candidate: unknown): candidate is LogLevel {
    return typeof candidate === 'string' && (LOG_LEVELS as readonly string[]).includes(candidate);
}

/** A logger that drops everything below `level`. */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
    const level = options.level ?? 'info';
    const enabled = LOG_LEVELS.slice(0, LOG_LEVELS.indexOf(level) + 1);
    const now = options.now ?? ((): Date => new Date());
    const write =
        options.write ??
        ((entry: LogLevel, line: string): void => {
            if (entry === 'error' || entry === 'warn') {
                process.stderr.write(`${line}\n`);
            } else {
                process.stdout.write(`${line}\n`);
            }
        });
    const emit =
        (entry: LogLevel) =>
        (...parts: unknown[]): void => {
            if (!enabled.includes(entry)) {
                return;
            }
            write(entry, `${now().toISOString()} ${entry.toUpperCase().padEnd(5)} ${parts.map(format).join(' ')}`);
        };
    return {error: emit('error'), warn: emit('warn'), info: emit('info'), debug: emit('debug')};
}

/** A logger that does nothing; the default of the library entry points. */
export const silentLogger: Logger = {
    error: () => undefined,
    warn: () => undefined,
    info: () => undefined,
    debug: () => undefined,
};

function format(part: unknown): string {
    if (typeof part === 'string') {
        return part;
    }
    if (part instanceof Error) {
        return part.message;
    }
    try {
        return JSON.stringify(part) ?? String(part);
    } catch {
        return String(part);
    }
}
