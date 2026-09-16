import {defineConfig} from 'vitest/config';

export default defineConfig({
    test: {
        name: 'electron',
        environment: 'node',
        // `scripts/`: the packaging checks (B-47) run in node like the main process.
        include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    },
});
