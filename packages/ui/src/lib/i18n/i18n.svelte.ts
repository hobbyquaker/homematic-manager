import type {Language, MessageParams} from '@homematic-manager/core';
import {createTranslator} from '@homematic-manager/core';

import {CATALOGUE} from './uiMessages.js';

/** The languages the UI offers. Turkish exists as an easy-mode fallback only (D-15). */
export const UI_LANGUAGES: readonly Language[] = ['de', 'en'];

export const LANGUAGE_LABELS: Readonly<Record<Language, string>> = {
    de: 'Deutsch',
    en: 'English',
    tr: 'Türkçe',
};

/**
 * The reactive wrapper around core's `Translator`.
 *
 * Core owns the catalogue and the lookup rules (fallback chain, plurals, interpolation); this adds
 * exactly one thing - a language that can change at runtime and re-renders everything that used
 * `t()`. 2.x translated the DOM once at start-up by walking `.translate` elements, so switching the
 * language meant restarting the app (#119).
 */
export class I18n {
    #language = $state<Language>('de');
    readonly #translator = $derived(createTranslator(this.#language, {catalogue: CATALOGUE}));

    constructor(language: Language = 'de') {
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

export function createI18n(language: Language = 'de'): I18n {
    return new I18n(language);
}
