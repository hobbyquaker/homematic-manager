# End-to-end tests of the web host

One spec per workflow of the feature inventory in
[`docs/analysis-2026-09.md`](../../../../docs/analysis-2026-09.md) §2.1, driving the real UI in
chromium against the real backend and an in-process
[hm-simulator](https://github.com/hobbyquaker/hm-simulator). Nothing is mocked below the browser:
the WebSocket, the XML-RPC and BIN-RPC clients, the callback servers, the caches, the write queue
and ReGa are all the ones that ship.

```sh
npm install --no-save ../hm-simulator     # once; the package is not published yet
npx playwright install --with-deps chromium
npm run build                             # the host serves the *built* UI bundle
npm run test:e2e
```

`npm test` does not build the UI, which is why `npm run build` is a separate step here and a
separate step in `ci.yml`. Every `npm install` prunes the unsaved hm-simulator, so it has to be
re-installed after one.

## What is where

| Spec | Workflow |
| --- | --- |
| `connect.spec.ts` | connect, pick an interface, see the devices and open the channel sub-grid |
| `rename.spec.ts` | rename a device, through ReGa |
| `paramset.spec.ts` | edit a paramset, preview it, write it - and write *only* what changed |
| `multiApply.spec.ts` | multi-apply refuses a channel on another firmware (#98) |
| `links.spec.ts` | add a link, edit its paramset, remove it again |
| `serviceMessages.spec.ts` | a message arrives, is acknowledged and goes away; quiet mode (#102) |
| `events.spec.ts` | live events, the two filters, pause and catch up |
| `console.spec.ts` | pick a method, fill the generated argument form, read the answer, see a fault |
| `installMode.spec.ts` | open and close the install mode; name a device paired while the dialog is open (#24) |
| `settings.spec.ts` | the settings dialog, and the theme switch of D-22 in a real browser |

`fixtures.ts` holds the device set and the Playwright fixture. Each test gets its own host, backend,
simulator and profile directory, all on port 0, so the file runs in parallel and nothing leaks
between workflows. That costs about a second per test and buys independence.

## No screenshots

D-22 asks that both themes be legible, not that they be pixel-identical between runs.
`packages/ui/src/theme.test.ts` already asserts the part that can be asserted - every token exists
in all three places with a different dark value, no component hard-codes a colour, and the elements
whose colour carries meaning keep their semantic class. What `settings.spec.ts` adds is that the
switch is really wired to `document.documentElement` and to `localStorage` in a browser, and that
the two themes paint different backgrounds. A screenshot suite would add a maintenance burden and a
font-rendering flake per runner, and would not catch anything those two do not.

## Without hm-simulator

Every spec asks `simulatorReady()` in a `test.beforeAll` and skips itself when the package is
missing, with one warning line (and a `::warning::` annotation under CI) so that a green run cannot
hide a suite that did not execute. `SIMULATOR_REQUIRED=1` turns the skip into a failure - the switch
to set in CI once hm-simulator 1.0 is published (roadmap task 5), and the one to set locally, where
it is installed.

## What the suite found

- **An omitted optional parameter arrives as `null` over the WebSocket.** `JSON.stringify([undefined])`
  is `[null]`, so `serviceMessages.list()` from the web UI asked the backend for the interface named
  `null` and got an empty list: the refresh button emptied a list the backend still had. Electron IPC
  uses the structured clone algorithm and does not have the problem, which is why no unit test saw
  it. Fixed in `Backend.#dispatch`.
- **hm-simulator 1.0 has no `setTempKey`**, so the temporary key of issue #20 cannot be exercised
  here; the call faults with "Invalid XML-RPC message" and the install mode never opens.
  `installMode.spec.ts` says so where it leaves the field out.
- **A write preview stays open when the read-back differs** from what was written. That is by
  design - the user is told that the interface answered `ok` and stored something else - but it
  means a spec has to close two stacked modals, innermost first.
