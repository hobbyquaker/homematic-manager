import {defineConfig, externalizeDepsPlugin} from 'electron-vite';

// Skeleton only: the three bundles compile, nothing is wired up yet. Task 11 adds the backend in
// the main process, the typed IPC transport, window state, menus and the electron-builder targets.
export default defineConfig({
    main: {
        plugins: [externalizeDepsPlugin()],
        build: {
            rollupOptions: {
                input: {index: 'src/main/index.ts'},
            },
        },
    },
    preload: {
        plugins: [externalizeDepsPlugin()],
        build: {
            rollupOptions: {
                input: {index: 'src/preload/index.ts'},
            },
        },
    },
    renderer: {
        root: 'src/renderer',
        build: {
            rollupOptions: {
                input: {index: 'src/renderer/index.html'},
            },
        },
    },
});
