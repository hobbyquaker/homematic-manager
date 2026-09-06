/**
 * The openccu-lite metadata store: the document, its enums and the errors it answers with.
 *
 * This is *their* format, not ours. `docs/meta-format.md` and `docs/meta-api.md` in the
 * openccu-lite repository are normative (their D-16), two implementations exist - `occulited` in Go
 * and this one in TypeScript - and a conformance corpus decides whether they agree
 * (`packages/core/test/fixtures/meta/`, a copy of that repository's `fixtures/`). Nothing here may
 * be "improved" without changing the specification and the corpus first: a divergence that the
 * corpus does not catch is exactly the failure D-16 exists to prevent.
 *
 * Why it lives in `core` and not in `backend`: it is a data model with no I/O in it - trees, paths,
 * refs, validation, revisions - and the UI needs the same tree walking the backend does. The HTTP
 * client that talks to a box, and the provider that decides whether there is a box at all, are in
 * `packages/backend/src/meta/`.
 */

/** The format version this implementation reads and writes. A higher one is refused. */
export const META_FORMAT = 1;

/** Levels of nodes below an enum. Deeper is `too-deep`. */
export const MAX_TREE_DEPTH = 8;

/** Longest name of an object or a node, in bytes of UTF-8. */
export const MAX_NAME_BYTES = 255;

/** Longest enum id, node id and `meta` namespace, in characters. */
export const MAX_ID_LENGTH = 32;

/** Largest `meta` block per object, serialised. */
export const MAX_META_BYTES = 16 * 1024;

/**
 * Every error code of the metadata API, as the specification lists them.
 *
 * They are the contract: the corpus names them, the HTTP layer maps them to status codes, and the
 * UI shows a message per code. A new one is a specification change.
 */
export type MetaErrorCode =
    | 'invalid-ref'
    | 'invalid-name'
    | 'invalid-id'
    | 'unknown-object'
    | 'unknown-enum'
    | 'unknown-path'
    | 'duplicate-id'
    | 'duplicate-path'
    | 'has-members'
    | 'invalid-move'
    | 'too-deep'
    | 'format-unsupported'
    | 'revision-conflict'
    | 'forbidden';

/** A refusal from the store, carrying the code the specification names. */
export class MetaError extends Error {
    readonly code: MetaErrorCode;
    /** Whatever the code carries with it - `refs` for `has-members`, a location for an import. */
    readonly detail: Record<string, unknown> | undefined;

    constructor(code: MetaErrorCode, message?: string, detail?: Record<string, unknown>) {
        super(message ?? code);
        this.name = 'MetaError';
        this.code = code;
        this.detail = detail;
    }
}

/** True for the error class of this module; a type guard that survives a `catch`. */
export function isMetaError(value: unknown): value is MetaError {
    return value instanceof MetaError;
}

/**
 * One device or channel: `<interface>.<address>`.
 *
 * `enums` and `meta` are always present after normalisation, `orphaned` only when it is true - the
 * shape `occulited` serialises, so that a document written here and one written there compare
 * equal byte for byte after `JSON.stringify` with sorted keys.
 */
export interface MetaObject {
    readonly name: string;
    readonly enums: readonly string[];
    readonly meta: Readonly<Record<string, unknown>>;
    readonly orphaned?: boolean;
}

/** A node of an enum tree. `children` is absent, not empty, when there are none. */
export interface MetaNode {
    readonly id: string;
    readonly name: string;
    readonly icon?: string;
    readonly children?: readonly MetaNode[];
}

/** A taxonomy: localised display names and an ordered tree. */
export interface MetaEnum {
    /** BCP-47 primary tags to display names; `en` is required. */
    readonly name: Readonly<Record<string, string>>;
    readonly tree: readonly MetaNode[];
}

/** The whole store, as it is on disk and as `/snapshot` serves it. */
export interface MetaDocument {
    readonly format: number;
    readonly revision: number;
    readonly objects: Readonly<Record<string, MetaObject>>;
    readonly enums: Readonly<Record<string, MetaEnum>>;
}

/** What a `PATCH /objects/{ref}` body may say. Absent fields are left alone. */
export interface MetaObjectPatch {
    readonly name?: string;
    readonly enums?: readonly string[];
    /** Merged per namespace; `null` removes one. */
    readonly meta?: Readonly<Record<string, unknown>>;
    /**
     * Never accepted from a client (`forbidden`): the flag belongs to the process that owns the
     * addresses, and a frontend that sets it would be claiming a device is gone because it cannot
     * see it right now.
     */
    readonly orphaned?: boolean;
}

/** What a `PUT /objects/{ref}` body says. Missing optional fields are reset to their defaults. */
export interface MetaObjectBody {
    readonly name: string;
    readonly enums?: readonly string[];
    readonly meta?: Readonly<Record<string, unknown>>;
}

/** What a `PATCH /enums/{enum}/nodes/{path}` body may say. */
export interface MetaNodePatch {
    readonly name?: string;
    readonly icon?: string;
    /** A move; `null` moves the node to the root of its enum. */
    readonly parent?: string | null;
    /** The index among the new siblings. */
    readonly position?: number;
}

/** `replace` (the default) swaps the store; `merge` keeps what the import does not mention. */
export type MetaImportMode = 'replace' | 'merge';

/** The kinds of the change stream, as the specification lists them. */
export type MetaEventKind =
    | 'object.updated'
    | 'object.deleted'
    | 'enum.created'
    | 'enum.updated'
    | 'enum.deleted'
    | 'node.created'
    | 'node.updated'
    | 'node.deleted'
    | 'node.moved'
    | 'import'
    | 'resync';

/**
 * One event of the change stream.
 *
 * Every event carries the revision it produced, which is how a consumer notices a gap: a revision
 * that jumped by more than one means events were missed, and the answer to that is `?since=` or a
 * fresh snapshot. Fields beyond `kind` and `revision` depend on the kind, so they are all optional
 * here rather than a union that every consumer would have to narrow before it can log it.
 */
export interface MetaEvent {
    readonly revision: number;
    readonly kind: MetaEventKind;
    readonly ref?: string;
    readonly value?: MetaObject | MetaEnum | MetaNode;
    readonly enum?: string;
    readonly path?: string;
    readonly from?: string;
    readonly to?: string;
    readonly objects?: number;
    readonly enums?: number;
}

/** What `GET /api/meta/v1/version` answers - the runtime detection of the porting kit. */
export interface MetaVersion {
    readonly api: string;
    readonly version: number;
    readonly format: number;
    readonly revision: number;
    readonly implementation?: string;
}

/** The three enums a fresh store carries. They are ordinary enums; a user may delete them. */
export const DEFAULT_ENUMS: Readonly<Record<string, MetaEnum>> = Object.freeze({
    room: {name: {de: 'Räume', en: 'Rooms'}, tree: []},
    function: {name: {de: 'Gewerke', en: 'Functions'}, tree: []},
    floor: {name: {de: 'Etagen', en: 'Floors'}, tree: []},
});

/** An empty store: revision 0 and the three defaults, exactly as `occulited` creates one. */
export function emptyDocument(): MetaDocument {
    return {
        format: META_FORMAT,
        revision: 0,
        objects: {},
        enums: {
            room: {name: {...DEFAULT_ENUMS['room']?.name}, tree: []},
            function: {name: {...DEFAULT_ENUMS['function']?.name}, tree: []},
            floor: {name: {...DEFAULT_ENUMS['floor']?.name}, tree: []},
        },
    };
}
