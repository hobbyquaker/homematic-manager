import {defineConfig} from 'vitest/config';

export default defineConfig({
    test: {
        name: 'ccu-addon',
        environment: 'node',
        include: ['src/**/*.test.ts'],
    },
});
