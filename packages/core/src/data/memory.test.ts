import {readFileSync} from 'node:fs';

import {describe, expect, it} from 'vitest';

import {MemoryDataSource, type MemoryData} from './memory.js';

const fixture = JSON.parse(
    readFileSync(new URL('../../test/fixtures/data.json', import.meta.url), 'utf8'),
) as MemoryData;

describe('MemoryDataSource with data', () => {
    const source = new MemoryDataSource(fixture);

    it('serves the manifest', async () => {
        await expect(source.manifest()).resolves.toMatchObject({languages: ['de', 'en']});
    });

    it('serves profiles per receiver type', async () => {
        const profiles = await source.receiverProfiles('SWITCH');
        expect(profiles?.receiverType).toBe('SWITCH');
        expect(profiles?.senders['KEY']).toHaveLength(5);
    });

    it('has no profiles for a receiver type it does not know', async () => {
        await expect(source.receiverProfiles('NOPE')).resolves.toBeUndefined();
    });

    it('serves aliases, metadata, presets and rules', async () => {
        await expect(source.receiverTypeAliases()).resolves.toMatchObject({SWITCH_VIRTUAL_RECEIVER: 'SWITCH'});
        expect(Object.keys(await source.masterMetadata())).toEqual(['SWITCH', 'KEY']);
        expect(Object.keys(await source.optionPresets())).toEqual(['DELAY']);
        expect(await source.crossValidations()).toHaveLength(4);
    });

    it('serves translations per language', async () => {
        await expect(source.translations('de')).resolves.toMatchObject({language: 'de'});
        await expect(source.translations('tr')).resolves.toBeUndefined();
    });

    it('serves device icons', async () => {
        await expect(source.deviceIcons()).resolves.toMatchObject({'HM-LC-Sw1-Pl-CT-R1': 'hm-lc-sw1-pl-ct-r1.png'});
    });

    it('hands out copies, so a caller cannot corrupt the data', async () => {
        const presets = await source.optionPresets();
        delete presets['DELAY'];
        expect(Object.keys(await source.optionPresets())).toEqual(['DELAY']);

        const rules = await source.crossValidations();
        rules.length = 0;
        expect(await source.crossValidations()).toHaveLength(4);
    });
});

describe('MemoryDataSource without data', () => {
    const empty = new MemoryDataSource();

    it('answers everything with nothing, never with an error', async () => {
        await expect(empty.manifest()).resolves.toBeUndefined();
        await expect(empty.receiverProfiles('SWITCH')).resolves.toBeUndefined();
        await expect(empty.receiverTypeAliases()).resolves.toEqual({});
        await expect(empty.masterMetadata()).resolves.toEqual({});
        await expect(empty.optionPresets()).resolves.toEqual({});
        await expect(empty.crossValidations()).resolves.toEqual([]);
        await expect(empty.translations('de')).resolves.toBeUndefined();
        await expect(empty.deviceIcons()).resolves.toEqual({});
    });
});
