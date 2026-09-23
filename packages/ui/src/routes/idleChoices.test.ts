import {describe, expect, it} from 'vitest';

import {IDLE_DEFAULT, idleChoices, idleDuration, idleSelectValue} from './idleChoices.js';

describe('idle time choices (B-70)', () => {
    it('offers the longer times and "never" after the default, without the default twice', () => {
        expect(idleChoices(300_000, undefined)).toEqual([900_000, 1_800_000, 3_600_000, 14_400_000, 0]);
        expect(idleChoices(900_000, undefined)).toEqual([1_800_000, 3_600_000, 14_400_000, 0]);
    });

    it("sorts the profile's own time in and keeps never last", () => {
        expect(idleChoices(300_000, 120_000)).toEqual([120_000, 900_000, 1_800_000, 3_600_000, 14_400_000, 0]);
        expect(idleChoices(300_000, 0)).toEqual([900_000, 1_800_000, 3_600_000, 14_400_000, 0]);
        expect(idleChoices(0, undefined)).toEqual([900_000, 1_800_000, 3_600_000, 14_400_000]);
    });

    it('selects the default entry for an unset profile and for the default time itself', () => {
        expect(idleSelectValue(undefined, 300_000)).toBe(IDLE_DEFAULT);
        expect(idleSelectValue(300_000, 300_000)).toBe(IDLE_DEFAULT);
        expect(idleSelectValue(0, 300_000)).toBe('0');
    });

    it('words a time in hours, minutes or seconds', () => {
        expect(idleDuration(14_400_000)).toEqual({unit: 'hours', count: 4});
        expect(idleDuration(5_400_000)).toEqual({unit: 'minutes', count: 90});
        expect(idleDuration(300_000)).toEqual({unit: 'minutes', count: 5});
        expect(idleDuration(90_000)).toEqual({unit: 'seconds', count: 90});
    });
});
