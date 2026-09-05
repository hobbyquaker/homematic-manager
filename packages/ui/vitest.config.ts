import {svelte} from '@sveltejs/vite-plugin-svelte';
import {defineConfig} from 'vitest/config';

// Components run in jsdom: it needs no browser download in CI and works with Svelte 5 today.
// Task 7 revisits this and is expected to move the component tests to vitest browser mode.
export default defineConfig({
    plugins: [svelte()],
    resolve: {
        conditions: ['browser'],
    },
    test: {
        name: 'ui',
        environment: 'jsdom',
        include: ['src/**/*.test.ts'],
        setupFiles: ['./vitest.setup.ts'],
    },
});
