/**
 * Turning openccu-data constraints into `ProfileConstraint` (see packages/core/src/data/types.ts).
 *
 * `profiles/<RECEIVER_TYPE>.json.gz` already carries evaluated numbers. `easymode_extract.json.gz`
 * does not: it is a literal dump of the WebUI's Tcl sources, so a value can still be
 *
 *   "4"                                   a plain number
 *   "149 ;# match with profile 4"         a number with a Tcl comment
 *   "false"                               a boolean written as a word
 *   "{3 4} ;# siehe SHORT_JT_ON"          a Tcl list
 *   "[subst {$ON_DELAY $OFF_DELAY}]"      a list of jump-target symbols
 *
 * The jump-target table below was not guessed: it was derived from the 1082 profiles that exist in
 * both artifacts by aligning every `[subst {...}]` token with the number the profiles extractor
 * produced for it. All 13 symbols resolve to exactly one number each (`scripts/constraints.test.mjs`
 * re-checks that against the pinned artifacts).
 */

/** Tcl variables of the WebUI's easy-mode files: the ACTION/JUMP target enumeration. */
export const JUMP_TARGETS = Object.freeze({
    NOP: 0,
    ONDELAY: 1,
    ON_DELAY: 1,
    RAMPON: 2,
    RAMP_ON: 2,
    ON: 3,
    OFFDELAY: 4,
    OFF_DELAY: 4,
    RAMPOFF: 5,
    RAMP_OFF: 5,
    OFF: 6,
    REFON: 7,
    REFOFF: 8,
});

/**
 * Expand one raw openccu-data value into zero or more runtime values.
 *
 * @param {unknown} raw
 * @returns {Array<number | string | boolean>}
 */
export function resolveValues(raw) {
    if (typeof raw === 'number' || typeof raw === 'boolean') return [raw];
    if (typeof raw !== 'string') return [];

    let text = raw.replace(/;#.*$/su, '').trim();
    const subst = /^\[subst\s*\{(.*)\}\]$/su.exec(text);
    if (subst) text = subst[1];
    const braced = /^\{(.*)\}$/su.exec(text);
    if (braced) text = braced[1];

    /** @type {Array<number | string | boolean>} */
    const values = [];
    for (const token of text.split(/\s+/u).filter(Boolean)) {
        if (token.startsWith('$')) {
            const symbol = token.slice(1);
            if (symbol in JUMP_TARGETS) {
                values.push(JUMP_TARGETS[symbol]);
                continue;
            }
            // Anything else is an unevaluated Tcl expression; keeping it would put garbage into the
            // runtime data, so it is dropped and reported by the converter.
            continue;
        }
        if (token === 'true') values.push(1);
        else if (token === 'false') values.push(0);
        else if (token !== '' && Number.isFinite(Number(token))) values.push(Number(token));
        else values.push(token);
    }
    return values;
}

/**
 * @param {{constraint_type: string, value?: unknown, values?: unknown[], min_value?: number, max_value?: number, default?: number}} raw
 * @returns {{kind: 'fixed', value: number|string|boolean} | {kind: 'list', values: Array<number|string|boolean>} | {kind: 'range', min: number, max: number, default?: number} | undefined}
 */
export function toConstraint(raw) {
    if (raw.constraint_type === 'range') {
        const min = Number(raw.min_value);
        const max = Number(raw.max_value);
        if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined;
        const fallback = Number(raw.default);
        return Number.isFinite(fallback) ? {kind: 'range', min, max, default: fallback} : {kind: 'range', min, max};
    }

    const raws = raw.constraint_type === 'fixed' ? [raw.value] : (raw.values ?? []);
    /** @type {Array<number|string|boolean>} */
    const values = [];
    for (const one of raws) {
        for (const value of resolveValues(one)) {
            if (!values.includes(value)) values.push(value);
        }
    }
    // Link-paramset values are numeric throughout (the profiles extractor never emits anything
    // else). A leftover string means the Tcl did not evaluate - dropping it is better than putting
    // a value into the runtime data that would be written to a device.
    if (values.some((value) => typeof value === 'string')) return undefined;
    if (values.length === 0) return undefined;
    // A one-element list is a fixed value; this is also what the profiles extractor emits, so both
    // sources agree after the conversion.
    if (values.length === 1) return {kind: 'fixed', value: values[0]};
    return {kind: 'list', values};
}
