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
];
