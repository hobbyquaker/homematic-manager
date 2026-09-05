import {fileURLToPath} from 'node:url';

import {svelte} from '@sveltejs/vite-plugin-svelte';
import {playwright} from '@vitest/browser-playwright';
import {defineConfig} from 'vitest/config';

/**
 * Component tests run in a real headless chromium (D-23, flipped by task 14).
 *
 * This is the environment the virtualised table, the native `<dialog>` stacking and the focus
 * handling really need: jsdom has no layout, so it reports every element as 0 x 0 and implements
 * `showModal()` only as a flag. The suite is also about four times faster here than in jsdom,
 * because there is no DOM shim to build per file.
 *
 * It needs the browser binary once:
 *
 * ```sh
 * npx playwright install --with-deps chromium
 * ```
 *
 * CI does that in every job that runs the tests. When it is missing, vitest fails with playwright's
 * own "Executable doesn't exist" message, which names the command to run - and
 * `npm run test:jsdom -w @homematic-manager/ui` (`vitest.jsdom.config.ts`) is the fallback that
 * needs no download. Both configurations run the same files: everything the components need beyond
 * a bare DOM - `ResizeObserver`, `matchMedia`, `scrollTo`, `HTMLDialogElement` - is stubbed in
 * `vitest.setup.ts` for jsdom and left alone here, and every test that depends on a measured size
 * passes the size explicitly.
 */
export default defineConfig({
    plugins: [svelte()],
    resolve: {
        alias: {
            '@homematic-manager/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
        },
    },
    test: {
        name: 'ui',
        include: ['src/**/*.test.ts'],
        setupFiles: ['./vitest.setup.ts'],
        // The theme test (D-22) reads app.css as source. Vitest defaults to css:false, which
        // hands back an empty module for every stylesheet, a "?raw" import of one included.
        css: true,
        browser: {
            enabled: true,
            headless: true,
            // The size the maintainer looks at the app in, and the one D-34 names: every layout
            // assertion (dialogs that must not overflow, column tracks) is measured here.
            viewport: {width: 1280, height: 800},
            provider: playwright(),
            instances: [{browser: 'chromium'}],
        },
    },
});
