/**
 * D-32: the login page, the form it posts, and who the host thinks is asking.
 *
 * The page is one string of HTML with its CSS inlined: no framework, no bundle step, no request
 * for an asset that the very gate it belongs to would have to let through. It carries the same
 * theme tokens as the UI (`packages/ui/src/app.css`), light and dark, so the login and the
 * application do not look like two different programs - D-3 applies to the door as well.
 *
 * German and English: the CCU's own WebUI is German, and this page sits in front of it. The
 * language comes from `?lang=` when the visitor picked one and from `Accept-Language` otherwise -
 * the browser's first supported entry, with English behind it (D-36), so the door speaks the same
 * language as the room. The other one is always one link away. Everything is in the chosen language;
 * nothing here needs `packages/core`'s catalogue, which lives in the bundle this page replaces.
 */

import type {IncomingMessage} from 'node:http';

/** The two languages the UI has; the login page has the same two. */
export type LoginLanguage = 'de' | 'en';

/** Why the page is being shown again. */
export type LoginError = 'credentials' | 'rate-limited' | 'unavailable';

/** The most a login form may send. A body larger than this is not a login attempt. */
export const MAX_LOGIN_BODY_BYTES = 4096;

export interface LoginPageOptions {
    /** The URL prefix everything is served under; the form posts to `<base>login`. */
    readonly base: string;
    readonly language: LoginLanguage;
    readonly error?: LoginError | undefined;
    /** Prefilled after a failed attempt, so only the password has to be typed again. */
    readonly user?: string | undefined;
}

interface Texts {
    readonly title: string;
    readonly intro: string;
    readonly user: string;
    readonly password: string;
    readonly submit: string;
    readonly other: string;
    readonly errors: Record<LoginError, string>;
}

const TEXTS: Record<LoginLanguage, Texts> = {
    de: {
        title: 'Anmeldung',
        intro: 'Bitte mit einem Benutzer der CCU anmelden.',
        user: 'Benutzername',
        password: 'Passwort',
        submit: 'Anmelden',
        other: 'English',
        errors: {
            // deliberately one message for both cases: a different one for "no such user" would
            // turn this form into a list of the CCU's user names
            credentials: 'Benutzername oder Passwort ist falsch.',
            'rate-limited': 'Zu viele Fehlversuche. Bitte eine Minute warten.',
            unavailable: 'Die Anmeldung ist gerade nicht möglich - die CCU antwortet nicht.',
        },
    },
    en: {
        title: 'Sign in',
        intro: 'Please sign in with a user of the CCU.',
        user: 'User name',
        password: 'Password',
        submit: 'Sign in',
        other: 'Deutsch',
        errors: {
            credentials: 'Wrong user name or password.',
            'rate-limited': 'Too many failed attempts. Please wait a minute.',
            unavailable: 'Signing in is not possible right now - the CCU is not answering.',
        },
    },
};

/** Everything that goes into HTML goes through this; the user name comes from a form field. */
export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** `de` or `en` from a `?lang=` value and an `Accept-Language` header, in that order. */
export function pickLanguage(requested: string | null | undefined, acceptLanguage: string | undefined): LoginLanguage {
    if (requested === 'de' || requested === 'en') {
        return requested;
    }
    // D-36: the browser's own order decides, English behind it - the same rule the application
    // itself follows. Until 3.0.0-dev.7 this was German unless the browser clearly asked for
    // English, which put a German login page in front of an English UI for everyone else.
    for (const entry of (acceptLanguage ?? '').split(',')) {
        // `de-DE;q=0.9` -> `de`
        const code = entry.split(';')[0]?.trim().toLowerCase().split('-')[0];
        if (code === 'de' || code === 'en') {
            return code;
        }
    }
    return 'en';
}

/** The login page. One self-contained document - it is served while nothing else is. */
export function renderLoginPage(options: LoginPageOptions): string {
    const texts = TEXTS[options.language];
    const other: LoginLanguage = options.language === 'de' ? 'en' : 'de';
    const message = options.error === undefined ? '' : texts.errors[options.error];
    return `<!doctype html>
<html lang="${options.language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Homematic Manager - ${escapeHtml(texts.title)}</title>
<style>
:root {
    color-scheme: light;
    --hmm-bg: #ffffff;
    --hmm-bg-sunken: #f2f5f7;
    --hmm-header-solid: #eaeaea;
    --hmm-border: #c5dbec;
    --hmm-border-strong: #a6c9e2;
    --hmm-fg: #222222;
    --hmm-fg-muted: #666666;
    --hmm-accent: #2779aa;
    --hmm-error: #cc2222;
    --hmm-focus: #4d90fe;
    --hmm-font: -apple-system, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    --hmm-radius: 3px;
}
@media (prefers-color-scheme: dark) {
    :root {
        color-scheme: dark;
        --hmm-bg: #1e2126;
        --hmm-bg-sunken: #191c20;
        --hmm-header-solid: #2c3037;
        --hmm-border: #3b444f;
        --hmm-border-strong: #4a5563;
        --hmm-fg: #e3e6ea;
        --hmm-fg-muted: #a4abb4;
        --hmm-accent: #6db3e8;
        --hmm-error: #f06a6a;
        --hmm-focus: #6db3e8;
    }
}
body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--hmm-bg-sunken);
    color: var(--hmm-fg);
    font-family: var(--hmm-font);
    font-size: 13px;
}
main {
    width: 320px;
    max-width: calc(100vw - 32px);
    padding: 24px;
    background: var(--hmm-bg);
    border: 1px solid var(--hmm-border);
    border-radius: var(--hmm-radius);
    box-shadow: 0 2px 8px rgb(0 0 0 / 12%);
}
h1 {
    margin: 0 0 4px;
    font-size: 16px;
    font-weight: 600;
}
p {
    margin: 0 0 16px;
    color: var(--hmm-fg-muted);
}
label {
    display: block;
    margin-bottom: 10px;
}
label span {
    display: block;
    margin-bottom: 3px;
}
input {
    box-sizing: border-box;
    width: 100%;
    padding: 6px 7px;
    font: inherit;
    color: var(--hmm-fg);
    background: var(--hmm-bg);
    border: 1px solid var(--hmm-border-strong);
    border-radius: var(--hmm-radius);
}
input:focus-visible {
    outline: 2px solid var(--hmm-focus);
    outline-offset: -1px;
}
button {
    width: 100%;
    margin-top: 6px;
    padding: 7px 10px;
    font: inherit;
    color: var(--hmm-bg);
    background: var(--hmm-accent);
    border: 1px solid var(--hmm-accent);
    border-radius: var(--hmm-radius);
    cursor: pointer;
}
.error {
    margin: 0 0 12px;
    padding: 7px 9px;
    color: var(--hmm-error);
    background: var(--hmm-header-solid);
    border: 1px solid var(--hmm-error);
    border-radius: var(--hmm-radius);
}
footer {
    margin-top: 16px;
    text-align: right;
}
footer a {
    color: var(--hmm-accent);
}
</style>
</head>
<body>
<main>
<h1>Homematic Manager</h1>
<p>${escapeHtml(texts.intro)}</p>
${message === '' ? '' : `<p class="error" role="alert" data-error="${options.error ?? ''}">${escapeHtml(message)}</p>\n`}<form method="post" action="${escapeHtml(options.base)}login">
<input type="hidden" name="lang" value="${options.language}">
<label><span>${escapeHtml(texts.user)}</span><input name="user" autocomplete="username" autofocus required value="${escapeHtml(options.user ?? '')}"></label>
<label><span>${escapeHtml(texts.password)}</span><input name="password" type="password" autocomplete="current-password" required></label>
<button type="submit">${escapeHtml(texts.submit)}</button>
</form>
<footer><a href="${escapeHtml(options.base)}login?lang=${other}">${escapeHtml(texts.other)}</a></footer>
</main>
</body>
</html>
`;
}

/**
 * The body of a `POST`, up to {@link MAX_LOGIN_BODY_BYTES}.
 *
 * A larger body is not a login attempt; the request is drained and the caller gets `undefined`
 * rather than a host that buffers whatever someone sends it.
 */
export function readBody(request: IncomingMessage, limit = MAX_LOGIN_BODY_BYTES): Promise<string | undefined> {
    return new Promise((resolve) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let done = false;
        const finish = (value: string | undefined): void => {
            if (done) {
                return;
            }
            done = true;
            resolve(value);
        };
        request.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > limit) {
                request.resume();
                finish(undefined);
                return;
            }
            chunks.push(chunk);
        });
        request.on('end', () => {
            finish(Buffer.concat(chunks).toString('utf8'));
        });
        request.on('error', () => {
            finish(undefined);
        });
        request.on('aborted', () => {
            finish(undefined);
        });
    });
}

export interface LoginForm {
    readonly user: string;
    readonly password: string;
    readonly language: LoginLanguage;
}

/** The three fields of the form out of an `application/x-www-form-urlencoded` body. */
export function parseLoginForm(body: string | undefined, acceptLanguage?: string): LoginForm {
    const values = new URLSearchParams(body ?? '');
    return {
        user: (values.get('user') ?? '').trim(),
        password: values.get('password') ?? '',
        language: pickLanguage(values.get('lang'), acceptLanguage),
    };
}

/**
 * The source a rate limit should count against.
 *
 * Behind the CCU's lighttpd every request arrives from 127.0.0.1, so the browser's own address has
 * to come out of `X-Forwarded-For` - and out of its **last** entry, which is the one the proxy
 * that just talked to us added. Taking the first would let a client write its own header and get
 * an unlimited number of attempts. A request that did not come from the loopback is not behind our
 * proxy, so its own address is the answer and no header is believed at all.
 */
export function clientAddress(request: IncomingMessage): string {
    const remote = request.socket.remoteAddress ?? 'unknown';
    if (!isLoopbackAddress(remote)) {
        return remote;
    }
    const forwarded = request.headers['x-forwarded-for'];
    const header = Array.isArray(forwarded) ? forwarded[forwarded.length - 1] : forwarded;
    const entries = (header ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '');
    return entries[entries.length - 1] ?? remote;
}

function isLoopbackAddress(address: string): boolean {
    return address === '::1' || address === '::ffff:127.0.0.1' || address.startsWith('127.');
}
