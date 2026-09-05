import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import svelteConfig from './packages/ui/svelte.config.js';

// Type-aware linting is switched on for `packages/core` only (task 3): core is pure TypeScript
// with no DOM and no I/O, so `strictTypeChecked` is cheap there and catches exactly the class of
// bug the write path must not have. The other workspaces stay on the untyped `recommended` until
// they have real sources; `projectService` is scoped by the `files` entry below so linting the
// repository does not need a program for every config file.
export default tseslint.config(
    {
        ignores: ['legacy/**', '**/dist/**', '**/out/**', '**/.vite/**', 'coverage/**', '**/*.tsbuildinfo'],
    },
    js.configs.recommended,
    tseslint.configs.recommended,
    svelte.configs.recommended,
    prettier,
    svelte.configs.prettier,
    {
        languageOptions: {
            globals: {...globals.node},
        },
    },
    {
        // Only `src/**`: vitest.config.ts is not part of the package's tsconfig program.
        files: ['packages/core/src/**/*.ts'],
        extends: [tseslint.configs.strictTypeChecked],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            // The RPC layer hands us `unknown` values from the CCU; template literals of those are
            // written deliberately (and only after a typeof check), so this rule only adds noise.
            '@typescript-eslint/restrict-template-expressions': ['error', {allowNumber: true}],
        },
    },
    {
        files: ['**/*.svelte', '**/*.svelte.ts'],
        languageOptions: {
            globals: {...globals.browser},
            parserOptions: {
                parser: tseslint.parser,
                svelteConfig,
            },
        },
    },
);
