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
    const listeners = new Set<(value: unknown) => void>();
    /** The device reports the result as an event, as hmipserver forwards it. */
    const report = (value: unknown): void => {
        for (const listener of [...listeners]) {
            listener(value);
        }
    };
    const rpc: CalibrationRpc = {
        onEvent: vi.fn((parameter: string, handler: (value: unknown) => void) => {
            calls.push(`listen ${parameter}`);
            listeners.add(handler);
            return () => listeners.delete(handler);
        }),
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
    return {state, calls, rpc, writes, reads, report, listeners};
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
        expect(blind.calls).toEqual([
            'get SELF_CALIBRATION_RESULT',
            'listen SELF_CALIBRATION_RESULT',
            'set SELF_CALIBRATION START',
        ]);

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
            'listen SELF_CALIBRATION_RESULT',
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

    // #172: hmipserver answers -5 "Unknown Parameter value" for a result it holds no value for
    it('starts, stops and starts when the result is unknown at the start, and takes unknown polls as "not yet"', async () => {
        const blind = device(false);
        blind.state.failRead = true;
        const run = startAutoCalibration(blind.rpc);
        let outcome: string | undefined;
        void run.done.then((result) => (outcome = result));
        await vi.advanceTimersByTimeAsync(0);
        expect(blind.writes()).toEqual(['START', 'STOP', 'START']);

        // the device has not reported the result yet: still unknown, still running
        await vi.advanceTimersByTimeAsync(30 * CALIBRATION_POLL_MS);
        expect(outcome).toBeUndefined();
        expect(blind.reads()).toBe(31);

        // the first report makes it readable
        blind.state.failRead = false;
        blind.state.result = true;
        await vi.advanceTimersByTimeAsync(CALIBRATION_POLL_MS);
        expect(outcome).toBe('success');
        expect(blind.writes()).toEqual(['START', 'STOP', 'START']);
    });

    it('ends on the event of the result without waiting for the next poll', async () => {
        const blind = device(false);
        blind.state.failRead = true;
        const run = startAutoCalibration(blind.rpc);
        let outcome: string | undefined;
        void run.done.then((result) => (outcome = result));
        await vi.advanceTimersByTimeAsync(3 * CALIBRATION_POLL_MS + 100);
        const reads = blind.reads();

        // a false (the STOP's report) is no end
        blind.report(false);
        await vi.advanceTimersByTimeAsync(0);
        expect(outcome).toBeUndefined();

        blind.report(true);
        await vi.advanceTimersByTimeAsync(0);
        expect(outcome).toBe('success');
        expect(blind.reads()).toBe(reads);
        expect(blind.listeners.size).toBe(0);
    });

    it('does not count a true reported before the last START went out', async () => {
        const blind = device(true);
        const gate: Array<() => void> = [];
        const set = blind.rpc.setValue.bind(blind.rpc);
        let starts = 0;
        blind.rpc.setValue = vi.fn(async (parameter: string, value: string) => {
            if (value === 'START' && ++starts === 1) {
                await new Promise<void>((resolve) => gate.push(resolve));
            }
            return set(parameter, value);
        });
        const run = startAutoCalibration(blind.rpc);
        let outcome: string | undefined;
        void run.done.then((result) => (outcome = result));
        await vi.advanceTimersByTimeAsync(0);
        // the old result, reported while the first START is under way: nobody listens yet
        blind.report(true);
        gate.shift()?.();
        await vi.advanceTimersByTimeAsync(2 * CALIBRATION_POLL_MS);
        expect(outcome).toBeUndefined();
        expect(blind.writes()).toEqual(['START', 'STOP', 'START']);

        blind.report(true);
        await vi.advanceTimersByTimeAsync(0);
        expect(outcome).toBe('success');
    });

    it('gives up after five minutes when the result stays unknown, and writes nothing then', async () => {
        const blind = device(false);
        blind.state.failRead = true;
        const run = startAutoCalibration(blind.rpc);
        await vi.advanceTimersByTimeAsync(CALIBRATION_TIMEOUT_MS);
        await expect(run.done).resolves.toBe('timeout');
        expect(blind.writes()).toEqual(['START', 'STOP', 'START']);
        expect(blind.listeners.size).toBe(0);
    });

    it('works without events: the poll alone sees the end', async () => {
        const blind = device(false);
        delete blind.rpc.onEvent;
        const run = startAutoCalibration(blind.rpc);
        await vi.advanceTimersByTimeAsync(2 * CALIBRATION_POLL_MS);
        blind.state.result = true;
        await vi.advanceTimersByTimeAsync(CALIBRATION_POLL_MS);
        await expect(run.done).resolves.toBe('success');
    });

    it('stops listening when the user stops the run', async () => {
        const blind = device(false);
        const run = startAutoCalibration(blind.rpc);
        await vi.advanceTimersByTimeAsync(CALIBRATION_POLL_MS + 10);
        expect(blind.listeners.size).toBe(1);
        await run.stop();
        await expect(run.done).resolves.toBe('stopped');
        expect(blind.listeners.size).toBe(0);
        blind.report(true);
        await vi.advanceTimersByTimeAsync(0);
        await expect(run.done).resolves.toBe('stopped');
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
