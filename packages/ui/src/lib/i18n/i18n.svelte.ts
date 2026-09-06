import type {Language, LanguageChoice, MessageParams} from '@homematic-manager/core';
import {createTranslator} from '@homematic-manager/core';

import {CATALOGUE} from './uiMessages.js';

/** The languages the UI offers. Turkish exists as an easy-mode fallback only (D-15). */
export const UI_LANGUAGES: readonly Language[] = ['de', 'en'];

/** D-36: English is what a browser that asks for nothing we have gets. */
export const FALLBACK_LANGUAGE: Language = 'en';

export const LANGUAGE_LABELS: Readonly<Record<Language, string>> = {
    de: 'Deutsch',
    en: 'English',
    tr: 'Türkçe',
};

/**
 * What the browser prefers, in its own order; empty outside a browser (the UI is imported by
 * `svelte-check` and by a Node test run before anything renders).
 *
 * `navigator.languages` is typed as always there but is not on every engine, so the single
 * `navigator.language` is the fallback behind it.
 */
function navigatorLanguages(): readonly string[] {
    if (typeof navigator === 'undefined') {
        return [];
    }
    const list = navigator.languages as readonly string[] | undefined;
    if (list !== undefined && list.length > 0) {
        return list;
    }
    return navigator.language === '' ? [] : [navigator.language];
}

/**
 * The language the browser asks for: the first entry of `navigator.languages` the UI has, English
 * behind it (D-36).
 *
 * Region subtags are dropped, so `de-DE`, `de-AT` and `de-CH` are all German and `en-GB` is
 * English; a browser that asks for French in first place and German in second gets German, because
 * the *order* is what the user expressed. Turkish is deliberately not here: it exists as an
 * easy-mode fallback (D-15) and there is no Turkish UI to start in.
 */
export function browserLanguage(languages: readonly string[] = navigatorLanguages()): Language {
    for (const entry of languages) {
        const code = entry.toLowerCase().split('-')[0];
        const supported = UI_LANGUAGES.find((candidate) => candidate === code);
        if (supported !== undefined) {
            return supported;
        }
    }
    return FALLBACK_LANGUAGE;
}

/**
 * The language the UI starts in.
 *
 * The order is the whole of D-36: a choice the user made and stored wins, and everything else -
 * `auto`, an absent field, a language this UI does not have - means the browser decides. 2.x had
 * no order at all: it was German, and switching meant restarting the app (#119).
 */
export function resolveLanguage(
    stored: LanguageChoice | undefined,
    languages: readonly string[] = navigatorLanguages(),
): Language {
    const chosen = stored === undefined || stored === 'auto' ? undefined : UI_LANGUAGES.find((c) => c === stored);
    return chosen ?? browserLanguage(languages);
}

/**
 * The reactive wrapper around core's `Translator`.
 *
 * Core owns the catalogue and the lookup rules (fallback chain, plurals, interpolation); this adds
 * exactly one thing - a language that can change at runtime and re-renders everything that used
 * `t()`. 2.x translated the DOM once at start-up by walking `.translate` elements, so switching the
 * language meant restarting the app (#119).
 */
export class I18n {
    #language = $state<Language>(FALLBACK_LANGUAGE);
    readonly #translator = $derived(createTranslator(this.#language, {catalogue: CATALOGUE}));

    constructor(language: Language = FALLBACK_LANGUAGE) {
        this.#language = language;
    }

    get language(): Language {
        return this.#language;
    }

    set language(language: Language) {
        this.#language = language;
    }

    /** `t('Devices')`, `t('{count} devices', {}, 7)`. Bound, so it can be passed around. */
    readonly t = (key: string, params: MessageParams = {}, count?: number): string =>
        this.#translator.t(key, params, count);

    /** Is there a text for this key at all? Used to keep untranslated labels out of the UI. */
    readonly has = (key: string): boolean => this.#translator.has(key);
}

export function createI18n(language: Language = FALLBACK_LANGUAGE): I18n {
    return new I18n(language);
}
