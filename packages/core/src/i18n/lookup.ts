/**
 * Lookups into the CCU's own string tables (`Translations`, from the data pipeline of task 9).
 *
 * Two different key shapes live in that file and mixing them up produces silent misses:
 *
 *   the five identifier maps use the CCU's uppercase identifiers, with `|` between the parts:
 *   `DIMMER|LEVEL`, `ACTION_TYPE|JUMP_TO_TARGET`, `ACCELERATION_TRANSCEIVER|MOTION|FALSE`
 *   `uiLabels` uses the WebUI's own lowercase keys; the `${key}`s of the option presets' templates
 *   keep the WebUI's case (`${stringTableLogicOR}`), every `errorKey` of the cross-validation rules
 *   is lower case
 *
 * so a key is tried as it was given and then in the case the file uses: upper case for the five
 * identifier maps, lower case for the UI labels. Device models are the reason for "as it was
 * given" - a device type is mixed case ("HM-LC-Sw1-Pl-CT-R1"), while channel types, parameters
 * and enum names are upper case throughout.
 *
 * The fallback order for a parameter is the one `dialogParamset` used
 * (homematic-manager.js:1757): the channel-type-specific entry first, the bare parameter name
 * second - and now the same two steps again in the fallback language, so a missing German string
 * shows the English one instead of the raw identifier.
 */

import type {Language, Translations} from '../data/types.js';

/** The order in which languages are consulted; the first that has the key wins. */
export type TranslationChain = readonly Translations[];

/** Reads labels and help texts out of one or more `Translations`. */
export class TranslationLookup {
    readonly #chain: Translations[];

    /**
     * @param primary  the user's language.
     * @param fallback consulted when the primary has no entry - `en`, then `de` (D-15/#119).
     */
    constructor(primary?: Translations, ...fallback: (Translations | undefined)[]) {
        this.#chain = [primary, ...fallback].filter((entry): entry is Translations => entry !== undefined);
    }

    /** The languages this lookup can answer in, in order. */
    get languages(): Language[] {
        return this.#chain.map((translations) => translations.language);
    }

    /** The label of a channel type, or the type itself when nobody translated it. */
    channelType(type: string): string {
        return this.#firstKey((translations) => translations.channelTypes, identifiers(type)) ?? type;
    }

    /** The label of a device model, or the model itself. */
    deviceModel(type: string): string {
        return this.#firstKey((translations) => translations.deviceModels, identifiers(type)) ?? type;
    }

    /**
     * The label of a parameter. `CHANNEL_TYPE|PARAM` first, then `PARAM`; the parameter name
     * itself when neither language has either.
     */
    parameter(param: string, channelType?: string): string {
        return this.#firstKey((translations) => translations.parameters, keys(param, channelType)) ?? param;
    }

    /**
     * The label of one value of a parameter: `CHANNEL_TYPE|PARAM|VALUE`, then `PARAM|VALUE`, then
     * `VALUE`. Falls back to the value itself, which for an enum is its `VALUE_LIST` name.
     */
    parameterValue(param: string, value: string, channelType?: string): string {
        const candidates = keys(`${param}|${value}`, channelType);
        candidates.push(...identifiers(value));
        return this.#firstKey((translations) => translations.parameterValues, candidates) ?? value;
    }

    /**
     * B-80: the label of a `SPECIAL` value's id (`NOT_USED`). What `parameterValue` finds first -
     * `CHANNEL_TYPE|PARAM=ID` is how the WebUI keys a MASTER special - and then the bare id as a
     * string-table key of its own: the WebUI's `NOT_USED` is `${stringTableNotUsed}` ("Nicht benutzt",
     * "Unused"), which lands among the parameter labels. Only for special ids: an enum value that
     * happened to share its name with a parameter must not take that parameter's label.
     */
    specialValue(param: string, id: string, channelType?: string): string {
        const found = this.parameterValue(param, id, channelType);
        return found !== id
            ? found
            : (this.#firstKey((translations) => translations.parameters, identifiers(id)) ?? id);
    }

    /** The help text of a parameter, or `undefined` - a missing help text is not an error. */
    parameterHelp(param: string, channelType?: string): string | undefined {
        return this.#firstKey((translations) => translations.parameterHelp, keys(param, channelType));
    }

    /**
     * A WebUI label by its own lowercase key - what the `${key}`s of `OptionPresetEntry.template` and
     * `CrossValidationRule.errorKey` point at. Falls back to the key itself.
     */
    uiLabel(key: string): string {
        return this.#firstKey((translations) => translations.uiLabels, dedupe([key, key.toLowerCase()])) ?? key;
    }

    /** Tries every key in every language, keys first: a specific hit beats a closer language. */
    #firstKey(
        map: (translations: Translations) => Readonly<Record<string, string>>,
        candidates: readonly string[],
    ): string | undefined {
        for (const translations of this.#chain) {
            for (const key of candidates) {
                const found = map(translations)[key];
                if (found !== undefined && found !== '') {
                    return found;
                }
            }
        }
        return undefined;
    }
}

/**
 * `CHANNEL_TYPE|SUFFIX` before `SUFFIX`, each as given and upper-cased - and then the same two
 * again without a `SHORT_` or `LONG_` prefix (B-75). The string tables label a link's parameters
 * by the name behind the key press: `ON_TIME`, `JT_ON`, `PROFILE_ACTION_TYPE` are in them,
 * `SHORT_ON_TIME` and `LONG_ON_TIME` are not - 2.7.1 stripped the prefix for a link's help
 * texts (homematic-manager.js:3475), and a MASTER parameter that happens to start with one
 * (`LONG_PRESS_TIME`) still finds its own entry first.
 */
function keys(suffix: string, channelType: string | undefined): string[] {
    const stripped = suffix.replace(/^(?:SHORT|LONG)_/i, '');
    const forms = stripped === suffix ? [suffix] : [suffix, stripped];
    return dedupe(
        forms.flatMap((form) => {
            const bare = identifiers(form);
            if (channelType === undefined || channelType === '') {
                return bare;
            }
            const qualified = identifiers(channelType).map((type) => `${type}|${form}`);
            return [...qualified, ...qualified.map((key) => key.toUpperCase()), ...bare];
        }),
    );
}

/** The key as it was given, plus its upper-case form where that differs. */
function identifiers(value: string): string[] {
    return dedupe([value, value.toUpperCase()]);
}

function dedupe(values: string[]): string[] {
    return [...new Set(values)];
}
