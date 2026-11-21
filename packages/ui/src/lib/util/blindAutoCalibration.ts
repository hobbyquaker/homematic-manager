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
    /** `getValue` of a datapoint of the channel; `undefined` when the call failed. */
    getValue(parameter: string): Promise<unknown>;
    /** `setValue` of a datapoint of the channel; `false` when the call failed. */
    setValue(parameter: string, value: string): Promise<boolean>;
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
 * 1. `getValue SELF_CALIBRATION_RESULT`; not set → `START`; set already → `START`, `STOP`, `START`.
 * 2. Every second `getValue SELF_CALIBRATION_RESULT` until it is set (`success`).
 * 3. {@link CalibrationRun.stop} writes `STOP` and ends the run (`stopped`); after five minutes
 *    without a result it ends as `timeout`, without a write - the WebUI only stops waiting, too.
 *
 * A failed first read or a failed `START` ends it as `failed`; a failed read while polling is taken
 * as "not yet" and asked again, since one lost answer says nothing about the run.
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

    function end(outcome: CalibrationOutcome): void {
        halted = true;
        ended ??= outcome;
        clearTimeout(timer);
        wake?.();
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
        if (before === undefined) {
            return 'failed';
        }
        const steps = isSet(before) ? ['START', 'STOP', 'START'] : ['START'];
        for (const step of steps) {
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
            await pause();
            if (isHalted()) {
                return over();
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
