import {defineConfig, devices} from '@playwright/test';

/**
 * The two end-to-end suites (roadmap task 14). They share one configuration and nothing else: they
 * run in different processes, on different triggers, in different workflows.
 *
 * - **`web`** (`apps/web/test/e2e`) drives the real UI in chromium against `startForTest()` - the
 *   web host, the real backend and an in-process hm-simulator. One spec per workflow of the feature
 *   inventory in `docs/analysis-2026-09.md` §2.1. Runs in `ci.yml` after `npm run build`, because
 *   the host serves the built UI bundle and `npm test` does not build it.
 * - **`electron`** (`apps/electron/test/e2e`) is the smoke test of the packaged Electron host, the
 *   nine assertions of that directory's README. It launches a real Electron through
 *   `playwright._electron`, so it needs a display and cannot share a worker with the web suite; it
 *   runs in `build.yml`, once per OS of the build matrix.
 *
 * Why here and not in one `e2e/` at the root: `apps/electron/test/e2e` already existed (task 11
 * put the README there), each suite needs the app it drives built, and `apps/web`'s `files` list
 * never ships `test/`. One config file rather than two keeps `@playwright/test` a single root
 * devDependency and gives both suites the same reporters and timeouts.
 */
export default defineConfig({
    // A failing e2e assertion is usually a real regression, but a hung backend is a lost job.
    timeout: 60_000,
    expect: {timeout: 10_000},
    fullyParallel: true,
    forbidOnly: Boolean(process.env['CI']),
    retries: process.env['CI'] ? 1 : 0,
    // Every worker starts its own host, backend and simulator on port 0, so parallelism is free -
    // but each one is a handful of listening sockets, so this is not unbounded.
    workers: process.env['CI'] ? 2 : 4,
    reporter: process.env['CI']
        ? [['list'], ['html', {open: 'never', outputFolder: 'playwright-report'}], ['github']]
        : [['list']],
    outputDir: 'test-results',
    projects: [
        {
            name: 'web',
            testDir: './apps/web/test/e2e',
            use: {
                ...devices['Desktop Chrome'],
                // The window has to be tall enough for the virtualised grid to render more than a
                // couple of rows, and wide enough that the toolbar does not collapse.
                viewport: {width: 1400, height: 900},
                trace: 'retain-on-failure',
                video: 'off',
            },
        },
        {
            name: 'electron',
            testDir: './apps/electron/test/e2e',
            // No browser: `_electron.launch()` brings its own. Sixty seconds is generous for a
            // cold Electron start plus the relaunch inside assertion 8, and it bounds the worker
            // teardown as well - Playwright uses the test timeout for that too.
            //
            // It was 120 s with one retry, and the first CI run showed what that costs when the
            // app is the thing that is broken: every test paid two minutes, its retry another two,
            // and the teardown after each of them two more, so five assertions used up the whole
            // thirty-minute job and no artifact was ever built. A smoke test exists to fail fast;
            // every wait inside it is bounded in `smoke.spec.ts` for the same reason.
            timeout: 60_000,
            // No retries. A flaky window is worth knowing about rather than papering over, and a
            // broken app must not cost twice.
            retries: 0,
            fullyParallel: false,
            workers: 1,
        },
    ],
});
