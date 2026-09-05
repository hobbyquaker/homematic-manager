import {fileURLToPath} from 'node:url';

import {svelte} from '@sveltejs/vite-plugin-svelte';
import {defineConfig, externalizeDepsPlugin} from 'electron-vite';

import {coreAlias} from '../../packages/ui/vite.config.js';

/**
 * The three bundles of the host.
 *
 * - **main** keeps its dependencies external. `@homematic-manager/backend` and the RPC libraries
 *   underneath it are Node code with dynamic requires; bundling them would only make what
 *   electron-builder packs harder to see. `files` in electron-builder.yml and this list are the
 *   same list.
 * - **preload** is bundled whole, on purpose: it runs sandboxed, where `require` of an npm module
 *   does not exist. It imports `electron` (which is always external) and `src/shared/ipc.ts`, and
 *   that has to end up inside the one file.
 * - **renderer** compiles `@homematic-manager/ui` from its Svelte sources through the package's
 *   `svelte` export condition, with the same core alias the UI's own vite config uses, so a
 *   development build never depends on `packages/ui/dist` being current.
 */
export default defineConfig({
    main: {
        plugins: [externalizeDepsPlugin()],
        build: {
            sourcemap: true,
            rollupOptions: {
                input: {index: fileURLToPath(new URL('src/main/index.ts', import.meta.url))},
            },
        },
    },
    preload: {
        build: {
            sourcemap: true,
            rollupOptions: {
                input: {index: fileURLToPath(new URL('src/preload/index.ts', import.meta.url))},
                // CommonJS, and named `.cjs` because this package is `"type": "module"`. A
                // sandboxed preload - which is what context isolation without Node means - is
                // loaded as CommonJS by Electron and would simply fail to load as ESM.
                output: {format: 'cjs', entryFileNames: '[name].cjs'},
            },
        },
    },
    renderer: {
        root: 'src/renderer',
        // A relative base, like the UI's own build: the page is loaded from a `file:` URL.
        base: './',
        plugins: [svelte({configFile: fileURLToPath(new URL('../../packages/ui/svelte.config.js', import.meta.url))})],
        resolve: {alias: coreAlias},
        build: {
            target: 'chrome140',
            sourcemap: true,
            rollupOptions: {
                input: {index: fileURLToPath(new URL('src/renderer/index.html', import.meta.url))},
            },
        },
    },
});
