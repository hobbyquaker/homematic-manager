import {describe, expect, it, vi} from 'vitest';

import {ApiEventEmitter} from './emitter.js';

describe('ApiEventEmitter', () => {
    it('delivers a payload to every handler of the event', () => {
        const emitter = new ApiEventEmitter();
        const first = vi.fn();
        const second = vi.fn();
        emitter.on('notice', first);
        emitter.on('notice', second);
        emitter.emit('notice', {level: 'warn', message: 'ReGa is not answering'});
        expect(first).toHaveBeenCalledWith({level: 'warn', message: 'ReGa is not answering'});
        expect(second).toHaveBeenCalledOnce();
    });

    it('does not deliver to other events', () => {
        const emitter = new ApiEventEmitter();
        const handler = vi.fn();
        emitter.on('names.changed', handler);
        emitter.emit('notice', {level: 'info', message: 'x'});
        expect(handler).not.toHaveBeenCalled();
    });

    it('unsubscribes through the returned function', () => {
        const emitter = new ApiEventEmitter();
        const handler = vi.fn();
        const off = emitter.on('write.progress', handler);
        off();
        emitter.emit('write.progress', {done: 1, total: 2});
        expect(handler).not.toHaveBeenCalled();
        expect(emitter.listenerCount('write.progress')).toBe(0);
    });

    it('forwards every event to an onAny subscriber', () => {
        const emitter = new ApiEventEmitter();
        const seen: string[] = [];
        const off = emitter.onAny((event) => {
            seen.push(event);
        });
        emitter.emit('notice', {level: 'info', message: 'a'});
        emitter.emit('names.changed', {'ABC:1': 'Lamp'});
        off();
        emitter.emit('notice', {level: 'info', message: 'b'});
        expect(seen).toEqual(['notice', 'names.changed']);
    });

    it('keeps going when a handler throws and reports it', () => {
        const onHandlerError = vi.fn();
        const emitter = new ApiEventEmitter(onHandlerError);
        const second = vi.fn();
        emitter.on('notice', () => {
            throw new Error('handler is broken');
        });
        emitter.on('notice', second);
        emitter.onAny(() => {
            throw new Error('any handler is broken');
        });
        emitter.emit('notice', {level: 'error', message: 'x'});
        expect(second).toHaveBeenCalledOnce();
        expect(onHandlerError).toHaveBeenCalledTimes(2);
        expect(onHandlerError.mock.calls[0]?.[0]).toBe('notice');
    });

    it('counts listeners and clears them all', () => {
        const emitter = new ApiEventEmitter();
        emitter.on('notice', vi.fn());
        emitter.on('notice', vi.fn());
        expect(emitter.listenerCount('notice')).toBe(2);
        emitter.clear();
        expect(emitter.listenerCount('notice')).toBe(0);
    });
});
