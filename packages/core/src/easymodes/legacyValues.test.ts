import {readFileSync} from 'node:fs';

import {describe, expect, it} from 'vitest';

import type {ReceiverProfiles} from '../data/types.js';
import {MemoryDataSource} from '../data/memory.js';
import type {ParamsetDescription} from '../paramset/description.js';
import type {Paramset} from '../rpc/values.js';
import {EasyModeEngine} from './engine.js';
import {LEGACY_PROFILE_VALUES, withLegacyValues} from './legacyValues.js';

const profilesDir = new URL('../../../../data/dist/profiles/', import.meta.url);
const shipped = (folder: string): ReceiverProfiles =>
    JSON.parse(readFileSync(new URL(`${folder}.json`, profilesDir), 'utf8')) as ReceiverProfiles;

const engine = new EasyModeEngine(
    new MemoryDataSource({
        profiles: {
            SHUTTER_VIRTUAL_RECEIVER: shipped('SHUTTER_VIRTUAL_RECEIVER'),
            BLIND_VIRTUAL_RECEIVER: shipped('BLIND_VIRTUAL_RECEIVER'),
        },
    }),
);

/** What a profile writes on a description holding every parameter it names. */
async function written(folder: string, sender: string, id: number): Promise<Paramset> {
    const profile = (await engine.profilesFor(folder, sender)).find((entry) => entry.id === id);
    if (!profile) throw new Error(`${folder}/${sender} has no profile ${String(id)}`);
    const description = Object.fromEntries(
        Object.keys(profile.params).map((name) => [name, {TYPE: 'INTEGER', MIN: 0, MAX: 255, DEFAULT: 0}]),
    ) as unknown as ParamsetDescription;
    return engine.applyProfile(profile, {}, description, {keepCurrent: false}).values;
}

describe('B-98: links made by the WebUI before June 2026', () => {
    it('names only files and profiles the shipped data has, each with the current value 1', () => {
        for (const [folder, senders] of Object.entries(LEGACY_PROFILE_VALUES)) {
            const data = shipped(folder);
            for (const [sender, table] of Object.entries(senders)) {
                const profiles = data.senders[sender];
                expect(profiles, `${folder}/${sender}`).toBeDefined();
                for (const id of Object.keys(table)) {
                    const constraint = profiles?.find((entry) => entry.id === Number(id))?.params[
                        'LONG_PROFILE_ACTION_TYPE'
                    ];
                    // the data follows the current WebUI; a data update that brings the old values back
                    // makes this table obsolete
                    expect(constraint, `${folder}/${sender} profile ${id}`).toEqual({kind: 'fixed', value: 1});
                }
            }
        }
    });

    it.each([
        ['SHUTTER_VIRTUAL_RECEIVER', 'MULTI_MODE_INPUT_TRANSMITTER_1', 1, 1],
        ['SHUTTER_VIRTUAL_RECEIVER', 'MULTI_MODE_INPUT_TRANSMITTER_1', 2, 2],
        ['SHUTTER_VIRTUAL_RECEIVER', 'KEY_TRANSCEIVER', 4, 4],
        ['SHUTTER_VIRTUAL_RECEIVER', 'MULTI_MODE_INPUT_TRANSMITTER_3', 3, 3],
        ['BLIND_VIRTUAL_RECEIVER', 'KEY_TRANSCEIVER', 3, 3],
        // the current WebUI shows an old "auf / zu & hoch / herunter" as "Toggle": same presets, and
        // Toggle takes 5 - nothing to recognise from the older WebUI there
        ['SHUTTER_VIRTUAL_RECEIVER', 'KEY_TRANSCEIVER', 3, 5],
        ['SHUTTER_VIRTUAL_RECEIVER', 'MULTI_MODE_INPUT_TRANSMITTER_1', 3, 5],
    ])(
        'a %s/%s profile %i link with the older long press (5) shows as profile %i',
        async (folder, sender, id, shown) => {
            const profiles = await engine.profilesFor(folder, sender);
            const current = await written(folder, sender, id);
            expect(current['LONG_PROFILE_ACTION_TYPE']).toBe(1);
            expect(engine.detectProfile(current, profiles)?.id).toBe(id);
            expect(engine.detectProfile({...current, LONG_PROFILE_ACTION_TYPE: 5}, profiles)?.id).toBe(shown);
        },
    );

    it('takes the older values only where nothing fits as the data has it', async () => {
        const profiles = await engine.profilesFor('SHUTTER_VIRTUAL_RECEIVER', 'KEY_TRANSCEIVER');
        expect(profiles.find((profile) => profile.id === 3)?.legacy).toEqual({LONG_PROFILE_ACTION_TYPE: [5]});
        expect(profiles.find((profile) => profile.id === 5)?.legacy).toBeUndefined();
        // the data itself is untouched: profile 3 still fixes the current value
        expect(profiles.find((profile) => profile.id === 3)?.params['LONG_PROFILE_ACTION_TYPE']).toEqual({
            kind: 'fixed',
            value: 1,
        });
    });

    it('keeps the old value on a link that holds it and writes the current one otherwise', async () => {
        const profile = (await engine.profilesFor('SHUTTER_VIRTUAL_RECEIVER', 'KEY_TRANSCEIVER')).find(
            (entry) => entry.id === 3,
        );
        if (!profile) throw new Error('no profile 3');
        const description = {
            LONG_PROFILE_ACTION_TYPE: {TYPE: 'INTEGER', MIN: 0, MAX: 6, DEFAULT: 5},
        } as unknown as ParamsetDescription;
        expect(engine.applyProfile(profile, {LONG_PROFILE_ACTION_TYPE: 5}, description).values).toMatchObject({
            LONG_PROFILE_ACTION_TYPE: 5,
        });
        expect(engine.applyProfile(profile, {LONG_PROFILE_ACTION_TYPE: 2}, description).values).toMatchObject({
            LONG_PROFILE_ACTION_TYPE: 1,
        });
    });

    it('leaves every other folder, file and profile as the data has it', () => {
        const data = shipped('SHUTTER_VIRTUAL_RECEIVER');
        const toggle = data.senders['KEY_TRANSCEIVER'] ?? [];
        expect(withLegacyValues('SHUTTER_VIRTUAL_RECEIVER', 'KEY_TRANSCEIVER', toggle).find((p) => p.id === 5)).toBe(
            toggle.find((p) => p.id === 5),
        );
        expect(withLegacyValues('DIMMER_VIRTUAL_RECEIVER', 'KEY_TRANSCEIVER', toggle)).toEqual(toggle);
    });
});
