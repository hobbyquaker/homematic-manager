# Homematic Manager Roadmap

Plan for Homematic Manager 3: the same tool (devices, direct links, paramsets, RSSI, service
messages, events, RPC console), rebuilt on current Electron, Svelte 5 and a tested core, delivered
as a desktop app **and** as a CCU addon. The analysis behind this plan, the issue triage and the
variant study are in [docs/analysis-2026-09.md](docs/analysis-2026-09.md).

Convention (same as node-red-contrib-ccu, hm2mqtt.js, RedMatic): task numbers are stable and never
reused. This file holds open items; a finished task moves to `roadmap-archive/task-N.md` with what
was done, measured and found, and its line in the contents gets a ✅ marker. Decisions are **D-n**,
open questions **OQ-n**; when the maintainer changes a decision, record it here with the date.

Status 2026-09-05: tasks 2 (foundation), 3 (core), 4 (backend), 5 (hm-simulator 1.0, released as 1.0.0 on
npm and GitHub on 2026-09-05 at the maintainer's request; branch `1.0-dev`, `master` not merged yet) and 9 (data pipeline) are done,
version `3.0.0-dev.0` on branch `3.0-dev` (pushed, D-21); tasks 7 (UI foundation) and 11 (Electron
host with the build and release workflows) and 12 (web host and npm package; its Docker part runs
as a follow-up, also done) are done too, and so is task 6 (write-safety lab study, `docs/config-pending.md`):
milestone M1 is complete. Task 8 (UI feature parity) and task 13 (CCU addon, installed and checked on all three lab boxes) are done as well: milestones M2 and M4 are reached in the code. Tasks 10 (device-specific editors, initial set) and 16 (documentation: README with the install matrix, one page per install type, migration notes, BUILD.md, changelog) are done, and so is task 14 (test infrastructure: browser mode default, Playwright e2e, merged coverage, strict UI lint, shellcheck): milestone M3 lacks only task 17, and task 15 (backlog features: #124, #87, #26, #25, #21, #54, #94, #97 BidCos, D-31 idle unsubscribe, the hardware findings) is done, so M5's backlog half is in as well. Task 17 (beta cycle) is running its agent-side part and waits on the maintainer for GitHub Actions; task 18 (optional login against ReGa) is implemented and tested against stubs, its lab check rides with task 17's hardware run. The data contract between core and pipeline is `packages/core/src/data/types.ts`,
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
| D-24 | (2026-09-05) Four independent release pipelines for the deliverables of D-25: the Electron app (GitHub release assets), the npm package with the Node backend and web UI (`apps/web`, npm trusted publishing with OIDC as in hm-simulator's `release.yml`), the Docker image (ghcr.io, multi-arch) and the CCU addon (`.tar.gz` per architecture attached to the release). Each has its own workflow file, its own trigger and its own failure domain: one failing must never block or roll back the others, and any one of them can be re-run alone. No single "release everything" job with sequential steps, and no final job with `needs:` on all of them (hm2mqtt.js's `github-release` job is the pattern to avoid). |
| D-25 | (2026-09-05) The install matrix of 3.0: CCU addon in three variants (armv7l, aarch64, x86_64); Docker image (amd64, arm64, arm/v7); npm install with `--install` creating a system user, systemd unit and state directory the way `she` and hm2mqtt.js do it, with a Proxmox LXC as the recommended server deployment and a lighttpd reverse-proxy example config; Electron apps for Windows, Linux and macOS. All install types run the same backend and UI and share one config format, so a user can move between them (task 16 documents the move). |
| D-26 | (2026-09-05) Licence: the 3.0 code base is `AGPL-3.0-or-later` (`LICENSE`, every workspace `package.json`, the release notes and the about dialog). 2.x was GPL-3.0; the 2.x sources kept under `legacy/` carry the contributions of others (anli-ger, Stefan Simroth, Homoran, Sathya Laufer and more) and stay GPL-3.0-or-later, which GPLv3 section 13 lets the AGPL work combine with; nothing from `legacy/` is copied into the new packages without checking its author. Ported MIT code from the maintainer's own repositories (`cast.js` from node-red-contrib-ccu, the installer from mqtt-interfaces-core) keeps its attribution in the file header. `data/dist/` stays under the HMSL 2.0 notice of `data/NOTICE.md`: it is eQ-3 data, not part of the AGPL program. |
| D-27 | (2026-09-05) Every release artefact ships with an SBOM: CycloneDX 1.6 JSON named `<artefact>.cdx.json` next to the artefact (GitHub release asset for the Electron installers and the addon packages, `sbom` attestation on the ghcr.io image, npm provenance plus the SBOM attached to the release for the npm package), and each one is signed as a GitHub artifact attestation (`actions/attest-sbom`, `actions/attest-build-provenance`) so `gh attestation verify` works offline against the repository. The SBOM lists what is really inside the artefact, including the runtime that is not an npm dependency (Electron and its Chromium, the bundled Node and the Alpine packages of the addon, the base image of the Docker build), so a CVE in one of them is searchable per release. Generated on every push build too, so a broken SBOM step fails before a tag. |
| D-28 | (2026-09-05, maintainer correction) BIN-RPC exists on a CCU's loopback only: rfd and hs485d take it on 32001/32000, the public ports 2001/2000 (and 42001/42000) are lighttpd's XML-RPC proxies, and no CCU listens for BIN-RPC on the LAN. Off the CCU (Electron, npm, Docker) every built-in interface is XML-RPC; BIN-RPC is used by the addon in local mode (D-5) and for CUxD, which is its own daemon with its own BIN-RPC listener on 8701 (2.x did the same). The "prefer BIN-RPC" option that tasks 4 and 7 had added to the contract, the config store and the settings dialog is removed; a user-defined interface (D-13) may still declare `binrpc` for a non-CCU peer. The simulator's rfd BIN-RPC port stands for the CCU-local case in tests (the backend harness runs in local mode); an XML-RPC listener for rfd in hm-simulator, the lighttpd view, is a task 14 follow-up so the remote path is tested as well. |
| D-29 | (2026-09-05) The npm deliverable bundles the workspace packages (`bundleDependencies` materialised at `prepack`, removed at `postpack`); `@homematic-manager/core`, `backend`, `ui` and `data` are not published separately. Their APIs are internal and one version-locked tarball cannot produce a mismatched tree. If a second consumer of the core ever appears (D-11, shared cast library), that is the moment to publish `core` on its own. |
| D-30 | (2026-09-05, answers OQ-13) `data/dist` ships minified, not pre-gzipped, in the addon, the npm tarball and the Docker image: pretty-printed 9.6 MB, minified 7.4 MB, gzipped 0.6 MB, but all three cost the same 199 inodes on the CCU3 (the scarce resource), the download differs by 50 KB, and pre-gzip would need a `Content-Encoding` branch in the shared static server. Measured by task 13. |
| D-31 | (2026-09-05, maintainer) Idle unsubscribe for the server install types: when no UI session is connected to the web host for a grace period, the backend sends `init('')` to every interface (drops the event subscriptions and the ping watchdog, keeps caches and config), and subscribes again on the next WebSocket connect. Default on for every server install type: the CCU addon, npm and Docker (grace 5 minutes; no interface process should push events to a page nobody is looking at), `--idle-unsubscribe <duration>` / `HMM_IDLE_UNSUBSCRIBE` changes the grace and `0` disables it; off in Electron (the window is the session). The UI shows "subscribing" until the first `listDevices`/service-message sweep after a resubscribe is through, because hmipserver re-sends every device on `init` (occu#45) and events and service messages from the idle period are not replayed. Implemented in task 15. |
| D-32 | (2026-09-05, maintainer) Optional login for the addon path: with `--auth-mode rega` the web host asks for CCU credentials before it serves the UI on `/addons/hmm/`, and verifies them the way RedMatic does (`addon_files/redmatic/lib/rega-auth.js`): the user must exist in ReGa (`dom.GetObject(ID_USERS).Get(name)` and its `UserLevel()` through the existing ReGa client on 8183) and the password is checked against the CCU's authentication daemon on UDP 1998 (`user:password`, answer `1`), both loopback-only and therefore addon-only; no JSON-API (D-1). Off by default: the WebUI hand-over through `settings.cgi` (session check, token cookie) stays the primary path and keeps working when the login is on. Lesson from RedMatic 9.2.0: ReGa runs scripts one at a time, so user lookups are cached (15 minutes), parallel lookups of one user share one script, and a known user stays logged in while ReGa is busy or down; otherwise parallel requests fail with random 401s. Task 18. |
| D-33 | (2026-09-06, maintainer, answers OQ-14) The npm deliverable is published as `homematic-manager`, the 2.x name: its `npm i -g` audience wanted a headless install anyway, the Electron app was never a sensible npm install, and the name already belongs to the maintainer, so npm **trusted publishing is configured on npmjs.com** for `hobbyquaker/homematic-manager` and the workflow file `release-npm.yml` - a scoped `@homematic-manager/web` would have needed an npm organisation plus one manual publish from a laptop before OIDC works. The old 1.x versions under the name stay deprecated, which does not block a new version. Pre-releases go out under the `next` dist-tag, so until 3.0.0 moves `latest` a tester installs `homematic-manager@next` and a plain `npm install -g homematic-manager` still gives the deprecated 1.0.14 from 2022. The bin is `homematic-manager` with `homematic-manager-web` kept as a second name (the addon CGI, the proxy examples and the install pages use it); workspace references use the path form `-w apps/web`, because the package name is now also the workspace root's. |
| D-34 | (2026-09-06, maintainer, after the first look at a dev build) The UI stops imitating the 2.x jQuery look. Structure and workflows stay (D-3: tabs, grids, dialogs), but the visual language follows Svelte defaults and the maintainer's `she` UI (github.com/hobbyquaker/she, checked out at `~/repos/she`): tab bar and header backgrounds and borders, table decorations, font sizes, spacing, control styling. Concretely from the first look: table columns must keep a regular width when the channel sub-grid expands; the paramset dialog must not grow scrollbars at 1280×800; the easy-mode description belongs underneath the selector, not beside it; toasts cap at a handful, the oldest disappears when the stack is full, informational ones expire on their own, errors stay until dismissed. Task 19. |
| D-35 | (2026-09-06, maintainer) Refines D-18: every significant change bumps the number behind `-dev` (`npm run version:dev`), not only a cut build. The main session bumps at the end of each archived task or feature batch, in its own commit before pushing; subagents never bump (the bump touches every package.json and the lockfile, which collides with parallel work). |

## Contents

- [0. Milestones and effort](#0-milestones-and-effort)
- 1. Legacy stopgap release 2.8 ❌ dropped (D-7), number not reused
- 2. Project foundation ✅ [archived](roadmap-archive/task-2.md)
- 3. Core package ✅ [archived](roadmap-archive/task-3.md)
- 4. Backend package ✅ [archived](roadmap-archive/task-4.md)
- 5. hm-simulator 1.0 ✅ [archived](roadmap-archive/task-5.md) (branch `1.0-dev` in its own repository, release by the maintainer)
- [6. Paramset write safety and the CONFIG_PENDING study](#6-paramset-write-safety-and-the-config_pending-study) ✅
- 7. UI foundation ✅ [archived](roadmap-archive/task-7.md)
- 8. UI feature parity ✅ [archived](roadmap-archive/task-8.md)
- 9. Device metadata pipeline ✅ [archived](roadmap-archive/task-9.md)
- [10. Device-specific editors](#10-device-specific-editors) ✅ (initial set; extended set is M5)
- [11. Electron host, builds, releases](#11-electron-host-builds-releases) ✅
- [12. Web host for development and e2e](#12-web-host-for-development-and-e2e) ✅
- [13. CCU addon](#13-ccu-addon) ✅
- [14. Test infrastructure and coverage gates](#14-test-infrastructure-and-coverage-gates) ✅
- [15. Backlog features from the triage](#15-backlog-features-from-the-triage) ✅
- [16. Documentation](#16-documentation) ✅
- [17. Beta cycle and 3.0 release](#17-beta-cycle-and-30-release) ✅ agent side (release waits on the maintainer)
- [18. Addon login against ReGa](#18-addon-login-against-rega) ✅ (lab check pending)
- [19. UI polish after the first look](#19-ui-polish-after-the-first-look) ✅
- [20. UI second look](#20-ui-second-look) ✅
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
| M2 Parity | 7, 8, 9, 11, 12 | 3.0.0-alpha.0 (after the 3.0.0-dev.n series of M1/M2, D-18): Electron app with every feature of 2.7, English, HmIP easy modes; npm package with `--install` and Docker image (D-25) | 38-54 |
| M3 Quality | 10 (initial set), 14, 16, 17 | 3.0.0 | 21-33 |
| M4 Addon | 13 | 3.1.0: CCU addon for CCU3 firmware and OpenCCU (armv7l, aarch64, x86_64) | 9-13 |
| M5 Growth | 10 (extended), 15 | 3.2+: device-specific editors, backlog features | 6-10 (+ open-ended editors) |

| Path | PD |
| --- | --- |
| Electron, npm package and Docker (tasks 2-12, 14-17) | **90-135** |
| Plus the CCU addon (adds task 13) | **99-148** |

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
| 11 Electron host, builds, releases, SBOMs (D-27) | 6-9 | 4, 7 |
| 12 Web host, npm package, `--install`, Docker, proxy examples (D-25) | 5-8 | 4, 7 |
| 13 CCU addon | 9-13 | 12, lab |
| 14 Test infrastructure and coverage gates | 8-12 | 8, 11, 12 |
| 15 Backlog features | 6-10 | 8 |
| 16 Documentation (one page per install type, D-25) | 3-5 | 8 |
| 17 Beta cycle and 3.0 release | 5-8 | all of M2/M3 |
| 18 Addon login against ReGa (D-32) | 2-3 | 12, 13 |
| 19 UI polish after the first look (D-34) | 4-6 | 8, 10 |
| 20 UI second look | 2-3 | 19 |

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

Done 2026-09-05, report in `roadmap-archive/task-6.md`, write-up in `docs/config-pending.md`. The
#98 mechanism is measured: hmipserver persists every `putParamset` entry before validating, an
unknown parameter poisons the channel for good, and the only recovery is a valid full MASTER
write (`devices.repairConfig`). rfd clamps, coerces and drops silently, so a BidCos `ok` says
nothing without a read-back. A-1 refuted (ENUM index everywhere), A-5 verified, D-28 confirmed on
a stock CCU. UI consequences are listed in task 8's brief.

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

Done 2026-09-05, report in [`roadmap-archive/task-8.md`](roadmap-archive/task-8.md): every tab of
2.7 in `packages/ui`, the generic paramset editor with the metadata layer of task 9, the link
editor with the easy-mode profiles, and what the lab study of task 6 changed about `CONFIG_PENDING`,
the repair action and the read-back after a write. Left for others: `packages/ui` is still linted
with the untyped rule set (task 14); the device-specific editors of task 10 plug into
`lib/util/paramsetForm.ts`; `src/testHarness.ts` is what the e2e suites of task 14 should reuse.

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

Initial set done 2026-09-05, report in `roadmap-archive/task-10.md`: heating week programme (four
naming shapes from the description), HmIP switching programme, enum extensions from index-keyed
translations and presets, blind calibration, duration pickers on every base/factor and unit/value
pair. The extended set below stays M5, plus the small items the report lists.

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
- electron-builder 26: macOS universal dmg, Windows x64/arm64 nsis + portable, Linux x64/arm64
  deb + AppImage (#115, #139; Electron 44 ships no armv7l build any more, those machines use the
  addon or the npm package). Apple notarisation and SignPath for Windows per D-9;
  README workaround for Windows until SignPath accepts the project. Minimum OS versions per D-16.
- GitHub Actions: build matrix on push (artifacts), release workflow on tag with generated release
  notes (nrccu's script), assets attached, `electron-updater` against GitHub releases with a
  notification and user confirmation (D-16). Quarterly Electron and toolchain bump (OQ-12).
  Per D-24 the Electron release is one workflow of three (`release-electron.yml`; task 12 owns
  `release-npm.yml`, task 13 `release-addon.yml`). All three trigger on the same `v*` tag, each
  creates or updates the GitHub release idempotently (`softprops/action-gh-release` or `gh release
  create --notes-from-tag || gh release upload --clobber`), each has `workflow_dispatch` with a tag
  input for a re-run of that one deliverable, and none has `needs:` on another. Inside the
  Electron matrix the OS jobs are `fail-fast: false`, so a broken macOS notarisation still yields
  the Windows and Linux assets. `electron-updater` only sees the release once the Electron assets
  and `latest*.yml` are uploaded; the release is created as a draft by whichever workflow is
  first and published by the maintainer, so a half-uploaded release never reaches updaters.
- SBOM per installer (D-27): `@cyclonedx/cyclonedx-npm` on the `apps/electron` workspace
  (production dependencies only, from the lockfile, workspace packages resolved) merged with the
  components that are not npm dependencies: Electron with its Chromium, Node and V8 versions
  (`process.versions` read at build time), the electron-builder target and the OS-specific
  bundled tools (7za, elevate, the AppImage runtime). One `.cdx.json` per installer file, uploaded
  with it and attested. A test in the build job opens the generated SBOM and checks that the
  component count is above a floor and that Electron is in it.
  Electron 44 has no `postinstall` download any more: the build jobs run `install-electron` (or let
  electron-builder fetch the binary) explicitly.
- Playwright `_electron` smoke tests per OS (task 14).
- Done 2026-09-05, report in `roadmap-archive/task-11.md`. Addendum 2026-09-06 in
  `roadmap-archive/task-11-electron-startup.md`: the first CI run showed no window ever opened in
  the smoke suite; the cause was a quit that was a no-op inside the will-quit turn (a zombie
  process after every quit, for users too), plus the smoke launch waiting too early, the image
  scheme blocked by CSP and CORS, and the unpackaged data path; all fixed, nine of nine assertions
  in 4.6 s, and the suite runs on the development machine in the Playwright container. Left for others: the device-image
  chain (`src/main/images.ts`) belongs in `packages/backend` so `apps/web` does not copy it
  (task 12); `API_EVENT_NAMES` exported from core replaces the hand-kept list in `ipcBridge.ts`
  (task 8 or 12, whoever touches it first); the UI consumers of `window.__HMM_HOST__` (update
  notice, About with `info()`, device images) are task 8.

## 12. Web host for development and e2e

`apps/web`: the backend as a local HTTP + WebSocket server serving the built UI. Development mode
with hot reload, the fast e2e target in CI (browser + simulator, no Electron), and the exact
process that runs on the CCU in task 13. Token-based auth from the start so the addon can use it.

Also the third deliverable (D-24): the package is published to npm so that `npm install -g` gives
a Homematic Manager server with the built UI on any machine with Node 22+ (Raspberry Pi next to
a CCU, a Docker host, a NAS). `release-npm.yml` publishes on the `v*` tag with npm trusted
publishing (OIDC, no token secret; hm-simulator's `release.yml` is the template) and provenance,
independent of the Electron, Docker and addon workflows. The package is `homematic-manager` (D-33);
the bin is `homematic-manager`, with `homematic-manager-web` as a second name, and takes `--host`,
`--port`, `--token`, `--profile`, `--base`. CI builds it with `npm pack --dry-run` on every push so
a broken `files` list is caught before a tag.
SBOMs (D-27): `@cyclonedx/cyclonedx-npm` for the package (the tarball's real dependency tree,
including the workspace packages it bundles), attached to the GitHub release as
`homematic-manager-<version>.tgz.cdx.json` and attested; the Docker image gets `sbom: true`
and `provenance: mode=max` in `docker/build-push-action` (syft-based image SBOM including the
Alpine base packages and Node) plus the same CycloneDX file as a release asset, so the image and
the npm package of one version can be compared.

Server install types (D-25), all on top of that package:

- `--install` / `--uninstall` (she and hm2mqtt.js pattern; hm2mqtt.js's comes from
  `mqtt-interfaces-core/lib/install.js` and is the template, MQTT branding removed): as root,
  `useradd --system` a `homematic-manager` user, write `/etc/homematic-manager/config.env` from
  the given options (token generated if absent, printed once), the unit
  `/etc/systemd/system/homematic-manager.service` with `User=`, `StateDirectory=homematic-manager`
  (profiles, caches, write log under `/var/lib/homematic-manager`), `EnvironmentFile=`,
  `Restart=always`, `NoNewPrivileges=true`, `ProtectSystem=full`, `ExecStart` resolved to the
  installed bin so a later `npm update -g` keeps working, then `daemon-reload` and
  `enable --now`. `--uninstall` disables the unit and removes unit and env file, keeps the state
  directory unless `--purge`. Idempotent: a second `--install` rewrites the unit and keeps the
  config. Tested with a fake root (`--prefix` for the paths, `systemctl` stubbed) in vitest and
  once for real in a Debian container in CI.
- Reverse proxy: `docs/lighttpd-homematic-manager.conf` (the lighttpd on a Debian/LXC host:
  `mod_proxy` to 127.0.0.1 with `proxy.header = ("upgrade" => "enable")`, an optional
  `auth.require` in front, TLS termination), plus short nginx and Caddy equivalents; the host
  must accept the forwarded `Host`/`Origin` and the base path (`--base`), which the addon's
  lighttpd rule of task 13 needs anyway. `she`'s `doc/nginx.conf` is the model for the
  commentary (what the proxy must strip, why the token is still required behind the proxy).
- Recommended deployment: a Proxmox LXC (Debian 12/13, unprivileged, Node 22 from NodeSource or
  the distro's 22+, `npm install -g`, `--install`, `--host 0.0.0.0` or the lighttpd proxy). The
  callback ports the CCU pushes events to must be reachable from the CCU (no NAT in an LXC, which
  is why it is recommended over Docker). Documented step by step in task 16, including the CCU
  firewall entry.
- Docker: `Dockerfile` on `node:22-alpine` (hm2mqtt.js's is the template: `npm ci --omit=dev`,
  non-root `node` user, `/data` volume for the state directory, config by `HMM_*` environment
  variables mirroring the CLI options), multi-arch amd64/arm64/arm/v7 to `ghcr.io/hobbyquaker/
  homematic-manager` from `release-docker.yml` (independent per D-24; CI builds the image without
  pushing on every push). Documented with `--network host`, or published callback ports plus
  `--callback-ip` set to the Docker host's address, and a `compose.yml` example.

## 13. CCU addon

Idle unsubscribe (D-31, maintainer suggestion 2026-09-05): the addon runs with
`--idle-unsubscribe 5m` so the interface processes stop pushing events when no web UI has been
open for five minutes; the subscription comes back on the next page load. Measured on the lab
boxes in task 17: the `init('')`/`init(url)` round trip, the resubscribe time with 100+ HmIP
devices, and that no service message is lost across it.

Done 2026-09-05, report in `roadmap-archive/task-13.md`: packages for the three architectures,
container replay of `install_addon`, installed and checked on the two OpenCCU boxes and the
CCU3-firmware box (single reboot install). OQ-13 answered (D-30).

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
- SBOM per package (D-27): the npm tree of the addon's `app/` (`@cyclonedx/cyclonedx-npm`) merged
  with the bundled runtime: the Node version and the Alpine packages `build-runtime.sh` took
  (`alpine-packages.js` already resolves name, version and the apk origin; emit them as
  components with `purl` `pkg:apk/alpine/...`), musl, ICU and OpenSSL among them. One
  `hmm-ccu-<arch>-<version>.tar.gz.cdx.json` per architecture next to the package, attested. The
  `package-test.sh` step checks the SBOM's Node version equals the runtime's `node -v` in the
  package.

## 14. Test infrastructure and coverage gates

Done 2026-09-05, report in `roadmap-archive/task-14.md`. Caveats that stay: the Electron smoke
runs only in CI (never executed locally), every simulator suite including the 20 e2e specs skips
in CI until hm-simulator is published, ui and backend are below the 95 % branch target
(reported, not enforced, D-12).

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

Done 2026-09-05, report in `roadmap-archive/task-15.md`. Out of scope by D-1: HmIP smoke-detector
groups (group process on `/groups`). hm-simulator 1.0.1 (`setTempKey`) is committed on its
`1.0-dev` and not released yet; the temporary-key e2e skips until it is.

Found by task 13 on hardware, for this task: `data/scripts/icons-from-ccu.mjs` still asks the
CCU's thumbnail directory (`50/<file>`) for plain names that live in `250/`; BidCos-Wired in the
default interface list retries `init` every 15 s with an error line on a CCU without a wired
gateway (probe once, then back off, or drop it from the default list when the port refuses);
`apps/web` logs a supplied token at `info` (should be `debug`); the addon's Node binaries are not
stripped (14 % on x86_64, needs cross binutils for arm); `apps/electron/src/main/images.ts` still
asks `50/<file>` and must walk the same four candidates as `apps/web` (`405f108`), ideally by
moving that chain into `packages/backend` as task 11 suggested.

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

Done 2026-09-05, report in `roadmap-archive/task-16.md`. Task 17 still owes the screenshots, the
forum text and the issue closing.

README (German user-facing, English section) opening with the install matrix of D-25 as one table
(install type, hardware, command or download, where the config lives), one page per install type
(`docs/install-addon.md`, `docs/install-lxc.md` as the recommended server path, `docs/install-docker.md`,
`docs/install-electron.md`) with the reverse-proxy examples, `BUILD.md`, `docs/config-pending.md` (from task 6),
migration notes from 2.x (config and cache locations) and between install types, changelog
from release notes, forum announcement text. Close the triaged issues with the references from the
analysis when 3.0 ships.

## 17. Beta cycle and 3.0 release

Agent-side part done 2026-09-05, report in `roadmap-archive/task-17.md` (screenshots, announcement
draft, release checklist, hardware checklist on the three boxes, OQ-16 = A-17, version
`3.0.0-dev.1`). What remains needs the maintainer: enable GitHub Actions and get one green
`build.yml`, decide OQ-15, click through the Electron artifact, tag, publish the draft
releases, install every type from the published artefacts (D-25), post, close the issues.

Alpha from M2 to the forum, beta with the addon, bug-fix buffer, hardware checklist on the three
lab boxes, release 3.0.0 (Electron, npm package, Docker image) and 3.1.0 (addon) through the four
independent release workflows of D-24 (a failed addon build never holds back the Electron, npm and
Docker releases of the same tag, and vice versa; the failed one is re-run alone via
`workflow_dispatch`). Before the beta every install type of D-25 is installed once from the
published artefacts, not from the checkout: the three addon packages on the lab boxes, the image
with `docker run`, the npm package with `--install` in a fresh Proxmox LXC, the three Electron
apps. Task 12 including the Docker part done 2026-09-05; report in `roadmap-archive/task-12.md`. The release checklist verifies every asset has its `.cdx.json` and that
`gh attestation verify <asset> --repo hobbyquaker/homematic-manager` passes for each (D-27); a
release with a missing SBOM is not published.
The maintainer cuts releases; the agent never tags or pushes to `master` on its own (pushing
`3.0-dev` for CI builds is D-21).

**Done of this so far (2026-09-05):** the 3.0 screenshots from the demo mode
(`npm run screenshots`, light and dark), the forum announcement draft
[`docs/announcement-3.0-beta.md`](docs/announcement-3.0-beta.md), the maintainer's
[`docs/release-checklist.md`](docs/release-checklist.md) (including the issue list to close), the
hardware pass on all three lab boxes with D-31, OQ-16 and the D-32 login of task 18 written up in
[`docs/hardware-checklist.md`](docs/hardware-checklist.md), and one dev bump. **Still open, and all
of it needs the maintainer:** Actions is not enabled, so no workflow has ever run and no artefact
exists; OQ-14 is decided (D-33) but OQ-15 is not; the install-from-the-published-artefacts round of
D-25 cannot start before there is a release to install from; and no issue has been closed - the
agent never touches one.

## 18. Addon login against ReGa

Implemented 2026-09-05, report in `roadmap-archive/task-18.md`; the hardware pass (eight steps in
`apps/ccu-addon/README.md`) is part of task 17's lab run.

D-32. In `apps/web`: `--auth-mode token|rega` (`HMM_AUTH_MODE`), default `token`, the current
behaviour. With `rega`, a request without a valid session gets a small login page (German/English,
same theme tokens as the UI, no framework) instead of the UI; the host verifies the credentials in
`packages/backend` (`rega/auth.ts`: user lookup and `UserLevel()` through the ReGa client on the
local port, password check on UDP 1998 with RedMatic's colon escaping, both against 127.0.0.1
only; a user cache with a 15-minute TTL, in-flight de-duplication per user, and "known user stays
logged in while ReGa is unreachable"), then issues its own session cookie (`hmm_session`,
`HttpOnly; SameSite=Strict; Secure` over https, expiry configurable, default 24 h, sliding) that
the WebSocket upgrade accepts like the token cookie. The `settings.cgi` hand-over keeps working:
a WebUI session that passed the `tclrega.so` check still gets the token cookie and is let in
without the login page. `UserLevel` is stored in the session and exposed on the API as a
read-only `session.info` so that the UI can show the user and, later, gate writes to admins (not
in this task: everyone who logs in may write, as in the WebUI). Logout link in the header when a
session exists. Rate limit on the login endpoint (five failures per source per minute) and no
username enumeration (same answer for unknown user and wrong password). Tests: backend unit tests
with a fake ReGa and a fake UDP responder (cache, de-duplication, ReGa down, escaping), web host
tests for the login page, cookie, logout, rate limit and the `settings.cgi` hand-over; the
container replay of task 13 exercises the login through lighttpd; a lab check on one OpenCCU box
with a real CCU user (task 17's next hardware run). The addon README, `docs/install-addon.md` and
`hmm.cfg`/`etc/default.env` gain the option; the setting is also reachable from the addon's
settings page. npm and Docker installs keep `token` (UDP 1998 is loopback on the CCU); document
that `rega` is refused with a clear message when the CCU is not local.

## 19. UI polish after the first look

Done 2026-09-06, report in `roadmap-archive/task-19.md`. The setValue defect was a double FLOAT
cast that wrote zero in `setValue` and `putParamset` alike; the rest is layout and style, judged
by the maintainer from the retaken screenshots and the next dev build.

D-34. The maintainer's first look at a dev build (2026-09-06): "looks nice, seems to work", the RPC
console round trip (ping → pong event) works, and five things to change:

- Look and feel: back to Svelte defaults and the `she` UI (`~/repos/she`, its `src/` styles and
  layout) for the tab bar, header backgrounds and borders, table decorations, font sizes and
  spacing; the 2.x-looking chrome goes. One theme token file drives both light and dark (D-22).
- Tables: columns keep a regular, stable width when the channel sub-grid expands (per-depth column
  sets share the device columns' widths or get their own fixed grid; no reflow of the parent).
- Paramset dialog: no scrollbars at 1280×800 for a typical MASTER paramset; the easy-mode
  description goes underneath the selector; check every dialog for misplaced blocks in both
  themes and take screenshots with `npm run screenshots` afterwards.
- `setValue` from a VALUES paramset does nothing: the toast says "setValue" without the value and
  the datapoint does not change. Reproduce against hm-simulator (Playwright e2e), fix, and make
  the toast name channel, datapoint and value.
- Toasts: at most five on screen, the oldest disappears when a sixth arrives, informational toasts
  expire after a few seconds, warnings later, errors stay until dismissed; a "n more" counter
  instead of a wall.
- Nothing changes size with its content or state (maintainer, 2026-09-06): an active tab is not
  wider than an inactive one, so the tab bar never moves; a dialog keeps its size while open,
  sized for the expected content with the height bounded by the viewport, scrolls vertically
  inside its content area on overflow and never overflows horizontally (long values wrap or
  ellipsise, tables inside dialogs scroll in their own container). Browser-mode tests measure
  tab widths across activation and every dialog's bounding box before and after its content
  grows.

Screenshots in `docs/` are retaken at the end; the README's images follow.

## 20. UI second look

Done 2026-09-06, report in `roadmap-archive/task-20.md` (the filter point was first done the wrong way
round and corrected in `6292add`).

The maintainer's second look at the dev build on the x86_64 lab box (2026-09-06, `3.0.0-dev.3`):

- The tab-wide filter box (the single "filter everything" input above the Devices, Radio and Links
  tables) is superfluous: remove it; the per-column filter fields in the table header stay.
  (First written the other way round on 2026-09-06 and corrected by the maintainer the same day.)
- The toolbars that currently take space above the table header move into the table header row
  itself, and so does the count on the right ("4 Geräte"): one header band per table with the
  actions on the left, the count on the right, the column labels in the row beneath, no separate
  toolbar strip.
- Dialogs are movable (drag by the title bar) and resizable (drag the corner or edges) by the
  user; the size still never changes on its own (task 19), a resized or moved dialog keeps its
  geometry while open, and the position and size per dialog class are remembered for the session.
  Minimum sizes keep the content usable, the viewport bounds the maximum.

Tests in browser mode for the three points; screenshots retaken.

## Open questions

OQ-1 to OQ-11 were answered on 2026-09-05 and are recorded as D-7 to D-17 in the Decisions
table; OQ-13 is D-30 and OQ-14 is D-33. The answers that differ from the recommendation: OQ-1 (no
stopgap release, reversed the same day), OQ-6 (coverage is reported, not enforced), OQ-8 (the
maintainer supplies BidCos-RF devices from his own stock) and OQ-9 (the Turkish translations stay
as a fallback).

| | Question | Recommendation |
| --- | --- | --- |
| OQ-12 | When to move to TypeScript 7 (native) and vite 8? Blocked today by typescript-eslint 8, svelte-check 4 and electron-vite 5 peer ranges. | Recurring "toolchain bump" check next to the quarterly Electron bump of task 11; bump when all three peers allow it. |
| OQ-15 | The Docker image sets `HMM_ISSUE_COOKIE=true` because a container never binds loopback and the UI's socket would otherwise be refused on every load; the consequence is that whoever reaches the published port is in. Keep that default (UI works out of the box, `docs/install-docker.md` names three ways to lock it down), or ship an image whose UI refuses until the user has read the page? | Keep it, and print a one-line warning at start when the cookie is issued on a non-loopback bind without TLS or a proxy in front. Decide before the first image is published. |
| OQ-16 **answered 2026-09-05** | The HmIP switching programme's `NN_WP_WEEKDAY` bit mask: nothing in the descriptions or `data/dist` says which bit is which weekday. Task 10 took bit 0 = Sunday from the documented HmIP weekday enums (BidCos enums start at Saturday) and always prints the raw mask beside the checkboxes. | **Bit 0 is Sunday; the editor was right.** Measured in task 17's lab pass against the CCU's own weekly-programme dialog, which is byte-identical on both firmwares and gives every weekday checkbox its bit value: Sun 1, Mon 2, Tue 4, Wed 8, Thu 16, Fri 32, Sat 64, all seven 127. Recorded as **A-17** in `packages/core/ASSUMPTIONS.md`, in the editor's comment and in a test; the run is in `docs/hardware-checklist.md`. No device was written to. |

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
