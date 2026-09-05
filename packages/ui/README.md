# @homematic-manager/ui

The Svelte 5 user interface of the Homematic Manager: the app shell with the six tabs of 2.7, the
reusable components the tabs are built from, the stores, and the transports that connect them to a
backend. It never touches Node, a socket or a file - everything goes through the `Transport` of the
API contract in `packages/core/src/api/types.ts`.

Task 7 built the foundation, task 8 filled the six tabs: the device grid with its channel sub-grid,
the generic paramset editor, the link editor with the easy-mode profiles, the RPC console, the RSSI
matrix, the service messages, the events and the pairing dialog. A toolbar button that is disabled
always says why in its tooltip.

## What the tabs do

- **Devices**: the 2.7 columns with the channel sub-grid of `subGridChannels`, device images (D-10),
  flags, RX_MODE, service-message marks, and a firmware column whose button really disappears when
  the update has arrived (#95, #113). Context menu and toolbar: rename, reportValueUsage over a
  whole selection (#18), `restoreConfigToDevice`, `clearConfigCache`, repair configuration
  (task 6.7), replace, delete with the two flag dropdowns, and the paramset buttons.
- **Paramset editor**: description-driven, with the metadata of task 9 on top (order, conditional
  visibility, option presets, cross-validation, labels, enum names and help texts). Multi-apply only
  across an identical paramset description (task 6.3), a preview of the changed-only payload before
  every write, `writeAll` as the explicit opt-out, `setValue` per datapoint of VALUES, and the
  read-back afterwards - `ok` means nothing on BidCos (`docs/config-pending.md`).
- **Links**: the grid with both device images and the defective mark of #79, add through core's role
  matrix, remove a whole selection (#80), play short and long on BidCos-RF, and the link paramset
  editor with the profiles of the data set, the sender's full option list and an expert view.
- **RSSI**: the gateway grid, a receive/send pair per gateway, the peer sub-grid, and
  `setBidcosInterface` that shows the assignment the interface reports now (#122).
- **RPC console**: a generated argument form for all 51 catalogue methods including structs
  (#27, #136), a history and the raw response.
- **Service messages**: acknowledge one or all, the two meanings of `CONFIG_PENDING`, toasts instead
  of 2.x's modal (#77) and a quiet mode (#102).
- **Events**: the two filter boxes over core's event filter, a pause, and the per-device counter of
  #129.
- **Add device**: BidCos install mode with mode, serial and temporary key (#20), HmIP with SGTIN and
  key or key server, a QR scanner (`@zxing/browser`, loaded lazily, #112) and naming right after
  pairing (#24).

## The host bridge

`window.__HMM_HOST__` (Electron, task 11) is read through `HostStore` and nowhere else. Without it -
`apps/web`, the CCU addon, demo mode - `available` is false, every method is a no-op that resolves,
the update notice never appears, the About dialog shows the API's version instead of Electron's, and
a device image falls back to a labelled placeholder.

## Demo mode

```sh
npm run dev -w @homematic-manager/ui
```

opens the app at <http://localhost:5173/> on the demo fixture: two interfaces (`BidCos-RF`,
`HmIP-RF`), ten devices with their channels, friendly names, direct links, service messages, an
RSSI matrix, a write log and a live event stream that replays every 2.5 seconds. No backend, no
CCU, no simulator.

- `.env.development` sets `VITE_HMM_DEMO=true`, which is what selects the fixture. Run
  `VITE_HMM_DEMO=false npm run dev -w @homematic-manager/ui` to talk to a real backend instead.
- Any deployed build also enters demo mode with `?demo` in the URL, which makes a bug report
  reproducible without access to the reporter's CCU.
- The fixture lives in `src/lib/transport/demoData.ts`. Its device shapes are plausible, not dumps
  from hardware - the same rule as `packages/core/test/fixtures/`.

## Build

```sh
npm run build -w @homematic-manager/ui
```

writes a static bundle to `dist/`: `index.html` plus hashed assets, with `base: './'` so the same
output works

- from the Electron custom protocol (task 11),
- at `/` behind `apps/web` (task 12),
- and under `/addons/hmm/` behind the CCU's lighttpd (task 13),

without a build-time base URL. The package also exports its components and stores as a library
(`src/index.ts`, `svelte` condition) so the Electron renderer imports the sources and compiles them
in its own build.

## Transports

`createTransport()` decides what the page talks to, in this order:

1. `window.__HMM_TRANSPORT__` if a host injected one. The Electron preload puts its
   context-isolated IPC bridge there and it always wins.
2. `MockTransport` when `?demo` is in the URL or the bundle was built with `VITE_HMM_DEMO=true`.
3. `WebSocketTransport` to the page's own directory plus `api` - `ws://host/api` at the root,
   `wss://ccu/addons/hmm/api` under the addon prefix.

`MockTransport` is also the test double: handlers per method (`respond`, `result`, `fail`), events
fired by hand (`emit`), and a record of every request (`calls`, `countOf`, `lastCall`).

## Layout

```
src/
  App.svelte            the shell: header, tabs, drawer, dialogs, overlays
  main.ts               browser entry (apps/web, the CCU addon, demo mode)
  index.ts              library entry for the Electron renderer
  app.css               the theme tokens, light and dark (D-22)
  routes/               one component per tab, plus the settings and about dialogs
  routes/devices/       rename, delete, replace, repair, add device and the QR scanner
  routes/paramset/      the generic paramset editor, one parameter row, the write preview
  routes/links/         add link, remove links, the link paramset editor
  routes/radio/         setBidcosInterface
  lib/components/       DataTable, Dialog, MultiSelect, ContextMenu, Tabs, Toolbar, Loader,
                        Notices, RpcLogPanel, RpcProgress, ConnectionIndicator, DeviceImage,
                        RssiCell, UpdateNotice, the two switches
  lib/host/             the typed view of `window.__HMM_HOST__`, and the check that it is one
  lib/stores/           runes stores, all built around an injected Transport
  lib/transport/        MockTransport, WebSocketTransport, createTransport, the demo fixture
  lib/i18n/             the reactive binding to core's translator, plus the UI's own strings
  lib/util/             the pure parts of the tabs: the device grid cells, the paramset and link
                        forms, the RPC argument form, the HmIP key, value and time formatting
  testHarness.ts        `mountApp()` and the three doubles every tab test starts with
```

## Theme (D-22)

Light and dark are both requirements. Every colour is a custom property on `:root`, redefined once
under `@media (prefers-color-scheme: dark)` (guarded by `:root:not([data-theme='light'])`, so an
explicit light choice still wins) and once under `:root[data-theme='dark']`, so the manual switch
works in both directions. The choice is persisted in `localStorage` under `hmm.theme`; `system` is
the default. `src/theme.test.ts` enforces the rules: every meaningful token exists in all three
places with a different dark value, no component hard-codes a colour, and the elements whose colour
carries meaning keep their semantic class in both themes.

## Tests

```sh
npx playwright install --with-deps chromium   # once
npx vitest run --project ui                   # from the repository root, or:
npm test -w @homematic-manager/ui             # (the root `npm test` runs every workspace)
npm run test:jsdom -w @homematic-manager/ui   # the fallback, no browser download
```

The suite runs in a real headless chromium (D-23, flipped by task 14): jsdom has no layout, so it
measures every element as 0 x 0 and implements `showModal()` as a flag, and the virtualised table,
the dialog stacking and the focus handling are exactly what needs a browser. It is also about four
times faster, because there is no DOM shim to build per test file.

`vitest.jsdom.config.ts` runs the same files in jsdom for a machine that cannot download a browser,
and `vitest.setup.ts` shims the four APIs jsdom lacks (`ResizeObserver`, `matchMedia`,
`HTMLDialogElement.showModal`, `Element.scrollTo`) so both environments see the same API surface.
CI reports on browser mode, so a test that only passes in jsdom is not a passing test.

## Routing

The hash route is 2.7's, unchanged: `#/<interface>/<tab>` with the tab ids `devices`, `links`,
`rssi`, `console`, `messages`, `events`. Bookmarks and links from the forum keep working (D-3).
