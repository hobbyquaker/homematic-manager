/**
 * The store, where the corpus does not look.
 *
 * Everything about *semantics* - which write bumps a revision, which one is refused with which
 * code, what a query answers - belongs in the corpus and is checked there against the Go
 * implementation. What is left over is the part of this class that only exists here: the listener a
 * caller passes in, the replay window that is a number rather than a rule, `load` for a store that
 * mirrors a box instead of owning one, and the plain reads a UI does per row. Those have no
 * counterpart upstream, so this file is the only thing keeping them honest.
 */

import {describe, expect, it} from 'vitest';

import {MetaStore, mergeMeta} from './store.js';
import type {MetaEvent} from './types.js';

/** A store with one floor, one room in it and one channel in that room. */
function furnished(): MetaStore {
    const store = new MetaStore();
    store.createNode('room', null, 'eg', 'Erdgeschoss');
    store.createNode('room', 'room/eg', 'bad', 'Bad');
    store.set('BidCos-RF.JEQ0230153:1', {name: 'Licht Bad', enums: ['room/eg/bad']});
    return store;
}

describe('the event listener', () => {
    it('is called once per event, after the write, with the revision the write produced', () => {
        const seen: MetaEvent[] = [];
        const store = new MetaStore({onEvent: (event) => seen.push(event)});
        store.createEnum('area', {en: 'Areas'});
        store.createNode('area', null, 'garten', 'Garten');
        expect(seen.map((event) => [event.kind, event.revision])).toEqual([
            ['enum.created', 1],
            ['node.created', 2],
        ]);
        expect(seen[1]?.value).toEqual({id: 'garten', name: 'Garten'});
    });

    it('hears one event per entry of a bulk, all carrying the one revision the bulk is', () => {
        const seen: MetaEvent[] = [];
        const store = new MetaStore({onEvent: (event) => seen.push(event)});
        store.bulk({'BidCos-RF.A001': {name: 'Eins'}, 'BidCos-RF.A002': {name: 'Zwei'}});
        expect(seen.map((event) => event.revision)).toEqual([1, 1]);
    });

    it('is not called for a write that changes nothing', () => {
        const seen: MetaEvent[] = [];
        const store = new MetaStore({onEvent: (event) => seen.push(event)});
        store.set('BidCos-RF.A001', {name: 'Eins'});
        expect(store.set('BidCos-RF.A001', {name: '  Eins  '}).changed).toBe(false);
        expect(seen).toHaveLength(1);
    });
});

describe('since', () => {
    it('answers with the events after a revision', () => {
        const store = furnished();
        expect(store.since(1).events?.map((event) => event.kind)).toEqual(['node.created', 'object.updated']);
        expect(store.since(store.revision).events).toEqual([]);
    });

    it('says resync when the history no longer reaches back that far', () => {
        const store = new MetaStore({eventHistory: 1});
        store.createEnum('area', {en: 'Areas'});
        store.createEnum('zone', {en: 'Zones'});
        expect(store.since(0)).toEqual({revision: 2, resync: true});
        // the one event still in the window is served as usual
        expect(store.since(1).events?.map((event) => event.kind)).toEqual(['enum.created']);
    });

    it('says resync for a revision that cannot be asked for', () => {
        const store = furnished();
        expect(store.since(-1).resync).toBe(true);
        expect(store.since(1.5).resync).toBe(true);
        expect(store.since(store.revision + 1).resync).toBe(true);
    });
});

describe('load', () => {
    it('takes a whole document without inventing a revision of its own', () => {
        const box = furnished();
        const mirror = new MetaStore();
        mirror.load(box.document());
        expect(mirror.document()).toEqual(box.document());
        expect(mirror.revision).toBe(box.revision);
        expect(mirror.size).toBe(1);
    });

    it('produces no event and forgets the history it had', () => {
        const seen: MetaEvent[] = [];
        const mirror = new MetaStore({onEvent: (event) => seen.push(event)});
        mirror.set('BidCos-RF.A001', {name: 'Eins'});
        mirror.load(furnished().document());
        expect(seen.map((event) => event.kind)).toEqual(['object.updated']);
        expect(mirror.find('BidCos-RF.A001')).toBeUndefined();
        // everything before the snapshot is gone, so the only honest answer to an older `since` is
        // to ask for the snapshot again
        expect(mirror.since(1).resync).toBe(true);
        expect(mirror.since(mirror.revision).events).toEqual([]);
    });
});

describe('the plain reads', () => {
    it('find answers undefined where get refuses', () => {
        const store = furnished();
        expect(store.find('BidCos-RF.JEQ0230153:1')?.name).toBe('Licht Bad');
        expect(store.find('BidCos-RF.JEQ0230153:9')).toBeUndefined();
        expect(() => store.get('BidCos-RF.JEQ0230153:9')).toThrow(expect.objectContaining({code: 'unknown-object'}));
    });

    it('objects and enums hand out everything, keyed', () => {
        const store = furnished();
        expect(Object.keys(store.objects())).toEqual(['BidCos-RF.JEQ0230153:1']);
        expect(Object.keys(store.enums())).toEqual(['room', 'function', 'floor']);
        expect(store.enums()['room']?.tree[0]?.children?.[0]?.name).toBe('Bad');
    });

    it('getEnum refuses an enum that is not there', () => {
        const store = furnished();
        expect(store.getEnum('room').name['en']).toBe('Rooms');
        expect(() => store.getEnum('area')).toThrow(expect.objectContaining({code: 'unknown-enum'}));
    });

    it('document sorts the objects by ref, whatever order they were written in', () => {
        const store = new MetaStore();
        store.set('BidCos-RF.C003', {name: 'Drei'});
        store.set('BidCos-RF.A001', {name: 'Eins'});
        store.set('BidCos-RF.B002', {name: 'Zwei'});
        expect(Object.keys(store.document().objects)).toEqual(['BidCos-RF.A001', 'BidCos-RF.B002', 'BidCos-RF.C003']);
    });
});

describe('mergeMeta', () => {
    it('replaces a namespace whole - the store cannot merge what it does not interpret', () => {
        expect(mergeMeta({hmm: {colour: 'red', size: 2}}, {hmm: {colour: 'blue'}})).toEqual({hmm: {colour: 'blue'}});
    });

    it('keeps the namespaces the patch does not mention and adds the ones it brings', () => {
        expect(mergeMeta({hmm: {a: 1}}, {mqtt: {topic: 'x'}})).toEqual({hmm: {a: 1}, mqtt: {topic: 'x'}});
    });

    it('null removes one', () => {
        expect(mergeMeta({hmm: {a: 1}, mqtt: {topic: 'x'}}, {hmm: null})).toEqual({mqtt: {topic: 'x'}});
    });

    it('refuses a namespace that is not spelled like an id', () => {
        expect(() => mergeMeta({}, {Hmm: {a: 1}})).toThrow(expect.objectContaining({code: 'invalid-id'}));
    });
});

describe('nodes', () => {
    it('createNode puts a node where position says, and appends without one', () => {
        const store = new MetaStore();
        store.createNode('room', null, 'eg', 'Erdgeschoss');
        store.createNode('room', null, 'og', 'Obergeschoss');
        store.createNode('room', null, 'keller', 'Keller', {position: 0});
        store.createNode('room', null, 'dach', 'Dachboden', {position: 99});
        expect(store.getEnum('room').tree.map((node) => node.id)).toEqual(['keller', 'eg', 'og', 'dach']);
    });

    it('createNode takes an icon and refuses one that is not an icon name', () => {
        const store = new MetaStore();
        store.createNode('room', null, 'eg', 'Erdgeschoss', {icon: 'stairs'});
        expect(store.getEnum('room').tree[0]?.icon).toBe('stairs');
        expect(() => store.createNode('room', null, 'og', 'Obergeschoss', {icon: 'Stairs'})).toThrow(
            expect.objectContaining({code: 'invalid-id'}),
        );
    });

    it('updateNode sets an icon, keeps it through a rename, and refuses a bad one', () => {
        const store = furnished();
        expect(store.updateNode('room/eg/bad', {icon: 'shower'}).changed).toBe(true);
        expect(store.getEnum('room').tree[0]?.children?.[0]?.icon).toBe('shower');
        // the icon is not part of a rename, so it survives one
        store.updateNode('room/eg/bad', {name: 'Badezimmer'});
        expect(store.getEnum('room').tree[0]?.children?.[0]).toEqual({id: 'bad', name: 'Badezimmer', icon: 'shower'});
        expect(store.updateNode('room/eg/bad', {icon: 'shower'}).changed).toBe(false);
        expect(() => store.updateNode('room/eg/bad', {icon: 'Shower'})).toThrow(
            expect.objectContaining({code: 'invalid-id'}),
        );
    });
});

describe('deleting something that still has members', () => {
    it('deleteNode names the refs that would lose a path', () => {
        const store = furnished();
        store.set('BidCos-RF.JEQ0230153:2', {name: 'Taster', enums: ['room/eg/bad']});
        expect(() => store.deleteNode('room/eg')).toThrow(
            expect.objectContaining({
                code: 'has-members',
                detail: {refs: ['BidCos-RF.JEQ0230153:1', 'BidCos-RF.JEQ0230153:2']},
            }),
        );
        expect(store.getEnum('room').tree).toHaveLength(1);
    });

    it('deleteEnum does the same for a whole enum', () => {
        const store = furnished();
        expect(() => store.deleteEnum('room')).toThrow(
            expect.objectContaining({code: 'has-members', detail: {refs: ['BidCos-RF.JEQ0230153:1']}}),
        );
        expect(store.revision).toBe(3);
    });
});

describe('the writes the corpus does not ask for', () => {
    it('a new object needs a name; an existing one keeps the one it has', () => {
        const store = new MetaStore();
        expect(() => store.set('BidCos-RF.A001', {enums: []})).toThrow(expect.objectContaining({code: 'invalid-name'}));
        store.set('BidCos-RF.A001', {name: 'Eins'});
        expect(store.set('BidCos-RF.A001', {enums: []}).changed).toBe(false);
    });

    it('deleting what is not there is the state the caller asked for, not an error', () => {
        const store = furnished();
        expect(store.delete('BidCos-RF.NOPE:1')).toEqual({revision: 3, changed: false});
    });

    it('a bulk with nothing in it does not bump the revision either', () => {
        const store = furnished();
        expect(store.bulk({}, ['BidCos-RF.NOPE:1'])).toEqual({revision: 3, changed: false});
    });

    it('updateEnum renames an enum, and renaming it to what it is called is not a write', () => {
        const store = furnished();
        expect(store.updateEnum('room', {de: 'Zimmer', en: 'Rooms'}).changed).toBe(true);
        expect(store.getEnum('room').name).toEqual({de: 'Zimmer', en: 'Rooms'});
        // and the tree it has is none of that operation's business
        expect(store.getEnum('room').tree).toHaveLength(1);
        expect(store.updateEnum('room', {de: 'Zimmer', en: 'Rooms'}).changed).toBe(false);
        expect(() => store.updateEnum('area', {en: 'Areas'})).toThrow(expect.objectContaining({code: 'unknown-enum'}));
    });

    it('a node operation needs a path that addresses a node', () => {
        const store = furnished();
        expect(() => store.updateNode('room', {name: 'Zimmer'})).toThrow(
            expect.objectContaining({code: 'unknown-path'}),
        );
        expect(() => store.updateNode('room/keller', {name: 'Keller'})).toThrow(
            expect.objectContaining({code: 'unknown-path'}),
        );
        expect(() => store.deleteNode('room/keller')).toThrow(expect.objectContaining({code: 'unknown-path'}));
        expect(() => store.createNode('room', 'function/licht', 'bad', 'Bad')).toThrow(
            expect.objectContaining({code: 'unknown-path'}),
        );
    });

    it('a query needs a target that is a path at all', () => {
        const store = furnished();
        expect(() => store.query('Room/eg')).toThrow(expect.objectContaining({code: 'unknown-path'}));
        expect(store.query('room')).toEqual(['BidCos-RF.JEQ0230153:1']);
    });

    it('a rename keeps the subtree below the node', () => {
        const store = furnished();
        store.updateNode('room/eg', {name: 'Untergeschoss'});
        expect(store.getEnum('room').tree[0]).toEqual({
            id: 'eg',
            name: 'Untergeschoss',
            children: [{id: 'bad', name: 'Bad'}],
        });
    });

    it('parent: null moves a node to the root of its enum and rewrites what pointed at it', () => {
        const store = furnished();
        expect(store.updateNode('room/eg/bad', {parent: null}).changed).toBe(true);
        expect(store.getEnum('room').tree.map((node) => node.id)).toEqual(['eg', 'bad']);
        expect(store.get('BidCos-RF.JEQ0230153:1').enums).toEqual(['room/bad']);
    });

    it('moves into a parent that has no children yet, and refuses one that has the id already', () => {
        const store = furnished();
        store.createNode('room', null, 'og', 'Obergeschoss');
        store.updateNode('room/eg/bad', {parent: 'room/og'});
        expect(store.get('BidCos-RF.JEQ0230153:1').enums).toEqual(['room/og/bad']);

        store.createNode('room', 'room/eg', 'bad', 'Bad unten');
        expect(() => store.updateNode('room/eg/bad', {parent: 'room/og'})).toThrow(
            expect.objectContaining({code: 'duplicate-id'}),
        );
    });

    it('a node that loses its last child loses the children key with it', () => {
        const store = furnished();
        store.updateNode('room/eg', {icon: 'stairs'});
        store.deleteNode('room/eg/bad', 'detach');
        expect(store.getEnum('room').tree[0]).toEqual({id: 'eg', name: 'Erdgeschoss', icon: 'stairs'});
        expect(store.get('BidCos-RF.JEQ0230153:1').enums).toEqual([]);
    });
});
