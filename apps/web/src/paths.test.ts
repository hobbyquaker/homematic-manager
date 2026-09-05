import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {describe, expect, it} from 'vitest';

import {
    defaultDataDir,
    defaultMetadataDir,
    defaultUiDir,
    FALLBACK_VERSION,
    firstExisting,
    metadataDirCandidates,
    moduleDir,
    packageVersion,
    uiDirCandidates,
} from './paths.js';

describe('defaultDataDir', () => {
    it('is what Electron would pick, per platform', () => {
        expect(defaultDataDir({}, 'linux', '/home/t')).toBe('/home/t/.config/homematic-manager');
        expect(defaultDataDir({XDG_CONFIG_HOME: '/cfg'}, 'linux', '/home/t')).toBe('/cfg/homematic-manager');
        expect(defaultDataDir({}, 'darwin', '/Users/t')).toBe('/Users/t/Library/Application Support/homematic-manager');
        expect(defaultDataDir({APPDATA: 'C:\\Roaming'}, 'win32', 'C:\\Users\\t')).toBe(
            path.join('C:\\Roaming', 'homematic-manager'),
        );
        expect(defaultDataDir({}, 'win32', 'C:/Users/t')).toContain('homematic-manager');
    });
});

describe('firstExisting', () => {
    it('takes the first candidate that has the marker', () => {
        const exists = (file: string): boolean => file === path.join('/b', 'index.html');
        expect(firstExisting(['/a', '/b', '/c'], 'index.html', exists)).toBe('/b');
    });

    it('falls back to the last candidate so the error names the expected place', () => {
        expect(firstExisting(['/a', '/b'], 'index.html', () => false)).toBe('/b');
        expect(firstExisting([], 'index.html', () => false)).toBe('');
    });
});

describe('the directory candidates', () => {
    it('cover the packed layout and the repository', () => {
        const ui = uiDirCandidates('/app/dist');
        expect(ui[0]).toBe(path.join('/app/dist', 'ui'));
        expect(ui.at(-1)).toBe(path.resolve('/app/dist', '..', '..', '..', 'packages', 'ui', 'dist'));
        const data = metadataDirCandidates('/app/dist');
        expect(data[0]).toBe(path.join('/app/dist', 'data'));
        expect(data.at(-1)).toBe(path.resolve('/app/dist', '..', '..', '..', 'data', 'dist'));
    });

    it('pick the first one that is really there', () => {
        expect(defaultUiDir('/app/dist', (file) => file === path.join('/app/dist', 'ui', 'index.html'))).toBe(
            path.join('/app/dist', 'ui'),
        );
        expect(
            defaultMetadataDir('/app/dist', (file) => file === path.join('/app/dist', 'data', 'manifest.json')),
        ).toBe(path.join('/app/dist', 'data'));
    });

    it('find the repository checkout from this module', () => {
        expect(defaultUiDir()).toContain('ui');
        expect(defaultMetadataDir()).toContain('data');
        expect(moduleDir).toContain('web');
    });
});

describe('packageVersion', () => {
    it('reads the manifest next to the compiled host', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-version-'));
        try {
            await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({version: '9.9.9'}));
            expect(packageVersion(path.join(dir, 'dist'))).toBe('9.9.9');
            expect(packageVersion(dir)).toBe('9.9.9');
        } finally {
            await fs.rm(dir, {recursive: true, force: true});
        }
    });

    it('falls back when there is no manifest or it has no version', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-version-'));
        try {
            await fs.mkdir(path.join(dir, 'sub'));
            expect(packageVersion(path.join(dir, 'sub'))).toBe(FALLBACK_VERSION);
            await fs.writeFile(path.join(dir, 'package.json'), '{"name": "x"}');
            expect(packageVersion(path.join(dir, 'sub'))).toBe(FALLBACK_VERSION);
        } finally {
            await fs.rm(dir, {recursive: true, force: true});
        }
    });

    it('reads this package', () => {
        expect(packageVersion()).toMatch(/^\d+\.\d+\.\d+/);
    });
});
