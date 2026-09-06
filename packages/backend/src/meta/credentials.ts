/**
 * Where the credential for openccu-lite's metadata API comes from.
 *
 * Three cases, and the interesting one is the first:
 *
 * - **on the box**, as the addon: `/usr/local/etc/occulite/local-token` holds a token with the
 *   role `user` - it reads everything and writes nothing, on purpose. Writes use the session of
 *   whoever is looking at the page, which the shell hands the addon as `?sid=@xxxxxxxxxx@`
 *   (openccu-lite's embedding contract). So the addon reads as itself and writes as the user, which
 *   is exactly the split a device-management frontend wants: nothing renames a device unless a
 *   person asked for it.
 * - **off the box** - a desktop, a server, Docker: an API token the administrator created on the
 *   box's Users page, stored in the connection settings like any other credential.
 * - **neither**: reads are unauthenticated, the API answers 401, and the provider degrades to the
 *   local names with a notice. Never an exception (their invariant 5).
 */

import {readFile} from 'node:fs/promises';

/** Where the box puts the read-only token for programs running on it. */
export const LOCAL_TOKEN_FILE = '/usr/local/etc/occulite/local-token';

/** What an API token looks like, so a typo in a settings field is caught before it is sent. */
export const TOKEN_PATTERN = /^olt_[0-9a-f]{32}$/;

/** Is this the shape of an openccu-lite API token? */
export function isApiToken(value: string): boolean {
    return TOKEN_PATTERN.test(value.trim());
}

/**
 * A session id as the box hands it over: `@xxxxxxxxxx@`, the CCU convention, or bare.
 *
 * The API accepts both spellings; this normalises to the bare one so that one shape goes on the
 * wire and a log line stays readable.
 */
export function normaliseSid(value: string | undefined): string | undefined {
    const bare = (value ?? '').replace(/^@|@$/g, '').trim();
    return /^[0-9a-zA-Z]{6,64}$/.test(bare) ? bare : undefined;
}

/**
 * The box's local token, or `undefined` when there is no file - which is every installation that
 * is not the addon on an openccu-lite box.
 *
 * Never throws: a token that cannot be read is the same as no token, and the answer to that is to
 * run without names rather than to fail to start.
 */
export async function readLocalToken(file = LOCAL_TOKEN_FILE): Promise<string | undefined> {
    try {
        const content = await readFile(file, 'utf8');
        const token = content.trim().split(/\r?\n/)[0]?.trim();
        return token === undefined || token === '' ? undefined : token;
    } catch {
        return undefined;
    }
}
