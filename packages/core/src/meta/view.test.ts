/**
 * The read side: a tree turned into the arrays of names every consumer downstream expects.
 *
 * The corpus never touches this file - it is about the store's semantics, not about what a grid
 * shows - and yet this is where the porting rule of openccu-lite lives: whatever an integration
 * published as `rooms` and `functions` keeps publishing arrays of names. The two properties worth
 * pinning down are that the order comes from the tree rather than from the order somebody was
 * assigned to it, and that a name appearing twice in the tree appears once in the array.
 */

import {describe, expect, it} from 'vitest';

import {enumNames, enumTitle, flattenAll, nodeAt, pathName, summarise, summariseAll} from './view.js';
import type {MetaDocument, MetaEnum, MetaObject} from './types.js';

const enums: Readonly<Record<string, MetaEnum>> = {
    room: {
        name: {de: 'Räume', en: 'Rooms'},
        tree: [
            {
                id: 'eg',
                name: 'Erdgeschoss',
                children: [
                    {id: 'wohnzimmer', name: 'Wohnzimmer'},
                    {id: 'bad', name: 'Bad'},
                ],
            },
            {id: 'og', name: 'Obergeschoss', children: [{id: 'bad', name: 'Bad'}]},
        ],
    },
    function: {
        name: {en: 'Functions'},
        tree: [
            {id: 'licht', name: 'Licht'},
            {id: 'heizung', name: 'Heizung'},
        ],
    },
};

const licht: MetaObject = {
    name: 'Licht Bad',
    enums: ['function/licht', 'room/og/bad'],
    meta: {},
};

describe('enumTitle', () => {
    it('answers in the language it is asked for', () => {
        expect(enumTitle('room', enums['room'], 'de')).toBe('Räume');
    });

    it('falls back to English, and then to the id', () => {
        expect(enumTitle('room', enums['room'], 'fr')).toBe('Rooms');
        expect(enumTitle('function', enums['function'], 'de')).toBe('Functions');
        expect(enumTitle('floor', undefined, 'de')).toBe('floor');
        expect(enumTitle('floor', {name: {}, tree: []}, 'de')).toBe('floor');
    });
});

describe('nodeAt and pathName', () => {
    it('resolves a path to its node, its level and the names above it', () => {
        expect(nodeAt(enums, 'room/eg/bad')).toEqual({
            path: 'room/eg/bad',
            node: {id: 'bad', name: 'Bad'},
            depth: 2,
            trail: ['Erdgeschoss', 'Bad'],
        });
    });

    it('answers undefined for anything that is not a node of a known enum', () => {
        // a bare enum id is a query target, never a node
        expect(nodeAt(enums, 'room')).toBeUndefined();
        expect(nodeAt(enums, 'Room/eg')).toBeUndefined();
        expect(nodeAt(enums, 'floor/eg')).toBeUndefined();
        expect(nodeAt(enums, 'room/keller')).toBeUndefined();
    });

    it('pathName shows the name, or the path itself when it does not resolve', () => {
        expect(pathName(enums, 'room/og/bad')).toBe('Bad');
        expect(pathName(enums, 'room/keller')).toBe('room/keller');
    });
});

describe('enumNames', () => {
    it('lists in tree order, not in the order the paths were handed over', () => {
        expect(enumNames(enums, ['room/og', 'room/eg/wohnzimmer', 'function/heizung', 'function/licht'])).toEqual([
            'Wohnzimmer',
            'Obergeschoss',
            'Licht',
            'Heizung',
        ]);
    });

    it('says a name once, however many nodes carry it', () => {
        expect(enumNames(enums, ['room/og/bad', 'room/eg/bad'])).toEqual(['Bad']);
        expect(enumNames(enums, ['room/eg/bad', 'room/eg/bad'])).toEqual(['Bad']);
    });

    it('skips a path that is not one, and a bare enum id', () => {
        expect(enumNames(enums, ['room', 'Room/eg', 'room/eg/wohnzimmer'])).toEqual(['Wohnzimmer']);
    });

    it('with ancestors, a channel in a room is also in the floor above it', () => {
        expect(enumNames(enums, ['room/eg/wohnzimmer'], {ancestors: true})).toEqual(['Erdgeschoss', 'Wohnzimmer']);
        expect(enumNames(enums, ['room/eg'], {ancestors: true})).toEqual(['Erdgeschoss']);
    });

    it('with enumId, only that enum - and paths of the others are not even looked at', () => {
        expect(enumNames(enums, licht.enums, {enumId: 'room'})).toEqual(['Bad']);
        expect(enumNames(enums, licht.enums, {enumId: 'function'})).toEqual(['Licht']);
        expect(enumNames(enums, licht.enums, {enumId: 'floor'})).toEqual([]);
    });
});

describe('flattenAll', () => {
    it('flattens every enum once, keyed by its id', () => {
        const flat = flattenAll(enums);
        expect(Object.keys(flat)).toEqual(['room', 'function']);
        expect(flat['room']?.map((entry) => entry.path)).toEqual([
            'room/eg',
            'room/eg/wohnzimmer',
            'room/eg/bad',
            'room/og',
            'room/og/bad',
        ]);
        expect(flat['function']).toHaveLength(2);
    });
});

describe('summarise', () => {
    it('is one object as the flat rooms and functions everything downstream has always been given', () => {
        expect(summarise(enums, licht)).toEqual({
            name: 'Licht Bad',
            rooms: ['Bad'],
            functions: ['Licht'],
            paths: ['function/licht', 'room/og/bad'],
            orphaned: false,
        });
    });

    it('passes its options through to both enums', () => {
        expect(summarise(enums, licht, {ancestors: true}).rooms).toEqual(['Obergeschoss', 'Bad']);
    });

    it('says orphaned when the object is', () => {
        expect(summarise(enums, {name: 'Licht', enums: [], meta: {}, orphaned: true})).toEqual({
            name: 'Licht',
            rooms: [],
            functions: [],
            paths: [],
            orphaned: true,
        });
    });

    it('summariseAll does the same for a whole document, keyed by ref', () => {
        const document: MetaDocument = {
            format: 1,
            revision: 4,
            enums,
            objects: {
                'BidCos-RF.JEQ0230153:1': licht,
                'BidCos-RF.JEQ0230153:2': {name: 'Taster', enums: [], meta: {}},
            },
        };
        const summaries = summariseAll(document, {ancestors: true});
        expect(Object.keys(summaries)).toEqual(['BidCos-RF.JEQ0230153:1', 'BidCos-RF.JEQ0230153:2']);
        expect(summaries['BidCos-RF.JEQ0230153:1']?.rooms).toEqual(['Obergeschoss', 'Bad']);
        expect(summaries['BidCos-RF.JEQ0230153:2']?.functions).toEqual([]);
        expect(summariseAll({format: 1, revision: 0, enums: {}, objects: {}})).toEqual({});
    });
});
