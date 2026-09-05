import {describe, expect, it} from 'vitest';

import {DATA_FILES} from './types.js';

describe('DATA_FILES', () => {
    it('names the files the pipeline writes and every DataSource reads', () => {
        expect(DATA_FILES.manifest).toBe('manifest.json');
        expect(DATA_FILES.receiverTypeAliases).toBe('receiver-type-aliases.json');
        expect(DATA_FILES.masterMetadata).toBe('master-metadata.json');
        expect(DATA_FILES.optionPresets).toBe('option-presets.json');
        expect(DATA_FILES.crossValidations).toBe('cross-validations.json');
        expect(DATA_FILES.deviceIcons).toBe('device-icons.json');
    });

    it('builds the per-receiver and per-language paths', () => {
        expect(DATA_FILES.profiles('DIMMER_VIRTUAL_RECEIVER')).toBe('profiles/DIMMER_VIRTUAL_RECEIVER.json');
        expect(DATA_FILES.translations('de')).toBe('translations/de.json');
    });
});
