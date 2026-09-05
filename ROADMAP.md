# Homematic Manager Roadmap

Plan for Homematic Manager 3: the same tool (devices, direct links, paramsets, RSSI, service
messages, events, RPC console), rebuilt on current Electron, Svelte 5 and a tested core, delivered
as a desktop app **and** as a CCU addon. The analysis behind this plan, the issue triage and the
variant study are in [docs/analysis-2026-09.md](docs/analysis-2026-09.md).

Convention (same as node-red-contrib-ccu, hm2mqtt.js, RedMatic): task numbers are stable and never
reused. This file holds open items; a finished task moves to `roadmap-archive/task-N.md` with what
was done, measured and found, and its line in the contents gets a ✅ marker. Decisions are **D-n**,
open questions **OQ-n**; when the maintainer changes a decision, record it here with the date.

Status 2026-09-05: tasks 2 (foundation), 3 (core), 4 (backend), 5 (hm-simulator 1.0, branch
`1.0-dev` in its own repository, not yet pushed or published) and 9 (data pipeline) are done,
version `3.0.0-dev.0` on branch `3.0-dev` (pushed, D-21); task 7 (UI foundation) is done too; task 6
(write-safety lab study), 11 (Electron host) and 12 (web host) are in progress. The data contract between core and pipeline is `packages/core/src/data/types.ts`,
the generated data is committed under `data/dist/`. Last release 2.7.1 (2023-01-28).

## Decisions

| | Decision (2026-09-05) |
| --- | --- |
| D-1 | XML-RPC / BIN-RPC to the interface processes plus optional ReGa scripts. No CCU JSON-API. |
| D-2 | ReGa is optional (friendly names, later service-message acks). Systems without ReGa must work fully. |
| D-3 | Keep the UX: same tabs, grids, dialogs, workflows. Replace the implementation, not the design. |
| D-4 | Svelte 5, current Electron, TypeScript (D-8), comprehensive tests with near-100 % coverage on core and backend. |
| D-5 | Two deliverables from one codebase: Electron app and CCU addon (Node backend on the CCU, UI through the CCU's lighttpd). |
| D-6 | Data (easy modes, profiles, translations, help, icons) comes from openccu-data artifacts, pinned by version, kept under its HMSL notice outside the GPLv3 code. |
| D-7 | (OQ-1) ~~A legacy stopgap release 2.8 is done first, budget one week.~~ **Reversed 2026-09-05 (same day):** no stopgap release. Development starts directly with 3.0 (task 2); the legacy code is not touched. PRs #130 and #138 are folded into tasks 7 and 8 and closed with thanks when 3.0 ships. |
| D-8 | (OQ-2) TypeScript strict throughout, including the Svelte components. |
| D-9 | (OQ-3) Apple Developer ID for notarised macOS builds; Windows signing through SignPath (apply as an OSS project), documented SmartScreen workaround until accepted. |
| D-10 | (OQ-4) Device images are fetched from the connected CCU (`/config/img/devices/`) with a local cache; a small webp subset ships for Homegear/rfd-only users; the addon ships none. |
| D-11 | (OQ-5) `cast`/`validate` and the interface table start in `packages/core`; extraction into a shared package for nrccu/hm2mqtt is a later follow-up. |
| D-12 | (OQ-6) Coverage is reported in CI (core 100 %, backend 95 %, ui 95 % as targets) but never fails a PR. |
| D-13 | (OQ-7) Generic XML/BIN-RPC plus user-defined extra interfaces (host, port, protocol, path); no vendor-specific code (Homegear: see D-20). |
| D-14 | (OQ-8) The maintainer adds a BidCos-RF actor and a remote from his own stock to the Charly for the lab. |
| D-15 | (OQ-9) The old Turkish easy-mode translations are carried over as a fallback; de/en come from openccu-data. |
| D-16 | (OQ-10) Windows 10+, macOS 12+, Linux glibc 2.31+; `electron-updater` against GitHub releases, notification and user confirmation before install. |
| D-17 | (OQ-11) On first start 3.0 imports the 2.x configuration (CCU address, TLS, auth, language, pacing) once; 2.x caches are discarded. |
| D-18 | Version scheme and commits for the rebuild: work on 3.0 starts at `3.0.0-dev.0` and every dev build bumps the counter (`3.0.0-dev.1`, `3.0.0-dev.2`, ...), then `3.0.0-alpha.n`, `3.0.0-beta.n`, `3.0.0`. Every significant change is its own commit with a message that explains the why; no squashed "WIP" commits. The maintainer tags and releases. |
| D-19 | No support for the HVL addon (#123): the project is dead. The issue is closed with that note. |
| D-20 | No Homegear-specific work. Checked 2026-09-05: the Homegear repository still receives build-system commits (last 2026-05) but its last release is 0.7.40 from 2019-07, three issues were opened since 2025, 127 stars; the user base is small and the project barely maintained. Homegear keeps working through the generic XML-RPC path where it behaves like a CCU; the `setName` special case (#41) is dropped and #41, #59, #60, #100, #106 are closed with that note. |
| D-21 | (2026-09-05) The branch `3.0-dev` may be pushed to GitHub by the agent so that GitHub Actions builds the Windows/macOS/Linux artifacts (task 11) and runs CI; the maintainer downloads dev builds from the workflow artifacts. Tags, releases and pushes to `master` stay with the maintainer. |
| D-22 | (2026-09-05) Dark mode is a requirement, not a nicety: a light and a dark theme, following the OS setting by default with a manual switch that is persisted; every tab, dialog, table state, RSSI colour and notice must be legible in both, and component tests cover both themes where colours carry meaning (RSSI classes, service-message severity, connection marks). |
| D-23 | (2026-09-05) Component tests run in jsdom by default; vitest browser mode (Chromium via Playwright) is available as `npm run test:browser -w @homematic-manager/ui` and becomes the default in task 14, which adds the `playwright install chromium` step to CI (the e2e suites need it anyway). |

## Contents

- [0. Milestones and effort](#0-milestones-and-effort)
- 1. Legacy stopgap release 2.8 ❌ dropped (D-7), number not reused
- 2. Project foundation ✅ [archived](roadmap-archive/task-2.md)
- 3. Core package ✅ [archived](roadmap-archive/task-3.md)
- 4. Backend package ✅ [archived](roadmap-archive/task-4.md)
- 5. hm-simulator 1.0 ✅ [archived](roadmap-archive/task-5.md) (branch `1.0-dev` in its own repository, release by the maintainer)
- [6. Paramset write safety and the CONFIG_PENDING study](#6-paramset-write-safety-and-the-config_pending-study)
- 7. UI foundation ✅ [archived](roadmap-archive/task-7.md)
- [8. UI feature parity](#8-ui-feature-parity)
- 9. Device metadata pipeline ✅ [archived](roadmap-archive/task-9.md)
- [10. Device-specific editors](#10-device-specific-editors)
- [11. Electron host, builds, releases](#11-electron-host-builds-releases)
- [12. Web host for development and e2e](#12-web-host-for-development-and-e2e)
- [13. CCU addon](#13-ccu-addon)
- [14. Test infrastructure and coverage gates](#14-test-infrastructure-and-coverage-gates)
- [15. Backlog features from the triage](#15-backlog-features-from-the-triage)
- [16. Documentation](#16-documentation)
- [17. Beta cycle and 3.0 release](#17-beta-cycle-and-30-release)
- [Open questions](#open-questions)
- [Lab and hardware](#lab-and-hardware)

## 0. Milestones and effort

Effort in person-days (PD) for one experienced maintainer working with an AI coding agent, the way
RedMatic 9, node-red-contrib-ccu 4 and hm2mqtt 3 were done in 2026. Ranges are low/high; the high
end assumes the lab finds surprises. Tests are written inside each task (TDD), task 14 is only the
infrastructure and the e2e suites.

| Milestone | Tasks | Result | PD |
| --- | --- | --- | --- |
| M1 Foundation and safety | 2, 3, 4, 5, 6 | headless backend against simulator and lab CCUs; write path fixed and verified on hardware | 25-37 |
| M2 Parity | 7, 8, 9, 11, 12 | 3.0.0-alpha.0 (after the 3.0.0-dev.n series of M1/M2, D-18): Electron app with every feature of 2.7, English, HmIP easy modes | 34-48 |
| M3 Quality | 10 (initial set), 14, 16, 17 | 3.0.0 | 20-31 |
| M4 Addon | 13 | 3.1.0: CCU addon for CCU3 firmware and OpenCCU (armv7l, aarch64, x86_64) | 8-12 |
| M5 Growth | 10 (extended), 15 | 3.2+: device-specific editors, backlog features | 6-10 (+ open-ended editors) |

| Path | PD |
| --- | --- |
| Electron only (tasks 2-12, 14-17) | **85-126** |
| Electron + CCU addon (adds task 13) | **93-138** |

At two focused days a week that is roughly 10-16 months; full-time roughly 4-6 months. M1 and M2
are the critical path; M4 can run in parallel with M3 once task 12 exists.

Per task:

| Task | PD | Depends on |
| --- | --- | --- |
| 2 Project foundation | 2-3 | - |
| 3 Core package | 6-8 | 2 |
| 4 Backend package | 8-12 | 3, 5 (in parallel) |
| 5 hm-simulator 1.0 | 5-8 | - |
| 6 Paramset write safety and CONFIG_PENDING study | 4-6 | 3, 4, 5, lab |
| 7 UI foundation | 6-8 | 2 |
| 8 UI feature parity | 18-25 | 7, 4, 9 |
| 9 Device metadata pipeline | 3-4 | 2 |
| 10 Device-specific editors (initial set) | 5-8 | 8, 9 |
| 11 Electron host, builds, releases | 5-8 | 4, 7 |
| 12 Web host | 2-3 | 4, 7 |
| 13 CCU addon | 8-12 | 12, lab |
| 14 Test infrastructure and coverage gates | 8-12 | 8, 11, 12 |
| 15 Backlog features | 6-10 | 8 |
| 16 Documentation | 2-3 | 8 |
| 17 Beta cycle and 3.0 release | 5-8 | all of M2/M3 |

## 1. Legacy stopgap release 2.8 (dropped)

Dropped on 2026-09-05 by D-7 before any work started; the number stays reserved. The idea was a
one-week maintenance release of the current code (Windows start fix for #132/#133, ReGa TLS typo,
Electron bump, merge of PRs #130 and #138). Instead, the README gets a short note that 2.7.1 is
the last 2.x release and that 3.0 is in development (task 16), and the Windows/macOS issues are
answered with that pointer.

## 2. Project foundation

- npm workspaces monorepo in this repository: `packages/core`, `packages/backend`, `packages/ui`,
  `apps/electron`, `apps/web`, `apps/ccu-addon`, `data/`. TypeScript strict, ESM, `engines.node
  >=22.12` (CI on 22 and 24, `.nvmrc` 24).
- ESLint + Prettier (nrccu/hm2mqtt config), `.editorconfig`, `.gitattributes` (`* text=auto
  eol=lf`), vitest with `@vitest/coverage-v8` reporting only (D-12), `npm test` at the root.
- GitHub Actions `ci.yml`: lint, unit, integration on push and PR (Node 22/24). The Electron and
  addon jobs come with tasks 11 and 13.
- `AGENTS.md` from the ccu-addon-howto template, adapted; `roadmap-archive/` created.
- The legacy code moves to `legacy/` (kept for reference during the rebuild, deleted at 3.0).
- Version and commit discipline per D-18: the root `package.json` is set to `3.0.0-dev.0` in the
  first commit of the rebuild, every dev build increments the counter (`npm version prerelease
  --preid dev`), one commit per significant change with an explanatory message; `AGENTS.md`
  states both rules.
- Delete `.travis.yml`, `appveyor.yml`; `legacy/tools/` stays only until task 9 replaces it.

## 3. Core package

Pure TypeScript, no I/O, no DOM, 100 % coverage enforced:

- Interface table (name, public/TLS/local ports, protocol, path, init/ping behaviour, ping
  timeouts) from hm2mqtt's `lib/interfaces.js`, plus user-defined extra interfaces (#135).
- Address and channel model, device index (devices, channels, parents, link source/target roles).
- Paramset description model; the description identity key `interface/deviceType/firmware/
  version/channelType/paramset` (today `paramsetName()` in `main.js`).
- `cast`/`validate`: port of nrccu `nodes/lib/cast.js`, extended with `MIN`/`MAX`/`VALUE_LIST`
  validation, `OPERATIONS` checks, `100%` units, `*_TIME_BASE`/`*_TIME_FACTOR` and "infinite"
  values (#96), never `NaN`. One implementation for `setValue`, `putParamset` and link paramsets.
- Paramset diff: current values vs. edited values -> the exact `putParamset` payload; multi-apply
  eligibility by description identity (task 6).
- Easy-mode/profile engine on openccu-data: profile lists per receiver/sender, `fixed`/`list`/
  `range` constraints, `UI_HINT`, expert view, MASTER metadata (parameter order, conditional
  visibility, option presets, cross-validation).
- Link role matrix (`LINK_SOURCE_ROLES`/`LINK_TARGET_ROLES`), service-message model (BidCos via
  `getServiceMessages`, HmIP via events and `getParamset(:0, VALUES)`), RSSI model incl. the HmIP
  `RSSI_DEVICE`/`RSSI_PEER` mapping, event ring buffer.
- RPC method catalogue (today `rpcMethods.json`, 51 methods) with argument types for the console.
- i18n: de/en message catalogue with plural and interpolation (#28, #29), stringtable lookups.

## 4. Backend package

Node, transport-agnostic, tested against mocks and the simulator:

- Clients: `homematic-xmlrpc` 2.0 and `binrpc` 4.2, TLS (port + 40000) and basic auth per
  interface, explicit interface configuration with optional auto-detection (port probes in the
  background, never blocking the UI: #121/#126/#128/#134).
- Callback servers (xmlrpc and binrpc) with `system.multicall`, `event`, `newDevices`,
  `deleteDevices`, `replaceDevice`, `listDevices`, `system.listMethods`; init/ping/re-init per
  interface (HmIP 600 s), clean `init('')` on shutdown with a timeout.
- Caches with persistence (devices, paramset descriptions by identity, names, RSSI, service
  messages) in a per-CCU profile directory; one-time import of the 2.x `hm-manager` configuration,
  caches discarded (D-17).
- ReGa (D-2): optional module for names (`getChannels`) and renames; any failure degrades to
  local names with a status indicator, never an exception. No Homegear-specific naming (D-20).
- UDP discovery on 43439 (hm2mqtt implementation) replacing `hm-discover`.
- Write queue: paced, cancellable, logged (method, params, result, duration), with the
  `rpcLogFolder` dump kept as an option. Read calls bypass the queue.
- API: typed request/response for every method the UI needs plus an event stream (events,
  connection state, cache updates); the same API is exposed over Electron IPC (task 11) and
  WebSocket (task 12).

## 5. hm-simulator 1.0

Shared asset in its own repository (hobbyquaker/hm-simulator), also used by nrccu and hm2mqtt:

- Incoming: `getParamset`/`putParamset` for MASTER/VALUES/LINK with stored state and
  **`CONFIG_PENDING` semantics** (unknown or out-of-range parameter -> fault or sticky pending,
  configurable per device to mimic hmipserver and crRFD), `getLinks`/`addLink`/`removeLink`/
  `getLinkInfo`/`setLinkInfo`/`activateLinkParamset`, `rssiInfo`, `listBidcosInterfaces`/
  `setBidcosInterface`, `getServiceMessages`, `setInstallMode`/`getInstallMode` with a scripted
  `newDevices`, `deleteDevice`/`replaceDevice`, `reportValueUsage`, `getDeviceDescription`,
  `system.methodHelp`, `getValue`, `updateFirmware`/`installFirmware` stubs, fault responses with
  the real fault codes.
- Servers: rfd binrpc, hmipserver xmlrpc, VirtualDevices xmlrpc `/groups`, CUxD binrpc, optional
  TLS and basic auth, ReGa mock (`getChannels`, rename script echo).
- Fixtures: device lists and descriptions from nrccu's `paramsets.json` (962 descriptions from
  firmware 3.87.6/3.89.8) plus the lab dumps; a scenario API for tests (add device, fire event,
  raise service message, drop connection).
- Published as 1.0; nrccu and hm2mqtt tests keep working (their spec files are the compatibility
  test).

## 6. Paramset write safety and the CONFIG_PENDING study

The fix for #98 and the reason the write path is rebuilt before any UI exists:

1. Write only changed parameters; "write all parameters" as an explicit per-dialog option.
2. Validation through task 3's `cast`/`validate`: nothing unknown, read-only, out of range or
   `NaN` ever leaves the app.
3. Multi-apply only across channels with an identical description identity; the dialog explains
   why a channel is not offered.
4. Preview before write: per channel the exact parameters, values and RPC call; bulk operations
   show progress and can be cancelled; pacing per interface (HmIP slower).
5. Session write log with export (task 4).
5a. Link paramset writes send `UI_HINT` = `LinkProfile.id` (and, as 2.x did, `UI_TEMPLATE`)
   next to the profile's parameters; the data of task 9 does not carry them, and a link written
   without `UI_HINT` shows as "expert" in the WebUI.
6. Lab study on the Charly (HmIPW-DRS8/DRI16, wired) and the OpenCCU box (HmIP-PDT, HmIP-WRC2,
   BidCos-RF HM-CC-TC and HM-Sec-SC); also checks the core assumptions A-1 and A-5, whether a
   LINK description depends on the peer (task 4), and how an umlaut in a link name survives
   XML-RPC vs. BIN-RPC:
   provoke `CONFIG_PENDING` with a deliberately invalid `putParamset` (unknown parameter, out of
   range, wrong type, enum name vs index), record hmipserver's reaction (`getServiceMessages`,
   events, `getParamset MASTER` afterwards, `/var/log/messages`), find the recovery that works
   (valid full re-write, `clearConfigCache`, for BidCos `restoreConfigToDevice`), and reproduce
   the "sticky unreach on first connect" report from #98. Write it down in
   `docs/config-pending.md`.
7. "Repair configuration" action per device built from the recovery found in 6.
8. Simulator regression tests for all of the above (task 5).

## 7. UI foundation

- Svelte 5 (runes) app shell with the six tabs, a `Transport` interface (Electron IPC or
  WebSocket) and stores fed by the backend event stream.
- Reusable pieces: a virtualised, sortable, filterable data table with sub-rows (replaces
  jqGrid), native `<dialog>` based dialogs (replaces jQuery UI), multi-select with filter,
  context menus, progress and RPC log panel (replaces the modal RPC dialog), i18n with a
  language switch (de/en), light and dark theme per D-22 (CSS custom properties, `prefers-color-scheme`
  default, persisted manual switch).
- Component tests with `@testing-library/svelte`; jsdom by default, browser mode opt-in (D-23).

## 8. UI feature parity

Everything in section 2.1 of the analysis, tab by tab, with e2e tests per workflow, each view
checked in the light and the dark theme (D-22):

- hmipserver deletes and re-sends every HmIP device on each `init` (eq-3/occu#45): an empty device
  list right after connecting is transient, never "no devices" (found in task 4).
- Devices: grid, channel sub-grid, images (OQ-4), flags, `AVAILABLE_FIRMWARE`/update buttons with
  live refresh (#95, #113), context menu (rename, delete with flags, replace, restore, clear
  config cache, reportValueUsage incl. multi-select #18/PR #138, paramsets).
- Paramset editor: generic description-driven form with the metadata layer (task 9), help texts,
  `setValue` per datapoint, multi-apply (task 6), preview and write log.
- Links: grid, add (role matrix), remove (multi, #80), edit name/description, play short/long,
  defective links (#79), link paramset editor with profiles and expert view (#96, #105). The
  easy-mode dialog shows the sender's full option list from `senderMetadata` (task 9 flattened
  the 2.x per-profile `options`) and greys out what the chosen profile fixes; editors derive from
  the description (`TYPE`, `UNIT`, `MIN`, `MAX`), not from the dropped 2.x `input` hints.
- RPC console: method catalogue with generated argument forms including structs for `putParamset`
  (#27, #136), history, raw response.
- Radio: interfaces grid, RSSI matrix with colours, `setBidcosInterface`/roaming with correct
  active-interface display (#122), LAN gateway status.
- Service messages: list, acknowledge, pop-ups that never break other dialogs (#77), quiet mode
  (#102).
- Events: live table, filter, per-device counters (#129).
- Add device: BidCos install mode incl. temporary key (#20), HmIP key entry and QR scan with
  `@zxing/browser` (#112), name right after pairing (#24).
- Configuration: CCU address with discovery, explicit interface list, callback IP/port, TLS, auth,
  language, pacing, log folder, cache reset; connection indicator per interface.

## 9. Device metadata pipeline

- `data/` with the pinned openccu-data artifacts (`easymode_extract`, `profiles/*`,
  `translation_extract`, `device_icons`), a converter to the runtime format the core package
  loads lazily per channel type, a `NOTICE` for the HMSL 2.0 data, and a documented update
  procedure (bump the pinned openccu-data release, run the converter, diff, commit).
- Output format: the contract in `packages/core/src/data/types.ts` (`data/dist/` layout listed
  there); the core loads it through the `DataSource` interface.
- Replaces `legacy/www/easymodes`, `stringtable.json`, `helpLinkParamset.json`,
  `deviceImages.json` and `legacy/tools/convert_*.js`. Closes #50 and #22 (all 66 receivers incl.
  every HmIP one), gives English parameter names, values and help (#119).
- Device images per D-10: runtime fetch from the CCU with a cache plus a small bundled webp
  subset; a script derives the subset from openccu-data's `device_icons` map and a lab CCU.
- The 2015 Turkish easy-mode translations are converted once into the new format as a fallback
  locale (D-15); missing keys fall back to English.

## 10. Device-specific editors

The procedural WebUI dialogs that no extraction can produce, as plug-ins on top of the generic
editor, each with its own tests:

- "Not used / infinite" values are the parameter's own `SPECIAL` entry (`NOT_USED`: 111600 s on
  BidCos-RF, 16383000 s on BidCos-Wired, issue #96, found in task 3); every editor and easy-mode
  select takes it from the description, never from a constant.
- Initial set (M3): HmIP weekly program (heating, switching), BidCos thermostat week profile
  (HM-CC-RT/TC, also Max! via Homegear: #100), `DISPLAY_INFORMATION` and similar enum extensions,
  blind/shutter calibration parameters, time base/factor pickers.
- Extended (M5, open-ended): universal light effects, RGBW/dual-white controllers, alarm panel,
  energy meter ESI, door lock. Decide by user demand.

## 11. Electron host, builds, releases

- electron-vite 5: main (backend in-process, typed IPC transport, window state, menus, unhandled
  error reporting, single-instance), preload (context isolation on, no Node in the renderer),
  renderer (`packages/ui`).
- electron-builder 26: macOS universal dmg, Windows x64/arm64 nsis + portable, Linux x64/arm64/
  armv7l deb + AppImage (#115, #139). Apple notarisation and SignPath for Windows per D-9;
  README workaround for Windows until SignPath accepts the project. Minimum OS versions per D-16.
- GitHub Actions: build matrix on push (artifacts), release workflow on tag with generated release
  notes (nrccu's script), assets attached, `electron-updater` against GitHub releases with a
  notification and user confirmation (D-16). Quarterly Electron and toolchain bump (OQ-12).
  Electron 44 has no `postinstall` download any more: the build jobs run `install-electron` (or let
  electron-builder fetch the binary) explicitly.
- Playwright `_electron` smoke tests per OS (task 14).

## 12. Web host for development and e2e

`apps/web`: the backend as a local HTTP + WebSocket server serving the built UI. Development mode
with hot reload, the fast e2e target in CI (browser + simulator, no Electron), and the exact
process that runs on the CCU in task 13. Token-based auth from the start so the addon can use it.

## 13. CCU addon

Copied from hm2mqtt.js's `addon/` and the ccu-addon-howto, adapted:

- Package per architecture (armv7l, aarch64, x86_64): bundled musl Node 24 (`build-runtime.sh`,
  `patchelf`, ICU), `app/` with backend + built UI, `rc.d/hmm`, `etc/monit.cfg`, `bin/
  update_addon` (tclsh), `www/` with `settings.cgi` (session check via `tclrega.so`, issues the
  backend token, serves the UI), `service.cgi`, `update_check.cgi`, `update_script` with exit 10
  on fresh install (CCU3 reboot install, live on OpenCCU), `.nobackup`, uninstall.
- Bundled Node for the backend, the RedMatic way: the addon ships its own Node binary and runs
  the task 12 web host as a daemon on 127.0.0.1 (`rc.d/hmm`, monit); the CCU firmware's own
  Node (where present) is never used. hm2mqtt.js's `build-runtime.sh` (Alpine musl Node 24 with
  `patchelf`ed loader for armv7l) is the starting point, RedMatic's `BUILD.md` the reference for
  the release cadence and the `engines` check.
- WebSocket through lighttpd (maintainer suggestion 2026-09-05): the UI talks to the backend
  over the existing `ws` transport (`ApiFrame`), no socket.io; the lighttpd on the CCU reverse
  proxies it. RedMatic proves the path: `/usr/local/etc/config/lighttpd/redmatic.conf` maps
  `/addons/red/` to Node-RED on 1880 with `proxy.header = ("upgrade" => "enable")`, and the
  Node-RED editor's WebSocket runs through it on the CCU3 and OpenCCU. The addon installs the
  same rule as `/usr/local/etc/config/lighttpd/hmm.conf` (`/addons/hmm/api/` to the backend
  port, upgrade enabled, error-file prefix), restarts lighttpd once from `update_script`, and
  removes the file on uninstall. The web host (task 12) must accept the `/addons/hmm/api` base
  path and the origin/host headers lighttpd forwards. To measure on all three lab boxes: the
  lighttpd version and `mod_proxy` upgrade support on the CCU3 firmware (3.61.5+ reads the extra
  config directory), idle timeouts on the proxied WebSocket (`server.max-read-idle`,
  `server.max-write-idle`; the transport's ping keeps it alive), and behaviour when the WebUI
  session expires. Fallback if a firmware cannot proxy the upgrade: the settings CGI hands the
  UI the backend port and the browser connects directly (same host, different port), as the
  current `ws` server already supports.
- Backend in local mode: binrpc 32001/32000, hmipserver 32010, VirtualDevices 39292, CUxD 8701,
  ReGa 8183, callback server on 127.0.0.1; no discovery/config dialog; images from the CCU's own
  `/config/img/devices/`; German first.
- Tests: CGI test with the Tcl stub, container replay of `install_addon` (install, update,
  uninstall, session check, proxy), then all three lab boxes (CCU3 firmware with its chroot
  install and Tcl 8.2, OpenCCU x86_64, OpenCCU aarch64). `addon.yml` workflow builds the packages;
  release attaches them.
- Inode and size budget: `node_modules` limited to the four runtime dependencies, UI as one file,
  measured on the CCU3 (96k inodes on `/usr/local`).

## 14. Test infrastructure and coverage gates

- `npx playwright install --with-deps chromium` in CI, then vitest browser mode becomes the default
  for the component tests (D-23).
- e2e suites with Playwright against the web host + simulator for every workflow in the analysis'
  feature inventory; Electron smoke per OS; v8 coverage from e2e merged with unit/component
  coverage.
- Coverage report in CI with the targets core 100 % lines and branches per file, backend ≥ 95 %,
  ui ≥ 95 %; per D-12 the report never fails a PR, it is reviewed by hand. Addon scripts run
  `shellcheck` + `sh -n`.
- Hardware scripts (kept outside CI, run from WSL): Playwright against the lab CCUs' addon pages,
  ssh checklist per box, the write-path study of task 6 as a repeatable script. Addresses and
  credentials stay in the private lab note.

## 15. Backlog features from the triage

From section 10 of the analysis, after parity: staged changes with one Apply (#124), multi-delete
links (#80), per-pair names in multi-links (#87), defective-link display (#79), best-interface
auto-assignment (#69), `STICKY_UNREACH` auto-ack and unreach counters (#26), links from the
Devices tab (#25), link profile templates (#21), ReGa inbox auto-confirm (#54, optional ReGa),
ReGa service-message ack (#94, optional ReGa), smoke-detector teams (#97), per-device event
counters (#129), user-defined extra interfaces for CCU-Jack (#135, verify its RPC surface first).
HVL (#123) is not supported: the project is dead (D-19). No Homegear-specific features (D-20).
Upstream one-liners found in task 4: latin1 decoding in `binrpc` (`decodeString` uses UTF-8) and a
`responseEncoding` option on `homematic-xmlrpc`'s `Server`; until then a `°` from rfd/CUxD over
BIN-RPC arrives as U+FFFD.

## 16. Documentation

README (German user-facing, English section), `BUILD.md`, `docs/config-pending.md` (from task 6),
addon install notes per platform, migration notes from 2.x (config and cache locations), changelog
from release notes, forum announcement text. Close the triaged issues with the references from the
analysis when 3.0 ships.

## 17. Beta cycle and 3.0 release

Alpha from M2 to the forum, beta with the addon, bug-fix buffer, hardware checklist on the three
lab boxes, release 3.0.0 (Electron) and 3.1.0 (addon) through the workflows. The maintainer cuts
releases; the agent never tags or pushes to `master` on its own (pushing `3.0-dev` for CI builds is D-21).

## Open questions

OQ-1 to OQ-11 were answered on 2026-09-05 and are recorded as D-7 to D-17 in the Decisions
table. The answers that differ from the recommendation: OQ-1 (no stopgap release, reversed the
same day), OQ-6 (coverage is reported, not enforced), OQ-8 (the maintainer supplies BidCos-RF
devices from his own stock) and OQ-9 (the Turkish translations stay as a fallback).

| | Question | Recommendation |
| --- | --- | --- |
| OQ-12 | When to move to TypeScript 7 (native) and vite 8? Blocked today by typescript-eslint 8, svelte-check 4 and electron-vite 5 peer ranges. | Recurring "toolchain bump" check next to the quarterly Electron bump of task 11; bump when all three peers allow it. |
| OQ-13 | `data/dist/` is 9.2 MB of pretty-printed JSON (65 profile files). Ship it gzipped or minified in the CCU addon and the Electron bundle? | Task 13 measures it on the CCU3 (inodes and flash); the apps load profiles lazily per receiver type either way. Decide there. |

## Lab and hardware

Test systems and recipes are in the private note `../redmatic-lab.md` (never in this repo):
CCU3 firmware 3.89.8 on a Charly with HmIPW-DRAP/DRI16/DRS8, OpenCCU 3.89.8 x86_64 with
HmIP-WRC2 and HmIP-PDT, OpenCCU 3.89.8 aarch64 without radio. WSL reaches the CCUs; the CCUs
cannot reach WSL, so callback-based hardware tests of the desktop backend run on a CCU (the addon)
or on the `mqtt-ifaces` box. The production CCU3 (firmware 3.87.6) is read-only and slow: client
calls only, no `init`, useful for BidCos paramset fixtures. Per D-14 the maintainer paired two
BidCos-RF devices to one of the OpenCCU lab boxes on 2026-09-05 (which one is recorded in the lab
note): a wall thermostat (HM-TC-CC / HM-CC-TC family) and a door/window contact. That covers
BidCos-RF MASTER writes to battery devices and a sensor-to-thermostat link; a BidCos-RF mains
actor and BidCos-Wired are still missing, those writes stay simulator-only.
