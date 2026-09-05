/**
 * Units and the display conversion around them.
 *
 * Two quirks of the CCU's `UNIT` field, both handled in 2.x by mutating the description in place
 * (`homematic-manager.js:1729-1745` and `:3446-3462`) and therefore poisoning the description
 * cache:
 *
 *   `100%`  the value is a fraction 0..1 that is shown as a percentage: 0.5 displays as 50 %.
 *           The write path has to divide by 100 again, and 2.x got that wrong for INTEGER
 *           parameters, which it then truncated with parseInt.
 *   `°C`    arrives mis-decoded. The interface processes send Latin-1; a byte 0xB0 read as UTF-8
 *           is not valid, so the decoder replaces it with U+FFFD and the unit reads "�C".
 *           The right fix is in the transport (task 4 decodes Latin-1), this is the safety net.
 */

import {numericBound, type ParameterDescription} from './description.js';

/** The unit that means "the value is a fraction, show it as a percentage". */
export const PERCENT_UNIT = '100%';

/** What `UNIT` looks like when `°C` was decoded as UTF-8: the replacement character plus `C`. */
export const MOJIBAKE_CELSIUS = '�C';

/** What `UNIT` looks like when `°C` was decoded twice: `Â°C`. */
export const DOUBLE_ENCODED_CELSIUS = 'Â°C';

export const CELSIUS = '°C';

/**
 * The unit as it should be shown. Repairs the mis-decoded degree sign, turns the CCU's literal
 * `""` (an empty unit that some firmware quotes) into an empty string, and reports `100%` as `%`.
 */
export function unitLabel(description: ParameterDescription | undefined): string {
    const unit = description?.UNIT;
    if (unit === undefined || unit === '' || unit === '""') {
        return '';
    }
    if (unit === PERCENT_UNIT) {
        return '%';
    }
    if (unit === MOJIBAKE_CELSIUS || unit === DOUBLE_ENCODED_CELSIUS) {
        return CELSIUS;
    }
    return unit;
}

/** Does this parameter carry the `100%` unit, i.e. is its value a fraction? */
export function isPercentUnit(description: ParameterDescription | undefined): boolean {
    return description?.UNIT === PERCENT_UNIT;
}

/** The factor between the stored value and the displayed one: 100 for `100%`, 1 otherwise. */
export function displayFactor(description: ParameterDescription | undefined): number {
    return isPercentUnit(description) ? 100 : 1;
}

/**
 * Stored value -> displayed value. Only numbers are scaled; everything else passes through, and a
 * missing value falls back to `DEFAULT` the way the paramset dialog does.
 */
export function toDisplayValue(
    value: number | undefined,
    description: ParameterDescription | undefined,
): number | undefined {
    if (value === undefined) {
        return undefined;
    }
    return roundScaled(value * displayFactor(description));
}

/** Displayed value -> stored value, the inverse of {@link toDisplayValue}. */
export function fromDisplayValue(
    value: number | undefined,
    description: ParameterDescription | undefined,
): number | undefined {
    if (value === undefined) {
        return undefined;
    }
    return roundScaled(value / displayFactor(description));
}

/** `MIN`/`MAX` in display units, so a spin box can use them directly. */
export function displayBounds(description: ParameterDescription): {min?: number; max?: number} {
    const min = toDisplayValue(numericBound(description, 'MIN'), description);
    const max = toDisplayValue(numericBound(description, 'MAX'), description);
    const bounds: {min?: number; max?: number} = {};
    if (min !== undefined) {
        bounds.min = min;
    }
    if (max !== undefined) {
        bounds.max = max;
    }
    return bounds;
}

/**
 * Multiplying by 100 turns 0.07 into 7.000000000000001. Rounding to 10 significant digits removes
 * the artefact without touching any value a device can actually hold.
 */
function roundScaled(value: number): number {
    if (!Number.isFinite(value)) {
        return value;
    }
    return Number.parseFloat(value.toPrecision(10));
}
