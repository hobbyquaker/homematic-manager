import type {Paramset, ParamsetDescription} from '@homematic-manager/core';
import {fireEvent, screen, waitFor} from '@testing-library/svelte';
import {beforeEach, describe, expect, it} from 'vitest';

import {HM_BLIND_MASTER, HMIP_BLIND_TRANSMITTER_MASTER} from '../../../../test/fixtures/deviceDescriptions.js';
import {
    blindRawValue,
    blindSeconds,
    coveredParameters,
    detectDeviceEditors,
    setBlindSeconds,
    type BlindCalibrationSpec,
} from '../../../lib/util/editors/index.js';
import {MockTransport} from '../../../lib/transport/MockTransport.js';
import {mountApp} from '../../../testHarness.js';

const target = {
    interfaceName: 'BidCos-RF',
    address: 'MEQ0123456:1',
    channelType: 'BLIND',
    paramset: 'MASTER',
    description: HM_BLIND_MASTER,
};

/** What a HmIP-BBL answers: the running time as a unit name and a count, the delay in seconds. */
const hmipValues = {
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

const bidcosValues = {
    REFERENCE_RUNNING_TIME_TOP_BOTTOM: 50,
    REFERENCE_RUNNING_TIME_BOTTOM_TOP: 50,
    CHANGE_OVER_DELAY: 0.5,
    REFERENCE_RUN_COUNTER: 0,
    AES_ACTIVE: false,
};

function blindSpec(description: ParamsetDescription): BlindCalibrationSpec {
    const spec = detectDeviceEditors({...target, description}).find((entry) => entry.kind === 'blind-calibration');
    if (!spec) {
        throw new Error('no blind editor for this description');
    }
    return spec;
}

describe('detecting a blind calibration', () => {
    it('reads the BidCos shape: the running times are plain FLOAT seconds', () => {
        const spec = blindSpec(HM_BLIND_MASTER);
        expect(spec.runningTimes.map((entry) => entry.id)).toEqual([
            'REFERENCE_RUNNING_TIME_TOP_BOTTOM',
            'REFERENCE_RUNNING_TIME_BOTTOM_TOP',
        ]);
        expect(spec.runningTimes.every((entry) => entry.source.kind === 'seconds')).toBe(true);
        expect(spec.delays.map((entry) => entry.param)).toEqual(['CHANGE_OVER_DELAY']);
        expect(spec.extras.map((entry) => entry.param)).toEqual(['REFERENCE_RUN_COUNTER']);
        // AES_ACTIVE is not part of a calibration and stays an ordinary row.
        expect(coveredParameters([spec]).has('AES_ACTIVE')).toBe(false);
    });

    it('reads the HmIP shape: a unit enum and a 0..16383 count per running time, slats included', () => {
        const spec = blindSpec(HMIP_BLIND_TRANSMITTER_MASTER);
        expect(spec.runningTimes.map((entry) => entry.id)).toEqual([
            'REFERENCE_RUNNING_TIME_TOP_BOTTOM',
            'REFERENCE_RUNNING_TIME_BOTTOM_TOP',
            'REFERENCE_RUNNING_TIME_SLATS',
        ]);
        expect(spec.runningTimes.every((entry) => entry.source.kind === 'pair')).toBe(true);
        expect(spec.delays.map((entry) => entry.param)).toEqual(['CHANGE_OVER_DELAY', 'DELAY_COMPENSATION']);
        expect(spec.extras.map((entry) => entry.param)).toEqual(['REFERENCE_RUN_COUNTER', 'ENDPOSITION_AUTO_DETECT']);
    });

    it('recognises nothing where there is no reference run time', () => {
        const description: ParamsetDescription = {
            CHANGE_OVER_DELAY: {TYPE: 'FLOAT', OPERATIONS: 3, MIN: 0, MAX: 25.5, UNIT: 's'},
        };
        const specs = detectDeviceEditors({...target, description});
        expect(specs.some((spec) => spec.kind === 'blind-calibration')).toBe(false);
        expect(coveredParameters(specs).has('CHANGE_OVER_DELAY')).toBe(false);
    });

    it('claims the running-time pairs before the duration picker sees them', () => {
        const specs = detectDeviceEditors({...target, description: HMIP_BLIND_TRANSMITTER_MASTER});
        expect(specs.map((spec) => spec.kind)).toEqual(['blind-calibration', 'duration-pairs']);
        const durations = specs.find((spec) => spec.kind === 'duration-pairs');
        // The two EVENT_* pairs are durations and not part of the calibration; the three running
        // times are gone from the duration picker because the blind editor already drew them.
        expect(durations?.pairs.map((view) => view.pair.name).sort()).toEqual(['EVENT_DELAY', 'EVENT_RANDOMTIME']);
    });
});

describe('reading and writing a running time', () => {
    it('multiplies the HmIP pair into seconds and prints the raw value next to it', () => {
        const spec = blindSpec(HMIP_BLIND_TRANSMITTER_MASTER);
        const slats = spec.runningTimes[2];
        expect(slats).toBeDefined();
        expect(blindSeconds(slats!, hmipValues)).toBe(2);
        expect(blindRawValue(slats!, hmipValues)).toBe('20 × 100MS');
    });

    it('takes a BidCos running time as the seconds it already is', () => {
        const entry = blindSpec(HM_BLIND_MASTER).runningTimes[0];
        expect(blindSeconds(entry!, bidcosValues)).toBe(50);
        expect(blindRawValue(entry!, bidcosValues)).toBe('REFERENCE_RUNNING_TIME_TOP_BOTTOM = 50');
    });

    it('encodes seconds back into the pair the device wants', () => {
        const entry = blindSpec(HMIP_BLIND_TRANSMITTER_MASTER).runningTimes[0];
        // The finest unit that still fits wins, and 10 ms x 4500 is the same 45 s the CCU shows.
        expect(setBlindSeconds(entry!, 45)).toEqual({
            values: {REFERENCE_RUNNING_TIME_TOP_BOTTOM_UNIT: 0, REFERENCE_RUNNING_TIME_TOP_BOTTOM_VALUE: 4500},
            exact: true,
            seconds: 45,
        });
        // 10 ms is the finest step the pair has, so 45.005 s is not reachable.
        expect(setBlindSeconds(entry!, 45.005)?.exact).toBe(false);
    });

    it('refuses a value the BidCos description cannot hold instead of clamping silently', () => {
        const entry = blindSpec(HM_BLIND_MASTER).runningTimes[0];
        expect(setBlindSeconds(entry!, 6001)).toBeUndefined();
        expect(setBlindSeconds(entry!, -1)).toBeUndefined();
        expect(setBlindSeconds(entry!, 12)).toEqual({
            values: {REFERENCE_RUNNING_TIME_TOP_BOTTOM: 12},
            exact: true,
            seconds: 12,
        });
    });

    it('reports a half the device did not answer with rather than inventing a duration', () => {
        const spec = blindSpec(HMIP_BLIND_TRANSMITTER_MASTER);
        expect(blindSeconds(spec.runningTimes[0]!, {})).toBeUndefined();
        expect(blindRawValue(spec.runningTimes[0]!, {})).toBe('— × —');
        expect(blindSeconds(blindSpec(HM_BLIND_MASTER).runningTimes[0]!, {})).toBeUndefined();
    });
});

describe('the calibration block in the dialog', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
    });

    async function open(description: ParamsetDescription, values: Paramset): Promise<void> {
        transport.result('paramset.description', description);
        transport.result('paramset.get', values);
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await fireEvent.click(screen.getByTestId('paramset-MEQ0123456-MASTER'));
        await waitFor(() => {
            expect(screen.getByTestId('editor-blind-calibration')).toBeTruthy();
        });
    }

    it('shows the plain seconds next to the raw value, and hides the raw rows', async () => {
        await open(HMIP_BLIND_TRANSMITTER_MASTER, hmipValues);
        expect((screen.getByTestId('blind-REFERENCE_RUNNING_TIME_TOP_BOTTOM-seconds') as HTMLInputElement).value).toBe(
            '90',
        );
        expect(screen.getByTestId('blind-REFERENCE_RUNNING_TIME_TOP_BOTTOM-raw').textContent).toContain('90 × 1S');
        expect(screen.queryByTestId('param-REFERENCE_RUNNING_TIME_TOP_BOTTOM_VALUE')).toBeNull();
        expect(screen.queryByTestId('param-CHANGE_OVER_DELAY')).toBeNull();
    });

    it('writes the unit and the count of the pair, not the seconds', async () => {
        await open(HMIP_BLIND_TRANSMITTER_MASTER, hmipValues);
        await fireEvent.input(screen.getByTestId('blind-REFERENCE_RUNNING_TIME_SLATS-seconds'), {
            target: {value: '3.5'},
        });
        await fireEvent.click(screen.getByTestId('paramset-preview'));
        await fireEvent.click(screen.getByTestId('write-confirm'));

        await waitFor(() => {
            expect(transport.lastCall('paramset.put')?.[3]).toEqual({
                REFERENCE_RUNNING_TIME_SLATS_UNIT: 0,
                REFERENCE_RUNNING_TIME_SLATS_VALUE: 350,
            });
        });
    });

    it('writes a BidCos running time as the FLOAT it is', async () => {
        await open(HM_BLIND_MASTER, bidcosValues);
        await fireEvent.input(screen.getByTestId('blind-REFERENCE_RUNNING_TIME_BOTTOM_TOP-seconds'), {
            target: {value: '61.5'},
        });
        await fireEvent.click(screen.getByTestId('paramset-preview'));
        await fireEvent.click(screen.getByTestId('write-confirm'));

        await waitFor(() => {
            // A FLOAT goes on the wire as an explicit double - the generic write path decides
            // that, not the editor.
            expect(transport.lastCall('paramset.put')?.[3]).toEqual({
                REFERENCE_RUNNING_TIME_BOTTOM_TOP: {explicitDouble: 61.5},
            });
        });
    });

    it('offers the change-over delay and the auto-detection flag in the same block', async () => {
        await open(HMIP_BLIND_TRANSMITTER_MASTER, hmipValues);
        await fireEvent.input(screen.getByTestId('blind-CHANGE_OVER_DELAY-value'), {target: {value: '1.5'}});
        await fireEvent.click(screen.getByTestId('blind-ENDPOSITION_AUTO_DETECT-value'));
        await fireEvent.click(screen.getByTestId('paramset-preview'));
        await fireEvent.click(screen.getByTestId('write-confirm'));

        await waitFor(() => {
            expect(transport.lastCall('paramset.put')?.[3]).toEqual({
                CHANGE_OVER_DELAY: {explicitDouble: 1.5},
                ENDPOSITION_AUTO_DETECT: false,
            });
        });
    });

    it('says when the pair can only do something close to what was asked for', async () => {
        await open(HMIP_BLIND_TRANSMITTER_MASTER, hmipValues);
        await fireEvent.input(screen.getByTestId('blind-REFERENCE_RUNNING_TIME_SLATS-seconds'), {
            target: {value: '3.505'},
        });
        await waitFor(() => {
            expect(screen.getByTestId('blind-REFERENCE_RUNNING_TIME_SLATS-inexact')).toBeTruthy();
        });
    });

    it('puts every raw parameter back when the box is ticked', async () => {
        await open(HM_BLIND_MASTER, bidcosValues);
        await fireEvent.click(screen.getByTestId('paramset-show-covered'));
        await waitFor(() => {
            expect(screen.getByTestId('param-CHANGE_OVER_DELAY')).toBeTruthy();
        });
        expect(screen.getByTestId('param-REFERENCE_RUNNING_TIME_TOP_BOTTOM')).toBeTruthy();
    });
});
