import {describe, expect, it} from 'vitest';

import type {ApiFrame} from '@homematic-manager/core';

import {decodeFrame, encodeFrame, errorFrame, responseFrame} from './codec.js';

describe('encodeFrame / decodeFrame', () => {
    it('round-trips every frame of the contract', () => {
        const frames: ApiFrame[] = [
            {t: 'req', id: 1, m: 'config.get', p: []},
            {t: 'res', id: 1, r: {version: '3.0.0-dev.0'}},
            {t: 'err', id: 2, e: {message: 'nope', kind: 'rpc', faultCode: -7}},
            {t: 'ev', n: 'notice', d: {level: 'warn', message: 'x'}},
        ];
        for (const frame of frames) {
            expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
        }
    });

    it('reads a frame that arrived as a buffer', () => {
        const text = encodeFrame({t: 'req', id: 3, m: 'names.get', p: []});
        expect(decodeFrame(Buffer.from(text))).toEqual({t: 'req', id: 3, m: 'names.get', p: []});
        expect(decodeFrame(new TextEncoder().encode(text).buffer)).toMatchObject({t: 'req', id: 3});
        expect(decodeFrame([Buffer.from(text.slice(0, 5)), Buffer.from(text.slice(5))])).toMatchObject({id: 3});
    });

    it('rejects what is not a frame', () => {
        expect(decodeFrame(42)).toBeUndefined();
        expect(decodeFrame('not json')).toBeUndefined();
        expect(decodeFrame('[1,2,3]')).toBeUndefined();
        expect(decodeFrame('null')).toBeUndefined();
        expect(decodeFrame('{"t":"nope"}')).toBeUndefined();
    });

    it('rejects a frame with the wrong fields', () => {
        expect(decodeFrame('{"t":"req","id":"1","m":"config.get","p":[]}')).toBeUndefined();
        expect(decodeFrame('{"t":"req","id":1,"m":"config.get"}')).toBeUndefined();
        expect(decodeFrame('{"t":"req","id":1,"p":[]}')).toBeUndefined();
        expect(decodeFrame('{"t":"res"}')).toBeUndefined();
        expect(decodeFrame('{"t":"err","id":1,"e":{"message":"x"}}')).toBeUndefined();
        expect(decodeFrame('{"t":"ev","d":1}')).toBeUndefined();
    });

    it('builds a response and an error frame', () => {
        expect(responseFrame(7, {a: 1})).toEqual({t: 'res', id: 7, r: {a: 1}});
        // a method without a result value resolves with null, which both transports carry
        expect(responseFrame(7, undefined)).toEqual({t: 'res', id: 7, r: null});
        expect(errorFrame(7, {message: 'x', kind: 'internal'})).toEqual({
            t: 'err',
            id: 7,
            e: {message: 'x', kind: 'internal'},
        });
    });
});
