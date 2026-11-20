/**
 * Cross-parameter rules of the Homematic Manager's own, appended to openccu-data's
 * `easymode_extract.cross_validations.rules` by the converter. Same shape as upstream's, so one
 * mapping serves both. Each is a check the CCU's WebUI makes in an easymode that openccu-data does
 * not extract as a rule.
 *
 * @type {ReadonlyArray<{id: string, rule: 'gte' | 'lte' | 'between', error_key: string, param_a?: string, param_b?: string, param?: string, min_param?: string, max_param?: string}>}
 */
export const HMM_CROSS_VALIDATIONS = [
    // task 110: the switching thresholds of conditional transmitting - a power meter's (shown in W),
    // a weather sensor's, a temperature sensor's. The upper one below the lower one leaves the
    // channel without a hysteresis to switch on.
    {
        id: 'cond_tx_threshold_hi_gte_lo',
        rule: 'gte',
        error_key: 'cross_validation.hi_must_be_gte_lo',
        param_a: 'COND_TX_THRESHOLD_HI',
        param_b: 'COND_TX_THRESHOLD_LO',
    },
    // task 117: the eco (lowering) temperature at most the comfort one - isEcoLTComfort() in the
    // WebUI's easymodes/js/CC.js for HM-CC-RT-DN, HM-TC-IT-WM-W-EU and HM-CC-VG-1, compared as
    // decimals since OpenCCU-Base 1f82c7b (21.0 against 21.5 passed with parseInt). The HmIP heating
    // channels (HEATING_CLIMATECONTROL_TRANSCEIVER) carry the same pair. The message is the WebUI's.
    {
        id: 'temperature_comfort_gte_lowering',
        rule: 'gte',
        error_key: 'errorComfortLTEco',
        param_a: 'TEMPERATURE_COMFORT',
        param_b: 'TEMPERATURE_LOWERING',
    },
];
