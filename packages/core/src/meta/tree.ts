/**
 * Immutable edits of an enum tree: insert, remove, reorder.
 *
 * Both writers need them - {@link MetaStore}, which owns a store, and {@link applyEvent}, which
 * follows somebody else's - and both have to produce byte-identical trees for the same edit, or a
 * consumer of the change stream would slowly drift away from the box it is watching. So they are
 * one implementation, here, and every one of them returns a new tree rather than mutating one:
 * a half-applied edit that threw in the middle is the one failure a store may never have.
 */

import {findNode} from './paths.js';
import type {MetaNode} from './types.js';

/** The index a node sits at among its siblings, or `undefined` when it is not there. */
export function indexOfNode(tree: readonly MetaNode[], ids: readonly string[]): number | undefined {
    const parentIds = ids.slice(0, -1);
    const id = ids[ids.length - 1];
    const siblings = parentIds.length === 0 ? tree : (findNode(tree, parentIds)?.children ?? []);
    const index = siblings.findIndex((node) => node.id === id);
    return index === -1 ? undefined : index;
}

/** A tree with one node inserted under a parent, at a position or appended. */
export function insertAt(
    tree: readonly MetaNode[],
    parentIds: readonly string[],
    node: MetaNode,
    position?: number,
): readonly MetaNode[] {
    if (parentIds.length === 0) {
        return spliceIn(tree, node, position);
    }
    const [head, ...rest] = parentIds;
    return tree.map((child) =>
        child.id === head ? {...child, children: insertAt(child.children ?? [], rest, node, position)} : child,
    );
}

/** A tree without the node a path addresses. */
export function removeAt(tree: readonly MetaNode[], ids: readonly string[]): readonly MetaNode[] {
    const [head, ...rest] = ids;
    if (head === undefined) {
        return tree;
    }
    if (rest.length === 0) {
        return tree.filter((node) => node.id !== head);
    }
    return tree.map((node) => {
        if (node.id !== head) {
            return node;
        }
        const children = removeAt(node.children ?? [], rest);
        return children.length === 0 ? withoutChildren(node) : {...node, children};
    });
}

export function withoutChildren(node: MetaNode): MetaNode {
    return {id: node.id, name: node.name, ...(node.icon === undefined ? {} : {icon: node.icon})};
}

export function spliceIn(nodes: readonly MetaNode[], node: MetaNode, position?: number): readonly MetaNode[] {
    const next = [...nodes];
    const index = position === undefined ? next.length : Math.max(0, Math.min(next.length, Math.trunc(position)));
    next.splice(index, 0, node);
    return next;
}
