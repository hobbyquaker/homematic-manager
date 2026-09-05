# Task 7: UI foundation (done 2026-09-05)

Twelve commits on `3.0-dev` from `1ec8399` (browser-mode test dependencies) to `25c93a2`
(follow the contract's `write.cancel` and `binrpc` flag).

## What was done

`packages/ui`, Svelte 5 runes: transports (`MockTransport` with a demo data set and event
replay, `WebSocketTransport` speaking `ApiFrame` with timeouts and backoff reconnect,
`createTransport` that takes an injected host transport first); stores with the transport
injected by context (app with the 2.x `#/<interface>/<tab>` route, interfaces and ReGa state,
devices as core `DeviceIndex`, names, links, service messages, events ring, write log with
in-flight and bulk progress, notices); components replacing jqGrid and jQuery UI (`DataTable`
virtualised with sub-rows, per-column filters, multi-selection, keyboard navigation and a pure
`tableModel`; native `Dialog`; `MultiSelect`; `ContextMenu`; `Tabs`; `Toolbar`; `Loader`;
`Notices`; `RpcLogPanel` drawer instead of the modal RPC dialog; `RpcProgress` for bulk writes;
`ConnectionIndicator`; `LanguageSwitch`; `ThemeSwitch`); i18n bound to the core translator; the
theme as CSS custom properties with light, dark and the persisted manual switch (D-22, enforced
by `theme.test.ts`); the app shell with the six tabs in the 2.7 order and a page per tab (Devices
grid live, Events live, Radio states, config and about dialogs; the rest are marked placeholders
for task 8); demo mode (`npm run dev -w @homematic-manager/ui`) and the static build with a
relative base for `/addons/hmm/` and Electron.

## Measured

225 tests in 17 files; 97.1 % statements, 96.9 % lines, 97.1 % functions, 88.9 % branches. The
whole suite also passes unchanged in headless Chromium (`npm run test:browser`). Bundle 137 kB
JS (44 kB gzip) plus 17 kB CSS.

## Found

- jsdom stays the default test environment (D-23): browser mode works, but `npm ci` does not
  fetch browsers and CI has no `playwright install` step yet; task 14 adds it and flips the
  default. jsdom gaps met: it dispatches `click` on disabled buttons and has no layout.
- vitest 5 takes the browser provider as an object from `@vitest/browser-playwright`; both configs
  need `css: true` for the theme test to read `app.css`.
- Tab order follows `legacy/www/index.html` (Funk before the console), not the roadmap's listing;
  the English label of the Funk tab is "RSSI" as in 2.x.
- Channel sub-rows share the device columns; per-depth column sets are a small `DataTable`
  change if task 8 wants the 2.x channel sub-grid columns back.
- `ConnectionConfig.local` is deliberately not in the settings dialog (the addon sets it).
- The RSSI colour scale is the one meaning-carrying palette not yet under the theme test; it
  comes with the matrix in task 8.
