import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {DataFileServer, type BinaryFile} from './files.js';

let root: string;
let outside: string;

beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-data-'));
    outside = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-secret-'));
    await fs.mkdir(path.join(root, 'profiles'), {recursive: true});
    await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify({version: 1}), 'utf8');
    await fs.writeFile(path.join(root, 'profiles', 'SWITCH.json'), JSON.stringify({profiles: []}), 'utf8');
    await fs.writeFile(path.join(root, 'notes.md'), '# hello', 'utf8');
    await fs.writeFile(path.join(root, 'broken.json'), '{oops', 'utf8');
    await fs.writeFile(path.join(root, 'icon.webp'), Buffer.from([1, 2, 3]));
    await fs.writeFile(path.join(root, 'secret.pem'), 'key', 'utf8');
    await fs.writeFile(path.join(outside, 'passwd.json'), JSON.stringify({secret: true}), 'utf8');
});

afterEach(async () => {
    await fs.rm(root, {recursive: true, force: true});
    await fs.rm(outside, {recursive: true, force: true});
});

const server = () => new DataFileServer({roots: {data: root}});

describe('DataFileServer', () => {
    it('lists its roots', () => {
        expect(server().roots).toEqual(['data']);
    });

    it('parses JSON', async () => {
        await expect(server().read('data/manifest.json')).resolves.toEqual({version: 1});
        await expect(server().read('data/profiles/SWITCH.json')).resolves.toEqual({profiles: []});
    });

    it('tolerates a leading slash and Windows separators', async () => {
        await expect(server().read('/data/manifest.json')).resolves.toEqual({version: 1});
        await expect(server().read('data\\profiles\\SWITCH.json')).resolves.toEqual({profiles: []});
    });

    it('returns text as a string', async () => {
        await expect(server().read('data/notes.md')).resolves.toBe('# hello');
    });

    it('returns an image as base64 with its mime type', async () => {
        const file = (await server().read('data/icon.webp')) as BinaryFile;
        expect(file.mime).toBe('image/webp');
        expect(Buffer.from(file.base64, 'base64')).toEqual(Buffer.from([1, 2, 3]));
        expect(file.path).toBe('data/icon.webp');
    });

    it('refuses a root nothing configured', async () => {
        await expect(server().read('other/manifest.json')).rejects.toThrow('readable roots');
        await expect(server().read('manifest.json')).rejects.toThrow('readable roots');
        await expect(server().read('')).rejects.toThrow('readable roots');
    });

    it('refuses a path that leaves its root', async () => {
        await expect(server().read('data/../../etc/passwd.json')).rejects.toThrow('leaves its root');
        await expect(server().read(`data/../${path.basename(outside)}/passwd.json`)).rejects.toThrow('leaves its root');
    });

    it('refuses a symlink that points outside the root', async () => {
        try {
            await fs.symlink(path.join(outside, 'passwd.json'), path.join(root, 'link.json'));
        } catch {
            return; // a platform without symlink permission: nothing to check here
        }
        await expect(server().read('data/link.json')).rejects.toThrow('leaves its root');
    });

    it('refuses a file type that is not on the list', async () => {
        await expect(server().read('data/secret.pem')).rejects.toThrow('may not be read');
    });

    it('reports invalid JSON as a configuration error', async () => {
        await expect(server().read('data/broken.json')).rejects.toThrow('not valid JSON');
    });

    it('serves several roots', async () => {
        const multi = new DataFileServer({roots: {data: root, images: outside}});
        expect(multi.roots).toEqual(['data', 'images']);
        await expect(multi.read('images/passwd.json')).resolves.toEqual({secret: true});
    });

    it('has no roots at all when none were configured', async () => {
        await expect(new DataFileServer({roots: {}}).read('data/manifest.json')).rejects.toThrow('readable roots');
    });
});
