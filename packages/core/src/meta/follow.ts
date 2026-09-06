/**
 * Following somebody else's store: one event of the change stream applied to a document.
 *
 * This is the other half of the metadata API. A consumer fetches `/snapshot` once and then keeps up
 * from `/events/sse`; re-fetching the snapshot on every rename would work and would be wrong on a
 * box with four hundred channels and a user dragging rooms around.
 *
 * The rule that makes it safe is the revision. Every event carries the one it produced, and a
 * document only ever moves **forward by exactly one**: an event that skips a revision means one was
 * missed, and the only honest answer to that is `'resync'` - fetch the snapshot again. Guessing
 * would leave a consumer subtly out of step with the box, which is the failure nobody notices until
 * a name is wrong in one application and right in the other.
 */

import {findNode, parsePath, pathMatches} from './paths.js';
import {insertAt, removeAt} from './tree.js';
import type {MetaDocument, MetaEnum, MetaEvent, MetaNode, MetaObject} from './types.js';

/** What {@link applyEvent} answers: the next document, or "fetch the snapshot again". */
export type FollowResult = MetaDocument | 'resync';

/**
 * One event applied.
 *
 * `'resync'` for an `import` (the whole store was replaced), an explicit `resync`, a revision that
 * is not the next one, and any event this implementation cannot make sense of - a store that is
 * unsure is a store that re-reads, never one that carries on.
 */
export function applyEvent(document: MetaDocument, event: MetaEvent): FollowResult {
    if (event.kind === 'resync' || event.kind === 'import') {
        return 'resync';
    }
    if (event.revision <= document.revision) {
        // an event we have already seen - a replay after a reconnect. Nothing to do, and certainly
        // not a resync: `?since=` is allowed to hand us the same event twice.
        return document;
    }
    if (event.revision !== document.revision + 1) {
        return 'resync';
    }
    const next = applyChange(document, event);
    return next === undefined ? 'resync' : {...next, revision: event.revision};
}

/** Every event of a replay, stopping at the first one that needs a snapshot. */
export function applyEvents(document: MetaDocument, events: readonly MetaEvent[]): FollowResult {
    let current = document;
    for (const event of events) {
        const next = applyEvent(current, event);
        if (next === 'resync') {
            return 'resync';
        }
        current = next;
    }
    return current;
}

function applyChange(document: MetaDocument, event: MetaEvent): MetaDocument | undefined {
    switch (event.kind) {
        case 'object.updated': {
            if (event.ref === undefined || event.value === undefined) {
                return undefined;
            }
            return {...document, objects: {...document.objects, [event.ref]: event.value as MetaObject}};
        }
        case 'object.deleted': {
            if (event.ref === undefined) {
                return undefined;
            }
            const objects = {...document.objects};
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- the key is a ref
            delete objects[event.ref];
            return {...document, objects};
        }
        case 'enum.created':
        case 'enum.updated': {
            if (event.enum === undefined || event.value === undefined) {
                return undefined;
            }
            return {...document, enums: {...document.enums, [event.enum]: event.value as MetaEnum}};
        }
        case 'enum.deleted': {
            if (event.enum === undefined) {
                return undefined;
            }
            const enums = {...document.enums};
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- the key is an enum id
            delete enums[event.enum];
            return detach({...document, enums}, [event.enum]);
        }
        case 'node.created': {
            const target = parsePath(event.path ?? '');
            const definition = document.enums[target?.enumId ?? ''];
            if (!target || !definition || event.value === undefined) {
                return undefined;
            }
            const parentIds = target.ids.slice(0, -1);
            if (parentIds.length > 0 && !findNode(definition.tree, parentIds)) {
                // the parent is not in our copy of the tree, so this consumer is already out of
                // step; inserting nowhere would leave it there silently
                return undefined;
            }
            const tree = insertAt(definition.tree, parentIds, event.value as MetaNode);
            return withEnum(document, target.enumId, {name: definition.name, tree});
        }
        case 'node.updated': {
            const target = parsePath(event.path ?? '');
            const definition = document.enums[target?.enumId ?? ''];
            if (!target || !definition || event.value === undefined) {
                return undefined;
            }
            const current = findNode(definition.tree, target.ids);
            if (!current) {
                // an update of a node we do not have: same story, and `'resync'` is the only honest
                // answer to it
                return undefined;
            }
            const updated = event.value as MetaNode;
            // the event carries the node without its subtree; keeping the children we have is what
            // makes a rename a rename and not a delete of everything below it
            const node: MetaNode = {
                ...updated,
                ...(current.children === undefined ? {} : {children: current.children}),
            };
            const parentIds = target.ids.slice(0, -1);
            const position = indexOf(definition.tree, target.ids);
            const tree = insertAt(removeAt(definition.tree, target.ids), parentIds, node, position);
            return withEnum(document, target.enumId, {name: definition.name, tree});
        }
        case 'node.deleted': {
            const target = parsePath(event.path ?? '');
            const definition = document.enums[target?.enumId ?? ''];
            if (!target || !definition) {
                return undefined;
            }
            if (!findNode(definition.tree, target.ids)) {
                return undefined;
            }
            const tree = removeAt(definition.tree, target.ids);
            return detach(withEnum(document, target.enumId, {name: definition.name, tree}), [event.path ?? '']);
        }
        case 'node.moved': {
            const from = parsePath(event.from ?? '');
            const to = parsePath(event.to ?? '');
            const definition = document.enums[from?.enumId ?? ''];
            if (!from || !to || !definition || from.enumId !== to.enumId) {
                return undefined;
            }
            const node = findNode(definition.tree, from.ids);
            if (!node) {
                return undefined;
            }
            const tree = insertAt(removeAt(definition.tree, from.ids), to.ids.slice(0, -1), node);
            return rewrite(
                withEnum(document, from.enumId, {name: definition.name, tree}),
                event.from ?? '',
                event.to ?? '',
            );
        }
        default:
            return undefined;
    }
}

function indexOf(tree: readonly MetaNode[], ids: readonly string[]): number | undefined {
    const parentIds = ids.slice(0, -1);
    const id = ids[ids.length - 1];
    const siblings = parentIds.length === 0 ? tree : (findNode(tree, parentIds)?.children ?? []);
    const index = siblings.findIndex((node) => node.id === id);
    return index === -1 ? undefined : index;
}

function withEnum(document: MetaDocument, id: string, definition: MetaEnum): MetaDocument {
    return {...document, enums: {...document.enums, [id]: definition}};
}

/** Member paths of a subtree that is gone; the box removed them in the same revision. */
function detach(document: MetaDocument, targets: readonly string[]): MetaDocument {
    const objects: Record<string, MetaObject> = {};
    for (const [ref, object] of Object.entries(document.objects)) {
        const enums = object.enums.filter((path) => !targets.some((target) => pathMatches(path, target)));
        objects[ref] = enums.length === object.enums.length ? object : {...object, enums};
    }
    return {...document, objects};
}

/** Member paths of a subtree that moved; likewise part of the move's own revision. */
function rewrite(document: MetaDocument, from: string, to: string): MetaDocument {
    const objects: Record<string, MetaObject> = {};
    for (const [ref, object] of Object.entries(document.objects)) {
        const enums = object.enums.map((path) => (pathMatches(path, from) ? `${to}${path.slice(from.length)}` : path));
        objects[ref] = {...object, enums};
    }
    return {...document, objects};
}
