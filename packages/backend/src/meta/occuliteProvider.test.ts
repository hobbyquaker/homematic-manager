/**
 * The `occulite` provider against occulite-client's fake system (task 72): the snapshot, the event
 * stream, the resync, the writes on the API's routes and the three ways it is allowed to fail.
 *
 * `FakeBox` is the package's own test double - one Node HTTP server with openccu-lite's metadata
 * routes, its change stream and its credential check - so what runs here is the real wire: the
 * package's transport, its writes, its SSE parser. The integration test in `test/occulite/` runs
 * the same provider against a real `occulited` and is the one that proves the protocol; this one
 * runs in CI, where there is no box, and proves the behaviour around it - that a change on the
 * stream reaches the backend, that a gap in the revisions is answered with a fresh snapshot rather
 * than with a store that has quietly drifted, that a refused credential leaves the application
 * running, and that the last snapshot survives a restart while the box is away.
 */

import fs from 'node:fs/promises';
import type {ServerResponse} from 'node:http';
import os from 'node:os';
import path from 'node:path';

import {FakeBox} from 'occulite-client/testing';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import type {MetaState} from '@homematic-manager/core';

import {OcculiteProvider} from './occuliteProvider.js';
import {SystemLink, systemTransport} from './system.js';

const TOKEN = 'olt_0123456789abcdef0123456789abcdef';
const WRONG = 'olt_ffffffffffffffffffffffffffffffff';

function snapshot(): {revision: number; objects: Record<string, unknown>; enums: Record<string, unknown>} {
    return {
        revision: 4,
        objects: {'BidCos-RF.A:1': {name: 'Licht', enums: ['room/eg'], meta: {}}},
        enums: {room: {name: {en: 'Rooms'}, tree: [{id: 'eg', name: 'Erdgeschoss'}]}},
    };
}

let dir: string;
let changes: number;
let states: MetaState[];
let notices: string[];
const boxes: FakeBox[] = [];

async function fakeBox(options: ConstructorParameters<typeof FakeBox>[0] = {}): Promise<FakeBox> {
    const box = new FakeBox({token: TOKEN, meta: snapshot(), ...options});
    await box.start();
    boxes.push(box);
    return box;
}

/** Ends the open change streams, as a box that restarts does (FakeBox has no call of its own for it). */
function dropMetaStreams(box: FakeBox): void {
    const streams = (box as unknown as {metaStreams: Set<ServerResponse>}).metaStreams;
    for (const response of streams) {
        response.end();
    }
    streams.clear();
}

function provider(box: FakeBox, options: {cacheFile?: string; read?: string; url?: string} = {}): OcculiteProvider {
    const read = options.read ?? TOKEN;
    return new OcculiteProvider({
        system: new SystemLink({
            baseUrl: options.url ?? box.url,
            transport: systemTransport(undefined),
            readCredential: () => ({token: read}),
            writeCredential: () => ({session: TOKEN}),
            timeoutMs: 2000,
        }),
        ...(options.cacheFile === undefined ? {} : {cacheFile: options.cacheFile}),
        implementation: 'occulited test',
        reconnectMinMs: 5,
        reconnectMaxMs: 20,
        onChanged: () => {
            changes += 1;
        },
        onStateChanged: (state) => states.push(state),
        onNotice: (level, message) => notices.push(`${level}: ${message}`),
    });
}

async function eventually(check: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
        if (Date.now() > deadline) {
            throw new Error(`timed out waiting for ${what}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-occulite-'));
    changes = 0;
    states = [];
    notices = [];
});

afterEach(async () => {
    await Promise.all(boxes.splice(0).map((box) => box.stop()));
    await fs.rm(dir, {recursive: true, force: true});
});

describe('the occulite provider', () => {
    it('loads the snapshot and reports what it found', async () => {
        const box = await fakeBox();
        const store = provider(box);
        await store.start();
        try {
            expect(store.document().revision).toBe(4);
            expect(store.state()).toMatchObject({
                provider: 'occulite',
                reachable: true,
                writable: true,
                objects: 1,
                implementation: 'occulited test',
                url: box.url,
            });
        } finally {
            await store.stop();
        }
    });

    it('follows a change on the event stream without asking for the snapshot again', async () => {
        const box = await fakeBox();
        const store = provider(box);
        await store.start();
        try {
            await eventually(() => box.metaStreamsOpened > 0, 'the event stream to be opened');
            const before = changes;
            box.metaEvent({
                revision: 5,
                kind: 'object.updated',
                ref: 'BidCos-RF.A:1',
                value: {name: 'Licht neu', enums: ['room/eg'], meta: {}},
            });
            await eventually(() => changes > before, 'the event to be applied');
            expect(store.document().objects['BidCos-RF.A:1']?.name).toBe('Licht neu');
            expect(store.document().revision).toBe(5);
        } finally {
            await store.stop();
        }
    });

    it('fetches the snapshot again when a revision is missed', async () => {
        const box = await fakeBox();
        const store = provider(box);
        await store.start();
        try {
            await eventually(() => box.metaStreamsOpened > 0, 'the event stream to be opened');
            box.opts.meta = {...snapshot(), revision: 9};
            // revision 4 -> 9: five revisions happened somewhere this consumer did not see
            box.metaEvent({
                revision: 9,
                kind: 'object.updated',
                ref: 'BidCos-RF.A:1',
                value: {name: 'x', enums: [], meta: {}},
            });
            await eventually(() => store.document().revision === 9, 'the resync');
            expect(store.document().objects['BidCos-RF.A:1']?.name).toBe('Licht');
        } finally {
            await store.stop();
        }
    });

    it('re-snapshots after an import, because the whole store was replaced', async () => {
        const box = await fakeBox();
        const store = provider(box);
        await store.start();
        try {
            await eventually(() => box.metaStreamsOpened > 0, 'the event stream to be opened');
            box.opts.meta = {
                revision: 12,
                objects: {'HmIP-RF.B:1': {name: 'Importiert', enums: [], meta: {}}},
                enums: {room: {name: {en: 'Rooms'}, tree: []}},
            };
            box.metaEvent({revision: 5, kind: 'import', objects: 1, enums: 1});
            await eventually(() => store.document().revision === 12, 'the snapshot after the import');
            expect(Object.keys(store.document().objects)).toEqual(['HmIP-RF.B:1']);
        } finally {
            await store.stop();
        }
    });

    it('opens the stream again when the box drops it', async () => {
        const box = await fakeBox();
        const store = provider(box);
        await store.start();
        try {
            await eventually(() => box.metaStreamsOpened > 0, 'the first stream');
            dropMetaStreams(box);
            await eventually(() => box.metaStreamsOpened > 1, 'the reconnect');
        } finally {
            await store.stop();
        }
    });

    it('degrades when the credential is refused, and says so once', async () => {
        const box = await fakeBox();
        const store = provider(box, {read: WRONG});
        await store.start();
        try {
            expect(store.state()).toMatchObject({reachable: false});
            expect(store.state().error).toContain('401');
            // the stream is refused as well and tried again, and none of that is a second notice
            const before = states.length;
            await eventually(() => states.length > before + 2, 'the attempts at the stream');
            expect(notices.filter((notice) => notice.includes('not answering')).length).toBe(1);
        } finally {
            await store.stop();
        }
    });

    it('degrades when the box is gone, and says it is not answering', async () => {
        const box = await fakeBox();
        const url = box.url;
        await box.stop();
        const store = provider(box, {url});
        await store.start();
        try {
            expect(store.state()).toMatchObject({reachable: false});
            expect(notices.join('\n')).toContain('the openccu-lite metadata store is not answering');
        } finally {
            await store.stop();
        }
    });

    it('writes renames and memberships as one bulk each, and reads the store again', async () => {
        const box = await fakeBox();
        const store = provider(box);
        await store.start();
        try {
            box.opts.meta = {...snapshot(), revision: 6};
            await store.setNames([
                {ref: 'BidCos-RF.A:1', name: 'Decke'},
                {ref: 'BidCos-RF.A:2', name: 'Wand'},
            ]);
            await store.setMembership([{ref: 'BidCos-RF.A:1', paths: ['room/eg']}]);
            expect(box.metaWrites.map(({method, path: route, body}) => ({method, route, body}))).toEqual([
                {
                    method: 'POST',
                    route: '/objects:bulk',
                    body: {set: {'BidCos-RF.A:1': {name: 'Decke'}, 'BidCos-RF.A:2': {name: 'Wand'}}, delete: []},
                },
                {
                    method: 'POST',
                    route: '/objects:bulk',
                    body: {set: {'BidCos-RF.A:1': {enums: ['room/eg']}}, delete: []},
                },
            ]);
            // the fresh snapshot after the write, not the event stream, is what shows it (the fake
            // box counts one revision per write: 6, then 7 and 8)
            expect(store.document().revision).toBe(8);
            // nothing written for nothing
            await store.setNames([]);
            await store.setMembership([]);
            expect(box.metaWrites.length).toBe(2);
        } finally {
            await store.stop();
        }
    });

    it('sends the taxonomy writes to the routes of the API, a body even on a DELETE', async () => {
        const box = await fakeBox();
        const store = provider(box);
        await store.start();
        try {
            await store.createEnum('floor', {de: 'Etagen', en: 'Floors'});
            await store.updateEnum('floor', {de: 'Stockwerke', en: 'Floors'});
            await store.deleteEnum('floor', true);
            expect(await store.createNode('room', 'room/eg', 'bad', 'Bad', {icon: 'bath', position: 0})).toBe(
                'room/eg/bad',
            );
            await store.updateNode('room/eg/bad', {name: 'Badezimmer', parent: null});
            await store.deleteNode('room/eg/bad', false);
            await store.import({format: 1, revision: 0, objects: {}, enums: {}}, 'merge');
            expect(
                box.metaWrites.map(({method, path: route, body}) => `${method} ${route} ${JSON.stringify(body)}`),
            ).toEqual([
                'POST /enums {"id":"floor","name":{"de":"Etagen","en":"Floors"}}',
                'PATCH /enums/floor {"name":{"de":"Stockwerke","en":"Floors"}}',
                'DELETE /enums/floor?members=detach {}',
                'POST /enums/room/nodes {"parent":"room/eg","id":"bad","name":"Bad","icon":"bath","position":0}',
                'PATCH /enums/room/nodes/eg/bad {"name":"Badezimmer","parent":null}',
                'DELETE /enums/room/nodes/eg/bad {}',
                'PUT /import?mode=merge {"format":1,"revision":0,"objects":{},"enums":{}}',
            ]);
        } finally {
            await store.stop();
        }
    });

    it('reports a refused deletion with the code of the API', async () => {
        const box = await fakeBox({metaMembers: ['BidCos-RF.A:1']});
        const store = provider(box);
        await store.start();
        try {
            await expect(store.deleteEnum('room', false)).rejects.toMatchObject({
                name: 'MetaError',
                code: 'has-members',
            });
            expect(store.state().writable).toBe(true);
        } finally {
            await store.stop();
        }
    });

    it('reports a write the box refuses and marks itself read-only', async () => {
        const box = await fakeBox({scopes: ['meta:read']});
        const store = provider(box);
        await store.start();
        try {
            const error: unknown = await store
                .setNames([{ref: 'BidCos-RF.A:1', name: 'x'}])
                .catch((caught: unknown) => caught);
            expect(error).toMatchObject({name: 'MetaError', code: 'forbidden'});
            // the API's own words, not the package's hint about pairing: a person's session is refused here too
            expect((error as Error).message).toBe('the credential lacks meta:write');
            expect(store.state()).toMatchObject({writable: false, error: 'the credential lacks meta:write'});
        } finally {
            await store.stop();
        }
    });

    it('keeps the last snapshot in a cache file, so a restart without the box has names', async () => {
        const cacheFile = path.join(dir, 'occulite-meta.json');
        const box = await fakeBox();
        const first = provider(box, {cacheFile});
        await first.start();
        await first.stop();

        const second = provider(box, {cacheFile, read: WRONG});
        await second.start();
        try {
            expect(second.document().objects['BidCos-RF.A:1']?.name).toBe('Licht');
            expect(second.state().reachable).toBe(false);
        } finally {
            await second.stop();
        }
    });
});
