import {createSocket, type Socket} from 'node:dgram';

import {afterEach, describe, expect, it} from 'vitest';

import {authDatagram, escapeAuthField, readUser, RegaAuthenticator, type RegaExec} from './auth.js';
import {userLookupScript} from './scripts.js';

/**
 * A fake ReGa: it answers the lookup script the way ReGaHSS does - the object variable comes back
 * as the object's name - and counts how often it was asked, which is what the cache and the
 * de-duplication are about.
 */
function fakeRega(users: Record<string, number>): RegaExec & {calls: string[]; fail: boolean; delayMs: number} {
    const fake = {
        calls: [] as string[],
        fail: false,
        delayMs: 0,
        async exec(script: string): Promise<{output: string; objects: Record<string, string>}> {
            fake.calls.push(script);
            if (fake.delayMs > 0) {
                await new Promise<void>((resolve) => setTimeout(resolve, fake.delayMs));
            }
            if (fake.fail) {
                throw new Error('rega is busy');
            }
            const match = /Get\("(.*)"\)/.exec(script);
            const name = (match?.[1] ?? '').replace(/\\(.)/g, '$1');
            const level = users[name];
            // ReGa leaves a variable that was never assigned out of the xml block entirely
            return level === undefined
                ? {output: '', objects: {user: ''}}
                : {output: '', objects: {user: name, level: String(level)}};
        },
    };
    return fake;
}

/** A fake authentication daemon: one datagram in, `1` or `0` out, and it remembers what it saw. */
class FakeAuthDaemon {
    readonly received: string[] = [];
    silent = false;
    #socket: Socket | undefined;
    #port = 0;

    async start(expected: string): Promise<number> {
        const socket = createSocket('udp4');
        this.#socket = socket;
        socket.on('message', (message, remote) => {
            this.received.push(message.toString('latin1'));
            if (this.silent) {
                return;
            }
            socket.send(message.toString('latin1') === expected ? '1' : '0', remote.port, remote.address);
        });
        await new Promise<void>((resolve) => {
            socket.bind(0, '127.0.0.1', () => {
                resolve();
            });
        });
        this.#port = socket.address().port;
        return this.#port;
    }

    get port(): number {
        return this.#port;
    }

    close(): void {
        this.#socket?.close();
        this.#socket = undefined;
    }
}

const daemons: FakeAuthDaemon[] = [];

async function daemon(expected: string): Promise<FakeAuthDaemon> {
    const instance = new FakeAuthDaemon();
    await instance.start(expected);
    daemons.push(instance);
    return instance;
}

afterEach(() => {
    for (const instance of daemons.splice(0)) {
        instance.close();
    }
});

describe('the lookup script', () => {
    it('asks ID_USERS for the name and for its level', () => {
        expect(userLookupScript('Admin')).toBe(
            'var user = dom.GetObject(ID_USERS).Get("Admin");\nvar level;\nif (user) {\n    level = user.UserLevel();\n}\n',
        );
    });

    it('escapes a name instead of letting it write the script', () => {
        const script = userLookupScript('a"); Foo(') as string;
        expect(script).toContain('Get("a\\"); Foo(")');
        expect(script.split('\n')[0]).toBe('var user = dom.GetObject(ID_USERS).Get("a\\"); Foo(");');
    });

    it('refuses what cannot be a CCU user name at all', () => {
        expect(userLookupScript('')).toBeUndefined();
        expect(userLookupScript('x'.repeat(65))).toBeUndefined();
        // a control character in the name is the interesting one: it is what could add a second
        // statement to the script. Built rather than written as an escape so this file stays
        // plain text.
        expect(userLookupScript(`a${String.fromCharCode(0)}b`)).toBeUndefined();
        expect(userLookupScript(`a${String.fromCharCode(10)}b`)).toBeUndefined();
    });
});

describe('readUser', () => {
    it('takes the name coming back unchanged as the proof that the user exists', () => {
        expect(readUser('Admin', {user: 'Admin', level: '8'})).toEqual({name: 'Admin', level: 8});
        expect(readUser('Admin', {user: '', level: ''})).toBeUndefined();
        expect(readUser('Admin', {user: 'admin', level: '8'})).toBeUndefined();
        expect(readUser('Admin', {})).toBeUndefined();
    });

    it('treats a level ReGa did not report as no level rather than as NaN', () => {
        expect(readUser('Guest', {user: 'Guest'})).toEqual({name: 'Guest', level: 0});
    });
});

describe('the credential datagram', () => {
    it('escapes the backslash first and then the colon, as the daemon splits on it', () => {
        expect(escapeAuthField('a:b')).toBe('a\\:b');
        expect(escapeAuthField('a\\b')).toBe('a\\\\b');
        expect(escapeAuthField('a\\:b')).toBe('a\\\\\\:b');
        expect(authDatagram('user', 'pass:word').toString('latin1')).toBe('user:pass\\:word');
    });
});

describe('RegaAuthenticator', () => {
    it('finds a user and its level through ReGa', async () => {
        const rega = fakeRega({Admin: 8});
        const auth = new RegaAuthenticator({rega});
        await expect(auth.lookup('Admin')).resolves.toEqual({name: 'Admin', level: 8});
        await expect(auth.lookup('Nobody')).resolves.toBeUndefined();
    });

    it('asks ReGa once per user and then answers from the cache', async () => {
        const rega = fakeRega({Admin: 8});
        const auth = new RegaAuthenticator({rega});
        await auth.lookup('Admin');
        await auth.lookup('Admin');
        await auth.lookup('Admin');
        expect(rega.calls).toHaveLength(1);
        expect(auth.cached).toBe(1);
    });

    it('lets parallel lookups of one user share a single script run', async () => {
        // this is the RedMatic 9.2.0 bug: ReGa runs scripts one at a time, and a page load asking
        // three times in parallel got random 401s because two of the three timed out
        const rega = fakeRega({Admin: 8});
        rega.delayMs = 20;
        const auth = new RegaAuthenticator({rega});
        const [a, b, c] = await Promise.all([auth.lookup('Admin'), auth.lookup('Admin'), auth.lookup('Admin')]);
        expect(rega.calls).toHaveLength(1);
        expect(a).toEqual(b);
        expect(b).toEqual(c);
    });

    it('expires the cache after the ttl', async () => {
        const rega = fakeRega({Admin: 8});
        let now = 1000;
        const auth = new RegaAuthenticator({rega, cacheTtlMs: 60_000, now: () => now});
        await auth.lookup('Admin');
        now += 59_000;
        await auth.lookup('Admin');
        expect(rega.calls).toHaveLength(1);
        now += 2000;
        await auth.lookup('Admin');
        expect(rega.calls).toHaveLength(2);
    });

    it('keeps a known user logged in while ReGa is unreachable, and cannot let a new one in', async () => {
        const rega = fakeRega({Admin: 8});
        const notices: string[] = [];
        const auth = new RegaAuthenticator({
            rega,
            cacheTtlMs: 0,
            onNotice: (_level, message) => notices.push(message),
        });
        await expect(auth.lookup('Admin')).resolves.toEqual({name: 'Admin', level: 8});
        rega.fail = true;
        await expect(auth.lookup('Admin')).resolves.toEqual({name: 'Admin', level: 8});
        await expect(auth.lookup('Someone')).resolves.toBeUndefined();
        expect(notices.some((message) => message.includes('rega is busy'))).toBe(true);
    });

    it('forgets a user the CCU no longer has', async () => {
        const users: Record<string, number> = {Admin: 8};
        const rega = fakeRega(users);
        const auth = new RegaAuthenticator({rega, cacheTtlMs: 0});
        await auth.lookup('Admin');
        expect(auth.cached).toBe(1);
        delete users['Admin'];
        await expect(auth.lookup('Admin')).resolves.toBeUndefined();
        expect(auth.cached).toBe(0);
    });

    it('clears the cache on request', async () => {
        const rega = fakeRega({Admin: 8});
        const auth = new RegaAuthenticator({rega});
        await auth.lookup('Admin');
        auth.clearCache();
        await auth.lookup('Admin');
        expect(rega.calls).toHaveLength(2);
    });

    it('checks the password against the udp daemon, escaping included', async () => {
        const responder = await daemon('Admin:pass\\:word');
        const auth = new RegaAuthenticator({rega: fakeRega({Admin: 8}), authPort: responder.port});
        await expect(auth.authenticate('Admin', 'pass:word')).resolves.toEqual({name: 'Admin', level: 8});
        expect(responder.received).toEqual(['Admin:pass\\:word']);
    });

    it('answers a wrong password and an unknown user the same way', async () => {
        const responder = await daemon('Admin:right');
        const auth = new RegaAuthenticator({rega: fakeRega({Admin: 8}), authPort: responder.port});
        await expect(auth.authenticate('Admin', 'wrong')).resolves.toBeUndefined();
        await expect(auth.authenticate('Nobody', 'right')).resolves.toBeUndefined();
        // and an unknown user never reaches the daemon at all
        expect(responder.received).toEqual(['Admin:wrong']);
    });

    it('treats a daemon that does not answer as a no, without hanging', async () => {
        const responder = await daemon('Admin:right');
        responder.silent = true;
        const auth = new RegaAuthenticator({
            rega: fakeRega({Admin: 8}),
            authPort: responder.port,
            timeoutMs: 50,
        });
        await expect(auth.authenticate('Admin', 'right')).resolves.toBeUndefined();
    });

    it('treats a daemon that is not there as a no', async () => {
        const notices: string[] = [];
        const auth = new RegaAuthenticator({
            rega: fakeRega({Admin: 8}),
            // a port nothing is bound to: the kernel answers the datagram with ICMP port
            // unreachable, which reaches the socket as an error - and where it does not, the
            // timeout below is the answer
            authPort: 1,
            timeoutMs: 200,
            onNotice: (_level, message) => notices.push(message),
        });
        await expect(auth.authenticate('Admin', 'right')).resolves.toBeUndefined();
        expect(notices.length).toBeGreaterThan(0);
    });

    it('builds its own ReGa client only when it is first needed', () => {
        // the constructor must not talk to anything: an addon in token mode constructs nothing at
        // all, and a host that never sees a login never opens a socket to ReGa
        const auth = new RegaAuthenticator({host: '127.0.0.1', port: 1});
        expect(auth.cached).toBe(0);
    });
});
