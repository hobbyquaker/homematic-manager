# @homematic-manager/electron

The desktop app: the backend of `@homematic-manager/backend` running in the Electron main process,
the UI of `@homematic-manager/ui` running in the renderer, and a typed IPC bridge between them that
carries the same `ApiFrame`s the WebSocket transport of `apps/web` puts on a socket.

Nothing in the renderer touches Node. Context isolation is on, the preload is sandboxed, and
exactly two objects reach the page: `window.__HMM_TRANSPORT__` (the `Transport` of the contract)
and `window.__HMM_HOST__` (device images, theme source, updater).

## Running it

```sh
npm ci
npx install-electron                      # Electron 44 has no postinstall download any more
npm run dev -w @homematic-manager/electron
```

`dev` starts electron-vite: the renderer comes from the vite dev server with hot reload, main and
preload are rebuilt and the app restarts when they change. The backend runs in-process exactly as
in a packaged build, so a CCU configured in the settings dialog is talked to for real.

```sh
npm run build -w @homematic-manager/electron   # the three bundles into out/
npm run start -w @homematic-manager/electron   # run the built bundles, no dev server
npm run typecheck -w @homematic-manager/electron   # svelte-check on the renderer entry
```

`tsc -b` (the repository's `npm run typecheck`) covers `src/main`, `src/preload` and `src/shared`.
It cannot cover `src/renderer`, which imports `.svelte` modules; `svelte-check` with
`tsconfig.renderer.json` does that instead, and the root `npm run typecheck` runs both.

## Where the app keeps its things

`userData` is `app.getPath('userData')` for the product name **Homematic Manager**:

| OS | directory |
| --- | --- |
| Windows | `%APPDATA%\Homematic Manager` |
| macOS | `~/Library/Application Support/Homematic Manager` |
| Linux | `~/.config/Homematic Manager` (or `$XDG_CONFIG_HOME/Homematic Manager`) |

| path | what it is |
| --- | --- |
| `config.json` | the backend's `AppConfig`: the CCU connection and nothing else |
| `cache/<host>/*.json` | device descriptions, paramset descriptions, names, write log, per CCU |
| `images/` | device pictures fetched from the CCU (D-10) |
| `logs/main.log` | unhandled errors of the main process, one generation rotated as `.log.1` |
| `window-state.json` | size, position and maximised state of the window |
| `host.json` | host settings; today only `disableAutoUpdate` |

Delete `cache/` to force a full re-read from the CCU; delete `config.json` to start over. Nothing
outside this directory is written, which is why the Windows installer is per-user and needs no
administrator.

## The 2.x configuration is imported once (D-17)

On the very first start - when there is no `config.json` yet - the backend looks for the
configuration of Homematic Manager 2.x and takes the CCU address, TLS, authentication, language,
the RPC pacing and the RPC log folder from it. It looks in `%APPDATA%\hm-manager` on Windows,
`~/Library/Preferences/hm-manager` on macOS and `~/.hm-manager` on Linux, which is where
`persist-json('hm-manager')` put them.

The 2.x caches are **not** imported. They were keyed differently, they went stale silently, and a
fresh read from the CCU takes seconds. The import happens once and says so with a notice in the UI;
2.x is left untouched and keeps working.

## What is different from 2.7

- **A configuration change does not restart the app.** 2.x saved the file, called `app.relaunch()`
  and killed the process. The backend reconnects instead; the RPC log and the open tab survive.
- **Quitting waits for the backend** to de-register its callbacks at the interface processes,
  bounded to eight seconds, instead of racing a 15 s timer against `process.exit(0)`.
- **Cut, copy and paste work on Windows and Linux.** 2.x built its Edit menu from macOS-only
  `selector:` strings, so those three items did nothing anywhere else.
- **There is a View menu** (reload, developer tools, zoom) and a Help menu with the issue tracker
  and the log folder.
- **Unhandled errors are always logged**, not only when `showUnhandled` was set in the
  configuration - and the dialog appears once, not once per error.
- **Dark mode** follows the OS by default with a manual switch, and the switch is pushed to
  `nativeTheme` so that the title bar, the menus and the native dialogs follow the page (D-22).

## Device images (D-10)

The pictures in the device grid come from the CCU's own web server and are cached under
`userData/images`. A small webp subset ships inside the app for people running Homegear or a bare
rfd, who have no CCU to ask.

**Where they really are, measured on hardware in task 13**: the plain file names of
`device-icons.json` live in `/config/img/devices/250/` (and `250/coupling/` for ten of them); the
`50/` directory holds the WebUI's list thumbnails, whose names carry a `_thumb` suffix. On both lab
firmwares the four candidates `250/<file>`, `250/coupling/<file>`, `50/<base>_thumb<ext>` and
`50/<file>` resolved 278 of 278 mapped types, while the single `50/<file>` this module still asks
for resolved **none**. `apps/web` walks the four candidates since `405f108`; this copy has not been
corrected, so an Electron user gets the bundled webp subset instead of the CCU's own pictures. The
fix is the reason `images.ts` should move into `packages/backend` rather than stay a second copy.

The renderer never sees the bytes over the API. Main registers an `hmm-image://` protocol, and the
UI puts `hmm-image://device/<DEVICE-TYPE>` straight into an `<img src>`:

```ts
const url = window.__HMM_HOST__.deviceImageUrl('HmIP-BSM');
```

`window.__HMM_HOST__` also carries `info()`, `setTheme()`, `onSystemTheme()`, `onMenuAction()` and
the five `update.*` commands; its shape is `HostBridge` in `src/shared/ipc.ts`. `apps/web` has no
such host, so everything the UI uses from it degrades when the global is absent - a labelled
placeholder instead of a picture, the version without the host information in the About dialog.

## Updates (D-16)

`electron-updater` against the GitHub releases of this repository. What it does:

1. checks ten seconds after the app settled, and then every six hours;
2. when a newer version is there, it says so - and downloads nothing;
3. the user asks for the download, and watches the progress;
4. the user confirms **install on quit**, and the update is installed the next time the app is
   quit - by the user, never by the app.

`autoDownload` and `autoInstallOnAppQuit`, which `electron-updater` defaults to on, are off. The
updater is disabled entirely in development and in any unpackaged build, and can be switched off
for good:

```jsonc
// <userData>/host.json
{"disableAutoUpdate": true}
```

or with `HMM_DISABLE_AUTO_UPDATE=1`, which needs no writable profile - the form for a distribution
package or a Nix expression that ships its own update channel.

## Building the installers

```sh
npm run build                                  # every workspace, in order
npm run dist -w @homematic-manager/electron    # this platform
npm run dist:linux -w @homematic-manager/electron
npm run dist:mac -w @homematic-manager/electron
npm run dist:win -w @homematic-manager/electron
```

Output goes to `apps/electron/dist-electron/` (git-ignored). electron-builder needs the Electron
binary of the target platform and downloads it itself; `npx install-electron` beforehand fills the
cache for this platform.

| platform | targets | artifacts |
| --- | --- | --- |
| macOS 12+ | dmg, zip, universal | `Homematic Manager-<version>-universal.dmg`, `...-universal-mac.zip` |
| Windows 10+ | nsis, portable, x64 + arm64 | `Homematic Manager Setup <version>.exe`, `Homematic Manager-<version>-portable-<arch>.exe` |
| Linux glibc 2.31+ | AppImage, deb, x64 + arm64 | `Homematic Manager-<version><-arch>.AppImage`, `homematic-manager_<version>_<arch>.deb` |

Cross-building only works in one direction that matters: Linux arm64 builds on an x64 runner, and
the macOS universal build needs a macOS runner. Windows installers are built on Windows.

**armv7l is gone.** Issues #115 and #139 asked for 32-bit ARM Linux builds and the roadmap still
lists them, but Electron 44 publishes `linux-x64` and `linux-arm64` only - there is no armv7l
binary to package. A 32-bit ARM machine can run the CCU addon (task 13) or the npm package
(`apps/web`, D-24) instead; both are plain Node.

## SBOMs (D-27)

Every installer gets a CycloneDX 1.6 SBOM next to it, `<installer>.cdx.json`:

```sh
npm run dist -w @homematic-manager/electron
npm run sbom -w @homematic-manager/electron
```

`@cyclonedx/cyclonedx-npm` describes the npm half - the production dependency tree of this
workspace, from the lock file, roughly twenty components. That is a fifth of what is actually
shipped, so `scripts/sbom.mjs` adds what is not an npm dependency:

- **electron**, **chromium**, **node** and **v8**, as four separate components with the versions
  the target Electron reports about itself (it is started with `ELECTRON_RUN_AS_NODE=1`, which
  needs no display). Separate on purpose: a CVE feed is searched for "chromium 152", not for
  "electron 44".
- **the packaging tools electron-builder downloaded** for this build - the AppImage runtime, the
  NSIS toolchain, 7za - read out of its own cache, because whatever is in there is what went in.
- **the installer itself** as `metadata.component`, with its SHA-512, so the file is about one
  artefact rather than about "the project".

The script fails when the SBOM has fewer components than a floor or no Electron runtime in it, and
it runs on every push build, so a broken SBOM is found before a tag rather than during a release.

On a release the assets are attested with `actions/attest-build-provenance` and
`actions/attest-sbom`, which anyone can check offline against a downloaded file:

```sh
gh attestation verify 'Homematic Manager-3.0.0.AppImage' --repo hobbyquaker/homematic-manager
```

The attestation uses `sbom.cdx.json`, a copy without the per-installer `metadata.component`: the
action takes many subjects but one SBOM file, and attaching one that names a *different* installer
to every artefact would be a false statement.

## Signing (D-9)

- **macOS**: the release and build workflows sign and notarise when `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` and the certificate secrets are all present.
  Without them the build still succeeds and produces unsigned artifacts, which is what a fork gets.
  An unsigned build is opened with right-click → Open, once.
- **Windows**: signing goes through SignPath once the open-source project application is accepted.
  The step is in both workflows, commented out, with the shape it will have. Until then SmartScreen
  shows "Windows protected your PC" on the first run of the installer: **More info → Run anyway**.
  The portable build behaves the same way.

## Workflows

| file | trigger | what it does |
| --- | --- | --- |
| `.github/workflows/build.yml` | push to `3.0-dev`, manual | packages all three platforms, uploads the artifacts for 14 days, publishes nothing (D-21) |
| `.github/workflows/release-electron.yml` | `v*` tag, manual with a tag input | the same build, attached to a **draft** GitHub release |

Per D-24 the release workflow is one of three independent ones and has no `needs:` on any other.
The release is created as a draft and published by the maintainer, because `electron-updater` polls
the latest *published* release: publishing one whose `latest*.yml` and installers are still
uploading would offer every running app an update it cannot download.

## Layout

```
src/
  shared/ipc.ts       the channels, the frames and the host bridge - the only file all three
                      contexts import; no Electron, no Node
  main/
    index.ts          the app: lifecycle, window, protocol, native dialogs. The only module that
                      imports Electron
    ipcBridge.ts      ApiFrame over the `api` channel, both ways
    windowState.ts    size, position, maximised, with an off-screen check
    images.ts         the device image cache: disk, CCU, bundled subset
    protocol.ts       the hmm-image:// handler and the renderer's CSP
    updater.ts        the D-16 state machine
    menu.ts           the application menu as plain data
    errorLog.ts       userData/logs/main.log, and the dialog that appears once
    paths.ts          development and packaged layouts
    hostSettings.ts   host.json
  preload/
    index.ts          the two `contextBridge.exposeInMainWorld` calls and nothing else
    bridge.ts         the renderer-side transport and host bridge
  renderer/
    index.html        the CSP
    src/main.ts       mounts App and createStores from @homematic-manager/ui
test/e2e/             the Playwright `_electron` suites of task 14 (README only for now)
```

Every module in `main/` except `index.ts` takes its Electron objects as interfaces, which is why
they are unit-tested without Electron at all. What only a real Electron can answer is listed in
`test/e2e/README.md`.
