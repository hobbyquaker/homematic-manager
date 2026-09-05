import {fileURLToPath} from 'node:url';

import {svelte} from '@sveltejs/vite-plugin-svelte';
import {playwright} from '@vitest/browser-playwright';
import {defineConfig} from 'vitest/config';

/**
 * The same component suite in a real chromium (`npm run test:browser -w @homematic-manager/ui`).
 *
 * This is the environment the virtualised table, the native `<dialog>` stacking and the focus
 * handling really need: jsdom has no layout, so it reports every element as 0 x 0 and implements
 * `showModal()` only as a flag. Running here needs `npx playwright install chromium` once; the
 * root `npm test` therefore stays on jsdom until the CI workflow does that (task 14).
 */
export default defineConfig({
    plugins: [svelte()],
    resolve: {
        alias: {
            '@homematic-manager/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
        },
    },
    test: {
        name: 'ui-browser',
        include: ['src/**/*.test.ts'],
        setupFiles: ['./vitest.setup.ts'],
        browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{browser: 'chromium'}],
        },
    },
});
