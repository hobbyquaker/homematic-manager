/**
 * The `local` provider: the store in this profile.
 *
 * The semantics are the conformance corpus' and are tested there; what is left here is the part
 * that is this provider's own - the file, and what happens when it is missing or broken. A
 * taxonomy that a syntax error can take away silently would be worse than no taxonomy at all.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import type {MetaState} from '@homematic-manager/core';

import {LocalMetaProvider} from './localProvider.js';

let dir: string;
let file: string;
let changes: number;
let states: MetaState[];
let notices: string[];

function provider(): LocalMetaProvider {
    return new LocalMetaProvider({
        file,
        onChanged: () => {
            changes += 1;
        },
        onStateChanged: (state) => states.push(state),
        onNotice: (level, message) => notices.push(`${level}: ${message}`),
    });
}

beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-local-meta-'));
    file = path.join(dir, 'meta.json');
    changes = 0;
    states = [];
    notices = [];
});

afterEach(async () => {
    await fs.rm(dir, {recursive: true, force: true});
});

describe('the local metadata provider', () => {
    it('starts empty, with the three default taxonomies', async () => {
        const store = provider();
        await store.start();
        expect(store.state()).toMatchObject({provider: 'local', reachable: true, writable: true, revision: 0});
        expect(Object.keys(store.document().enums).sort()).toEqual(['floor', 'function', 'room']);
    });

    it('persists a name and a membership and reads them back in a new instance', async () => {
        const store = provider();
        await store.start();
        await store.createNode('room', null, 'eg', 'Erdgeschoss', {});
        await store.setNames([{ref: 'BidCos-RF.ABC0000001:1', name: 'Licht'}]);
        await store.setMembership([{ref: 'BidCos-RF.ABC0000001:1', paths: ['room/eg']}]);

        const second = provider();
        await second.start();
        expect(second.document().objects['BidCos-RF.ABC0000001:1']).toMatchObject({
            name: 'Licht',
            enums: ['room/eg'],
        });
        expect(second.state().revision).toBe(3);
    });

    it('tells the backend about every change, and not about a write that changed nothing', async () => {
        const store = provider();
        await store.start();
        const before = changes;
        await store.setNames([{ref: 'BidCos-RF.A:1', name: 'Licht'}]);
        expect(changes).toBe(before + 1);
        await store.setNames([{ref: 'BidCos-RF.A:1', name: 'Licht'}]);
        expect(changes).toBe(before + 1);
    });

    it('refuses a write the format refuses, with the code the API would answer', async () => {
        const store = provider();
        await store.start();
        await store.setNames([{ref: 'BidCos-RF.A:1', name: 'Licht'}]);
        await expect(store.setMembership([{ref: 'BidCos-RF.A:1', paths: ['room/nowhere']}])).rejects.toThrow(
            expect.objectContaining({code: 'unknown-path'}) as unknown,
        );
    });

    it('refuses a membership for an object that has no entry yet - it would have no name', async () => {
        // the store never invents objects; `MetaService.assign` is where a name is given first
        const store = provider();
        await store.start();
        await store.createNode('room', null, 'eg', 'Erdgeschoss', {});
        await expect(store.setMembership([{ref: 'BidCos-RF.B:1', paths: ['room/eg']}])).rejects.toThrow(
            expect.objectContaining({code: 'invalid-name'}) as unknown,
        );
    });

    it('reports a broken file and starts empty rather than failing every read afterwards', async () => {
        await fs.writeFile(file, '{"format": 9, "revision": 0, "objects": {}, "enums": {}}');
        const store = provider();
        await store.start();
        expect(store.state().revision).toBe(0);
        expect(notices.join('\n')).toContain('could not be read');
    });

    it('deletes a taxonomy with its members when it is told to detach them', async () => {
        const store = provider();
        await store.start();
        await store.createNode('room', null, 'eg', 'Erdgeschoss', {});
        await store.setNames([{ref: 'BidCos-RF.A:1', name: 'Licht'}]);
        await store.setMembership([{ref: 'BidCos-RF.A:1', paths: ['room/eg']}]);
        await expect(store.deleteEnum('room', false)).rejects.toThrow(
            expect.objectContaining({code: 'has-members'}) as unknown,
        );
        await store.deleteEnum('room', true);
        expect(store.document().objects['BidCos-RF.A:1']?.enums).toEqual([]);
    });
});
