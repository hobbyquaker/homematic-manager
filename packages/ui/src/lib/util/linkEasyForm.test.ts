import type {ParamsetDescription, TimeSelectorOption} from '@homematic-manager/core';
import {describe, expect, it} from 'vitest';

import {
    formatSeconds,
    localizedText,
    presetIndex,
    subsetChoices,
    subsetIndex,
    subsetValues,
    timeOptionIndex,
    timeOptionLabel,
    timeOptionValues,
} from './linkEasyForm.js';

const pair = {name: 'SHORT_ON', baseParam: 'SHORT_ON_TIME_BASE', factorParam: 'SHORT_ON_TIME_FACTOR'};
const options: TimeSelectorOption[] = [
    {special: 'notActive', label: {de: 'Nicht aktiv'}},
    {seconds: 1},
    {seconds: 60, label: {de: '1 Minute', en: '1 min'}},
    {special: 'permanent'},
    {special: 'enterValue'},
];

describe('the time selector (task 62)', () => {
    it('finds the option of the stored pair, and "enter value" for anything else', () => {
        expect(timeOptionIndex(options, {SHORT_ON_TIME_BASE: 0, SHORT_ON_TIME_FACTOR: 0}, pair)).toBe(0);
        expect(timeOptionIndex(options, {SHORT_ON_TIME_BASE: 1, SHORT_ON_TIME_FACTOR: 1}, pair)).toBe(1);
        // 60 s as BASE_5_S x 12 or as BASE_1_M x 1: the same preset
        expect(timeOptionIndex(options, {SHORT_ON_TIME_BASE: 2, SHORT_ON_TIME_FACTOR: 12}, pair)).toBe(2);
        expect(timeOptionIndex(options, {SHORT_ON_TIME_BASE: 'BASE_1_M', SHORT_ON_TIME_FACTOR: 1}, pair)).toBe(2);
        expect(timeOptionIndex(options, {SHORT_ON_TIME_BASE: 7, SHORT_ON_TIME_FACTOR: 31}, pair)).toBe(3);
        expect(timeOptionIndex(options, {SHORT_ON_TIME_BASE: 1, SHORT_ON_TIME_FACTOR: 7}, pair)).toBe(4);
        expect(timeOptionIndex(options, {}, pair)).toBe(-1);
    });

    it('writes base index and factor for a preset, nothing for "enter value"', () => {
        expect(timeOptionValues({seconds: 60}, pair)).toEqual({SHORT_ON_TIME_BASE: 2, SHORT_ON_TIME_FACTOR: 12});
        expect(timeOptionValues({special: 'notActive'}, pair)).toEqual({
            SHORT_ON_TIME_BASE: 0,
            SHORT_ON_TIME_FACTOR: 0,
        });
        expect(timeOptionValues({special: 'permanent'}, pair)).toEqual({
            SHORT_ON_TIME_BASE: 7,
            SHORT_ON_TIME_FACTOR: 31,
        });
        expect(timeOptionValues({special: 'enterValue'}, pair)).toBeUndefined();
    });

    it('labels an option with the WebUI text, a formatted duration, or the app string', () => {
        const t = (key: string): string => `t:${key}`;
        expect(timeOptionLabel(options[2]!, 'en', t)).toBe('1 min');
        expect(timeOptionLabel(options[1]!, 'de', t)).toBe('1 s');
        expect(timeOptionLabel(options[3]!, 'de', t)).toBe('t:Permanent');
        expect(formatSeconds(0.5)).toBe('500 ms');
        expect(formatSeconds(90)).toBe('1.5 min');
        expect(formatSeconds(7200)).toBe('2 h');
        expect(localizedText({de: 'nur deutsch'}, 'tr')).toBe('nur deutsch');
        expect(localizedText(null, 'de')).toBeUndefined();
    });
});

describe('the subset choice (task 62)', () => {
    const description: ParamsetDescription = {
        SHORT_CT_ON: {TYPE: 'INTEGER', OPERATIONS: 3},
        SHORT_CT_OFF: {TYPE: 'INTEGER', OPERATIONS: 3},
    };
    const subsets = [
        {id: 1, key: 'motion', optionValue: 1, params: ['SHORT_CT_ON'], values: {SHORT_CT_ON: 0, SHORT_CT_OFF: 0}},
        {
            id: 2,
            key: 'rest',
            optionValue: 2,
            params: ['SHORT_CT_ON'],
            values: {SHORT_CT_ON: 2, SHORT_CT_OFF: '2', LONG_X: 1},
        },
    ];

    it('offers the subsets in the control order and finds the one the values follow', () => {
        const choices = subsetChoices([2, 1, 9], subsets);
        expect(choices.map((subset) => subset.id)).toEqual([2, 1]);
        expect(subsetIndex(choices, {SHORT_CT_ON: 2, SHORT_CT_OFF: 2}, description)).toBe(0);
        expect(subsetIndex(choices, {SHORT_CT_ON: 0, SHORT_CT_OFF: 0}, description)).toBe(1);
        expect(subsetIndex(choices, {SHORT_CT_ON: 1, SHORT_CT_OFF: 0}, description)).toBe(-1);
    });

    it('writes a subset only for the parameters the device has', () => {
        expect(subsetValues(subsets[1]!, description)).toEqual({SHORT_CT_ON: 2, SHORT_CT_OFF: '2'});
    });
});

describe('the preset combo box (task 62)', () => {
    const preset = {
        id: 'DIM_ONLEVEL',
        allowCustom: true,
        presets: [
            {label: '10%', value: 0.1},
            {label: '100%', value: 1},
            {labelKey: 'lastvalue', value: 1.005},
        ],
    };

    it('finds the preset of the stored value, and none for a free value', () => {
        expect(presetIndex(preset, 1)).toBe(1);
        expect(presetIndex(preset, '1.0')).toBe(1);
        expect(presetIndex(preset, 1.005)).toBe(2);
        expect(presetIndex(preset, 0.35)).toBe(-1);
        expect(presetIndex(preset, undefined)).toBe(-1);
    });
});
