import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {DebouncedJsonFile, readJsonFile, removeFile, writeJsonFile} from './jsonFile.js';

let dir: string;

beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-json-'));
});

afterEach(async () => {
    await fs.rm(dir, {recursive: true, force: true});
});

describe('readJsonFile', () => {
    it('reads what writeJsonFile wrote, creating the directory', async () => {
        const file = path.join(dir, 'deep', 'config.json');
        await writeJsonFile(file, {host: 'ccu', interfaces: ['BidCos-RF']});
        await expect(readJsonFile(file)).resolves.toEqual({host: 'ccu', interfaces: ['BidCos-RF']});
    });

    it('is undefined for a missing file', async () => {
        await expect(readJsonFile(path.join(dir, 'nope.json'))).resolves.toBeUndefined();
    });

    it('is undefined for a file that is not JSON', async () => {
        const file = path.join(dir, 'broken.json');
        await fs.writeFile(file, '{not json', 'utf8');
        await expect(readJsonFile(file)).resolves.toBeUndefined();
    });
});

describe('writeJsonFile', () => {
    it('leaves no temporary file behind', async () => {
        const file = path.join(dir, 'a.json');
        await writeJsonFile(file, {a: 1});
        await expect(fs.readdir(dir)).resolves.toEqual(['a.json']);
    });

    it('replaces an existing file', async () => {
        const file = path.join(dir, 'a.json');
        await writeJsonFile(file, {a: 1});
        await writeJsonFile(file, {a: 2});
        await expect(readJsonFile(file)).resolves.toEqual({a: 2});
    });

    it('takes writes to one file that overlap one after another, and the last one wins (B-43)', async () => {
        const file = path.join(dir, 'occulite-meta.json');
        // what quick successive room assignments did: each saved the cache without waiting for the last
        const writes = Array.from({length: 20}, (_, n) => writeJsonFile(file, {n}));
        await expect(Promise.all(writes)).resolves.toHaveLength(20);
        await expect(readJsonFile(file)).resolves.toEqual({n: 19});
        await expect(fs.readdir(dir)).resolves.toEqual(['occulite-meta.json']);
    });

    it('writes the value as it was at the call, not as it is when the turn comes', async () => {
        const file = path.join(dir, 'a.json');
        const value = {a: 1};
        const first = writeJsonFile(file, {b: 0});
        const second = writeJsonFile(file, value);
        value.a = 2;
        await Promise.all([first, second]);
        await expect(readJsonFile(file)).resolves.toEqual({a: 1});
    });

    it('goes on writing after a write that failed', async () => {
        const file = path.join(dir, 'a.json');
        const write = vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('disk full'));
        const failed = writeJsonFile(file, {a: 1});
        const next = writeJsonFile(file, {a: 2});
        await expect(failed).rejects.toThrow('disk full');
        await next;
        write.mockRestore();
        await expect(readJsonFile(file)).resolves.toEqual({a: 2});
    });
});

describe('writeJsonFile and unchanged content', () => {
    it('does not write a file again whose content did not change', async () => {
        const file = path.join(dir, 'devices.json');
        await expect(writeJsonFile(file, {a: [1, 2]})).resolves.toBe(true);
        const spy = vi.spyOn(fs, 'writeFile');
        try {
            await expect(writeJsonFile(file, {a: [1, 2]})).resolves.toBe(false);
            expect(spy).not.toHaveBeenCalled();
            await expect(writeJsonFile(file, {a: [1, 3]})).resolves.toBe(true);
            expect(spy).toHaveBeenCalledTimes(1);
        } finally {
            spy.mockRestore();
        }
        await expect(readJsonFile(file)).resolves.toEqual({a: [1, 3]});
    });

    it('knows what it read: the same value written after a read is skipped', async () => {
        const file = path.join(dir, 'names.json');
        await fs.writeFile(file, `${JSON.stringify({x: 'y'}, null, 2)}\n`, 'utf8');
        await readJsonFile(file);
        await expect(writeJsonFile(file, {x: 'y'})).resolves.toBe(false);
        // another layout of the same value is another text, and is written once
        await fs.writeFile(file, JSON.stringify({x: 'y'}), 'utf8');
        await readJsonFile(file);
        await expect(writeJsonFile(file, {x: 'y'})).resolves.toBe(true);
        await expect(writeJsonFile(file, {x: 'y'})).resolves.toBe(false);
    });

    it('writes again when the file was deleted or replaced behind its back', async () => {
        const file = path.join(dir, 'a.json');
        await writeJsonFile(file, {a: 1});
        await fs.rm(file);
        await expect(writeJsonFile(file, {a: 1})).resolves.toBe(true);
        await fs.writeFile(file, '{}', 'utf8');
        await expect(writeJsonFile(file, {a: 1})).resolves.toBe(true);
        await expect(readJsonFile(file)).resolves.toEqual({a: 1});
        await removeFile(file);
        await expect(writeJsonFile(file, {a: 1})).resolves.toBe(true);
    });

    it('forgets a file it could not read', async () => {
        const file = path.join(dir, 'gone.json');
        await writeJsonFile(file, {a: 1});
        await fs.rm(file);
        await expect(readJsonFile(file)).resolves.toBeUndefined();
        await expect(writeJsonFile(file, {a: 1})).resolves.toBe(true);
    });
});

describe('removeFile', () => {
    it('removes a file and tolerates a missing one', async () => {
        const file = path.join(dir, 'a.json');
        await writeJsonFile(file, {a: 1});
        await removeFile(file);
        await removeFile(file);
        await expect(readJsonFile(file)).resolves.toBeUndefined();
    });
});

describe('DebouncedJsonFile', () => {
    it('writes the newest value once after the delay', async () => {
        const file = path.join(dir, 'devices.json');
        const write = vi.spyOn(fs, 'writeFile');
        const store = new DebouncedJsonFile<{n: number}>(file, {delayMs: 5});
        store.save({n: 1});
        store.save({n: 2});
        store.save({n: 3});
        expect(store.dirty).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 30));
        // the timer fired; flush() with nothing pending waits for the write it started
        await store.flush();
        expect(store.dirty).toBe(false);
        expect(write).toHaveBeenCalledTimes(1);
        await expect(store.read()).resolves.toEqual({n: 3});
        write.mockRestore();
    });

    it('flush writes immediately and is a no-op without pending changes', async () => {
        const store = new DebouncedJsonFile<{n: number}>(path.join(dir, 'names.json'), {delayMs: 10_000});
        store.save({n: 5});
        await store.flush();
        await expect(store.read()).resolves.toEqual({n: 5});
        await expect(store.flush()).resolves.toBeUndefined();
    });

    it('reports a write error instead of throwing', async () => {
        const onError = vi.fn();
        const store = new DebouncedJsonFile(path.join(dir, 'sub', 'x.json'), {delayMs: 0, onError});
        vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('EACCES'));
        store.save({a: 1});
        await store.flush();
        expect(onError).toHaveBeenCalledOnce();
        vi.restoreAllMocks();
    });

    it('remove drops a pending write and deletes the file', async () => {
        const store = new DebouncedJsonFile<{n: number}>(path.join(dir, 'cache.json'), {delayMs: 10_000});
        store.save({n: 1});
        await store.flush();
        store.save({n: 2});
        await store.remove();
        expect(store.dirty).toBe(false);
        await expect(store.read()).resolves.toBeUndefined();
    });

    it('a save after remove is written, not removed by it', async () => {
        const json = new DebouncedJsonFile<{n: number}>(path.join(dir, 'shard.json'), {delayMs: 0});
        json.save({n: 1});
        await json.flush();
        const removed = json.remove();
        json.save({n: 2});
        await removed;
        await json.flush();
        await expect(json.read()).resolves.toEqual({n: 2});
    });

    it('read is undefined before anything was written', async () => {
        const store = new DebouncedJsonFile(path.join(dir, 'empty.json'));
        await expect(store.read()).resolves.toBeUndefined();
    });
});
