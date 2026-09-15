/**
 * D-40: the detection, the credentials and the two things the service does that neither provider
 * does - resolving an address to a ref, and turning "assign these rows to this room" into one
 * revision.
 *
 * The detection is the part with the most ways to be subtly wrong, and every one of them is a user
 * whose names silently stop coming from where they think: a probe that runs when the profile said
 * not to, a probe whose answer is believed although it is a CCU's error page, a fallback that
 * happens quietly when the profile asked for the box.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import type {ConnectionConfig, MetaState} from '@homematic-manager/core';

import {NameStore} from '../cache/names.js';
import {META_READ_SCRIPT} from '../rega/scripts.js';
import {MetaService, metaBaseUrl, type MetaRegaLink} from './service.js';

let dataDir: string;
let cacheDir: string;
let names: NameStore;
let notices: string[];
let states: MetaState[];

const VERSION = {api: 'meta', version: 1, format: 1, revision: 4, implementation: 'occulited test'};
const SNAPSHOT = {
    format: 1,
    revision: 4,
    objects: {
        'BidCos-RF.ABC0000001:1': {name: 'Deckenlampe', enums: ['room/eg', 'function/licht'], meta: {}},
    },
    enums: {
        room: {name: {en: 'Rooms', de: 'Räume'}, tree: [{id: 'eg', name: 'Erdgeschoss'}]},
        function: {name: {en: 'Functions', de: 'Gewerke'}, tree: [{id: 'licht', name: 'Licht'}]},
        floor: {name: {en: 'Floors', de: 'Etagen'}, tree: []},
    },
};

interface Recorded {
    url: string;
    method: string;
    authorization: string | undefined;
    body: string | undefined;
}

/** A box made of a function: `/version`, `/snapshot`, an event stream that never sends anything. */
function fakeBox(options: {version?: unknown; status?: number} = {}): {
    fetch: typeof globalThis.fetch;
    calls: Recorded[];
} {
    const calls: Recorded[] = [];
    const fetchImpl = ((url: string | URL, init?: RequestInit) => {
        const address = String(url);
        const headers = (init?.headers ?? {}) as Record<string, string>;
        calls.push({
            url: address,
            method: init?.method ?? 'GET',
            authorization: headers['Authorization'],
            body: typeof init?.body === 'string' ? init.body : undefined,
        });
        const json = (body: unknown, status = 200): Response =>
            new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
        if (address.endsWith('/version')) {
            return Promise.resolve(
                options.status !== undefined && options.status !== 200
                    ? json({}, options.status)
                    : json(options.version ?? VERSION),
            );
        }
        if (address.includes('/events/sse')) {
            // a stream that stays open until the provider aborts it
            return Promise.resolve(
                new Response(
                    new ReadableStream({
                        start() {
                            // nothing; the provider's abort ends it
                        },
                    }),
                    {headers: {'Content-Type': 'text/event-stream'}},
                ),
            );
        }
        if (address.endsWith('/snapshot')) {
            return Promise.resolve(json(SNAPSHOT));
        }
        return Promise.resolve(json({revision: 5}));
    }) as unknown as typeof globalThis.fetch;
    return {fetch: fetchImpl, calls};
}

function connection(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
    return {
        host: 'ccu',
        interfaces: [],
        autoDetect: false,
        extraInterfaces: [],
        tls: false,
        rega: false,
        callback: {ip: '127.0.0.1', xmlrpcPort: 0, binrpcPort: 0},
        writePaceMs: 0,
        rpcLogFolder: '',
        ...overrides,
    };
}

async function service(
    overrides: Partial<ConnectionConfig>,
    fetchImpl?: typeof globalThis.fetch,
    interfaceOf: (address: string) => string | undefined = () => 'BidCos-RF',
    rega?: MetaRegaLink,
): Promise<MetaService> {
    return MetaService.create({
        connection: connection(overrides),
        dataDir,
        cacheDir,
        names,
        interfaceOf,
        onChanged: () => undefined,
        onStateChanged: (state) => states.push(state),
        onNotice: (level, message) => notices.push(`${level}: ${message}`),
        localTokenFile: path.join(dataDir, 'no-local-token'),
        ...(fetchImpl === undefined ? {} : {fetch: fetchImpl}),
        ...(rega === undefined ? {} : {rega}),
    });
}

/** A ReGa made of a function: the read script answers with one channel in one room. */
function fakeRega(available = true, meta?: string): MetaRegaLink & {scripts: string[]} {
    const scripts: string[] = [];
    return {
        available,
        scripts,
        exec: (script) => {
            scripts.push(script);
            return Promise.resolve({
                output:
                    script === META_READ_SCRIPT && meta !== undefined
                        ? meta
                        : script === META_READ_SCRIPT
                          ? JSON.stringify({
                                objects: [
                                    {id: 1, address: 'ABC0000001:1', interface: 'BidCos-RF', name: 'Deckenlampe'},
                                ],
                                rooms: [{id: 10, name: 'Erdgeschoss', channels: [1]}],
                                functions: [],
                            })
                          : '',
            });
        },
    };
}

beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-meta-service-'));
    cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-meta-service-cache-'));
    names = new NameStore();
    notices = [];
    states = [];
});

afterEach(async () => {
    await fs.rm(dataDir, {recursive: true, force: true});
    await fs.rm(cacheDir, {recursive: true, force: true});
});

describe('metaBaseUrl', () => {
    it('is the loopback on the box itself', () => {
        expect(metaBaseUrl(connection({local: true}))).toBe('http://127.0.0.1');
    });

    it('follows the scheme the profile uses for the CCU', () => {
        expect(metaBaseUrl(connection({host: 'ccu'}))).toBe('http://ccu');
        expect(metaBaseUrl(connection({host: 'ccu', tls: true}))).toBe('https://ccu');
    });

    it('is empty without a host, so nothing is probed before the profile is configured', () => {
        expect(metaBaseUrl(connection({host: '   '}))).toBe('');
    });

    it('is overridden by metaUrl, trailing slash and all', () => {
        expect(metaBaseUrl(connection({metaUrl: 'http://box:2133/'}))).toBe('http://box:2133');
    });
});

describe('the detection', () => {
    it('uses the box when /version answers', async () => {
        const box = fakeBox();
        const meta = await service({metaUrl: 'http://box'}, box.fetch);
        expect(meta.kind).toBe('occulite');
        expect(meta.onBox).toBe(true);
        expect(meta.version?.implementation).toBe('occulited test');
        expect(box.calls[0]?.url).toBe('http://box/api/meta/v1/version');
        expect(notices.join('\n')).toContain('openccu-lite detected');
    });

    it('stays local when a CCU answers 404', async () => {
        const box = fakeBox({status: 404});
        const meta = await service({metaUrl: 'http://ccu'}, box.fetch);
        expect(meta.kind).toBe('local');
        expect(notices.join('\n')).not.toContain('openccu-lite detected');
    });

    it('stays local when the answer is JSON but not this API', async () => {
        const box = fakeBox({version: {hello: 'world'}});
        expect((await service({metaUrl: 'http://ccu'}, box.fetch)).kind).toBe('local');
    });

    it('does not probe at all when the profile says local', async () => {
        const box = fakeBox();
        const meta = await service({metaUrl: 'http://box', metaProvider: 'local'}, box.fetch);
        expect(meta.kind).toBe('local');
        expect(box.calls).toEqual([]);
    });

    it('says so when the profile asks for the box and there is none', async () => {
        const box = fakeBox({status: 404});
        const meta = await service({metaUrl: 'http://box', metaProvider: 'occulite'}, box.fetch);
        expect(meta.kind).toBe('local');
        expect(notices.join('\n')).toContain('no openccu-lite metadata API');
    });

    it('probes nothing without a host', async () => {
        const box = fakeBox();
        const meta = await service({host: ''}, box.fetch);
        expect(meta.kind).toBe('local');
        expect(box.calls).toEqual([]);
    });
});

describe('the credentials', () => {
    it('reads with the configured token and writes with the session', async () => {
        const box = fakeBox();
        const meta = await service({metaUrl: 'http://box', metaToken: 'olt_configured'}, box.fetch);
        meta.setSessionCredential('@sessionid1@');
        await meta.start();
        await meta.setNames([{address: 'ABC0000001:1', name: 'Neu'}]);
        await meta.stop();

        const snapshot = box.calls.find((call) => call.url.endsWith('/snapshot'));
        const write = box.calls.find((call) => call.method === 'POST');
        expect(snapshot?.authorization).toBe('Bearer olt_configured');
        expect(write?.authorization).toBe('Bearer sessionid1');
    });

    it('writes with the configured token when there is no session', async () => {
        const box = fakeBox();
        const meta = await service({metaUrl: 'http://box', metaToken: 'olt_configured'}, box.fetch);
        await meta.start();
        await meta.setNames([{address: 'ABC0000001:1', name: 'Neu'}]);
        await meta.stop();
        expect(box.calls.find((call) => call.method === 'POST')?.authorization).toBe('Bearer olt_configured');
    });
});

describe('reading a box', () => {
    it('applies the names to the name cache by address', async () => {
        const box = fakeBox();
        const meta = await service({metaUrl: 'http://box'}, box.fetch);
        await meta.start();
        expect(names.get('ABC0000001:1')).toBe('Deckenlampe');
        expect(meta.state()).toMatchObject({provider: 'occulite', reachable: true, objects: 1});
        await meta.stop();
    });

    it('turns the trees into arrays of names, in tree order', async () => {
        const box = fakeBox();
        const meta = await service({metaUrl: 'http://box'}, box.fetch);
        await meta.start();
        expect(meta.objects()['BidCos-RF.ABC0000001:1']).toEqual({
            name: 'Deckenlampe',
            enums: ['room/eg', 'function/licht'],
            rooms: ['Erdgeschoss'],
            functions: ['Licht'],
        });
        await meta.stop();
    });
});

describe('refs', () => {
    it('builds one from the interface that reports the address', async () => {
        const meta = await service({metaProvider: 'local'}, undefined, () => 'HmIP-RF');
        await meta.start();
        expect(meta.refFor('0001D3C99C7D4B:3')).toBe('HmIP-RF.0001D3C99C7D4B:3');
    });

    it('falls back to the ref the store already uses when no interface reports it', async () => {
        const box = fakeBox();
        const meta = await service({metaUrl: 'http://box'}, box.fetch, () => undefined);
        await meta.start();
        expect(meta.refFor('ABC0000001:1')).toBe('BidCos-RF.ABC0000001:1');
        expect(meta.refFor('NOTHERE:1')).toBeUndefined();
        await meta.stop();
    });
});

describe('the taxonomy', () => {
    it('derives a stable id from the name and resolves a collision', async () => {
        const meta = await service({metaProvider: 'local'});
        await meta.start();
        expect(await meta.createNode('room', null, 'Küche')).toBe('room/kueche');
        expect(await meta.createNode('room', null, 'Kueche')).toBe('room/kueche-2');
        expect(await meta.createNode('room', 'room/kueche', 'Speisekammer')).toBe('room/kueche/speisekammer');
    });

    it('refuses a taxonomy that does not exist rather than creating one', async () => {
        const meta = await service({metaProvider: 'local'});
        await meta.start();
        await expect(meta.createNode('nope', null, 'x')).rejects.toThrow(/not a taxonomy/);
    });

    it('assigns a selection to a room in one go, naming what the store does not know yet', async () => {
        const meta = await service({metaProvider: 'local'});
        await meta.start();
        names.set([{address: 'ABC0000001:1', name: 'Deckenlampe'}]);
        await meta.createNode('room', null, 'Wohnzimmer');
        await meta.assign(['BidCos-RF.ABC0000001:1', 'BidCos-RF.ABC0000002:1'], 'room/wohnzimmer', true);
        expect(meta.objects()['BidCos-RF.ABC0000001:1']).toMatchObject({name: 'Deckenlampe', rooms: ['Wohnzimmer']});
        // an address the name cache does not know either keeps the address as its name
        expect(meta.objects()['BidCos-RF.ABC0000002:1']).toMatchObject({name: 'ABC0000002:1'});

        await meta.assign(['BidCos-RF.ABC0000001:1'], 'room/wohnzimmer', false);
        expect(meta.objects()['BidCos-RF.ABC0000001:1']?.rooms).toEqual([]);
    });

    it('does nothing when the assignment is already what was asked for', async () => {
        const meta = await service({metaProvider: 'local'});
        await meta.start();
        await meta.createNode('room', null, 'Wohnzimmer');
        await meta.assign(['BidCos-RF.A:1'], 'room/wohnzimmer', true);
        const revision = meta.state().revision;
        await meta.assign(['BidCos-RF.A:1'], 'room/wohnzimmer', true);
        expect(meta.state().revision).toBe(revision);
    });
});

describe('ReGa as the store (task 27)', () => {
    it('is what auto picks when there is no box and ReGa answered', async () => {
        const box = fakeBox({status: 404});
        const rega = fakeRega();
        const meta = await service({metaUrl: 'http://ccu', rega: true}, box.fetch, undefined, rega);
        expect(meta.kind).toBe('rega');
        expect(meta.onBox).toBe(false);
        expect(notices.join('\n')).toContain('rooms and functions come from ReGa');

        await meta.start();
        expect(rega.scripts).toEqual([META_READ_SCRIPT]);
        expect(meta.state()).toMatchObject({provider: 'rega', reachable: true, writable: true, flat: true});
        expect(meta.objects()['BidCos-RF.ABC0000001:1']?.rooms).toEqual(['Erdgeschoss']);
        // the names ReGa holds are the names the application shows
        expect(names.get('ABC0000001:1')).toBe('Deckenlampe');
        await meta.refresh();
        expect(rega.scripts).toHaveLength(2);
    });

    it('goes back to the profile store when auto took ReGa and the first read fails', async () => {
        const box = fakeBox({status: 404});
        const rega = fakeRega(true, 'not the document');
        const meta = await service({metaUrl: 'http://ccu', rega: true}, box.fetch, undefined, rega);
        expect(meta.kind).toBe('rega');
        await meta.start();
        expect(meta.kind).toBe('local');
        expect(meta.state()).toMatchObject({provider: 'local', reachable: true, writable: true});
        expect(states.at(-1)).toMatchObject({provider: 'local', reachable: true});
        expect(notices.join('\n')).toContain('stay in this profile');
        // and the profile's own file is what a write goes to from now on
        await meta.createNode('room', null, 'Küche');
        expect(meta.enums()['room']?.tree.map((node) => node.name)).toEqual(['Küche']);
        expect(rega.scripts).toEqual([META_READ_SCRIPT]);
    });

    it('insists on ReGa when the profile says so, even when the script fails', async () => {
        const box = fakeBox({status: 404});
        const meta = await service(
            {metaUrl: 'http://ccu', rega: true, metaProvider: 'rega'},
            box.fetch,
            undefined,
            fakeRega(true, 'not the document'),
        );
        await meta.start();
        expect(meta.kind).toBe('rega');
        expect(meta.state()).toMatchObject({provider: 'rega', reachable: false});
    });

    it('stays local when ReGa is on but has not answered', async () => {
        const box = fakeBox({status: 404});
        const meta = await service({metaUrl: 'http://ccu', rega: true}, box.fetch, undefined, fakeRega(false));
        expect(meta.kind).toBe('local');
    });

    it('lets the box win over ReGa', async () => {
        const box = fakeBox();
        const meta = await service({metaUrl: 'http://box', rega: true}, box.fetch, undefined, fakeRega());
        expect(meta.kind).toBe('occulite');
    });

    it('insists on ReGa when the profile says so, even before it answered, and never probes', async () => {
        const box = fakeBox();
        const rega = fakeRega(false);
        const meta = await service({metaUrl: 'http://box', metaProvider: 'rega'}, box.fetch, undefined, rega);
        expect(meta.kind).toBe('rega');
        expect(box.calls).toEqual([]);
    });

    it('says so when the profile asks for ReGa and ReGa is switched off', async () => {
        const box = fakeBox({status: 404});
        const meta = await service({metaUrl: 'http://ccu', metaProvider: 'rega'}, box.fetch);
        expect(meta.kind).toBe('local');
        expect(notices.join('\n')).toContain('ReGa is switched off');
    });

    it('does not take ReGa when the profile says local', async () => {
        const meta = await service({metaProvider: 'local'}, undefined, undefined, fakeRega());
        expect(meta.kind).toBe('local');
    });

    it('turns "assign these rows" into Add/Remove statements on ReGa', async () => {
        const box = fakeBox({status: 404});
        const rega = fakeRega();
        const meta = await service({metaUrl: 'http://ccu', rega: true}, box.fetch, undefined, rega);
        await meta.start();
        await meta.assign(['BidCos-RF.ABC0000001:1'], 'room/r10', false);
        expect(rega.scripts.at(-1)).toBe('dom.GetObject(10).Remove(1);\n');
        expect(meta.objects()['BidCos-RF.ABC0000001:1']?.rooms).toEqual([]);
    });

    /**
     * Task 49: a device row on a CCU. ReGa files channels, so a device holds no path of its own, and
     * a device's membership list is applied to each of its channels as their complete list - an
     * assign that sent the device's (empty) list plus the room took the channels out of every other
     * room and function, and a removal through the device removed nothing.
     */
    it('assigns a device row on ReGa through its channels, and touches no other membership', async () => {
        const box = fakeBox({status: 404});
        const rega = fakeRega(
            true,
            JSON.stringify({
                objects: [
                    {id: 1, address: 'ABC0000001', interface: 'BidCos-RF', name: 'Dimmer'},
                    {id: 2, address: 'ABC0000001:0', interface: 'BidCos-RF', name: 'Dimmer:0'},
                    {id: 3, address: 'ABC0000001:1', interface: 'BidCos-RF', name: 'Dimmer:1'},
                    {id: 4, address: 'ABC0000001:2', interface: 'BidCos-RF', name: 'Dimmer:2'},
                ],
                rooms: [
                    {id: 10, name: 'Erdgeschoss', channels: [3]},
                    {id: 11, name: 'Bad', channels: [3]},
                ],
                functions: [{id: 20, name: 'Licht', channels: [3, 4]}],
            }),
        );
        const meta = await service({metaUrl: 'http://ccu', rega: true}, box.fetch, undefined, rega);
        await meta.start();

        await meta.assign(['BidCos-RF.ABC0000001'], 'room/r11', true);
        // the channel already in Bad is left alone, Erdgeschoss and Licht stay, :0 is not filed
        expect(rega.scripts.at(-1)).toBe('dom.GetObject(11).Add(4);\n');
        expect(meta.objects()['BidCos-RF.ABC0000001:1']?.enums).toEqual(['room/r10', 'room/r11', 'function/r20']);
        expect(meta.objects()['BidCos-RF.ABC0000001:2']?.enums).toEqual(['room/r11', 'function/r20']);
        expect(meta.objects()['BidCos-RF.ABC0000001:0']?.enums).toEqual([]);

        await meta.assign(['BidCos-RF.ABC0000001'], 'room/r10', false);
        expect(rega.scripts.at(-1)).toBe('dom.GetObject(10).Remove(3);\n');
        expect(meta.objects()['BidCos-RF.ABC0000001:1']?.enums).toEqual(['room/r11', 'function/r20']);
        expect(meta.objects()['BidCos-RF.ABC0000001:2']?.enums).toEqual(['room/r11', 'function/r20']);
    });
});
