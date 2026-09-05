import {describe, expect, it} from 'vitest';

import {NameStore} from './names.js';

describe('NameStore', () => {
    it('names a device and its maintenance channel with it, as 2.x did', () => {
        const store = new NameStore();
        expect(store.set([{address: 'ABC1', name: 'Lamp'}])).toEqual([
            {address: 'ABC1', name: 'Lamp'},
            {address: 'ABC1:0', name: 'Lamp:0'},
        ]);
        expect(store.all()).toEqual({ABC1: 'Lamp', 'ABC1:0': 'Lamp:0'});
        expect(store.size).toBe(2);
    });

    it('names a channel without inventing anything', () => {
        const store = new NameStore();
        expect(store.set([{address: 'ABC1:1', name: ' Living room '}])).toEqual([
            {address: 'ABC1:1', name: 'Living room'},
        ]);
        expect(store.get('ABC1:1')).toBe('Living room');
    });

    it('ignores an empty address or name', () => {
        const store = new NameStore();
        expect(
            store.set([
                {address: '', name: 'x'},
                {address: 'A', name: '  '},
            ]),
        ).toEqual([]);
        expect(store.size).toBe(0);
    });

    it('moves a name and its rega id when a device is replaced', () => {
        const store = new NameStore();
        store.set([{address: 'ABC1:1', name: 'Lamp'}]);
        store.applyRega([{address: 'ABC1:1', name: 'Lamp', id: 4711}]);
        store.rename('ABC1:1', 'DEF1:1');
        expect(store.get('DEF1:1')).toBe('Lamp');
        expect(store.get('ABC1:1')).toBeUndefined();
        expect(store.regaId('DEF1:1')).toBe(4711);
        expect(store.regaId('ABC1:1')).toBeUndefined();
    });

    it('does nothing when renaming something it does not know', () => {
        const store = new NameStore();
        store.rename('A', 'B');
        expect(store.size).toBe(0);
    });

    it('lets ReGa win and remembers the object ids for the rename script', () => {
        const store = new NameStore();
        store.set([{address: 'ABC1:1', name: 'local'}]);
        expect(store.applyRega([{address: 'ABC1:1', name: 'Wohnzimmer Lampe', id: 4711}])).toBe(true);
        expect(store.get('ABC1:1')).toBe('Wohnzimmer Lampe');
        expect(store.regaId('ABC1:1')).toBe(4711);
        // nothing new: no change reported
        expect(store.applyRega([{address: 'ABC1:1', name: 'Wohnzimmer Lampe', id: 4711}])).toBe(false);
    });

    it('skips a ReGa channel without an address', () => {
        const store = new NameStore();
        expect(store.applyRega([{address: '', name: 'x', id: 1}])).toBe(false);
    });

    it('round-trips through JSON and survives a broken snapshot', () => {
        const store = new NameStore();
        store.set([{address: 'ABC1:1', name: 'Lamp'}]);
        store.applyRega([{address: 'ABC1:1', name: 'Lamp', id: 4711}]);
        const restored = new NameStore();
        restored.load(JSON.parse(JSON.stringify(store.toJSON())) as unknown);
        expect(restored.get('ABC1:1')).toBe('Lamp');
        expect(restored.regaId('ABC1:1')).toBe(4711);
        restored.load('nonsense');
        expect(restored.size).toBe(0);
        restored.load({names: {A: 1, B: 'ok'}, regaIds: {B: 'no', C: 7}});
        expect(restored.all()).toEqual({B: 'ok'});
        expect(restored.regaId('C')).toBe(7);
    });

    it('clears everything', () => {
        const store = new NameStore();
        store.set([{address: 'A:1', name: 'x'}]);
        store.clear();
        expect(store.all()).toEqual({});
    });
});
