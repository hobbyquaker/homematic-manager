import type {Paramset, ParamsetDescription, ParamsetValue} from '@homematic-manager/core';
import {fireEvent, screen, waitFor} from '@testing-library/svelte';
import {beforeEach, describe, expect, it} from 'vitest';

import {HMIP_SWITCH_WEEK_PROFILE_MASTER} from '../../../../test/fixtures/deviceDescriptions.js';
import {
    coveredParameters,
    detectDeviceEditors,
    hasWeekdayBit,
    isSlotUnused,
    parseSwitchTime,
    switchParam,
    switchTime,
    toggleWeekdayBit,
    WEEKDAY_BIT_LABELS,
    type SwitchProfileSpec,
} from '../../../lib/util/editors/index.js';
import {MockTransport} from '../../../lib/transport/MockTransport.js';
import {mountApp} from '../../../testHarness.js';

const target = {
    interfaceName: 'HmIP-RF',
    address: 'ABC0123456:4',
    channelType: 'SWITCH_WEEK_PROFILE',
    paramset: 'MASTER',
    description: HMIP_SWITCH_WEEK_PROFILE_MASTER,
};

function switchSpec(description: ParamsetDescription = HMIP_SWITCH_WEEK_PROFILE_MASTER): SwitchProfileSpec {
    const spec = detectDeviceEditors({...target, description}).find((entry) => entry.kind === 'switch-week-profile');
    if (!spec) {
        throw new Error('no switching profile editor for this description');
    }
    return spec;
}

/** Two slots in use - Monday and Tuesday at 06:30 - and the rest switched off. */
function programme(spec: SwitchProfileSpec): Paramset {
    const values: Record<string, ParamsetValue> = {};
    for (const [index, slot] of spec.slots.entries()) {
        values[switchParam(slot, 'WEEKDAY')] = index < 2 ? 2 << index : 0;
        values[switchParam(slot, 'FIXED_HOUR')] = 6;
        values[switchParam(slot, 'FIXED_MINUTE')] = 30;
        values[switchParam(slot, 'CONDITION')] = 0;
        values[switchParam(slot, 'ASTRO_TYPE')] = 0;
        values[switchParam(slot, 'ASTRO_OFFSET')] = 0;
        values[switchParam(slot, 'LEVEL')] = index < 2 ? 1 : 0;
        values[switchParam(slot, 'DURATION_BASE')] = 7;
        values[switchParam(slot, 'DURATION_FACTOR')] = 31;
        values[switchParam(slot, 'TARGET_CHANNELS')] = 1;
    }
    return values;
}

describe('detecting a switching programme', () => {
    it('reads the slots and the columns off a real SWITCH_WEEK_PROFILE description', () => {
        const spec = switchSpec();
        expect(spec.slots).toEqual(['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']);
        expect(spec.columns.map((column) => column.id)).toEqual([
            'WEEKDAY',
            'TIME',
            'CONDITION',
            'ASTRO_TYPE',
            'ASTRO_OFFSET',
            'LEVEL',
            'DURATION',
            'TARGET_CHANNELS',
        ]);
        // Ten parameters per slot, and every one of them is drawn by a column.
        expect(spec.covers).toHaveLength(120);
        expect(coveredParameters([spec]).has('01_WP_DURATION_FACTOR')).toBe(true);
    });

    it('turns the duration base and factor of every slot into one pair', () => {
        const spec = switchSpec();
        expect(Object.keys(spec.durations)).toHaveLength(spec.slots.length);
        expect(spec.durations['01:DURATION']?.unitParam).toBe('01_WP_DURATION_BASE');
        expect(spec.durations['12:DURATION']?.countParam).toBe('12_WP_DURATION_FACTOR');
    });

    it('claims the slot durations before the duration picker sees them', () => {
        const specs = detectDeviceEditors(target);
        expect(specs.map((spec) => spec.kind)).toEqual(['switch-week-profile']);
    });

    it('stands down where the slots do not all look alike', () => {
        const broken = {...HMIP_SWITCH_WEEK_PROFILE_MASTER};
        delete (broken as Record<string, unknown>)['05_WP_ASTRO_OFFSET'];
        const specs = detectDeviceEditors({...target, description: broken});
        expect(specs.some((spec) => spec.kind === 'switch-week-profile')).toBe(false);
        expect(coveredParameters(specs).has('01_WP_WEEKDAY')).toBe(false);
    });

    it('stands down where a slot has no weekday mask at all', () => {
        const description: ParamsetDescription = {
            '01_WP_LEVEL': {TYPE: 'FLOAT', OPERATIONS: 3, MIN: 0, MAX: 1},
        };
        expect(detectDeviceEditors({...target, description}).some((spec) => spec.kind === 'switch-week-profile')).toBe(
            false,
        );
    });

    it('recognises nothing in a description without a slot', () => {
        const description: ParamsetDescription = {LOGGING: {TYPE: 'ENUM', OPERATIONS: 3, VALUE_LIST: ['OFF', 'ON']}};
        expect(detectDeviceEditors({...target, description}).some((spec) => spec.kind === 'switch-week-profile')).toBe(
            false,
        );
    });
});

describe('the weekday bit mask and the fixed time', () => {
    it('reads and flips a bit without touching the others', () => {
        expect(hasWeekdayBit(0b0000010, 1)).toBe(true);
        expect(hasWeekdayBit(0b0000010, 2)).toBe(false);
        expect(hasWeekdayBit(undefined, 0)).toBe(false);
        expect(toggleWeekdayBit(0b0000010, 2, true)).toBe(0b0000110);
        expect(toggleWeekdayBit(0b0000110, 1, false)).toBe(0b0000100);
        expect(toggleWeekdayBit(undefined, 0, true)).toBe(1);
    });

    /**
     * A-17, measured 2026-09-05 (OQ-16): the CCU's own weekly-programme dialog
     * (`/www/config/easymodes/js/HmIPWeeklyProgram.js`, identical on CCU3 firmware 3.89.8 and
     * OpenCCU 3.89.8) gives each weekday checkbox the bit value as its `value` and sums the ticked
     * ones into `NN_WP_WEEKDAY`. This pins that table, so a later reordering of the labels - which
     * would silently mislabel every slot a user has configured in the WebUI - fails here.
     */
    it('labels the bits the way the CCU s own weekly-programme dialog numbers them (A-17)', () => {
        expect(WEEKDAY_BIT_LABELS).toEqual([
            'Sunday',
            'Monday',
            'Tuesday',
            'Wednesday',
            'Thursday',
            'Friday',
            'Saturday',
        ]);
        const valueOfDay = {Sunday: 1, Monday: 2, Tuesday: 4, Wednesday: 8, Thursday: 16, Friday: 32, Saturday: 64};
        for (const [bit, label] of WEEKDAY_BIT_LABELS.entries()) {
            expect(toggleWeekdayBit(0, bit, true)).toBe(valueOfDay[label as keyof typeof valueOfDay]);
            expect(hasWeekdayBit(valueOfDay[label as keyof typeof valueOfDay], bit)).toBe(true);
        }
        // every day ticked, as the dialog writes it
        expect(WEEKDAY_BIT_LABELS.reduce((mask, _label, bit) => toggleWeekdayBit(mask, bit, true), 0)).toBe(127);
    });

    it('reads the two time parameters as a clock time and back', () => {
        expect(switchTime({'01_WP_FIXED_HOUR': 6, '01_WP_FIXED_MINUTE': 5}, '01')).toBe('06:05');
        expect(switchTime({'01_WP_FIXED_HOUR': 6}, '01')).toBe('');
        expect(parseSwitchTime('01', '18:45')).toEqual({'01_WP_FIXED_HOUR': 18, '01_WP_FIXED_MINUTE': 45});
        expect(parseSwitchTime('01', '24:00')).toBeUndefined();
        expect(parseSwitchTime('01', '6')).toBeUndefined();
    });

    it('calls a slot without a weekday unused, which is what an empty mask means', () => {
        expect(isSlotUnused({'01_WP_WEEKDAY': 0}, '01')).toBe(true);
        expect(isSlotUnused({}, '01')).toBe(true);
        expect(isSlotUnused({'01_WP_WEEKDAY': 4}, '01')).toBe(false);
    });
});

describe('the switching programme in the dialog', () => {
    let transport: MockTransport;
    const spec = switchSpec();

    beforeEach(() => {
        transport = new MockTransport({demo: true});
        transport.result('paramset.description', HMIP_SWITCH_WEEK_PROFILE_MASTER);
        transport.result('paramset.get', programme(spec));
    });

    async function open(): Promise<void> {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await fireEvent.click(screen.getByTestId('paramset-MEQ0123456-MASTER'));
        await waitFor(() => {
            expect(screen.getByTestId('editor-switch-week-profile')).toBeTruthy();
        });
    }

    it('draws the slots in use and hides the empty ones until they are asked for', async () => {
        await open();
        expect(screen.getByTestId('switch-slot-01')).toBeTruthy();
        expect(screen.queryByTestId('switch-slot-03')).toBeNull();

        await fireEvent.click(screen.getByTestId('switch-show-unused'));
        await waitFor(() => {
            expect(screen.getByTestId('switch-slot-12')).toBeTruthy();
        });
    });

    it('takes all 120 raw rows out of the generic list, and puts them back on request', async () => {
        await open();
        expect(screen.queryByTestId('param-01_WP_WEEKDAY')).toBeNull();
        await fireEvent.click(screen.getByTestId('paramset-show-covered'));
        await waitFor(() => {
            expect(screen.getByTestId('param-01_WP_WEEKDAY')).toBeTruthy();
        });
    });

    it('shows the raw mask next to the day boxes, because the bit order is an assumption', async () => {
        await open();
        expect(screen.getByTestId('switch-01-mask').textContent).toContain('2');
        expect(screen.getByTestId<HTMLInputElement>('switch-01-day-1').checked).toBe(true);
        expect(screen.getByTestId<HTMLInputElement>('switch-01-day-0').checked).toBe(false);
    });

    it('writes the whole mask when one day is switched on', async () => {
        await open();
        await fireEvent.click(screen.getByTestId('switch-01-day-2'));
        await fireEvent.click(screen.getByTestId('paramset-preview'));
        await fireEvent.click(screen.getByTestId('write-confirm'));

        await waitFor(() => {
            expect(transport.lastCall('paramset.put')?.[3]).toEqual({'01_WP_WEEKDAY': 6});
        });
    });

    it('writes the hour and the minute of a clock time', async () => {
        await open();
        await fireEvent.change(screen.getByTestId('switch-01-time'), {target: {value: '18:45'}});
        await fireEvent.click(screen.getByTestId('paramset-preview'));
        await fireEvent.click(screen.getByTestId('write-confirm'));

        await waitFor(() => {
            expect(transport.lastCall('paramset.put')?.[3]).toEqual({
                '01_WP_FIXED_HOUR': 18,
                '01_WP_FIXED_MINUTE': 45,
            });
        });
    });

    it('shows the slot duration in seconds and writes the base and the factor', async () => {
        await open();
        expect(screen.getByTestId('switch-01-DURATION-result').textContent).toContain('31 h');
        await fireEvent.input(screen.getByTestId('switch-01-DURATION'), {target: {value: '300'}});
        await fireEvent.click(screen.getByTestId('paramset-preview'));
        await fireEvent.click(screen.getByTestId('write-confirm'));

        await waitFor(() => {
            expect(transport.lastCall('paramset.put')?.[3]).toEqual({
                '01_WP_DURATION_BASE': 3,
                '01_WP_DURATION_FACTOR': 30,
            });
        });
    });

    it('offers the eight astro conditions as a select', async () => {
        await open();
        const select = screen.getByTestId<HTMLSelectElement>('switch-01-CONDITION');
        expect(select.options).toHaveLength(8);
        await fireEvent.change(select, {target: {value: '1'}});
        await fireEvent.click(screen.getByTestId('paramset-preview'));
        await fireEvent.click(screen.getByTestId('write-confirm'));

        await waitFor(() => {
            expect(transport.lastCall('paramset.put')?.[3]).toEqual({'01_WP_CONDITION': 1});
        });
    });
});
