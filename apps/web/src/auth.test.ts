import {describe, expect, it} from 'vitest';

import {
    applyCookieToken,
    createToken,
    hasTokenQuery,
    isLoopbackHost,
    readCookie,
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
