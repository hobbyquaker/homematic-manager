import {describe, expect, it} from 'vitest';

import {createI18n, LANGUAGE_LABELS, UI_LANGUAGES} from './i18n.svelte.js';
import {CATALOGUE, UI_MESSAGES} from './uiMessages.js';

describe('I18n', () => {
    it('translates the 2.x tab labels through core’s catalogue', () => {
        const i18n = createI18n('de');
        expect(i18n.t('Devices')).toBe('Geräte');
        expect(i18n.t('Links')).toBe('Verknüpfungen');
        expect(i18n.t('RSSI')).toBe('Funk');
        expect(i18n.t('RPC Console')).toBe('RPC Konsole');
        expect(i18n.t('Service messages')).toBe('Servicemeldungen');
        expect(i18n.t('Events')).toBe('Ereignisse');
    });

    it('translates the shell’s own keys', () => {
        const i18n = createI18n('de');
        expect(i18n.t('RPC log')).toBe('RPC-Protokoll');
        expect(i18n.t('Theme')).toBe('Design');
    });

    it('re-translates when the language changes', () => {
        const i18n = createI18n('de');
        expect(i18n.t('Devices')).toBe('Geräte');
        i18n.language = 'en';
        expect(i18n.language).toBe('en');
        expect(i18n.t('Devices')).toBe('Devices');
    });

    it('interpolates and pluralises', () => {
        const i18n = createI18n('en');
        expect(i18n.t('{count} devices', {}, 1)).toBe('1 device');
        expect(i18n.t('{count} devices', {}, 7)).toBe('7 devices');
        expect(i18n.t('Connected to {host}', {host: 'ccu3'})).toBe('Connected to ccu3');
    });

    it('falls back to the key for a text nobody translated', () => {
        const i18n = createI18n('de');
        expect(i18n.has('Devices')).toBe(true);
        expect(i18n.has('this key does not exist')).toBe(false);
        expect(i18n.t('this key does not exist')).toBe('this key does not exist');
    });

    it('offers exactly the two languages the UI has', () => {
        expect(UI_LANGUAGES).toEqual(['de', 'en']);
        expect(LANGUAGE_LABELS.de).toBe('Deutsch');
        expect(LANGUAGE_LABELS.en).toBe('English');
    });
});

describe('CATALOGUE', () => {
    it('has a German and an English text for every UI key', () => {
        for (const [key, entry] of Object.entries(UI_MESSAGES)) {
            expect(entry.de, `${key} has no German text`).toBeDefined();
            expect(entry.en, `${key} has no English text`).toBeDefined();
        }
    });

    it('merges core’s catalogue with the UI’s', () => {
        expect(CATALOGUE['Devices']).toBeDefined();
        expect(CATALOGUE['RPC log']).toBeDefined();
    });
});
