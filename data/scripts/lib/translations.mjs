/**
 * Building `dist/translations/<language>.json` (`Translations` in packages/core/src/data/types.ts).
 *
 * Key normalisation - the CCU's own identifiers, as the contract asks for:
 *   channelTypes     `DIMMER`                             (upstream `dimmer`)
 *   deviceModels     `HM-LC-SW1-FM`, `263_130`            (upstream `hm-lc-sw1-fm`, `263 130`)
 *   parameters       `LONG_ON_TIME`, `DIMMER|LEVEL`       (upstream `long_on_time`, `dimmer|level`)
 *   parameterValues  `ACTION_TYPE|JUMP_TO_TARGET`         (upstream `action_type=jump_to_target`)
 *   parameterHelp    `ACOUSTIC_ALARM_SIGNAL`              (upstream `acoustic_alarm_signal`)
 *   uiLabels         `lblignore`, `stringtableeventdelay` (upstream, verbatim)
 *
 * `uiLabels` is the one map that is NOT upper-cased: its keys are WebUI label keys, not CCU
 * identifiers, and openccu-data already lower-cases them while extracting. Every `labelKey` and
 * `errorKey` the pipeline emits elsewhere is lower-cased to match, so `uiLabels[labelKey]` is a
 * direct hit and no casing rule leaks into the core.
 */

/** @param {string} key */
export const identifierKey = (key) => key.replaceAll(' ', '_').toUpperCase();

/** @param {string} key `param=value` / `channel|param=value` -> `PARAM|VALUE` / `CHANNEL|PARAM|VALUE` */
export const valueKey = (key) => identifierKey(key).replaceAll('=', '|');

/** @param {string} key */
export const labelKey = (key) => key.toLowerCase();

/**
 * The three `cross_validations` error keys are openccu-data's own identifiers; the WebUI has no
 * strings for them, so the pipeline supplies them. They are the only hand-written strings in
 * `dist/translations/` and therefore not HMSL-derived.
 */
export const CROSS_VALIDATION_MESSAGES = {
    'cross_validation.max_must_be_gte_min': {
        de: 'Der Maximalwert muss größer oder gleich dem Minimalwert sein.',
        en: 'The maximum value must be greater than or equal to the minimum value.',
        tr: 'Maksimum deger, minimum degere esit veya ondan büyük olmalidir.',
    },
    'cross_validation.level_must_be_in_range': {
        de: 'Der Wert muss zwischen dem eingestellten Minimal- und Maximalwert liegen.',
        en: 'The value must lie between the configured minimum and maximum value.',
        tr: 'Deger, ayarlanan minimum ve maksimum degerler arasinda olmalidir.',
    },
    'cross_validation.hi_must_be_gte_lo': {
        de: 'Der obere Grenzwert muss größer oder gleich dem unteren Grenzwert sein.',
        en: 'The upper limit must be greater than or equal to the lower limit.',
        tr: 'Üst sinir deger, alt sinir degere esit veya ondan büyük olmalidir.',
    },
};

/**
 * Merge upstream extract and the hand-curated overrides into one map.
 *
 * Precedence: `translation_custom/` wins over `translation_extract` - openccu-data's NOTICE calls
 * the custom files "hand-curated translation overrides", and they are the newer, corrected texts.
 *
 * @param {(key: string) => string} normalise
 * @param {Record<string, string>} extract
 * @param {Record<string, string>} custom
 * @param {(message: string) => void} warn
 */
export function mergeMap(normalise, extract, custom, warn) {
    /** @type {Record<string, string>} */
    const merged = {};
    for (const [source, entries] of [
        ['extract', extract],
        ['custom', custom],
    ]) {
        for (const [rawKey, value] of Object.entries(entries)) {
            const key = normalise(rawKey);
            if (source === 'extract' && key in merged && merged[key] !== value) {
                warn(`translation key collision after normalisation: ${rawKey} -> ${key}`);
            }
            merged[key] = value;
        }
    }
    return merged;
}
