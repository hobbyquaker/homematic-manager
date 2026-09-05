import {readFileSync} from 'node:fs';

import {describe, expect, it} from 'vitest';

import {
    mergeMethodHelp,
    methodsFor,
    RPC_METHOD_NAMES,
    RPC_METHODS,
    rpcMethod,
    unknownRpcMethod,
    type RpcMethod,
} from './methods.js';

const legacy = JSON.parse(
    readFileSync(new URL('../../../../legacy/www/js/rpcMethods.json', import.meta.url), 'utf8'),
) as Record<string, {params?: {name: string}[]; returns?: string; help?: {de?: string}}>;

describe('the catalogue', () => {
    it('carries the 51 methods of the 2.x file, unchanged', () => {
        expect(RPC_METHOD_NAMES).toHaveLength(51);
        expect(RPC_METHOD_NAMES).toEqual(Object.keys(legacy));
    });

    it('kept every argument name, type, return type and help text', () => {
        for (const [name, definition] of Object.entries(legacy)) {
            const method = RPC_METHODS[name];
            expect(method?.name).toBe(name);
            expect(method?.params.map((param) => param.name)).toEqual((definition.params ?? []).map((p) => p.name));
            expect(method?.returns).toBe(definition.returns ?? '');
            expect(method?.help.de).toBe(definition.help?.de);
        }
    });

    it('describes the methods the paramset dialogs use', () => {
        expect(RPC_METHODS['putParamset']?.params.map((param) => `${param.name}:${param.type}`)).toEqual([
            'address:address',
            'paramset_key:string',
            'set:paramset',
        ]);
        expect(RPC_METHODS['getParamsetDescription']?.returns).toBe('');
        expect(RPC_METHODS['getDeviceDescription']?.returns).toBe('DeviceDescription');
    });

    it('keeps the bit masks and value lists the console offers as check boxes', () => {
        expect(RPC_METHODS['deleteDevice']?.params[1]?.bitmask).toEqual({
            '1': 'DELETE_FLAG_RESET',
            '2': 'DELETE_FLAG_FORCE',
            '4': 'DELETE_FLAG_DEFER',
        });
        expect(RPC_METHODS['setRFLGWInfoLED']?.params[0]?.values).toEqual({
            '0': 'OFF',
            '1': 'ON',
            '2': 'FLASH_SLOW',
            '3': 'FLASH_FAST',
        });
    });

    it('marks the arguments that only some interfaces need', () => {
        expect(RPC_METHODS['addLink']?.params[2]?.optional).toEqual(['rfd', 'hs485d']);
        expect(RPC_METHODS['addLink']?.params[0]?.optional).toBeUndefined();
    });
});

describe('rpcMethod', () => {
    it('finds a method by name', () => {
        expect(rpcMethod('ping')?.name).toBe('ping');
        expect(rpcMethod('system.listMethods')?.name).toBe('system.listMethods');
    });

    it('does not find one that is not in the catalogue', () => {
        expect(rpcMethod('setValueNope')).toBeUndefined();
    });

    it('is not fooled by inherited object properties', () => {
        expect(rpcMethod('toString')).toBeUndefined();
        expect(rpcMethod('constructor')).toBeUndefined();
    });
});

describe('unknownRpcMethod', () => {
    it('builds a bare entry so the console can still call it', () => {
        expect(unknownRpcMethod('getFoo')).toEqual({name: 'getFoo', params: [], returns: '', help: {}});
    });
});

describe('methodsFor', () => {
    it('offers exactly what the interface reports, sorted', () => {
        const methods = methodsFor(['ping', 'getVersion', 'somethingElse']);
        expect(methods.map((method: RpcMethod) => method.name)).toEqual(['getVersion', 'ping', 'somethingElse']);
    });

    it('describes the ones the catalogue knows and leaves the rest bare', () => {
        const [known, unknown] = methodsFor(['listDevices', 'zzUnknown']);
        expect(known?.help.de).toBeTypeOf('string');
        expect(unknown).toEqual({name: 'zzUnknown', params: [], returns: '', help: {}});
    });

    it('leaves out catalogue methods the interface does not offer', () => {
        expect(methodsFor(['ping'])).toHaveLength(1);
        expect(methodsFor([])).toEqual([]);
    });
});

describe('mergeMethodHelp', () => {
    it('lets the interface own help text win for its language', () => {
        const merged = mergeMethodHelp('ping', 'Sendet ein Ping.');
        expect(merged.help.de).toBe('Sendet ein Ping.');
        expect(merged.name).toBe('ping');
        expect(merged.params).toEqual(RPC_METHODS['ping']?.params);
    });

    it('keeps the other languages', () => {
        const merged = mergeMethodHelp('ping', 'Sends a ping.', 'en');
        expect(merged.help.en).toBe('Sends a ping.');
        expect(merged.help.de).toBe(RPC_METHODS['ping']?.help.de);
    });

    it('does not overwrite a good text with an empty answer', () => {
        expect(mergeMethodHelp('ping', '').help.de).toBe(RPC_METHODS['ping']?.help.de);
    });

    it('produces an entry for a method the catalogue does not know', () => {
        expect(mergeMethodHelp('getFoo', 'Does foo.')).toEqual({
            name: 'getFoo',
            params: [],
            returns: '',
            help: {de: 'Does foo.'},
        });
    });

    it('leaves the catalogue itself untouched', () => {
        mergeMethodHelp('ping', 'changed');
        expect(RPC_METHODS['ping']?.help.de).not.toBe('changed');
    });
});
