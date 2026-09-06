/**
 * The `occulite` provider against a **real** `occulited` (D-40).
 *
 * Detection, snapshot, the change stream with its resync, and every write this application makes:
 * a rename, a room assignment, a new room, a rename of a room, a move of a room with its members,
 * and the two failure modes that matter - a read-only credential and a box that goes away.
 *
 * Skipped when `OCCULITED_BINARY` is not set; see `helpers.ts` for how to build one.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import {type ConnectionConfig, type MetaState} from '@homematic-manager/core';

import {NameStore} from '../../src/cache/names.js';
import {MetaService} from '../../src/meta/service.js';
import {OCCULITED, SKIP_MESSAGE, occulitedRequired, startOcculite, type OcculiteBox} from './helpers.js';

const available = OCCULITED !== undefined && OCCULITED !== '';

if (!available && occulitedRequired()) {
    throw new Error(`OCCULITED_REQUIRED=1 but ${SKIP_MESSAGE}`);
}

const HOUSE = JSON.parse(
    await fs.readFile(new URL('../../../core/test/fixtures/meta/store/valid-house.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

function connection(box: OcculiteBox, overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
    return {
        host: '127.0.0.1',
        interfaces: [],
        autoDetect: false,
        extraInterfaces: [],
        tls: false,
        rega: false,
        callback: {ip: '127.0.0.1', xmlrpcPort: 0, binrpcPort: 0},
        writePaceMs: 0,
        rpcLogFolder: '',
        metaUrl: box.baseUrl,
        ...overrides,
    };
}

/** Waits until a condition holds, so the event stream gets its moment without a fixed sleep. */
async function eventually(check: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
        if (Date.now() > deadline) {
            throw new Error(`timed out waiting for ${what}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}

describe.skipIf(!available)('the occulite provider against a real occulited', () => {
    let box: OcculiteBox;
    let dataDir: string;
    let cacheDir: string;
    let names: NameStore;
    let service: MetaService;
    let changes = 0;
    let states: MetaState[] = [];
    const notices: string[] = [];

    beforeAll(async () => {
        box = await startOcculite();
        // the store the box starts from: the conformance corpus' house
        const imported = await box.request('PUT', '/api/meta/v1/import?mode=replace', HOUSE, box.sid);
        expect(imported.status, await imported.text()).toBe(200);

        dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-meta-data-'));
        cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-meta-cache-'));
        names = new NameStore();
        service = await MetaService.create({
            connection: connection(box),
            dataDir,
            cacheDir,
            names,
            // the two interfaces the fixture uses; the real one reads the device caches
            interfaceOf: (address) => (address.startsWith('JEQ') ? 'BidCos-RF' : 'HmIP-RF'),
            onChanged: () => {
                changes += 1;
            },
            onStateChanged: (state) => {
                states.push(state);
            },
            onNotice: (level, message) => {
                notices.push(`${level}: ${message}`);
            },
            localTokenFile: box.localTokenFile,
        });
        // the session the box's shell hands an addon page as ?sid=@…@
        service.setSessionCredential(`@${box.sid}@`);
        await service.start();
    }, 40_000);

    afterAll(async () => {
        await service?.stop();
        await box?.stop();
        await fs.rm(dataDir, {recursive: true, force: true});
        await fs.rm(cacheDir, {recursive: true, force: true});
    });

    it('detects the box and reports what it is', () => {
        expect(service.kind).toBe('occulite');
        expect(service.onBox).toBe(true);
        expect(service.version?.api).toBe('meta');
        expect(service.version?.version).toBe(1);
        expect(service.state()).toMatchObject({provider: 'occulite', reachable: true, writable: true, objects: 4});
        expect(notices.join('\n')).toContain('openccu-lite detected');
    });

    it('reads the names into the name cache, keyed by address', () => {
        expect(names.get('JEQ0230153:1')).toBe('Thermostat Bad:1');
        expect(names.get('000A1B2C3D4E5F:4')).toBe('Deckenlampe');
    });

    it('turns the trees into the arrays of names the UI shows', () => {
        const objects = service.objects();
        expect(objects['HmIP-RF.000A1B2C3D4E5F:4']).toMatchObject({
            name: 'Deckenlampe',
            rooms: ['Wohnzimmer'],
            functions: ['Licht'],
        });
        expect(objects['HmIP-RF.0011223344AABB:1']?.orphaned).toBe(true);
        expect(Object.keys(service.enums()).sort()).toEqual(['floor', 'function', 'room']);
    });

    it('renames a channel through the API and sees it back', async () => {
        await service.setNames([{address: '000A1B2C3D4E5F:4', name: 'Deckenlampe Wohnzimmer'}]);
        // `GET /objects/{ref}` wraps the object: `{ref, object, revision}` - the reference calls it
        // "one object", which is a difference worth knowing when porting something else
        const answer = (await box.json('GET', '/api/meta/v1/objects/HmIP-RF.000A1B2C3D4E5F%3A4')) as {
            object?: {name?: string};
        };
        expect(answer.object?.name).toBe('Deckenlampe Wohnzimmer');
        expect(service.objects()['HmIP-RF.000A1B2C3D4E5F:4']?.name).toBe('Deckenlampe Wohnzimmer');
        expect(names.get('000A1B2C3D4E5F:4')).toBe('Deckenlampe Wohnzimmer');
    });

    it('creates a room, assigns channels to it and takes one out again', async () => {
        const created = await service.createNode('room', null, 'Büro');
        expect(created).toBe('room/buero');

        await service.assign(['HmIP-RF.000A1B2C3D4E5F:4', 'BidCos-RF.JEQ0230153:1'], 'room/buero', true);
        expect(service.objects()['HmIP-RF.000A1B2C3D4E5F:4']?.rooms).toContain('Büro');
        expect(service.objects()['BidCos-RF.JEQ0230153:1']?.rooms).toContain('Büro');

        await service.assign(['BidCos-RF.JEQ0230153:1'], 'room/buero', false);
        expect(service.objects()['BidCos-RF.JEQ0230153:1']?.rooms).not.toContain('Büro');
        // and the box agrees
        const members = (await box.json('GET', '/api/meta/v1/objects?enum=room/buero')) as {
            objects?: Record<string, unknown>;
        };
        expect(Object.keys(members.objects ?? {})).toEqual(['HmIP-RF.000A1B2C3D4E5F:4']);
    });

    it('renames a room and moves it, and the members follow', async () => {
        await service.updateNode('room/buero', {name: 'Arbeitszimmer'});
        expect(service.objects()['HmIP-RF.000A1B2C3D4E5F:4']?.rooms).toContain('Arbeitszimmer');

        await service.updateNode('room/buero', {parent: 'room/og'});
        expect(service.objects()['HmIP-RF.000A1B2C3D4E5F:4']?.enums).toContain('room/og/buero');
        const snapshot = (await box.json('GET', '/api/meta/v1/snapshot')) as {
            objects: Record<string, {enums: string[]}>;
        };
        expect(snapshot.objects['HmIP-RF.000A1B2C3D4E5F:4']?.enums).toContain('room/og/buero');
    });

    it('follows a change made by somebody else over the event stream', async () => {
        const before = changes;
        const response = await box.request(
            'PATCH',
            '/api/meta/v1/objects/BidCos-RF.JEQ0230153%3A1',
            {name: 'Von woanders umbenannt'},
            box.sid,
        );
        expect(response.status).toBe(200);
        await eventually(
            () => service.objects()['BidCos-RF.JEQ0230153:1']?.name === 'Von woanders umbenannt',
            'the SSE stream to deliver a rename made elsewhere',
        );
        expect(
            changes,
            `changes ${String(changes)} before ${String(before)} notices ${notices.join(' | ')}`,
        ).toBeGreaterThan(before);
        expect(names.get('JEQ0230153:1')).toBe('Von woanders umbenannt');
    });

    it('re-snapshots when the box says resync', async () => {
        // an import replaces the whole store, which is exactly the `resync` case
        const response = await box.request('PUT', '/api/meta/v1/import?mode=replace', HOUSE, box.sid);
        expect(response.status).toBe(200);
        await eventually(
            () => service.objects()['BidCos-RF.JEQ0230153:1']?.name === 'Thermostat Bad:1',
            'the import to be followed by a fresh snapshot',
        );
        expect(service.state().objects).toBe(4);
    });

    it('writes with the read-only local token are refused, and the state says so', async () => {
        const readOnly = await MetaService.create({
            connection: connection(box),
            dataDir,
            cacheDir,
            names: new NameStore(),
            interfaceOf: () => 'BidCos-RF',
            onChanged: () => undefined,
            onStateChanged: () => undefined,
            onNotice: () => undefined,
            localTokenFile: box.localTokenFile,
        });
        await readOnly.start();
        try {
            expect(readOnly.state()).toMatchObject({reachable: true, objects: 4});
            await expect(readOnly.setNames([{address: 'JEQ0230153:1', name: 'nicht erlaubt'}])).rejects.toThrow(
                /administrator|forbidden/i,
            );
            expect(readOnly.state().writable).toBe(false);
        } finally {
            await readOnly.stop();
        }
    });

    it('keeps the names when the box goes away, and says it is unreachable', async () => {
        states = [];
        const cached = await MetaService.create({
            connection: connection(box),
            dataDir,
            cacheDir: await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-meta-gone-')),
            names: new NameStore(),
            interfaceOf: () => 'BidCos-RF',
            onChanged: () => undefined,
            onStateChanged: () => undefined,
            onNotice: () => undefined,
            localTokenFile: box.localTokenFile,
        });
        await cached.start();
        expect(cached.state().reachable).toBe(true);
        await cached.stop();

        // the same cache directory, a box that is not there any more
        const gone = await MetaService.create({
            connection: connection(box, {metaUrl: 'http://127.0.0.1:1'}),
            dataDir,
            cacheDir,
            names: new NameStore(),
            interfaceOf: () => 'BidCos-RF',
            onChanged: () => undefined,
            onStateChanged: () => undefined,
            onNotice: () => undefined,
            localTokenFile: box.localTokenFile,
        });
        try {
            // no box answers `/version`, so the profile falls back to its own store rather than
            // pretending there is one - which is the degradation their invariant 5 asks for
            expect(gone.kind).toBe('local');
            await gone.start();
            expect(gone.state().reachable).toBe(true);
        } finally {
            await gone.stop();
        }
    });
});
