import {detectBlindCalibration, type BlindCalibrationSpec} from './blindCalibration.js';
import {detectDurationPairs, type DurationPairsSpec} from './durationPairs.js';
import type {EditorTarget} from './types.js';

export * from './blindCalibration.js';
export * from './durationPairs.js';
export * from './types.js';

/** Everything a detector can return. One member per device-specific editor. */
export type DeviceEditorSpec = BlindCalibrationSpec | DurationPairsSpec;

/**
 * The registry: every device-specific editor, in the order they get to claim parameters.
 *
 * Order matters exactly once - a specific editor has to come before a general one, or the general
 * one takes its parameters away. The week-profile editors own `01_WP_DURATION_BASE` and its
 * siblings; the duration picker would otherwise draw 75 lonely duration rows next to them. Each
 * detector is therefore handed the names the earlier ones already claimed.
 */
const DETECTORS: readonly ((target: EditorTarget, taken: ReadonlySet<string>) => DeviceEditorSpec | undefined)[] = [
    detectBlindCalibration,
    detectDurationPairs,
];

/** The editors that recognise this paramset, in registry order. */
export function detectDeviceEditors(target: EditorTarget): DeviceEditorSpec[] {
    const specs: DeviceEditorSpec[] = [];
    const taken = new Set<string>();
    for (const detect of DETECTORS) {
        const spec = detect(target, taken);
        if (!spec) {
            continue;
        }
        specs.push(spec);
        for (const name of spec.covers) {
            taken.add(name);
        }
    }
    return specs;
}

/** Every parameter the editors draw; the generic list drops exactly these. */
export function coveredParameters(specs: readonly DeviceEditorSpec[]): Set<string> {
    return new Set(specs.flatMap((spec) => spec.covers));
}
