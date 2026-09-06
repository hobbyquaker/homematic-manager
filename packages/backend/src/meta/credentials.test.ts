/**
 * Where the credential comes from, and what shape it has.
 *
 * Small rules, but every one of them is a way to be locked out of a box that is working perfectly:
 * a token file with a trailing newline, a session id that still has the CCU's `@` wrapping around
 * it, a settings field with a space pasted in front of the token.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import {LOCAL_TOKEN_FILE, isApiToken, normaliseSid, readLocalToken} from './credentials.js';

let dir: string;

beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-token-'));
});

afterAll(async () => {
    await fs.rm(dir, {recursive: true, force: true});
});

describe('the local token file', () => {
    it('is where openccu-lite puts it', () => {
        expect(LOCAL_TOKEN_FILE).toBe('/usr/local/etc/occulite/local-token');
    });

    it('reads the one line, newline and all', async () => {
        const file = path.join(dir, 'local-token');
        await fs.writeFile(file, 'olt_4eb74a1a653b860a23ae976f72c286ba\n');
        await expect(readLocalToken(file)).resolves.toBe('olt_4eb74a1a653b860a23ae976f72c286ba');
    });

    it('answers undefined for a file that is not there - every install that is not the addon', async () => {
        await expect(readLocalToken(path.join(dir, 'nope'))).resolves.toBeUndefined();
    });

    it('answers undefined for an empty file rather than sending an empty Bearer', async () => {
        const file = path.join(dir, 'empty');
        await fs.writeFile(file, '\n\n');
        await expect(readLocalToken(file)).resolves.toBeUndefined();
    });
});

describe('isApiToken', () => {
    it('recognises the token the Users page hands out', () => {
        expect(isApiToken('olt_4eb74a1a653b860a23ae976f72c286ba')).toBe(true);
        expect(isApiToken('  olt_4eb74a1a653b860a23ae976f72c286ba  ')).toBe(true);
    });

    it('refuses everything else, so a settings field can say so before it is used', () => {
        expect(isApiToken('olt_short')).toBe(false);
        expect(isApiToken('4eb74a1a653b860a23ae976f72c286ba')).toBe(false);
        expect(isApiToken('')).toBe(false);
    });
});

describe('normaliseSid', () => {
    it('takes the CCU spelling and the bare one', () => {
        expect(normaliseSid('@abcdefghij@')).toBe('abcdefghij');
        expect(normaliseSid('abcdefghij')).toBe('abcdefghij');
    });

    it('answers undefined for something that is not a session id', () => {
        expect(normaliseSid(undefined)).toBeUndefined();
        expect(normaliseSid('')).toBeUndefined();
        expect(normaliseSid('short')).toBeUndefined();
        expect(normaliseSid('has spaces in it')).toBeUndefined();
        expect(normaliseSid('../../etc/passwd')).toBeUndefined();
    });
});
