import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import * as svelteParser from 'svelte-eslint-parser';
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
        // Task 4 turns the same type-aware linting on for the backend, for the same reason: it is
        // the layer that puts values on the wire, and `no-unsafe-*` is exactly the class of bug a
        // struct from an interface process can cause. Only `src/**` again - `test/simulator/**` is
        // outside the package's tsconfig program and talks to an untyped hm-simulator.
        files: ['packages/backend/src/**/*.ts'],
        extends: [tseslint.configs.strictTypeChecked],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
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
    {
        // Task 14 turns the same type-aware linting on for `packages/ui`, which task 8 could not:
        // it needs a program that covers `.svelte` files, and that is a configuration job rather
        // than something to slip into a feature task. `project` and not `projectService`, because
        // the service resolves a file through TypeScript, which does not know the extension;
        // `extraFileExtensions` plus `packages/ui/tsconfig.json` (which already includes
        // `src/**/*.svelte`) is what gives the components a program at all.
        files: ['packages/ui/src/**/*.ts', 'packages/ui/src/**/*.svelte'],
        extends: [tseslint.configs.strictTypeChecked],
        languageOptions: {
            globals: {...globals.browser},
            parserOptions: {
                project: ['./packages/ui/tsconfig.json'],
                tsconfigRootDir: import.meta.dirname,
                extraFileExtensions: ['.svelte'],
            },
        },
        rules: {
            '@typescript-eslint/restrict-template-expressions': ['error', {allowNumber: true}],
            // Svelte 5 reads a rune for its dependency and throws the value away: `void this.#version`
            // in a store, `void src` in a component. That *is* the idiom, and the rule cannot know
            // it - it sees a discarded expression and asks for the `void` to go, which would leave
            // a bare expression statement that `no-unused-expressions` then rejects.
            '@typescript-eslint/no-meaningless-void-operator': 'off',
            // Off after measuring it: all 92 of its findings here were false, and its autofix broke
            // the build twice. TypeScript uses the asserted type as the *contextual* type of the
            // expression, so `screen.getByTestId('x') as HTMLInputElement` really does have the
            // asserted type - because of the assertion. Remove it, as the fixer does, and the
            // generic parameter of `getByTestId<T extends HTMLElement = HTMLElement>` falls back to
            // `HTMLElement` and `.value` stops compiling. Where a type argument could be written
            // instead, it now is (58 call sites, this commit's companion); the rest are the same
            // inference through a generic receiver - `handlers.add(handler as (p: never) => void)` -
            // where there is nothing to write instead.
            '@typescript-eslint/no-unnecessary-type-assertion': 'off',
        },
    },
    {
        files: ['packages/ui/src/**/*.svelte'],
        // `strictTypeChecked` sets `languageOptions.parser` to the TypeScript parser, which cannot
        // read a component. The svelte parser has to be put back, with the TypeScript one as its
        // inner parser - otherwise every `.svelte` file fails with "Parsing error: '>' expected".
        languageOptions: {
            parser: svelteParser,
            parserOptions: {parser: tseslint.parser, svelteConfig},
        },
        rules: {
            // svelte-eslint-parser hands typescript-eslint a program in which nothing that crosses
            // a component boundary has a type: a callback prop's parameter, a snippet argument and
            // a `{#each}` item are all `any`. The `no-unsafe-*` family therefore fires on correct,
            // fully typed code - `getId={(device) => device.ADDRESS}` is 125 of these - and would
            // be answered with a suppression rather than a fix. `svelte-check` compiles the same
            // files through svelte2tsx, understands props and reports zero errors on them; that is
            // what `npm run typecheck` runs, and it is the type check these files really have.
            '@typescript-eslint/no-unsafe-argument': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-return': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            // follows from the same `any`: `String(value)` of an untyped template expression, and a
            // template literal built from one
            '@typescript-eslint/no-base-to-string': 'off',
            '@typescript-eslint/restrict-template-expressions': 'off',
            // `let {a, b = 1}: Props = $props()` and `let x = $state(0)` are declarations Svelte
            // rewrites; `const` is a compile error and a default of `undefined` is how an optional
            // prop is declared. Both rules read the source as if it were plain TypeScript.
            'prefer-const': 'off',
            '@typescript-eslint/no-useless-default-assignment': 'off',
            // `onclick={() => store.doSomething()}` in a template: the arrow returns the void the
            // handler already wanted, and the alternative is a block body on every handler.
            '@typescript-eslint/no-confusing-void-expression': 'off',
        },
    },
    {
        files: ['packages/ui/src/**/*.test.ts'],
        rules: {
            // `rows[1]!` after `expect(rows).toHaveLength(4)`: with `noUncheckedIndexedAccess` every
            // index access is `T | undefined`, and in a test the `!` *is* the assertion that was
            // just made two lines up. All 123 occurrences are in test files and none in a source
            // one, so the rule keeps doing its job where it matters.
            '@typescript-eslint/no-non-null-assertion': 'off',
            // `await waitFor(() => expect(x).toBe(y))` is @testing-library's own documented form,
            // and the whole component suite is written in it. The rule wants a block body around
            // every one of them, which buys nothing. It stays on for the sources.
            '@typescript-eslint/no-confusing-void-expression': 'off',
            // `it('...', async () => {...})` where today nothing is awaited: the suite is uniform
            // on purpose, and a test that becomes asynchronous should not also change shape.
            '@typescript-eslint/require-await': 'off',
        },
    },
);
