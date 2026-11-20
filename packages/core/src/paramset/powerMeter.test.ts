import {describe, expect, it} from 'vitest';

import {POWER_METER_MAX_WATTS, powerThresholdScale} from './powerMeter.js';
import {fromScaledDisplay, toScaledDisplay} from './units.js';

describe('powerThresholdScale (task 110)', () => {
    it("scales a power meter's thresholds to W with its maximum", () => {
        expect(powerThresholdScale('HmIP-PSM', 'COND_TX_THRESHOLD_LO')).toEqual({
            factor: 0.01,
            unit: 'W',
            min: 0,
            max: 3680,
            step: 0.01,
        });
        expect(powerThresholdScale('HmIP-PSM-2', 'COND_TX_THRESHOLD_HI')?.max).toBe(3000);
        expect(powerThresholdScale('HmIP-BSM', 'COND_TX_THRESHOLD_HI')?.max).toBe(1150);
        expect(powerThresholdScale('HmIP-USBSM', 'COND_TX_THRESHOLD_HI')?.max).toBe(60);
    });

    it('matches the device type without regard to case, as hmipserver spells it both ways', () => {
        expect(powerThresholdScale('HMIP-PSM', 'COND_TX_THRESHOLD_HI')?.max).toBe(3680);
        expect(powerThresholdScale('HmIP-PSM-2 QHJ', 'COND_TX_THRESHOLD_HI')?.max).toBe(3000);
    });

    it("leaves other parameters and other devices' thresholds alone", () => {
        expect(powerThresholdScale('HmIP-PSM', 'TX_THRESHOLD_POWER')).toBeUndefined();
        expect(powerThresholdScale('HmIP-SWO-PR', 'COND_TX_THRESHOLD_HI')).toBeUndefined();
        expect(powerThresholdScale(undefined, 'COND_TX_THRESHOLD_HI')).toBeUndefined();
    });

    it("carries devIsPowerMeter's list with getUserDefinedMaxValue's caps", () => {
        expect(Object.keys(POWER_METER_MAX_WATTS).sort()).toEqual([
            'elv-sh-psmci',
            'hmip-bsm',
            'hmip-fsm',
            'hmip-fsm16',
            'hmip-psm',
            'hmip-psm-2',
            'hmip-psm-2 qhj',
            'hmip-psmco',
            'hmip-usbsm',
        ]);
    });
});

describe('toScaledDisplay / fromScaledDisplay', () => {
    it('shows hundredths as watts without float residue', () => {
        expect(toScaledDisplay(12_345, 0.01)).toBe(123.45);
        expect(toScaledDisplay(7, 0.01)).toBe(0.07);
        expect(toScaledDisplay(undefined, 0.01)).toBeUndefined();
    });

    it('writes watts back as hundredths, rounded for an INTEGER', () => {
        expect(fromScaledDisplay(12.34, 0.01, true)).toBe(1234);
        expect(fromScaledDisplay(0.075, 0.01, true)).toBe(8);
        expect(fromScaledDisplay(0.075, 0.01, false)).toBe(7.5);
        expect(fromScaledDisplay(undefined, 0.01, true)).toBeUndefined();
        expect(fromScaledDisplay(Number.NaN, 0.01, true)).toBeNaN();
    });
});
