import {defineConfig} from 'vitest/config';

export default defineConfig({
    test: {
        // Every workspace brings its own vitest.config.ts (node, or a real chromium for the
        // components, D-23). `data` is a workspace too (task 9) and `scripts` is not a workspace at
        // all; both have their own config and are listed by name.
        projects: ['packages/*', 'apps/*', 'data', 'scripts'],
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
