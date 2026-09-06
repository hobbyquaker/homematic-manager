/**
 * The `occulite` provider without a box: the snapshot, the event stream, the resync and the three
 * ways it is allowed to fail.
 *
 * The integration test in `test/occulite/` runs the same provider against a real `occulited` and is
 * the one that proves the protocol; this one runs in CI, where there is no box, and proves the
 * behaviour around it - that a change on the stream reaches the backend, that a gap in the
 * revisions is answered with a fresh snapshot rather than with a store that has quietly drifted,
 * that a refused credential leaves the application running, and that the last snapshot survives a
 * restart while the box is away.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import type {MetaEvent, MetaState} from '@homematic-manager/core';

import {MetaApiClient} from './client.js';
import {OcculiteProvider} from './occuliteProvider.js';

const SNAPSHOT = {
    format: 1,
    revision: 4,
    objects: {'BidCos-RF.A:1': {name: 'Licht', enums: ['room/eg'], meta: {}}},
    enums: {room: {name: {en: 'Rooms'}, tree: [{id: 'eg', name: 'Erdgeschoss'}]}},
};

let dir: string;
let changes: number;
let states: MetaState[];
let notices: string[];

/** A box whose snapshot and event stream the test drives. */
class FakeBox {
    snapshot: Record<string, unknown> = structuredClone(SNAPSHOT);
    snapshotStatus = 200;
    streams = 0;
    #controller: ReadableStreamDefaultController<Uint8Array> | undefined;

    readonly fetch = ((url: string | URL, init?: RequestInit) => {
        const address = String(url);
        const json = (body: unknown, status = 200): Response =>
            new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
        if (address.endsWith('/version')) {
            return Promise.resolve(json({api: 'meta', version: 1, format: 1, revision: 4}));
        }
        if (address.includes('/events/sse')) {
            this.streams += 1;
            if (this.snapshotStatus !== 200) {
                return Promise.resolve(json({error: 'forbidden'}, this.snapshotStatus));
            }
            const stream = new ReadableStream<Uint8Array>({
                start: (controller) => {
                    this.#controller = controller;
                },
                cancel: () => {
                    this.#controller = undefined;
                },
            });
            return Promise.resolve(new Response(stream, {headers: {'Content-Type': 'text/event-stream'}}));
        }
        if (address.includes('/snapshot')) {
            return this.snapshotStatus === 200
                ? Promise.resolve(json(this.snapshot))
                : Promise.resolve(json({error: 'forbidden', message: 'no credential'}, this.snapshotStatus));
        }
        return Promise.resolve(json({revision: 5, method: init?.method ?? 'GET'}));
    }) as unknown as typeof globalThis.fetch;

    /** Pushes one event down the open stream, the way the box does. */
    send(event: MetaEvent): void {
        this.#controller?.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
    }

    /** Ends the stream, as a box that restarts does. */
    end(): void {
        this.#controller?.close();
        this.#controller = undefined;
    }
}

function provider(box: FakeBox, cacheFile?: string): OcculiteProvider {
    return new OcculiteProvider({
        client: new MetaApiClient({baseUrl: 'http://box', fetch: box.fetch, credential: () => 'olt_1'}),
        ...(cacheFile === undefined ? {} : {cacheFile}),
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

async function eventually(check: () => boolean, what: string, timeoutMs = 2000): Promise<void> {
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
    await fs.rm(dir, {recursive: true, force: true});
});

describe('the occulite provider', () => {
    it('loads the snapshot and reports what it found', async () => {
        const box = new FakeBox();
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
                url: 'http://box',
            });
        } finally {
            await store.stop();
        }
    });

    it('follows a change on the event stream without asking for the snapshot again', async () => {
        const box = new FakeBox();
        const store = provider(box);
        await store.start();
        try {
            await eventually(() => box.streams > 0, 'the event stream to be opened');
            const before = changes;
            box.send({
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
        const box = new FakeBox();
        const store = provider(box);
        await store.start();
        try {
            await eventually(() => box.streams > 0, 'the event stream to be opened');
            box.snapshot = {...structuredClone(SNAPSHOT), revision: 9};
            // revision 4 -> 9: five revisions happened somewhere this consumer did not see
            box.send({
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
        const box = new FakeBox();
        const store = provider(box);
        await store.start();
        try {
            await eventually(() => box.streams > 0, 'the event stream to be opened');
            box.snapshot = {
                format: 1,
                revision: 12,
                objects: {'HmIP-RF.B:1': {name: 'Importiert', enums: [], meta: {}}},
                enums: {room: {name: {en: 'Rooms'}, tree: []}},
            };
            box.send({revision: 5, kind: 'import', objects: 1, enums: 1});
            await eventually(() => store.document().revision === 12, 'the snapshot after the import');
            expect(Object.keys(store.document().objects)).toEqual(['HmIP-RF.B:1']);
        } finally {
            await store.stop();
        }
    });

    it('opens the stream again when the box drops it', async () => {
        const box = new FakeBox();
        const store = provider(box);
        await store.start();
        try {
            await eventually(() => box.streams > 0, 'the first stream');
            box.end();
            await eventually(() => box.streams > 1, 'the reconnect');
        } finally {
            await store.stop();
        }
    });

    it('degrades when the credential is refused, and says so once', async () => {
        const box = new FakeBox();
        box.snapshotStatus = 401;
        const store = provider(box);
        await store.start();
        try {
            expect(store.state()).toMatchObject({reachable: false});
            expect(store.state().error).toContain('401');
            expect(notices.filter((notice) => notice.includes('not answering')).length).toBe(1);
        } finally {
            await store.stop();
        }
    });

    it('reports a write the box refuses and marks itself read-only', async () => {
        const box = new FakeBox();
        const store = provider(box);
        await store.start();
        try {
            const forbidding = new FakeBox();
            forbidding.snapshotStatus = 200;
            const readOnly = new OcculiteProvider({
                client: new MetaApiClient({
                    baseUrl: 'http://box',
                    fetch: () =>
                        Promise.resolve(
                            new Response(JSON.stringify({error: 'forbidden', message: 'administrator role required'}), {
                                status: 403,
                                headers: {'Content-Type': 'application/json'},
                            }),
                        ),
                }),
                onChanged: () => undefined,
                onStateChanged: (state) => states.push(state),
                onNotice: () => undefined,
            });
            await expect(readOnly.setNames([{ref: 'BidCos-RF.A:1', name: 'x'}])).rejects.toThrow(
                expect.objectContaining({code: 'forbidden'}) as unknown,
            );
            expect(readOnly.state().writable).toBe(false);
        } finally {
            await store.stop();
        }
    });

    it('keeps the last snapshot in a cache file, so a restart without the box has names', async () => {
        const cacheFile = path.join(dir, 'occulite-meta.json');
        const box = new FakeBox();
        const first = provider(box, cacheFile);
        await first.start();
        await first.stop();

        const gone = new FakeBox();
        gone.snapshotStatus = 401;
        const second = provider(gone, cacheFile);
        await second.start();
        try {
            expect(second.document().objects['BidCos-RF.A:1']?.name).toBe('Licht');
            expect(second.state().reachable).toBe(false);
        } finally {
            await second.stop();
        }
    });
});
