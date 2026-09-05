import {defineConfig} from 'vitest/config';

/**
 * The repository's own scripts are a workspace-less corner that had no tests at all. The coverage
 * merge of task 14 is text arithmetic over a line format - the kind of thing that is quietly wrong
 * for months - so `scripts/` becomes a vitest project of its own.
 */
export default defineConfig({
    test: {
        name: 'scripts',
        environment: 'node',
        include: ['*.test.mjs'],
    },
});
