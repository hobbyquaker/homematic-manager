import {defineConfig} from 'vitest/config';

export default defineConfig({
    test: {
        name: 'electron',
        environment: 'node',
        include: ['src/**/*.test.ts'],
    },
});
