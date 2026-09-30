/**
 * B-82: an option preset's text, the way the WebUI's page renders it - every `${key}` of the
 * template replaced by the WebUI label of that key in the current language, the rest as it
 * stands (`${after} 1min` is "nach 1min" in German, "after 1min" in English).
 */
import type {OptionPresetEntry} from './types.js';

const KEY = /\$\{(\w+)\}/gu;

/**
 * The label of one preset entry. `uiLabel` is the lookup of `Translations.uiLabels` in the current
 * language (`Lookup.uiLabel`); it answers the key itself when no language has it, as the WebUI
 * shows an untranslated key.
 */
export function presetLabel(entry: Pick<OptionPresetEntry, 'template'>, uiLabel: (key: string) => string): string {
    return entry.template.replace(KEY, (_, key: string) => uiLabel(key));
}
