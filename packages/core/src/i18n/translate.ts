/**
 * Message translation: `t(key, params, count)`.
 *
 * 2.x had `_()`, a lookup into `language.json` with a German column and nothing else - English fell
 * out of the key, there was no language setting (#119, PR #130), no interpolation and no plural
 * (#28, #29). This is the same idea with all three.
 *
 * A missing translation is never an error: the chain is the requested language, then English, then
 * German, then the key itself, and interpolation happens either way. A half-translated UI is
 * usable, a UI that throws on a missing string is not.
 */

import {MESSAGES, type MessageCatalogue, type MessageEntry} from './messages.js';
import type {Language} from '../data/types.js';

/** The plural categories German and English need. */
export type PluralCategory = 'one' | 'other';

/** Values for the `{placeholders}` of a message. */
export type MessageParams = Readonly<Record<string, string | number>>;

/**
 * The plural category of a count. German and English agree: exactly one is `one`, everything else
 * (including zero) is `other`. Turkish has no plural agreement with a number at all, so the
 * Turkish fallback locale (D-15) always uses `other`.
 */
export function pluralCategory(language: Language, count: number): PluralCategory {
    if (language === 'tr') {
        return 'other';
    }
    return count === 1 ? 'one' : 'other';
}

/** Replaces `{name}` with the value; a placeholder without a value is left as it is. */
export function interpolate(template: string, params: MessageParams): string {
    return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
        const value = params[name];
        return value === undefined ? placeholder : String(value);
    });
}

export interface TranslatorOptions {
    /** Defaults to the built-in {@link MESSAGES}. */
    readonly catalogue?: MessageCatalogue;
    /**
     * Languages to try after the requested one. `['en', 'de']` by default: English is the key
     * language, German is where the 2.x strings came from and therefore the most complete.
     */
    readonly fallbacks?: readonly Language[];
}

/** The default fallback chain. */
export const DEFAULT_FALLBACKS: readonly Language[] = ['en', 'de'];

/** Translates message keys into one language. Immutable; make a new one to switch languages. */
export class Translator {
    readonly language: Language;
    readonly #catalogue: MessageCatalogue;
    readonly #chain: Language[];

    constructor(language: Language, options: TranslatorOptions = {}) {
        this.language = language;
        this.#catalogue = options.catalogue ?? MESSAGES;
        const fallbacks = options.fallbacks ?? DEFAULT_FALLBACKS;
        this.#chain = [language, ...fallbacks.filter((candidate) => candidate !== language)];
    }

    /** Is there a text for this key in any language of the chain? */
    has(key: string): boolean {
        return this.#entry(key) !== undefined;
    }

    /**
     * The translated text.
     *
     * @param params values for the `{placeholders}`; `{count}` is filled from `count`.
     * @param count  selects the plural form and becomes the `{count}` placeholder.
     */
    t(key: string, params: MessageParams = {}, count?: number): string {
        const entry = this.#entry(key);
        const values = count === undefined ? params : {count, ...params};
        if (entry === undefined) {
            return interpolate(key, values);
        }
        const [text, language] = entry;
        if (typeof text === 'string') {
            return interpolate(text, values);
        }
        const category = pluralCategory(language, count ?? 0);
        return interpolate(text[category], values);
    }

    /** The first text for the key in the fallback chain, with the language it came from. */
    #entry(key: string): [MessageEntry, Language] | undefined {
        const message = Object.prototype.hasOwnProperty.call(this.#catalogue, key) ? this.#catalogue[key] : undefined;
        if (!message) {
            return undefined;
        }
        for (const language of this.#chain) {
            const text = message[language];
            if (text !== undefined) {
                return [text, language];
            }
        }
        return undefined;
    }
}

/** Shorthand for `new Translator(...)`. */
export function createTranslator(language: Language, options: TranslatorOptions = {}): Translator {
    return new Translator(language, options);
}
