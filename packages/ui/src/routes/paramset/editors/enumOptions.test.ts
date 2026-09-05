import type {OptionPreset, Paramset, ParamsetDescription, Translations} from '@homematic-manager/core';
import {fireEvent, screen, waitFor} from '@testing-library/svelte';
import {beforeEach, describe, expect, it} from 'vitest';

import {HM_TC_IT_WM_MASTER} from '../../../../test/fixtures/deviceDescriptions.js';
import {
    coveredParameters,
    detectDeviceEditors,
    EMPTY_CONTEXT,
    type EditorContext,
    type EnumOptionsSpec,
} from '../../../lib/util/editors/index.js';
import {DEMO_DATA_FILES} from '../../../lib/transport/demoData.js';
import {MockTransport} from '../../../lib/transport/MockTransport.js';
import {mountApp} from '../../../testHarness.js';

/**
 * The two ways an enum needs help. `DISPLAY_INFORMATION` is real: the description says
 * `TIME`/`DATE` and `data/dist` translates `DISPLAY_INFORMATION|0` and `|1`.
 */
const description: ParamsetDescription = {
    DISPLAY_INFORMATION: {TYPE: 'ENUM', OPERATIONS: 3, VALUE_LIST: ['TIME', 'DATE'], TAB_ORDER: 1},
    CHANNEL_OPERATION_MODE: {
        TYPE: 'ENUM',
        OPERATIONS: 3,
        VALUE_LIST: ['INACTIVE', 'ANY_MOTION', 'FLAT_DETECTION', 'TILT_DETECTION'],
        TAB_ORDER: 2,
    },
    LOGGING: {TYPE: 'ENUM', OPERATIONS: 3, VALUE_LIST: ['OFF', 'ON'], TAB_ORDER: 3},
};

const preset: OptionPreset = {
    id: '_INLINE_ACCELERATION_TRANSCEIVER_CHANNEL_OPERATION_MODE',
    allowCustom: false,
    presets: [
        {labelKey: 'anymotion', value: 1},
        {labelKey: 'flat', value: 2},
        {labelKey: 'tilt', value: 3},
    ],
};

const context: EditorContext = {
    // The index-keyed half of the string table: what `DISPLAY_INFORMATION|0` answers.
    optionByIndex: (param, index) => (param === 'DISPLAY_INFORMATION' ? ['Uhrzeit', 'Datum'][index] : undefined),
    // The name-keyed half: LOGGING is fully translated and needs no editor.
    optionByName: (param, name) => (param === 'LOGGING' ? {OFF: 'aus', ON: 'an'}[name] : undefined),
    preset: (param) => (param === 'CHANNEL_OPERATION_MODE' ? preset : undefined),
    uiLabel: (key) => ({anymotion: 'Bewegung', flat: 'flach', tilt: 'Neigung'})[key] ?? key,
};

const target = {
    interfaceName: 'BidCos-RF',
    address: 'MEQ0123456:1',
    channelType: 'ACCELERATION_TRANSCEIVER',
    paramset: 'MASTER',
    description,
};

function enumSpec(over: Partial<typeof target> = {}, ctx: EditorContext = context): EnumOptionsSpec {
    const spec = detectDeviceEditors({...target, ...over}, ctx).find((entry) => entry.kind === 'enum-options');
    if (!spec) {
        throw new Error('no enum editor for this description');
    }
    return spec;
}

describe('detecting the enums the description cannot render', () => {
    it('takes the index-keyed one and the one the metadata narrows, and leaves the rest alone', () => {
        const spec = enumSpec();
        expect(spec.fields.map((field) => field.param)).toEqual(['DISPLAY_INFORMATION', 'CHANNEL_OPERATION_MODE']);
        // LOGGING is translated by name; the generic row already draws it correctly.
        expect(coveredParameters([spec]).has('LOGGING')).toBe(false);
    });

    it('names the values out of the string table when the VALUE_LIST identifiers are not translated', () => {
        const field = enumSpec().fields[0];
        expect(field?.options).toEqual([
            {value: 0, label: 'Uhrzeit', raw: 'TIME', named: true},
            {value: 1, label: 'Datum', raw: 'DATE', named: true},
        ]);
        expect(field?.presetId).toBeUndefined();
    });

    it('offers the preset list where the metadata has one, with the raw identifier of each entry', () => {
        const field = enumSpec().fields[1];
        expect(field?.presetId).toBe('_INLINE_ACCELERATION_TRANSCEIVER_CHANNEL_OPERATION_MODE');
        expect(field?.options).toEqual([
            {value: 1, label: 'Bewegung', raw: 'ANY_MOTION', named: true},
            {value: 2, label: 'flach', raw: 'FLAT_DETECTION', named: true},
            {value: 3, label: 'Neigung', raw: 'TILT_DETECTION', named: true},
        ]);
    });

    it('recognises nothing at all without a string table - the generic rows keep every enum', () => {
        const specs = detectDeviceEditors(target, EMPTY_CONTEXT);
        expect(specs.some((spec) => spec.kind === 'enum-options')).toBe(false);
        expect(coveredParameters(specs).size).toBe(0);
    });

    it('leaves a preset alone that is not about enum indexes', () => {
        const seconds: OptionPreset = {id: 'DELAY', allowCustom: true, presets: [{label: '1.5 s', value: 1.5}]};
        const specs = detectDeviceEditors(target, {
            ...context,
            preset: (param) => (param === 'CHANNEL_OPERATION_MODE' ? seconds : undefined),
        });
        const spec = specs.find((entry) => entry.kind === 'enum-options');
        expect(spec?.fields.map((field) => field.param)).toEqual(['DISPLAY_INFORMATION']);
    });

    it('finds DISPLAY_INFORMATION in the real HM-TC-IT-WM-W-EU description', () => {
        const spec = enumSpec({description: HM_TC_IT_WM_MASTER, channelType: ''});
        expect(spec.fields.map((field) => field.param)).toContain('DISPLAY_INFORMATION');
        // WEEK_PROGRAM_POINTER already names its values in the description and stays generic.
        expect(coveredParameters([spec]).has('WEEK_PROGRAM_POINTER')).toBe(false);
    });

    it('marks a read-only enum so the select is drawn but cannot be changed', () => {
        const readOnly: ParamsetDescription = {
            ...description,
            DISPLAY_INFORMATION: {TYPE: 'ENUM', OPERATIONS: 1, VALUE_LIST: ['TIME', 'DATE']},
        };
        expect(enumSpec({description: readOnly}).fields[0]?.writable).toBe(false);
    });
});

describe('the named options in the dialog', () => {
    let transport: MockTransport;

    const values: Paramset = {DISPLAY_INFORMATION: 0, WEEK_PROGRAM_POINTER: 0, SHOW_HUMIDITY: true};

    beforeEach(() => {
        transport = new MockTransport({demo: true});
        // The demo string table plus the two index-keyed entries `data/dist` really has for
        // DISPLAY_INFORMATION - the whole reason this editor exists.
        transport.respond('data.file', (path) => {
            const file = DEMO_DATA_FILES[path];
            if (path !== 'data/translations/de.json') {
                return file;
            }
            const translations = file as Translations;
            return {
                ...translations,
                parameterValues: {
                    ...translations.parameterValues,
                    'DISPLAY_INFORMATION|0': 'Uhrzeit',
                    'DISPLAY_INFORMATION|1': 'Datum',
                },
            };
        });
        transport.result('paramset.description', {
            DISPLAY_INFORMATION: HM_TC_IT_WM_MASTER['DISPLAY_INFORMATION'] ?? {TYPE: 'ENUM', OPERATIONS: 3},
            WEEK_PROGRAM_POINTER: HM_TC_IT_WM_MASTER['WEEK_PROGRAM_POINTER'] ?? {TYPE: 'ENUM', OPERATIONS: 3},
            SHOW_HUMIDITY: HM_TC_IT_WM_MASTER['SHOW_HUMIDITY'] ?? {TYPE: 'BOOL', OPERATIONS: 3},
        });
        transport.result('paramset.get', values);
    });

    async function open(): Promise<void> {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await fireEvent.click(screen.getByTestId('paramset-MEQ0123456-MASTER'));
        await waitFor(() => {
            expect(screen.getByTestId('editor-enum-options')).toBeTruthy();
        });
    }

    it('shows the names the string table has, and the raw identifier next to them', async () => {
        await open();
        const select = screen.getByTestId('enum-DISPLAY_INFORMATION-select') as HTMLSelectElement;
        expect([...select.options].map((option) => option.textContent?.trim())).toEqual(['Uhrzeit', 'Datum']);
        expect(screen.getByTestId('enum-DISPLAY_INFORMATION-raw').textContent).toContain('TIME (0)');
        // The row it took over is gone from the generic list, the ones it did not take are not.
        expect(screen.queryByTestId('param-DISPLAY_INFORMATION')).toBeNull();
        expect(screen.getByTestId('param-SHOW_HUMIDITY')).toBeTruthy();
    });

    it('writes the index the CCU wants, through the generic preview', async () => {
        await open();
        await fireEvent.change(screen.getByTestId('enum-DISPLAY_INFORMATION-select'), {target: {value: '1'}});
        await fireEvent.click(screen.getByTestId('paramset-preview'));
        await fireEvent.click(screen.getByTestId('write-confirm'));

        await waitFor(() => {
            expect(transport.lastCall('paramset.put')?.[3]).toEqual({DISPLAY_INFORMATION: 1});
        });
    });

    it('puts the raw row back when the box is ticked', async () => {
        await open();
        await fireEvent.click(screen.getByTestId('paramset-show-covered'));
        await waitFor(() => {
            expect(screen.getByTestId('param-DISPLAY_INFORMATION')).toBeTruthy();
        });
    });
});
