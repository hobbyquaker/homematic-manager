import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {readJsonFile} from '../util/jsonFile.js';
import {ConfigStore, hostKey} from './store.js';

let dir: string;
let home: string;

beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-config-'));
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-home-'));
});

afterEach(async () => {
    await fs.rm(dir, {recursive: true, force: true});
    await fs.rm(home, {recursive: true, force: true});
});

const options = () => ({
    dataDir: dir,
    version: '3.0.0-dev.0',
    localAddresses: () => ['192.168.1.5'],
    legacyEnvironment: {platform: 'linux' as const, appData: '', home},
});

describe('hostKey', () => {
    it('makes a directory name of a host', () => {
        expect(hostKey('CCU3.local')).toBe('ccu3.local');
        expect(hostKey('192.168.1.2')).toBe('192.168.1.2');
        expect(hostKey('fe80::1%eth0')).toBe('fe80__1_eth0');
        expect(hostKey('   ')).toBe('unconfigured');
    });
});

describe('ConfigStore.open', () => {
    it('writes a default configuration on the first start', async () => {
        const store = await ConfigStore.open(options());
        expect(store.connection.host).toBe('');
        expect(store.importedFromLegacy).toBe(false);
        await expect(readJsonFile(path.join(dir, 'config.json'))).resolves.toMatchObject({version: '3.0.0-dev.0'});
    });

    it('imports the 2.x configuration exactly once (D-17)', async () => {
        await fs.mkdir(path.join(home, '.hm-manager'), {recursive: true});
        await fs.writeFile(
            path.join(home, '.hm-manager', 'config'),
            JSON.stringify({ccuAddress: '10.0.0.1', useTLS: true, rpcDelay: 3000}),
            'utf8',
        );
        const first = await ConfigStore.open(options());
        expect(first.importedFromLegacy).toBe(true);
        expect(first.connection.host).toBe('10.0.0.1');
        expect(first.connection.writePaceMs).toBe(3000);

        // second start: our own config.json exists, so the 2.x file is not looked at again
        await first.setConnection({...first.connection, host: 'ccu.lan'});
        const second = await ConfigStore.open(options());
        expect(second.importedFromLegacy).toBe(false);
        expect(second.connection.host).toBe('ccu.lan');
    });

    it('does not import when the host says not to', async () => {
        await fs.mkdir(path.join(home, '.hm-manager'), {recursive: true});
        await fs.writeFile(path.join(home, '.hm-manager', 'config'), JSON.stringify({ccuAddress: 'x'}), 'utf8');
        const store = await ConfigStore.open({...options(), importLegacy: false});
        expect(store.connection.host).toBe('');
    });

    it('repairs a config.json that was tampered with', async () => {
        await fs.writeFile(path.join(dir, 'config.json'), JSON.stringify({connection: {host: 5, interfaces: 'all'}}));
        const store = await ConfigStore.open(options());
        expect(store.connection.host).toBe('');
        expect(store.connection.interfaces.length).toBeGreaterThan(0);
    });
});

describe('the stored configuration', () => {
    it('answers config.get with the version, the local addresses and the discovery result', async () => {
        const store = await ConfigStore.open(options());
        store.setDiscovered([{address: '10.0.0.1', name: 'ccu3', interfaces: ['HmIP-RF']}]);
        expect(store.config).toEqual({
            version: '3.0.0-dev.0',
            connection: store.connection,
            localAddresses: ['192.168.1.5'],
            discovered: [{address: '10.0.0.1', name: 'ccu3', interfaces: ['HmIP-RF']}],
        });
    });

    it('normalises and persists what config.set sends', async () => {
        const store = await ConfigStore.open(options());
        const config = await store.setConnection({host: ' ccu.lan ', interfaces: ['HmIP-RF'], writePaceMs: 100});
        expect(config.connection.host).toBe('ccu.lan');
        const reopened = await ConfigStore.open(options());
        expect(reopened.connection).toEqual(config.connection);
    });

    it('keeps one cache directory per host', async () => {
        const store = await ConfigStore.open(options());
        expect(store.cacheDir).toBe(path.join(dir, 'cache', 'unconfigured'));
        await store.setConnection({host: 'CCU3.local'});
        expect(store.cacheDir).toBe(path.join(dir, 'cache', 'ccu3.local'));
        expect(store.cacheFile('devices.json')).toBe(path.join(dir, 'cache', 'ccu3.local', 'devices.json'));
    });

    it('uses the real network interfaces when nothing is injected', async () => {
        const store = await ConfigStore.open({dataDir: dir, version: '3.0.0-dev.0', importLegacy: false});
        expect(Array.isArray(store.config.localAddresses)).toBe(true);
    });
});
