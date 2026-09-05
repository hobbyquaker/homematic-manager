import {readFileSync} from 'node:fs';

import {describe, expect, it} from 'vitest';

import {EasyModeEngine, EXPERT_PROFILE_ID, resolveAlias, UI_HINT} from './engine.js';
import {MemoryDataSource, type MemoryData} from '../data/memory.js';
import type {LinkProfile, ReceiverProfiles} from '../data/types.js';
import type {ParamsetDescription} from '../paramset/description.js';

const fixture = JSON.parse(
    readFileSync(new URL('../../test/fixtures/data.json', import.meta.url), 'utf8'),
) as MemoryData;

const engine = new EasyModeEngine(new MemoryDataSource(fixture));
const emptyEngine = new EasyModeEngine(new MemoryDataSource());

/** A LINK description that has the parameters the SWITCH profiles constrain. */
const switchLink: ParamsetDescription = {
    UI_HINT: {TYPE: 'STRING', OPERATIONS: 3, TAB_ORDER: 0},
    SHORT_ACTION_TYPE: {TYPE: 'ENUM', OPERATIONS: 3, MIN: 0, MAX: 3, VALUE_LIST: ['INACTIVE', 'JUMP_TO_TARGET']},
    SHORT_JT_ON: {TYPE: 'INTEGER', OPERATIONS: 3, MIN: 0, MAX: 5},
    SHORT_ON_TIME: {TYPE: 'FLOAT', OPERATIONS: 3, MIN: 0, MAX: 108000},
    SHORT_OFF_TIME: {TYPE: 'FLOAT', OPERATIONS: 3, MIN: 0, MAX: 108000},
    SHORT_MULTIEXECUTE: {TYPE: 'BOOL', OPERATIONS: 3},
};

async function profile(key: string): Promise<LinkProfile> {
    const profiles = await engine.profilesFor('SWITCH', 'KEY');
    const found = profiles.find((candidate) => candidate.key === key);
    if (!found) {
        throw new Error(`fixture has no profile ${key}`);
    }
    return found;
}

describe('resolveAlias', () => {
    it('follows a chain of aliases', () => {
        const aliases = {A: 'B', B: 'C'};
        expect(resolveAlias('A', aliases)).toBe('C');
        expect(resolveAlias('B', aliases)).toBe('C');
    });

    it('leaves a type that has no alias alone', () => {
        expect(resolveAlias('SWITCH', {A: 'B'})).toBe('SWITCH');
    });

    it('does not hang on a cycle', () => {
        expect(resolveAlias('LOOP_A', {LOOP_A: 'LOOP_B', LOOP_B: 'LOOP_A'})).toBe('LOOP_B');
    });
});

describe('profilesFor', () => {
    it('lists the profiles of a receiver type, expert first', async () => {
        const profiles = await engine.profilesFor('SWITCH', 'KEY');
        expect(profiles.map((entry) => entry.key)).toEqual([
            'expert',
            'switch_on',
            'switch_off',
            'light_stairway',
            'not_on_this_firmware',
        ]);
        expect(profiles[0]?.id).toBe(EXPERT_PROFILE_ID);
    });

    it('follows the alias chain of an HmIP receiver type', async () => {
        const profiles = await engine.profilesFor('OPTICAL_SIGNAL_RECEIVER', 'KEY');
        expect(profiles.map((entry) => entry.key)).toEqual(['expert', 'dimmer_on_brighter']);
    });

    it('adds the expert profile where the data has none', async () => {
        const profiles = await engine.profilesFor('DIMMER', 'KEY');
        expect(profiles[0]).toMatchObject({id: 0, key: 'expert'});
        expect(profiles[0]?.name.de).toBe('Experte');
    });

    it('offers the expert profile alone for a receiver type nobody has data for', async () => {
        await expect(engine.profilesFor('NOPE', 'KEY')).resolves.toEqual([expect.objectContaining({key: 'expert'})]);
        await expect(emptyEngine.profilesFor('SWITCH', 'KEY')).resolves.toHaveLength(1);
    });

    it('offers the expert profile alone for a sender type the receiver has no profiles for', async () => {
        await expect(engine.profilesFor('SWITCH', 'MOTION_DETECTOR')).resolves.toHaveLength(1);
    });
});

describe('linkMetadataFor', () => {
    it('serves the link-side display order, presets and subsets of a sender type', async () => {
        const metadata = await engine.linkMetadataFor('SWITCH', 'KEY');
        expect(metadata?.parameterOrder).toEqual(['SHORT_ON_TIME', 'SHORT_OFF_TIME']);
        expect(metadata?.optionPresets).toEqual({SHORT_ON_TIME: 'DELAY'});
        expect(metadata?.subsets?.[0]).toMatchObject({key: 'subset_1', optionValue: 1});
    });

    it('follows aliases like profilesFor does', async () => {
        await expect(engine.linkMetadataFor('SWITCH_VIRTUAL_RECEIVER', 'KEY')).resolves.toBeDefined();
    });

    it('has nothing for an unknown sender type, receiver type or data set', async () => {
        await expect(engine.linkMetadataFor('SWITCH', 'NOPE')).resolves.toBeUndefined();
        await expect(engine.linkMetadataFor('DIMMER', 'KEY')).resolves.toBeUndefined();
        await expect(emptyEngine.linkMetadataFor('SWITCH', 'KEY')).resolves.toBeUndefined();
    });
});

describe('applyProfile', () => {
    it('writes the fixed values and keeps everything else', async () => {
        const current = {SHORT_ACTION_TYPE: 0, SHORT_JT_ON: 0, SHORT_ON_TIME: 5, UNRELATED: 42};
        const {values, problems} = engine.applyProfile(await profile('switch_on'), current, switchLink);
        expect(values).toMatchObject({SHORT_ACTION_TYPE: 1, SHORT_JT_ON: 3, UNRELATED: 42});
        expect(problems).toEqual([]);
    });

    it('sets UI_HINT to the profile id so the WebUI recognises the profile', async () => {
        const {values} = engine.applyProfile(await profile('light_stairway'), {}, switchLink);
        expect(values[UI_HINT]).toBe('4');
    });

    it('leaves UI_HINT alone where the description has none (HmIP)', async () => {
        const noHint = {...switchLink};
        delete (noHint as Record<string, unknown>)['UI_HINT'];
        const {values} = engine.applyProfile(await profile('switch_on'), {}, noHint);
        expect(UI_HINT in values).toBe(false);
    });

    it('keeps a range value that is already inside the range', async () => {
        const {values} = engine.applyProfile(await profile('switch_on'), {SHORT_ON_TIME: 30}, switchLink);
        expect(values['SHORT_ON_TIME']).toBe(30);
    });

    it('takes the range default when the current value is outside it, missing or not a number', async () => {
        const stairway = await profile('switch_on');
        expect(engine.applyProfile(stairway, {SHORT_ON_TIME: 999999}, switchLink).values['SHORT_ON_TIME']).toBe(111600);
        expect(engine.applyProfile(stairway, {}, switchLink).values['SHORT_ON_TIME']).toBe(111600);
        expect(engine.applyProfile(stairway, {SHORT_ON_TIME: 'x'}, switchLink).values['SHORT_ON_TIME']).toBe(111600);
    });

    it('falls back to the range minimum when there is no default', () => {
        const noDefault: LinkProfile = {
            id: 7,
            key: 'no_default',
            name: {},
            description: {},
            params: {SHORT_ON_TIME: {kind: 'range', min: 3, max: 9}},
        };
        expect(engine.applyProfile(noDefault, {}, switchLink).values['SHORT_ON_TIME']).toBe(3);
    });

    it('keeps a list value that is in the list and takes the default otherwise', async () => {
        const stairway = await profile('light_stairway');
        expect(engine.applyProfile(stairway, {SHORT_ON_TIME: 30}, switchLink).values['SHORT_ON_TIME']).toBe(30);
        expect(engine.applyProfile(stairway, {SHORT_ON_TIME: 7}, switchLink).values['SHORT_ON_TIME']).toBe(60);
    });

    it('takes the first list entry when the list has no default', () => {
        const noDefault: LinkProfile = {
            id: 8,
            key: 'no_default',
            name: {},
            description: {},
            params: {SHORT_ON_TIME: {kind: 'list', values: [11, 22]}},
        };
        expect(engine.applyProfile(noDefault, {}, switchLink).values['SHORT_ON_TIME']).toBe(11);
    });

    it('reports a parameter the firmware does not have instead of writing it', async () => {
        const {values, problems} = engine.applyProfile(await profile('not_on_this_firmware'), {}, switchLink);
        expect(values['SHORT_NOT_A_PARAM']).toBeUndefined();
        expect(problems).toContainEqual(
            expect.objectContaining({param: 'SHORT_NOT_A_PARAM', code: 'unknown-parameter'}),
        );
    });

    it('reports a list constraint with no values at all', async () => {
        const {problems} = engine.applyProfile(
            await profile('not_on_this_firmware'),
            {},
            {
                ...switchLink,
                SHORT_EMPTY_LIST: {TYPE: 'INTEGER', OPERATIONS: 3},
            },
        );
        expect(problems).toContainEqual(expect.objectContaining({param: 'SHORT_EMPTY_LIST', code: 'empty-list'}));
    });

    it('writes a boolean fixed value', async () => {
        const {values} = engine.applyProfile(await profile('light_stairway'), {}, switchLink);
        expect(values['SHORT_MULTIEXECUTE']).toBe(true);
    });
});

describe('detectProfile', () => {
    it('trusts UI_HINT', async () => {
        const profiles = await engine.profilesFor('SWITCH', 'KEY');
        expect(engine.detectProfile({UI_HINT: '2'}, profiles)?.key).toBe('switch_off');
        expect(engine.detectProfile({UI_HINT: '0'}, profiles)?.key).toBe('expert');
    });

    it('falls back to matching when UI_HINT is empty, missing or unknown', async () => {
        const profiles = await engine.profilesFor('SWITCH', 'KEY');
        const stairway = {SHORT_ACTION_TYPE: 1, SHORT_JT_ON: 3, SHORT_MULTIEXECUTE: true};
        expect(engine.detectProfile({...stairway, UI_HINT: ''}, profiles)?.key).toBe('light_stairway');
        expect(engine.detectProfile(stairway, profiles)?.key).toBe('light_stairway');
        expect(engine.detectProfile({...stairway, UI_HINT: '99'}, profiles)?.key).toBe('light_stairway');
    });

    it('prefers the profile that matches the most fixed parameters', async () => {
        const profiles = await engine.profilesFor('SWITCH', 'KEY');
        // switch_on matches two fixed parameters, light_stairway three
        expect(engine.detectProfile({SHORT_ACTION_TYPE: 1, SHORT_JT_ON: 3}, profiles)?.key).toBe('switch_on');
    });

    it('compares loosely, because profile data is text and the CCU sends numbers', async () => {
        const profiles = await engine.profilesFor('SWITCH', 'KEY');
        expect(engine.detectProfile({SHORT_ACTION_TYPE: 1, SHORT_JT_ON: 4}, profiles)?.key).toBe('switch_off');
    });

    it('keeps the better match when a weaker one comes later in the list', async () => {
        const profiles = await engine.profilesFor('SWITCH', 'KEY');
        const stairway = profiles.find((entry) => entry.key === 'light_stairway');
        const on = profiles.find((entry) => entry.key === 'switch_on');
        if (!stairway || !on) {
            throw new Error('fixture changed');
        }
        const values = {SHORT_ACTION_TYPE: 1, SHORT_JT_ON: 3, SHORT_MULTIEXECUTE: true};
        expect(engine.detectProfile(values, [stairway, on])?.key).toBe('light_stairway');
        expect(engine.detectProfile(values, [on, stairway])?.key).toBe('light_stairway');
    });

    it('compares a boolean fixed value against the number the CCU sends', () => {
        const flag: LinkProfile = {
            id: 5,
            key: 'flag',
            name: {},
            description: {},
            params: {SHORT_MULTIEXECUTE: {kind: 'fixed', value: true}},
        };
        expect(engine.detectProfile({SHORT_MULTIEXECUTE: 1}, [flag])?.key).toBe('flag');
        expect(engine.detectProfile({SHORT_MULTIEXECUTE: 0}, [flag])).toBeUndefined();
    });

    it('compares enum names as strings', () => {
        const named: LinkProfile = {
            id: 6,
            key: 'named',
            name: {},
            description: {},
            params: {SHORT_ACTION_TYPE: {kind: 'fixed', value: 'JUMP_TO_TARGET'}},
        };
        expect(engine.detectProfile({SHORT_ACTION_TYPE: 'JUMP_TO_TARGET'}, [named])?.key).toBe('named');
        expect(engine.detectProfile({SHORT_ACTION_TYPE: 'INACTIVE'}, [named])).toBeUndefined();
    });

    it('finds nothing when no profile matches', async () => {
        const profiles = await engine.profilesFor('SWITCH', 'KEY');
        expect(engine.detectProfile({SHORT_ACTION_TYPE: 3}, profiles)).toBeUndefined();
        expect(engine.detectProfile({}, profiles)).toBeUndefined();
    });

    it('never picks the expert profile by matching, because it constrains nothing', async () => {
        expect(engine.detectProfile({}, await engine.profilesFor('DIMMER', 'KEY'))).toBeUndefined();
    });
});

describe('masterMetadataFor', () => {
    const switchMaster: ParamsetDescription = {
        AES_ACTIVE: {TYPE: 'BOOL', OPERATIONS: 3, TAB_ORDER: 4},
        POWERUP_ACTION: {TYPE: 'ENUM', OPERATIONS: 3, TAB_ORDER: 1, VALUE_LIST: ['POWERUP_OFF', 'POWERUP_ON']},
        STATUSINFO_MINDELAY: {TYPE: 'FLOAT', OPERATIONS: 3, TAB_ORDER: 2},
        STATUSINFO_RANDOM: {TYPE: 'FLOAT', OPERATIONS: 3, TAB_ORDER: 3},
        TRANSMIT_TRY_MAX: {TYPE: 'INTEGER', OPERATIONS: 3, TAB_ORDER: 0},
    };

    it('puts the metadata order first and sorts the rest by TAB_ORDER', async () => {
        const view = await engine.masterMetadataFor('SWITCH', switchMaster, {});
        expect(view.parameters.map((parameter) => parameter.name)).toEqual([
            'POWERUP_ACTION',
            'STATUSINFO_MINDELAY',
            'STATUSINFO_RANDOM',
            'TRANSMIT_TRY_MAX',
            'AES_ACTIVE',
        ]);
    });

    it('falls back to TAB_ORDER alone for a channel type without an order', async () => {
        const view = await engine.masterMetadataFor('KEY', switchMaster, {});
        expect(view.parameters.map((parameter) => parameter.name)).toEqual([
            'TRANSMIT_TRY_MAX',
            'POWERUP_ACTION',
            'STATUSINFO_MINDELAY',
            'STATUSINFO_RANDOM',
            'AES_ACTIVE',
        ]);
    });

    it('works without any metadata at all', async () => {
        const view = await emptyEngine.masterMetadataFor('SWITCH', switchMaster, {});
        expect(view.parameters).toHaveLength(5);
        expect(view.parameters.every((parameter) => parameter.visible)).toBe(true);
        expect(view.problems).toEqual([]);
    });

    it('hides the parameters whose trigger does not have the right value', async () => {
        const off = await engine.masterMetadataFor('SWITCH', switchMaster, {POWERUP_ACTION: 0});
        expect(off.parameters.find((parameter) => parameter.name === 'STATUSINFO_MINDELAY')?.visible).toBe(false);
        expect(off.parameters.find((parameter) => parameter.name === 'AES_ACTIVE')?.visible).toBe(true);

        const on = await engine.masterMetadataFor('SWITCH', switchMaster, {POWERUP_ACTION: 1});
        expect(on.parameters.find((parameter) => parameter.name === 'STATUSINFO_MINDELAY')?.visible).toBe(true);
    });

    it('resolves the option preset a parameter names, and ignores one that does not exist', async () => {
        const view = await engine.masterMetadataFor('SWITCH', switchMaster, {});
        expect(view.parameters.find((parameter) => parameter.name === 'STATUSINFO_MINDELAY')?.preset?.id).toBe('DELAY');
        expect(view.parameters.find((parameter) => parameter.name === 'STATUSINFO_RANDOM')?.preset).toBeUndefined();
        expect(view.parameters.find((parameter) => parameter.name === 'AES_ACTIVE')?.preset).toBeUndefined();
    });

    it('evaluates a gte rule', async () => {
        const description: ParamsetDescription = {
            DIM_MAX_LEVEL: {TYPE: 'FLOAT', OPERATIONS: 3},
            DIM_MIN_LEVEL: {TYPE: 'FLOAT', OPERATIONS: 3},
        };
        const bad = await engine.masterMetadataFor('X', description, {DIM_MAX_LEVEL: 0.1, DIM_MIN_LEVEL: 0.5});
        expect(bad.problems).toEqual([
            {id: 'dim_levels', errorKey: 'err_dim_max_ge_min', params: ['DIM_MAX_LEVEL', 'DIM_MIN_LEVEL']},
        ]);
        const good = await engine.masterMetadataFor('X', description, {DIM_MAX_LEVEL: 0.9, DIM_MIN_LEVEL: 0.5});
        expect(good.problems).toEqual([]);
    });

    it('evaluates an lte rule', async () => {
        const description: ParamsetDescription = {
            STATUSINFO_MINDELAY: {TYPE: 'FLOAT', OPERATIONS: 3},
            STATUSINFO_RANDOM: {TYPE: 'FLOAT', OPERATIONS: 3},
        };
        const bad = await engine.masterMetadataFor('X', description, {STATUSINFO_MINDELAY: 9, STATUSINFO_RANDOM: 1});
        expect(bad.problems.map((problem) => problem.id)).toEqual(['statusinfo']);
        const good = await engine.masterMetadataFor('X', description, {STATUSINFO_MINDELAY: 1, STATUSINFO_RANDOM: 9});
        expect(good.problems).toEqual([]);
    });

    it('evaluates a between rule', async () => {
        const description: ParamsetDescription = {
            SHORT_ON_LEVEL: {TYPE: 'FLOAT', OPERATIONS: 3},
            DIM_MIN_LEVEL: {TYPE: 'FLOAT', OPERATIONS: 3},
            DIM_MAX_LEVEL: {TYPE: 'FLOAT', OPERATIONS: 3},
        };
        const values = {DIM_MIN_LEVEL: 0.2, DIM_MAX_LEVEL: 0.8};
        expect((await engine.masterMetadataFor('X', description, {...values, SHORT_ON_LEVEL: 0.5})).problems).toEqual(
            [],
        );
        expect(
            (await engine.masterMetadataFor('X', description, {...values, SHORT_ON_LEVEL: 0.1})).problems.map(
                (problem) => problem.id,
            ),
        ).toEqual(['onlevel']);
        expect(
            (await engine.masterMetadataFor('X', description, {...values, SHORT_ON_LEVEL: 0.9})).problems.map(
                (problem) => problem.id,
            ),
        ).toEqual(['onlevel']);
    });

    it('skips a rule whose parameters the description does not have', async () => {
        const view = await engine.masterMetadataFor('X', {DIM_MIN_LEVEL: {TYPE: 'FLOAT', OPERATIONS: 3}}, {});
        expect(view.problems).toEqual([]);
    });

    it('does not judge a rule whose values are missing or not numbers', async () => {
        const description: ParamsetDescription = {
            DIM_MAX_LEVEL: {TYPE: 'FLOAT', OPERATIONS: 3},
            DIM_MIN_LEVEL: {TYPE: 'FLOAT', OPERATIONS: 3},
        };
        expect((await engine.masterMetadataFor('X', description, {})).problems).toEqual([]);
        expect(
            (await engine.masterMetadataFor('X', description, {DIM_MAX_LEVEL: 'x', DIM_MIN_LEVEL: 1})).problems,
        ).toEqual([]);
    });

    it('does not judge a between rule whose values are missing', async () => {
        const description: ParamsetDescription = {
            SHORT_ON_LEVEL: {TYPE: 'FLOAT', OPERATIONS: 3},
            DIM_MIN_LEVEL: {TYPE: 'FLOAT', OPERATIONS: 3},
            DIM_MAX_LEVEL: {TYPE: 'FLOAT', OPERATIONS: 3},
        };
        expect((await engine.masterMetadataFor('X', description, {SHORT_ON_LEVEL: 0.5})).problems).toEqual([]);
    });
});

describe('against the data the pipeline actually produces (task 9)', () => {
    // read here rather than in the core: the core itself never touches the file system
    const real = JSON.parse(
        readFileSync(new URL('../../../../data/dist/profiles/SWITCH.json', import.meta.url), 'utf8'),
    ) as ReceiverProfiles;
    const realEngine = new EasyModeEngine(new MemoryDataSource({profiles: {SWITCH: real}}));

    it('reads a real profile file through the same DataSource contract', async () => {
        const profiles = await realEngine.profilesFor('SWITCH', 'KEY');
        expect(profiles[0]).toMatchObject({id: 0, key: 'expert'});
        expect(profiles.length).toBeGreaterThan(1);
        for (const entry of profiles) {
            expect(typeof entry.id).toBe('number');
            expect(entry.name.de).toBeTypeOf('string');
        }
    });

    it('detects a real profile from its own fixed parameters', async () => {
        const profiles = await realEngine.profilesFor('SWITCH', 'KEY');
        const switchOn = profiles.find((entry) => entry.key === 'switch_on');
        if (!switchOn) {
            throw new Error('the pipeline no longer ships a switch_on profile for SWITCH/KEY');
        }
        const description = Object.fromEntries(
            Object.keys(switchOn.params).map((name) => [name, {TYPE: 'INTEGER', OPERATIONS: 3}]),
        );
        const {values, problems} = realEngine.applyProfile(switchOn, {}, description);
        expect(problems).toEqual([]);
        expect(realEngine.detectProfile(values, profiles)?.key).toBe('switch_on');
    });
});
