/**
 * The helper task 14 will drive Playwright with. The simulator part skips itself when hm-simulator
 * is not installed, exactly like `packages/backend/test/simulator` does.
 */

import {existsSync} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

import {defaultUiDir} from './paths.js';
import {SIMULATOR_SKIP_MESSAGE, simulatorAvailable, startForTest, type TestHost} from './testSupport.js';

const hosts: TestHost[] = [];

afterEach(async () => {
    for (const host of hosts.splice(0)) {
        await host.close();
    }
});

const withSimulator = await simulatorAvailable();
if (!withSimulator) {
    console.warn(`[web] skipping the simulator e2e helper test: ${SIMULATOR_SKIP_MESSAGE}`);
}

describe('startForTest', () => {
    it('starts on a free port with a temporary profile directory and cleans up after itself', async () => {
        const host = await startForTest();
        expect(host.port).toBeGreaterThan(0);
        expect(host.url).toBe(`http://127.0.0.1:${host.port}/`);
        expect(host.token).toMatch(/^[0-9a-f]{32}$/);
        expect(host.backend).toBeDefined();
        expect(host.simulator).toBeUndefined();
        await expect(fs.stat(host.dataDir)).resolves.toBeDefined();

        const dataDir = host.dataDir;
        await host.close();
        await expect(fs.stat(dataDir)).rejects.toThrow();
    });

    it('keeps a profile directory it was given', async () => {
        const first = await startForTest();
        hosts.push(first);
        const second = await startForTest({dataDir: first.dataDir, port: 0});
        await second.close();
        await expect(fs.stat(first.dataDir)).resolves.toBeDefined();
    });

    // `npm test` does not build the UI, and CI runs it before any build (task 14 changes that)
    it.skipIf(!existsSync(path.join(defaultUiDir(), 'index.html')))('serves the real built UI', async () => {
        const host = await startForTest();
        hosts.push(host);
        const answer = await fetch(host.url);
        // the UI has to have been built: `npm run build -w @homematic-manager/ui`
        expect(answer.status).toBe(200);
        expect(answer.headers.get('set-cookie')).toContain('hmm_token=');
        expect(await answer.text()).toContain('<div id="app">');
    });

    it('ignores the simulator request when the package is not installed', async () => {
        if (withSimulator) {
            return;
        }
        const host = await startForTest({simulator: true});
        hosts.push(host);
        expect(host.simulator).toBeUndefined();
    });
});

describe.skipIf(!withSimulator)('startForTest against hm-simulator', () => {
    it('connects the backend to the simulator and answers over the api socket', async () => {
        const host = await startForTest({simulator: true});
        hosts.push(host);
        expect(host.simulator).toBeDefined();
        const devices = await host.backend?.request('devices.list', 'BidCos-RF');
        expect(devices?.length).toBeGreaterThan(0);
        const answer = await fetch(`${host.url}api`);
        expect(answer.status).toBe(426);
    }, 30_000);
});
