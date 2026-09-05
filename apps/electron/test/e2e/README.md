# End-to-end tests of the Electron app (task 14)

Nothing runs here yet. Task 11 built the host and its unit tests; task 14 owns the test
infrastructure, and this directory is where its Playwright `_electron` suites go, per OS. This file
describes what they have to cover so that whoever writes them does not have to rediscover it.

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

## What cannot be tested here

Signing, notarisation and the updater's actual download need a signed build and a real GitHub
release; they are checked by hand on the first beta (task 17).
