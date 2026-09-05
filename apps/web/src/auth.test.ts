import {describe, expect, it} from 'vitest';

import {
    applyCookieToken,
    applySessionToken,
    clearedSessionCookie,
    createToken,
    hasTokenQuery,
    isLoopbackHost,
    readCookie,
    SESSION_COOKIE,
    sessionCookie,
    TOKEN_COOKIE,
    tokenCookie,
    withTokenQuery,
} from './auth.js';

describe('createToken', () => {
    it('is 32 hex characters and never the same twice', () => {
        const first = createToken();
        expect(first).toMatch(/^[0-9a-f]{32}$/);
        expect(createToken()).not.toBe(first);
    });
});

describe('readCookie', () => {
    it('finds a value between the others', () => {
        expect(readCookie('a=1; hmm_token=abc; b=2', TOKEN_COOKIE)).toBe('abc');
    });

    it('decodes percent escapes and tolerates whitespace', () => {
        expect(readCookie('hmm_token=a%20b', TOKEN_COOKIE)).toBe('a b');
        expect(readCookie('  hmm_token = x ', TOKEN_COOKIE)).toBe('x');
    });

    it('is undefined for a missing header, a missing name and a malformed part', () => {
        expect(readCookie(undefined, TOKEN_COOKIE)).toBeUndefined();
        expect(readCookie('other=1', TOKEN_COOKIE)).toBeUndefined();
        expect(readCookie('novalue; other=1', TOKEN_COOKIE)).toBeUndefined();
    });
});

describe('tokenCookie', () => {
    it('scopes the cookie to the base path and keeps it away from scripts', () => {
        expect(tokenCookie('abc', '/')).toBe('hmm_token=abc; Path=/; HttpOnly; SameSite=Strict');
    });

    it('adds Secure when the page is served over https', () => {
        expect(tokenCookie('abc', '/addons/hmm/', true)).toBe(
            'hmm_token=abc; Path=/addons/hmm/; HttpOnly; SameSite=Strict; Secure',
        );
    });
});

describe('isLoopbackHost', () => {
    it('knows what only this machine can reach', () => {
        for (const host of ['127.0.0.1', '127.1.2.3', 'localhost', '::1', '[::1]', '::ffff:127.0.0.1']) {
            expect(isLoopbackHost(host), host).toBe(true);
        }
        for (const host of ['0.0.0.0', '192.168.1.5', '::', 'ccu3']) {
            expect(isLoopbackHost(host), host).toBe(false);
        }
    });
});

describe('the query token', () => {
    it('is recognised and appended', () => {
        expect(hasTokenQuery('/api')).toBe(false);
        expect(hasTokenQuery('/api?token=x')).toBe(true);
        expect(hasTokenQuery(undefined)).toBe(false);
        expect(withTokenQuery('/api', 'x')).toBe('/api?token=x');
        expect(withTokenQuery('/addons/hmm/api?a=1', 'x')).toBe('/addons/hmm/api?a=1&token=x');
    });
});

describe('applyCookieToken', () => {
    it('turns a valid cookie into the query form the backend understands', () => {
        const request = {url: '/api', headers: {cookie: 'hmm_token=secret'}};
        applyCookieToken(request, 'secret');
        expect(request.url).toBe('/api?token=secret');
    });

    it('leaves a request with a wrong or missing cookie alone, so the backend answers 401', () => {
        const wrong = {url: '/api', headers: {cookie: 'hmm_token=other'}};
        applyCookieToken(wrong, 'secret');
        expect(wrong.url).toBe('/api');

        const none = {url: '/api', headers: {}};
        applyCookieToken(none, 'secret');
        expect(none.url).toBe('/api');
    });

    it('does nothing when there is no token at all or one is already in the url', () => {
        const noAuth = {url: '/api', headers: {cookie: 'hmm_token=secret'}};
        applyCookieToken(noAuth, undefined);
        applyCookieToken(noAuth, '');
        expect(noAuth.url).toBe('/api');

        const explicit = {url: '/api?token=given', headers: {cookie: 'hmm_token=secret'}};
        applyCookieToken(explicit, 'secret');
        expect(explicit.url).toBe('/api?token=given');
    });
});

describe('the session cookie (D-32)', () => {
    it('carries the sliding lifetime as Max-Age and is scoped like the token cookie', () => {
        expect(sessionCookie('abc', '/addons/hmm/', 86_400)).toBe(
            'hmm_session=abc; Path=/addons/hmm/; Max-Age=86400; HttpOnly; SameSite=Strict',
        );
        expect(sessionCookie('abc', '/', 60, true)).toBe(
            'hmm_session=abc; Path=/; Max-Age=60; HttpOnly; SameSite=Strict; Secure',
        );
        // a fractional or negative lifetime is not a header a browser should have to parse
        expect(sessionCookie('abc', '/', -5)).toContain('Max-Age=0');
        expect(sessionCookie('abc', '/', 1.7)).toContain('Max-Age=1');
    });

    it('is cleared by the same cookie with Max-Age=0 - that is what logout answers with', () => {
        expect(clearedSessionCookie('/addons/hmm/')).toBe(
            'hmm_session=; Path=/addons/hmm/; Max-Age=0; HttpOnly; SameSite=Strict',
        );
        expect(clearedSessionCookie('/', true)).toContain('; Secure');
    });

    it('is read back by name like every other cookie', () => {
        expect(readCookie('a=1; hmm_session=xyz; hmm_token=abc', SESSION_COOKIE)).toBe('xyz');
    });
});

describe('applySessionToken', () => {
    const valid = (id: string): boolean => id === 'live';

    it('opens the api socket for a session the host still knows', () => {
        const request = {url: '/api', headers: {cookie: 'hmm_session=live'}};
        applySessionToken(request, 'secret', valid);
        expect(request.url).toBe('/api?token=secret');
    });

    it('leaves a forged, an expired and a missing session alone, so the backend answers 401', () => {
        for (const cookie of ['hmm_session=forged', 'hmm_session=', 'hmm_token=other', '']) {
            const request = {url: '/api', headers: {cookie}};
            applySessionToken(request, 'secret', valid);
            expect(request.url, cookie).toBe('/api');
        }
    });

    it('does nothing without a token or when one is already in the url', () => {
        const noAuth = {url: '/api', headers: {cookie: 'hmm_session=live'}};
        applySessionToken(noAuth, undefined, valid);
        expect(noAuth.url).toBe('/api');

        const explicit = {url: '/api?token=given', headers: {cookie: 'hmm_session=live'}};
        applySessionToken(explicit, 'secret', valid);
        expect(explicit.url).toBe('/api?token=given');
    });
});
