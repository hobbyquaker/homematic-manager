import {describe, expect, it, vi} from 'vitest';

import type {RegaState} from '@homematic-manager/core';

import {NameStore} from '../cache/names.js';
import {RegaService, escapeRegaString, renameScript, type RegaLike, type RegaServiceOptions} from './client.js';

function service(
    client: Partial<RegaLike>,
    overrides: Partial<RegaServiceOptions> = {},
): {rega: RegaService; names: NameStore; states: RegaState[]; notices: string[]} {
    const names = overrides.names ?? new NameStore();
    const states: RegaState[] = [];
    const notices: string[] = [];
    const rega = new RegaService({
        host: 'ccu.lan',
        enabled: true,
        names,
        onStateChanged: (state) => states.push(state),
        onNotice: (_level, message) => notices.push(message),
        createClient: () => ({
            getChannels: client.getChannels ?? (() => Promise.resolve([])),
            exec: client.exec ?? (() => Promise.resolve({output: '', objects: {}})),
        }),
        ...overrides,
    });
    return {rega, names, states, notices};
}

describe('escapeRegaString', () => {
    it('escapes what would break the script literal', () => {
        expect(escapeRegaString('Wohnzimmer "Lampe"')).toBe('Wohnzimmer \\"Lampe\\"');
        expect(escapeRegaString('back\\slash')).toBe('back\\\\slash');
        expect(escapeRegaString('two\nlines')).toBe('two lines');
    });
});

describe('renameScript', () => {
    it('addresses every object by its rega id', () => {
        const script = renameScript(
            [
                {address: 'ABC1', name: 'Lampe'},
                {address: 'ABC1:0', name: 'Lampe:0'},
            ],
            (address) => (address === 'ABC1' ? 4711 : 4712),
        );
        expect(script).toBe('dom.GetObject(4711).Name("Lampe");\ndom.GetObject(4712).Name("Lampe:0");\n');
    });

    it('is undefined when ReGa knows none of the addresses', () => {
        expect(renameScript([{address: 'ABC1', name: 'x'}], () => undefined)).toBeUndefined();
        expect(renameScript([], () => 1)).toBeUndefined();
    });
});

describe('RegaService when it is switched off (D-2)', () => {
    it('never touches a client and reports itself as disabled', async () => {
        const getChannels = vi.fn();
        const {rega, states} = service({getChannels}, {enabled: false});
        expect(rega.state).toEqual({enabled: false, reachable: false, names: 0});
        await expect(rega.refreshNames()).resolves.toBe(false);
        await rega.rename([{address: 'A', name: 'x'}]);
        expect(getChannels).not.toHaveBeenCalled();
        expect(rega.available).toBe(false);
        expect(states.at(-1)).toEqual({enabled: false, reachable: false, names: 0});
    });
});

describe('RegaService.refreshNames', () => {
    it('applies the channels and reports the count', async () => {
        const {rega, names, states} = service({
            getChannels: () =>
                Promise.resolve([
                    {id: 4711, address: 'ABC1:1', name: 'Wohnzimmer Lampe'},
                    {id: 4712, address: 'ABC1:2', name: 'Flur'},
                ]),
        });
        await expect(rega.refreshNames()).resolves.toBe(true);
        expect(names.get('ABC1:1')).toBe('Wohnzimmer Lampe');
        expect(names.regaId('ABC1:2')).toBe(4712);
        expect(states.at(-1)).toEqual({enabled: true, reachable: true, names: 2});
        expect(rega.available).toBe(true);
    });

    it('reports "no change" when ReGa says the same thing twice', async () => {
        const {rega} = service({getChannels: () => Promise.resolve([{id: 1, address: 'A:1', name: 'x'}])});
        await rega.refreshNames();
        await expect(rega.refreshNames()).resolves.toBe(false);
    });

    it('treats an empty answer as a warning, not as a crash (2.x threw here)', async () => {
        const {rega, states, notices} = service({getChannels: () => Promise.resolve([])});
        await expect(rega.refreshNames()).resolves.toBe(false);
        expect(states.at(-1)?.error).toBe('ReGa returned no channels');
        expect(states.at(-1)?.reachable).toBe(true);
        expect(notices).toEqual(['ReGa returned no channels']);
    });

    it('turns a 401 into a state and a notice instead of an exception (#127)', async () => {
        const {rega, states, notices} = service({getChannels: () => Promise.reject(new Error('401 Unauthorized'))});
        await expect(rega.refreshNames()).resolves.toBe(false);
        expect(states.at(-1)).toEqual({
            enabled: true,
            reachable: false,
            names: 0,
            error: 'ReGa is not answering: 401 Unauthorized',
        });
        expect(notices[0]).toContain('401 Unauthorized');
        expect(rega.available).toBe(false);
    });

    it('keeps the local names when ReGa is gone', async () => {
        const names = new NameStore();
        names.set([{address: 'ABC1:1', name: 'local'}]);
        const {rega} = service({getChannels: () => Promise.reject(new Error('ECONNREFUSED'))}, {names});
        await rega.refreshNames();
        expect(names.get('ABC1:1')).toBe('local');
    });
});

describe('RegaService.rename', () => {
    it('sends the script for the addresses ReGa knows', async () => {
        const exec = vi.fn((script: string) => Promise.resolve({output: script, objects: {}}));
        const names = new NameStore();
        const {rega} = service(
            {getChannels: () => Promise.resolve([{id: 4711, address: 'A:1', name: 'x'}]), exec},
            {names},
        );
        await rega.refreshNames();
        await rega.rename([
            {address: 'A:1', name: 'Kueche'},
            {address: 'B:1', name: 'unknown to rega'},
        ]);
        expect(exec).toHaveBeenCalledOnce();
        expect(exec.mock.calls[0]?.[0]).toContain('dom.GetObject(4711)');
        expect(exec.mock.calls[0]?.[0]).not.toContain('unknown to rega');
    });

    it('does nothing without entries or without a known object', async () => {
        const exec = vi.fn((script: string) => Promise.resolve({output: script, objects: {}}));
        const {rega} = service({exec});
        await rega.rename([]);
        await rega.rename([{address: 'A:1', name: 'x'}]);
        expect(exec).not.toHaveBeenCalled();
    });

    it('reports a failing script without throwing', async () => {
        const names = new NameStore();
        const {rega, states, notices} = service(
            {
                getChannels: () => Promise.resolve([{id: 1, address: 'A:1', name: 'x'}]),
                exec: () => Promise.reject(new Error('rega http status 500')),
            },
            {names},
        );
        await rega.refreshNames();
        await expect(rega.rename([{address: 'A:1', name: 'y'}])).resolves.toBeUndefined();
        expect(states.at(-1)?.error).toContain('rega http status 500');
        expect(notices.at(-1)).toContain('renaming through ReGa failed');
    });

    it('clears an earlier error when a rename succeeds', async () => {
        const names = new NameStore();
        names.applyRega([{address: 'A:1', name: 'x', id: 1}]);
        let fail = true;
        const {rega, states} = service(
            {
                exec: () => (fail ? Promise.reject(new Error('boom')) : Promise.resolve({output: '', objects: {}})),
            },
            {names},
        );
        await rega.rename([{address: 'A:1', name: 'y'}]);
        expect(states.at(-1)?.error).toBeDefined();
        fail = false;
        await rega.rename([{address: 'A:1', name: 'y'}]);
        expect(states.at(-1)?.error).toBeUndefined();
        expect(states.at(-1)?.reachable).toBe(true);
    });
});

describe('the real client', () => {
    it('is built from the connection without talking to anything', () => {
        const rega = new RegaService({
            host: '127.0.0.1',
            enabled: true,
            tls: true,
            auth: {user: 'Admin', password: 'secret'},
            names: new NameStore(),
            onStateChanged: () => undefined,
            onNotice: () => undefined,
            timeoutMs: 1000,
        });
        expect(rega.state.enabled).toBe(true);
    });
});
