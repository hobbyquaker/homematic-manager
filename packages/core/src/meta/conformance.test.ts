/**
 * The conformance corpus of openccu-lite (their D-16), run against {@link MetaStore}.
 *
 * The corpus is the contract between the two implementations of the metadata store - `occulited`
 * in Go and this one - and it is the only reason to trust that a name written here means the same
 * thing there. It lives in `test/fixtures/meta/`, a verbatim copy of that repository's `fixtures/`
 * (see `NOTICE.md` beside it); pointing `OPENCCU_LITE_FIXTURES` at a checkout runs the upstream
 * files instead, which is how a change there is noticed before it is copied.
 *
 * The runner is deliberately dumb: it walks the directories, maps each `op` to one call, and
 * compares. Anything clever here would be a second implementation of the semantics, hiding the
 * disagreement the corpus exists to find.
 */

import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';

import {describe, expect, it} from 'vitest';

import {MetaError, type MetaDocument, type MetaErrorCode} from './types.js';
import {parseDocument} from './document.js';
import {MetaStore, type MetaWriteResult} from './store.js';

const VENDORED = path.join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'meta');
const CORPUS = process.env['OPENCCU_LITE_FIXTURES'] ?? VENDORED;

function read(file: string): unknown {
    return JSON.parse(readFileSync(file, 'utf8'));
}

function filesIn(directory: string): string[] {
    return readdirSync(path.join(CORPUS, directory))
        .filter((name) => name.endsWith('.json'))
        .sort();
}

/** One step of a case file. Fields depend on `op`; the runner narrows them as it goes. */
interface Op {
    op: string;
    ref?: string;
    body?: Record<string, unknown>;
    enum?: string;
    orphaned?: boolean;
    path?: string;
    parent?: string | null;
    id?: string;
    name?: unknown;
    icon?: string;
    position?: number;
    members?: string;
    set?: Record<string, Record<string, unknown>>;
    delete?: string[];
    document?: unknown;
    mode?: 'merge' | 'replace';
    since?: number;
    expect: Record<string, unknown>;
}

interface Case {
    title: string;
    start: 'empty' | MetaDocument;
    ops: Op[];
    end?: Record<string, unknown>;
}

/** `end` and the `value` of a read are compared structurally: what is named has to match. */
function expectSubset(actual: unknown, expected: unknown, at: string): void {
    if (Array.isArray(expected)) {
        expect(actual, at).toEqual(expected);
        return;
    }
    if (typeof expected === 'object' && expected !== null) {
        expect(actual, at).toBeTypeOf('object');
        for (const [key, value] of Object.entries(expected)) {
            expectSubset((actual as Record<string, unknown>)[key], value, `${at}.${key}`);
        }
        return;
    }
    expect(actual, at).toEqual(expected);
}

/** Runs one operation and returns what it produced, or the code it refused with. */
function run(store: MetaStore, op: Op): {result?: MetaWriteResult; value?: unknown; error?: MetaErrorCode} {
    try {
        switch (op.op) {
            case 'object.set':
                return {result: store.set(op.ref ?? '', op.body ?? {})};
            case 'object.put':
                return {result: store.put(op.ref ?? '', (op.body ?? {}) as never)};
            case 'object.get':
                // the corpus names the answer of a read by its field: `{"value": {...}}`
                return {value: {value: store.get(op.ref ?? '')}};
            case 'object.delete':
                return {result: store.delete(op.ref ?? '')};
            case 'objects.query':
                return {
                    value: {
                        refs: store.query(op.enum ?? '', op.orphaned),
                    },
                };
            case 'objects.bulk':
                return {result: store.bulk(op.set ?? {}, op.delete ?? [])};
            case 'enum.create':
                return {result: store.createEnum(op.id ?? '', op.name as Record<string, string>)};
            case 'enum.delete':
                return {result: store.deleteEnum(op.id ?? '', op.members === 'detach' ? 'detach' : 'refuse')};
            case 'node.create':
                return {
                    result: store.createNode(op.enum ?? '', op.parent ?? null, op.id ?? '', String(op.name), {
                        ...(op.icon === undefined ? {} : {icon: op.icon}),
                        ...(op.position === undefined ? {} : {position: op.position}),
                    }),
                };
            case 'node.update':
                return {result: store.updateNode(op.path ?? '', op.body ?? {})};
            case 'node.delete':
                return {result: store.deleteNode(op.path ?? '', op.members === 'detach' ? 'detach' : 'refuse')};
            case 'orphan.set':
                return {result: store.setOrphaned(op.ref ?? '', op.orphaned === true)};
            case 'import':
                return {result: store.import(op.document, op.mode ?? 'replace')};
            case 'events.since': {
                const replay = store.since(op.since ?? 0);
                return {
                    value: replay.resync === true ? {resync: true} : {kinds: (replay.events ?? []).map((e) => e.kind)},
                };
            }
            default:
                throw new Error(`the corpus uses an operation this runner does not know: ${op.op}`);
        }
    } catch (error) {
        if (error instanceof MetaError) {
            return {error: error.code};
        }
        throw error;
    }
}

describe(`the openccu-lite conformance corpus (${CORPUS === VENDORED ? 'vendored copy' : CORPUS})`, () => {
    describe('store documents', () => {
        for (const file of filesIn('store')) {
            const raw = read(path.join(CORPUS, 'store', file)) as Record<string, unknown>;
            const reason = raw['_reason'];
            // `_reason` names the expected code and is stripped before parsing: it is the corpus'
            // own annotation, never part of the document
            delete raw['_reason'];

            if (typeof reason === 'string') {
                it(`refuses ${file} with ${reason}`, () => {
                    expect(() => parseDocument(raw)).toThrow(expect.objectContaining({code: reason}));
                });
            } else {
                it(`loads ${file}`, () => {
                    const document = parseDocument(raw);
                    expect(document.format).toBe(1);
                    // a document that loads must survive a round trip through the store unchanged
                    const store = new MetaStore({document});
                    expect(store.document()).toEqual(document);
                });
            }
        }
    });

    describe('operation cases', () => {
        for (const file of filesIn('cases')) {
            const testCase = read(path.join(CORPUS, 'cases', file)) as Case;
            it(`${file}: ${testCase.title}`, () => {
                const store =
                    testCase.start === 'empty'
                        ? new MetaStore()
                        : new MetaStore({document: parseDocument(testCase.start)});
                testCase.ops.forEach((op, index) => {
                    const at = `${file} op ${String(index)} (${op.op})`;
                    const outcome = run(store, op);
                    if (typeof op.expect['error'] === 'string') {
                        expect(outcome.error, `${at} should have been refused`).toBe(op.expect['error']);
                        return;
                    }
                    expect(outcome.error, `${at} was refused unexpectedly`).toBeUndefined();
                    if (op.expect['ok'] === true) {
                        const result = outcome.result;
                        expect(result, at).toBeDefined();
                        if (op.expect['unchanged'] === true) {
                            expect(result?.changed, `${at} must not bump the revision`).toBe(false);
                        } else {
                            expect(result?.changed, `${at} has to change something`).toBe(true);
                            expect(result?.revision, at).toBe(op.expect['revision']);
                        }
                        return;
                    }
                    // a read: whatever the corpus names has to match
                    for (const [key, value] of Object.entries(op.expect)) {
                        expectSubset(
                            (outcome.value as Record<string, unknown> | undefined)?.[key],
                            value,
                            `${at}.${key}`,
                        );
                    }
                });
                if (testCase.end) {
                    const document = store.document();
                    expect(document.revision, `${file} end revision`).toBe(testCase.end['revision']);
                    expectSubset(document, testCase.end, `${file} end`);
                }
            });
        }
    });
});
