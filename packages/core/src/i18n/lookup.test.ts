import {readFileSync} from 'node:fs';

import {describe, expect, it} from 'vitest';

import {TranslationLookup} from './lookup.js';
import type {MemoryData} from '../data/memory.js';
import type {Translations} from '../data/types.js';

const fixture = JSON.parse(
    readFileSync(new URL('../../test/fixtures/data.json', import.meta.url), 'utf8'),
) as MemoryData;

function translations(language: 'de' | 'en'): Translations {
    const found = fixture.translations?.[language];
    if (!found) {
        throw new Error(`fixture has no ${language} translations`);
    }
    return found;
}

const de = translations('de');
const en = translations('en');
const lookup = new TranslationLookup(de, en);

describe('TranslationLookup', () => {
    it('reports the languages it can answer in', () => {
        expect(lookup.languages).toEqual(['de', 'en']);
        expect(new TranslationLookup(undefined, en).languages).toEqual(['en']);
        expect(new TranslationLookup().languages).toEqual([]);
    });

    it('translates channel types and device models', () => {
        expect(lookup.channelType('SWITCH')).toBe('Schaltaktor');
        expect(lookup.deviceModel('HM-LC-Sw1-Pl-CT-R1')).toBe('Funk-Schaltaktor 1-fach');
    });

    it('falls back to the identifier itself', () => {
        expect(lookup.channelType('NOPE')).toBe('NOPE');
        expect(lookup.deviceModel('NOPE')).toBe('NOPE');
        expect(new TranslationLookup().channelType('SWITCH')).toBe('SWITCH');
    });

    it('falls back to the next language', () => {
        // the English fixture has no device models at all
        expect(new TranslationLookup(en, de).deviceModel('HM-LC-Sw1-Pl-CT-R1')).toBe('Funk-Schaltaktor 1-fach');
        expect(new TranslationLookup(en, de).channelType('KEY')).toBe('Taste');
    });
});

describe('parameter labels', () => {
    it('prefers the channel-type-specific entry, as dialogParamset did', () => {
        expect(lookup.parameter('POWERUP_ACTION', 'SWITCH')).toBe('Schaltzustand nach Spannungswiederkehr');
        expect(lookup.parameter('POWERUP_ACTION')).toBe('Verhalten nach Spannungswiederkehr');
    });

    it('falls back to the bare parameter name when the channel type has no entry', () => {
        expect(lookup.parameter('POWERUP_ACTION', 'KEY')).toBe('Verhalten nach Spannungswiederkehr');
        expect(lookup.parameter('STATUSINFO_MINDELAY', 'KEY')).toBe('Mindestsendeverzoegerung');
    });

    it('falls back to the parameter name itself', () => {
        expect(lookup.parameter('NOT_TRANSLATED', 'SWITCH')).toBe('NOT_TRANSLATED');
    });

    it('normalises a lower-case identifier to the CCU own upper-case keys', () => {
        expect(lookup.parameter('powerup_action', 'switch')).toBe('Schaltzustand nach Spannungswiederkehr');
    });
});

describe('parameter value labels', () => {
    it('tries CHANNEL|PARAM|VALUE, then PARAM|VALUE, then VALUE', () => {
        expect(lookup.parameterValue('POWERUP_ACTION', 'POWERUP_ON', 'SWITCH')).toBe('Kanal eingeschaltet');
        expect(lookup.parameterValue('POWERUP_ACTION', 'POWERUP_ON')).toBe('eingeschaltet');
        expect(lookup.parameterValue('POWERUP_ACTION', 'POWERUP_OFF')).toBe('ausgeschaltet');
        expect(lookup.parameterValue('POWERUP_ACTION', 'POWERUP_OFF', 'KEY')).toBe('ausgeschaltet');
    });

    it('falls back to the enum name itself', () => {
        expect(lookup.parameterValue('POWERUP_ACTION', 'SOMETHING_ELSE')).toBe('SOMETHING_ELSE');
    });
});

describe('parameter help', () => {
    it('prefers the channel-type-specific text', () => {
        expect(lookup.parameterHelp('POWERUP_ACTION', 'SWITCH')).toBe(
            'Zustand des Schaltaktors nach Spannungswiederkehr.',
        );
        expect(lookup.parameterHelp('POWERUP_ACTION')).toBe('Zustand nach Spannungswiederkehr.');
    });

    it('has no text rather than an invented one - a missing help is not an error', () => {
        expect(lookup.parameterHelp('STATUSINFO_MINDELAY')).toBeUndefined();
        expect(new TranslationLookup().parameterHelp('POWERUP_ACTION')).toBeUndefined();
    });
});

describe('UI labels', () => {
    it('takes the WebUI own lowercase keys, as the presets and rules use them', () => {
        expect(lookup.uiLabel('none')).toBe('keine');
        expect(lookup.uiLabel('err_dim_max_ge_min')).toBe('Max muss groesser als Min sein');
    });

    it('normalises the key to lower case', () => {
        expect(lookup.uiLabel('NONE')).toBe('keine');
    });

    it('falls back to the next language and then to the key', () => {
        expect(new TranslationLookup(en).uiLabel('none')).toBe('none');
        expect(lookup.uiLabel('nothing_here')).toBe('nothing_here');
    });

    it('treats an empty translation as missing', () => {
        const empty: Translations = {
            language: 'de',
            channelTypes: {SWITCH: ''},
            deviceModels: {},
            parameters: {POWERUP_ACTION: ''},
            parameterValues: {},
            parameterHelp: {},
            uiLabels: {none: ''},
        };
        const chain = new TranslationLookup(empty, en);
        expect(chain.channelType('SWITCH')).toBe('Switch actor');
        expect(chain.parameter('POWERUP_ACTION')).toBe('Behaviour after power up');
        expect(chain.uiLabel('none')).toBe('none');
    });
});

describe('against the translations the pipeline actually produces (task 9)', () => {
    // read here rather than in the core: the core itself never touches the file system
    const real = JSON.parse(
        readFileSync(new URL('../../../../data/dist/translations/de.json', import.meta.url), 'utf8'),
    ) as Translations;
    const realLookup = new TranslationLookup(real);

    it('reads the uppercase identifier keys of a real translation file', () => {
        expect(realLookup.channelType('SWITCH')).not.toBe('SWITCH');
        expect(realLookup.parameter('LEVEL', 'DIMMER')).not.toBe('LEVEL');
    });

    it('reads the lowercase uiLabels of a real translation file', () => {
        const key = Object.keys(real.uiLabels)[0];
        if (key === undefined) {
            throw new Error('the pipeline no longer ships uiLabels');
        }
        expect(realLookup.uiLabel(key)).toBe(real.uiLabels[key]);
    });
});
