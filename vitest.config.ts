import {defineConfig} from 'vitest/config';

export default defineConfig({
    test: {
        // Every workspace brings its own vitest.config.ts (node, or jsdom for the components).
        // `data` is a workspace too (task 9); its glob differs, so it is listed by name.
        projects: ['packages/*', 'apps/*', 'data'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov'],
            reportsDirectory: './coverage',
            include: ['packages/*/src/**/*.{ts,svelte}', 'apps/*/src/**/*.ts'],
            exclude: ['**/*.test.ts', '**/*.d.ts'],
            // D-12: coverage is reported, never enforced - no `thresholds` key here, on purpose.
            // The targets are reviewed by hand: core 100 %, backend 95 %, ui 95 %.
        },
    },
});
