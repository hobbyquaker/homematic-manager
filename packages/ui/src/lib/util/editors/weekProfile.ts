import type {ParameterDescription, ParamsetValue} from '@homematic-manager/core';
import {isWritable, numericBound} from '@homematic-manager/core';

import type {DeviceEditorBase, EditorTarget, EditorValues} from './types.js';

/**
 * The heating week programme: 13 (or 24) time slots per weekday, per profile.
 *
 * The CCU flattens the whole programme into the MASTER paramset, one parameter per slot per day,
 * and the generic editor then draws 546 numbered rows that nobody can read. The naming differs per
 * device family, and all of it is read off the description rather than assumed - these are the four
 * shapes in real descriptions:
 *
 *   HmIP-eTRV-2 HEATING_CLIMATECONTROL_TRANSCEIVER/MASTER   570 parameters
 *     `P1_ENDTIME_MONDAY_1` .. `P3_TEMPERATURE_SUNDAY_13`, INTEGER 5..1440 and FLOAT 5..30
 *   HMIP-WTH 2.2 HEATING_CLIMATECONTROL_TRANSCEIVER/MASTER
 *     the same with six profiles, `P1_`..`P6_` - which is why the profiles are counted, not assumed
 *   HM-CC-RT-DN, the *device* MASTER (no channel at all)
 *     `ENDTIME_MONDAY_1` / `TEMPERATURE_MONDAY_1`, one unnamed profile, 13 slots
 *   HM-CC-TC CLIMATECONTROL_REGULATOR/MASTER
 *     `TIMEOUT_MONDAY_1` / `TEMPERATUR_MONDAY_1` (no E), 24 slots
 *
 * The last one is also what Max! answers through Homegear, and it needs no special case: the
 * description says what it says and the editor follows it (D-20).
 *
 * Detection is strict on purpose. A profile has to have exactly one end-time field and one value
 * field, all seven days, and the slots 1..n unbroken for both fields on every day; every parameter
 * that looks like a slot has to end up in a profile, and every parameter a profile claims has to
 * exist. Anything else and the whole editor stands down, because a half-recognised programme would
 * hide rows the user then could not reach.
 */

/** The weekday segments the CCU uses, Monday first - the order the editor draws them in. */
export const WEEKDAYS: readonly string[] = [
    'MONDAY',
    'TUESDAY',
    'WEDNESDAY',
    'THURSDAY',
    'FRIDAY',
    'SATURDAY',
    'SUNDAY',
];

/** The i18n key of each weekday, in the same order. */
export const WEEKDAY_LABELS: readonly string[] = [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
];

/** The field that ends a slot. `TIMEOUT` is the HM-CC-TC spelling of `ENDTIME`. */
const END_TIME_FIELDS: readonly string[] = ['ENDTIME', 'TIMEOUT'];

/** The field that says what to do until then. `TEMPERATUR` is the HM-CC-TC spelling. */
const VALUE_FIELDS: readonly string[] = ['TEMPERATURE', 'TEMPERATUR'];

const SLOT_PATTERN = /^(?:(P\d+)_)?([A-Z]+)_([A-Z]+)_(\d+)$/;

/** One programme of the paramset: `P1`, or `''` where the device has only one. */
export interface WeekProfileEntry {
    readonly id: string;
    /** `P1_ENDTIME` - the parameter name without `_<DAY>_<slot>`. */
    readonly endTimePrefix: string;
    /** `P1_TEMPERATURE`. */
    readonly valuePrefix: string;
}

export interface WeekProfileSpec extends DeviceEditorBase {
    readonly kind: 'week-profile';
    readonly profiles: readonly WeekProfileEntry[];
    readonly days: readonly string[];
    readonly slots: number;
    /** The bare field name, `ENDTIME` or `TIMEOUT` - what the string table has a label for. */
    readonly endTimeField: string;
    /** `TEMPERATURE` or `TEMPERATUR`. */
    readonly valueField: string;
    readonly endTimeDescription: ParameterDescription;
    readonly valueDescription: ParameterDescription;
    /** `MAX` of an end time: 1440, the minute the day is over. */
    readonly dayEnd: number;
    readonly writable: boolean;
}

/** `P1_ENDTIME_MONDAY_1`. */
export function slotParam(prefix: string, day: string, slot: number): string {
    return `${prefix}_${day}_${slot}`;
}

/** What one slot holds now; either half may be missing if the device did not answer with it. */
export function readSlot(
    spec: WeekProfileSpec,
    values: EditorValues,
    profile: WeekProfileEntry,
    day: string,
    slot: number,
): {readonly endTime: number | undefined; readonly value: number | undefined} {
    return {
        endTime: asNumber(values[slotParam(profile.endTimePrefix, day, slot)]),
        value: asNumber(values[slotParam(profile.valuePrefix, day, slot)]),
    };
}

/** Why a day of a programme is not a programme the device will accept. */
export type WeekProfileProblemCode = 'not-increasing' | 'after-day-end' | 'day-not-closed';

export interface WeekProfileProblem {
    readonly profile: string;
    readonly day: string;
    readonly slot: number;
    readonly code: WeekProfileProblemCode;
}

/**
 * The rule the CCU enforces and the description does not express: within one day the end times
 * rise, the last one is the end of the day, and every slot behind the one that reached it repeats
 * it - that is how an unused slot is expressed, not by leaving it empty.
 */
export function validateWeekProfile(spec: WeekProfileSpec, values: EditorValues): WeekProfileProblem[] {
    const problems: WeekProfileProblem[] = [];
    for (const profile of spec.profiles) {
        for (const day of spec.days) {
            let previous = 0;
            let closed = false;
            for (let slot = 1; slot <= spec.slots; slot += 1) {
                const {endTime} = readSlot(spec, values, profile, day, slot);
                if (endTime === undefined) {
                    continue;
                }
                if (closed) {
                    if (endTime !== spec.dayEnd) {
                        problems.push({profile: profile.id, day, slot, code: 'after-day-end'});
                    }
                } else if (endTime <= previous) {
                    problems.push({profile: profile.id, day, slot, code: 'not-increasing'});
                }
                if (endTime >= spec.dayEnd) {
                    closed = true;
                }
                previous = endTime;
            }
            if (!closed) {
                problems.push({profile: profile.id, day, slot: spec.slots, code: 'day-not-closed'});
            }
        }
    }
    return problems;
}

/** Every slot of one day of one programme, copied onto the other days. */
export function copyWeekDay(
    spec: WeekProfileSpec,
    values: EditorValues,
    profile: WeekProfileEntry,
    from: string,
    to: readonly string[],
): Record<string, ParamsetValue> {
    const update: Record<string, ParamsetValue> = {};
    for (const day of to) {
        if (day === from || !spec.days.includes(day)) {
            continue;
        }
        for (let slot = 1; slot <= spec.slots; slot += 1) {
            copySlot(update, values, profile, from, profile, day, slot);
        }
    }
    return update;
}

/** A whole programme copied onto another one - `P1` onto `P2`, all seven days at once. */
export function copyWeekProfile(
    spec: WeekProfileSpec,
    values: EditorValues,
    from: WeekProfileEntry,
    to: readonly WeekProfileEntry[],
): Record<string, ParamsetValue> {
    const update: Record<string, ParamsetValue> = {};
    for (const profile of to) {
        if (profile.id === from.id) {
            continue;
        }
        for (const day of spec.days) {
            for (let slot = 1; slot <= spec.slots; slot += 1) {
                copySlot(update, values, from, day, profile, day, slot);
            }
        }
    }
    return update;
}

/** `06:00`, `24:00` - the CCU counts minutes from midnight and 1440 is the end of the day. */
export function formatMinutes(minutes: number | undefined): string {
    if (minutes === undefined || !Number.isFinite(minutes) || minutes < 0) {
        return '';
    }
    const hours = Math.floor(minutes / 60);
    const rest = Math.round(minutes % 60);
    return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/** `06:00` -> 360. Returns `undefined` for anything that is not a time of day. */
export function parseMinutes(text: string): number | undefined {
    const match = /^(\d{1,2}):([0-5]\d)$/.exec(text.trim());
    if (!match) {
        return undefined;
    }
    const minutes = Number(match[1]) * 60 + Number(match[2]);
    return minutes > 24 * 60 ? undefined : minutes;
}

export function detectWeekProfile(target: EditorTarget, taken: ReadonlySet<string>): WeekProfileSpec | undefined {
    const {description} = target;
    const slotNames: string[] = [];
    const fields = new Map<string, Set<string>>();
    let slots = 0;

    for (const name of Object.keys(description)) {
        const match = SLOT_PATTERN.exec(name);
        const day = match?.[3];
        const field = match?.[2];
        if (!match || !day || !field || !WEEKDAYS.includes(day)) {
            continue;
        }
        if (!END_TIME_FIELDS.includes(field) && !VALUE_FIELDS.includes(field)) {
            continue;
        }
        const profile = match[1] ?? '';
        slotNames.push(name);
        let known = fields.get(profile);
        if (!known) {
            known = new Set<string>();
            fields.set(profile, known);
        }
        known.add(field);
        slots = Math.max(slots, Number(match[4]));
    }

    if (slotNames.length === 0 || slots === 0) {
        return undefined;
    }

    const profiles: WeekProfileEntry[] = [];
    let endTimeField = '';
    let valueField = '';
    for (const [id, known] of [...fields].sort(([a], [b]) => (a < b ? -1 : 1))) {
        const end = [...known].find((field) => END_TIME_FIELDS.includes(field));
        const value = [...known].find((field) => VALUE_FIELDS.includes(field));
        // Exactly one of each, and the same two in every profile; anything else is a shape this
        // editor does not understand.
        if (known.size !== 2 || end === undefined || value === undefined) {
            return undefined;
        }
        if (endTimeField !== '' && (end !== endTimeField || value !== valueField)) {
            return undefined;
        }
        endTimeField = end;
        valueField = value;
        const prefix = id === '' ? '' : `${id}_`;
        profiles.push({id, endTimePrefix: `${prefix}${end}`, valuePrefix: `${prefix}${value}`});
    }

    const covers: string[] = [];
    for (const profile of profiles) {
        for (const day of WEEKDAYS) {
            for (let slot = 1; slot <= slots; slot += 1) {
                covers.push(slotParam(profile.endTimePrefix, day, slot), slotParam(profile.valuePrefix, day, slot));
            }
        }
    }
    // Every slot the editor would draw has to exist, and every slot-shaped parameter has to be one
    // the editor draws - otherwise rows would disappear that nothing puts back.
    if (covers.length !== slotNames.length || covers.some((name) => !(name in description) || taken.has(name))) {
        return undefined;
    }

    const first = profiles[0];
    const endTimeDescription = first && description[slotParam(first.endTimePrefix, 'MONDAY', 1)];
    const valueDescription = first && description[slotParam(first.valuePrefix, 'MONDAY', 1)];
    const dayEnd = endTimeDescription === undefined ? undefined : numericBound(endTimeDescription, 'MAX');
    if (!endTimeDescription || !valueDescription || dayEnd === undefined) {
        return undefined;
    }

    return {
        kind: 'week-profile',
        id: 'week-profile',
        covers,
        profiles,
        days: WEEKDAYS,
        slots,
        endTimeField,
        valueField,
        endTimeDescription,
        valueDescription,
        dayEnd,
        writable: isWritable(endTimeDescription) && isWritable(valueDescription),
    };
}

function copySlot(
    update: Record<string, ParamsetValue>,
    values: EditorValues,
    from: WeekProfileEntry,
    fromDay: string,
    to: WeekProfileEntry,
    toDay: string,
    slot: number,
): void {
    const endTime = values[slotParam(from.endTimePrefix, fromDay, slot)];
    const value = values[slotParam(from.valuePrefix, fromDay, slot)];
    if (endTime !== undefined) {
        update[slotParam(to.endTimePrefix, toDay, slot)] = endTime;
    }
    if (value !== undefined) {
        update[slotParam(to.valuePrefix, toDay, slot)] = value;
    }
}

function asNumber(value: ParamsetValue | undefined): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
