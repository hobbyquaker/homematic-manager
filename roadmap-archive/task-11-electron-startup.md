# Task 11 addendum: the Electron app that "never opened" (done 2026-09-06)

Twelve commits on `3.0-dev` from `fcfda6b` (startup trace) to `58f99ba`, by the investigation
that followed the first GitHub Actions run of `build.yml`.

## What happened

The first CI run timed out in the Playwright `_electron` smoke suite on macOS, Windows and Linux
alike, 30 minutes per job, and no artifact was produced. Task 11 had recorded that
`app.whenReady()` never fires under WSL and assumed the desktop machine could not run Electron;
the CI result looked like the app hanging at startup everywhere. A startup trace
(`HMM_STARTUP_TRACE=1`, one line per phase to stderr, streamed into the CI step log) showed the
opposite: the window opens within one to three seconds on every OS, and the hang was elsewhere.

## Four defects, all fixed

1. Quit (`9e69c80`): Electron's `Browser::Quit()` returns at once while `is_quitting_` is set,
   and the flag is cleared only after the `will-quit` handler has returned to C++. The shutdown
   finished inside that same turn (`backend.stop()` resolves in microtasks when nothing is
   registered, `windowState.save()` is synchronous), so the final `app.quit()` was a no-op and
   the process lived on: a zombie after every quit, for users too. The shutdown now starts on the
   next turn; the 15 s watchdog stays as a safety net and logs loudly if it ever fires. Nine
   unit tests, one asserting that nothing is touched inside the will-quit turn.
2. The smoke launch (`671294d`) waited for `domcontentloaded`, earlier than `did-finish-load` and
   `ready-to-show`; assertion 1 read `isVisible()` false and asked the app to quit, and the quit
   aborted the load: that was every `ERR_FAILED (-2) loading .../index.html`. Nothing was wrong
   with the file.
3. The image scheme (`02c8b21`, `c039f7b`): `connect-src 'self'` did not carry `hmm-image:` and
   the scheme was registered without CORS while the page is `file:`; both made `fetch()` fail
   with a bare "Failed to fetch". The renderer page's CSP is now compared against `RENDERER_CSP`
   by a test.
4. The unpackaged data path (`6072c34`): started with the built bundle, `app.getAppPath()` is
   `apps/electron/out/main`, so `data/dist` was never found, `device-icons.json` came back empty
   and no device picture appeared, silently; the directory is searched for upwards now. The
   packaged app takes its path from `resourcesPath` and was always right.

`c4a8bed`: closing an app that has already exited no longer throws (assertion 9).

## Measured

All nine smoke assertions pass in 4.6 s on a real Linux desktop: the Playwright container image
carries the browser dependencies and `xvfb-run`, so the suite runs on the development machine
(`docker run … mcr.microsoft.com/playwright:v1.63.0-noble … xvfb-run -a npx playwright test
--project=electron`, recorded in `apps/electron/test/e2e/README.md`). WSL is what cannot run
Electron, not the machine. Workspace 2008 tests green. In CI the smoke step now takes seconds per
OS; `build.yml` packages and uploads before it runs, with `--max-failures=3`, a 12-minute step
timeout and continue-on-error, so a broken suite can never again withhold a dev build.

## Found

- The Windows SBOM step had failed on the `.bin` shell shim being handed to node (`003a728`).
- Two earlier trace artifacts were empty because the traces only exist for tests that reach
  Playwright's own timeout; streaming the app's stderr into the step log is what made the run
  readable.
