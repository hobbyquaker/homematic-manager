import type {Paramset, ParamsetDescription} from '@homematic-manager/core';

/**
 * The automatic calibration run of an HmIP blind or shutter actuator, as the CCU's WebUI offers it
 * on the channel's settings (`BlindAutoCalibration.js` there): the actuator drives the blind to both
 * end positions, measures the running times and stores them in its MASTER paramset.
 *
 * The run is three datapoints of the channel's VALUES and nothing else:
 *
 *   SELF_CALIBRATION          ENUM STOP|START, write only - starts and stops the run
 *   SELF_CALIBRATION_RESULT   BOOL, read - true once a run has finished
 *
 * and one oddity the sequence exists for: `SELF_CALIBRATION_RESULT` stays true after the first
 * successful run and only a stopped run puts it back. A second run therefore starts, stops and
 * starts again - otherwise the result that says "finished" is already there before the blind moved.
 *
 * And a second one, seen on a real HmIP-BBL (homematic-manager#172): hmipserver answers `getValue`
 * of a datapoint it holds no value for - nothing reported since it started - with fault -5
 * "Unknown Parameter value", although the description lists it as readable. An unreadable result
 * therefore says "not known", never "the run cannot start". The device may still hold a true from
 * a run before hmipserver started, so an unknown result is handled like a true one: START, STOP,
 * START - which is also what the WebUI sends then (its JSON wrapper turns the fault into `null`,
 * and `null == 0` is false there). The end of the run is taken from the `SELF_CALIBRATION_RESULT`
 * event when one arrives, and from the poll otherwise.
 *
 * Nothing here touches a store or the DOM: the two calls are handed in, so the sequence is tested
 * with a mocked RPC and fake timers.
 */

/** The MASTER flag the calibration depends on: the actuator finds its end positions by itself. */
export const AUTO_DETECT_PARAM = 'ENDPOSITION_AUTO_DETECT';
/** The VALUES datapoint that starts and stops a run. */
export const CALIBRATION_PARAM = 'SELF_CALIBRATION';
/** The VALUES datapoint that turns true when a run has finished. */
export const CALIBRATION_RESULT_PARAM = 'SELF_CALIBRATION_RESULT';

/** How often the result is asked for while a run is under way. */
export const CALIBRATION_POLL_MS = 1000;
/**
 * After this long the run is given up on: a run stopped from somewhere else (the device's button,
 * another session) never reports a result, and the dialog must not wait for it for ever.
 */
export const CALIBRATION_TIMEOUT_MS = 5 * 60 * 1000;

/** What the sequence needs from the interface; both answer `undefined`/`false` on a failure. */
export interface CalibrationRpc {
    /**
     * `getValue` of a datapoint of the channel; `undefined` when it could not be read - a failed
     * call, or hmipserver's -5 for a value it does not know yet. Raises no notice: an unknown
     * result is part of the sequence, not an error.
     */
    getValue(parameter: string): Promise<unknown>;
    /** `setValue` of a datapoint of the channel; `false` when the call failed. */
    setValue(parameter: string, value: string): Promise<boolean>;
    /**
     * The events of a datapoint of the channel; answers the function that ends the subscription.
     * Optional: without it the poll alone sees the end of the run.
     */
    onEvent?(parameter: string, handler: (value: unknown) => void): () => void;
}

/**
 * How a run ended: the device reported the result, the user stopped it, nothing came within the
 * time limit, or a call the sequence cannot go on without failed.
 */
export type CalibrationOutcome = 'success' | 'stopped' | 'timeout' | 'failed';

export interface CalibrationRun {
    /** Settles when the run is over; never rejects. */
    readonly done: Promise<CalibrationOutcome>;
    /** The user's stop: writes `STOP` and ends the run as `stopped`. */
    stop(): Promise<void>;
    /** Ends the waiting without a write - the dialog went away. The device finishes its run. */
    abandon(): void;
}

export interface CalibrationOptions {
    readonly pollMs?: number;
    readonly timeoutMs?: number;
}

/**
 * Whether a channel offers the run - the WebUI's two conditions: the MASTER paramset has
 * `ENDPOSITION_AUTO_DETECT` and it is switched on, and the VALUES description has
 * `SELF_CALIBRATION`. A HmIP-BBL on an old firmware has the datapoint without the flag and gets no
 * button, exactly as on the CCU.
 */
export function offersAutoCalibration(
    master: ParamsetDescription | undefined,
    values: Readonly<Paramset> | Readonly<Record<string, unknown>>,
    valuesDescription: ParamsetDescription | undefined,
): boolean {
    return (
        master?.[AUTO_DETECT_PARAM] !== undefined &&
        isSet(values[AUTO_DETECT_PARAM]) &&
        valuesDescription?.[CALIBRATION_PARAM] !== undefined
    );
}

/** A BOOL as the interface processes answer it: `true`, `1`, and the strings of either. */
export function isSet(value: unknown): boolean {
    return value === true || value === 1 || value === '1' || value === 'true';
}

/**
 * Starts a run and watches it.
 *
 * 1. `getValue SELF_CALIBRATION_RESULT`; false → `START`; true, or not readable → `START`, `STOP`,
 *    `START`.
 * 2. Every second `getValue SELF_CALIBRATION_RESULT` until it is set (`success`); an event of the
 *    result that says true ends the run at once.
 * 3. {@link CalibrationRun.stop} writes `STOP` and ends the run (`stopped`); after five minutes
 *    without a result it ends as `timeout`, without a write - the WebUI only stops waiting, too.
 *
 * A refused `START` or `STOP` ends it as `failed`; an unreadable result while polling is taken as
 * "not yet" and asked again - hmipserver may not know the value before the device reports it.
 */
export function startAutoCalibration(rpc: CalibrationRpc, options: CalibrationOptions = {}): CalibrationRun {
    const pollMs = options.pollMs ?? CALIBRATION_POLL_MS;
    const timeoutMs = options.timeoutMs ?? CALIBRATION_TIMEOUT_MS;

    let ended: CalibrationOutcome | undefined;
    /** Set the moment a stop is asked for, so the start sequence sends nothing after the `STOP`. */
    let halted = false;
    let halting: Promise<void> | undefined;
    let wake: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** The device reported the result true after the last `START` went out. */
    let reported = false;
    let unsubscribe: (() => void) | undefined;

    function end(outcome: CalibrationOutcome): void {
        halted = true;
        ended ??= outcome;
        clearTimeout(timer);
        wake?.();
    }

    /** Events count only once the last `START` was accepted: a true before it is the old result. */
    function listen(): void {
        unsubscribe = rpc.onEvent?.(CALIBRATION_RESULT_PARAM, (value) => {
            if (isSet(value) && !halted) {
                reported = true;
                clearTimeout(timer);
                wake?.();
            }
        });
    }

    /** Asked after every await: a stop arrives from outside, which the compiler's narrowing cannot see. */
    function isHalted(): boolean {
        return halted;
    }

    /** What a halted run answers once the stop has been written (or the dialog went away). */
    async function over(): Promise<CalibrationOutcome> {
        await halting;
        return ended ?? 'stopped';
    }

    /** One poll interval, cut short when the run ends meanwhile. */
    function pause(): Promise<void> {
        return new Promise((resolve) => {
            wake = resolve;
            timer = setTimeout(resolve, pollMs);
        });
    }

    async function run(): Promise<CalibrationOutcome> {
        const before = await rpc.getValue(CALIBRATION_RESULT_PARAM);
        if (isHalted()) {
            return over();
        }
        // false: a fresh device or a stopped run; true or unknown: possibly an old run's result
        const steps = before === undefined || isSet(before) ? ['START', 'STOP', 'START'] : ['START'];
        for (const [index, step] of steps.entries()) {
            if (index === steps.length - 1) {
                listen();
            }
            const sent = await rpc.setValue(CALIBRATION_PARAM, step);
            if (isHalted()) {
                return over();
            }
            if (!sent) {
                return 'failed';
            }
        }

        const deadline = Date.now() + timeoutMs;
        for (;;) {
            if (!reported) {
                await pause();
            }
            if (isHalted()) {
                return over();
            }
            if (reported) {
                return 'success';
            }
            const result = await rpc.getValue(CALIBRATION_RESULT_PARAM);
            if (isHalted()) {
                return over();
            }
            if (isSet(result)) {
                return 'success';
            }
            if (Date.now() >= deadline) {
                return 'timeout';
            }
        }
    }

    const done = run().then((outcome) => {
        ended ??= outcome;
        clearTimeout(timer);
        unsubscribe?.();
        return ended;
    });

    return {
        done,
        stop(): Promise<void> {
            if (halted || ended) {
                return halting ?? Promise.resolve();
            }
            halted = true;
            clearTimeout(timer);
            // Whatever the write answers, a stop the user asked for ends the waiting.
            halting = rpc.setValue(CALIBRATION_PARAM, 'STOP').then(() => {
                end('stopped');
            });
            wake?.();
            return halting;
        },
        abandon(): void {
            end('stopped');
        },
    };
}
