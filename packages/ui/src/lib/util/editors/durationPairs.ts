import type {DurationPair, ParameterDescription} from '@homematic-manager/core';
import {
    encodeDuration,
    findDurationPairs,
    isWritable,
    maxDurationSeconds,
    notUsedValue,
    readDurationPair,
    writeDurationPair,
} from '@homematic-manager/core';

import type {DeviceEditorBase, EditorTarget, EditorValues} from './types.js';

/**
 * The duration pickers: every `*_BASE`/`*_FACTOR` and every HmIP `*_UNIT`/`*_VALUE` pair of a
 * paramset, shown as the duration they mean instead of two numbers to multiply.
 *
 * The pairs come from core's `findDurationPairs`, so the eight time bases, the HmIP unit tokens and
 * the "this is not a duration" check are in one place and are tested against real descriptions
 * there. Nothing here is a constant: the "not used / for ever" value is the count parameter's own
 * `SPECIAL` where it has one and the pair's own maximum otherwise (#96) - the pair maximum is
 * 111600 s for the eight bases and something else entirely for
 * `REFERENCE_RUNNING_TIME_BOTTOM_TOP_UNIT`, whose finest step is 10 ms.
 *
 * (Measured while writing this: not one of the 2827 real descriptions in node-red-contrib-ccu's
 * `paramsets.json` carries a `SPECIAL` on a `*_FACTOR`, `*_VALUE`, `*_BASE` or `*_UNIT`, so in
 * practice the pair maximum is always what is shown. The `SPECIAL` is read first anyway, because
 * hard-coding the other way round is exactly what #96 is about.)
 */

/** One duration row. */
export interface DurationPairView {
    readonly pair: DurationPair;
    readonly unitDescription: ParameterDescription;
    readonly countDescription: ParameterDescription;
    /** False when either half is read-only; the row is then shown but cannot be changed. */
    readonly writable: boolean;
    /** The seconds that mean "not used / for ever" for this pair. */
    readonly notUsedSeconds: number;
    /** True when that value came from a `SPECIAL` rather than from the pair's maximum. */
    readonly notUsedFromSpecial: boolean;
}

export interface DurationPairsSpec extends DeviceEditorBase {
    readonly kind: 'duration-pairs';
    readonly pairs: readonly DurationPairView[];
}

/** The duration a pair holds now. */
export function durationOf(view: DurationPairView, values: EditorValues): number | undefined {
    return readDurationPair(values, view.pair)?.seconds;
}

/** Does the pair hold its "not used / for ever" value? */
export function isNotUsedDuration(view: DurationPairView, values: EditorValues): boolean {
    return durationOf(view, values) === view.notUsedSeconds;
}

/**
 * The two parameters to write for a duration, or `undefined` when the pair cannot hold it at all.
 * `exact` is false when the encoding rounds - the dialog says so rather than pretending.
 */
export function setDuration(
    view: DurationPairView,
    seconds: number,
): {readonly values: Record<string, number>; readonly exact: boolean; readonly seconds: number} | undefined {
    const encoded = encodeDuration(seconds, view.pair);
    const values = writeDurationPair(seconds, view.pair);
    if (!encoded || !values) {
        return undefined;
    }
    return {values, exact: encoded.exact, seconds: encoded.seconds};
}

/**
 * The pairs of a description, minus what an earlier editor already took - the week-profile editors
 * own `01_WP_DURATION_BASE` and its 74 siblings, and drawing them twice would be worse than not
 * drawing them at all.
 */
export function detectDurationPairs(target: EditorTarget, taken: ReadonlySet<string>): DurationPairsSpec | undefined {
    const pairs: DurationPairView[] = [];
    for (const pair of findDurationPairs(target.description)) {
        const unitDescription = target.description[pair.unitParam];
        const countDescription = target.description[pair.countParam];
        if (!unitDescription || !countDescription || taken.has(pair.unitParam) || taken.has(pair.countParam)) {
            continue;
        }
        const special = notUsedValue(countDescription);
        pairs.push({
            pair,
            unitDescription,
            countDescription,
            writable: isWritable(unitDescription) && isWritable(countDescription),
            notUsedSeconds: special ?? maxDurationSeconds(pair),
            notUsedFromSpecial: special !== undefined,
        });
    }
    if (pairs.length === 0) {
        return undefined;
    }
    return {
        kind: 'duration-pairs',
        id: 'duration-pairs',
        covers: pairs.flatMap((view) => [view.pair.unitParam, view.pair.countParam]),
        pairs,
    };
}

/** `1 h 30 min`, `100 ms`, `0 s` - the units are the same word in every language the UI has. */
export function formatSeconds(seconds: number): string {
    if (!Number.isFinite(seconds)) {
        return '—';
    }
    if (seconds === 0) {
        return '0 s';
    }
    if (seconds < 1) {
        return `${Math.round(seconds * 1000)} ms`;
    }
    const parts: string[] = [];
    let rest = Math.round(seconds * 10) / 10;
    const hours = Math.floor(rest / 3600);
    if (hours > 0) {
        parts.push(`${hours} h`);
        rest -= hours * 3600;
    }
    const minutes = Math.floor(rest / 60);
    if (minutes > 0) {
        parts.push(`${minutes} min`);
        rest -= minutes * 60;
    }
    if (rest > 0) {
        parts.push(`${Math.round(rest * 10) / 10} s`);
    }
    return parts.join(' ');
}
