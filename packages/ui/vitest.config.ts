import {fileURLToPath} from 'node:url';

import {svelte} from '@sveltejs/vite-plugin-svelte';
import {defineConfig} from 'vitest/config';

/**
 * Component tests run in jsdom by default. Browser mode works (see `vitest.browser.config.ts` and
 * `npm run test:browser -w @homematic-manager/ui`) and is the more faithful environment, but it
 * needs a chromium download that the CI workflow does not do yet; until task 14 adds that step,
 * `npm test` at the root must stay installable from `npm ci` alone.
 *
 * Everything the components need beyond jsdom - `ResizeObserver`, `matchMedia`, `scrollTo`,
 * `HTMLDialogElement` - is stubbed in `vitest.setup.ts`, and every test that depends on a measured
 * size passes the size explicitly, so both environments run the same suite.
 */
export default defineConfig({
    plugins: [svelte()],
    resolve: {
        conditions: ['browser'],
        alias: {
            '@homematic-manager/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
        },
    },
    test: {
        name: 'ui',
        environment: 'jsdom',
        include: ['src/**/*.test.ts'],
        setupFiles: ['./vitest.setup.ts'],
    },
});
