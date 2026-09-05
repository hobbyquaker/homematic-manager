import {PassThrough} from 'node:stream';
import type {IncomingMessage} from 'node:http';

import {describe, expect, it} from 'vitest';

import {
    clientAddress,
    escapeHtml,
    MAX_LOGIN_BODY_BYTES,
    parseLoginForm,
    pickLanguage,
    readBody,
    renderLoginPage,
} from './login.js';

/** An `IncomingMessage` enough of one for `readBody` and `clientAddress`. */
function fakeRequest(options: {remote?: string; headers?: Record<string, string>} = {}): IncomingMessage & {
    write(chunk: string): void;
    finish(): void;
} {
    const stream = new PassThrough() as unknown as IncomingMessage & {write(chunk: string): void; finish(): void};
    (stream as unknown as {socket: unknown}).socket = {remoteAddress: options.remote ?? '127.0.0.1'};
    (stream as unknown as {headers: unknown}).headers = options.headers ?? {};
    (stream as {finish(): void}).finish = () => {
        (stream as unknown as PassThrough).end();
    };
    return stream;
}

describe('escapeHtml', () => {
    it('lets nothing out of an attribute or an element', () => {
        expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
        expect(escapeHtml("a'b&c")).toBe('a&#39;b&amp;c');
    });
});

describe('pickLanguage', () => {
    it('takes an explicit choice first', () => {
        expect(pickLanguage('en', 'de-DE,de;q=0.9')).toBe('en');
        expect(pickLanguage('de', 'en-US,en;q=0.9')).toBe('de');
    });

    it('falls back to the browser, and to German - the CCU is a German appliance', () => {
        expect(pickLanguage(null, 'en-US,en;q=0.9')).toBe('en');
        expect(pickLanguage(undefined, 'de-DE,de;q=0.9')).toBe('de');
        expect(pickLanguage(undefined, 'fr-FR')).toBe('de');
        expect(pickLanguage('klingon', undefined)).toBe('de');
    });
});

describe('renderLoginPage', () => {
    it('is a whole document that needs nothing else - no script, no stylesheet, no asset', () => {
        const page = renderLoginPage({base: '/addons/hmm/', language: 'de'});
        expect(page.startsWith('<!doctype html>')).toBe(true);
        expect(page).not.toContain('<script');
        expect(page).not.toContain('<link');
        expect(page).toContain('<style>');
    });

    it('posts to the login route of its own base path', () => {
        expect(renderLoginPage({base: '/addons/hmm/', language: 'de'})).toContain('action="/addons/hmm/login"');
        expect(renderLoginPage({base: '/', language: 'en'})).toContain('action="/login"');
    });

    it('is German and English, each with a link to the other', () => {
        const german = renderLoginPage({base: '/', language: 'de'});
        expect(german).toContain('lang="de"');
        expect(german).toContain('Benutzername');
        expect(german).toContain('href="/login?lang=en"');
        const english = renderLoginPage({base: '/', language: 'en'});
        expect(english).toContain('lang="en"');
        expect(english).toContain('User name');
        expect(english).toContain('href="/login?lang=de"');
    });

    it('uses the theme tokens of the UI, in both schemes', () => {
        const page = renderLoginPage({base: '/', language: 'de'});
        expect(page).toContain('--hmm-accent: #2779aa;');
        expect(page).toContain('@media (prefers-color-scheme: dark)');
        expect(page).toContain('--hmm-bg: #1e2126;');
    });

    it('says the same thing for a wrong password and for an unknown user', () => {
        const page = renderLoginPage({base: '/', language: 'de', error: 'credentials'});
        expect(page).toContain('Benutzername oder Passwort ist falsch.');
        expect(page).toContain('data-error="credentials"');
        // no other message exists for the two cases: they are one error
        expect(page).not.toContain('unbekannt');
    });

    it('has a message for the rate limit and for a CCU that is not answering', () => {
        expect(renderLoginPage({base: '/', language: 'de', error: 'rate-limited'})).toContain('Zu viele');
        expect(renderLoginPage({base: '/', language: 'en', error: 'rate-limited'})).toContain('Too many');
        expect(renderLoginPage({base: '/', language: 'en', error: 'unavailable'})).toContain('not answering');
    });

    it('keeps the user name in the form and escapes it', () => {
        const page = renderLoginPage({base: '/', language: 'de', user: 'a"><script>x</script>'});
        expect(page).toContain('value="a&quot;&gt;&lt;script&gt;x&lt;/script&gt;"');
        expect(page).not.toContain('<script>');
    });
});

describe('parseLoginForm', () => {
    it('reads the three fields of the form', () => {
        expect(parseLoginForm('user=Admin&password=secret&lang=en')).toEqual({
            user: 'Admin',
            password: 'secret',
            language: 'en',
        });
    });

    it('trims the user name, keeps the password byte for byte and decodes the escapes', () => {
        const form = parseLoginForm('user=%20Admin%20&password=%20a%3Ab%20');
        expect(form.user).toBe('Admin');
        expect(form.password).toBe(' a:b ');
    });

    it('answers an empty or missing body with empty fields rather than throwing', () => {
        expect(parseLoginForm(undefined)).toEqual({user: '', password: '', language: 'de'});
        expect(parseLoginForm('')).toEqual({user: '', password: '', language: 'de'});
    });
});

describe('readBody', () => {
    it('reads a body', async () => {
        const request = fakeRequest();
        const body = readBody(request);
        request.write('user=Admin&password=x');
        request.finish();
        await expect(body).resolves.toBe('user=Admin&password=x');
    });

    it('refuses one that is far too large to be a login', async () => {
        const request = fakeRequest();
        const body = readBody(request, 16);
        request.write('x'.repeat(MAX_LOGIN_BODY_BYTES + 1));
        request.finish();
        await expect(body).resolves.toBeUndefined();
    });
});

describe('clientAddress', () => {
    it('is the peer address when the request did not come through a proxy', () => {
        expect(clientAddress(fakeRequest({remote: '192.168.1.10'}))).toBe('192.168.1.10');
    });

    it('believes X-Forwarded-For only from the loopback, and only its last entry', () => {
        // the last entry is the one the proxy that just talked to us added; the first is whatever
        // the client wrote itself, and believing that would hand out unlimited login attempts
        const proxied = fakeRequest({remote: '127.0.0.1', headers: {'x-forwarded-for': '1.2.3.4, 192.168.1.10'}});
        expect(clientAddress(proxied)).toBe('192.168.1.10');

        const direct = fakeRequest({remote: '10.0.0.9', headers: {'x-forwarded-for': '1.2.3.4'}});
        expect(clientAddress(direct)).toBe('10.0.0.9');
    });

    it('falls back to the peer address when the header is empty', () => {
        expect(clientAddress(fakeRequest({remote: '127.0.0.1', headers: {'x-forwarded-for': '  '}}))).toBe('127.0.0.1');
    });
});
