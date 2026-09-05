import {readFileSync} from 'node:fs';

import {describe, expect, it} from 'vitest';

import {MESSAGE_KEYS, MESSAGES, type MessageCatalogue} from './messages.js';
import {createTranslator, DEFAULT_FALLBACKS, interpolate, pluralCategory, Translator} from './translate.js';

const legacy = JSON.parse(
    readFileSync(new URL('../../../../legacy/www/js/language.json', import.meta.url), 'utf8'),
) as Record<string, {de: string}>;

describe('the catalogue', () => {
    it('carries the 74 strings of the 2.x language.json, with their German text', () => {
        for (const [key, value] of Object.entries(legacy)) {
            expect(MESSAGES[key]?.de).toBe(value.de);
        }
        expect(Object.keys(legacy)).toHaveLength(74);
    });

    it('makes English explicit instead of letting it fall out of the key', () => {
        for (const key of Object.keys(legacy)) {
            expect(MESSAGES[key]?.en).toBe(key);
        }
    });

    it('has a German and an English text for every key', () => {
        for (const key of MESSAGE_KEYS) {
            expect(MESSAGES[key]?.de).toBeDefined();
            expect(MESSAGES[key]?.en).toBeDefined();
        }
    });
});

describe('pluralCategory', () => {
    it('separates exactly one from everything else in German and English', () => {
        expect(pluralCategory('de', 1)).toBe('one');
        expect(pluralCategory('en', 1)).toBe('one');
        expect(pluralCategory('de', 0)).toBe('other');
        expect(pluralCategory('en', 2)).toBe('other');
        expect(pluralCategory('de', -1)).toBe('other');
    });

    it('has no plural agreement in Turkish', () => {
        expect(pluralCategory('tr', 1)).toBe('other');
        expect(pluralCategory('tr', 5)).toBe('other');
    });
});

describe('interpolate', () => {
    it('fills placeholders', () => {
        expect(interpolate('Connected to {host}', {host: 'ccu'})).toBe('Connected to ccu');
        expect(interpolate('{a} and {b}', {a: 1, b: 2})).toBe('1 and 2');
    });

    it('leaves a placeholder without a value alone rather than printing undefined', () => {
        expect(interpolate('Connected to {host}', {})).toBe('Connected to {host}');
    });

    it('leaves text without placeholders alone', () => {
        expect(interpolate('Devices', {host: 'ccu'})).toBe('Devices');
    });
});

describe('Translator', () => {
    it('translates into German', () => {
        const t = createTranslator('de');
        expect(t.t('Devices')).toBe('Geräte');
        expect(t.t('Service messages')).toBe('Servicemeldungen');
        expect(t.language).toBe('de');
    });

    it('translates into English', () => {
        expect(createTranslator('en').t('Devices')).toBe('Devices');
    });

    it('falls back English first, then German', () => {
        const catalogue: MessageCatalogue = {
            'only en': {en: 'only en'},
            'only de': {de: 'nur de'},
            both: {de: 'beide', en: 'both'},
        };
        const tr = createTranslator('tr', {catalogue});
        expect(tr.t('only en')).toBe('only en');
        expect(tr.t('only de')).toBe('nur de');
        expect(tr.t('both')).toBe('both');
        expect(DEFAULT_FALLBACKS).toEqual(['en', 'de']);
    });

    it('takes a caller-supplied fallback chain', () => {
        const catalogue: MessageCatalogue = {x: {de: 'de', en: 'en'}};
        expect(createTranslator('tr', {catalogue, fallbacks: ['de', 'en']}).t('x')).toBe('de');
    });

    it('does not put the requested language into the chain twice', () => {
        const catalogue: MessageCatalogue = {x: {en: 'en'}};
        expect(createTranslator('en', {catalogue}).t('x')).toBe('en');
    });

    it('returns the key when nobody translated it', () => {
        const t = createTranslator('de', {catalogue: {}});
        expect(t.t('Never translated')).toBe('Never translated');
        expect(t.has('Never translated')).toBe(false);
    });

    it('returns the key when the entry exists but has no language of the chain', () => {
        const t = createTranslator('de', {catalogue: {x: {tr: 'sadece tr'}}, fallbacks: []});
        expect(t.has('x')).toBe(false);
        expect(t.t('x')).toBe('x');
    });

    it('interpolates an untranslated key too, so a placeholder never leaks', () => {
        const t = createTranslator('de', {catalogue: {}});
        expect(t.t('Hello {name}', {name: 'world'})).toBe('Hello world');
    });

    it('is not fooled by inherited object properties', () => {
        const t = createTranslator('de', {catalogue: {}});
        expect(t.has('toString')).toBe(false);
        expect(t.t('constructor')).toBe('constructor');
    });

    it('says which keys it knows', () => {
        const t = createTranslator('de');
        expect(t.has('Devices')).toBe(true);
    });

    it('interpolates a translated message', () => {
        expect(createTranslator('de').t('Connected to {host}', {host: 'ccu'})).toBe('Verbunden mit ccu');
    });

    it('picks the plural form and fills {count} from the count', () => {
        const de = createTranslator('de');
        expect(de.t('{count} channels', {}, 1)).toBe('1 Kanal');
        expect(de.t('{count} channels', {}, 3)).toBe('3 Kanäle');
        expect(de.t('{count} channels', {}, 0)).toBe('0 Kanäle');

        const en = createTranslator('en');
        expect(en.t('{count} channels', {}, 1)).toBe('1 channel');
        expect(en.t('{count} channels', {}, 2)).toBe('2 channels');
    });

    it('uses the plural rule of the language the text came from, not of the requested one', () => {
        // Turkish has no text, so the English one is used - and English plural rules with it
        const tr = createTranslator('tr');
        expect(tr.t('{count} channels', {}, 1)).toBe('1 channel');
    });

    it('lets an explicit param win over the count', () => {
        expect(createTranslator('en').t('{count} channels', {count: 'all'}, 5)).toBe('all channels');
    });

    it('treats a plural message without a count as "other"', () => {
        expect(createTranslator('en').t('{count} channels')).toBe('{count} channels');
    });

    it('can be constructed directly', () => {
        expect(new Translator('de').t('Devices')).toBe('Geräte');
    });
});
