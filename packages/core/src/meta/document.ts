/**
 * Reading, validating and comparing a whole metadata document.
 *
 * A document arrives from three places - the box's `/snapshot`, a file this application wrote
 * itself, and an import a user picked - and all three go through here. The rule of the format is
 * that a document is validated **as a whole and rejected entirely** on the first error, because
 * half an import is worse than none: the enums an object refers to have to exist, and that is not
 * a property of any single entry.
 *
 * Every refusal is a {@link MetaError} with the code the specification names, so an import dialog
 * can say "room/nowhere does not exist" rather than "invalid".
 */

import {
    byteLength,
    enumPaths,
    isValidIcon,
    isValidId,
    normaliseName,
    parsePath,
    requireDepth,
    requireRef,
} from './paths.js';
import {
    MAX_META_BYTES,
    META_FORMAT,
    MetaError,
    emptyDocument,
    type MetaDocument,
    type MetaEnum,
    type MetaNode,
    type MetaObject,
} from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * One object, checked and brought into the shape the store keeps.
 *
 * `enums` and `meta` always exist afterwards; `orphaned` only when it is true, which is what
 * `occulited` serialises and therefore what a byte comparison of two documents needs.
 */
export function normaliseObject(raw: unknown): MetaObject {
    if (!isRecord(raw)) {
        throw new MetaError('invalid-name', 'an object has to be an object');
    }
    const name = normaliseName(raw['name']);
    const enums = normaliseEnumList(raw['enums']);
    const meta = normaliseMeta(raw['meta']);
    const orphaned = raw['orphaned'] === true;
    return orphaned ? {name, enums, meta, orphaned: true} : {name, enums, meta};
}

/** The `enums` array: strings that look like paths, without duplicates. Existence is checked later. */
export function normaliseEnumList(raw: unknown): readonly string[] {
    if (raw === undefined || raw === null) {
        return [];
    }
    if (!Array.isArray(raw)) {
        throw new MetaError('unknown-path', 'enums has to be an array of node paths');
    }
    const paths: string[] = [];
    for (const entry of raw as unknown[]) {
        if (typeof entry !== 'string' || parsePath(entry) === undefined) {
            throw new MetaError('unknown-path', `${String(entry)} is not a node path`);
        }
        if (paths.includes(entry)) {
            throw new MetaError('duplicate-path', `${entry} is listed twice`);
        }
        paths.push(entry);
    }
    return paths;
}

/**
 * The `meta` block: one key per consumer namespace, any JSON below it.
 *
 * The store never interprets what is in there - that is the point of the namespace - so the only
 * rules are the spelling of the key and the size of the whole block.
 */
export function normaliseMeta(raw: unknown): Readonly<Record<string, unknown>> {
    if (raw === undefined || raw === null) {
        return {};
    }
    if (!isRecord(raw)) {
        throw new MetaError('invalid-id', 'meta has to be an object of namespaces');
    }
    for (const namespace of Object.keys(raw)) {
        if (!isValidId(namespace)) {
            throw new MetaError('invalid-id', `${namespace} is not a valid meta namespace`);
        }
    }
    if (byteLength(JSON.stringify(raw)) > MAX_META_BYTES) {
        throw new MetaError('invalid-id', `meta may not be larger than ${String(MAX_META_BYTES)} bytes`);
    }
    return raw;
}

/** One node and its subtree, checked. Sibling ids are unique; depth is checked by the caller. */
export function normaliseNode(raw: unknown): MetaNode {
    if (!isRecord(raw)) {
        throw new MetaError('invalid-id', 'a node has to be an object');
    }
    const id = raw['id'];
    if (typeof id !== 'string' || !isValidId(id)) {
        throw new MetaError('invalid-id', `${String(id)} is not a valid node id`);
    }
    const name = normaliseName(raw['name']);
    const icon = raw['icon'];
    if (icon !== undefined && (typeof icon !== 'string' || !isValidIcon(icon))) {
        // `JSON.stringify` and not `String()`: an icon that arrived as an object would otherwise be
        // reported as "[object Object] is not a valid icon name", which is a message a user reads
        throw new MetaError('invalid-id', `${JSON.stringify(icon)} is not a valid icon name`);
    }
    const children = normaliseNodes(raw['children']);
    const node: MetaNode = {
        id,
        name,
        ...(typeof icon === 'string' ? {icon} : {}),
        ...(children.length > 0 ? {children} : {}),
    };
    return node;
}

/** A list of siblings: every one checked, no id twice. */
export function normaliseNodes(raw: unknown): readonly MetaNode[] {
    if (raw === undefined || raw === null) {
        return [];
    }
    if (!Array.isArray(raw)) {
        throw new MetaError('invalid-id', 'children has to be an array of nodes');
    }
    const nodes = (raw as unknown[]).map((entry) => normaliseNode(entry));
    const seen = new Set<string>();
    for (const node of nodes) {
        if (seen.has(node.id)) {
            throw new MetaError('duplicate-id', `${node.id} is used twice among its siblings`);
        }
        seen.add(node.id);
    }
    return nodes;
}

/** One enum: a localised name with at least `en`, and its tree. */
export function normaliseEnum(id: string, raw: unknown): MetaEnum {
    if (!isValidId(id)) {
        throw new MetaError('invalid-id', `${id} is not a valid enum id`);
    }
    if (!isRecord(raw)) {
        throw new MetaError('invalid-name', `enum ${id} has to be an object`);
    }
    const name = normaliseEnumName(raw['name']);
    const tree = normaliseNodes(raw['tree']);
    requireDepth(tree);
    return {name, tree};
}

/**
 * The localised name of an enum.
 *
 * `en` is required: it is the fallback every consumer falls back to, and an enum that has only a
 * German name is unreadable in an English UI - the corpus refuses exactly that with `invalid-name`.
 */
export function normaliseEnumName(raw: unknown): Readonly<Record<string, string>> {
    if (!isRecord(raw)) {
        throw new MetaError('invalid-name', 'an enum name has to be an object of languages');
    }
    const name: Record<string, string> = {};
    for (const [language, value] of Object.entries(raw)) {
        if (typeof value !== 'string') {
            throw new MetaError('invalid-name', `the ${language} name has to be a string`);
        }
        name[language] = normaliseName(value);
    }
    if (name['en'] === undefined) {
        throw new MetaError('invalid-name', 'an enum needs at least an English name');
    }
    return name;
}

/**
 * A whole document, validated and normalised - the one entry point for anything untrusted.
 *
 * The order of the checks is the order of the specification's error codes: the format version
 * first (a newer store is not something to guess at), then the enums, then the objects against the
 * paths the enums define.
 */
export function parseDocument(raw: unknown): MetaDocument {
    if (!isRecord(raw)) {
        throw new MetaError('format-unsupported', 'a document has to be an object');
    }
    const format = raw['format'];
    if (format !== META_FORMAT) {
        throw new MetaError(
            'format-unsupported',
            `format ${String(format)} is newer than this implementation reads (${String(META_FORMAT)})`,
        );
    }
    const revision = raw['revision'];
    if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) {
        throw new MetaError('format-unsupported', 'revision has to be an integer of at least 0');
    }

    const enums: Record<string, MetaEnum> = {};
    const rawEnums = raw['enums'];
    if (rawEnums !== undefined && rawEnums !== null) {
        if (!isRecord(rawEnums)) {
            throw new MetaError('unknown-enum', 'enums has to be an object');
        }
        for (const [id, definition] of Object.entries(rawEnums)) {
            enums[id] = normaliseEnum(id, definition);
        }
    }

    const known = knownPaths(enums);
    const objects: Record<string, MetaObject> = {};
    const rawObjects = raw['objects'];
    if (rawObjects !== undefined && rawObjects !== null) {
        if (!isRecord(rawObjects)) {
            throw new MetaError('unknown-object', 'objects has to be an object');
        }
        for (const [ref, entry] of Object.entries(rawObjects)) {
            requireRef(ref);
            const object = normaliseObject(entry);
            for (const path of object.enums) {
                if (!known.has(path)) {
                    throw new MetaError('unknown-path', `${ref}: ${path} does not exist`, {ref, path});
                }
            }
            objects[ref] = object;
        }
    }

    return {format: META_FORMAT, revision, objects, enums};
}

/** Every node path of every enum - what an object's `enums` entries are checked against. */
export function knownPaths(enums: Readonly<Record<string, MetaEnum>>): Set<string> {
    const known = new Set<string>();
    for (const [id, definition] of Object.entries(enums)) {
        for (const path of enumPaths(id, definition)) {
            known.add(path);
        }
    }
    return known;
}

/**
 * A document as JSON with its keys sorted, which is how two of them are compared.
 *
 * The format says key order is not significant and that a writer should sort for stable diffs, so
 * sorting is both the comparison and the file this application writes. It is also the answer to
 * "did this import change anything": an import whose result equals the document is not a revision.
 */
export function documentJson(document: MetaDocument, space?: number): string {
    return JSON.stringify(sortKeys(document), undefined, space);
}

/** Do two documents hold the same data? `revision` is not part of the answer. */
export function documentEquals(a: MetaDocument, b: MetaDocument): boolean {
    return documentJson({...a, revision: 0}) === documentJson({...b, revision: 0});
}

function sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((entry) => sortKeys(entry));
    }
    if (isRecord(value)) {
        const sorted: Record<string, unknown> = {};
        for (const key of Object.keys(value).sort()) {
            sorted[key] = sortKeys(value[key]);
        }
        return sorted;
    }
    return value;
}

/**
 * A document out of anything, never throwing: a broken file becomes an empty store.
 *
 * The format says a reader that finds the document unparsable falls back to the `.bak` and reports
 * that it did, never starts empty silently - so the caller gets the error and decides. This is the
 * "and then what" for a caller that has already tried both files.
 */
export function parseDocumentOrEmpty(raw: unknown, onError?: (error: MetaError) => void): MetaDocument {
    try {
        return parseDocument(raw);
    } catch (error) {
        if (error instanceof MetaError) {
            onError?.(error);
            return emptyDocument();
        }
        throw error;
    }
}
