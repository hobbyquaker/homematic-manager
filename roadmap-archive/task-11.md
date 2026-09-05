# Task 11: Electron host, builds, releases (done 2026-09-05)

Thirteen commits on `3.0-dev` from `80d42e6` (dependencies) to `058629c` (deb target and product
name), plus `.github/workflows/build.yml` and `release-electron.yml`.

## What was done

`apps/electron` with electron-vite 5 and Electron 44.2.0 (pinned exactly, electron-builder 26
refuses a range): main process with the backend in-process and an `ApiFrame` IPC bridge over one
channel (`connected` on its own boolean channel; every `webContents.send` goes through one guarded
place); sandboxed CommonJS preload that exposes exactly `__HMM_TRANSPORT__` and `__HMM_HOST__`,
rejections travelling as the plain `ApiError` object because `contextBridge` strips custom fields
from an `Error`; renderer importing `@homematic-manager/ui`; window state without
electron-window-state; menu, error log, paths; `hmm-image://device/<TYPE>` protocol with the chain
user cache → CCU `/config/img/devices/50/` → bundled webp subset (D-10); electron-updater as a state
machine that never downloads or installs without the user (D-16), off when unpackaged or via
`host.json` / `HMM_DISABLE_AUTO_UPDATE`; AGPL in the two places the app shows a licence (D-26);
a CycloneDX SBOM per installer with Electron, Chromium, Node, V8 and the builder's tools as
components (D-27). electron-builder targets: macOS universal dmg + zip (min 12.0, hardened runtime,
notarisation switched on when the Apple secrets exist), Windows nsis per-user + portable for x64
and arm64, Linux AppImage + deb for x64 and arm64; `data/dist` as `extraResources`.
`build.yml` builds on push to `3.0-dev` (3-OS matrix, `fail-fast: false`, artifacts);
`release-electron.yml` runs on a `v*` tag or by dispatch with a tag input, has no `needs:`, attests
provenance and SBOM, and attaches to a draft release (D-24).

## Measured

135 new tests (1357 in the workspace at the time); `npm run lint`, `npm run typecheck`,
`npm run build` green; `npm run dist:linux` produced all four Linux artifacts and an SBOM each
(27 components). Windows and macOS packaging, signing, notarisation and the real updater run only
in CI. The runtime smoke test could not be done in WSL: `app.whenReady()` never fires there, even
for a five-line control app; the first click-through happens on the CI artifact.

## Found

- Electron 44 ships no `linux-armv7l` any more: armv7l machines get the addon or the npm package
  (#115, #139 answered that way; task 11 bullet corrected).
- Two packaged-app bugs found without a running window: the `electron-updater` named import
  crashes in the ESM main bundle (CJS lazy getter), and `userData` landed in a directory named
  after the scoped package until `productName` was set.
- `disableAutoUpdate` lives in the host-owned `userData/host.json`, not in the backend config: the
  API contract's `config.set` takes a `ConnectionConfig` only.
- `scripts/version-dev.mjs` bumps the workspace versions but not the exact
  `"@homematic-manager/core": "3.0.0-dev.0"` dependency ranges; the next bump would break
  `npm ci` (fixed in the archive commit).
- For task 8: `window.__HMM_HOST__` offers `deviceImageUrl()`, `info()`, `setTheme()`,
  `onSystemTheme()`, `onMenuAction()` and the `update.*` commands; everything must degrade when
  the global is absent (`apps/web`). For task 12: `apps/electron/src/main/images.ts` is
  host-agnostic and belongs in `packages/backend` rather than a second copy. For core: an
  exported `API_EVENT_NAMES` would remove the hand-kept list in `ipcBridge.ts`.
- For task 14: `apps/electron/test/e2e/README.md` lists the nine assertions and two launch
  switches the Playwright `_electron` suites need.
