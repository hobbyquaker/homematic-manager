import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {defaultConnection} from './defaults.js';
import {
    connectionFromLegacy,
    importLegacyConnection,
    legacyConfigDir,
    legacyConfigFiles,
    readLegacyConfig,
} from './legacyImport.js';

let home: string;

beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-legacy-'));
});

afterEach(async () => {
    await fs.rm(home, {recursive: true, force: true});
});

describe('legacyConfigDir', () => {
    it('is %APPDATA%\\hm-manager on Windows', () => {
        expect(legacyConfigDir({platform: 'win32', appData: 'C:\\Users\\x\\AppData\\Roaming'})).toBe(
            path.join('C:\\Users\\x\\AppData\\Roaming', 'hm-manager'),
        );
    });

    it('is ~/Library/Preferences/hm-manager on macOS', () => {
        expect(legacyConfigDir({platform: 'darwin', appData: '', home: '/Users/x'})).toBe(
            path.join('/Users/x', 'Library', 'Preferences', 'hm-manager'),
        );
    });

    it('is ~/.hm-manager everywhere else', () => {
        expect(legacyConfigDir({platform: 'linux', appData: '', home: '/home/x'})).toBe(
            path.join('/home/x', '.hm-manager'),
        );
    });

    it('asks the process when nothing is injected', () => {
        expect(legacyConfigDir()).toContain('hm-manager');
    });
});

describe('legacyConfigFiles', () => {
    it('tries the extension-less name persist-json wrote first', () => {
        const files = legacyConfigFiles({platform: 'linux', appData: '', home: '/home/x'});
        expect(files.map((file) => path.basename(file))).toEqual(['config', 'config.json']);
    });
});

describe('readLegacyConfig', () => {
    const environment = () => ({platform: 'linux' as const, appData: '', home});

    it('is undefined when there is nothing', async () => {
        await expect(readLegacyConfig(environment())).resolves.toBeUndefined();
    });

    it('reads the extension-less file', async () => {
        await fs.mkdir(path.join(home, '.hm-manager'), {recursive: true});
        await fs.writeFile(path.join(home, '.hm-manager', 'config'), JSON.stringify({ccuAddress: '10.0.0.1'}), 'utf8');
        await expect(readLegacyConfig(environment())).resolves.toEqual({ccuAddress: '10.0.0.1'});
    });

    it('falls back to config.json', async () => {
        await fs.mkdir(path.join(home, '.hm-manager'), {recursive: true});
        await fs.writeFile(path.join(home, '.hm-manager', 'config.json'), JSON.stringify({ccuAddress: 'a'}), 'utf8');
        await expect(readLegacyConfig(environment())).resolves.toEqual({ccuAddress: 'a'});
    });

    it('ignores a file that is not JSON', async () => {
        await fs.mkdir(path.join(home, '.hm-manager'), {recursive: true});
        await fs.writeFile(path.join(home, '.hm-manager', 'config'), 'not json at all', 'utf8');
        await expect(readLegacyConfig(environment())).resolves.toBeUndefined();
    });
});

describe('connectionFromLegacy', () => {
    it('maps every field D-17 lists', () => {
        const connection = connectionFromLegacy(
            {
                ccuAddress: ' 192.168.1.2 ',
                useTLS: true,
                useAuth: true,
                user: 'Admin',
                pass: 'secret',
                language: 'en',
                rpcDelay: 3000,
                rpcLogFolder: '/tmp/rpclog',
                rpcInitIp: '192.168.1.50',
            },
            defaultConnection(),
        );
        expect(connection.host).toBe('192.168.1.2');
        expect(connection.tls).toBe(true);
        expect(connection.auth).toEqual({user: 'Admin', password: 'secret'});
        expect(connection.language).toBe('en');
        expect(connection.writePaceMs).toBe(3000);
        expect(connection.rpcLogFolder).toBe('/tmp/rpclog');
        expect(connection.callback.ip).toBe('192.168.1.50');
    });

    it('drops auth when 2.x had it switched off', () => {
        const connection = connectionFromLegacy(
            {ccuAddress: 'ccu', useAuth: false, user: 'Admin'},
            defaultConnection(),
        );
        expect(connection.auth).toBeUndefined();
        expect(connection.tls).toBe(false);
    });

    it('ignores the caches and the probed daemons of 2.x', () => {
        const connection = connectionFromLegacy(
            {ccuAddress: 'ccu', ...({daemons: {HmIP: {}}, rpcListenPort: 2010} as object)},
            defaultConnection(),
        );
        expect(connection).toEqual({...defaultConnection(), host: 'ccu'});
    });

    it('falls back for a language and a delay 2.x never had', () => {
        const connection = connectionFromLegacy({ccuAddress: 'ccu'}, defaultConnection());
        expect(connection.language).toBe('de');
        expect(connection.writePaceMs).toBe(defaultConnection().writePaceMs);
    });
});

describe('importLegacyConnection', () => {
    const environment = () => ({platform: 'linux' as const, appData: '', home});

    it('is undefined without a 2.x configuration', async () => {
        await expect(importLegacyConnection(defaultConnection(), environment())).resolves.toBeUndefined();
    });

    it('is undefined when 2.x had no CCU address either', async () => {
        await fs.mkdir(path.join(home, '.hm-manager'), {recursive: true});
        await fs.writeFile(path.join(home, '.hm-manager', 'config'), JSON.stringify({language: 'en'}), 'utf8');
        await expect(importLegacyConnection(defaultConnection(), environment())).resolves.toBeUndefined();
    });

    it('imports a configured 2.x installation', async () => {
        await fs.mkdir(path.join(home, '.hm-manager'), {recursive: true});
        await fs.writeFile(
            path.join(home, '.hm-manager', 'config'),
            JSON.stringify({ccuAddress: '10.0.0.1', useTLS: true}),
            'utf8',
        );
        const connection = await importLegacyConnection(defaultConnection(), environment());
        expect(connection?.host).toBe('10.0.0.1');
        expect(connection?.tls).toBe(true);
    });
});
