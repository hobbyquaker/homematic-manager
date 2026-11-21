import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {
    CALIBRATION_POLL_MS,
    CALIBRATION_TIMEOUT_MS,
    isSet,
    offersAutoCalibration,
    startAutoCalibration,
    type CalibrationRpc,
} from './blindAutoCalibration.js';

/**
 * An actuator as the sequence sees it: `SELF_CALIBRATION_RESULT` and the writes of
 * `SELF_CALIBRATION`, with the one rule of the real device that matters here - a `STOP` puts the
 * result back to false.
 */
function device(result: unknown = false) {
    const state = {result, failRead: false, failWrite: false};
    const calls: string[] = [];
    const rpc: CalibrationRpc = {
        getValue: vi.fn(async (parameter: string) => {
            calls.push(`get ${parameter}`);
            return state.failRead ? undefined : state.result;
        }),
        setValue: vi.fn(async (parameter: string, value: string) => {
            calls.push(`set ${parameter} ${value}`);
            if (state.failWrite) {
                return false;
            }
            if (value === 'STOP') {
                state.result = false;
            }
            return true;
        }),
    };
    const writes = (): string[] => calls.filter((call) => call.startsWith('set ')).map((call) => call.slice(21));
    const reads = (): number => calls.filter((call) => call.startsWith('get ')).length;
    return {state, calls, rpc, writes, reads};
}

const MASTER = {ENDPOSITION_AUTO_DETECT: {TYPE: 'BOOL', OPERATIONS: 3}};
const VALUES = {
    SELF_CALIBRATION: {TYPE: 'ENUM', OPERATIONS: 2, VALUE_LIST: ['STOP', 'START']},
    SELF_CALIBRATION_RESULT: {TYPE: 'BOOL', OPERATIONS: 5},
};

describe('whether a channel offers the automatic calibration', () => {
    it('offers it with the flag set and the datapoint described', () => {
        expect(offersAutoCalibration(MASTER, {ENDPOSITION_AUTO_DETECT: true}, VALUES)).toBe(true);
        expect(offersAutoCalibration(MASTER, {ENDPOSITION_AUTO_DETECT: 1}, VALUES)).toBe(true);
    });

    it('does not offer it while the end positions are not detected automatically', () => {
        expect(offersAutoCalibration(MASTER, {ENDPOSITION_AUTO_DETECT: false}, VALUES)).toBe(false);
        expect(offersAutoCalibration(MASTER, {}, VALUES)).toBe(false);
    });

    it('does not offer it on a channel without the flag - a HmIP-BBL whose VALUES have the datapoint all the same', () => {
        expect(offersAutoCalibration({}, {ENDPOSITION_AUTO_DETECT: true}, VALUES)).toBe(false);
        expect(offersAutoCalibration(undefined, {ENDPOSITION_AUTO_DETECT: true}, VALUES)).toBe(false);
    });

    it('does not offer it without SELF_CALIBRATION in VALUES, or before VALUES is known', () => {
        const values = {LEVEL: {TYPE: 'FLOAT', OPERATIONS: 7}};
        expect(offersAutoCalibration(MASTER, {ENDPOSITION_AUTO_DETECT: true}, values)).toBe(false);
        expect(offersAutoCalibration(MASTER, {ENDPOSITION_AUTO_DETECT: true}, undefined)).toBe(false);
    });

    it('reads a BOOL in every form an interface answers it in', () => {
        expect([true, 1, '1', 'true'].map(isSet)).toEqual([true, true, true, true]);
        expect([false, 0, '0', 'false', '', undefined, null].map(isSet)).toEqual(Array(7).fill(false));
    });
});

describe('the calibration sequence', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('starts a first run with one START and polls every second until the result is true', async () => {
        const blind = device(false);
        const run = startAutoCalibration(blind.rpc);
        await vi.advanceTimersByTimeAsync(0);
        expect(blind.calls).toEqual(['get SELF_CALIBRATION_RESULT', 'set SELF_CALIBRATION START']);

        // nothing is asked before the first second is over
        await vi.advanceTimersByTimeAsync(CALIBRATION_POLL_MS - 1);
        expect(blind.reads()).toBe(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(blind.reads()).toBe(2);
        await vi.advanceTimersByTimeAsync(3 * CALIBRATION_POLL_MS);
        expect(blind.reads()).toBe(5);

        blind.state.result = true;
        await vi.advanceTimersByTimeAsync(CALIBRATION_POLL_MS);
        await expect(run.done).resolves.toBe('success');
        expect(blind.writes()).toEqual(['START']);

        // and it is over: no poll after the result
        const reads = blind.reads();
        await vi.advanceTimersByTimeAsync(10 * CALIBRATION_POLL_MS);
        expect(blind.reads()).toBe(reads);
    });

    it('starts, stops and starts again when the result of an earlier run is still true', async () => {
        const blind = device(true);
        const run = startAutoCalibration(blind.rpc);
        await vi.advanceTimersByTimeAsync(0);
        expect(blind.calls).toEqual([
            'get SELF_CALIBRATION_RESULT',
            'set SELF_CALIBRATION START',
            'set SELF_CALIBRATION STOP',
            'set SELF_CALIBRATION START',
        ]);

        // the STOP has put the result back, so the old "true" does not end the new run
        await vi.advanceTimersByTimeAsync(2 * CALIBRATION_POLL_MS);
        let settled = false;
        void run.done.then(() => (settled = true));
        await vi.advanceTimersByTimeAsync(0);
        expect(settled).toBe(false);

        blind.state.result = 1;
        await vi.advanceTimersByTimeAsync(CALIBRATION_POLL_MS);
        await expect(run.done).resolves.toBe('success');
    });

    it('writes STOP when the user stops, and ends at once as stopped', async () => {
        const blind = device(false);
        const run = startAutoCalibration(blind.rpc);
        await vi.advanceTimersByTimeAsync(2 * CALIBRATION_POLL_MS + 10);

        await run.stop();
        await expect(run.done).resolves.toBe('stopped');
        expect(blind.writes()).toEqual(['START', 'STOP']);

        const reads = blind.reads();
        await vi.advanceTimersByTimeAsync(10 * CALIBRATION_POLL_MS);
        expect(blind.reads()).toBe(reads);
        // a second stop writes nothing more
        await run.stop();
        expect(blind.writes()).toEqual(['START', 'STOP']);
    });

    it('sends nothing after a STOP that arrives in the middle of START, STOP, START', async () => {
        const blind = device(true);
        const gate: Array<() => void> = [];
        blind.rpc.setValue = vi.fn(async (_parameter: string, value: string) => {
            blind.calls.push(`set SELF_CALIBRATION ${value}`);
            if (value === 'START') {
                await new Promise<void>((resolve) => gate.push(resolve));
            }
            return true;
        });
        const run = startAutoCalibration(blind.rpc);
        await vi.advanceTimersByTimeAsync(0);
        expect(blind.writes()).toEqual(['START']);

        const stopped = run.stop();
        gate.shift()?.();
        await stopped;
        await expect(run.done).resolves.toBe('stopped');
        expect(blind.writes()).toEqual(['START', 'STOP']);
    });

    it('gives up after five minutes without a result, and writes nothing then', async () => {
        const blind = device(false);
        const run = startAutoCalibration(blind.rpc);
        let outcome: string | undefined;
        void run.done.then((result) => (outcome = result));

        await vi.advanceTimersByTimeAsync(CALIBRATION_TIMEOUT_MS - CALIBRATION_POLL_MS);
        expect(outcome).toBeUndefined();
        await vi.advanceTimersByTimeAsync(CALIBRATION_POLL_MS);
        expect(outcome).toBe('timeout');
        expect(blind.writes()).toEqual(['START']);

        const reads = blind.reads();
        await vi.advanceTimersByTimeAsync(10 * CALIBRATION_POLL_MS);
        expect(blind.reads()).toBe(reads);
    });

    it('fails without a write when the result cannot be read at the start', async () => {
        const blind = device(false);
        blind.state.failRead = true;
        const run = startAutoCalibration(blind.rpc);
        await vi.advanceTimersByTimeAsync(0);
        await expect(run.done).resolves.toBe('failed');
        expect(blind.writes()).toEqual([]);
    });

    it('fails when the START is refused, and does not poll', async () => {
        const blind = device(false);
        blind.state.failWrite = true;
        const run = startAutoCalibration(blind.rpc);
        await vi.advanceTimersByTimeAsync(5 * CALIBRATION_POLL_MS);
        await expect(run.done).resolves.toBe('failed');
        expect(blind.reads()).toBe(1);
    });

    it('takes a failed poll as "not yet" and asks again', async () => {
        const blind = device(false);
        const run = startAutoCalibration(blind.rpc);
        await vi.advanceTimersByTimeAsync(0);
        blind.state.failRead = true;
        await vi.advanceTimersByTimeAsync(3 * CALIBRATION_POLL_MS);
        blind.state.failRead = false;
        blind.state.result = true;
        await vi.advanceTimersByTimeAsync(CALIBRATION_POLL_MS);
        await expect(run.done).resolves.toBe('success');
    });

    it('stops waiting without a write when the dialog goes away', async () => {
        const blind = device(false);
        const run = startAutoCalibration(blind.rpc);
        await vi.advanceTimersByTimeAsync(CALIBRATION_POLL_MS + 10);
        run.abandon();
        await expect(run.done).resolves.toBe('stopped');
        expect(blind.writes()).toEqual(['START']);
        const reads = blind.reads();
        await vi.advanceTimersByTimeAsync(10 * CALIBRATION_POLL_MS);
        expect(blind.reads()).toBe(reads);
    });

    it('does not write STOP for a run that is already over', async () => {
        const blind = device(false);
        const run = startAutoCalibration(blind.rpc);
        await vi.advanceTimersByTimeAsync(0);
        blind.state.result = true;
        await vi.advanceTimersByTimeAsync(CALIBRATION_POLL_MS);
        await expect(run.done).resolves.toBe('success');
        await run.stop();
        expect(blind.writes()).toEqual(['START']);
    });
});
