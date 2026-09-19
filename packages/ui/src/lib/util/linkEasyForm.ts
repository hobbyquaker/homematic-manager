import type {
    DurationPair,
    LinkParameterSubset,
    Localized,
    OptionPreset,
    ParamsetDescription,
    ParamsetValue,
    TimeSelectorOption,
} from '@homematic-manager/core';
import {readDurationPair, writeDurationPair} from '@homematic-manager/core';

/**
 * Tasks 62 and 63 (D-54, D-55): the easy mode's controls in the CCU's shape - a time selector over
 * a duration pair (a link's base/factor, an HmIP MASTER parameter's unit/value), a preset combo
 * box, and one choice among the subsets of a sender type. The rows themselves are Svelte; what
 * they decide is here, where it can be tested without a DOM.
 */

/** The label of a localized text in the user's language, with English and German behind it. */
export function localizedText(text: Localized | null | undefined, language: string): string | undefined {
    if (!text) return undefined;
    const table = text as Record<string, string | undefined>;
    return table[language] ?? table['en'] ?? table['de'];
}

/** `1.5` -> `1.5 s`, `90` -> `1.5 min`, `7200` -> `2 h`: a duration the way the WebUI's presets read. */
export function formatSeconds(seconds: number): string {
    if (seconds < 1) return `${String(Math.round(seconds * 1000))} ms`;
    if (seconds < 60) return `${String(seconds)} s`;
    if (seconds < 3600) return `${String(Math.round((seconds / 60) * 100) / 100)} min`;
    return `${String(Math.round((seconds / 3600) * 100) / 100)} h`;
}

/** What a time option says in the list. */
export function timeOptionLabel(
    option: TimeSelectorOption,
    language: string,
    fallback: (key: string) => string,
): string {
    const own = localizedText(option.label, language);
    if (own !== undefined) return own;
    if ('seconds' in option) return formatSeconds(option.seconds);
    return fallback(
        option.special === 'notActive' ? 'Not active' : option.special === 'permanent' ? 'Permanent' : 'Enter value',
    );
}

/**
 * Which option the pair's current values stand for: `notActive` at 0 s, `permanent` at the pair's
 * maximum, the preset of the same duration otherwise, and `enterValue` for anything in between -
 * the WebUI then shows the raw base and factor, and so does the dialog. `-1` when the pair cannot
 * be read at all.
 */
export function timeOptionIndex(
    options: readonly TimeSelectorOption[],
    values: Readonly<Record<string, ParamsetValue>>,
    pair: DurationPair,
): number {
    const decoded = readDurationPair(values, pair);
    if (decoded === undefined) return -1;
    const index = options.findIndex((option) => {
        if ('seconds' in option) return !decoded.maximal && Math.abs(option.seconds - decoded.seconds) < 1e-6;
        if (option.special === 'notActive') return decoded.seconds === 0;
        if (option.special === 'permanent') return decoded.maximal;
        return false;
    });
    return index >= 0 ? index : options.findIndex((option) => 'special' in option && option.special === 'enterValue');
}

/**
 * The values a chosen option writes: base index and factor. `undefined` for `enterValue`, which
 * writes nothing and only opens the raw fields.
 */
export function timeOptionValues(option: TimeSelectorOption, pair: DurationPair): Record<string, number> | undefined {
    if ('seconds' in option) return writeDurationPair(option.seconds, pair);
    if (option.special === 'notActive') return {[pair.unitParam]: 0, [pair.countParam]: 0};
    // the largest unit with the largest count: the pair's "for ever"
    if (option.special === 'permanent') {
        return {[pair.unitParam]: pair.units.length - 1, [pair.countParam]: pair.maxCount};
    }
    return undefined;
}

/** Loose equality: the data says `"1"` where the device answers `1`, and a boolean may be `1`. */
function same(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a === 'boolean' || typeof b === 'boolean') return Boolean(a) === Boolean(b);
    const left = Number(a);
    const right = Number(b);
    return !Number.isNaN(left) && !Number.isNaN(right) && left === right;
}

/** The subsets a subset control offers, in its order, as far as the sender type has them. */
export function subsetChoices(
    ids: readonly number[],
    subsets: readonly LinkParameterSubset[] = [],
): LinkParameterSubset[] {
    return ids.flatMap((id) => subsets.filter((subset) => subset.id === id));
}

/** Which of the choices the current values follow, or `-1` when none does. */
export function subsetIndex(
    choices: readonly LinkParameterSubset[],
    values: Readonly<Record<string, ParamsetValue>>,
    description: ParamsetDescription,
): number {
    return choices.findIndex((subset) =>
        Object.entries(subset.values).every(([param, value]) => !(param in description) || same(values[param], value)),
    );
}

/** What choosing a subset writes: its values, for the parameters this device has. */
export function subsetValues(
    subset: LinkParameterSubset,
    description: ParamsetDescription,
): Record<string, ParamsetValue> {
    return Object.fromEntries(Object.entries(subset.values).filter(([param]) => param in description));
}

/**
 * Which preset of a combo box the stored value is, or `-1` for none - the WebUI then shows its
 * free entry, and so does the dialog. Numbers compare loosely (`1` is the preset `1.0`).
 */
export function presetIndex(preset: OptionPreset, value: unknown): number {
    return preset.presets.findIndex((entry) => same(entry.value, value) || String(entry.value) === String(value));
}
