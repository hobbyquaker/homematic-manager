import {detectBlindCalibration, type BlindCalibrationSpec} from './blindCalibration.js';
import {detectDurationPairs, type DurationPairsSpec} from './durationPairs.js';
import {detectEnumOptions, type EnumOptionsSpec} from './enumOptions.js';
import {EMPTY_CONTEXT, type EditorContext, type EditorTarget} from './types.js';

export * from './blindCalibration.js';
export * from './durationPairs.js';
export * from './enumOptions.js';
export * from './types.js';

/** Everything a detector can return. One member per device-specific editor. */
export type DeviceEditorSpec = BlindCalibrationSpec | DurationPairsSpec | EnumOptionsSpec;

/**
 * The registry: every device-specific editor, in the order they get to claim parameters.
 *
 * Order matters exactly once - a specific editor has to come before a general one, or the general
 * one takes its parameters away. The week-profile editors own `01_WP_DURATION_BASE` and its
 * siblings; the duration picker would otherwise draw 75 lonely duration rows next to them. Each
 * detector is therefore handed the names the earlier ones already claimed.
 */
type Detector = (
    target: EditorTarget,
    taken: ReadonlySet<string>,
    context: EditorContext,
) => DeviceEditorSpec | undefined;

const DETECTORS: readonly Detector[] = [detectBlindCalibration, detectDurationPairs, detectEnumOptions];

/** The editors that recognise this paramset, in registry order. */
export function detectDeviceEditors(target: EditorTarget, context: EditorContext = EMPTY_CONTEXT): DeviceEditorSpec[] {
    const specs: DeviceEditorSpec[] = [];
    const taken = new Set<string>();
    for (const detect of DETECTORS) {
        const spec = detect(target, taken, context);
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
