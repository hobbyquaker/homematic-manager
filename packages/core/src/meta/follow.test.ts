/**
 * Following somebody else's store: every kind of event, and the revision rule around all of them.
 *
 * The corpus checks the store that *produces* events; nothing in it checks the consumer that
 * applies them, and a consumer that gets this wrong is the worst kind of wrong - it does not fail,
 * it drifts, and a name is right in one application and stale in the other until somebody reloads.
 * So the two halves are checked here: that each kind changes exactly what it says it changes
 * (including the member paths a move or a delete drags along), and that anything the least bit
 * unclear - a gap, an event that carries too little, a kind we do not know - answers 'resync'
 * rather than a document.
 */

import {describe, expect, it} from 'vitest';

import {applyEvent, applyEvents} from './follow.js';
import type {MetaDocument, MetaEvent, MetaEventKind} from './types.js';

function base(): MetaDocument {
    return {
        format: 1,
        revision: 5,
        enums: {
            room: {
                name: {de: 'Räume', en: 'Rooms'},
                tree: [
                    {
                        id: 'eg',
                        name: 'Erdgeschoss',
                        children: [
                            {id: 'bad', name: 'Bad'},
                            {id: 'wohnzimmer', name: 'Wohnzimmer'},
                        ],
                    },
                    {id: 'og', name: 'Obergeschoss'},
                ],
            },
        },
        objects: {
            'BidCos-RF.JEQ0230153:1': {name: 'Licht Bad', enums: ['room/eg/bad'], meta: {}},
            'BidCos-RF.JEQ0230153:2': {name: 'Taster', enums: ['room/eg/wohnzimmer'], meta: {}},
            'BidCos-RF.JEQ0230153:3': {name: 'Heizung', enums: [], meta: {}},
        },
    };
}

/** The document an event produced; a resync here is a failure of the test, not an outcome. */
function applied(document: MetaDocument, event: MetaEvent): MetaDocument {
    const next = applyEvent(document, event);
    if (next === 'resync') {
        throw new Error(`${event.kind} asked for a resync`);
    }
    return next;
}

describe('the revision rule', () => {
    it('applies the event that follows the document, and carries its revision', () => {
        expect(applied(base(), {revision: 6, kind: 'object.deleted', ref: 'BidCos-RF.JEQ0230153:3'}).revision).toBe(6);
    });

    it('an event we have already seen is nothing to do - a replay after a reconnect is allowed', () => {
        const document = base();
        expect(applyEvent(document, {revision: 5, kind: 'object.deleted', ref: 'BidCos-RF.JEQ0230153:3'})).toBe(
            document,
        );
        expect(applyEvent(document, {revision: 1, kind: 'object.deleted', ref: 'BidCos-RF.JEQ0230153:3'})).toBe(
            document,
        );
    });

    it('a gap is a resync: something happened that we did not see', () => {
        expect(applyEvent(base(), {revision: 7, kind: 'object.deleted', ref: 'BidCos-RF.JEQ0230153:3'})).toBe('resync');
    });

    it('an import and an explicit resync are a resync, whatever revision they carry', () => {
        expect(applyEvent(base(), {revision: 6, kind: 'import', objects: 2, enums: 1})).toBe('resync');
        expect(applyEvent(base(), {revision: 1, kind: 'resync'})).toBe('resync');
    });

    it('a kind this implementation does not know is a resync, never a guess', () => {
        expect(applyEvent(base(), {revision: 6, kind: 'node.renamed' as unknown as MetaEventKind})).toBe('resync');
    });
});

describe('objects', () => {
    it('object.updated writes the value the event carries', () => {
        const next = applied(base(), {
            revision: 6,
            kind: 'object.updated',
            ref: 'BidCos-RF.JEQ0230153:1',
            value: {name: 'Licht Bad neu', enums: ['room/og'], meta: {hmm: {a: 1}}},
        });
        expect(next.objects['BidCos-RF.JEQ0230153:1']).toEqual({
            name: 'Licht Bad neu',
            enums: ['room/og'],
            meta: {hmm: {a: 1}},
        });
    });

    it('object.deleted forgets one', () => {
        const next = applied(base(), {revision: 6, kind: 'object.deleted', ref: 'BidCos-RF.JEQ0230153:1'});
        expect(Object.keys(next.objects)).toEqual(['BidCos-RF.JEQ0230153:2', 'BidCos-RF.JEQ0230153:3']);
    });

    it('an event without the fields its kind needs is a resync', () => {
        expect(applyEvent(base(), {revision: 6, kind: 'object.updated', ref: 'BidCos-RF.JEQ0230153:1'})).toBe('resync');
        expect(applyEvent(base(), {revision: 6, kind: 'object.deleted'})).toBe('resync');
    });
});

describe('enums', () => {
    it('enum.created and enum.updated write the definition the event carries', () => {
        const created = applied(base(), {
            revision: 6,
            kind: 'enum.created',
            enum: 'function',
            value: {name: {en: 'Functions'}, tree: []},
        });
        expect(Object.keys(created.enums)).toEqual(['room', 'function']);

        const updated = applied(created, {
            revision: 7,
            kind: 'enum.updated',
            enum: 'function',
            value: {name: {de: 'Gewerke', en: 'Functions'}, tree: []},
        });
        expect(updated.enums['function']?.name).toEqual({de: 'Gewerke', en: 'Functions'});
    });

    it('enum.deleted takes the enum and every membership below it with it', () => {
        const next = applied(base(), {revision: 6, kind: 'enum.deleted', enum: 'room'});
        expect(next.enums).toEqual({});
        expect(next.objects['BidCos-RF.JEQ0230153:1']?.enums).toEqual([]);
        expect(next.objects['BidCos-RF.JEQ0230153:2']?.enums).toEqual([]);
    });

    it('an object that had nothing to lose is left exactly as it was', () => {
        const document = base();
        const next = applied(document, {revision: 6, kind: 'enum.deleted', enum: 'room'});
        expect(next.objects['BidCos-RF.JEQ0230153:3']).toBe(document.objects['BidCos-RF.JEQ0230153:3']);
    });

    it('an enum event without its fields is a resync', () => {
        expect(applyEvent(base(), {revision: 6, kind: 'enum.created', enum: 'function'})).toBe('resync');
        expect(applyEvent(base(), {revision: 6, kind: 'enum.deleted'})).toBe('resync');
    });
});

describe('nodes', () => {
    it('node.created inserts at the root and under a parent', () => {
        const root = applied(base(), {
            revision: 6,
            kind: 'node.created',
            enum: 'room',
            path: 'room/keller',
            value: {id: 'keller', name: 'Keller'},
        });
        expect(root.enums['room']?.tree.map((node) => node.id)).toEqual(['eg', 'og', 'keller']);

        const child = applied(root, {
            revision: 7,
            kind: 'node.created',
            enum: 'room',
            path: 'room/og/gast',
            value: {id: 'gast', name: 'Gästezimmer'},
        });
        expect(child.enums['room']?.tree[1]?.children).toEqual([{id: 'gast', name: 'Gästezimmer'}]);
    });

    it('node.updated renames and keeps the subtree the event does not carry', () => {
        const next = applied(base(), {
            revision: 6,
            kind: 'node.updated',
            enum: 'room',
            path: 'room/eg',
            value: {id: 'eg', name: 'Untergeschoss', icon: 'stairs'},
        });
        const eg = next.enums['room']?.tree[0];
        expect(eg?.name).toBe('Untergeschoss');
        expect(eg?.icon).toBe('stairs');
        expect(eg?.children?.map((node) => node.id)).toEqual(['bad', 'wohnzimmer']);
        // and it stays where it was among its siblings
        expect(next.enums['room']?.tree.map((node) => node.id)).toEqual(['eg', 'og']);
    });

    it('node.updated of a childless node leaves it childless', () => {
        const next = applied(base(), {
            revision: 6,
            kind: 'node.updated',
            enum: 'room',
            path: 'room/eg/wohnzimmer',
            value: {id: 'wohnzimmer', name: 'Wohnen'},
        });
        expect(next.enums['room']?.tree[0]?.children).toEqual([
            {id: 'bad', name: 'Bad'},
            {id: 'wohnzimmer', name: 'Wohnen'},
        ]);
    });

    it('node.deleted removes the subtree and detaches every member of it', () => {
        const next = applied(base(), {revision: 6, kind: 'node.deleted', enum: 'room', path: 'room/eg'});
        expect(next.enums['room']?.tree.map((node) => node.id)).toEqual(['og']);
        expect(next.objects['BidCos-RF.JEQ0230153:1']?.enums).toEqual([]);
        expect(next.objects['BidCos-RF.JEQ0230153:2']?.enums).toEqual([]);
    });

    it('node.moved moves the node and rewrites the member paths below it, in the same event', () => {
        const next = applied(base(), {
            revision: 6,
            kind: 'node.moved',
            enum: 'room',
            from: 'room/eg/bad',
            to: 'room/og/bad',
        });
        expect(next.enums['room']?.tree[0]?.children?.map((node) => node.id)).toEqual(['wohnzimmer']);
        expect(next.enums['room']?.tree[1]?.children?.map((node) => node.id)).toEqual(['bad']);
        expect(next.objects['BidCos-RF.JEQ0230153:1']?.enums).toEqual(['room/og/bad']);
        expect(next.objects['BidCos-RF.JEQ0230153:2']?.enums).toEqual(['room/eg/wohnzimmer']);
    });

    it('a move of a whole subtree rewrites the paths of everything under it', () => {
        const next = applied(base(), {
            revision: 6,
            kind: 'node.moved',
            enum: 'room',
            from: 'room/eg',
            to: 'room/og/eg',
        });
        expect(next.objects['BidCos-RF.JEQ0230153:1']?.enums).toEqual(['room/og/eg/bad']);
        expect(next.objects['BidCos-RF.JEQ0230153:2']?.enums).toEqual(['room/og/eg/wohnzimmer']);
    });

    it('a node event that does not address a node of a known enum is a resync', () => {
        const value = {id: 'keller', name: 'Keller'};
        expect(applyEvent(base(), {revision: 6, kind: 'node.created', enum: 'room', value})).toBe('resync');
        expect(applyEvent(base(), {revision: 6, kind: 'node.created', path: 'floor/keller', value})).toBe('resync');
        expect(applyEvent(base(), {revision: 6, kind: 'node.created', path: 'room/keller'})).toBe('resync');
        expect(applyEvent(base(), {revision: 6, kind: 'node.updated', path: 'room/eg'})).toBe('resync');
        expect(applyEvent(base(), {revision: 6, kind: 'node.updated', path: 'floor/eg', value})).toBe('resync');
        expect(applyEvent(base(), {revision: 6, kind: 'node.deleted', path: 'floor/eg'})).toBe('resync');
        expect(applyEvent(base(), {revision: 6, kind: 'node.deleted'})).toBe('resync');
    });

    it('a move that is not one - across enums, without a target, of a node that is not there', () => {
        expect(applyEvent(base(), {revision: 6, kind: 'node.moved', from: 'room/eg'})).toBe('resync');
        expect(applyEvent(base(), {revision: 6, kind: 'node.moved', to: 'room/og/eg'})).toBe('resync');
        expect(applyEvent(base(), {revision: 6, kind: 'node.moved', from: 'room/eg', to: 'floor/eg'})).toBe('resync');
        expect(applyEvent(base(), {revision: 6, kind: 'node.moved', from: 'room/keller', to: 'room/og/keller'})).toBe(
            'resync',
        );
    });
});

describe('applyEvents', () => {
    it('applies a replay in order', () => {
        const next = applyEvents(base(), [
            {revision: 6, kind: 'object.deleted', ref: 'BidCos-RF.JEQ0230153:3'},
            {
                revision: 7,
                kind: 'node.created',
                enum: 'room',
                path: 'room/keller',
                value: {id: 'keller', name: 'Keller'},
            },
        ]);
        if (next === 'resync') {
            throw new Error('the replay asked for a resync');
        }
        expect(next.revision).toBe(7);
        expect(next.enums['room']?.tree.map((node) => node.id)).toEqual(['eg', 'og', 'keller']);
    });

    it('stops at the first event that needs a snapshot rather than applying the rest', () => {
        expect(
            applyEvents(base(), [
                {revision: 6, kind: 'object.deleted', ref: 'BidCos-RF.JEQ0230153:3'},
                {revision: 8, kind: 'object.deleted', ref: 'BidCos-RF.JEQ0230153:2'},
                {revision: 9, kind: 'object.deleted', ref: 'BidCos-RF.JEQ0230153:1'},
            ]),
        ).toBe('resync');
    });

    it('an empty replay is the document it was given', () => {
        const document = base();
        expect(applyEvents(document, [])).toBe(document);
    });
});

describe('the odd corners of a node event', () => {
    it('an event without a path at all is a resync, whatever else it carries', () => {
        expect(applyEvent(base(), {revision: 6, kind: 'node.updated', value: {id: 'eg', name: 'Keller'}})).toBe(
            'resync',
        );
    });

    it('an update of a node we do not have is a resync, not a silent no-op', () => {
        // the node is missing, so this consumer is already out of step with the box: applying
        // nothing and moving the revision on would leave it there, quietly and for good
        expect(
            applyEvent(base(), {
                revision: 6,
                kind: 'node.updated',
                enum: 'room',
                path: 'room/keller/heizraum',
                value: {id: 'heizraum', name: 'Heizraum'},
            }),
        ).toBe('resync');
    });
});
