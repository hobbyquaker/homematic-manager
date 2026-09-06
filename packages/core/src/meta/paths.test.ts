/**
 * The small rules of the format, one at a time.
 *
 * The conformance corpus reaches all of this, but only through whole documents and whole
 * operations: it answers "do the two implementations agree", not "what does this function do at
 * its edges". A ref whose address carries a second dot, a name of 255 bytes written in umlauts, a
 * tree exactly eight levels deep - the corpus never asks any of them, and they are the rules a
 * caller reads out of this file rather than out of the specification.
 */

import {describe, expect, it} from 'vitest';

import {
    byteLength,
    childPath,
    enumPaths,
    findNode,
    flattenEnum,
    isValidIcon,
    isValidId,
    isValidRef,
    makeRef,
    normaliseName,
    parsePath,
    parentPath,
    parseRef,
    pathMatches,
    requireDepth,
    requireId,
    requireRef,
    treeDepth,
} from './paths.js';
import type {MetaEnum, MetaNode} from './types.js';

const tree: readonly MetaNode[] = [
    {
        id: 'eg',
        name: 'Erdgeschoss',
        children: [
            {id: 'wohnzimmer', name: 'Wohnzimmer'},
            {id: 'bad', name: 'Bad', icon: 'shower'},
        ],
    },
    {id: 'og', name: 'Obergeschoss'},
];

const room: MetaEnum = {name: {de: 'Räume', en: 'Rooms'}, tree};

/** A chain of `depth` nodes, one child each - the cheapest way to hit the depth limit. */
function chain(depth: number): readonly MetaNode[] {
    let nodes: readonly MetaNode[] = [];
    for (let level = depth; level >= 1; level -= 1) {
        nodes = [{id: `n${level}`, name: `Level ${level}`, ...(nodes.length === 0 ? {} : {children: nodes})}];
    }
    return nodes;
}

describe('refs: <interface>.<address>', () => {
    it('splits at the first dot, so an address may carry one', () => {
        expect(parseRef('BidCos-RF.JEQ0230153:1')).toEqual({interfaceName: 'BidCos-RF', address: 'JEQ0230153:1'});
        expect(parseRef('HmIP-RF.000A.1B:2')).toEqual({interfaceName: 'HmIP-RF', address: '000A.1B:2'});
    });

    it('refuses anything that is not two halves', () => {
        expect(parseRef('BidCos-RF')).toBeUndefined();
        expect(parseRef('.JEQ0230153')).toBeUndefined();
        expect(parseRef('BidCos-RF.')).toBeUndefined();
        expect(parseRef('.')).toBeUndefined();
        expect(parseRef('')).toBeUndefined();
    });

    it('makeRef is the inverse', () => {
        expect(makeRef('BidCos-RF', 'JEQ0230153:1')).toBe('BidCos-RF.JEQ0230153:1');
        expect(parseRef(makeRef('HmIP-RF', '000A1B'))).toEqual({interfaceName: 'HmIP-RF', address: '000A1B'});
    });

    it('isValidRef and requireRef answer the same question, one of them loudly', () => {
        expect(isValidRef('BidCos-RF.JEQ0230153:1')).toBe(true);
        expect(isValidRef('BidCos-RF')).toBe(false);
        expect(requireRef('BidCos-RF.JEQ0230153:1').address).toBe('JEQ0230153:1');
        expect(() => requireRef('BidCos-RF')).toThrow(expect.objectContaining({code: 'invalid-ref'}));
    });
});

describe('ids and icons', () => {
    it('an id is lower case, starts with a letter or a digit and may carry hyphens', () => {
        expect(isValidId('room')).toBe(true);
        expect(isValidId('room-2')).toBe(true);
        expect(isValidId('2nd-floor')).toBe(true);
        expect(isValidId('Room')).toBe(false);
        expect(isValidId('-room')).toBe(false);
        expect(isValidId('my_room')).toBe(false);
        expect(isValidId('räume')).toBe(false);
        expect(isValidId('')).toBe(false);
    });

    it('an id is at most 32 characters', () => {
        expect(isValidId('a'.repeat(32))).toBe(true);
        expect(isValidId('a'.repeat(33))).toBe(false);
    });

    it('requireId hands the id back or refuses with invalid-id', () => {
        expect(requireId('wohnzimmer')).toBe('wohnzimmer');
        expect(() => requireId('Wohnzimmer')).toThrow(expect.objectContaining({code: 'invalid-id'}));
    });

    it('an icon is looser than an id: it may start with a hyphen, and it is never required', () => {
        expect(isValidIcon('shower')).toBe(true);
        expect(isValidIcon('-shower')).toBe(true);
        expect(isValidIcon('Shower')).toBe(false);
        expect(isValidIcon('')).toBe(false);
        expect(isValidIcon('a'.repeat(32))).toBe(true);
        expect(isValidIcon('a'.repeat(33))).toBe(false);
    });
});

describe('names', () => {
    it('trims, which is why writing a padded name over the same name is not a change', () => {
        expect(normaliseName('  Heizung Bad  ')).toBe('Heizung Bad');
        expect(normaliseName('\tWohnzimmer\n')).toBe('Wohnzimmer');
    });

    it('refuses what is not a string', () => {
        expect(() => normaliseName(42)).toThrow(expect.objectContaining({code: 'invalid-name'}));
        expect(() => normaliseName(undefined)).toThrow(expect.objectContaining({code: 'invalid-name'}));
        expect(() => normaliseName(null)).toThrow(expect.objectContaining({code: 'invalid-name'}));
    });

    it('refuses an empty name and one that is only whitespace', () => {
        expect(() => normaliseName('')).toThrow(expect.objectContaining({code: 'invalid-name'}));
        expect(() => normaliseName('   ')).toThrow(expect.objectContaining({code: 'invalid-name'}));
    });

    it('refuses a line break inside the name', () => {
        expect(() => normaliseName('Bad\nOben')).toThrow(expect.objectContaining({code: 'invalid-name'}));
        expect(() => normaliseName('Bad\rOben')).toThrow(expect.objectContaining({code: 'invalid-name'}));
    });

    it('measures the limit in bytes of UTF-8, not in characters', () => {
        expect(normaliseName('a'.repeat(255))).toHaveLength(255);
        expect(() => normaliseName('a'.repeat(256))).toThrow(expect.objectContaining({code: 'invalid-name'}));
        // an umlaut is two bytes: 127 of them plus one ASCII character is exactly the limit
        expect(normaliseName(`${'ä'.repeat(127)}x`)).toHaveLength(128);
        expect(() => normaliseName('ä'.repeat(128))).toThrow(expect.objectContaining({code: 'invalid-name'}));
    });

    it('byteLength counts UTF-8', () => {
        expect(byteLength('')).toBe(0);
        expect(byteLength('Bad')).toBe(3);
        expect(byteLength('ä')).toBe(2);
        expect(byteLength('€')).toBe(3);
        expect(byteLength('😀')).toBe(4);
    });
});

describe('paths', () => {
    it('splits an enum id off the ids below it', () => {
        expect(parsePath('room/eg/wohnzimmer')).toEqual({enumId: 'room', ids: ['eg', 'wohnzimmer']});
        expect(parsePath('room')).toEqual({enumId: 'room', ids: []});
    });

    it('refuses a path whose segments are not ids', () => {
        expect(parsePath('')).toBeUndefined();
        expect(parsePath('/room')).toBeUndefined();
        expect(parsePath('Room/eg')).toBeUndefined();
        expect(parsePath('room//eg')).toBeUndefined();
        expect(parsePath('room/Eg')).toBeUndefined();
    });

    it('childPath and parentPath are the two directions of one slash', () => {
        expect(childPath('room/eg', 'bad')).toBe('room/eg/bad');
        expect(parentPath('room/eg/bad')).toBe('room/eg');
        // the parent of a root node is the bare enum id, which the caller reads as "the root"
        expect(parentPath('room/eg')).toBe('room');
        expect(parentPath('room')).toBeUndefined();
        expect(parentPath('/room')).toBeUndefined();
    });

    it('pathMatches is the subtree rule: the node itself and everything below it', () => {
        expect(pathMatches('room/eg', 'room/eg')).toBe(true);
        expect(pathMatches('room/eg/bad', 'room/eg')).toBe(true);
        expect(pathMatches('room/eg', 'room')).toBe(true);
        expect(pathMatches('room/egon', 'room/eg')).toBe(false);
        expect(pathMatches('room/og', 'room/eg')).toBe(false);
    });
});

describe('walking a tree', () => {
    it('findNode follows the ids of a path', () => {
        expect(findNode(tree, ['eg'])?.name).toBe('Erdgeschoss');
        expect(findNode(tree, ['eg', 'bad'])?.name).toBe('Bad');
    });

    it('findNode answers undefined for a node that is not there, at any depth', () => {
        expect(findNode(tree, ['keller'])).toBeUndefined();
        expect(findNode(tree, ['eg', 'keller'])).toBeUndefined();
        // `og` has no children at all, so the second step has nothing to search
        expect(findNode(tree, ['og', 'bad'])).toBeUndefined();
        expect(findNode(tree, [])).toBeUndefined();
    });

    it('flattenEnum walks depth first and hands out the path, the level and the trail of names', () => {
        expect(flattenEnum('room', room).map((entry) => entry.path)).toEqual([
            'room/eg',
            'room/eg/wohnzimmer',
            'room/eg/bad',
            'room/og',
        ]);
        expect(flattenEnum('room', room).map((entry) => entry.depth)).toEqual([1, 2, 2, 1]);
        expect(flattenEnum('room', room).map((entry) => entry.trail)).toEqual([
            ['Erdgeschoss'],
            ['Erdgeschoss', 'Wohnzimmer'],
            ['Erdgeschoss', 'Bad'],
            ['Obergeschoss'],
        ]);
    });

    it('flattenEnum of an empty tree is empty', () => {
        expect(flattenEnum('floor', {name: {en: 'Floors'}, tree: []})).toEqual([]);
    });

    it('enumPaths is the same list as a set', () => {
        expect([...enumPaths('room', room)].sort()).toEqual([
            'room/eg',
            'room/eg/bad',
            'room/eg/wohnzimmer',
            'room/og',
        ]);
    });
});

describe('depth', () => {
    it('counts the deepest level, and an empty tree is zero', () => {
        expect(treeDepth([])).toBe(0);
        expect(treeDepth(tree)).toBe(2);
        expect(treeDepth(chain(8))).toBe(8);
    });

    it('requireDepth allows the eight levels the format has and refuses the ninth', () => {
        expect(() => {
            requireDepth(chain(8));
        }).not.toThrow();
        expect(() => {
            requireDepth(chain(9));
        }).toThrow(expect.objectContaining({code: 'too-deep'}));
    });
});
