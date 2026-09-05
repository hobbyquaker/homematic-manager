import {describe, expect, it} from 'vitest';

import {createSessionId, DEFAULT_SESSION_TTL_MS, LOGIN_FAILURE_LIMIT, RateLimiter, SessionStore} from './sessions.js';

describe('createSessionId', () => {
    it('is 64 hex characters from the CSPRNG and never the same twice', () => {
        const first = createSessionId();
        expect(first).toMatch(/^[0-9a-f]{64}$/);
        expect(createSessionId()).not.toBe(first);
    });
});

describe('SessionStore', () => {
    it('defaults to the 24 hours D-32 asks for', () => {
        expect(new SessionStore().ttlMs).toBe(DEFAULT_SESSION_TTL_MS);
    });

    it('hands out a session and finds it again by its id', () => {
        const store = new SessionStore();
        const session = store.create('Admin', 8);
        expect(store.get(session.id)).toMatchObject({user: 'Admin', level: 8});
        expect(store.size).toBe(1);
    });

    it('knows nothing about an id it never issued', () => {
        const store = new SessionStore();
        store.create('Admin', 8);
        expect(store.get('nope')).toBeUndefined();
        expect(store.get('')).toBeUndefined();
        expect(store.get(undefined)).toBeUndefined();
    });

    it('slides the expiry on every use, so a tab in use never logs itself out', () => {
        let now = 0;
        const store = new SessionStore({ttlMs: 1000, now: () => now});
        const session = store.create('Admin', 8);
        for (let step = 0; step < 10; step += 1) {
            now += 900;
            expect(store.get(session.id), `step ${String(step)}`).toBeDefined();
        }
        // ten times as long as the ttl, and still logged in - because it was being used
        expect(now).toBe(9000);
    });

    it('forgets a session that was not used for the whole ttl', () => {
        let now = 0;
        const store = new SessionStore({ttlMs: 1000, now: () => now});
        const session = store.create('Admin', 8);
        now += 1001;
        expect(store.get(session.id)).toBeUndefined();
        expect(store.size).toBe(0);
    });

    it('ends one session on logout and every one on shutdown', () => {
        const store = new SessionStore();
        const first = store.create('Admin', 8);
        const second = store.create('Guest', 1);
        expect(store.remove(first.id)).toBe(true);
        expect(store.remove(first.id)).toBe(false);
        expect(store.remove(undefined)).toBe(false);
        expect(store.get(second.id)).toBeDefined();
        store.clear();
        expect(store.size).toBe(0);
    });

    it('sweeps the expired ones away when a new one is created', () => {
        let now = 0;
        let counter = 0;
        const store = new SessionStore({
            ttlMs: 1000,
            now: () => now,
            createId: () => {
                counter += 1;
                return `id-${String(counter)}`;
            },
        });
        store.create('Admin', 8);
        store.create('Guest', 1);
        expect(store.size).toBe(2);
        now += 2000;
        store.create('Admin', 8);
        expect(store.size).toBe(1);
    });
});

describe('RateLimiter', () => {
    it('lets five failures through and refuses the sixth attempt', () => {
        const limiter = new RateLimiter({now: () => 1000});
        expect(limiter.limit).toBe(LOGIN_FAILURE_LIMIT);
        for (let attempt = 0; attempt < LOGIN_FAILURE_LIMIT; attempt += 1) {
            expect(limiter.blocked('10.0.0.1')).toBe(false);
            limiter.fail('10.0.0.1');
        }
        expect(limiter.blocked('10.0.0.1')).toBe(true);
        expect(limiter.remaining('10.0.0.1')).toBe(0);
    });

    it('counts per source, so one browser cannot lock another out', () => {
        const limiter = new RateLimiter({now: () => 1000});
        for (let attempt = 0; attempt < 6; attempt += 1) {
            limiter.fail('10.0.0.1');
        }
        expect(limiter.blocked('10.0.0.1')).toBe(true);
        expect(limiter.blocked('10.0.0.2')).toBe(false);
    });

    it('forgets the failures a minute later', () => {
        let now = 1000;
        const limiter = new RateLimiter({windowMs: 60_000, now: () => now});
        for (let attempt = 0; attempt < 5; attempt += 1) {
            limiter.fail('10.0.0.1');
        }
        expect(limiter.blocked('10.0.0.1')).toBe(true);
        now += 60_001;
        expect(limiter.blocked('10.0.0.1')).toBe(false);
        expect(limiter.remaining('10.0.0.1')).toBe(5);
    });

    it('clears a source that finally got in', () => {
        const limiter = new RateLimiter({now: () => 1000});
        limiter.fail('10.0.0.1');
        limiter.fail('10.0.0.1');
        limiter.clear('10.0.0.1');
        expect(limiter.remaining('10.0.0.1')).toBe(5);
    });
});
