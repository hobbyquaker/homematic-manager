import {describe, expect, it} from 'vitest';

import type {LinkProfile} from '../data/types.js';
import type {ParamsetDescription} from '../paramset/description.js';

import {easyForm, easyFormOf, easyFormParams} from './form.js';

const description: ParamsetDescription = {
    SHORT_ON_TIME_BASE: {
        TYPE: 'ENUM',
        OPERATIONS: 3,
        VALUE_LIST: [
            'BASE_100_MS',
            'BASE_1_S',
            'BASE_5_S',
            'BASE_10_S',
            'BASE_1_M',
            'BASE_5_M',
            'BASE_10_M',
            'BASE_1_H',
        ],
    },
    EVENT_DELAY_UNIT: {TYPE: 'ENUM', OPERATIONS: 3, VALUE_LIST: ['S', 'M', 'H']},
    EVENT_DELAY_VALUE: {TYPE: 'INTEGER', OPERATIONS: 3, MIN: 0, MAX: 15},
    SHORT_ON_TIME_FACTOR: {TYPE: 'INTEGER', OPERATIONS: 3, MIN: 0, MAX: 31},
    SHORT_ON_LEVEL: {TYPE: 'FLOAT', OPERATIONS: 3, MIN: 0, MAX: 1},
    LONG_ON_LEVEL: {TYPE: 'FLOAT', OPERATIONS: 3, MIN: 0, MAX: 1},
    SHORT_CT_ON: {TYPE: 'INTEGER', OPERATIONS: 3, MIN: 0, MAX: 5},
};

const profile: LinkProfile = {
    id: 1,
    key: 'dimmer_on',
    name: {en: 'on'},
    description: {},
    params: {},
    controls: [
        {kind: 'time', prefix: 'SHORT_ON_TIME', selector: 'timeOnOff', label: {de: 'Einschaltdauer'}},
        {kind: 'time', prefix: 'SHORT_RAMPON_TIME', selector: 'rampOnOff'},
        {kind: 'param', param: 'SHORT_ON_LEVEL', also: ['LONG_ON_LEVEL', 'SHORT_ON_MIN_LEVEL'], option: 'DIM_ONLEVEL'},
        {kind: 'param', param: 'SHORT_OPTICAL_SIGNAL_COLOR'},
        {kind: 'param', param: 'SHORT_ON_LEVEL', requires: ['SHORT_PROFILE_REPETITIONS']},
        {kind: 'subset', subsets: [1, 2]},
    ],
};

describe('easyForm (task 62)', () => {
    const form = easyForm(profile, description);

    it('keeps what the device has, in the WebUI order', () => {
        expect(form?.[0]).toMatchObject({
            kind: 'time',
            pair: {kind: 'base-factor', unitParam: 'SHORT_ON_TIME_BASE', countParam: 'SHORT_ON_TIME_FACTOR'},
            selector: 'timeOnOff',
            label: {de: 'Einschaltdauer'},
        });
        expect(form?.slice(1)).toEqual([
            {kind: 'param', param: 'SHORT_ON_LEVEL', also: ['LONG_ON_LEVEL'], option: 'DIM_ONLEVEL'},
            {kind: 'subset', subsets: [1, 2]},
        ]);
    });

    it('finds an HmIP MASTER unit/value pair by its prefix too (task 63)', () => {
        const master = easyFormOf([{kind: 'time', prefix: 'EVENT_DELAY', selector: 'delayShort'}], description);
        expect(master?.[0]).toMatchObject({
            kind: 'time',
            selector: 'delayShort',
            pair: {kind: 'unit-value', unitParam: 'EVENT_DELAY_UNIT', countParam: 'EVENT_DELAY_VALUE', maxCount: 15},
        });
        expect(easyFormOf(undefined, description)).toBeUndefined();
    });

    // B-73 (#168): the WebUI's BLIND_VIRTUAL_RECEIVER form takes one of three branches by the
    // channel's `channelMode` metadata; the extract is the union of them, so the same control is
    // listed up to three times. A form draws each control once - the first branch's occurrence -
    // or Svelte's keyed each throws `each_key_duplicate` on the second.
    it("draws a control listed by several branches once, with the first branch's label", () => {
        const blind: ParamsetDescription = {
            LOGIC_COMBINATION: {TYPE: 'ENUM', OPERATIONS: 3, VALUE_LIST: ['OR', 'AND']},
            LOGIC_COMBINATION_2: {TYPE: 'ENUM', OPERATIONS: 3, VALUE_LIST: ['OR', 'AND']},
            POSITION_SAVE_TIME: {TYPE: 'FLOAT', OPERATIONS: 3, MIN: 0, MAX: 25.5},
            EVENT_DELAY_UNIT: {TYPE: 'ENUM', OPERATIONS: 3, VALUE_LIST: ['S', 'M', 'H']},
            EVENT_DELAY_VALUE: {TYPE: 'INTEGER', OPERATIONS: 3, MIN: 0, MAX: 15},
        };
        const form = easyFormOf(
            [
                {kind: 'time', prefix: 'EVENT_DELAY', selector: 'eventDelay', label: {de: 'Eventverzögerung'}},
                {kind: 'param', param: 'LOGIC_COMBINATION', option: 'LOGIC_COMBINATION', label: {de: 'Jalousie'}},
                {kind: 'param', param: 'LOGIC_COMBINATION_2', option: 'LOGIC_COMBINATION', label: {de: 'Lamellen'}},
                {kind: 'param', param: 'POSITION_SAVE_TIME'},
                {kind: 'subset', subsets: [1, 2]},
                // the shutter branch
                {kind: 'param', param: 'LOGIC_COMBINATION', option: 'LOGIC_COMBINATION', label: {de: 'Rollladen'}},
                {kind: 'param', param: 'POSITION_SAVE_TIME'},
                {kind: 'time', prefix: 'EVENT_DELAY', selector: 'eventDelay'},
                {kind: 'subset', subsets: [1, 2]},
                // a different subset choice is a control of its own
                {kind: 'subset', subsets: [3]},
            ],
            blind,
        );
        const names = form?.map((control) =>
            control.kind === 'time' ? control.pair.name : control.kind === 'param' ? control.param : control.subsets,
        );
        expect(names).toEqual([
            'EVENT_DELAY',
            'LOGIC_COMBINATION',
            'LOGIC_COMBINATION_2',
            'POSITION_SAVE_TIME',
            [1, 2],
            [3],
        ]);
        expect(form?.[1]).toMatchObject({label: {de: 'Jalousie'}});
    });

    it('is undefined without controls, for no profile, and when nothing applies', () => {
        expect(easyForm({id: 1, key: 'plain', name: {}, description: {}, params: {}}, description)).toBeUndefined();
        expect(easyForm(undefined, description)).toBeUndefined();
        expect(easyForm({...profile, controls: [{kind: 'param', param: 'NOPE'}]}, description)).toBeUndefined();
    });

    it('names every parameter the form edits, subsets through their members', () => {
        const params = easyFormParams(form, [
            {id: 1, key: 'a', optionValue: 1, params: ['SHORT_CT_ON'], values: {SHORT_CT_ON: 0}},
            {id: 3, key: 'c', optionValue: 3, params: ['SHORT_CT_OFF'], values: {SHORT_CT_OFF: 0}},
        ]);
        expect([...params].sort()).toEqual([
            'LONG_ON_LEVEL',
            'SHORT_CT_ON',
            'SHORT_ON_LEVEL',
            'SHORT_ON_TIME_BASE',
            'SHORT_ON_TIME_FACTOR',
        ]);
        expect(easyFormParams(undefined).size).toBe(0);
    });
});
