/**
 * The two places the host waits for something that may never come: the last await of the start-up
 * sequence, and the quit.
 *
 * Both are invisible when they go wrong. A start-up step that never settles leaves a process with
 * no window and nothing in the log; a quit that never finishes leaves a process that cannot be
 * killed by asking. The first CI run of `build.yml` showed the second one nine times over -
 * Playwright's `electronApplication.close()` calls `app.quit()` and then waits for the process to
 * exit with no bound of its own, so every smoke test that reached its `finally` spent the full
 * two minutes there and the worker teardown after it spent two more.
 *
 * No Electron here: `app.quit`, `app.exit` and the timer are injected, so the sequence can be
 * tested with fake timers on any machine.
 */

/** How long `backend.stop()` may take before the quit goes on without it. */
export const DEFAULT_STOP_TIMEOUT_MS = 8000;
/** How long the whole quit may take before the process is ended the hard way. */
export const DEFAULT_EXIT_TIMEOUT_MS = 15_000;

export interface TimerFunctions {
    readonly setTimer?: (callback: () => void, ms: number) => unknown;
    readonly clearTimer?: (handle: unknown) => void;
}

/**
 * Awaits `promise`, and says so when it takes longer than `ms`.
 *
 * It does not abandon the promise: a half-finished `Backend.open()` cannot be walked away from
 * without leaking the file handles it took. What it does is turn a silent hang into a line in the
 * trace and in the error log, which is the difference between "the smoke test timed out" and "the
 * smoke test timed out in `Backend.open`".
 */
export async function withDeadline<T>(
    promise: Promise<T>,
    ms: number,
    onOverrun: () => void,
    timers: TimerFunctions = {},
): Promise<T> {
    const setTimer = timers.setTimer ?? ((callback: () => void, delay: number) => setTimeout(callback, delay));
    const clearTimer = timers.clearTimer ?? ((handle: unknown) => clearTimeout(handle as NodeJS.Timeout));
    const handle = setTimer(() => {
        onOverrun();
    }, ms);
    try {
        return await promise;
    } finally {
        clearTimer(handle);
    }
}

export interface QuitOptions extends TimerFunctions {
    /** `backend.stop()`; may hang, may reject, may not exist yet. */
    readonly stop: () => Promise<void>;
    /** Everything that has to happen after the backend is down: the bridge, the window state. */
    readonly finish: () => void;
    /** `UpdateFlow.installIfArmed()`: `true` when the installer quits the app itself. */
    readonly installIfArmed: () => boolean;
    /** `app.quit()`. */
    readonly quit: () => void;
    /** `app.exit()`: the way out when `quit()` did not take. */
    readonly exit: (code: number) => void;
    readonly onError: (scope: string, error: unknown) => void;
    readonly trace: (phase: string, detail?: string) => void;
    readonly stopTimeoutMs?: number;
    readonly exitTimeoutMs?: number;
}

export interface QuitSequence {
    /**
     * The body of the `will-quit` handler. Returns `true` when the caller has to call
     * `event.preventDefault()` because the shutdown is not finished yet.
     */
    willQuit: () => boolean;
}

/**
 * The shutdown, with two bounds and no way out that is not one of them.
 *
 * `stop()` gets `stopTimeoutMs` - de-registering the callbacks at an interface process that has
 * gone away must not hold the app - and the whole sequence gets `exitTimeoutMs`, after which the
 * process ends with `app.exit()`. The watchdog is deliberately never cleared: it is there for the
 * case where `quit()` is called and nothing happens, which is the one failure the code inside this
 * function cannot see.
 *
 * **The shutdown starts on the next turn, never inside the `will-quit` handler.** Electron's
 * `Browser::Quit()` returns at once while `is_quitting_` is set, and `is_quitting_` is only
 * cleared *after* the `will-quit` handler has returned to C++ and the prevention has been read.
 * A shutdown that finishes inside that same turn - which it does whenever `stop()` resolves in
 * microtasks, and `windowState.save()` is a synchronous write - therefore calls `quit()` into a
 * flag that is still set, the call does nothing at all, and nobody ever asks again. The app then
 * sits there with its window closed until something kills it.
 *
 * That is what the trace of build.yml 34001069697 shows, eight launches out of nine on three
 * operating systems: `quit: quitting`, then silence, then the watchdog fifteen seconds later. The
 * ninth is the proof: there `backend.stop()` took eight milliseconds of real I/O, the final
 * `quit()` landed in a later turn, and `before-quit` and `will-quit` followed it immediately and
 * the process exited. For a user this is a zombie process after every quit.
 *
 * Every step is caught. 2.x's bug was `process.exit(1)` on a second `stop()`; the shape here is the
 * same mistake waiting to happen, because an exception between the backend going down and the
 * final `quit()` becomes an unhandled rejection, and an unhandled rejection puts a modal error box
 * in front of an app that is trying to quit.
 */
export function createQuitSequence(options: QuitOptions): QuitSequence {
    const setTimer = options.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
    const clearTimer = options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as NodeJS.Timeout));
    const stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
    const exitTimeoutMs = options.exitTimeoutMs ?? DEFAULT_EXIT_TIMEOUT_MS;

    let stopping = false;
    let stopped = false;

    const run = async (): Promise<void> => {
        try {
            let timedOut: unknown;
            await Promise.race([
                options.stop(),
                new Promise<void>((resolve) => {
                    timedOut = setTimer(resolve, stopTimeoutMs);
                }),
            ]);
            clearTimer(timedOut);
        } catch (error) {
            options.onError('stop', error);
        }
        options.trace('quit: backend stopped');
        try {
            options.finish();
        } catch (error) {
            options.onError('quit', error);
        }
        stopped = true;
        let armed = false;
        try {
            armed = options.installIfArmed();
        } catch (error) {
            options.onError('quit', error);
        }
        if (armed) {
            // `quitAndInstall()` quits the app itself; anything after it would race the installer.
            options.trace('quit: the updater takes over');
            return;
        }
        options.trace('quit: quitting');
        options.quit();
    };

    return {
        willQuit(): boolean {
            options.trace('app: will-quit', stopped ? 'already stopped' : stopping ? 'stopping' : 'first');
            if (stopped) {
                return false;
            }
            if (stopping) {
                return true;
            }
            stopping = true;
            const watchdog = setTimer(() => {
                options.trace('quit: watchdog', `still here after ${String(exitTimeoutMs)}ms, exiting`);
                options.onError('quit', new Error(`the app did not quit within ${String(exitTimeoutMs)}ms`));
                options.exit(0);
            }, exitTimeoutMs);
            if (typeof (watchdog as {unref?: () => void}).unref === 'function') {
                (watchdog as {unref: () => void}).unref();
            }
            // The next turn, not this one: see the note above. `quit()` reached from here would
            // land inside Electron's own quit and be dropped.
            setTimer(() => {
                void run();
            }, 0);
            return true;
        },
    };
}
