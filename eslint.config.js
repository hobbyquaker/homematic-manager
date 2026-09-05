import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import svelteConfig from './packages/ui/svelte.config.js';

// Type-aware linting (`recommendedTypeChecked`) is deliberately not enabled yet: at this point
// the repository is scaffolding, and every workspace still has more config files than sources.
// It is switched on in task 3, when packages/core gets real code.
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
