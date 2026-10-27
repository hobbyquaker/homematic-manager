import type {Language} from '@homematic-manager/core';
import {
    FALLBACK_LANGUAGE,
    I18n as KitI18n,
    LANGUAGE_LABELS as KIT_LANGUAGE_LABELS,
    UI_LANGUAGES as KIT_UI_LANGUAGES,
} from 'occulite-ui/i18n';

import {CATALOGUE} from './uiMessages.js';

export {browserLanguage, FALLBACK_LANGUAGE, resolveLanguage} from 'occulite-ui/i18n';

/** The languages the UI offers. Turkish exists as an easy-mode fallback only (D-15). */
export const UI_LANGUAGES: readonly Language[] = KIT_UI_LANGUAGES;

export const LANGUAGE_LABELS: Readonly<Record<Language, string>> = {
    ...(KIT_LANGUAGE_LABELS as Record<'de' | 'en', string>),
    tr: 'Türkçe',
};

/**
 * occulite-ui's reactive translation over core's catalogue merged with the UI's own keys: a
 * language that can change at runtime and re-renders everything that used `t()`.
 */
export class I18n extends KitI18n {
    constructor(language: Language = FALLBACK_LANGUAGE) {
        super(language, {catalogue: CATALOGUE});
    }

    override get language(): Language {
        return super.language as Language;
    }

    override set language(language: Language) {
        super.language = language;
    }
}

export function createI18n(language: Language = FALLBACK_LANGUAGE): I18n {
    return new I18n(language);
}
