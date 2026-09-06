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
 * matrix, and **not** in WSL, where Electron blocks in the platform's own start-up: a five-line
 * control app never reaches `new BrowserWindow()` there either, so it is the environment and not
 * the host. (`--ozone-platform=headless` gets a WSL Electron as far as window creation and then
 * segfaults in it, which is enough to trace the start-up but not to run this suite.)
 *
 * Everything here launches the app itself rather than sharing one instance, because assertion 8
 * relaunches it and assertion 9 watches it exit.
 *
 * **Every wait in this file is bounded, and every failure prints the app's stderr.** The first CI
 * run of `build.yml` spent thirty minutes on this suite and produced not one line about the app:
 * `_electron.launch()` and `electronApplication.close()` both wait on the process with no timeout
 * of their own, so a hang cost the full test timeout and the worker teardown after it cost another.
 * `HMM_STARTUP_TRACE=1` makes the host name the phase it is in, this file collects that stderr,
 * and a failing test prints it - which is the only thing that will say what happened on a runner
 * nobody can attach a debugger to.
 */

import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {_electron as electron, expect, test, type ElectronApplication, type Page} from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
/** The built main bundle - the suite launches the build, never the sources. */
const mainEntry = path.join(here, '..', '..', 'out', 'main', 'index.js');

/** How long the app gets to start before the failure is reported as a failure to start. */
const LAUNCH_TIMEOUT_MS = 20_000;
/** How long it gets to show its first window after that. */
const WINDOW_TIMEOUT_MS = 20_000;
/**
 * How long a polite `close()` gets before the process is killed.
 *
 * The host bounds its own quit at fifteen seconds (`lifecycle.ts`), so anything past that is the
 * app failing to die rather than taking its time - and Playwright's `close()` would wait for it
 * for as long as the test timeout allows. Twenty leaves the host's own watchdog room to act and
 * say so in the trace before this one takes the process away.
 */
const CLOSE_TIMEOUT_MS = 20_000;

interface Launched {
    readonly app: ElectronApplication;
    readonly page: Page;
    readonly userData: string;
}

const profiles: string[] = [];
/** Everything the launched apps wrote to stderr during the current test. */
let output: string[] = [];
/** The apps this test started, so that one left behind by a failure is still killed. */
let running: ElectronApplication[] = [];

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
        env: {
            ...process.env,
            HMM_DISABLE_AUTO_UPDATE: '1',
            // One stderr line per start-up phase, so a launch that does not finish still says
            // which step it stopped in.
            HMM_STARTUP_TRACE: '1',
            // `dialog.showErrorBox` is modal, and there is nobody here to click it away: an
            // unhandled error would otherwise stop the main process for good.
            HMM_NO_ERROR_DIALOG: '1',
        },
        timeout: LAUNCH_TIMEOUT_MS,
    });
    running.push(app);
    collect(app);
    const page = await app.firstWindow({timeout: WINDOW_TIMEOUT_MS});
    await page.waitForLoadState('domcontentloaded');
    // And then wait for the app to have finished starting, which is later than that.
    //
    // `loadFile()` resolves on `did-finish-load` and the window is shown on `ready-to-show`, both
    // of them after `domcontentloaded`; a test that went on here caught the window before `show()`
    // and, worse, closed the app in the middle of the load. That is assertion 1 failing with
    // `isVisible()` false on all three runners of build.yml 34001069697, and the six
    // `ERR_FAILED (-2) loading .../index.html` in the same trace - a load aborted by the quit the
    // test had already asked for, not a load that failed.
    await expect
        .poll(async () => app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0]?.isVisible()), {
            timeout: WINDOW_TIMEOUT_MS,
        })
        .toBe(true);
    return {app, page, userData};
}

/**
 * Keeps everything the app writes to stderr, and on CI passes it straight through.
 *
 * Through, because a hook is not a guarantee: a test that spends its whole timeout leaves nothing
 * for `afterEach`, and the first two runs of `build.yml` printed the bare line "Test timeout of
 * 120000ms exceeded." with no call log, no snippet and no artifact worth downloading. Playwright
 * interleaves what a worker writes into its own output, so a trace written as it happens survives
 * a test that is killed, a worker that is killed, and a job that is cancelled on its timeout.
 */
function collect(app: ElectronApplication): void {
    app.process().stderr?.on('data', (chunk: Buffer | string) => {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        output.push(text);
        if (process.env['CI'] !== undefined) {
            process.stderr.write(text);
        }
    });
}

/**
 * Closes the app, and kills it when it will not go.
 *
 * `electronApplication.close()` calls `app.quit()` and then waits for the process to exit with no
 * bound of its own; without this, an app that never quits costs the test its whole timeout and the
 * worker teardown after it another one.
 */
async function closeApp(app: ElectronApplication): Promise<void> {
    const child = app.process();
    let timer: NodeJS.Timeout | undefined;
    const killed = new Promise<void>((resolve) => {
        timer = setTimeout(() => {
            const message = `[smoke] the app did not exit within ${String(CLOSE_TIMEOUT_MS)}ms; killing it\n`;
            output.push(message);
            process.stderr.write(message);
            child.kill('SIGKILL');
            resolve();
        }, CLOSE_TIMEOUT_MS);
    });
    try {
        await Promise.race([app.close().catch(() => undefined), killed]);
    } finally {
        if (timer !== undefined) {
            clearTimeout(timer);
        }
        // Only now: a test that runs out of time inside `close()` must still leave the app on the
        // list for `afterEach` to kill.
        running = running.filter((other) => other !== app);
    }
}

test.beforeEach(() => {
    output = [];
    running = [];
});

test.afterEach(async () => {
    // `test.info()` rather than the hook's first argument: destructuring the fixtures is
    // mandatory there, and this project has no browser fixtures to destructure.
    const testInfo = test.info();
    // Nothing may be left running: Playwright kills the worker after this, and an Electron that
    // outlives it becomes an orphan the job cleanup has to reap.
    for (const app of running.splice(0)) {
        await closeApp(app);
    }
    if (testInfo.status === testInfo.expectedStatus) {
        return;
    }
    const captured = output.join('');
    if (captured === '') {
        // The CI log is the only report a cancelled job leaves behind.
        console.log(
            '--- this suite collected no stderr from the app; a launch that never returned leaves what ' +
                'it did print in the call log above ---',
        );
        return;
    }
    await testInfo.attach('electron-stderr.txt', {body: captured, contentType: 'text/plain'});
    // Likewise: the html report is not uploaded when the job is cancelled on its timeout.
    console.log(`--- electron stderr ---\n${captured}--- end ---`);
});

test.afterAll(async () => {
    for (const dir of profiles.splice(0)) {
        await rm(dir, {recursive: true, force: true});
    }
});

test('1: the window opens and is shown', async () => {
    // `launch()` is what waits for it - every other assertion needs a window that is up as much as
    // this one does, and a wait that only one test performs is a race the other eight still run.
    // What is left here is the assertion itself: a window that is visible proves the renderer
    // loaded rather than that the process merely started.
    const {app, page} = await launch();
    try {
        expect(await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(true);
        expect(await page.title()).toBe('Homematic Manager');
    } finally {
        await closeApp(app);
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
        await closeApp(app);
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
        await closeApp(app);
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
        await closeApp(app);
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
        await closeApp(app);
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
        await closeApp(app);
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
        await closeApp(app);
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
        await closeApp(first.app);
    } catch (error) {
        await closeApp(first.app);
        throw error;
    }

    const second = await launch(first.userData);
    try {
        const bounds = await second.app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0]?.getBounds());
        expect(bounds?.width).toBe(size.width);
        expect(bounds?.height).toBe(size.height);
    } finally {
        await closeApp(second.app);
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
    // The host bounds its own shutdown at fifteen seconds, so this is the bound plus room for a
    // slow runner rather than a guess. `afterEach` kills the app if it is still here after it.
    await app.waitForEvent('close', {timeout: 25_000});
    expect(child.exitCode).toBe(0);
});
