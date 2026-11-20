/**
 * The switching thresholds of the HmIP power meters, in watts (task 110).
 *
 * `COND_TX_THRESHOLD_LO` and `_HI` of a measuring actuator's `COND_SWITCH_TRANSMITTER` channel are
 * INTEGERs `0..16777215` in hundredths of a watt, without a unit: a threshold of 100 W is stored as
 * 10000. The CCU's WebUI shows them divided by 100 as watts with two decimals, capped at what the
 * device can switch, and writes `Math.round(W * 100)` back (`getCondSwitchTransmitter` in
 * `hmipChannelConfigDialogs.tcl`, `devIsPowerMeter` in `hmip_helper.tcl`, `getUserDefinedMaxValue`
 * in `uiElements.tcl`; OpenCCU-Base 949e204, 3412ada, 2466de4). Without that a user reads "10000"
 * and the range `0 … 16777215` and has to know the unit.
 */

/** The parameters the WebUI shows in watts on a power meter. */
export const POWER_THRESHOLD_PARAMETERS: ReadonlySet<string> = new Set([
    'COND_TX_THRESHOLD_LO',
    'COND_TX_THRESHOLD_HI',
]);

/**
 * The most a power meter can switch, in watts, by device type in lower case - `devIsPowerMeter`'s
 * list with `getUserDefinedMaxValue`'s caps. A type that is not here is not a power meter, and its
 * thresholds stay as the interface describes them.
 */
export const POWER_METER_MAX_WATTS: Readonly<Record<string, number>> = {
    'hmip-psm': 3680,
    'hmip-psmco': 3680,
    'elv-sh-psmci': 3680,
    'hmip-fsm16': 3680,
    'hmip-psm-2': 3000,
    'hmip-psm-2 qhj': 3000,
    'hmip-bsm': 1150,
    'hmip-fsm': 1150,
    'hmip-usbsm': 60,
};

/** Stored value × factor = watts. */
export const POWER_THRESHOLD_FACTOR = 0.01;

/** How a power threshold is shown and entered. */
export interface PowerThresholdScale {
    /** Stored value × factor = displayed value. */
    readonly factor: number;
    readonly unit: 'W';
    /** In watts. */
    readonly min: number;
    /** In watts: what the device can switch. */
    readonly max: number;
    /** The WebUI's two decimals. */
    readonly step: number;
}

/**
 * The watt scale of a parameter, or `undefined` when it is not a power meter's threshold. The device
 * type is matched without regard to case: hmipserver reports `HMIP-PSM` for older units and
 * `HmIP-PSM` for newer ones, and the WebUI lower-cases it too.
 */
export function powerThresholdScale(deviceType: string | undefined, param: string): PowerThresholdScale | undefined {
    if (deviceType === undefined || !POWER_THRESHOLD_PARAMETERS.has(param)) {
        return undefined;
    }
    const max = POWER_METER_MAX_WATTS[deviceType.toLowerCase()];
    return max === undefined ? undefined : {factor: POWER_THRESHOLD_FACTOR, unit: 'W', min: 0, max, step: 0.01};
}
