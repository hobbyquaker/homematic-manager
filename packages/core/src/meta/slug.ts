/**
 * A node id out of a name a user typed.
 *
 * Ids are `[a-z0-9][a-z0-9-]*`, at most 32 characters, and **stable**: renaming a room never
 * changes its id, which is what keeps every object's membership pointing at the same node. So the
 * id is derived once, when the node is created, and never again.
 *
 * The transcription is the one openccu-lite's own CCU import uses (`docs/meta-api.md`,
 * `POST /import/ccu`): umlauts written out, everything else that is not `[a-z0-9]` folded to a
 * hyphen, and a collision resolved with `-2`, `-3`, … so that "Bad" and "Bäd" cannot silently
 * become the same room.
 */

import {isValidId} from './paths.js';
import {MAX_ID_LENGTH} from './types.js';

const TRANSCRIPTIONS: readonly (readonly [RegExp, string])[] = [
    [/ä/g, 'ae'],
    [/ö/g, 'oe'],
    [/ü/g, 'ue'],
    [/ß/g, 'ss'],
    [/å/g, 'a'],
    [/æ/g, 'ae'],
    [/ø/g, 'oe'],
];

/** The slug of a name, without the collision check. Empty when nothing survives the fold. */
export function slugOf(name: string): string {
    let slug = name.toLowerCase();
    for (const [pattern, replacement] of TRANSCRIPTIONS) {
        slug = slug.replace(pattern, replacement);
    }
    slug = slug
        // decomposes é to e + a combining accent, which the next step then drops
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, MAX_ID_LENGTH);
    return isValidId(slug) ? slug : '';
}

/**
 * A slug that is free among `taken`, with `-2`, `-3`, … behind it when it is not.
 *
 * A name that folds to nothing at all - an id written only in Cyrillic or in emoji - gets `node`
 * and its number, because an id is a machine key and the *name* is what the user reads.
 */
export function slugId(name: string, taken: Iterable<string> = []): string {
    const used = new Set(taken);
    const base = slugOf(name) === '' ? 'node' : slugOf(name);
    if (!used.has(base)) {
        return base;
    }
    for (let suffix = 2; suffix < 1000; suffix += 1) {
        const candidate = `${base.slice(0, MAX_ID_LENGTH - String(suffix).length - 1)}-${String(suffix)}`;
        if (!used.has(candidate)) {
            return candidate;
        }
    }
    throw new Error(`no free id for ${name}`);
}
