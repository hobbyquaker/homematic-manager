# End-to-end tests of the Electron app

`smoke.spec.ts` implements the nine assertions below. It is run by `npm run test:e2e:electron`
(`playwright.config.ts`, project `electron`) and in `build.yml`, on each OS of the build matrix,
right after the app is built and before it is packaged.

**It has never run on the development machine.** Electron does not start under WSL - `app.whenReady()`
never fires there, which the agent for task 11 measured - so the file is written from the host's
sources and from this document, and CI is where it is first executed. A failure on the first run is
therefore a failure of the test, not necessarily of the app; read it that way.

## Why Playwright and not vitest

The unit tests of `src/main/**` and `src/preload/**` run without Electron on purpose - every module
takes its Electron objects as interfaces, so a fake `ipcMain`, a fake `webContents` and a fake
`autoUpdater` cover the logic. What they cannot cover is whether the three contexts fit together:
whether the preload actually loads, whether `contextBridge` really hands the renderer a working
transport, whether the custom protocol answers an `<img>`. That needs a real Electron, and
`playwright._electron` is the only thing that starts one.

## Setup

```sh
npx install-electron                 # Electron 44 has no postinstall download
npm run build -w @homematic-manager/electron
```

The suite launches the built app, not the sources:

```ts
const app = await _electron.launch({
    args: [path.join(__dirname, '../../out/main/index.js')],
    env: {...process.env, HMM_DISABLE_AUTO_UPDATE: '1'},
});
```

Two things it must set, or the tests will be flaky in ways that are hard to read:

- `HMM_DISABLE_AUTO_UPDATE=1`, so no run reaches out to GitHub. (`app.isPackaged` is false for a
  launched build, so the updater is off anyway - but the flag says so on purpose.)
- a temporary `userData` directory per test, through the `--user-data-dir` switch. Otherwise the
  suite writes into the developer's real profile and a stale `window-state.json` decides where the
  window opens.

## What the suites have to cover

1. **The window opens** and its title is `Homematic Manager`; `ready-to-show` fired, so nothing is
   waiting on a renderer that never loaded.
2. **The transport works end to end**: `window.__HMM_TRANSPORT__.request('config.get')` resolves
   with an `AppConfig` from the real in-process backend. This is the one assertion that proves the
   preload loaded, the context bridge is up and the IPC bridge answers.
3. **A rejection keeps its shape**: a request the backend refuses rejects with an object that has
   `message` and `kind` - the property that `contextBridge` would silently drop if the transport
   ever went back to rejecting with an `Error`.
4. **Events arrive**: subscribe to `notice` and make the backend emit one.
5. **Only two globals exist**: `window.require`, `window.process`, `window.module` and
   `window.ipcRenderer` are all `undefined`, and `Object.keys(window)` contains exactly
   `__HMM_TRANSPORT__` and `__HMM_HOST__` of ours.
6. **The image protocol answers**: `fetch('hmm-image://device/HmIP-BSM')` returns 200 with an
   `image/*` content type when the bundled subset has that type, and 404 for one nothing has.
7. **The CSP is enforced**: a `<script src="https://example.invalid/x.js">` added at runtime is
   blocked, and the page reports a `securitypolicyviolation`.
8. **The window state round-trips**: resize, quit, relaunch with the same `userData`, and the
   window comes back the same size.
9. **Quitting is clean**: the app exits by itself within the stop timeout, and the exit code is 0 -
   the regression test for 2.x's `process.exit(1)` on a second `stop()`.

## Deviations of the implementation from this list

- Assertion 6 uses `HM-CC-RT-DN` rather than `HmIP-BSM`. The bundled webp subset of D-10 is 121
  files and every one of them is a BidCos type; an HmIP picture only ever comes from a connected
  CCU, so `hmm-image://device/HmIP-BSM` is a 404 on a machine that has never talked to one.
- Assertion 3 uses `interfaces.reconnect`, which throws `configError('not connected to a CCU')` on
  a profile that has never connected. It is the cheapest deterministic refusal the backend has.
- Assertion 4 triggers its notice by pointing the configuration at `127.0.0.1`, where nothing
  listens on 2001: the connection fails at once with ECONNREFUSED, and a connection that cannot be
  made is a notice and never a throw (D-2).

## What cannot be tested here

Signing, notarisation and the updater's actual download need a signed build and a real GitHub
release; they are checked by hand on the first beta (task 17).
