/**
 * The nine assertions of `README.md` in this directory, against a real Electron.
 *
 * What the unit tests of `src/main/**` and `src/preload/**` cannot cover is whether the three
 * contexts fit together: whether the preload loads, whether `contextBridge` hands the renderer a
 * working transport, whether the custom protocol answers an `<img>`. That needs a running Electron,
 * and `playwright._electron` is the only thing that starts one.
 *
 * Run it with `npm run test:e2e:electron`, after `npx install-electron` and
 * `npm run build -w @homematic-manager/electron`. It runs in `build.yml`, on each OS of the build
 * matrix, and **not** in WSL: `app.whenReady()` never fires there (the agent for task 11 measured
 * that), so this file has never been executed on the development machine. It is written from the
 * host's sources and the README; the first CI run on the three runners is its first real run.
 *
 * Everything here launches the app itself rather than sharing one instance, because assertion 8
 * relaunches it and assertion 9 watches it exit. That is slow (a cold Electron start is seconds),
 * which is why the project's timeout in `playwright.config.ts` is 120 s and its workers are 1.
 */

import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {_electron as electron, expect, test, type ElectronApplication, type Page} from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
/** The built main bundle - the suite launches the build, never the sources. */
const mainEntry = path.join(here, '..', '..', 'out', 'main', 'index.js');

interface Launched {
    readonly app: ElectronApplication;
    readonly page: Page;
    readonly userData: string;
}

const profiles: string[] = [];

/**
 * Starts the built app on a throw-away profile.
 *
 * `--user-data-dir` is Electron's own switch and moves `app.getPath('userData')`; without it the
 * suite would write into the developer's real profile and a stale `window-state.json` would decide
 * where the window opens. `HMM_DISABLE_AUTO_UPDATE=1` says out loud that no run reaches out to
 * GitHub (`app.isPackaged` is false for a launched build, so the updater is off anyway).
 */
async function launch(userDataDir?: string): Promise<Launched> {
    const userData = userDataDir ?? (await mkdtemp(path.join(tmpdir(), 'hmm-electron-')));
    if (userDataDir === undefined) {
        profiles.push(userData);
    }
    const app = await electron.launch({
        args: [mainEntry, `--user-data-dir=${userData}`],
        env: {...process.env, HMM_DISABLE_AUTO_UPDATE: '1'},
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    return {app, page, userData};
}

test.afterAll(async () => {
    for (const dir of profiles.splice(0)) {
        await rm(dir, {recursive: true, force: true});
    }
});

test('1: the window opens and is shown', async () => {
    const {app, page} = await launch();
    try {
        // `ready-to-show` is what calls `show()`; a window that is visible proves the renderer
        // loaded rather than that the process merely started.
        expect(await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(true);
        expect(await page.title()).toBe('Homematic Manager');
    } finally {
        await app.close();
    }
});

test('2: the transport answers from the real in-process backend', async () => {
    const {app, page} = await launch();
    try {
        const config = await page.evaluate(async () => {
            const transport = (window as unknown as {__HMM_TRANSPORT__: {request: (m: string) => Promise<unknown>}})
                .__HMM_TRANSPORT__;
            return transport.request('config.get');
        });
        // The one assertion that proves the preload loaded, the context bridge is up and the IPC
        // bridge answers. `AppConfig` always has a `connection` and a `version`.
        expect(config).toMatchObject({connection: expect.objectContaining({interfaces: expect.any(Array)})});
    } finally {
        await app.close();
    }
});

test('3: a rejection keeps its shape across the context bridge', async () => {
    const {app, page} = await launch();
    try {
        // `interfaces.reconnect` without a connected CCU is the cheapest deterministic refusal the
        // backend has: `configError('not connected to a CCU')`, kind `config`.
        const rejection = await page.evaluate(async () => {
            const transport = (
                window as unknown as {
                    __HMM_TRANSPORT__: {request: (m: string, ...p: unknown[]) => Promise<unknown>};
                }
            ).__HMM_TRANSPORT__;
            try {
                await transport.request('interfaces.reconnect', 'BidCos-RF');
                return {thrown: false};
            } catch (error: unknown) {
                const value = error as {message?: unknown; kind?: unknown};
                return {thrown: true, message: value.message, kind: value.kind, isError: error instanceof Error};
            }
        });
        expect(rejection.thrown).toBe(true);
        // Both properties survive: `contextBridge` would silently drop them off an `Error`, which
        // is why the transport rejects with a plain object.
        expect(typeof rejection.message).toBe('string');
        expect(rejection.kind).toBe('config');
    } finally {
        await app.close();
    }
});

test('4: events arrive in the renderer', async () => {
    const {app, page} = await launch();
    try {
        const notice = await page.evaluate(async () => {
            const transport = (
                window as unknown as {
                    __HMM_TRANSPORT__: {
                        request: (m: string, ...p: unknown[]) => Promise<unknown>;
                        on: (e: string, h: (payload: unknown) => void) => () => void;
                    };
                }
            ).__HMM_TRANSPORT__;
            const arrived = new Promise<unknown>((resolve) => {
                const off = transport.on('notice', (payload) => {
                    off();
                    resolve(payload);
                });
            });
            // Connecting to a loopback address with nothing listening on 2001 fails at once with
            // ECONNREFUSED, and a connection that cannot be made is a notice (never a throw, D-2).
            await transport.request('config.set', {
                host: '127.0.0.1',
                interfaces: ['BidCos-RF'],
                autoDetect: false,
                extraInterfaces: [],
                tls: false,
                local: false,
                rega: false,
                callback: {ip: '127.0.0.1', xmlrpcPort: 0, binrpcPort: 0},
                language: 'en',
                writePaceMs: 0,
                rpcLogFolder: '',
            });
            return arrived;
        });
        expect(notice).toMatchObject({level: expect.any(String), message: expect.any(String)});
    } finally {
        await app.close();
    }
});

test('5: exactly two globals of ours reach the page, and no Node', async () => {
    const {app, page} = await launch();
    try {
        const globals = await page.evaluate(() => {
            const w = window as unknown as Record<string, unknown>;
            return {
                require: typeof w['require'],
                process: typeof w['process'],
                module: typeof w['module'],
                ipcRenderer: typeof w['ipcRenderer'],
                ours: Object.keys(window).filter((key) => key.startsWith('__HMM')),
            };
        });
        expect(globals.require).toBe('undefined');
        expect(globals.process).toBe('undefined');
        expect(globals.module).toBe('undefined');
        expect(globals.ipcRenderer).toBe('undefined');
        expect(globals.ours.sort()).toEqual(['__HMM_HOST__', '__HMM_TRANSPORT__']);
    } finally {
        await app.close();
    }
});

test('6: the image protocol answers 200 for a bundled type and 404 for an unknown one', async () => {
    const {app, page} = await launch();
    try {
        // Not the README's `HmIP-BSM`: the bundled webp subset (D-10) covers 121 files and every
        // one of them is a BidCos type - an HmIP picture only ever comes from a connected CCU.
        // `HM-CC-RT-DN` maps to `83_hm-cc-rt-dn.png`, which the subset has as `.webp`.
        const bundled = await page.evaluate(async () => {
            const response = await fetch('hmm-image://device/HM-CC-RT-DN');
            return {status: response.status, type: response.headers.get('content-type')};
        });
        expect(bundled.status).toBe(200);
        expect(bundled.type).toMatch(/^image\//);

        const missing = await page.evaluate(async () => {
            const response = await fetch('hmm-image://device/NO-SUCH-DEVICE-TYPE');
            return response.status;
        });
        expect(missing).toBe(404);
    } finally {
        await app.close();
    }
});

test('7: the CSP blocks a script from anywhere but the bundle', async () => {
    const {app, page} = await launch();
    try {
        const violation = await page.evaluate(async () => {
            const reported = new Promise<string>((resolve) => {
                document.addEventListener(
                    'securitypolicyviolation',
                    (event) => resolve((event as SecurityPolicyViolationEvent).violatedDirective),
                    {once: true},
                );
            });
            const script = document.createElement('script');
            script.src = 'https://example.invalid/x.js';
            document.head.append(script);
            return reported;
        });
        expect(violation).toContain('script-src');
    } finally {
        await app.close();
    }
});

test('8: the window size round-trips through the profile', async () => {
    const first = await launch();
    const size = {width: 1100, height: 700};
    try {
        await first.app.evaluate(({BrowserWindow}, bounds) => {
            const window = BrowserWindow.getAllWindows()[0];
            window?.unmaximize();
            window?.setBounds(bounds);
        }, size);
        // The keeper writes on `close`, and `will-quit` saves again; both need the app to go down
        // normally rather than be killed.
        await first.app.close();
    } catch (error) {
        await first.app.close();
        throw error;
    }

    const second = await launch(first.userData);
    try {
        const bounds = await second.app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0]?.getBounds());
        expect(bounds?.width).toBe(size.width);
        expect(bounds?.height).toBe(size.height);
    } finally {
        await second.app.close();
        await rm(first.userData, {recursive: true, force: true});
    }
});

test('9: closing the last window quits the app cleanly', async () => {
    const {app} = await launch();
    const child = app.process();
    // `window-all-closed` quits on every platform (this is a tool, not a document editor), and
    // `will-quit` waits for `backend.stop()`. The regression this guards is 2.x's `process.exit(1)`
    // on a second `stop()`.
    await app.evaluate(({BrowserWindow}) => {
        BrowserWindow.getAllWindows()[0]?.close();
    });
    await app.waitForEvent('close', {timeout: 30_000});
    expect(child.exitCode).toBe(0);
});
