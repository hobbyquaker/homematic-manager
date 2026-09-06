/**
 * A stderr trace of the start-up sequence, off unless `HMM_STARTUP_TRACE` says otherwise.
 *
 * The Electron host has no console anyone reads: the error log only sees what reaches
 * `errorLog.append`, and a main process that hangs or dies before the window exists writes nothing
 * at all. That is exactly the failure the first CI run of `build.yml` showed - nine smoke tests
 * timing out on three operating systems with no output to say how far the app had got - so the
 * host needs a way to say where it stopped that costs nothing when it is off.
 *
 * One line per phase on stderr, with the milliseconds since the process started, so the
 * last line before the silence names the step that hung or crashed. Playwright's
 * `electronApplication.process().stderr` receives it, `apps/electron/test/e2e/smoke.spec.ts`
 * collects it and prints it when a test fails.
 *
 * Nothing here may throw: a diagnostic that breaks the thing it diagnoses is worse than none.
 */

/** The prefix every line carries, so the test can pick the trace out of Chromium's own noise. */
export const STARTUP_TRACE_PREFIX = '[hmm-startup';

/** The environment variable that turns the trace on. */
export const STARTUP_TRACE_ENV = 'HMM_STARTUP_TRACE';

/** `1`, `true`, `yes` - anything but empty, `0` and `false`. */
export function startupTraceEnabled(environment: Readonly<Record<string, string | undefined>> = process.env): boolean {
    const value = environment[STARTUP_TRACE_ENV];
    return value !== undefined && value !== '' && value !== '0' && value.toLowerCase() !== 'false';
}

export interface StartupTraceOptions {
    readonly enabled?: boolean;
    /** Milliseconds since the process started; injected so the test does not need a clock. */
    readonly elapsed?: () => number;
    readonly write?: (line: string) => void;
}

/**
 * Returns the tracer. When it is off the function is a no-op, so call sites need no condition of
 * their own and the trace costs one call per phase.
 */
export function createStartupTrace(options: StartupTraceOptions = {}): (phase: string, detail?: string) => void {
    const enabled = options.enabled ?? startupTraceEnabled();
    if (!enabled) {
        return () => undefined;
    }
    const elapsed = options.elapsed ?? ((): number => Math.round(process.uptime() * 1000));
    const write =
        options.write ??
        ((line: string): void => {
            process.stderr.write(line);
        });
    return (phase: string, detail?: string): void => {
        const suffix = detail === undefined || detail === '' ? '' : ` ${detail}`;
        try {
            write(`${STARTUP_TRACE_PREFIX} +${String(elapsed())}ms] ${phase}${suffix}\n`);
        } catch {
            // A closed stderr - a packaged Windows app has none - must not become the failure the
            // trace was there to explain.
        }
    };
}
