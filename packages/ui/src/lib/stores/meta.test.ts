import {describe, expect, it} from 'vitest';

import {MockTransport} from '../transport/MockTransport.js';

import {TransportDataSource} from './dataSource.js';
import {MetaStore} from './MetaStore.svelte.js';

describe('TransportDataSource', () => {
    it('reads every file of the contract under the `data` prefix', async () => {
        const transport = new MockTransport({demo: true});
        const source = new TransportDataSource(transport);

        expect(await source.manifest()).toMatchObject({languages: ['de', 'en']});
        expect(await source.masterMetadata()).toHaveProperty('SWITCH');
        expect(await source.optionPresets()).toHaveProperty('duration');
        expect(await source.crossValidations()).toHaveLength(1);
        expect((await source.translations('de'))?.channelTypes['SWITCH']).toBe('Schaltaktor');
        expect(await source.receiverTypeAliases()).toEqual({});
        expect(await source.deviceIcons()).toEqual({});
        expect((await source.receiverProfiles('SWITCH_VIRTUAL_RECEIVER'))?.receiverType).toBe(
            'SWITCH_VIRTUAL_RECEIVER',
        );

        expect(transport.calls.map((call) => call.params[0])).toContain('data/manifest.json');
    });

    it('asks for a file once, however often it is needed - dist/ is 9.2 MB', async () => {
        const transport = new MockTransport({demo: true});
        const source = new TransportDataSource(transport);

        await Promise.all([source.masterMetadata(), source.masterMetadata(), source.masterMetadata()]);
        expect(transport.countOf('data.file')).toBe(1);
        expect(source.requested).toEqual(['master-metadata.json']);
    });

    it('answers with the empty shape when the host serves no data root, and never rejects', async () => {
        const transport = new MockTransport();
        transport.fail('data.file', 'no readable roots');
        const source = new TransportDataSource(transport);

        expect(await source.manifest()).toBeUndefined();
        expect(await source.masterMetadata()).toEqual({});
        expect(await source.optionPresets()).toEqual({});
        expect(await source.crossValidations()).toEqual([]);
        expect(await source.receiverTypeAliases()).toEqual({});
        expect(await source.deviceIcons()).toEqual({});
        expect(await source.translations('de')).toBeUndefined();
        expect(await source.receiverProfiles('SWITCH')).toBeUndefined();
    });
});

describe('MetaStore', () => {
    it('loads the language with en and de behind it, so a missing string falls back (#119)', async () => {
        const transport = new MockTransport({demo: true});
        const meta = new MetaStore(transport);

        await meta.setLanguage('de');
        expect(meta.available).toBe(true);
        expect(meta.lookup.languages).toEqual(['de', 'en']);
        expect(meta.parameterLabel('LOGGING')).toBe('Statusmeldungen');
        // Only the English file has this one; German falls back to it rather than to the key.
        expect(meta.channelTypeLabel('SWITCH')).toBe('Schaltaktor');
        expect(meta.uiLabel('not_used')).toBe('nicht benutzt');
        expect(meta.manifest?.languages).toEqual(['de', 'en']);
    });

    it('does not reload when the language is set to what it already is', async () => {
        const transport = new MockTransport({demo: true});
        const meta = new MetaStore(transport);

        await meta.setLanguage('en');
        const before = transport.countOf('data.file');
        await meta.setLanguage('en');
        expect(transport.countOf('data.file')).toBe(before);
        expect(meta.lookup.languages).toEqual(['en', 'de']);
    });

    it('falls back to the CCU identifiers when there is no data at all', async () => {
        const transport = new MockTransport();
        transport.fail('data.file', 'no readable roots');
        const meta = new MetaStore(transport);

        await meta.setLanguage('de');
        expect(meta.available).toBe(false);
        expect(meta.parameterLabel('LOGGING')).toBe('LOGGING');
        expect(meta.valueLabel('LOGGING', 'ON')).toBe('ON');
        expect(meta.parameterHelp('LOGGING')).toBeUndefined();
        expect(meta.deviceModelLabel('HM-LC-Sw1')).toBe('HM-LC-Sw1');
        expect(await meta.profilesFor('SWITCH_VIRTUAL_RECEIVER', 'KEY')).toHaveLength(1);
    });

    it('serves the easy-mode profiles and the link metadata of the data set', async () => {
        const transport = new MockTransport({demo: true});
        const meta = new MetaStore(transport);

        const profiles = await meta.profilesFor('SWITCH_VIRTUAL_RECEIVER', 'KEY_TRANSCEIVER');
        expect(profiles.map((profile) => profile.key)).toEqual(['expert', 'switch_on', 'staircase']);

        const metadata = await meta.linkMetadataFor('SWITCH_VIRTUAL_RECEIVER', 'KEY_TRANSCEIVER');
        expect(metadata?.parameterOrder).toEqual(['SHORT_ACTION_TYPE', 'SHORT_ON_LEVEL', 'SHORT_ON_TIME']);
    });

    it('builds the MASTER view with order, visibility and the failing rules', async () => {
        const transport = new MockTransport({demo: true});
        const meta = new MetaStore(transport);

        const view = await meta.masterView(
            'SWITCH',
            {
                LOGGING: {TYPE: 'ENUM', OPERATIONS: 3, VALUE_LIST: ['OFF', 'ON']},
                TRANSMIT_TRY_MAX: {TYPE: 'INTEGER', OPERATIONS: 3, MIN: 1, MAX: 10},
                STATUSINFO_MINDELAY: {TYPE: 'INTEGER', OPERATIONS: 3, MIN: 0, MAX: 15},
            },
            {LOGGING: 0, TRANSMIT_TRY_MAX: 2, STATUSINFO_MINDELAY: 9},
        );

        expect(view.parameters.map((parameter) => parameter.name)).toEqual([
            'TRANSMIT_TRY_MAX',
            'LOGGING',
            'STATUSINFO_MINDELAY',
        ]);
        expect(view.parameters.at(-1)?.visible).toBe(false);
        expect(view.problems.map((problem) => problem.id)).toEqual(['onTime']);
    });
});
