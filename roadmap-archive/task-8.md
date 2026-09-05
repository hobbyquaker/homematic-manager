# Task 8: UI feature parity (done 2026-09-05)

Fourteen commits on `3.0-dev`, interleaved with tasks 6, 12 and 13 in the same working tree:

| commit    | title                                                                                        |
| --------- | -------------------------------------------------------------------------------------------- |
| `6a0bdd9` | core: API_EVENT_NAMES, so no host keeps its own list of events                               |
| `5422365` | ui: give the data table a per-depth column set, for the 2.x channel sub-grid                 |
| `4782090` | ui: the host bridge as a store, and device images that degrade without one                   |
| `8d865b5` | ui: devices tab - the 2.7 grid with its channel sub-grid, images and firmware buttons        |
| `c853d83` | ui: devices tab - the context menu and the rename, delete and replace dialogs                |
| `d96edf9` | ui: the generic paramset editor, with the metadata layer and a preview before every write    |
| `6cf00ba` | ui: links tab - the role matrix, multi-remove, the play buttons and the link paramset editor |
| `70f2260` | ui: what the lab measured - two CONFIG_PENDINGs, the repair action, and the read-back        |
| `11a4b73` | ui: service messages and events - acknowledge, quiet mode, filters and per-device counters   |
| `a4f1341` | ui: radio tab - the gateway grid, the RSSI matrix and setBidcosInterface                     |
| `66b2088` | ui: RPC console - a generated argument form, a history and the raw response                  |
| `45eafd8` | ui: add device - install mode, the temporary key, the HmIP key and the QR scanner            |
| `ee3259f` | ui: the settings dialog completed, the About dialog and the update notice                    |
| `3679ca4` | ui: cover the failure paths of the five stores the tabs added                                |

## What was done

**Devices**: the 2.7 grid with its columns and rules (SUBTYPE only on HmIP, RX_MODE off
BidCos-Wired), the channel sub-grid of `subGridChannels` through a new per-depth `DataTable` column
set with its own label row, device images through `window.__HMM_HOST__.deviceImageUrl()` and a
labelled placeholder without a host (D-10), decoded flags, the service-message marks, and a firmware
column whose button really disappears when the update arrives (#95, #113). Toolbar and one merged
context menu: rename (device, `:0` and optionally every channel), delete with the two flag
dropdowns, replace through `listReplaceableDevices`, `restoreConfigToDevice`, `clearConfigCache`,
repair configuration, the paramset buttons, and `reportValueUsage` over a whole selection of
channels (#18, PR #138).

**Paramset editor**: `formFields()` decides the control from the description alone, `MetaStore` adds
the task 9 data on top (order, conditional visibility, option presets, cross-validation, labels,
enum value names, help texts) and `buildPreview()` is core's changed-only diff, so preview and write
cannot disagree. Multi-apply offers only channels with an identical paramset description (task 6.3)
and disables the rest with the reason; `writeAll` is the explicit opt-out of task 6.1; "not used"
comes from the parameter's own `SPECIAL` (#96); a `100%` unit is a fraction on the wire and a
percentage on screen; VALUES has the per-datapoint `setValue` back.

**Links**: the grid with both device images and the defective mark of #79, add through core's role
matrix (live as the sender selection changes), remove a whole selection (#80), play short and long
on BidCos-RF only, `setLinkInfo`, and the link paramset editor: the profiles of the receiver/sender
pair, `detectProfile` by `UI_HINT` first, `applyProfile` writing `UI_HINT` so the CCU's WebUI does
not call the link "expert" (task 6, item 5a), the sender's full option list from `senderMetadata`
with only the profile's _fixed_ parameters greyed out, and an expert view.

**Service messages**: acknowledge one or all - only `STICKY_UNREACH` and `SABOTAGE`, and the button
says so when it is off; toasts instead of 2.x's modal (#77); quiet mode, persisted (#102).

**Events**: the two filter boxes over core's `EventFilter`, a pause that freezes the view, and the
per-device counter of #129.

**Radio**: the gateway grid, a receive/send pair per gateway, the peer sub-grid, the HmIP matrix
built from `RSSI_DEVICE`/`RSSI_PEER` events against the access point, `setBidcosInterface` reading
the assignment out of the device's own `INTERFACE` and re-reading afterwards (#122), plus "heard
best by" (#69).

**RPC console**: a generated argument form for the whole core catalogue - struct rows for a paramset
(#27, #136), flags for a bit field, a select for a fixed value set, the interface's addresses as a
datalist - the exact tuple printed above the form, a history that refills it, and the raw response
including faults.

**Add device**: BidCos install mode with mode, serial and temporary key (#20), `searchDevices` on
BidCos-Wired, HmIP with SGTIN and key or key server, a QR scanner on `@zxing/browser` loaded lazily
and started only on request (#112), and naming a device right after it pairs (#24).

**Configuration, About, update notice**: discovery as a button, user-defined interfaces with core's
validation (#135, D-13), still no protocol choice (D-28); About shows `__HMM_HOST__.info()` and the
data manifest, or just the version without a host; the update notice is a strip that never installs
by itself (D-16). The shell passes the theme to the host and opens the settings dialog from the
application menu.

**From the task 6 lab study** (`docs/config-pending.md`): `CONFIG_PENDING` has two explanations and
only the HmIP one gets a repair button; `devices.repairConfig` has a dialog that dry-runs first,
lists the corrections, offers the BidCos-only recoveries and says plainly that an unrepairable
channel needs re-pairing; the preview prints the real `putParamset(address, paramset, struct)`; and
every write is read back, because rfd answers `ok` to writes it silently drops or clamps.

## Measured

- 445 tests in 31 files in `packages/ui` (was 225 in 17), all green in jsdom **and** all 445 green
  unchanged in headless Chromium (`npm run test:browser -w @homematic-manager/ui`, after
  `npx playwright install chromium`).
- Workspace: 1584 tests in 103 files pass, 35 skipped (hm-simulator not installed);
  `npm run lint`, `npm run typecheck` and `npm run build` are green.
- Coverage `packages/ui`: 94.1 % statements, 81.7 % branches, 93.6 % functions, 93.9 % lines
  (D-12: reported, not enforced). `src/main.ts`, the browser entry, is the only file at 0 %.
- Bundle: 306.8 kB JS (94.2 kB gzip) plus 29.1 kB CSS (5.5 kB gzip), and a second 412.1 kB chunk
  that is only the QR decoder and is fetched when the scanner is switched on.
- Theme (D-22): the RSSI classes, the service-message severities and the connection marks are
  asserted in light and dark; the four RSSI colours became theme tokens under `theme.test.ts`.

## Found

- **A rendered table line needs its own key.** The RSSI sub-grid lists a device's peers, and a peer
  can be a device that already has a top-level row - Svelte's keyed `{#each}` refused the duplicate.
  `FlatRow.id` is what selection uses, `FlatRow.key` is what the each block uses.
- **`enumEncodingFor()` is no longer load-bearing** after task 6 refuted A-1; the editor sends the
  index everywhere, which is also what `getParamset` returns, so an `ENUM` no longer looks changed
  on every write.
- **The 2.x help texts carry markup.** `Translations.parameterHelp` and `system.methodHelp` contain
  small HTML; both are stripped to text rather than rendered, because neither is ours.
- **`getParamsetDescription(channel, 'LINK')`** is what the link editor asks for, and the LINK values
  are read with the _peer address_ in place of the paramset name - the contract already allows it
  (`paramset.get(interface, address, paramset)`), no addition was needed.
- **No backend addition was necessary at all.** Everything the tabs do is in the contract task 4
  wrote; the only core addition is `API_EVENT_NAMES`, which replaces the hand-kept list task 11 left
  a note about.
- For **task 10**: the editor is where the device-specific plug-ins hook in. `FormField` already
  carries `SPECIAL`, the option preset and the visibility, so a week-programme editor can replace
  the rows of a parameter group without touching the generic path.
- For **task 14**: `packages/ui/src/testHarness.ts` (`mountApp()`) is what an e2e suite should reuse;
  every dialog and every grid has a `data-testid`, and the grids expose `data-row-id` /
  `data-row-kind`.
- For **task 15**: the console's `system.methodHelp` merge happens in the backend, so a Homegear
  that documents its own methods already shows them; and `rpcForm.ts` has no place yet for the two
  argument types the specification leaves as `variant` on some methods.
- **Not done**: `packages/ui` is still linted with the untyped rule set - `strictTypeChecked` is on
  for `packages/core` and `packages/backend` only. Turning it on for the UI needs a tsconfig program
  that covers `.svelte` files and is a task 14 job, not something to slip into a feature task.
