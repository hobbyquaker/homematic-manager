# Task 14: Test infrastructure and coverage (done 2026-09-05)

Ten commits on `3.0-dev` from `00cbcc0` (Chromium in CI, browser mode default) to `4fd7225`.

## What was done

Chromium installed in CI and vitest browser mode as the default for `packages/ui` (D-23; the
project runs as `ui (chromium)`, `vitest.jsdom.config.ts` stays as the fallback behind
`npm run test:jsdom`). Playwright e2e against the real web host plus hm-simulator, one spec per
workflow of the feature inventory, driven through `startForTest` and the cookie so no Playwright
setup is needed. The Electron smoke test implementing the nine assertions of
`apps/electron/test/e2e/README.md`, run in `build.yml` on each OS matrix job (`xvfb-run` on
Linux). One merged coverage report out of unit, component and e2e runs with the per-package
targets shown in the job summary and never failing the job (D-12). `strictTypeChecked` for
`packages/ui` including `.svelte` files, with the rules that are unsafe there switched off with
the evidence in the config. `sh -n` plus shellcheck for every shell script (`npm run lint:sh`).
`tools/lab/README.md` with the rule that hosts and credentials come from the environment.
`SIMULATOR_REQUIRED=1` turns the simulator skip into a failure in vitest and Playwright alike.

## Measured

Workspace 1739 tests in 112 files: core 457, backend 410, ui 529, web 165, electron 135,
ccu-addon 1, data 29, scripts 13. Browser mode about four times faster than jsdom for the UI.
Web e2e 20 tests in 10 spec files. Merged coverage, lines/branches: core 100.0/99.9 (one file
below the per-file branch target: `paramset/cast.ts` 98.3), backend 97.5/91.9, ui 94.1/81.8, web
97.8/89.0, electron 71.4/71.8, ccu-addon 100/100. ui and backend miss the 95 % branch target;
reported, not enforced. Nine shell scripts clean at warning level.

## Found

- A real bug, only findable in a browser (`00b73f0`): `JSON.stringify([undefined])` is `[null]`,
  so an omitted optional parameter reached the backend as `null` over the WebSocket but as
  `undefined` over Electron IPC; `serviceMessages.list()` then filtered for an interface named
  `null` and the refresh button emptied a grid the backend still had a message in. Regression test
  in `backend.test.ts`.
- `no-unnecessary-type-assertion` is unsafe in `packages/ui` (the asserted type is the contextual
  type of `getByTestId`); 58 call sites use the generic form now and the rule is off with the
  evidence in the config. svelte-eslint-parser types anything crossing a component boundary as
  `any`, so the `no-unsafe-*` family is off for components; `svelte-check` is the real type check.
- hm-simulator 1.0 has no `setTempKey`, so #20 cannot be exercised end to end (hm-simulator
  follow-up). `addDevice(serial)` replaces `setInstallMode` entirely: a BidCos serial never opens
  the install mode (task 15 checks that against 2.x behaviour).
- The Electron smoke has never run: it hangs until the timeout in WSL as task 11 found; the first
  CI run may fail for the test's own reasons. Electron has no e2e coverage collection.
- CI skips every simulator test including all 20 e2e until hm-simulator is published (a git
  specifier for the unpushed branch cannot resolve); the workflow prints a warning line.
- Eight shellcheck findings in the addon scripts fixed (dead `case` pattern, `echo -n` in POSIX
  `sh`, `cd` without `|| exit`).
