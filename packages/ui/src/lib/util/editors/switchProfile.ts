import type {DurationPair, ParameterDescription, ParamsetValue} from '@homematic-manager/core';
import {findDurationPairs, isWritable} from '@homematic-manager/core';

import type {DeviceEditorBase, EditorTarget, EditorValues} from './types.js';

/**
 * The HmIP switching programme: 75 slots of `NN_WP_*` in one MASTER paramset.
 *
 * Every HmIP actuator has a `*_WEEK_PROFILE` channel whose MASTER is nothing but the programme -
 * 750 parameters on a `SWITCH_WEEK_PROFILE`, 900 on a `DIMMER_WEEK_PROFILE`. One slot is
 *
 *   `01_WP_WEEKDAY`         INTEGER 0..127, a bit mask of the days the slot applies to
 *   `01_WP_FIXED_HOUR`      INTEGER 0..23      `01_WP_FIXED_MINUTE`  INTEGER 0..59
 *   `01_WP_CONDITION`       ENUM FIXED | ASTRO | FIXED_IF_BEFORE_ASTRO | ... (eight)
 *   `01_WP_ASTRO_TYPE`      ENUM SUNRISE | SUNSET    `01_WP_ASTRO_OFFSET` INTEGER -128..127
 *   `01_WP_LEVEL`           FLOAT 0..1.01      (`_LEVEL_2` on a blind: the slats)
 *   `01_WP_DURATION_BASE`   ENUM BASE_100_MS..BASE_1_H, `_FACTOR` INTEGER 0..31
 *   `01_WP_RAMP_TIME_BASE`  the same again on a dimmer
 *   `01_WP_TARGET_CHANNELS` INTEGER 0..16777215, another bit mask
 *
 * so the generic editor draws 750 rows and the two duration pairs of every slot are two numbers to
 * multiply. This editor draws one line per slot with the columns the description really has, and
 * the durations through the same `DurationPair` the duration picker uses.
 *
 * ## The weekday bit mask - measured, A-17
 *
 * Nothing in the description or in `data/dist` says which bit is which day. Bit 0 was *taken* to be
 * **Sunday** by task 10, because every weekday enum HmIP does document starts there -
 * `DECALCIFICATION_WEEKDAY` on an HmIP-eTRV-2 is `SUNDAY|MONDAY|..|SATURDAY` and so are
 * `DST_START_DAY_OF_WEEK` and `DST_END_DAY_OF_WEEK`, while the *BidCos* `DECALCIFICATION_WEEKDAY`
 * starts at Saturday.
 *
 * **Confirmed in the lab on 2026-09-05 (OQ-16, task 17).** The mask is produced by the CCU's own
 * dialog, `/www/config/easymodes/js/HmIPWeeklyProgram.js`, identical on CCU3 firmware 3.89.8 and
 * OpenCCU 3.89.8: its `_getWeekDay()` gives each day's checkbox the bit value as its `value`
 * (Sun 1, Mon 2, Tue 4, Wed 8, Thu 16, Fri 32, Sat 64) and `setWPWeekday()` sums them into the
 * hidden `NN_WP_WEEKDAY` field, so bit 0 is Sunday and all seven days are 127. Running that
 * function over its own markup in a browser reproduces the table one day at a time; the details
 * are in `packages/core/ASSUMPTIONS.md` A-17.
 *
 * The raw mask stays printed next to the checkboxes anyway. It costs nothing, and it is what would
 * have made a wrong answer visible.
 */

/** `01_WP_WEEKDAY`. */
export function switchParam(slot: string, field: string): string {
    return `${slot}_WP_${field}`;
}

const SLOT_PATTERN = /^(\d+)_WP_(.+)$/;

/** The order the WebUI puts the columns in; anything else follows alphabetically. */
const COLUMN_ORDER: readonly string[] = [
    'WEEKDAY',
    'TIME',
    'CONDITION',
    'ASTRO_TYPE',
    'ASTRO_OFFSET',
    'LEVEL',
    'LEVEL_2',
    'DURATION',
    'RAMP_TIME',
    'OUTPUT_BEHAVIOUR',
    'TARGET_CHANNELS',
];

/** How a column is drawn. */
export type SwitchColumnKind = 'weekday' | 'time' | 'duration' | 'enum' | 'number';

export interface SwitchColumn {
    /** `WEEKDAY`, `TIME`, `DURATION`, ... - also the `data-testid` suffix. */
    readonly id: string;
    readonly kind: SwitchColumnKind;
    /** The field or fields of a slot this column covers. */
    readonly fields: readonly string[];
    /** The first slot's description of the leading field: labels, bounds and the enum list. */
    readonly description: ParameterDescription;
}

export interface SwitchProfileSpec extends DeviceEditorBase {
    readonly kind: 'switch-week-profile';
    /** The slot numbers as the CCU writes them: `01`, `02`, ... */
    readonly slots: readonly string[];
    readonly columns: readonly SwitchColumn[];
    /** The duration pair of one slot and column, keyed `<slot>:<column>`. */
    readonly durations: Readonly<Record<string, DurationPair>>;
    readonly writable: boolean;
}

/**
 * The seven bits of `NN_WP_WEEKDAY`, Sunday first - see the note at the top: measured against the
 * CCU's own weekly-programme dialog on both firmwares (A-17), not something the description says.
 */
export const WEEKDAY_BIT_LABELS: readonly string[] = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
];

/** Is the day of this bit switched on in the mask? */
export function hasWeekdayBit(mask: ParamsetValue | undefined, bit: number): boolean {
    return typeof mask === 'number' && (mask & (1 << bit)) !== 0;
}

/** The mask with one bit flipped. */
export function toggleWeekdayBit(mask: ParamsetValue | undefined, bit: number, on: boolean): number {
    const current = typeof mask === 'number' ? mask : 0;
    return on ? current | (1 << bit) : current & ~(1 << bit);
}

/** `06:30` out of `NN_WP_FIXED_HOUR` and `NN_WP_FIXED_MINUTE`. */
export function switchTime(values: EditorValues, slot: string): string {
    const hour = values[switchParam(slot, 'FIXED_HOUR')];
    const minute = values[switchParam(slot, 'FIXED_MINUTE')];
    if (typeof hour !== 'number' || typeof minute !== 'number') {
        return '';
    }
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** `06:30` back into the two parameters, or `undefined` for anything that is not a time. */
export function parseSwitchTime(slot: string, text: string): Record<string, number> | undefined {
    const match = /^(\d{1,2}):([0-5]\d)$/.exec(text.trim());
    const hour = match ? Number(match[1]) : Number.NaN;
    if (!match || hour > 23) {
        return undefined;
    }
    return {[switchParam(slot, 'FIXED_HOUR')]: hour, [switchParam(slot, 'FIXED_MINUTE')]: Number(match[2])};
}

/** A slot with no weekday does nothing at all; the editor says so rather than drawing it as set. */
export function isSlotUnused(values: EditorValues, slot: string): boolean {
    const mask = values[switchParam(slot, 'WEEKDAY')];
    return typeof mask !== 'number' || mask === 0;
}

export function detectSwitchProfile(target: EditorTarget, taken: ReadonlySet<string>): SwitchProfileSpec | undefined {
    const {description} = target;
    const fieldsPerSlot = new Map<string, Set<string>>();
    const covers: string[] = [];

    for (const name of Object.keys(description)) {
        const match = SLOT_PATTERN.exec(name);
        const slot = match?.[1];
        const field = match?.[2];
        if (!match || slot === undefined || field === undefined) {
            continue;
        }
        let known = fieldsPerSlot.get(slot);
        if (!known) {
            known = new Set<string>();
            fieldsPerSlot.set(slot, known);
        }
        known.add(field);
        covers.push(name);
    }

    const slots = [...fieldsPerSlot.keys()].sort((a, b) => Number(a) - Number(b));
    const first = slots[0];
    const firstFields = first === undefined ? undefined : fieldsPerSlot.get(first);
    if (first === undefined || !firstFields || !firstFields.has('WEEKDAY') || covers.some((name) => taken.has(name))) {
        return undefined;
    }
    // Every slot has to look like every other one; a description where they do not is one this
    // editor does not understand, and then nothing is taken out of the generic list.
    const shape = [...firstFields].sort().join(',');
    for (const slot of slots) {
        if ([...(fieldsPerSlot.get(slot) ?? [])].sort().join(',') !== shape) {
            return undefined;
        }
    }

    const pairs = new Map(findDurationPairs(description).map((pair) => [pair.name, pair]));
    const durations: Record<string, DurationPair> = {};
    const columns: SwitchColumn[] = [];
    const claimed = new Set<string>();

    const add = (id: string, kind: SwitchColumnKind, fields: readonly string[]): void => {
        const lead = description[switchParam(first, fields[0] ?? '')];
        if (!lead || fields.some((field) => !firstFields.has(field))) {
            return;
        }
        columns.push({id, kind, fields, description: lead});
        for (const field of fields) {
            claimed.add(field);
        }
    };

    add('WEEKDAY', 'weekday', ['WEEKDAY']);
    add('TIME', 'time', ['FIXED_HOUR', 'FIXED_MINUTE']);

    for (const field of [...firstFields].sort()) {
        if (claimed.has(field) || !field.endsWith('_BASE')) {
            continue;
        }
        const id = field.slice(0, -'_BASE'.length);
        if (!firstFields.has(`${id}_FACTOR`)) {
            continue;
        }
        let complete = true;
        for (const slot of slots) {
            const pair = pairs.get(`${slot}_WP_${id}`);
            if (!pair) {
                complete = false;
                break;
            }
            durations[`${slot}:${id}`] = pair;
        }
        if (complete) {
            add(id, 'duration', [field, `${id}_FACTOR`]);
        }
    }

    for (const field of [...firstFields].sort()) {
        if (claimed.has(field)) {
            continue;
        }
        add(field, description[switchParam(first, field)]?.TYPE === 'ENUM' ? 'enum' : 'number', [field]);
    }

    // Nothing may be dropped: every field of a slot has to end up in a column.
    if (claimed.size !== firstFields.size) {
        return undefined;
    }

    columns.sort((a, b) => rank(a.id) - rank(b.id) || (a.id < b.id ? -1 : 1));
    const weekday = description[switchParam(first, 'WEEKDAY')];
    return {
        kind: 'switch-week-profile',
        id: 'switch-week-profile',
        covers,
        slots,
        columns,
        durations,
        writable: weekday !== undefined && isWritable(weekday),
    };
}

function rank(id: string): number {
    const index = COLUMN_ORDER.indexOf(id);
    return index === -1 ? COLUMN_ORDER.length : index;
}
