/**
 * The metadata store, in memory: every operation of the metadata API, with its revisions and its
 * change stream.
 *
 * This is the second implementation of openccu-lite's D-16 - `occulited` in Go is the first - and
 * the conformance corpus is what keeps the two honest. It is used twice here: it *is* the `local`
 * provider (a user on Homegear, on a bare rfd or on the desktop gets rooms and functions without
 * any box at all), and it is the model the `occulite` provider keeps of what the box holds, so the
 * UI reads the same shapes whichever provider is on.
 *
 * Three rules run through all of it:
 *
 * - **a write that changes nothing is not a write.** It returns `changed: false` and the revision
 *   stays where it was. Setting a name to the name it already has must not bump a revision that
 *   every consumer of the change stream is watching.
 * - **all or nothing.** A bulk, an import and a move that rewrites member paths are one revision;
 *   a validation error leaves the store exactly as it was.
 * - **every refusal is a code**, never a boolean: the UI shows a message per code and the corpus
 *   compares them.
 */

import {
    documentEquals,
    knownPaths,
    normaliseEnumList,
    normaliseEnumName,
    normaliseMeta,
    parseDocument,
} from './document.js';
import {indexOfNode, insertAt, removeAt} from './tree.js';
import {
    childPath,
    enumPaths,
    findNode,
    isValidIcon,
    isValidId,
    normaliseName,
    parsePath,
    pathMatches,
    requireDepth,
    requireId,
    requireRef,
} from './paths.js';
import {
    MetaError,
    emptyDocument,
    type MetaDocument,
    type MetaEnum,
    type MetaEvent,
    type MetaImportMode,
    type MetaNode,
    type MetaNodePatch,
    type MetaObject,
    type MetaObjectBody,
    type MetaObjectPatch,
} from './types.js';

/** How many events the change stream keeps for a consumer that reconnects. The API asks for 1000. */
export const DEFAULT_EVENT_HISTORY = 1000;

/** What every mutation answers with. `changed: false` means the revision did not move. */
export interface MetaWriteResult {
    readonly revision: number;
    readonly changed: boolean;
}

/** What a replay answers with: the events since a revision, or "fetch the snapshot again". */
export interface MetaReplay {
    readonly revision: number;
    readonly events?: readonly MetaEvent[];
    readonly resync?: true;
}

export interface MetaStoreOptions {
    /** The document to start from; an empty store (revision 0, three default enums) by default. */
    readonly document?: MetaDocument;
    readonly eventHistory?: number;
    /** Called once per event, after the mutation that produced it has been applied. */
    readonly onEvent?: (event: MetaEvent) => void;
}

/** One node with the members that would lose it. */
interface Members {
    readonly paths: readonly string[];
    readonly refs: readonly string[];
}

export class MetaStore {
    #revision: number;
    #objects: Map<string, MetaObject>;
    #enums: Map<string, MetaEnum>;
    readonly #history: MetaEvent[] = [];
    readonly #historySize: number;
    /** The lowest `since` a replay can still answer; below it the answer is `resync`. */
    #replayFrom: number;
    readonly #onEvent: ((event: MetaEvent) => void) | undefined;

    constructor(options: MetaStoreOptions = {}) {
        const document = options.document ?? emptyDocument();
        this.#revision = document.revision;
        this.#objects = new Map(Object.entries(document.objects));
        this.#enums = new Map(Object.entries(document.enums));
        this.#historySize = options.eventHistory ?? DEFAULT_EVENT_HISTORY;
        this.#replayFrom = document.revision;
        this.#onEvent = options.onEvent;
    }

    get revision(): number {
        return this.#revision;
    }

    get size(): number {
        return this.#objects.size;
    }

    /** The whole store, as `/snapshot` serves it and as it is written to disk. */
    document(): MetaDocument {
        return {
            format: 1,
            revision: this.#revision,
            objects: Object.fromEntries([...this.#objects].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
            enums: Object.fromEntries([...this.#enums]),
        };
    }

    /**
     * Replaces everything without producing an import event or a revision of our own.
     *
     * This is how the `occulite` provider takes a snapshot from the box: the box owns the revision,
     * and a consumer that renumbered it would break every `?since=` it sends afterwards.
     */
    load(document: MetaDocument): void {
        this.#revision = document.revision;
        this.#objects = new Map(Object.entries(document.objects));
        this.#enums = new Map(Object.entries(document.enums));
        this.#history.length = 0;
        this.#replayFrom = document.revision;
    }

    /*
     * reads
     */

    /** One object, or `unknown-object`. */
    get(ref: string): MetaObject {
        const object = this.#objects.get(ref);
        if (!object) {
            throw new MetaError('unknown-object', `${ref} is not in the store`);
        }
        return object;
    }

    /** One object, or `undefined` - the read that a UI does for every row of a grid. */
    find(ref: string): MetaObject | undefined {
        return this.#objects.get(ref);
    }

    /** Every object, keyed by ref. */
    objects(): Readonly<Record<string, MetaObject>> {
        return Object.fromEntries(this.#objects);
    }

    /** Every enum with its tree. */
    enums(): Readonly<Record<string, MetaEnum>> {
        return Object.fromEntries(this.#enums);
    }

    /** One enum, or `unknown-enum`. */
    getEnum(id: string): MetaEnum {
        const definition = this.#enums.get(id);
        if (!definition) {
            throw new MetaError('unknown-enum', `${id} is not an enum`);
        }
        return definition;
    }

    /**
     * The refs that belong to a node **or anything below it**, sorted.
     *
     * `room/eg` answers with everything on the ground floor, `room` with everything that is in any
     * room at all. That is what the tree buys and why membership is a path and not an id.
     */
    query(target: string, orphaned?: boolean): string[] {
        this.#requireTarget(target);
        const refs: string[] = [];
        for (const [ref, object] of this.#objects) {
            if (!object.enums.some((path) => pathMatches(path, target))) {
                continue;
            }
            if (orphaned !== undefined && (object.orphaned === true) !== orphaned) {
                continue;
            }
            refs.push(ref);
        }
        return refs.sort();
    }

    /**
     * The change stream since a revision: the events, or "fetch the snapshot again".
     *
     * A consumer that was away longer than the history, or that asks for something impossible, is
     * told to resync rather than served a gap it cannot see.
     */
    since(revision: number): MetaReplay {
        if (!Number.isInteger(revision) || revision < 0 || revision > this.#revision || revision < this.#replayFrom) {
            return {revision: this.#revision, resync: true};
        }
        return {revision: this.#revision, events: this.#history.filter((event) => event.revision > revision)};
    }

    /*
     * objects
     */

    /** `PATCH /objects/{ref}`: create or update; absent fields are left alone. */
    set(ref: string, patch: MetaObjectPatch): MetaWriteResult {
        requireRef(ref);
        if (patch.orphaned !== undefined) {
            throw new MetaError('forbidden', 'orphaned is set by the process that owns the addresses');
        }
        const existing = this.#objects.get(ref);
        const name = patch.name === undefined ? existing?.name : normaliseName(patch.name);
        if (name === undefined) {
            throw new MetaError('invalid-name', `${ref} is new and needs a name`);
        }
        const enums =
            patch.enums === undefined ? (existing?.enums ?? []) : this.#requirePaths(normaliseEnumList(patch.enums));
        const meta = patch.meta === undefined ? (existing?.meta ?? {}) : mergeMeta(existing?.meta ?? {}, patch.meta);
        return this.#putObject(ref, buildObject(name, enums, meta, existing?.orphaned === true));
    }

    /** `PUT /objects/{ref}`: create or replace; missing optional fields go back to their defaults. */
    put(ref: string, body: MetaObjectBody): MetaWriteResult {
        requireRef(ref);
        const existing = this.#objects.get(ref);
        const name = normaliseName(body.name);
        const enums = this.#requirePaths(normaliseEnumList(body.enums));
        const meta = normaliseMeta(body.meta);
        return this.#putObject(ref, buildObject(name, enums, meta, existing?.orphaned === true));
    }

    /**
     * `DELETE /objects/{ref}`: forgets an entry for good.
     *
     * Normally unnecessary - `orphaned` is how "gone" is expressed, so that a replaced device keeps
     * its room - but a user may really want to forget one. Deleting what is not there is not an
     * error: it is the state the caller asked for, and a bulk that carries one must not fail.
     */
    delete(ref: string): MetaWriteResult {
        if (!this.#objects.has(ref)) {
            return {revision: this.#revision, changed: false};
        }
        this.#objects.delete(ref);
        return this.#commit([{kind: 'object.deleted', ref}]);
    }

    /** `POST /objects:bulk`: any number of writes and deletes as **one** revision. */
    bulk(sets: Readonly<Record<string, MetaObjectPatch>>, deletes: readonly string[] = []): MetaWriteResult {
        // validated against a copy first, so a bad entry leaves the store untouched
        const draft = this.#clone();
        const events: Omit<MetaEvent, 'revision'>[] = [];
        for (const [ref, patch] of Object.entries(sets)) {
            if (draft.set(ref, patch).changed) {
                events.push({kind: 'object.updated', ref, value: draft.get(ref)});
            }
        }
        for (const ref of deletes) {
            if (draft.delete(ref).changed) {
                events.push({kind: 'object.deleted', ref});
            }
        }
        if (events.length === 0) {
            return {revision: this.#revision, changed: false};
        }
        this.#adopt(draft);
        return this.#commit(events);
    }

    /**
     * The `orphaned` flag, which only the process that owns the addresses may set.
     *
     * It is a mutation like any other - a consumer has to learn that a device disappeared - and it
     * never touches the assignments: a device that comes back is in its room again.
     */
    setOrphaned(ref: string, orphaned: boolean): MetaWriteResult {
        const object = this.get(ref);
        if ((object.orphaned === true) === orphaned) {
            return {revision: this.#revision, changed: false};
        }
        const next = buildObject(object.name, object.enums, object.meta, orphaned);
        this.#objects.set(ref, next);
        return this.#commit([{kind: 'object.updated', ref, value: next}]);
    }

    /*
     * enums
     */

    /** `POST /enums`. */
    createEnum(id: string, name: Readonly<Record<string, string>>): MetaWriteResult {
        requireId(id);
        if (this.#enums.has(id)) {
            throw new MetaError('duplicate-id', `${id} exists`);
        }
        const definition: MetaEnum = {name: normaliseEnumName(name), tree: []};
        this.#enums.set(id, definition);
        return this.#commit([{kind: 'enum.created', enum: id, value: definition}]);
    }

    /** `PATCH /enums/{enum}`: the display name, nothing else. */
    updateEnum(id: string, name: Readonly<Record<string, string>>): MetaWriteResult {
        const existing = this.getEnum(id);
        const next: MetaEnum = {name: normaliseEnumName(name), tree: existing.tree};
        if (JSON.stringify(next.name) === JSON.stringify(existing.name)) {
            return {revision: this.#revision, changed: false};
        }
        this.#enums.set(id, next);
        return this.#commit([{kind: 'enum.updated', enum: id, value: next}]);
    }

    /**
     * `DELETE /enums/{enum}`: the enum and every node in it.
     *
     * Refused while anything is a member, unless the caller says `detach` - in which case the
     * paths are removed from every object **in the same revision**, so no consumer ever sees an
     * object pointing at a node that is already gone.
     */
    deleteEnum(id: string, members: 'refuse' | 'detach' = 'refuse'): MetaWriteResult {
        const definition = this.getEnum(id);
        const affected = this.#membersOf([...enumPaths(id, definition)]);
        if (affected.refs.length > 0 && members !== 'detach') {
            throw new MetaError('has-members', `${id} still has members`, {refs: [...affected.refs]});
        }
        this.#enums.delete(id);
        this.#detach(affected);
        return this.#commit([{kind: 'enum.deleted', enum: id}]);
    }

    /*
     * nodes
     */

    /** `POST /enums/{enum}/nodes`: a node under a parent, or at the root when `parent` is null. */
    createNode(
        enumId: string,
        parent: string | null,
        id: string,
        name: string,
        options: {readonly icon?: string; readonly position?: number} = {},
    ): MetaWriteResult {
        const definition = this.getEnum(enumId);
        requireId(id);
        const nodeName = normaliseName(name);
        if (options.icon !== undefined && !isValidIcon(options.icon)) {
            throw new MetaError('invalid-id', `${options.icon} is not a valid icon name`);
        }
        const parentPath = parent ?? enumId;
        const parentIds = this.#requireParent(enumId, parentPath);
        const siblings =
            parentIds.length === 0 ? definition.tree : (findNode(definition.tree, parentIds)?.children ?? []);
        if (siblings.some((node) => node.id === id)) {
            throw new MetaError('duplicate-id', `${childPath(parentPath, id)} exists`);
        }
        const node: MetaNode = {id, name: nodeName, ...(options.icon === undefined ? {} : {icon: options.icon})};
        const tree = insertAt(definition.tree, parentIds, node, options.position);
        requireDepth(tree);
        this.#enums.set(enumId, {name: definition.name, tree});
        return this.#commit([{kind: 'node.created', enum: enumId, path: childPath(parentPath, id), value: node}]);
    }

    /**
     * `PATCH /enums/{enum}/nodes/{path}`: rename, re-icon, move, reorder.
     *
     * A move keeps the id, so every member path is rewritten **in the same revision** and consumers
     * see one `node.moved` carrying `from` and `to` rather than a delete and a create that would
     * briefly leave objects pointing nowhere.
     */
    updateNode(path: string, patch: MetaNodePatch): MetaWriteResult {
        const {enumId, ids} = this.#requireNode(path);
        const definition = this.getEnum(enumId);
        const node = findNode(definition.tree, ids);
        if (!node) {
            throw new MetaError('unknown-path', `${path} does not exist`);
        }
        const name = patch.name === undefined ? node.name : normaliseName(patch.name);
        if (patch.icon !== undefined && !isValidIcon(patch.icon)) {
            throw new MetaError('invalid-id', `${patch.icon} is not a valid icon name`);
        }
        const icon = patch.icon ?? node.icon;

        const currentParentIds: readonly string[] = ids.slice(0, -1);
        let targetParentIds: readonly string[] = currentParentIds;
        let targetParentPath = [enumId, ...currentParentIds].join('/');
        if (patch.parent !== undefined) {
            const parentPath = patch.parent ?? enumId;
            if (pathMatches(parentPath, path)) {
                throw new MetaError('invalid-move', `${path} cannot be moved under itself`);
            }
            targetParentIds = this.#requireParent(enumId, parentPath);
            targetParentPath = parentPath;
        }
        const target = childPath(targetParentPath, node.id);
        const moved = target !== path;
        if (moved) {
            const siblings =
                targetParentIds.length === 0
                    ? definition.tree
                    : (findNode(definition.tree, targetParentIds)?.children ?? []);
            if (siblings.some((sibling) => sibling.id === node.id)) {
                throw new MetaError('duplicate-id', `${target} exists`);
            }
        }

        const next: MetaNode = {
            id: node.id,
            name,
            ...(icon === undefined ? {} : {icon}),
            ...(node.children === undefined ? {} : {children: node.children}),
        };
        const withoutNode = removeAt(definition.tree, ids);
        const position = patch.position ?? (moved ? undefined : indexOfNode(definition.tree, ids));
        const tree = insertAt(withoutNode, targetParentIds, next, position);
        requireDepth(tree);
        if (JSON.stringify(tree) === JSON.stringify(definition.tree)) {
            return {revision: this.#revision, changed: false};
        }
        this.#enums.set(enumId, {name: definition.name, tree});

        const events: Omit<MetaEvent, 'revision'>[] = [];
        if (moved) {
            // one event, not one per member: the specification says a move is a single `node.moved`
            // carrying `from` and `to`, and every consumer rewrites its own member paths from it -
            // an object.updated per member would be the same information twice and, on a store with
            // two hundred channels in a room, two hundred messages for one drag of a node
            this.#rewrite(path, target);
            events.push({kind: 'node.moved', enum: enumId, from: path, to: target});
        } else if (patch.position !== undefined && position !== indexOfNode(definition.tree, ids)) {
            events.push({kind: 'node.moved', enum: enumId, from: path, to: path});
        } else {
            events.push({kind: 'node.updated', enum: enumId, path, value: next});
        }
        return this.#commit(events);
    }

    /** `DELETE /enums/{enum}/nodes/{path}`: the node and its subtree, with the same `detach` rule. */
    deleteNode(path: string, members: 'refuse' | 'detach' = 'refuse'): MetaWriteResult {
        const {enumId, ids} = this.#requireNode(path);
        const definition = this.getEnum(enumId);
        const node = findNode(definition.tree, ids);
        if (!node) {
            throw new MetaError('unknown-path', `${path} does not exist`);
        }
        const affected = this.#membersOf([path]);
        if (affected.refs.length > 0 && members !== 'detach') {
            throw new MetaError('has-members', `${path} still has members`, {refs: [...affected.refs]});
        }
        this.#enums.set(enumId, {name: definition.name, tree: removeAt(definition.tree, ids)});
        this.#detach(affected);
        return this.#commit([{kind: 'node.deleted', enum: enumId, path}]);
    }

    /*
     * import
     */

    /**
     * `PUT /import`: a whole document, validated completely and applied as one revision.
     *
     * `replace` swaps the store; `merge` keeps the objects and enums the import does not mention
     * and overwrites the ones it does. Either way the *result* is validated - a merge that would
     * leave an object pointing at a node the import removed is refused, not repaired.
     */
    import(raw: unknown, mode: MetaImportMode = 'replace'): MetaWriteResult {
        const incoming = parseDocument(raw);
        const current = this.document();
        const merged: MetaDocument =
            mode === 'merge'
                ? parseDocument({
                      format: 1,
                      revision: current.revision,
                      objects: {...current.objects, ...incoming.objects},
                      enums: {...current.enums, ...incoming.enums},
                  })
                : incoming;
        if (documentEquals(current, merged)) {
            return {revision: this.#revision, changed: false};
        }
        this.#objects = new Map(Object.entries(merged.objects));
        this.#enums = new Map(Object.entries(merged.enums));
        return this.#commit([
            {
                kind: 'import',
                objects: Object.keys(merged.objects).length,
                enums: Object.keys(merged.enums).length,
            },
        ]);
    }

    /*
     * internals
     */

    #putObject(ref: string, next: MetaObject): MetaWriteResult {
        const existing = this.#objects.get(ref);
        if (existing && JSON.stringify(existing) === JSON.stringify(next)) {
            return {revision: this.#revision, changed: false};
        }
        this.#objects.set(ref, next);
        return this.#commit([{kind: 'object.updated', ref, value: next}]);
    }

    /** Every path in the list has to exist; that is what makes a dangling membership impossible. */
    #requirePaths(paths: readonly string[]): readonly string[] {
        const known = knownPaths(this.enums());
        for (const path of paths) {
            if (!known.has(path)) {
                throw new MetaError('unknown-path', `${path} does not exist`, {path});
            }
        }
        return paths;
    }

    /** A query target: an enum id (everything in it) or a node path (that subtree). */
    #requireTarget(target: string): void {
        const parsed = parsePath(target);
        if (!parsed) {
            throw new MetaError('unknown-path', `${target} is not a node path`);
        }
        const definition = this.getEnum(parsed.enumId);
        if (parsed.ids.length > 0 && !findNode(definition.tree, parsed.ids)) {
            throw new MetaError('unknown-path', `${target} does not exist`);
        }
    }

    /** A node path, split - the enum has to exist, the node is looked up by the caller. */
    #requireNode(path: string): {enumId: string; ids: readonly string[]} {
        const parsed = parsePath(path);
        if (!parsed || parsed.ids.length === 0) {
            throw new MetaError('unknown-path', `${path} is not a node path`);
        }
        return {enumId: parsed.enumId, ids: parsed.ids};
    }

    /** The ids of a parent inside its enum; `[]` for the enum itself, i.e. the root. */
    #requireParent(enumId: string, parentPath: string): readonly string[] {
        const parsed = parsePath(parentPath);
        if (!parsed || parsed.enumId !== enumId) {
            throw new MetaError('unknown-path', `${parentPath} is not a path of ${enumId}`);
        }
        if (parsed.ids.length > 0 && !findNode(this.getEnum(enumId).tree, parsed.ids)) {
            throw new MetaError('unknown-path', `${parentPath} does not exist`);
        }
        return parsed.ids;
    }

    /** Which objects would lose which paths if these subtrees went away. */
    #membersOf(targets: readonly string[]): Members {
        const refs: string[] = [];
        for (const [ref, object] of this.#objects) {
            if (object.enums.some((path) => targets.some((target) => pathMatches(path, target)))) {
                refs.push(ref);
            }
        }
        return {paths: targets, refs: refs.sort()};
    }

    /**
     * Removes the paths of a deleted subtree from every object that carried one.
     *
     * Silent, like the rewrite of a move: the `node.deleted` / `enum.deleted` event is what a
     * consumer acts on, and it already says which paths stopped existing.
     */
    #detach(members: Members): void {
        for (const ref of members.refs) {
            const object = this.#objects.get(ref);
            if (!object) {
                continue;
            }
            const enums = object.enums.filter((path) => !members.paths.some((target) => pathMatches(path, target)));
            this.#objects.set(ref, buildObject(object.name, enums, object.meta, object.orphaned === true));
        }
    }

    /** Rewrites the member paths of a moved subtree; part of the move's own revision. */
    #rewrite(from: string, to: string): void {
        for (const [ref, object] of this.#objects) {
            if (!object.enums.some((path) => pathMatches(path, from))) {
                continue;
            }
            const enums = object.enums.map((path) =>
                pathMatches(path, from) ? `${to}${path.slice(from.length)}` : path,
            );
            this.#objects.set(ref, buildObject(object.name, enums, object.meta, object.orphaned === true));
        }
    }

    /** One revision for a set of events, appended to the history and handed to the listener. */
    #commit(events: readonly Omit<MetaEvent, 'revision'>[]): MetaWriteResult {
        this.#revision += 1;
        for (const event of events) {
            const full: MetaEvent = {...event, revision: this.#revision};
            this.#history.push(full);
            this.#onEvent?.(full);
        }
        while (this.#history.length > this.#historySize) {
            const dropped = this.#history.shift();
            if (dropped) {
                this.#replayFrom = dropped.revision;
            }
        }
        return {revision: this.#revision, changed: true};
    }

    /** A detached copy, used to validate a bulk before anything is written. */
    #clone(): MetaStore {
        return new MetaStore({document: this.document(), eventHistory: 0});
    }

    #adopt(other: MetaStore): void {
        const document = other.document();
        this.#objects = new Map(Object.entries(document.objects));
        this.#enums = new Map(Object.entries(document.enums));
    }
}

/** An object in the shape the store keeps: `orphaned` only when it is true. */
function buildObject(
    name: string,
    enums: readonly string[],
    meta: Readonly<Record<string, unknown>>,
    orphaned: boolean,
): MetaObject {
    return orphaned ? {name, enums, meta, orphaned: true} : {name, enums, meta};
}

/**
 * `meta` merged per namespace: `null` removes one, any other value replaces it whole.
 *
 * Per namespace and not per key, on purpose: the store does not interpret what is inside a
 * namespace, so it cannot merge it either - only its owner knows what half an update would mean.
 */
export function mergeMeta(
    current: Readonly<Record<string, unknown>>,
    patch: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
    const merged: Record<string, unknown> = {...current};
    for (const [namespace, value] of Object.entries(normaliseMeta(patch))) {
        if (value === null) {
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- the key is a namespace the caller named
            delete merged[namespace];
        } else {
            merged[namespace] = value;
        }
    }
    return normaliseMeta(merged);
}

/** Is this a valid enum or node id? Re-exported so a dialog can check before it offers to save. */
export {isValidId};
