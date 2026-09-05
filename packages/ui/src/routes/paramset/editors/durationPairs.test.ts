import type {ParamsetDescription} from '@homematic-manager/core';
import {fireEvent, screen, waitFor} from '@testing-library/svelte';
import {beforeEach, describe, expect, it} from 'vitest';

import {HMIPW_DRS8_SWITCH_MASTER} from '../../../../test/fixtures/deviceDescriptions.js';
import {
    coveredParameters,
    detectDeviceEditors,
    formatSeconds,
    setDuration,
    type DurationPairsSpec,
} from '../../../lib/util/editors/index.js';
import {MockTransport} from '../../../lib/transport/MockTransport.js';
import {mountApp} from '../../../testHarness.js';

const target = {
    interfaceName: 'HmIP-RF',
    address: 'ABC0123456:1',
    channelType: 'SWITCH_VIRTUAL_RECEIVER',
    paramset: 'MASTER',
    description: HMIPW_DRS8_SWITCH_MASTER,
};

/** The demo values a real HmIPW-DRS8 answers with: the unit as its enum name, the count as a number. */
const values = {
    POWERUP_ONDELAY_UNIT: '100MS',
    POWERUP_ONDELAY_VALUE: 0,
    POWERUP_ONTIME_UNIT: 'H',
    POWERUP_ONTIME_VALUE: 31,
    POWERUP_OFFDELAY_UNIT: '100MS',
    POWERUP_OFFDELAY_VALUE: 0,
    POWERUP_OFFTIME_UNIT: 'H',
    POWERUP_OFFTIME_VALUE: 31,
    POWERUP_JUMPTARGET: 0,
    LOGIC_COMBINATION: 1,
};

function durationSpec(description: ParamsetDescription = HMIPW_DRS8_SWITCH_MASTER): DurationPairsSpec {
    const spec = detectDeviceEditors({...target, description}).find((entry) => entry.kind === 'duration-pairs');
    if (!spec) {
        throw new Error('no duration editor for this description');
    }
    return spec;
}

describe('the device editor registry', () => {
    it('recognises the four duration pairs of a real HmIP MASTER description', () => {
        const spec = durationSpec();
        expect(spec.pairs.map((view) => view.pair.name)).toEqual([
            'POWERUP_ONDELAY',
            'POWERUP_OFFTIME',
            'POWERUP_OFFDELAY',
            'POWERUP_ONTIME',
        ]);
        // Exactly the eight parameters of the four pairs leave the generic list - the two enums
        // that are not durations stay.
        expect([...coveredParameters([spec])].sort()).toEqual([
            'POWERUP_OFFDELAY_UNIT',
            'POWERUP_OFFDELAY_VALUE',
            'POWERUP_OFFTIME_UNIT',
            'POWERUP_OFFTIME_VALUE',
            'POWERUP_ONDELAY_UNIT',
            'POWERUP_ONDELAY_VALUE',
            'POWERUP_ONTIME_UNIT',
            'POWERUP_ONTIME_VALUE',
        ]);
    });

    it('recognises nothing in a description that has no pair, and hides nothing', () => {
        const description: ParamsetDescription = {
            LOGGING: {TYPE: 'ENUM', OPERATIONS: 3, VALUE_LIST: ['OFF', 'ON']},
            ON_TIME: {TYPE: 'FLOAT', OPERATIONS: 3, MIN: 0, MAX: 100, UNIT: 's'},
        };
        const specs = detectDeviceEditors({...target, description});
        expect(specs).toEqual([]);
        expect(coveredParameters(specs).size).toBe(0);
    });

    it('takes the "not used" value from the pair rather than from a constant (#96)', () => {
        const spec = durationSpec();
        // The eight time bases end at 111600 s; a pair whose finest step is 10 ms and whose count
        // runs to 16383 ends somewhere else entirely, which is the whole point of #96.
        expect(spec.pairs.every((view) => view.notUsedSeconds === 111_600)).toBe(true);
        expect(spec.pairs.every((view) => view.notUsedFromSpecial)).toBe(false);
    });

    it('marks a pair read-only when either half is', () => {
        const readOnly: ParamsetDescription = {
            ...HMIPW_DRS8_SWITCH_MASTER,
            POWERUP_ONTIME_VALUE: {TYPE: 'INTEGER', OPERATIONS: 1, MIN: 0, MAX: 31},
        };
        const view = durationSpec(readOnly).pairs.find((entry) => entry.pair.name === 'POWERUP_ONTIME');
        expect(view?.writable).toBe(false);
    });
});

describe('setDuration', () => {
    it('returns both halves of the pair, and says when the encoding is exact', () => {
        const view = durationSpec().pairs[0];
        expect(view).toBeDefined();
        expect(setDuration(view!, 300)).toEqual({
            values: {POWERUP_ONDELAY_UNIT: 3, POWERUP_ONDELAY_VALUE: 30},
            exact: true,
            seconds: 300,
        });
    });

    it('says so when the pair rounds, and refuses a value it cannot encode at all', () => {
        const view = durationSpec().pairs[0];
        expect(setDuration(view!, 7.05)).toMatchObject({exact: false, seconds: 7});
        expect(setDuration(view!, -1)).toBeUndefined();
    });
});

describe('formatSeconds', () => {
    it('reads a duration out loud in the units the CCU thinks in', () => {
        expect(formatSeconds(0)).toBe('0 s');
        expect(formatSeconds(0.1)).toBe('100 ms');
        expect(formatSeconds(45)).toBe('45 s');
        expect(formatSeconds(90)).toBe('1 min 30 s');
        expect(formatSeconds(3600)).toBe('1 h');
        expect(formatSeconds(111_600)).toBe('31 h');
        expect(formatSeconds(5430.5)).toBe('1 h 30 min 30.5 s');
        expect(formatSeconds(Number.NaN)).toBe('—');
    });
});

describe('the duration picker in the dialog', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
        transport.result('paramset.description', HMIPW_DRS8_SWITCH_MASTER);
        transport.result('paramset.get', values);
    });

    async function openMaster(): Promise<void> {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await fireEvent.click(screen.getByTestId('paramset-MEQ0123456-MASTER'));
        await waitFor(() => {
            expect(screen.getByTestId('editor-duration-pairs')).toBeTruthy();
        });
    }

    it('draws one row per pair and takes the raw rows out of the generic list', async () => {
        await openMaster();
        expect(screen.getByTestId('duration-POWERUP_ONTIME')).toBeTruthy();
        expect(screen.queryByTestId('param-POWERUP_ONTIME_UNIT')).toBeNull();
        expect(screen.queryByTestId('param-POWERUP_ONTIME_VALUE')).toBeNull();
        // What no editor claimed is still a normal row.
        expect(screen.getByTestId('param-POWERUP_JUMPTARGET')).toBeTruthy();
    });

    it('shows the duration the two parameters mean', async () => {
        await openMaster();
        expect(screen.getByTestId('duration-POWERUP_ONTIME-result').textContent).toContain('31 h');
        expect(screen.getByTestId('duration-POWERUP_ONDELAY-result').textContent).toContain('0 s');
    });

    it('puts the raw rows back on request, so nothing is ever unreachable', async () => {
        await openMaster();
        await fireEvent.click(screen.getByTestId('paramset-show-covered'));
        await waitFor(() => {
            expect(screen.getByTestId('param-POWERUP_ONTIME_UNIT')).toBeTruthy();
        });
        expect(screen.getByTestId('duration-POWERUP_ONTIME')).toBeTruthy();
    });

    it('writes both halves of the pair through the generic changed-only preview', async () => {
        await openMaster();
        await fireEvent.input(screen.getByTestId('duration-POWERUP_ONDELAY-seconds'), {target: {value: '300'}});

        await fireEvent.click(screen.getByTestId('paramset-preview'));
        await waitFor(() => {
            expect(screen.getByTestId('write-preview')).toBeTruthy();
        });
        await fireEvent.click(screen.getByTestId('write-confirm'));

        await waitFor(() => {
            expect(transport.lastCall('paramset.put')).toEqual([
                'BidCos-RF',
                ['MEQ0123456'],
                'MASTER',
                {POWERUP_ONDELAY_UNIT: 3, POWERUP_ONDELAY_VALUE: 30},
                undefined,
            ]);
        });
    });

    it('says when the device can only do something close to what was asked for', async () => {
        await openMaster();
        await fireEvent.input(screen.getByTestId('duration-POWERUP_ONDELAY-seconds'), {target: {value: '7.05'}});
        await waitFor(() => {
            expect(screen.getByTestId('duration-POWERUP_ONDELAY-inexact').textContent).toContain('7 s');
        });
    });

    it('sets the pair maximum for "not used", and clears it again', async () => {
        await openMaster();
        const box = screen.getByTestId<HTMLInputElement>('duration-POWERUP_ONDELAY-not-used');
        expect(box.checked).toBe(false);
        await fireEvent.click(box);
        await waitFor(() => {
            expect(screen.getByTestId('duration-POWERUP_ONDELAY-result').textContent).toContain('31 h');
        });

        await fireEvent.click(screen.getByTestId('duration-POWERUP_ONTIME-not-used'));
        await waitFor(() => {
            expect(screen.getByTestId('duration-POWERUP_ONTIME-result').textContent).toContain('0 s');
        });
    });

    it('keeps the duration when the unit changes, and follows the count when it changes', async () => {
        await openMaster();
        // 31 h in the coarsest unit; asking for minutes clamps at 31 * 60 s, the finer resolution.
        await fireEvent.change(screen.getByTestId('duration-POWERUP_ONTIME-unit'), {target: {value: '4'}});
        await waitFor(() => {
            expect(screen.getByTestId('duration-POWERUP_ONTIME-result').textContent).toContain('31 min');
        });

        await fireEvent.input(screen.getByTestId('duration-POWERUP_ONTIME-count'), {target: {value: '5'}});
        await waitFor(() => {
            expect(screen.getByTestId('duration-POWERUP_ONTIME-result').textContent).toContain('5 min');
        });
    });
});
