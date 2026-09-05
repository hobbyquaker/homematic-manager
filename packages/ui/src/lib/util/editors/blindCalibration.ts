import type {ParameterDescription, ParamsetValue} from '@homematic-manager/core';
import {findDurationPairs, isWritable, maxDurationSeconds, notUsedValue, numericBound} from '@homematic-manager/core';

import {setDuration, type DurationPairView} from './durationPairs.js';
import type {DeviceEditorBase, EditorTarget, EditorValues} from './types.js';

/**
 * Blind and shutter calibration: the reference run times, the change-over delay and what belongs
 * with them, in plain seconds - next to the raw value the device really stores.
 *
 * The same three running times are encoded in two different ways, which is the whole reason this
 * editor exists (both taken from real descriptions):
 *
 *   BidCos-RF HM-LC-Bl1-FM BLIND/MASTER
 *     REFERENCE_RUNNING_TIME_TOP_BOTTOM   FLOAT, 0.1..6000, UNIT `s`
 *     CHANGE_OVER_DELAY                   FLOAT, 0.5..25.5, UNIT `s`
 *   HmIP-RF HmIP-BBL BLIND_TRANSMITTER/MASTER
 *     REFERENCE_RUNNING_TIME_TOP_BOTTOM_UNIT   ENUM 10MS|100MS|1S|10S
 *     REFERENCE_RUNNING_TIME_TOP_BOTTOM_VALUE  INTEGER 0..16383
 *     CHANGE_OVER_DELAY                        FLOAT, 0..25.5, UNIT `s`
 *
 * so on HmIP the running time is two numbers to multiply, in a unit that is not the unit of the
 * change-over delay standing right next to it. The editor shows seconds for both and prints the
 * raw pair underneath, so what the device stores stays visible.
 *
 * Only what the description really has is drawn; a blind channel without slats has no slat row and
 * a description with no running time at all is not recognised as a blind at all.
 */

/** The three running times the CCU knows, in the order the WebUI lists them. */
export const BLIND_RUNNING_TIMES: readonly string[] = [
    'REFERENCE_RUNNING_TIME_TOP_BOTTOM',
    'REFERENCE_RUNNING_TIME_BOTTOM_TOP',
    'REFERENCE_RUNNING_TIME_SLATS',
];

/** The plain-seconds parameters that belong with a calibration. */
export const BLIND_DELAYS: readonly string[] = ['CHANGE_OVER_DELAY', 'DELAY_COMPENSATION'];

/** What else the calibration block carries: a counter and the auto-detection flag. */
export const BLIND_EXTRAS: readonly string[] = ['REFERENCE_RUN_COUNTER', 'ENDPOSITION_AUTO_DETECT'];

/** A running time is either one FLOAT of seconds or a unit/value pair. */
export type BlindTimeSource =
    | {readonly kind: 'seconds'; readonly param: string; readonly description: ParameterDescription}
    | {readonly kind: 'pair'; readonly view: DurationPairView};

export interface BlindRunningTime {
    /** `REFERENCE_RUNNING_TIME_TOP_BOTTOM` - the name without the HmIP suffix. */
    readonly id: string;
    readonly source: BlindTimeSource;
    readonly writable: boolean;
}

/** One plain parameter of the block, drawn as itself. */
export interface BlindParameter {
    readonly param: string;
    readonly description: ParameterDescription;
}

export interface BlindCalibrationSpec extends DeviceEditorBase {
    readonly kind: 'blind-calibration';
    readonly runningTimes: readonly BlindRunningTime[];
    readonly delays: readonly BlindParameter[];
    readonly extras: readonly BlindParameter[];
}

/** The seconds a running time stands for, whichever way it is stored. */
export function blindSeconds(entry: BlindRunningTime, values: EditorValues): number | undefined {
    if (entry.source.kind === 'seconds') {
        const value = values[entry.source.param];
        return typeof value === 'number' ? value : undefined;
    }
    const view = entry.source.view;
    const unit = view.pair.units[unitIndexOf(view, values)];
    const count = values[view.pair.countParam];
    if (unit === undefined || typeof count !== 'number') {
        return undefined;
    }
    return Math.round(unit.seconds * count * 1000) / 1000;
}

/** `90 x 1S` - what the device really stores, printed next to the seconds. */
export function blindRawValue(entry: BlindRunningTime, values: EditorValues): string {
    if (entry.source.kind === 'seconds') {
        return `${entry.source.param} = ${String(values[entry.source.param] ?? '—')}`;
    }
    const view = entry.source.view;
    const unit = view.pair.units[unitIndexOf(view, values)];
    return `${String(values[view.pair.countParam] ?? '—')} × ${unit?.name ?? '—'}`;
}

/** What to write for a running time, or `undefined` when the encoding cannot hold the value. */
export function setBlindSeconds(
    entry: BlindRunningTime,
    seconds: number,
): {readonly values: Record<string, ParamsetValue>; readonly exact: boolean; readonly seconds: number} | undefined {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return undefined;
    }
    if (entry.source.kind === 'seconds') {
        const max = numericBound(entry.source.description, 'MAX');
        if (max !== undefined && seconds > max) {
            return undefined;
        }
        return {values: {[entry.source.param]: seconds}, exact: true, seconds};
    }
    return setDuration(entry.source.view, seconds);
}

export function detectBlindCalibration(
    target: EditorTarget,
    taken: ReadonlySet<string>,
): BlindCalibrationSpec | undefined {
    const {description} = target;
    const pairs = new Map(findDurationPairs(description).map((pair) => [pair.name, pair]));

    const runningTimes: BlindRunningTime[] = [];
    const covers: string[] = [];
    for (const id of BLIND_RUNNING_TIMES) {
        const plain = description[id];
        const pair = pairs.get(id);
        if (plain) {
            runningTimes.push({
                id,
                source: {kind: 'seconds', param: id, description: plain},
                writable: isWritable(plain),
            });
            covers.push(id);
            continue;
        }
        const unit = pair && description[pair.unitParam];
        const count = pair && description[pair.countParam];
        if (!pair || !unit || !count) {
            continue;
        }
        const special = notUsedValue(count);
        const view: DurationPairView = {
            pair,
            unitDescription: unit,
            countDescription: count,
            writable: isWritable(unit) && isWritable(count),
            notUsedSeconds: special ?? maxDurationSeconds(pair),
            notUsedFromSpecial: special !== undefined,
        };
        runningTimes.push({id, source: {kind: 'pair', view}, writable: view.writable});
        covers.push(pair.unitParam, pair.countParam);
    }

    // No reference run time, no calibration - and then nothing is taken out of the generic list.
    if (runningTimes.length === 0 || covers.some((name) => taken.has(name))) {
        return undefined;
    }

    const delays = present(description, BLIND_DELAYS);
    const extras = present(description, BLIND_EXTRAS);
    return {
        kind: 'blind-calibration',
        id: 'blind-calibration',
        covers: [...covers, ...delays.map((entry) => entry.param), ...extras.map((entry) => entry.param)],
        runningTimes,
        delays,
        extras,
    };
}

function present(description: EditorTarget['description'], names: readonly string[]): BlindParameter[] {
    return names.flatMap((param) => {
        const found = description[param];
        return found ? [{param, description: found}] : [];
    });
}

function unitIndexOf(view: DurationPairView, values: EditorValues): number {
    const raw = values[view.pair.unitParam];
    if (typeof raw === 'number') {
        return raw;
    }
    return view.pair.units.findIndex((unit) => unit.name === raw);
}
