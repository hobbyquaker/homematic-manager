import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {LinkTemplateStore, MAX_TEMPLATE_NAME, normaliseTemplate} from './linkTemplates.js';

let dir: string;
let file: string;

const IDENTITY = 'BidCos-RF/HM-LC-Sw1-Pl/2.8/1/SWITCH/LINK|BidCos-RF/HM-PB-2-WM/2.4/1/KEY/LINK';

beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-templates-'));
    file = path.join(dir, 'link-templates.json');
});

afterEach(async () => {
    await fs.rm(dir, {recursive: true, force: true});
});

function store(): LinkTemplateStore {
    return new LinkTemplateStore({file, now: () => 1000});
}

describe('normaliseTemplate', () => {
    it('keeps a template and drops what is not one', () => {
        expect(normaliseTemplate({name: ' Dim ', identity: IDENTITY, receiver: {ON_TIME: 5}}, 7)).toEqual({
            name: 'Dim',
            identity: IDENTITY,
            receiver: {ON_TIME: 5},
            createdAt: 7,
        });
        expect(normaliseTemplate({name: '', identity: IDENTITY, receiver: {A: 1}}, 7)).toBeUndefined();
        expect(normaliseTemplate({name: 'x', identity: '', receiver: {A: 1}}, 7)).toBeUndefined();
        // a template with no values at all is not worth saving and would apply nothing
        expect(normaliseTemplate({name: 'x', identity: IDENTITY, receiver: {}}, 7)).toBeUndefined();
        expect(
            normaliseTemplate({name: 'x'.repeat(MAX_TEMPLATE_NAME + 1), identity: IDENTITY, receiver: {A: 1}}, 7),
        ).toBeUndefined();
        expect(normaliseTemplate(undefined, 7)).toBeUndefined();
    });

    it('drops values that are not scalars, because putParamset cannot send them', () => {
        expect(
            normaliseTemplate(
                {name: 'x', identity: IDENTITY, receiver: {GOOD: 1, ALSO: 'yes', BAD: {nested: true}, NOPE: [1]}},
                7,
            )?.receiver,
        ).toEqual({GOOD: 1, ALSO: 'yes'});
    });
});

describe('LinkTemplateStore', () => {
    it('saves, lists newest first, filters by identity and persists to the profile directory', async () => {
        const first = store();
        await first.load();
        await first.save({name: 'Short press', identity: IDENTITY, receiver: {ON_TIME: 5}, createdAt: 10});
        await first.save({name: 'Long press', identity: IDENTITY, receiver: {ON_TIME: 60}, createdAt: 20});
        await first.save({name: 'Other pair', identity: 'other', receiver: {ON_TIME: 1}, createdAt: 30});

        expect(first.list().map((entry) => entry.name)).toEqual(['Other pair', 'Long press', 'Short press']);
        expect(first.list(IDENTITY).map((entry) => entry.name)).toEqual(['Long press', 'Short press']);

        // it is a file in the profile directory, not in a per-CCU cache: it moves with the profile
        expect(JSON.parse(await fs.readFile(file, 'utf8'))).toHaveLength(3);

        const second = store();
        await second.load();
        expect(second.list(IDENTITY)).toHaveLength(2);
    });

    it('replaces a template of the same name instead of collecting duplicates', async () => {
        const templates = store();
        await templates.load();
        await templates.save({name: 'Dim', identity: IDENTITY, receiver: {ON_TIME: 5}});
        await templates.save({name: 'Dim', identity: IDENTITY, receiver: {ON_TIME: 9}});
        expect(templates.list()).toHaveLength(1);
        expect(templates.list()[0]?.receiver).toEqual({ON_TIME: 9});
    });

    it('keeps the profile it was saved from, and the sender side when there is one', async () => {
        const templates = store();
        await templates.load();
        await templates.save({
            name: 'Dim',
            identity: IDENTITY,
            profileId: 4,
            profileName: 'Dimmer',
            receiver: {ON_TIME: 5},
            sender: {LONG_PRESS_TIME: 0.4},
        });
        expect(templates.list()[0]).toMatchObject({
            profileId: 4,
            profileName: 'Dimmer',
            sender: {LONG_PRESS_TIME: 0.4},
        });
    });

    it('refuses a template that is not one, and removes by name', async () => {
        const templates = store();
        await templates.load();
        await expect(templates.save({name: '', identity: IDENTITY, receiver: {A: 1}})).rejects.toThrow(/needs a name/);
        await templates.save({name: 'Dim', identity: IDENTITY, receiver: {A: 1}});
        expect(await templates.remove('nope')).toHaveLength(1);
        expect(await templates.remove('Dim')).toEqual([]);
    });

    it('survives a file that is not a list of templates', async () => {
        await fs.writeFile(file, '{"nope": true}');
        const templates = store();
        await templates.load();
        expect(templates.list()).toEqual([]);

        await fs.writeFile(file, JSON.stringify([{name: 'ok', identity: IDENTITY, receiver: {A: 1}}, 42, null]));
        const second = store();
        await second.load();
        expect(second.list().map((entry) => entry.name)).toEqual(['ok']);
    });
});
