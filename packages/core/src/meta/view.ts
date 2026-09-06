/**
 * Trees to the flat things a UI and a downstream consumer show.
 *
 * openccu-lite's rooms and functions are trees; everything that ever consumed ReGa's rooms and
 * functions expects **arrays of names**, and the porting rule is explicit that they stay arrays of
 * names (invariant 3 of their porting prompt: whatever an integration publishes keeps its fields).
 * So this is the one place where a tree becomes a list, and it is a read: nothing here writes.
 */

import {findNode, flattenEnum, parsePath, type FlatNode} from './paths.js';
import type {MetaDocument, MetaEnum, MetaObject} from './types.js';

/** The display name of an enum in a language, with English and then the id behind it. */
export function enumTitle(id: string, definition: MetaEnum | undefined, language: string): string {
    return definition?.name[language] ?? definition?.name['en'] ?? id;
}

/** The node a path addresses, or `undefined` - the lookup a grid does per membership. */
export function nodeAt(enums: Readonly<Record<string, MetaEnum>>, path: string): FlatNode | undefined {
    const parsed = parsePath(path);
    if (!parsed || parsed.ids.length === 0) {
        return undefined;
    }
    const definition = enums[parsed.enumId];
    if (!definition) {
        return undefined;
    }
    const node = findNode(definition.tree, parsed.ids);
    if (!node) {
        return undefined;
    }
    const trail: string[] = [];
    for (let depth = 1; depth <= parsed.ids.length; depth += 1) {
        const step = findNode(definition.tree, parsed.ids.slice(0, depth));
        if (step) {
            trail.push(step.name);
        }
    }
    return {path, node, depth: parsed.ids.length, trail};
}

/** The name of the node a path addresses; the path itself when it does not resolve. */
export function pathName(enums: Readonly<Record<string, MetaEnum>>, path: string): string {
    return nodeAt(enums, path)?.node.name ?? path;
}

export interface EnumNamesOptions {
    /**
     * Also list the nodes above the ones the object is assigned to.
     *
     * A channel in `room/eg/wohnzimmer` *is* in `room/eg` - that is what the tree buys, and a
     * consumer that filters "everything on the ground floor" wants to see it. A grid column wants
     * the leaf alone, which is the default.
     */
    readonly ancestors?: boolean;
    /** Only this enum; every enum when absent. */
    readonly enumId?: string;
}

/**
 * The names one object carries in one enum, in tree order and without repetition.
 *
 * Tree order and not assignment order: two channels in the same two rooms must produce the same
 * two strings in the same sequence, or every consumer downstream sees a change that is not one.
 */
export function enumNames(
    enums: Readonly<Record<string, MetaEnum>>,
    paths: readonly string[],
    options: EnumNamesOptions = {},
): string[] {
    const wanted = new Set<string>();
    for (const path of paths) {
        const parsed = parsePath(path);
        if (!parsed || parsed.ids.length === 0) {
            continue;
        }
        if (options.enumId !== undefined && parsed.enumId !== options.enumId) {
            continue;
        }
        wanted.add(path);
        if (options.ancestors === true) {
            for (let depth = 1; depth < parsed.ids.length; depth += 1) {
                wanted.add([parsed.enumId, ...parsed.ids.slice(0, depth)].join('/'));
            }
        }
    }
    const names: string[] = [];
    for (const [id, definition] of Object.entries(enums)) {
        if (options.enumId !== undefined && id !== options.enumId) {
            continue;
        }
        for (const entry of flattenEnum(id, definition)) {
            if (wanted.has(entry.path) && !names.includes(entry.node.name)) {
                names.push(entry.node.name);
            }
        }
    }
    return names;
}

/** Every enum flattened once, for a select or a tree view. */
export function flattenAll(enums: Readonly<Record<string, MetaEnum>>): Record<string, FlatNode[]> {
    const flat: Record<string, FlatNode[]> = {};
    for (const [id, definition] of Object.entries(enums)) {
        flat[id] = flattenEnum(id, definition);
    }
    return flat;
}

/** What one object looks like to a consumer that thinks in ReGa's flat rooms and functions. */
export interface MetaSummary {
    readonly name: string;
    readonly rooms: readonly string[];
    readonly functions: readonly string[];
    readonly paths: readonly string[];
    readonly orphaned: boolean;
}

/** One object as names: what the grid, an MQTT payload and a node output all want. */
export function summarise(
    enums: Readonly<Record<string, MetaEnum>>,
    object: MetaObject,
    options: EnumNamesOptions = {},
): MetaSummary {
    return {
        name: object.name,
        rooms: enumNames(enums, object.enums, {...options, enumId: 'room'}),
        functions: enumNames(enums, object.enums, {...options, enumId: 'function'}),
        paths: object.enums,
        orphaned: object.orphaned === true,
    };
}

/** Every object of a document as {@link MetaSummary}, keyed by ref. */
export function summariseAll(document: MetaDocument, options: EnumNamesOptions = {}): Record<string, MetaSummary> {
    const summaries: Record<string, MetaSummary> = {};
    for (const [ref, object] of Object.entries(document.objects)) {
        summaries[ref] = summarise(document.enums, object, options);
    }
    return summaries;
}
