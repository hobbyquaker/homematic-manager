import type {ParamsetDescription} from '@homematic-manager/core';

/**
 * Task 122: an HmIP-M-TD15 (Homematic IP tubular drive, 15 Nm), **derived, not captured** - no description of this
 * device exists in hm-simulator's data, the lab has none, and none was seen anywhere else. Replace it with a real one
 * (`getParamsetDescription` of `:0` and of the shutter channel) as soon as one turns up.
 *
 * What it is derived from (OpenCCU-Base):
 * - the device types: `HmIP-M-TD15` and its OEM twin `RM-110-45/15` (TEXINO, "Tubular Drive HmIP Octagonal Shaft
 *   60mm/15Nm") are the two types the WebUI names wherever it treats this motor specially -
 *   `src/webui/www_source/ise/js/iseBlindShutter.js` (`checkEndPos`), `hmipChannelConfigDialogs.tcl`
 *   (`getShutterTransmitter`, `isMTD15`), `config/easymodes/js/HmIPWeeklyProgram.js`; the device names in
 *   `webui/js/lang/*\/translate.lang.deviceDescription.js`;
 * - the channel type and the datapoints: `esp/controls/blind.fn` (`CreateShutterTransmitter`, "new with
 *   HmIP-M-TD15": `SHUTTER_TRANSMITTER.MANUAL_SELF_CALIBRATION`, `…_LEVEL`, `…_DURATION_UNIT`, `…_DURATION_VALUE`),
 *   `opt/HmIP/legacy-parameter-definition.config` (the same four on `SHUTTER_TRANSMITTER`, and
 *   `MAINTENANCE.MANUAL_SELF_CALIBRATION_TOP_POS_SET`/`…_BOTTOM_POS_SET`), `config/stringtable_de.txt` (the flags are
 *   BOOLs: `=FALSE`/`=TRUE`);
 * - the enum: `shutterSelfCalibration.js`'s `ManualSelfCalibration` (0-7, written as numbers there) and its
 *   duration unit comment ("0 = sec, 1 = min, 2 = hour");
 * - the rest of the shutter channel and of `:0`: hm-simulator's HmIP-BROLL 1.6.2 (`SHUTTER_TRANSMITTER` on `:3`).
 *
 * Guessed: the channel number (3, as on the HmIP-BROLL), the firmware, the ENUM value names of the step datapoint
 * (the WebUI's constant names), the duration's maximum, and the OPERATIONS of the four step datapoints (2, write
 * only, like `SELF_CALIBRATION`). The dialog sends numbers, as the WebUI does, so the names do not reach the device.
 */
export const HMIP_M_TD15 = {
    type: 'HmIP-M-TD15',
    firmware: '1.0.0',
    version: 1,
    /** The shutter channel, as on the HmIP-BROLL. */
    channel: 3,
} as const;

export const HMIP_M_TD15_SHUTTER_VALUES: ParamsetDescription = {
    LEVEL: {TYPE: 'FLOAT', OPERATIONS: 5, FLAGS: 1, MIN: 0, MAX: 1.005, DEFAULT: 0, UNIT: '100%'},
    LEVEL_STATUS: {
        TYPE: 'ENUM',
        OPERATIONS: 5,
        FLAGS: 1,
        MIN: 'NORMAL',
        MAX: 'ERROR',
        DEFAULT: 'NORMAL',
        VALUE_LIST: ['NORMAL', 'UNKNOWN', 'OVERFLOW', 'UNDERFLOW', 'ERROR'],
    },
    ACTIVITY_STATE: {
        TYPE: 'ENUM',
        OPERATIONS: 5,
        FLAGS: 1,
        MIN: 'UNKNOWN',
        MAX: 'STABLE',
        DEFAULT: 'UNKNOWN',
        VALUE_LIST: ['UNKNOWN', 'UP', 'DOWN', 'STABLE'],
    },
    PROCESS: {
        TYPE: 'ENUM',
        OPERATIONS: 5,
        FLAGS: 1,
        MIN: 'STABLE',
        MAX: 'NOT_STABLE',
        DEFAULT: 'STABLE',
        VALUE_LIST: ['STABLE', 'NOT_STABLE'],
    },
    MANUAL_SELF_CALIBRATION: {
        TYPE: 'ENUM',
        OPERATIONS: 2,
        FLAGS: 1,
        MIN: 'CLEAR_SAVED_POSITIONS',
        MAX: 'STOP_MOTION',
        DEFAULT: 'STOP_MOTION',
        VALUE_LIST: [
            'CLEAR_SAVED_POSITIONS',
            'SAVE_TOP_POSITION',
            'SAVE_BOTTOM_POSITION',
            'REVERSE_MOTION',
            'START_MOTION_WITH_LEVEL_SHORT',
            'START_MOTION_WITH_LEVEL_LONG',
            'START_MOTION_WITH_LEVEL_AND_DURATION',
            'STOP_MOTION',
        ],
    },
    MANUAL_SELF_CALIBRATION_LEVEL: {TYPE: 'FLOAT', OPERATIONS: 2, FLAGS: 1, MIN: 0, MAX: 1, DEFAULT: 0, UNIT: '100%'},
    MANUAL_SELF_CALIBRATION_DURATION_UNIT: {
        TYPE: 'ENUM',
        OPERATIONS: 2,
        FLAGS: 1,
        MIN: 'S',
        MAX: 'H',
        DEFAULT: 'S',
        VALUE_LIST: ['S', 'M', 'H'],
    },
    MANUAL_SELF_CALIBRATION_DURATION_VALUE: {TYPE: 'INTEGER', OPERATIONS: 2, FLAGS: 1, MIN: 0, MAX: 8191, DEFAULT: 0},
};

export const HMIP_M_TD15_MAINTENANCE_VALUES: ParamsetDescription = {
    CONFIG_PENDING: {TYPE: 'BOOL', OPERATIONS: 5, FLAGS: 9, MIN: false, MAX: true, DEFAULT: false},
    UNREACH: {TYPE: 'BOOL', OPERATIONS: 5, FLAGS: 25, MIN: false, MAX: true, DEFAULT: false},
    RSSI_DEVICE: {TYPE: 'INTEGER', OPERATIONS: 5, FLAGS: 1, MIN: -128, MAX: 127, DEFAULT: 0},
    RSSI_PEER: {TYPE: 'INTEGER', OPERATIONS: 5, FLAGS: 1, MIN: -128, MAX: 127, DEFAULT: 0},
    DUTY_CYCLE: {TYPE: 'BOOL', OPERATIONS: 5, FLAGS: 1, MIN: false, MAX: true, DEFAULT: false},
    MANUAL_SELF_CALIBRATION_TOP_POS_SET: {TYPE: 'BOOL', OPERATIONS: 5, FLAGS: 1, MIN: false, MAX: true, DEFAULT: false},
    MANUAL_SELF_CALIBRATION_BOTTOM_POS_SET: {
        TYPE: 'BOOL',
        OPERATIONS: 5,
        FLAGS: 1,
        MIN: false,
        MAX: true,
        DEFAULT: false,
    },
};
