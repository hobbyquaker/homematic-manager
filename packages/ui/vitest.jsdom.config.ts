import {fileURLToPath} from 'node:url';

import {svelte} from '@sveltejs/vite-plugin-svelte';
import {defineConfig} from 'vitest/config';

/**
 * The same component suite in jsdom: `npm run test:jsdom -w @homematic-manager/ui`.
 *
 * Browser mode is the default (`vitest.config.ts`, D-23). This configuration is the fallback for a
 * machine that cannot run `npx playwright install chromium` - a container without the chromium
 * dependencies, a review checkout on a metered connection - and the second opinion when a failure
 * looks like it might be a browser-mode artefact rather than a component bug.
 *
 * It is not what CI reports on, so a test that only passes here is not a passing test.
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
        name: 'ui-jsdom',
        environment: 'jsdom',
        include: ['src/**/*.test.ts'],
        setupFiles: ['./vitest.setup.ts'],
        // The theme test (D-22) reads app.css as source. Vitest defaults to css:false, which
        // hands back an empty module for every stylesheet, a "?raw" import of one included.
        css: true,
    },
});
