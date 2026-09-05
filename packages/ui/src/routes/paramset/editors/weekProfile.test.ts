import type {Paramset, ParamsetDescription, ParamsetValue} from '@homematic-manager/core';
import {fireEvent, screen, waitFor, within} from '@testing-library/svelte';
import {beforeEach, describe, expect, it} from 'vitest';

import {
    HM_CC_RT_DN_MASTER,
    HM_CC_TC_REGULATOR_MASTER,
    HM_TC_IT_WM_MASTER,
    HMIP_HEATING_MASTER,
} from '../../../../test/fixtures/deviceDescriptions.js';
import {
    copyWeekDay,
    copyWeekProfile,
    coveredParameters,
    detectDeviceEditors,
    formatMinutes,
    parseMinutes,
    slotParam,
    validateWeekProfile,
    WEEKDAYS,
    type WeekProfileSpec,
} from '../../../lib/util/editors/index.js';
import {MockTransport} from '../../../lib/transport/MockTransport.js';
import {mountApp} from '../../../testHarness.js';

const target = {
    interfaceName: 'HmIP-RF',
    address: 'ABC0123456:1',
    channelType: 'HEATING_CLIMATECONTROL_TRANSCEIVER',
    paramset: 'MASTER',
    description: HMIP_HEATING_MASTER,
};

function weekSpec(description: ParamsetDescription): WeekProfileSpec {
    const spec = detectDeviceEditors({...target, description}).find((entry) => entry.kind === 'week-profile');
    if (!spec) {
        throw new Error('no week profile editor for this description');
    }
    return spec;
}

/**
 * A plausible programme: comfort from 06:00 to 22:00, lowered outside it, every day the same, and
 * the unused slots parked on the end of the day - which is how the CCU expresses "unused".
 */
function programme(spec: WeekProfileSpec, profiles = spec.profiles): Paramset {
    const values: Record<string, ParamsetValue> = {};
    for (const profile of profiles) {
        for (const day of spec.days) {
            for (let slot = 1; slot <= spec.slots; slot += 1) {
                const endTime = slot === 1 ? 360 : slot === 2 ? 1320 : spec.dayEnd;
                values[slotParam(profile.endTimePrefix, day, slot)] = endTime;
                values[slotParam(profile.valuePrefix, day, slot)] = slot === 2 ? 21 : 17;
            }
        }
    }
    return values;
}

describe('detecting a week programme', () => {
    it('reads the HmIP shape: three profiles, seven days, 13 slots', () => {
        const spec = weekSpec(HMIP_HEATING_MASTER);
        expect(spec.profiles.map((profile) => profile.id)).toEqual(['P1', 'P2', 'P3']);
        expect(spec.days).toEqual(WEEKDAYS);
        expect(spec.slots).toBe(13);
        expect(spec.endTimeField).toBe('ENDTIME');
        expect(spec.valueField).toBe('TEMPERATURE');
        expect(spec.dayEnd).toBe(1440);
        // 3 profiles x 7 days x 13 slots x 2 parameters.
        expect(spec.covers).toHaveLength(546);
        // The 24 parameters that are not part of the programme stay generic rows.
        expect(coveredParameters([spec]).has('TEMPERATURE_COMFORT')).toBe(false);
        expect(coveredParameters([spec]).has('DECALCIFICATION_WEEKDAY')).toBe(false);
    });

    it('reads the BidCos device MASTER of a HM-CC-RT-DN: one unnamed profile', () => {
        const spec = weekSpec(HM_CC_RT_DN_MASTER);
        expect(spec.profiles.map((profile) => profile.id)).toEqual(['']);
        expect(spec.profiles[0]?.endTimePrefix).toBe('ENDTIME');
        expect(spec.slots).toBe(13);
        expect(spec.covers).toHaveLength(182);
    });

    it('reads the 24-slot HM-CC-TC shape, TIMEOUT and TEMPERATUR without an E', () => {
        const spec = weekSpec(HM_CC_TC_REGULATOR_MASTER);
        expect(spec.endTimeField).toBe('TIMEOUT');
        expect(spec.valueField).toBe('TEMPERATUR');
        expect(spec.slots).toBe(24);
        expect(spec.covers).toHaveLength(336);
        // TEMPERATUR_COMFORT_VALUE is not a slot and keeps its own row.
        expect(coveredParameters([spec]).has('TEMPERATUR_COMFORT_VALUE')).toBe(false);
    });

    it('reads the BidCos P1..P3 shape of a HM-TC-IT-WM-W-EU, where the end times carry a unit', () => {
        const spec = weekSpec(HM_TC_IT_WM_MASTER);
        expect(spec.profiles.map((profile) => profile.id)).toEqual(['P1', 'P2', 'P3']);
        expect(spec.slots).toBe(13);
        expect(spec.endTimeDescription.UNIT).toBe('minutes');
    });

    it('stands down where a slot is missing, rather than hiding the rest', () => {
        const broken = {...HM_CC_RT_DN_MASTER};
        delete (broken as Record<string, unknown>)['ENDTIME_WEDNESDAY_7'];
        const specs = detectDeviceEditors({...target, description: broken});
        expect(specs.some((spec) => spec.kind === 'week-profile')).toBe(false);
        expect(coveredParameters(specs).size).toBe(0);
    });

    it('stands down where a profile has an end time but no value', () => {
        const description: ParamsetDescription = Object.fromEntries(
            WEEKDAYS.map((day) => [`ENDTIME_${day}_1`, {TYPE: 'INTEGER', OPERATIONS: 3, MIN: 5, MAX: 1440}]),
        );
        expect(detectDeviceEditors({...target, description}).some((spec) => spec.kind === 'week-profile')).toBe(false);
    });

    it('stands down where a day is missing entirely', () => {
        const description: ParamsetDescription = Object.fromEntries(
            WEEKDAYS.slice(0, 6).flatMap((day) => [
                [`ENDTIME_${day}_1`, {TYPE: 'INTEGER', OPERATIONS: 3, MIN: 5, MAX: 1440}],
                [`TEMPERATURE_${day}_1`, {TYPE: 'FLOAT', OPERATIONS: 3, MIN: 5, MAX: 30}],
            ]),
        );
        expect(detectDeviceEditors({...target, description}).some((spec) => spec.kind === 'week-profile')).toBe(false);
    });

    it('stands down where the end time has no MAX to close the day with', () => {
        const description: ParamsetDescription = Object.fromEntries(
            WEEKDAYS.flatMap((day) => [
                [`ENDTIME_${day}_1`, {TYPE: 'INTEGER', OPERATIONS: 3, MIN: 5}],
                [`TEMPERATURE_${day}_1`, {TYPE: 'FLOAT', OPERATIONS: 3, MIN: 5, MAX: 30}],
            ]),
        );
        expect(detectDeviceEditors({...target, description}).some((spec) => spec.kind === 'week-profile')).toBe(false);
    });

    it('recognises nothing in a description without any slot at all', () => {
        const description: ParamsetDescription = {LOGGING: {TYPE: 'ENUM', OPERATIONS: 3, VALUE_LIST: ['OFF', 'ON']}};
        expect(detectDeviceEditors({...target, description}).some((spec) => spec.kind === 'week-profile')).toBe(false);
    });
});

describe('the end-time rule the CCU enforces', () => {
    const spec = weekSpec(HM_CC_RT_DN_MASTER);
    const profile = spec.profiles[0];

    it('accepts a rising day that ends on 24:00', () => {
        expect(validateWeekProfile(spec, programme(spec))).toEqual([]);
    });

    it('reports an end time that does not come after the one before it', () => {
        const values = {...programme(spec), [slotParam(profile!.endTimePrefix, 'MONDAY', 2)]: 300};
        expect(validateWeekProfile(spec, values)).toContainEqual({
            profile: '',
            day: 'MONDAY',
            slot: 2,
            code: 'not-increasing',
        });
    });

    it('reports a slot behind the end of the day that is not the end of the day', () => {
        const values = {...programme(spec), [slotParam(profile!.endTimePrefix, 'TUESDAY', 5)]: 600};
        expect(validateWeekProfile(spec, values)).toContainEqual({
            profile: '',
            day: 'TUESDAY',
            slot: 5,
            code: 'after-day-end',
        });
    });

    it('reports a day that never reaches 24:00', () => {
        const values: Record<string, ParamsetValue> = {...programme(spec)};
        for (let slot = 3; slot <= spec.slots; slot += 1) {
            values[slotParam(profile!.endTimePrefix, 'FRIDAY', slot)] = 1380;
        }
        expect(validateWeekProfile(spec, values)).toContainEqual({
            profile: '',
            day: 'FRIDAY',
            slot: 13,
            code: 'day-not-closed',
        });
    });

    it('says nothing about a slot the device did not answer with', () => {
        const partial = {[slotParam(profile!.endTimePrefix, 'MONDAY', 1)]: 1440};
        // Every other day has nothing at all and is therefore only "not closed", never "wrong".
        expect(validateWeekProfile(spec, partial).every((problem) => problem.code === 'day-not-closed')).toBe(true);
    });
});

describe('copying', () => {
    const spec = weekSpec(HMIP_HEATING_MASTER);

    it('copies every slot of one day onto the days that were asked for, and never onto itself', () => {
        const values = programme(spec);
        const profile = spec.profiles[0];
        const changed = {...values, [slotParam(profile!.endTimePrefix, 'MONDAY', 1)]: 400};
        const update = copyWeekDay(spec, changed, profile!, 'MONDAY', ['TUESDAY', 'MONDAY']);
        expect(update[slotParam(profile!.endTimePrefix, 'TUESDAY', 1)]).toBe(400);
        expect(update[slotParam(profile!.valuePrefix, 'TUESDAY', 2)]).toBe(21);
        expect(Object.keys(update).some((name) => name.includes('MONDAY'))).toBe(false);
        // 13 slots x 2 parameters, one day.
        expect(Object.keys(update)).toHaveLength(26);
    });

    it('ignores a day the description does not have', () => {
        expect(copyWeekDay(spec, programme(spec), spec.profiles[0]!, 'MONDAY', ['CHRISTMAS'])).toEqual({});
    });

    it('copies a whole programme onto another one, all seven days', () => {
        const update = copyWeekProfile(spec, programme(spec), spec.profiles[0]!, [
            spec.profiles[1]!,
            spec.profiles[0]!,
        ]);
        expect(update['P2_ENDTIME_SUNDAY_1']).toBe(360);
        expect(update['P2_TEMPERATURE_SUNDAY_2']).toBe(21);
        expect(Object.keys(update).every((name) => name.startsWith('P2_'))).toBe(true);
        expect(Object.keys(update)).toHaveLength(182);
    });

    it('copies nothing where the device answered with nothing', () => {
        expect(copyWeekProfile(spec, {}, spec.profiles[0]!, [spec.profiles[1]!])).toEqual({});
    });
});

describe('times of day', () => {
    it('reads and writes the CCU minutes as a clock time, 24:00 included', () => {
        expect(formatMinutes(0)).toBe('00:00');
        expect(formatMinutes(360)).toBe('06:00');
        expect(formatMinutes(1440)).toBe('24:00');
        expect(formatMinutes(undefined)).toBe('');
        expect(formatMinutes(-1)).toBe('');
        expect(parseMinutes('06:00')).toBe(360);
        expect(parseMinutes(' 24:00 ')).toBe(1440);
        expect(parseMinutes('24:01')).toBeUndefined();
        expect(parseMinutes('6')).toBeUndefined();
        expect(parseMinutes('06:60')).toBeUndefined();
    });
});

describe('the week programme in the dialog', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
    });

    async function open(description: ParamsetDescription): Promise<WeekProfileSpec> {
        const spec = weekSpec(description);
        transport.result('paramset.description', description);
        transport.result('paramset.get', programme(spec));
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await fireEvent.click(screen.getByTestId('paramset-MEQ0123456-MASTER'));
        await waitFor(() => {
            expect(screen.getByTestId('editor-week-profile')).toBeTruthy();
        });
        return spec;
    }

    it('draws one row per slot and takes all 546 raw rows out of the generic list', async () => {
        await open(HMIP_HEATING_MASTER);
        expect(document.querySelectorAll('[data-testid^="week-slot-"][data-testid$="0"]').length).toBeGreaterThan(0);
        expect(screen.getByTestId('week-slot-13')).toBeTruthy();
        expect(screen.queryByTestId('param-P1_ENDTIME_MONDAY_1')).toBeNull();
        // What is not part of the programme is still an ordinary row.
        expect(screen.getByTestId('param-TEMPERATURE_COMFORT')).toBeTruthy();
    });

    it('shows the end times as clock times, and the slot before as the start', async () => {
        await open(HMIP_HEATING_MASTER);
        expect((screen.getByTestId('week-slot-1-endtime') as HTMLInputElement).value).toBe('06:00');
        expect((screen.getByTestId('week-slot-2-endtime') as HTMLInputElement).value).toBe('22:00');
        expect(screen.getByTestId('week-slot-2').textContent).toContain('06:00');
        expect((screen.getByTestId('week-slot-2-value') as HTMLInputElement).value).toBe('21');
    });

    it('writes the minute the CCU wants when a clock time is typed', async () => {
        await open(HMIP_HEATING_MASTER);
        await fireEvent.change(screen.getByTestId('week-slot-1-endtime'), {target: {value: '05:30'}});
        await fireEvent.click(screen.getByTestId('paramset-preview'));
        await fireEvent.click(screen.getByTestId('write-confirm'));

        await waitFor(() => {
            expect(transport.lastCall('paramset.put')?.[3]).toEqual({P1_ENDTIME_MONDAY_1: 330});
        });
    });

    it('ignores something that is not a time of day instead of writing it', async () => {
        await open(HMIP_HEATING_MASTER);
        await fireEvent.change(screen.getByTestId('week-slot-1-endtime'), {target: {value: 'later'}});
        await fireEvent.click(screen.getByTestId('paramset-preview'));
        await waitFor(() => {
            expect(screen.getByTestId('preview-empty')).toBeTruthy();
        });
    });

    it('switches the day and the profile without leaving the dialog', async () => {
        await open(HMIP_HEATING_MASTER);
        await fireEvent.input(screen.getByTestId('week-slot-1-value'), {target: {value: '19'}});
        await fireEvent.click(screen.getByTestId('week-day-SUNDAY'));
        await waitFor(() => {
            expect((screen.getByTestId('week-slot-1-value') as HTMLInputElement).value).toBe('17');
        });

        await fireEvent.click(screen.getByTestId('week-profile-P2'));
        await fireEvent.click(screen.getByTestId('paramset-preview'));
        await waitFor(() => {
            expect(screen.getByTestId('preview-P1_TEMPERATURE_MONDAY_1')).toBeTruthy();
        });
    });

    it('copies a day onto every other day in one click', async () => {
        await open(HMIP_HEATING_MASTER);
        await fireEvent.change(screen.getByTestId('week-slot-1-endtime'), {target: {value: '05:30'}});
        await fireEvent.click(screen.getByTestId('week-copy-day'));
        await fireEvent.click(screen.getByTestId('paramset-preview'));
        await fireEvent.click(screen.getByTestId('write-confirm'));

        await waitFor(() => {
            const written = transport.lastCall('paramset.put')?.[3] as Record<string, unknown>;
            expect(Object.keys(written).sort()).toEqual([
                'P1_ENDTIME_FRIDAY_1',
                'P1_ENDTIME_MONDAY_1',
                'P1_ENDTIME_SATURDAY_1',
                'P1_ENDTIME_SUNDAY_1',
                'P1_ENDTIME_THURSDAY_1',
                'P1_ENDTIME_TUESDAY_1',
                'P1_ENDTIME_WEDNESDAY_1',
            ]);
        });
    });

    it('copies a whole profile onto another one', async () => {
        await open(HMIP_HEATING_MASTER);
        await fireEvent.input(screen.getByTestId('week-slot-2-value'), {target: {value: '23'}});
        await fireEvent.change(screen.getByTestId('week-copy-profile-target'), {target: {value: 'P3'}});
        await fireEvent.click(screen.getByTestId('week-copy-profile'));
        await fireEvent.click(screen.getByTestId('paramset-preview'));
        await fireEvent.click(screen.getByTestId('write-confirm'));

        await waitFor(() => {
            const written = transport.lastCall('paramset.put')?.[3] as Record<string, unknown>;
            expect(written['P1_TEMPERATURE_MONDAY_2']).toEqual({explicitDouble: 23});
            expect(written['P3_TEMPERATURE_MONDAY_2']).toEqual({explicitDouble: 23});
            expect(written['P2_TEMPERATURE_MONDAY_2']).toBeUndefined();
        });
    });

    it('says which end time breaks the rule, and stops saying it once it is fixed', async () => {
        await open(HMIP_HEATING_MASTER);
        await fireEvent.change(screen.getByTestId('week-slot-2-endtime'), {target: {value: '05:00'}});
        await waitFor(() => {
            expect(screen.getByTestId('week-problems').textContent).toContain('2');
        });

        await fireEvent.change(screen.getByTestId('week-slot-2-endtime'), {target: {value: '22:00'}});
        await waitFor(() => {
            expect(screen.queryByTestId('week-problems')).toBeNull();
        });
    });

    it('draws 24 slots for a HM-CC-TC and calls the value column by its own name', async () => {
        await open(HM_CC_TC_REGULATOR_MASTER);
        expect(screen.getByTestId('week-slot-24')).toBeTruthy();
        // One profile only: no profile bar.
        expect(screen.queryByTestId('week-profile-P1')).toBeNull();
        expect(within(screen.getByTestId('editor-week-profile')).getAllByRole('columnheader').length).toBe(4);
    });

    it('puts all 546 raw rows back when the box is ticked', async () => {
        await open(HMIP_HEATING_MASTER);
        await fireEvent.click(screen.getByTestId('paramset-show-covered'));
        await waitFor(() => {
            expect(screen.getByTestId('param-P1_ENDTIME_MONDAY_1')).toBeTruthy();
        });
    });
});
