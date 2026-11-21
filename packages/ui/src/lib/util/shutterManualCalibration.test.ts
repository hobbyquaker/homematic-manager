import {afterEach, describe, expect, it, vi} from 'vitest';

import type {ParamsetDescription, ParamsetWrite} from '@homematic-manager/core';

import {
    BOTTOM_SET_PARAM,
    CLEAR_SETTLE_MS,
    ManualCalibration,
    ManualCalibrationSession,
    TOP_SET_PARAM,
    clampDuration,
    flagOf,
    maintenanceAddress,
    motionCommand,
    offersManualCalibration,
    plainCommand,
    stepOf,
    type ManualCalibrationRpc,
    type ManualCalibrationState,
} from './shutterManualCalibration.js';

/**
 * A tubular motor as the session sees it: the two flags on `:0` (a value, or `undefined` for hmipserver's -5) and
 * every `putParamset VALUES` it receives. Saving a position sets its flag and reports it, as the device does;
 * deleting clears both.
 */
function motor(flags: {top?: unknown; bottom?: unknown} = {top: false, bottom: false}) {
    const state = {top: flags.top, bottom: flags.bottom, refuse: false};
    const commands: ParamsetWrite[] = [];
    const listeners = new Set<(parameter: string, value: unknown) => void>();
    const report = (parameter: string, value: unknown): void => {
        for (const listener of [...listeners]) {
            listener(parameter, value);
        }
    };
    const rpc: ManualCalibrationRpc = {
        getFlag: vi.fn(async (parameter: string) => (parameter === TOP_SET_PARAM ? state.top : state.bottom)),
        command: vi.fn(async (values: ParamsetWrite) => {
            commands.push(values);
            return !state.refuse;
        }),
        onFlag: vi.fn((handler: (parameter: string, value: unknown) => void) => {
            listeners.add(handler);
            return () => listeners.delete(handler);
        }),
    };
    return {state, commands, report, rpc, listeners};
}

function session(rpc: ManualCalibrationRpc, options: {settleMs?: number} = {}) {
    const seen: ManualCalibrationState[] = [];
    const created = new ManualCalibrationSession(rpc, (next) => seen.push(next), options);
    return {session: created, seen};
}

const step = (value: number): ParamsetWrite => ({MANUAL_SELF_CALIBRATION: value});

afterEach(() => {
    vi.useRealTimers();
});

describe('the pure parts', () => {
    it('offers the dialog for a channel whose VALUES describe MANUAL_SELF_CALIBRATION, as the WebUI decides', () => {
        const values: ParamsetDescription = {MANUAL_SELF_CALIBRATION: {TYPE: 'ENUM', OPERATIONS: 2, DEFAULT: 0}};
        expect(offersManualCalibration(values)).toBe(true);
        expect(offersManualCalibration({LEVEL: {TYPE: 'FLOAT', OPERATIONS: 7, DEFAULT: 0}})).toBe(false);
        expect(offersManualCalibration(undefined)).toBe(false);
    });

    it('finds the flags on channel 0 of the device', () => {
        expect(maintenanceAddress('00AA00000000TD:3')).toBe('00AA00000000TD:0');
        expect(maintenanceAddress('00AA00000000TD')).toBe('00AA00000000TD:0');
    });

    it('reads a flag as set, not set or not known', () => {
        expect([true, 1, '1', 'true'].map(flagOf)).toEqual([true, true, true, true]);
        expect([false, 0, '0', 'false'].map(flagOf)).toEqual([false, false, false, false]);
        expect([undefined, null, 'x', 2].map(flagOf)).toEqual([undefined, undefined, undefined, undefined]);
    });

    it('puts the dialog in the WebUI step the flags say; a flag not known counts as not set', () => {
        expect(stepOf(false, false)).toBe('top');
        expect(stepOf(undefined, undefined)).toBe('top');
        expect(stepOf(false, true)).toBe('top');
        expect(stepOf(true, false)).toBe('bottom');
        expect(stepOf(true, undefined)).toBe('bottom');
        expect(stepOf(true, true)).toBe('calibrated');
    });

    it('limits the movement time as the WebUI field does: whole seconds, 0 to 30', () => {
        expect(clampDuration(5)).toBe(5);
        expect(clampDuration('12')).toBe(12);
        expect(clampDuration(7.8)).toBe(7);
        expect(clampDuration(31)).toBe(30);
        expect(clampDuration(-1)).toBe(0);
        expect(clampDuration('abc')).toBe(0);
        expect(clampDuration(Number.NaN)).toBe(0);
        expect(clampDuration(undefined)).toBe(0);
    });

    it('writes the datapoints of the WebUI for every move, and no others', () => {
        expect(motionCommand('up', {kind: 'short'})).toEqual({
            MANUAL_SELF_CALIBRATION: ManualCalibration.START_MOTION_WITH_LEVEL_SHORT,
            MANUAL_SELF_CALIBRATION_LEVEL: 1,
        });
        expect(motionCommand('down', {kind: 'long'})).toEqual({
            MANUAL_SELF_CALIBRATION: ManualCalibration.START_MOTION_WITH_LEVEL_LONG,
            MANUAL_SELF_CALIBRATION_LEVEL: 0,
        });
        expect(motionCommand('up', {kind: 'duration', seconds: 45})).toEqual({
            MANUAL_SELF_CALIBRATION: ManualCalibration.START_MOTION_WITH_LEVEL_AND_DURATION,
            MANUAL_SELF_CALIBRATION_LEVEL: 1,
            MANUAL_SELF_CALIBRATION_DURATION_VALUE: 30,
            MANUAL_SELF_CALIBRATION_DURATION_UNIT: 0,
        });
    });

    it('numbers the steps as the WebUI does (its ManualSelfCalibration)', () => {
        expect(plainCommand('clear')).toEqual(step(0));
        expect(plainCommand('saveTop')).toEqual(step(1));
        expect(plainCommand('saveBottom')).toEqual(step(2));
        expect(plainCommand('reverse')).toEqual(step(3));
        expect(plainCommand('stop')).toEqual(step(7));
    });
});

describe('ManualCalibrationSession', () => {
    it('a whole calibration: up, save the top, down, save the bottom - the flags follow the writes', async () => {
        const m = motor();
        const {session: s} = session(m.rpc);
        await s.load();
        expect(s.state).toMatchObject({loaded: true, top: false, bottom: false, step: 'top'});

        await s.reverse();
        await s.move('up', {kind: 'duration', seconds: 8});
        await s.move('up', {kind: 'short'});
        expect(s.state.moved).toBe(true);
        await s.saveTop();
        expect(s.state).toMatchObject({top: true, step: 'bottom', last: {action: 'saveTop', ok: true}});

        await s.move('down', {kind: 'long'});
        await s.saveBottom();
        expect(s.state).toMatchObject({top: true, bottom: true, step: 'saved'});

        expect(m.commands).toEqual([
            step(3),
            {
                MANUAL_SELF_CALIBRATION: 6,
                MANUAL_SELF_CALIBRATION_LEVEL: 1,
                MANUAL_SELF_CALIBRATION_DURATION_VALUE: 8,
                MANUAL_SELF_CALIBRATION_DURATION_UNIT: 0,
            },
            {MANUAL_SELF_CALIBRATION: 4, MANUAL_SELF_CALIBRATION_LEVEL: 1},
            step(1),
            {MANUAL_SELF_CALIBRATION: 5, MANUAL_SELF_CALIBRATION_LEVEL: 0},
            step(2),
        ]);
    });

    it('opens on the lower end position when the device holds the upper one, and calibrated when it holds both', async () => {
        const bottom = session(motor({top: true, bottom: false}).rpc).session;
        await bottom.load();
        expect(bottom.state.step).toBe('bottom');

        const both = session(motor({top: 1, bottom: 1}).rpc).session;
        await both.load();
        expect(both.state.step).toBe('calibrated');
    });

    it('flags hmipserver cannot answer yet (-5) are not known, and the calibration starts at the top', async () => {
        const m = motor({top: undefined, bottom: undefined});
        const {session: s} = session(m.rpc);
        await s.load();
        expect(s.state).toMatchObject({loaded: true, top: undefined, bottom: undefined, step: 'top'});
    });

    it('moves along with the flag events, also those that arrive before the first read answers', async () => {
        const m = motor({top: undefined, bottom: undefined});
        const {session: s} = session(m.rpc);
        // subscribed from the start
        expect(m.listeners.size).toBe(1);
        m.report(TOP_SET_PARAM, true);
        expect(s.state.step).toBe('bottom');
        await s.load();
        // the unreadable read does not take back what the event said
        expect(s.state).toMatchObject({top: true, step: 'bottom'});

        m.report('LEVEL', 0.5);
        m.report(BOTTOM_SET_PARAM, 'garbage');
        expect(s.state.bottom).toBeUndefined();
        m.report(BOTTOM_SET_PARAM, true);
        expect(s.state.step).toBe('calibrated');
    });

    it('stays done after the lower end position was saved here, until the positions are deleted', async () => {
        vi.useFakeTimers();
        const m = motor({top: true, bottom: false});
        const {session: s} = session(m.rpc);
        await s.load();
        await s.saveBottom();
        m.report(BOTTOM_SET_PARAM, true);
        m.report(TOP_SET_PARAM, true);
        expect(s.state.step).toBe('saved');

        m.state.top = false;
        m.state.bottom = false;
        await s.clear();
        expect(s.state).toMatchObject({top: false, bottom: false, step: 'top'});
        expect(m.commands.at(-1)).toEqual(step(0));
    });

    it('reads the flags again a moment after deleting, as the WebUI does', async () => {
        vi.useFakeTimers();
        const m = motor({top: true, bottom: true});
        const {session: s} = session(m.rpc);
        await s.load();
        expect(m.rpc.getFlag).toHaveBeenCalledTimes(2);
        await s.clear();
        expect(s.state.step).toBe('top');
        // the device has cleared them by the time they are read again
        m.state.top = false;
        m.state.bottom = false;
        await vi.advanceTimersByTimeAsync(CLEAR_SETTLE_MS);
        expect(m.rpc.getFlag).toHaveBeenCalledTimes(4);
        expect(s.state).toMatchObject({top: false, bottom: false, step: 'top'});
    });

    it('a refused write changes no step and says so', async () => {
        const m = motor();
        const {session: s} = session(m.rpc);
        await s.load();
        m.state.refuse = true;
        expect(await s.saveTop()).toBe(false);
        expect(s.state).toMatchObject({top: false, step: 'top', last: {action: 'saveTop', ok: false}});
        expect(await s.move('up', {kind: 'short'})).toBe(false);
        expect(s.state.moved).toBe(false);
        expect(await s.clear()).toBe(false);
        expect(s.state.pending).toBe(0);
    });

    it('Stop goes out while another write is under way, and ends "moved"', async () => {
        const m = motor();
        let release: (ok: boolean) => void = () => undefined;
        const slow = new Promise<boolean>((resolve) => (release = resolve));
        vi.mocked(m.rpc.command).mockImplementationOnce(async (values) => {
            m.commands.push(values);
            return slow;
        });
        const {session: s} = session(m.rpc);
        await s.load();
        const moving = s.move('down', {kind: 'duration', seconds: 20});
        expect(s.state.pending).toBe(1);
        const stopped = s.stop();
        expect(m.commands.map((values) => values['MANUAL_SELF_CALIBRATION'])).toEqual([6, 7]);
        await stopped;
        release(true);
        await moving;
        expect(s.state.pending).toBe(0);
        await s.stop();
        expect(s.state.moved).toBe(false);
    });

    it('closing stops a shutter it set moving, and only then', async () => {
        const quiet = motor();
        const idle = session(quiet.rpc).session;
        await idle.load();
        expect(await idle.close()).toBe(false);
        expect(quiet.commands).toEqual([]);
        expect(quiet.listeners.size).toBe(0);

        const m = motor();
        const {session: s} = session(m.rpc);
        await s.load();
        await s.move('up', {kind: 'long'});
        expect(await s.close()).toBe(true);
        expect(m.commands.at(-1)).toEqual(step(7));
        // a closed session writes nothing more, and a second close no second Stop
        expect(await s.move('up', {kind: 'short'})).toBe(false);
        expect(await s.close()).toBe(false);
        expect(m.commands).toHaveLength(2);
    });

    it('after a Stop, closing writes nothing more', async () => {
        const m = motor();
        const {session: s} = session(m.rpc);
        await s.load();
        await s.move('up', {kind: 'short'});
        await s.stop();
        expect(await s.close()).toBe(false);
        expect(m.commands).toEqual([{MANUAL_SELF_CALIBRATION: 4, MANUAL_SELF_CALIBRATION_LEVEL: 1}, step(7)]);
    });

    it('a read that answers after the dialog closed changes nothing', async () => {
        const m = motor({top: true, bottom: true});
        let answer: (value: unknown) => void = () => undefined;
        const late = new Promise<unknown>((resolve) => (answer = resolve));
        vi.mocked(m.rpc.getFlag).mockImplementation(() => late);
        const {session: s, seen} = session(m.rpc);
        const loading = s.load();
        await s.close();
        answer(true);
        await loading;
        expect(seen).toEqual([]);
        expect(s.state.loaded).toBe(false);
    });

    it('works without events', async () => {
        const m = motor({top: true, bottom: false});
        const rpc: ManualCalibrationRpc = {getFlag: m.rpc.getFlag, command: m.rpc.command};
        const {session: s} = session(rpc);
        await s.load();
        await s.saveBottom();
        expect(s.state.step).toBe('saved');
        expect(await s.close()).toBe(false);
    });
});
