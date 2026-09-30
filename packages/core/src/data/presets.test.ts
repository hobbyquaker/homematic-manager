import {readFileSync} from 'node:fs';

import {describe, expect, it} from 'vitest';

import {TranslationLookup} from '../i18n/lookup.js';
import {presetLabel} from './presets.js';
import type {OptionPreset, Translations} from './types.js';

const dist = (file: string): unknown =>
    JSON.parse(readFileSync(new URL(`../../../../data/dist/${file}`, import.meta.url), 'utf8'));
const presets = dist('option-presets.json') as Record<string, OptionPreset>;
const de = dist('translations/de.json') as Translations;
const en = dist('translations/en.json') as Translations;

/** Every label of a preset in one language, the way the easy view and the MASTER form list them. */
function labels(id: string, lookup: TranslationLookup): string[] {
    return (presets[id]?.presets ?? []).map((entry) => presetLabel(entry, (key) => lookup.uiLabel(key)));
}

describe('presetLabel (B-82)', () => {
    it('fills every ${key} from the WebUI labels and keeps the rest', () => {
        const uiLabel = (key: string): string => ({after: 'nach', none: 'keine'})[key] ?? key;
        expect(presetLabel({template: '${after} 1min'}, uiLabel)).toBe('nach 1min');
        expect(presetLabel({template: '${none}'}, uiLabel)).toBe('keine');
        expect(presetLabel({template: '10%'}, uiLabel)).toBe('10%');
        expect(presetLabel({template: '${unknownKey}'}, uiLabel)).toBe('unknownKey');
        // openccu-data's unresolved keys stay the text they are
        expect(presetLabel({template: '${motionDetectorOptionMotion_$operationMode}'}, uiLabel)).toBe(
            '${motionDetectorOptionMotion_$operationMode}',
        );
    });

    it("renders the Keymatic's DOOR_LOCK_TIME as the WebUI does, in German and English", () => {
        expect(labels('DOOR_LOCK_TIME', new TranslationLookup(de, en))).toEqual([
            'nach 1min',
            'nach 3min',
            'nach 5min',
            'nach 10min',
            'nach 15min',
            'nach 1h',
            'Inaktiv',
        ]);
        expect(labels('DOOR_LOCK_TIME', new TranslationLookup(en))).toEqual([
            'after 1min',
            'after 3min',
            'after 5min',
            'after 10min',
            'after 15min',
            'after 1h',
            'Inactive',
        ]);
    });

    it('lists no text twice in any preset, in either language', () => {
        for (const lookup of [new TranslationLookup(de, en), new TranslationLookup(en)]) {
            for (const id of Object.keys(presets)) {
                const list = labels(id, lookup);
                expect(new Set(list).size, `${id}: ${list.join(' | ')}`).toBe(list.length);
            }
        }
    });

    it('names the three current-detection behaviours apart, from the WebUI stringtable', () => {
        expect(labels('CURRENTDETECTION_BEHAVIOR', new TranslationLookup(de))).toEqual([
            'Wechselschaltung',
            'Ausgang 1 aktiv',
            'Ausgang 2 aktiv',
        ]);
        expect(labels('CURRENTDETECTION_BEHAVIOR', new TranslationLookup(en))).toEqual([
            'Two-way circuit',
            'Output 1 active',
            'Output 2 active',
        ]);
    });

    it("keeps options.tcl's time bases, not DELAY's values mixed in", () => {
        expect(labels('TIMEBASE_LONG', new TranslationLookup(en))).toEqual([
            '100mS',
            '1s',
            '5s',
            '10s',
            '1min',
            '5min',
            '10min',
            '1h',
        ]);
        expect(labels('TIMEBASE_LONG_WITH_DAY', new TranslationLookup(en))).toEqual([
            '1s',
            '5s',
            '10s',
            '1min',
            '5min',
            '10min',
            '1h',
            '1d',
        ]);
    });
});
