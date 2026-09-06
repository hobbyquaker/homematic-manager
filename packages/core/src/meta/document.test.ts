/**
 * The validator, checked one refusal at a time.
 *
 * The corpus has ten documents and names the code each of them is refused with, which proves that
 * both implementations agree about those ten. It does not reach every code this file can produce -
 * a `meta` block over 16 KiB, an enum name that exists only in German, a document that is not an
 * object at all - and each of those is a message an import dialog shows to somebody who has to
 * repair a file. So they are checked here, by code and never by message: the message is prose and
 * may be rewritten, the code is the contract.
 */

import {describe, expect, it} from 'vitest';

import {
    documentEquals,
    documentJson,
    knownPaths,
    normaliseEnum,
    normaliseEnumList,
    normaliseEnumName,
    normaliseMeta,
    normaliseNode,
    normaliseNodes,
    normaliseObject,
    parseDocument,
    parseDocumentOrEmpty,
} from './document.js';
import {isMetaError, type MetaDocument, type MetaError} from './types.js';

/** A document that loads, as an untyped literal - the shape a file or an import really arrives in. */
function raw(): Record<string, unknown> {
    return {
        format: 1,
        revision: 3,
        enums: {
            room: {
                name: {de: 'Räume', en: 'Rooms'},
                tree: [{id: 'eg', name: 'Erdgeschoss', children: [{id: 'bad', name: 'Bad', icon: 'shower'}]}],
            },
        },
        objects: {
            'BidCos-RF.JEQ0230153:1': {name: 'Licht Bad', enums: ['room/eg/bad'], meta: {hmm: {colour: 'red'}}},
        },
    };
}

describe('normaliseObject', () => {
    it('fills in the fields the store always keeps', () => {
        expect(normaliseObject({name: '  Licht Bad  '})).toEqual({name: 'Licht Bad', enums: [], meta: {}});
    });

    it('keeps orphaned only when it is true, which is what a byte comparison needs', () => {
        expect(normaliseObject({name: 'Licht', orphaned: true})).toEqual({
            name: 'Licht',
            enums: [],
            meta: {},
            orphaned: true,
        });
        expect(normaliseObject({name: 'Licht', orphaned: false})).not.toHaveProperty('orphaned');
    });

    it('refuses anything that is not an object', () => {
        expect(() => normaliseObject('Licht')).toThrow(expect.objectContaining({code: 'invalid-name'}));
        expect(() => normaliseObject(null)).toThrow(expect.objectContaining({code: 'invalid-name'}));
        expect(() => normaliseObject([])).toThrow(expect.objectContaining({code: 'invalid-name'}));
    });
});

describe('normaliseEnumList', () => {
    it('an absent list is an empty one', () => {
        expect(normaliseEnumList(undefined)).toEqual([]);
        expect(normaliseEnumList(null)).toEqual([]);
    });

    it('takes node paths and keeps their order', () => {
        expect(normaliseEnumList(['room/eg/bad', 'function/licht'])).toEqual(['room/eg/bad', 'function/licht']);
    });

    it('refuses what is not a list of paths', () => {
        expect(() => normaliseEnumList('room/eg')).toThrow(expect.objectContaining({code: 'unknown-path'}));
        expect(() => normaliseEnumList([42])).toThrow(expect.objectContaining({code: 'unknown-path'}));
        expect(() => normaliseEnumList(['Room/eg'])).toThrow(expect.objectContaining({code: 'unknown-path'}));
    });

    it('refuses the same path twice', () => {
        expect(() => normaliseEnumList(['room/eg', 'room/eg'])).toThrow(
            expect.objectContaining({code: 'duplicate-path'}),
        );
    });
});

describe('normaliseMeta', () => {
    it('an absent block is an empty one, and what is inside a namespace is never looked at', () => {
        expect(normaliseMeta(undefined)).toEqual({});
        expect(normaliseMeta(null)).toEqual({});
        expect(normaliseMeta({hmm: {anything: [1, null, {deep: true}]}})).toEqual({
            hmm: {anything: [1, null, {deep: true}]},
        });
    });

    it('refuses a block that is not an object of namespaces', () => {
        expect(() => normaliseMeta('hmm')).toThrow(expect.objectContaining({code: 'invalid-id'}));
        expect(() => normaliseMeta([])).toThrow(expect.objectContaining({code: 'invalid-id'}));
    });

    it('refuses a namespace that is not spelled like an id', () => {
        expect(() => normaliseMeta({Hmm: {}})).toThrow(expect.objectContaining({code: 'invalid-id'}));
        expect(() => normaliseMeta({'my ns': {}})).toThrow(expect.objectContaining({code: 'invalid-id'}));
        expect(() => normaliseMeta({'-hmm': {}})).toThrow(expect.objectContaining({code: 'invalid-id'}));
    });

    it('refuses a block over 16 KiB, measured serialised', () => {
        expect(() => normaliseMeta({hmm: {note: 'x'.repeat(16 * 1024)}})).toThrow(
            expect.objectContaining({code: 'invalid-id'}),
        );
        expect(normaliseMeta({hmm: {note: 'x'.repeat(16 * 1024 - 100)}})).toHaveProperty('hmm');
    });
});

describe('normaliseNode and normaliseNodes', () => {
    it('takes a node with its subtree and leaves children out when there are none', () => {
        expect(normaliseNode({id: 'eg', name: '  Erdgeschoss ', icon: 'stairs'})).toEqual({
            id: 'eg',
            name: 'Erdgeschoss',
            icon: 'stairs',
        });
        expect(normaliseNode({id: 'eg', name: 'Erdgeschoss', children: []})).not.toHaveProperty('children');
    });

    it('refuses a node that is not an object, has no id, or carries an icon that is not one', () => {
        expect(() => normaliseNode('eg')).toThrow(expect.objectContaining({code: 'invalid-id'}));
        expect(() => normaliseNode({id: 'Eg', name: 'Erdgeschoss'})).toThrow(
            expect.objectContaining({code: 'invalid-id'}),
        );
        expect(() => normaliseNode({id: 'eg', name: 'Erdgeschoss', icon: 'Stairs'})).toThrow(
            expect.objectContaining({code: 'invalid-id'}),
        );
        expect(() => normaliseNode({id: 'eg', name: 'Erdgeschoss', icon: 7})).toThrow(
            expect.objectContaining({code: 'invalid-id'}),
        );
    });

    it('an absent list of children is an empty one, and a list has to be a list', () => {
        expect(normaliseNodes(undefined)).toEqual([]);
        expect(normaliseNodes(null)).toEqual([]);
        expect(() => normaliseNodes({id: 'eg', name: 'Erdgeschoss'})).toThrow(
            expect.objectContaining({code: 'invalid-id'}),
        );
    });

    it('refuses two siblings with the same id', () => {
        expect(() =>
            normaliseNodes([
                {id: 'bad', name: 'Bad'},
                {id: 'bad', name: 'Bad oben'},
            ]),
        ).toThrow(expect.objectContaining({code: 'duplicate-id'}));
    });
});

describe('normaliseEnum and normaliseEnumName', () => {
    it('takes a localised name and a tree', () => {
        expect(
            normaliseEnum('room', {name: {de: 'Räume', en: 'Rooms'}, tree: [{id: 'eg', name: 'Erdgeschoss'}]}),
        ).toEqual({name: {de: 'Räume', en: 'Rooms'}, tree: [{id: 'eg', name: 'Erdgeschoss'}]});
    });

    it('refuses an enum id that is not an id, and an enum that is not an object', () => {
        expect(() => normaliseEnum('Room', {name: {en: 'Rooms'}, tree: []})).toThrow(
            expect.objectContaining({code: 'invalid-id'}),
        );
        expect(() => normaliseEnum('room', 'Rooms')).toThrow(expect.objectContaining({code: 'invalid-name'}));
    });

    it('needs an English name: it is what every consumer falls back to', () => {
        expect(() => normaliseEnumName({de: 'Räume'})).toThrow(expect.objectContaining({code: 'invalid-name'}));
        expect(normaliseEnumName({de: ' Räume ', en: 'Rooms'})).toEqual({de: 'Räume', en: 'Rooms'});
    });

    it('refuses a name that is not an object of languages, or a translation that is not a string', () => {
        expect(() => normaliseEnumName('Rooms')).toThrow(expect.objectContaining({code: 'invalid-name'}));
        expect(() => normaliseEnumName({en: 42})).toThrow(expect.objectContaining({code: 'invalid-name'}));
    });
});

describe('parseDocument', () => {
    it('takes a whole document and normalises everything in it', () => {
        const document = parseDocument(raw());
        expect(document.format).toBe(1);
        expect(document.revision).toBe(3);
        expect(document.objects['BidCos-RF.JEQ0230153:1']?.enums).toEqual(['room/eg/bad']);
        expect(document.enums['room']?.tree[0]?.children?.[0]?.name).toBe('Bad');
    });

    it('a document without enums or objects is an empty store at that revision', () => {
        expect(parseDocument({format: 1, revision: 7})).toEqual({format: 1, revision: 7, objects: {}, enums: {}});
        expect(parseDocument({format: 1, revision: 0, enums: null, objects: null}).enums).toEqual({});
    });

    it('refuses a document that is not an object, or of a format it does not read', () => {
        expect(() => parseDocument(null)).toThrow(expect.objectContaining({code: 'format-unsupported'}));
        expect(() => parseDocument([])).toThrow(expect.objectContaining({code: 'format-unsupported'}));
        expect(() => parseDocument({revision: 0})).toThrow(expect.objectContaining({code: 'format-unsupported'}));
        expect(() => parseDocument({format: 2, revision: 0})).toThrow(
            expect.objectContaining({code: 'format-unsupported'}),
        );
    });

    it('refuses a revision that is not a whole number of at least zero', () => {
        expect(() => parseDocument({format: 1, revision: '3'})).toThrow(
            expect.objectContaining({code: 'format-unsupported'}),
        );
        expect(() => parseDocument({format: 1, revision: 1.5})).toThrow(
            expect.objectContaining({code: 'format-unsupported'}),
        );
        expect(() => parseDocument({format: 1, revision: -1})).toThrow(
            expect.objectContaining({code: 'format-unsupported'}),
        );
    });

    it('refuses enums and objects that are not objects, with the code of the half that is wrong', () => {
        expect(() => parseDocument({format: 1, revision: 0, enums: []})).toThrow(
            expect.objectContaining({code: 'unknown-enum'}),
        );
        expect(() => parseDocument({format: 1, revision: 0, objects: []})).toThrow(
            expect.objectContaining({code: 'unknown-object'}),
        );
    });

    it('refuses a key of objects that is not a ref', () => {
        expect(() => parseDocument({format: 1, revision: 0, objects: {JEQ0230153: {name: 'Licht'}}})).toThrow(
            expect.objectContaining({code: 'invalid-ref'}),
        );
    });

    it('refuses a membership that points at a node no enum has, and says which one', () => {
        expect(() =>
            parseDocument({
                format: 1,
                revision: 0,
                enums: {room: {name: {en: 'Rooms'}, tree: []}},
                objects: {'BidCos-RF.JEQ0230153:1': {name: 'Licht', enums: ['room/nowhere']}},
            }),
        ).toThrow(
            expect.objectContaining({
                code: 'unknown-path',
                detail: {ref: 'BidCos-RF.JEQ0230153:1', path: 'room/nowhere'},
            }),
        );
    });

    it('knownPaths is what that check reads', () => {
        expect([...knownPaths(parseDocument(raw()).enums)].sort()).toEqual(['room/eg', 'room/eg/bad']);
        expect(knownPaths({}).size).toBe(0);
    });
});

describe('documentJson and documentEquals', () => {
    const a = parseDocument(raw());
    const b = parseDocument({
        // the same document written with every key in another order, and at another revision
        objects: {
            'BidCos-RF.JEQ0230153:1': {meta: {hmm: {colour: 'red'}}, enums: ['room/eg/bad'], name: 'Licht Bad'},
        },
        enums: {
            room: {
                tree: [{name: 'Erdgeschoss', children: [{name: 'Bad', icon: 'shower', id: 'bad'}], id: 'eg'}],
                name: {en: 'Rooms', de: 'Räume'},
            },
        },
        revision: 99,
        format: 1,
    });

    it('sorts the keys, so key order is not a difference', () => {
        expect(documentJson({...b, revision: a.revision})).toBe(documentJson(a));
        expect(documentJson(a).startsWith('{"enums"')).toBe(true);
    });

    it('indents when it is asked to, which is how the file on disk is written', () => {
        expect(documentJson(a, 2)).toContain('\n  "enums"');
    });

    it('compares the data and not the revision', () => {
        expect(documentEquals(a, b)).toBe(true);
        expect(documentJson(a)).not.toBe(documentJson(b));
    });

    it('sees a difference in the data', () => {
        const renamed: MetaDocument = {
            ...a,
            objects: {'BidCos-RF.JEQ0230153:1': {name: 'Licht Bad oben', enums: [], meta: {}}},
        };
        expect(documentEquals(a, renamed)).toBe(false);
    });
});

describe('parseDocumentOrEmpty', () => {
    it('parses what it can', () => {
        expect(parseDocumentOrEmpty(raw()).revision).toBe(3);
    });

    it('falls back to an empty store and hands the caller the code it refused with', () => {
        const errors: MetaError[] = [];
        const document = parseDocumentOrEmpty({format: 2, revision: 0}, (error) => errors.push(error));
        expect(document).toEqual({
            format: 1,
            revision: 0,
            objects: {},
            enums: {
                room: {name: {de: 'Räume', en: 'Rooms'}, tree: []},
                function: {name: {de: 'Gewerke', en: 'Functions'}, tree: []},
                floor: {name: {de: 'Etagen', en: 'Floors'}, tree: []},
            },
        });
        expect(errors.map((error) => error.code)).toEqual(['format-unsupported']);
        expect(errors.every((error) => isMetaError(error))).toBe(true);
    });

    it('needs no listener', () => {
        expect(parseDocumentOrEmpty('nonsense').revision).toBe(0);
    });

    it('rethrows anything that is not a refusal of the format', () => {
        // a BigInt in the meta block: JSON.stringify throws a TypeError, which is a bug in the
        // caller and not a document this store may quietly replace with an empty one
        expect(() =>
            parseDocumentOrEmpty({
                format: 1,
                revision: 0,
                objects: {'BidCos-RF.JEQ0230153:1': {name: 'Licht', meta: {hmm: 1n}}},
            }),
        ).toThrow(TypeError);
    });
});
