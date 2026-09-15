/**
 * D-40 and B-94: the check of an openccu-lite session against the box, without a box.
 *
 * `server.test.ts` drives the host with a fake checker and, once, this class against a small HTTP
 * box; the integration test in `packages/backend/test/occulite/` needs a real occulited. This file
 * pins what the class asks and what it believes.
 */

import {describe, expect, it} from 'vitest';

import {OCCULITE_SESSION_HEADER, OcculiteAuthenticator, parseSid, sidCanBeSession} from './occulite.js';

interface BoxAnswers {
    readonly enums: number;
    readonly state: number | {authenticated?: unknown; user?: unknown; role?: unknown};
}

function box(
    answers: BoxAnswers,
    notices: string[] = [],
): {calls: {path: string; authorization: string | null}[]; auth: OcculiteAuthenticator} {
    const calls: {path: string; authorization: string | null}[] = [];
    const fetch = ((input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        calls.push({path: url.pathname, authorization: new Headers(init?.headers).get('authorization')});
        if (url.pathname === '/api/meta/v1/enums') {
            return Promise.resolve(new Response('{}', {status: answers.enums}));
        }
        if (url.pathname === '/api/auth/v1/state') {
            return Promise.resolve(
                typeof answers.state === 'number'
                    ? new Response('{}', {status: answers.state})
                    : Response.json(answers.state),
            );
        }
        return Promise.resolve(new Response('', {status: 404}));
    }) as typeof globalThis.fetch;
    return {
        calls,
        auth: new OcculiteAuthenticator({
            baseUrl: 'http://box/',
            fetch,
            onNotice: (_level, message) => notices.push(message),
        }),
    };
}

describe('parseSid', () => {
    it('takes the id with and without the @ wrapping, and nothing that is not one', () => {
        expect(parseSid('@abcdefghij@')).toBe('abcdefghij');
        expect(parseSid('abcdefghij')).toBe('abcdefghij');
        for (const value of [
            undefined,
            null,
            '',
            '@@',
            'abc',
            'abcdefghij, abcdefghij',
            'abc def ghij',
            'abcdefghij;x',
        ]) {
            expect(parseSid(value), String(value)).toBeUndefined();
        }
    });

    it("takes exactly openccu-lite's two shapes: 26 of base32 since task 125, ten alphanumerics before (B-36)", () => {
        const long = 'ABCDEFGHIJKLMNOPQRST234567';
        expect(long).toHaveLength(26);
        expect(parseSid(long)).toBe(long);
        expect(parseSid(`@${long}@`)).toBe(long);
        // auth-off's fixed id before task 125
        expect(parseSid('anonymous0')).toBe('anonymous0');
        for (const value of [
            // an API token is never a session, whatever /api/auth/v1/state would say about it
            `olt_${'0123456789abcdef'.repeat(2)}`,
            '0123456789abcdef'.repeat(2),
            'abcdefghi',
            'abcdefghijk',
            long.slice(1),
            `${long}A`,
            // base32 is upper-case, and has neither 0, 1, 8 nor 9
            long.toLowerCase(),
            `${long.slice(0, 25)}8`,
            `${long.slice(0, 25)}1`,
            'abcdefghij'.repeat(2),
        ]) {
            expect(parseSid(value), value).toBeUndefined();
        }
    });

    it('names the header lower-case, as Node reports incoming headers', () => {
        expect(OCCULITE_SESSION_HEADER).toBe('x-occulite-session');
    });
});

describe('sidCanBeSession (B-36)', () => {
    const LONG = 'ANNAANNAANNAANNAANNAANNA27';

    it('refuses a ?sid= of another shape only where the gate names a 26-character session', () => {
        expect(LONG).toHaveLength(26);
        // the legacy alias next to the session the gate validated: the box refuses it, so nobody asks
        expect(sidCanBeSession('abcdefghij', LONG)).toBe(false);
        expect(sidCanBeSession(LONG, LONG)).toBe(true);
        expect(sidCanBeSession('Z'.repeat(26), LONG)).toBe(true);
    });

    it('concludes nothing without a header or with a ten-character one: the box decides', () => {
        // a CCU, an image from before the header, an image from before task 125
        expect(sidCanBeSession('abcdefghij', undefined)).toBe(true);
        expect(sidCanBeSession(LONG, undefined)).toBe(true);
        expect(sidCanBeSession('abcdefghij', 'benbenbenb')).toBe(true);
        expect(sidCanBeSession(LONG, 'benbenbenb')).toBe(true);
    });
});

describe('OcculiteAuthenticator', () => {
    it('lets a session in that the box knows, with the user and the role from /api/auth/v1/state', async () => {
        const {auth, calls} = box({enums: 200, state: {authenticated: true, user: 'anna', role: 'admin'}});
        await expect(auth.check('@abcdefghij@')).resolves.toEqual({sid: 'abcdefghij', name: 'anna', level: 8});
        expect(calls).toEqual([
            {path: '/api/meta/v1/enums', authorization: 'Bearer abcdefghij'},
            {path: '/api/auth/v1/state', authorization: 'Bearer abcdefghij'},
        ]);
    });

    it('refuses a session the box does not know, and asks nothing more', async () => {
        const {auth, calls} = box({enums: 401, state: {authenticated: true, user: 'anna'}});
        await expect(auth.check('abcdefghij')).resolves.toBeUndefined();
        await expect(auth.check('abcdefghij', {requireState: true})).resolves.toBeUndefined();
        expect(calls.map((call) => call.path)).toEqual(['/api/meta/v1/enums', '/api/meta/v1/enums']);
    });

    it('asks nothing for a value that is not a session id', async () => {
        const {auth, calls} = box({enums: 200, state: {authenticated: true, user: 'anna'}});
        await expect(auth.check('not a session')).resolves.toBeUndefined();
        expect(calls).toEqual([]);
    });

    describe('the ?sid= hand-over (D-40): /api/auth/v1/state only names the user', () => {
        it('still lets the session in when that answer fails', async () => {
            for (const state of [500, 401, {authenticated: false}, {authenticated: true}]) {
                const {auth} = box({enums: 200, state});
                await expect(auth.check('abcdefghij'), JSON.stringify(state)).resolves.toEqual({
                    sid: 'abcdefghij',
                    name: 'openccu-lite',
                    level: 2,
                });
            }
        });
    });

    describe('the X-Occulite-Session header (B-94): /api/auth/v1/state has to confirm it', () => {
        it('lets a confirmed session in', async () => {
            const {auth} = box({enums: 200, state: {authenticated: true, user: 'ben', role: 'user'}});
            await expect(auth.check('abcdefghij', {requireState: true})).resolves.toEqual({
                sid: 'abcdefghij',
                name: 'ben',
                level: 2,
            });
        });

        it('refuses it when the state check fails, says it is not authenticated or names no user', async () => {
            for (const state of [500, 401, {authenticated: false, user: 'ben'}, {authenticated: true}]) {
                const notices: string[] = [];
                const {auth, calls} = box({enums: 200, state}, notices);
                await expect(
                    auth.check('abcdefghij', {requireState: true}),
                    JSON.stringify(state),
                ).resolves.toBeUndefined();
                expect(calls.map((call) => call.path)).toContain('/api/auth/v1/state');
                expect(notices.join(' '), JSON.stringify(state)).toContain('X-Occulite-Session');
            }
        });
    });
});
