#!/usr/bin/env node

/**
 * `npm run dev -w apps/web`: a vite dev server for `packages/ui` and the web host in
 * front of it, so UI changes hot-reload against a real backend.
 *
 * Both on one origin, because that is what the UI's relative `api` path needs: vite gets a free
 * port and is never opened directly; the host proxies everything that is not the API to it,
 * including vite's own HMR socket (see `proxy.ts`). Open the host's URL, edit a `.svelte` file, and
 * the page updates while the WebSocket to the backend stays up.
 *
 * `VITE_HMM_DEMO=false` is forced: `packages/ui/.env.development` turns demo mode on for a bare
 * `vite`, and a demo transport would defeat the whole point of running a backend.
 */

import {spawn, type ChildProcess} from 'node:child_process';
import {createRequire} from 'node:module';
import net from 'node:net';
import path from 'node:path';

import {isMainModule, runCli} from './cli.js';
import {createLogger, type Logger} from './log.js';
import {moduleDir} from './paths.js';

/** The `packages/ui` checkout, relative to the compiled host. */
export function uiPackageDir(base: string = moduleDir): string {
    return path.resolve(base, '..', '..', '..', 'packages', 'ui');
}

/**
 * vite's own CLI, resolved from `packages/ui`, so no shell and no `npx` are involved.
 *
 * Through `vite/package.json`, which is the only path into the package that its `exports` map
 * allows - `vite/bin/vite.js` is not exported, even though that is what `npm` links as the binary.
 */
export function resolveViteBin(uiDir: string): string {
    const manifest = createRequire(path.join(uiDir, 'package.json')).resolve('vite/package.json');
    return path.join(path.dirname(manifest), 'bin', 'vite.js');
}

/** A free port the operating system picks, so two dev sessions cannot collide. */
export function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.on('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const address = probe.address();
            const port = typeof address === 'object' && address !== null ? address.port : 0;
            probe.close(() => resolve(port));
        });
    });
}

/** Waits until something accepts a connection on `port`. */
export async function waitForPort(port: number, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const open = await new Promise<boolean>((resolve) => {
            const socket = net.connect({port, host: '127.0.0.1'});
            socket.on('connect', () => {
                socket.destroy();
                resolve(true);
            });
            socket.on('error', () => resolve(false));
        });
        if (open) {
            return;
        }
        if (Date.now() > deadline) {
            throw new Error(`the vite dev server did not come up on port ${port}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
}

export interface RunDevOptions {
    readonly argv?: readonly string[];
    /** Injected by the tests, in place of really starting vite and the host. */
    readonly spawn?: typeof spawn;
    readonly run?: typeof runCli;
    readonly waitFor?: (port: number) => Promise<void>;
    readonly exit?: (code: number) => void;
    readonly log?: Logger;
}

/** Starts vite, waits for it, then runs the CLI with `--ui-dev-server` pointing at it. */
export async function runDev(options: RunDevOptions = {}): Promise<void> {
    const log = options.log ?? createLogger({level: 'info'});
    const exit = options.exit ?? ((code: number) => process.exit(code));
    const spawnProcess = options.spawn ?? spawn;
    const run = options.run ?? runCli;
    const waitFor = options.waitFor ?? waitForPort;
    const uiDir = uiPackageDir();
    const port = await freePort();

    let vite: ChildProcess;
    try {
        vite = spawnProcess(process.execPath, [resolveViteBin(uiDir), '--port', String(port), '--strictPort'], {
            cwd: uiDir,
            stdio: ['ignore', 'inherit', 'inherit'],
            // packages/ui/.env.development turns demo mode on for a bare `vite`; not here
            env: {...process.env, VITE_HMM_DEMO: 'false'},
        });
    } catch (error) {
        log.error('vite could not be started; run `npm install` first:', error);
        exit(1);
        return;
    }
    const stopVite = (): void => {
        vite.kill('SIGTERM');
    };
    process.once('exit', stopVite);
    vite.on('exit', (code) => {
        if (code !== null && code !== 0) {
            log.error(`vite exited with ${code}`);
            exit(code);
        }
    });

    await waitFor(port);
    log.info(`vite is up on ${port}; the host proxies everything but the api to it`);
    const result = await run({argv: [...(options.argv ?? process.argv.slice(2)), '--ui-dev-server', devUrl(port)]});
    if (result.code !== 0) {
        stopVite();
        exit(result.code);
    }
}

/** Where vite was told to listen. */
export function devUrl(port: number): string {
    return `http://127.0.0.1:${port}`;
}

if (isMainModule(import.meta.url, process.argv[1])) {
    await runDev();
}
