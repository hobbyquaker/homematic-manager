import {describe, expect, it} from 'vitest';

import type {LinkProfile} from '../data/types.js';
import type {ParamsetDescription} from '../paramset/description.js';

import {easyForm, easyFormParams} from './form.js';

const description: ParamsetDescription = {
    SHORT_ON_TIME_BASE: {TYPE: 'ENUM', OPERATIONS: 3, VALUE_LIST: ['BASE_100_MS', 'BASE_1_S']},
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
        expect(form).toEqual([
            {
                kind: 'time',
                pair: {name: 'SHORT_ON', baseParam: 'SHORT_ON_TIME_BASE', factorParam: 'SHORT_ON_TIME_FACTOR'},
                selector: 'timeOnOff',
                label: {de: 'Einschaltdauer'},
            },
            {kind: 'param', param: 'SHORT_ON_LEVEL', also: ['LONG_ON_LEVEL'], option: 'DIM_ONLEVEL'},
            {kind: 'subset', subsets: [1, 2]},
        ]);
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
