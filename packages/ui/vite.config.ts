import {fileURLToPath} from 'node:url';

import {svelte} from '@sveltejs/vite-plugin-svelte';
import {defineConfig} from 'vite';

/**
 * The UI is built as a static bundle: `index.html` plus hashed assets, with a relative base so the
 * same output works under `/addons/hmm/` on the CCU (task 13), under the Electron custom protocol
 * (task 11) and from a plain `file:` URL.
 *
 * `@homematic-manager/core` resolves to its TypeScript sources, not to `dist/`: neither the dev
 * server nor the tests should need a built core, and vite compiles it just as well.
 */
export const coreAlias = {
    '@homematic-manager/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
};

export default defineConfig({
    base: './',
    plugins: [svelte()],
    resolve: {alias: coreAlias},
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        target: 'es2022',
        sourcemap: true,
    },
    server: {port: 5173},
});
