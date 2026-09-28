/**
 * The pure part of the metadata pages (the maintainer, 2026-09-10: the store is an entry of the
 * interface picker with its own tabs - "Rooms" and "Functions" on ReGaHSS, one "Metadata" tree on
 * occulited). What a row of the grid is, how the tree becomes rows, where a node may be moved to
 * and whom a deletion touches. No DOM, no transport, no store - `metaTree.test.ts` covers it
 * directly, and it is the half of the editor that is meant to be carried over into occulited's own
 * web UI as it is.
 *
 * It thinks in the store's own terms: **enum ids** (`room`), **paths** (`room/eg/wohnzimmer`) and
 * **refs** (`BidCos-RF.MEQ0123456:1`), exactly as `packages/core/src/meta/` spells them.
 */

import {enumTitle, flattenEnum, parseRef, type MetaEnum, type MetaObjectView} from '@homematic-manager/core';

import {canMoveUnder, membersOf, nodeOptions, type NodeOption} from './taxonomy.js';

/**
 * The members of a node's subtree: `channels` the member channels, `devices` the distinct devices
 * among the members - a device that is a member itself, or one with at least one member channel
 * (B-76, #167: on a CCU only channels are members, so a count of device-level members alone was
 * blank on every row there).
 */
export interface MemberCount {
    readonly devices: number;
    readonly channels: number;
}

/**
 * One row of the grid: a taxonomy (only on the tree page) or a node of one.
 *
 * `id` is what the grid selects by - the enum id for a taxonomy, the path for a node. A path always
 * carries a slash and an enum id never does, so the two cannot collide.
 */
export interface MetaRow extends MemberCount {
    readonly id: string;
    readonly kind: 'enum' | 'node';
    readonly enumId: string;
    /** The node's path; absent on a taxonomy row. */
    readonly path?: string;
    readonly name: string;
    /** 0 for a taxonomy, 1 for a node at its root, deeper below. */
    readonly depth: number;
    readonly hasChildren: boolean;
    /**
     * The nodes of a taxonomy, flattened depth first, for the grid's second level. `DataTable`
     * nests one level (a device and its channels); a taxonomy may nest eight, so every node below
     * a taxonomy is one sub-row and its `depth` is drawn as indentation in the Name cell.
     */
    readonly nodes?: readonly MetaRow[];
}

/** `<interface>.<address>`: a channel address carries a colon, a device address does not. */
export function isChannelRef(ref: string): boolean {
    return (parseRef(ref)?.address ?? ref).includes(':');
}

export function countMembers(refs: readonly string[]): MemberCount {
    let channels = 0;
    const devices = new Set<string>();
    for (const ref of refs) {
        const parsed = parseRef(ref);
        const address = parsed?.address ?? ref;
        const colon = address.indexOf(':');
        if (colon >= 0) {
            channels += 1;
        }
        const device = colon >= 0 ? address.slice(0, colon) : address;
        devices.add(parsed ? `${parsed.interfaceName}.${device}` : device);
    }
    return {devices: devices.size, channels};
}

/**
 * The nodes of one taxonomy as rows, depth first, each with the members of its subtree.
 *
 * The order is the store's - ReGaHSS sorts its lists by name (task 27), a tree store keeps the
 * order the user made - and the grid does not sort a tree, because a parent sorted away from its
 * children is not a tree any more.
 */
export function nodeRows(
    enums: Readonly<Record<string, MetaEnum>>,
    objects: Readonly<Record<string, MetaObjectView>>,
    enumId: string,
): MetaRow[] {
    const definition = enums[enumId];
    if (!definition) {
        return [];
    }
    return flattenEnum(enumId, definition).map((entry) => ({
        id: entry.path,
        kind: 'node',
        enumId,
        path: entry.path,
        name: entry.node.name,
        depth: entry.depth,
        hasChildren: (entry.node.children?.length ?? 0) > 0,
        ...countMembers(membersOf(objects, entry.path)),
    }));
}

/** Every taxonomy as a top-level row with its nodes under it - the Metadata page of a tree store. */
export function enumRows(
    enums: Readonly<Record<string, MetaEnum>>,
    objects: Readonly<Record<string, MetaObjectView>>,
    language: string,
): MetaRow[] {
    return Object.entries(enums).map(([enumId, definition]) => {
        const nodes = nodeRows(enums, objects, enumId);
        return {
            id: enumId,
            kind: 'enum',
            enumId,
            name: enumTitle(enumId, definition, language),
            depth: 0,
            hasChildren: nodes.length > 0,
            // the enum id is a valid subtree target: `room` matches every `room/...`
            ...countMembers(membersOf(objects, enumId)),
            nodes,
        };
    });
}

/** Every row of the grid, taxonomies and nodes alike, by id. */
export function rowIndex(rows: readonly MetaRow[]): Map<string, MetaRow> {
    const index = new Map<string, MetaRow>();
    for (const row of rows) {
        index.set(row.id, row);
        for (const node of row.nodes ?? []) {
            index.set(node.id, node);
        }
    }
    return index;
}

/** Pixels of indentation for a node's depth: a root node stands flush, every level steps in. */
export function indentOf(depth: number, step = 14): number {
    return Math.max(0, depth - 1) * step;
}

/**
 * Where a node may be moved to: the top level, and every node of its own taxonomy that is not the
 * node itself or anything below it.
 */
export function moveTargets(enums: Readonly<Record<string, MetaEnum>>, path: string): NodeOption[] {
    const enumId = path.split('/')[0] ?? '';
    return nodeOptions(enums, enumId).filter((option) => canMoveUnder(path, option.path));
}

/** What a deletion touches: the refs still assigned in the row's subtree, sorted. */
export function deletionMembers(objects: Readonly<Record<string, MetaObjectView>>, row: MetaRow): string[] {
    return membersOf(objects, row.kind === 'enum' ? row.enumId : (row.path ?? ''));
}

/**
 * The display names of a taxonomy after a rename: the name the user typed in the language the UI
 * is in, and in English - `en` is the one every consumer falls back to, and a taxonomy renamed in
 * German with an English name left as it was would show two different names in two places.
 */
export function enumNameAfterRename(
    existing: Readonly<Record<string, string>> | undefined,
    name: string,
    language: string,
): Record<string, string> {
    return {...existing, en: name, [language]: name};
}

/*
 * The contract of the editor component (`routes/meta/MetadataEditor.svelte`), kept here with the
 * pure functions because it is the other half of what a port takes along: the editor reaches no
 * store of its own, it is handed the trees and the objects and reports every write through these
 * callbacks. Each one answers whether the write was accepted; the rows are redrawn from the
 * store's events, never from the answer.
 */

/** `t('Devices')`, `t('{count} rows selected', {}, 7)` - the app's translator, or the port's. */
export type Translate = (key: string, params?: Readonly<Record<string, string | number>>, count?: number) => string;

export interface MetadataActions {
    createEnum(id: string, name: Record<string, string>): Promise<boolean>;
    renameEnum(id: string, name: Record<string, string>): Promise<boolean>;
    deleteEnum(id: string, detach: boolean): Promise<boolean>;
    /** At the root of the taxonomy when `parent` is undefined; answers with the path the node got. */
    createNode(enumId: string, parent: string | undefined, name: string): Promise<string | undefined>;
    renameNode(path: string, name: string): Promise<boolean>;
    /** `null` puts the node at the root of its taxonomy. */
    moveNode(path: string, parent: string | null): Promise<boolean>;
    deleteNode(path: string, detach: boolean): Promise<boolean>;
    /** Reads the store again - ReGaHSS has no change stream, so this is how a room made elsewhere arrives. */
    refresh(): Promise<boolean>;
}
