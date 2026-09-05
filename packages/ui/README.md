# @homematic-manager/ui

The Svelte 5 user interface of the Homematic Manager: the app shell with the six tabs of 2.7, the
reusable components the tabs are built from, the stores, and the transports that connect them to a
backend. It never touches Node, a socket or a file - everything goes through the `Transport` of the
API contract in `packages/core/src/api/types.ts`.

Task 7 built the foundation; the tab contents (paramset editor, links editing, RPC console, RSSI
matrix, add device, acknowledge) arrive with task 8. Toolbar buttons that need task 8 are drawn and
disabled, and say so in their tooltip.

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
  lib/components/       DataTable, Dialog, MultiSelect, ContextMenu, Tabs, Toolbar, Loader,
                        Notices, RpcLogPanel, RpcProgress, ConnectionIndicator, the two switches
  lib/stores/           runes stores, all built around an injected Transport
  lib/transport/        MockTransport, WebSocketTransport, createTransport, the demo fixture
  lib/i18n/             the reactive binding to core's translator, plus the UI's own strings
  lib/util/             value and time formatting for the grids
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
npx vitest run --project ui              # from the repository root, or:
npm test -w @homematic-manager/ui        # (the root `npm test` runs every workspace)
npm run test:browser -w @homematic-manager/ui
```

The suite runs in jsdom by default and unchanged in a real chromium through
`vitest.browser.config.ts`. Browser mode needs `npx playwright install chromium` once; until the CI
workflow does that (task 14), jsdom is what `npm test` uses. `vitest.setup.ts` shims the four APIs
jsdom lacks (`ResizeObserver`, `matchMedia`, `HTMLDialogElement.showModal`, `Element.scrollTo`) so
both environments see the same API surface.

## Routing

The hash route is 2.7's, unchanged: `#/<interface>/<tab>` with the tab ids `devices`, `links`,
`rssi`, `console`, `messages`, `events`. Bookmarks and links from the forum keep working (D-3).
