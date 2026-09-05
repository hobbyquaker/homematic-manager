import {fileURLToPath} from 'node:url';

import {defineConfig} from 'vitest/config';

/**
 * The backend suite runs against the core's **sources**, not its `dist/` - the same alias
 * `packages/ui` uses - so `npm test` works in a fresh checkout without a build step.
 *
 * `test/simulator/*.test.ts` holds the integration tests. They start an in-process hm-simulator
 * and skip themselves when the package is not installed (it is not published yet, see the README),
 * so the suite stays green either way.
 */
export default defineConfig({
    resolve: {
        alias: {
            '@homematic-manager/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
        },
    },
    test: {
        name: 'backend',
        environment: 'node',
        include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
        testTimeout: 20_000,
        hookTimeout: 20_000,
    },
});
