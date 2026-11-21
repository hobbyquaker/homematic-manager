import type {Paramset, ParamsetDescription} from '@homematic-manager/core';
import {fireEvent, screen, waitFor} from '@testing-library/svelte';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {HMIP_BLIND_TRANSMITTER_MASTER} from '../../../test/fixtures/deviceDescriptions.js';
import {MockTransport} from '../../lib/transport/MockTransport.js';
import {mountApp} from '../../testHarness.js';

/** The VALUES of a HmIP-BBL's blind channel, as far as the calibration goes. */
const VALUES: ParamsetDescription = {
    LEVEL: {TYPE: 'FLOAT', OPERATIONS: 7, FLAGS: 1, MIN: 0, MAX: 1, DEFAULT: 0},
    SELF_CALIBRATION: {
        TYPE: 'ENUM',
        OPERATIONS: 2,
        FLAGS: 1,
        MIN: 'STOP',
        MAX: 'START',
        DEFAULT: 'STOP',
        VALUE_LIST: ['STOP', 'START'],
    },
    SELF_CALIBRATION_RESULT: {TYPE: 'BOOL', OPERATIONS: 5, FLAGS: 1, MIN: false, MAX: true, DEFAULT: false},
};

const master: Paramset = {
    REFERENCE_RUNNING_TIME_TOP_BOTTOM_UNIT: '1S',
    REFERENCE_RUNNING_TIME_TOP_BOTTOM_VALUE: 90,
    REFERENCE_RUNNING_TIME_BOTTOM_TOP_UNIT: '1S',
    REFERENCE_RUNNING_TIME_BOTTOM_TOP_VALUE: 90,
    REFERENCE_RUNNING_TIME_SLATS_UNIT: '100MS',
    REFERENCE_RUNNING_TIME_SLATS_VALUE: 20,
    CHANGE_OVER_DELAY: 0.5,
    DELAY_COMPENSATION: 12.7,
    ENDPOSITION_AUTO_DETECT: true,
    REFERENCE_RUN_COUNTER: 0,
    EVENT_DELAY_UNIT: '100MS',
    EVENT_DELAY_VALUE: 3,
    EVENT_RANDOMTIME_UNIT: 'S',
    EVENT_RANDOMTIME_VALUE: 1,
};

function without<T extends object>(source: T, name: string): T {
    return Object.fromEntries(Object.entries(source).filter(([key]) => key !== name)) as T;
}

describe('the automatic calibration of a blind channel', () => {
    let transport: MockTransport;
    /** What the device holds: the result datapoint and the MASTER values. */
    let device: {result: boolean; master: Paramset};
    let writes: string[];

    beforeEach(() => {
        transport = new MockTransport({demo: true});
        device = {result: false, master: {...master}};
        writes = [];
        transport.respond('paramset.get', () => device.master);
        transport.respond('value.get', () => device.result);
        transport.respond('value.set', (_interfaceName, _address, parameter, value) => {
            writes.push(`${parameter} ${JSON.stringify(value)}`);
            return null;
        });
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    async function open(
        description: ParamsetDescription = HMIP_BLIND_TRANSMITTER_MASTER,
        values: ParamsetDescription = VALUES,
    ): Promise<void> {
        transport.respond('paramset.description', (_interfaceName, _address, paramset) =>
            paramset === 'VALUES' ? values : description,
        );
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await fireEvent.click(screen.getByTestId('paramset-MEQ0123456-MASTER'));
        await waitFor(() => {
            expect(screen.getByTestId('editor-blind-calibration')).toBeTruthy();
        });
    }

    async function start(): Promise<void> {
        await waitFor(() => {
            expect(screen.getByTestId('blind-auto-calibration-start')).toBeTruthy();
        });
        await fireEvent.click(screen.getByTestId('blind-auto-calibration-start'));
        await fireEvent.click(await screen.findByTestId('blind-auto-calibration-confirm'));
    }

    it('offers the button where the end positions are detected and VALUES has SELF_CALIBRATION', async () => {
        await open();
        await waitFor(() => {
            expect(screen.getByTestId('blind-auto-calibration-start')).toBeTruthy();
        });
        expect(screen.getByTestId<HTMLButtonElement>('blind-auto-calibration-start').disabled).toBe(false);
        // nothing was written or read for it by opening the dialog
        expect(transport.countOf('value.get')).toBe(0);
        expect(writes).toEqual([]);
    });

    it('has no button while ENDPOSITION_AUTO_DETECT is off', async () => {
        device.master = {...master, ENDPOSITION_AUTO_DETECT: false};
        await open();
        await waitFor(() => {
            expect(
                transport.calls.some((call) => call.method === 'paramset.description' && call.params[2] === 'VALUES'),
            ).toBe(true);
        });
        expect(screen.queryByTestId('blind-auto-calibration')).toBeNull();
    });

    it('has no button on a channel without ENDPOSITION_AUTO_DETECT, whatever VALUES has', async () => {
        device.master = without(master, 'ENDPOSITION_AUTO_DETECT');
        await open(without(HMIP_BLIND_TRANSMITTER_MASTER, 'ENDPOSITION_AUTO_DETECT'));
        expect(screen.queryByTestId('blind-auto-calibration')).toBeNull();
        // and VALUES is not even asked for
        expect(
            transport.calls.some((call) => call.method === 'paramset.description' && call.params[2] === 'VALUES'),
        ).toBe(false);
    });

    it('has no button where VALUES has no SELF_CALIBRATION', async () => {
        await open(HMIP_BLIND_TRANSMITTER_MASTER, without(VALUES, 'SELF_CALIBRATION'));
        await waitFor(() => {
            expect(
                transport.calls.some((call) => call.method === 'paramset.description' && call.params[2] === 'VALUES'),
            ).toBe(true);
        });
        expect(screen.queryByTestId('blind-auto-calibration')).toBeNull();
    });

    it('shows the row but waits for the write when the flag was only just ticked', async () => {
        device.master = {...master, ENDPOSITION_AUTO_DETECT: false};
        await open();
        await fireEvent.click(screen.getByTestId('blind-ENDPOSITION_AUTO_DETECT-value'));
        await waitFor(() => {
            expect(screen.getByTestId('blind-auto-calibration-start')).toBeTruthy();
        });
        expect(screen.getByTestId<HTMLButtonElement>('blind-auto-calibration-start').disabled).toBe(true);
        expect(screen.getByTestId('blind-auto-calibration-status').textContent).toContain(
            'Zuerst die Änderung schreiben',
        );
    });

    it('asks before it starts, and writes nothing when the question is cancelled', async () => {
        await open();
        await waitFor(() => {
            expect(screen.getByTestId('blind-auto-calibration-start')).toBeTruthy();
        });
        await fireEvent.click(screen.getByTestId('blind-auto-calibration-start'));
        expect((await screen.findByTestId('blind-auto-calibration-target')).textContent).toContain('MEQ0123456');
        await fireEvent.click(screen.getByTestId('blind-auto-calibration-cancel'));
        expect(transport.countOf('value.get')).toBe(0);
        expect(writes).toEqual([]);
    });

    it('starts, shows the run, and reads MASTER again when the device reports the result', async () => {
        await open();
        vi.useFakeTimers({shouldAdvanceTime: true});
        await start();
        await waitFor(() => {
            expect(writes).toEqual(['SELF_CALIBRATION "START"']);
        });
        expect(transport.lastCall('value.set')?.slice(0, 2)).toEqual(['BidCos-RF', 'MEQ0123456']);
        await waitFor(() => {
            expect(screen.getByTestId('blind-auto-calibration-stop')).toBeTruthy();
        });
        expect(screen.getByTestId('blind-auto-calibration').getAttribute('data-state')).toBe('running');
        expect(screen.queryByTestId('blind-auto-calibration-start')).toBeNull();

        // the device has measured: 42 s down, 44 s up
        device.master = {
            ...master,
            REFERENCE_RUNNING_TIME_TOP_BOTTOM_VALUE: 42,
            REFERENCE_RUNNING_TIME_BOTTOM_TOP_VALUE: 44,
        };
        device.result = true;
        const reads = transport.countOf('paramset.get');
        await vi.advanceTimersByTimeAsync(1100);

        await waitFor(() => {
            expect(screen.getByTestId('blind-auto-calibration').getAttribute('data-state')).toBe('success');
        });
        await waitFor(() => {
            expect(screen.getByTestId<HTMLInputElement>('blind-REFERENCE_RUNNING_TIME_TOP_BOTTOM-seconds').value).toBe(
                '42',
            );
        });
        expect(transport.countOf('paramset.get')).toBe(reads + 1);
        expect(screen.getByTestId<HTMLInputElement>('blind-REFERENCE_RUNNING_TIME_BOTTOM_TOP-seconds').value).toBe(
            '44',
        );
        expect(screen.getByTestId('blind-auto-calibration-start')).toBeTruthy();
        expect(writes).toEqual(['SELF_CALIBRATION "START"']);
    });

    it('sends START, STOP, START when an earlier run left the result true', async () => {
        device.result = true;
        transport.respond('value.set', (_interfaceName, _address, parameter, value) => {
            writes.push(`${parameter} ${JSON.stringify(value)}`);
            if (value === 'STOP') {
                device.result = false;
            }
            return null;
        });
        await open();
        await start();
        await waitFor(() => {
            expect(writes).toEqual(['SELF_CALIBRATION "START"', 'SELF_CALIBRATION "STOP"', 'SELF_CALIBRATION "START"']);
        });
        expect(screen.getByTestId('blind-auto-calibration').getAttribute('data-state')).toBe('running');
    });

    it('stops on the button: STOP is written and MASTER is not read again', async () => {
        await open();
        await start();
        const stop = await screen.findByTestId('blind-auto-calibration-stop');
        const reads = transport.countOf('paramset.get');
        await fireEvent.click(stop);
        await waitFor(() => {
            expect(screen.getByTestId('blind-auto-calibration').getAttribute('data-state')).toBe('stopped');
        });
        expect(writes).toEqual(['SELF_CALIBRATION "START"', 'SELF_CALIBRATION "STOP"']);
        expect(transport.countOf('paramset.get')).toBe(reads);
        expect(screen.getByTestId('blind-auto-calibration-status').textContent).toContain('Kalibrierfahrt gestoppt.');
    });

    it('says so when the start is refused', async () => {
        transport.respond('value.set', () => {
            throw new Error('refused');
        });
        await open();
        await start();
        await waitFor(() => {
            expect(screen.getByTestId('blind-auto-calibration').getAttribute('data-state')).toBe('failed');
        });
        expect(screen.getByTestId('blind-auto-calibration-start')).toBeTruthy();
    });
});
