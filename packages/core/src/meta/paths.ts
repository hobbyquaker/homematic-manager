/**
 * Refs, ids, names and node paths of the metadata store - the small rules the whole format rests on.
 *
 * They are separate from `store.ts` because both the store and the UI need them: the grid has to
 * turn `room/eg/wohnzimmer` into "Wohnzimmer", and a dialog has to know that a node id may not
 * contain a slash before it lets somebody type one.
 */

import {MAX_ID_LENGTH, MAX_NAME_BYTES, MAX_TREE_DEPTH, MetaError, type MetaEnum, type MetaNode} from './types.js';

/** Enum ids, node ids and `meta` namespaces share one spelling. */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** Icons are looser: a UI maps the name and ignores one it does not know. */
const ICON_PATTERN = /^[a-z0-9-]+$/;

/** A ref split into its two halves. */
export interface MetaRef {
    readonly interfaceName: string;
    readonly address: string;
}

/**
 * `<interface>.<address>` split at the **first** dot, or `undefined`.
 *
 * The interface name never contains a dot; the address may (it does not today, but the rule is the
 * separator, not the shape of what follows it). `BidCos-RF.JEQ0230153:1` is a channel,
 * `BidCos-RF.JEQ0230153` the device it belongs to.
 */
export function parseRef(ref: string): MetaRef | undefined {
    const dot = ref.indexOf('.');
    if (dot <= 0 || dot === ref.length - 1) {
        return undefined;
    }
    return {interfaceName: ref.slice(0, dot), address: ref.slice(dot + 1)};
}

/** The ref of an address on an interface. The inverse of {@link parseRef}. */
export function makeRef(interfaceName: string, address: string): string {
    return `${interfaceName}.${address}`;
}

/** Is this a ref the store accepts? */
export function isValidRef(ref: string): boolean {
    return parseRef(ref) !== undefined;
}

/** Throws `invalid-ref` when it is not. */
export function requireRef(ref: string): MetaRef {
    const parsed = parseRef(ref);
    if (!parsed) {
        throw new MetaError('invalid-ref', `${ref} is not <interface>.<address>`);
    }
    return parsed;
}

/** Enum id, node id or `meta` namespace: `[a-z0-9][a-z0-9-]*`, at most 32 characters. */
export function isValidId(id: string): boolean {
    return id.length <= MAX_ID_LENGTH && ID_PATTERN.test(id);
}

/** Throws `invalid-id` when it is not. */
export function requireId(id: string): string {
    if (!isValidId(id)) {
        throw new MetaError('invalid-id', `${id} is not a valid id`);
    }
    return id;
}

/** Icons are optional and lax; an unknown name is ignored by the UI, not an error. */
export function isValidIcon(icon: string): boolean {
    return icon.length <= MAX_ID_LENGTH && ICON_PATTERN.test(icon);
}

/**
 * The name as it will be stored: trimmed.
 *
 * Empty after trimming, longer than 255 bytes or carrying a line break is `invalid-name`. The trim
 * is why `"  Heizung Bad  "` written over `"Heizung Bad"` is not a change and does not bump the
 * revision - the corpus checks exactly that.
 */
export function normaliseName(name: unknown): string {
    if (typeof name !== 'string') {
        throw new MetaError('invalid-name', 'a name has to be a string');
    }
    const trimmed = name.trim();
    if (trimmed === '') {
        throw new MetaError('invalid-name', 'a name may not be empty');
    }
    if (/[\r\n]/.test(trimmed)) {
        throw new MetaError('invalid-name', 'a name may not contain line breaks');
    }
    if (byteLength(trimmed) > MAX_NAME_BYTES) {
        throw new MetaError('invalid-name', `a name may not be longer than ${String(MAX_NAME_BYTES)} bytes`);
    }
    return trimmed;
}

/**
 * Bytes of UTF-8 in a string.
 *
 * `TextEncoder` rather than `Buffer.byteLength`: this package runs in the browser as well as in
 * Node, and the byte limits of the format are a rule about UTF-8, not about a Node API.
 */
export function byteLength(value: string): number {
    return new TextEncoder().encode(value).length;
}

/** A node path split into the enum it belongs to and the ids below it. */
export interface MetaPath {
    readonly enumId: string;
    readonly ids: readonly string[];
}

/**
 * `room/eg/wohnzimmer` → `{enumId: 'room', ids: ['eg', 'wohnzimmer']}`.
 *
 * `room` alone is a valid *query* target (everything in any room) but never a membership target -
 * an object belongs to nodes, not to enums. The caller decides which of the two it wants; this
 * only splits.
 */
export function parsePath(path: string): MetaPath | undefined {
    const parts = path.split('/');
    const enumId = parts[0];
    if (enumId === undefined || enumId === '' || !isValidId(enumId)) {
        return undefined;
    }
    const ids = parts.slice(1);
    if (ids.some((id) => !isValidId(id))) {
        return undefined;
    }
    return {enumId, ids};
}

/** The path of a node under a parent path. */
export function childPath(parent: string, id: string): string {
    return `${parent}/${id}`;
}

/**
 * The path without its last segment, or `undefined` when there is nothing to strip.
 *
 * For a root node (`room/eg`) that is the enum id (`room`), which is not a node path - the caller
 * that moves a node treats "the parent is the bare enum id" as "move to the root".
 */
export function parentPath(path: string): string | undefined {
    const index = path.lastIndexOf('/');
    return index <= 0 ? undefined : path.slice(0, index);
}

/** Is `path` the node `target` or anything below it? The subtree rule of a membership query. */
export function pathMatches(path: string, target: string): boolean {
    return path === target || path.startsWith(`${target}/`);
}

/** The node a path addresses inside one enum's tree, or `undefined`. */
export function findNode(tree: readonly MetaNode[], ids: readonly string[]): MetaNode | undefined {
    let nodes: readonly MetaNode[] = tree;
    let found: MetaNode | undefined;
    for (const id of ids) {
        found = nodes.find((node) => node.id === id);
        if (!found) {
            return undefined;
        }
        nodes = found.children ?? [];
    }
    return found;
}

/** One entry of a flattened tree: the path, the node and how deep it sits. */
export interface FlatNode {
    readonly path: string;
    readonly node: MetaNode;
    readonly depth: number;
    /** The names from the root down to and including this node. */
    readonly trail: readonly string[];
}

/**
 * Every node of one enum, depth first, in display order.
 *
 * This is what turns a tree into the flat things a UI needs: a select with indented entries, the
 * "all rooms" list, and the check that a path exists at all.
 */
export function flattenEnum(enumId: string, definition: MetaEnum): FlatNode[] {
    const flat: FlatNode[] = [];
    const walk = (nodes: readonly MetaNode[], prefix: string, depth: number, trail: readonly string[]): void => {
        for (const node of nodes) {
            const path = childPath(prefix, node.id);
            const names = [...trail, node.name];
            flat.push({path, node, depth, trail: names});
            walk(node.children ?? [], path, depth + 1, names);
        }
    };
    walk(definition.tree, enumId, 1, []);
    return flat;
}

/** Every path of one enum, as a set - the cheap way to check membership targets in bulk. */
export function enumPaths(enumId: string, definition: MetaEnum): Set<string> {
    return new Set(flattenEnum(enumId, definition).map((entry) => entry.path));
}

/** The deepest level any node of this tree sits at; `0` for an empty tree. */
export function treeDepth(tree: readonly MetaNode[]): number {
    let deepest = 0;
    const walk = (nodes: readonly MetaNode[], depth: number): void => {
        for (const node of nodes) {
            deepest = Math.max(deepest, depth);
            walk(node.children ?? [], depth + 1);
        }
    };
    walk(tree, 1);
    return deepest;
}

/** Throws `too-deep` when a tree is deeper than the eight levels the format allows. */
export function requireDepth(tree: readonly MetaNode[]): void {
    if (treeDepth(tree) > MAX_TREE_DEPTH) {
        throw new MetaError('too-deep', `a tree may not be deeper than ${String(MAX_TREE_DEPTH)} levels`);
    }
}
