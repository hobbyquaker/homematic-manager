# Task 2: Project foundation (done 2026-09-05)

Commits on `3.0-dev`: `152d98e` (legacy code moved to `legacy/`, dead CI configs removed),
`f128956` (npm workspaces skeleton and tooling), `2c1a8dd` (AGENTS.md, roadmap archive, CI).

## What was done

- The 2.7.1 code (`main.js`, `www/`, `tools/`, `package.json`, lockfile, `build/`) lives in
  `legacy/`, reference only. `Readme.md` says 2.7.1 is the last 2.x release.
- npm workspaces: `packages/core`, `packages/backend`, `packages/ui`, `apps/electron`, `apps/web`,
  `apps/ccu-addon` as `@homematic-manager/*`, all `3.0.0-dev.0`, one root lockfile. `data/` with
  README and the HMSL notice.
- Tooling: TypeScript 5.9 strict ESM, ESLint 10 flat config (typescript-eslint, eslint-plugin-svelte,
  prettier), Prettier 3.9 with the hm2mqtt style plus the Svelte plugin, vitest 5 with projects per
  workspace and v8 coverage (report only, D-12), `.editorconfig`, `.gitattributes` (`eol=lf`),
  `.nvmrc` 24, `engines.node >=22.12`.
- Svelte 5.57 + Vite 7.3 + `@sveltejs/vite-plugin-svelte` 6 + svelte-check 4; component tests in
  jsdom with `@testing-library/svelte` (browser mode revisited in task 7).
- Electron 44.2 + electron-vite 5 + electron-builder 26 skeleton that builds; backend runtime deps
  declared (`homematic-xmlrpc` 2, `binrpc` 4, `homematic-rega` 2, `ws`).
- `scripts/version-dev.mjs` (`npm run version:dev`) bumps root and all workspaces (D-18).
- `AGENTS.md`, `roadmap-archive/`, `.github/workflows/ci.yml` (lint; typecheck + test + coverage
  artifact on Node 22 and 24).

## Measured

`npm install`, `lint`, `typecheck`, `test` (7 files, 8 tests), `test:cov`, `build` all green in WSL;
`npm ci` installs in about 2 s because Electron 44 no longer downloads its binary in `postinstall`
(the build workflow of task 11 must run `install-electron` or let electron-builder fetch it).

## Found

- TypeScript 7 (native) is not usable yet: typescript-eslint 8 and svelte-check 4 peer on TS 5/6.
- vite 8 is blocked by electron-vite 5 (peers vite 5-7); vite 7 is used everywhere so the monorepo
  has one vite. Both bumps are tracked as OQ-12.
- Type-aware ESLint is off until real code exists (task 3 switches it on).
