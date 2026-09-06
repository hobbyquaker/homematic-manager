/**
 * The metadata API client against a `fetch` that answers whatever the test needs.
 *
 * What is worth asserting here is the *protocol*, not the transport: which URL a call goes to, how
 * a ref and a node path are encoded, which credential is sent for a read and which for a write, and
 * what an error body becomes. The integration test in `test/occulite/` proves the same calls
 * against a real `occulited`; this one proves them against the specification, and it runs in CI
 * where no box exists.
 */

import {describe, expect, it} from 'vitest';

import {MetaError} from '@homematic-manager/core';

import {MetaApiClient, encodeRef, nodeUrl, readEvents} from './client.js';

interface Call {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
}

/** A `fetch` that records what it was asked and answers from a queue. */
function recorder(answers: (Response | (() => Response))[]): {fetch: typeof globalThis.fetch; calls: Call[]} {
    const calls: Call[] = [];
    const fetchImpl = (input: string | URL | Request, init?: RequestInit) => {
        const headers = Object.fromEntries(
            Object.entries((init?.headers ?? {}) as Record<string, string>).map(([key, value]) => [
                key.toLowerCase(),
                value,
            ]),
        );
        calls.push({
            url: input instanceof Request ? input.url : input.toString(),
            method: init?.method ?? 'GET',
            headers,
            ...(typeof init?.body === 'string' ? {body: init.body} : {}),
        });
        const answer = answers.shift();
        if (answer === undefined) {
            return Promise.reject(new Error('no answer left'));
        }
        return Promise.resolve(typeof answer === 'function' ? answer() : answer);
    };
    return {fetch: fetchImpl, calls};
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
}

const SNAPSHOT = {
    format: 1,
    revision: 7,
    objects: {'BidCos-RF.ABC0000001:1': {name: 'Licht', enums: ['room/eg'], meta: {}}},
    enums: {room: {name: {en: 'Rooms'}, tree: [{id: 'eg', name: 'EG'}]}},
};

describe('the URL helpers', () => {
    it('encodes the colon of a channel ref, which is a path segment', () => {
        expect(encodeRef('BidCos-RF.JEQ0230153:1')).toBe('BidCos-RF.JEQ0230153%3A1');
    });

    it('drops the enum id from a node path, because the URL already carries it', () => {
        // the mistake this prevents is `/enums/room/nodes/room/eg/bad`, which answers unknown-path
        expect(nodeUrl('room/eg/bad')).toBe('/enums/room/nodes/eg/bad');
        expect(nodeUrl('room/eg')).toBe('/enums/room/nodes/eg');
    });
});

describe('detection', () => {
    it('answers with the version a box reports', async () => {
        const {fetch, calls} = recorder([json({api: 'meta', version: 1, format: 1, revision: 3})]);
        const client = new MetaApiClient({baseUrl: 'http://box', fetch});
        await expect(client.version()).resolves.toMatchObject({api: 'meta', version: 1});
        expect(calls[0]?.url).toBe('http://box/api/meta/v1/version');
        // the one call that needs no credential
        expect(calls[0]?.headers['authorization']).toBeUndefined();
    });

    it('answers undefined for a CCU, which 404s or serves HTML', async () => {
        const notFound = new MetaApiClient({baseUrl: 'http://ccu', fetch: recorder([json({}, 404)]).fetch});
        await expect(notFound.version()).resolves.toBeUndefined();

        const html = new MetaApiClient({
            baseUrl: 'http://ccu',
            fetch: recorder([new Response('<html>', {status: 200})]).fetch,
        });
        await expect(html.version()).resolves.toBeUndefined();
    });

    it('answers undefined when the host does not answer at all', async () => {
        const fetchImpl = (() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof globalThis.fetch;
        const client = new MetaApiClient({baseUrl: 'http://box', fetch: fetchImpl});
        await expect(client.version()).resolves.toBeUndefined();
    });

    it('answers undefined for JSON that is not this API', async () => {
        const client = new MetaApiClient({baseUrl: 'http://box', fetch: recorder([json({hello: true})]).fetch});
        await expect(client.version()).resolves.toBeUndefined();
    });
});

describe('reads', () => {
    it('validates the snapshot as if it came off disk', async () => {
        const {fetch} = recorder([json(SNAPSHOT)]);
        const client = new MetaApiClient({baseUrl: 'http://box/', fetch, credential: () => 'olt_1'});
        await expect(client.snapshot()).resolves.toMatchObject({revision: 7});
    });

    it('refuses a snapshot that is not a valid document', async () => {
        const {fetch} = recorder([json({format: 2, revision: 0, objects: {}, enums: {}})]);
        const client = new MetaApiClient({baseUrl: 'http://box', fetch, credential: () => 'olt_1'});
        await expect(client.snapshot()).rejects.toThrow(
            expect.objectContaining({code: 'format-unsupported'}) as unknown,
        );
    });

    it('sends the read credential as a Bearer and strips the CCU @ wrapping', async () => {
        const {fetch, calls} = recorder([json({revision: 1, enums: {}})]);
        const client = new MetaApiClient({baseUrl: 'http://box', fetch, credential: () => '@abcdefghij@'});
        await client.enums();
        expect(calls[0]?.headers['authorization']).toBe('Bearer abcdefghij');
    });

    it('turns a 401 into forbidden, which is what the provider degrades on', async () => {
        const {fetch} = recorder([json({error: 'unauthorized', message: 'no credential'}, 401)]);
        const client = new MetaApiClient({baseUrl: 'http://box', fetch});
        await expect(client.snapshot()).rejects.toThrow(expect.objectContaining({code: 'forbidden'}) as unknown);
    });

    it('keeps the API error code of anything else', async () => {
        const {fetch} = recorder([json({error: 'unknown-object', message: 'not here'}, 404)]);
        const client = new MetaApiClient({baseUrl: 'http://box', fetch, credential: () => 'olt_1'});
        await expect(client.snapshot()).rejects.toThrow(expect.objectContaining({code: 'unknown-object'}) as unknown);
    });

    it('survives an error body that is not JSON at all - a proxy page, say', async () => {
        const {fetch} = recorder([new Response('<h1>502</h1>', {status: 502})]);
        const client = new MetaApiClient({baseUrl: 'http://box', fetch, credential: () => 'olt_1'});
        await expect(client.snapshot()).rejects.toBeInstanceOf(MetaError);
    });
});

describe('writes', () => {
    it('sends the write credential, not the read one', async () => {
        const {fetch, calls} = recorder([json({revision: 8})]);
        const client = new MetaApiClient({
            baseUrl: 'http://box',
            fetch,
            credential: () => 'olt_readonly',
            writeCredential: () => 'sessionid1',
        });
        await client.patchObject('BidCos-RF.ABC0000001:1', {name: 'Neu'});
        expect(calls[0]?.method).toBe('PATCH');
        expect(calls[0]?.url).toBe('http://box/api/meta/v1/objects/BidCos-RF.ABC0000001%3A1');
        expect(calls[0]?.headers['authorization']).toBe('Bearer sessionid1');
        expect(calls[0]?.body).toBe('{"name":"Neu"}');
    });

    it('falls back to the read credential when there is no session', async () => {
        const {fetch, calls} = recorder([json({revision: 8})]);
        const client = new MetaApiClient({baseUrl: 'http://box', fetch, credential: () => 'olt_1'});
        await client.patchObject('BidCos-RF.A:1', {name: 'x'});
        expect(calls[0]?.headers['authorization']).toBe('Bearer olt_1');
    });

    it('sends a body even for a DELETE, because lighttpd answers 411 without one', async () => {
        const {fetch, calls} = recorder([json({revision: 9}), json({revision: 10})]);
        const client = new MetaApiClient({baseUrl: 'http://box', fetch, credential: () => 'olt_1'});
        await client.deleteNode('room/eg/bad', 'detach');
        await client.deleteEnum('zone', 'refuse');
        expect(calls[0]?.url).toBe('http://box/api/meta/v1/enums/room/nodes/eg/bad?members=detach');
        expect(calls[0]?.body).toBe('{}');
        expect(calls[0]?.headers['content-type']).toBe('application/json');
        expect(calls[1]?.url).toBe('http://box/api/meta/v1/enums/zone');
    });

    it('reads a 304 as "valid, and nothing changed"', async () => {
        const {fetch} = recorder([new Response(undefined, {status: 304})]);
        const client = new MetaApiClient({baseUrl: 'http://box', fetch, credential: () => 'olt_1'});
        await expect(client.patchObject('BidCos-RF.A:1', {name: 'x'})).resolves.toMatchObject({changed: false});
    });

    it('reports a 403 as forbidden, which is a read-only credential', async () => {
        const {fetch} = recorder([json({error: 'forbidden', message: 'administrator role required'}, 403)]);
        const client = new MetaApiClient({baseUrl: 'http://box', fetch, credential: () => 'olt_readonly'});
        await expect(client.patchObject('BidCos-RF.A:1', {name: 'x'})).rejects.toThrow(
            expect.objectContaining({code: 'forbidden'}) as unknown,
        );
    });

    it('posts a node under a parent and a whole bulk in one call', async () => {
        const {fetch, calls} = recorder([json({revision: 11}), json({revision: 12})]);
        const client = new MetaApiClient({baseUrl: 'http://box', fetch, credential: () => 'olt_1'});
        await client.createNode('room', {parent: 'room/eg', id: 'bad', name: 'Bad'});
        await client.bulk({'BidCos-RF.A:1': {enums: ['room/eg/bad']}}, ['BidCos-RF.B:1']);
        expect(calls[0]?.url).toBe('http://box/api/meta/v1/enums/room/nodes');
        expect(calls[1]?.url).toBe('http://box/api/meta/v1/objects:bulk');
        expect(calls[1]?.body).toContain('"delete":["BidCos-RF.B:1"]');
    });

    it('imports with the mode in the query', async () => {
        const {fetch, calls} = recorder([json({revision: 13})]);
        const client = new MetaApiClient({baseUrl: 'http://box', fetch, credential: () => 'olt_1'});
        await client.import(SNAPSHOT, 'merge');
        expect(calls[0]?.url).toBe('http://box/api/meta/v1/import?mode=merge');
        expect(calls[0]?.method).toBe('PUT');
    });
});

/** A stream of the given chunks, as `fetch` would hand one over. */
function stream(chunks: readonly string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
        start(controller) {
            for (const chunk of chunks) {
                controller.enqueue(encoder.encode(chunk));
            }
            controller.close();
        },
    });
}

describe('the change stream', () => {
    it('reads one event per message', async () => {
        const events = [];
        for await (const event of readEvents(
            stream(['data: {"revision":1,"kind":"object.updated","ref":"A.b"}\n\n']),
        )) {
            events.push(event);
        }
        expect(events).toEqual([{revision: 1, kind: 'object.updated', ref: 'A.b'}]);
    });

    it('does not care where a chunk ends', async () => {
        const events = [];
        for await (const event of readEvents(stream(['data: {"revi', 'sion":2,"kind":"import"}\n', '\ndata: ']))) {
            events.push(event);
        }
        expect(events).toEqual([{revision: 2, kind: 'import'}]);
    });

    it('ignores the heartbeat comment and a line that is not JSON', async () => {
        const events = [];
        for await (const event of readEvents(
            stream([': heartbeat\n\ndata: not json\n\ndata: {"revision":3,"kind":"node.moved"}\n\n']),
        )) {
            events.push(event);
        }
        expect(events).toEqual([{revision: 3, kind: 'node.moved'}]);
    });

    it('stops when the signal is aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        const events = [];
        for await (const event of readEvents(stream(['data: {"revision":4,"kind":"import"}\n\n']), controller.signal)) {
            events.push(event);
        }
        expect(events).toEqual([]);
    });
});
