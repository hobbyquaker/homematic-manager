# Changelog

All notable changes to the Homematic Manager. Grouped by what a user notices rather than by
component; the numbers in brackets are GitHub issues and pull requests.

Versions before 3.0 are in the [releases](https://github.com/hobbyquaker/homematic-manager/releases);
2.7.1 (2023-01-28) is the last 2.x release.

## [3.0.0-beta.0] — 2026-09-06

The first public pre-release of the rebuild, for testers: install with
`npm install -g homematic-manager@next`, the addon packages and the desktop installers from the
GitHub release, `ghcr.io/hobbyquaker/homematic-manager:3.0.0-beta.0`. Everything below is what
3.0.0 will contain; "Known issues" is what is still open at the beta.

**A complete rebuild.** The 2.7.1 code (Electron 4 from 2019, jQuery, free-jqgrid, no tests) was
replaced by a tested TypeScript core, a Svelte 5 user interface and a Node backend. The tabs, grids,
dialogs and workflows are deliberately the same as 2.7 — the implementation changed, not the design.
The 2.7.1 sources stay under `legacy/` for reference until 3.0 ships.

Development runs on `master` (D-38) with the `3.0.0-beta.n` counter. **3.0.0-beta.0 is a
published pre-release** (2026-09-06) with the desktop installers, the CCU addon packages and the
Docker image; the beta's npm package follows. What a 2.x user should read first is
[docs/migration-from-2.x.md](docs/migration-from-2.x.md).

### Delivery: four install types instead of one

2.x was a desktop app. 3.0 runs the same backend and the same UI in four places, sharing one
`config.json` format so a user can move between them:

- **CCU addon** for CCU3 firmware ≥ 3.61.5, ELV-Charly and OpenCCU, in three architectures
  (`armv7l`, `aarch64`, `x86_64`) — on the CCU itself, behind its own lighttpd, opened from
  _Systemsteuerung_, with no address to configure and no port to open.
- **Desktop app** for Windows 10+ (x64, arm64), macOS 12+ (universal — Apple Silicon, #139) and
  Linux glibc 2.31+ (x64, arm64) [#115].
- **npm package** with `--install`, which creates a system user, a hardened systemd unit and a state
  directory, with a Proxmox LXC as the recommended server deployment.
- **Docker image** for `amd64`, `arm64` and `arm/v7`.

**32-bit ARM desktop builds are gone**: Electron 44 publishes no `linux-armv7l` binary. Such a
machine runs the CCU addon or the npm package, both of which are plain Node [#115, #139].

The **npm package is `homematic-manager`** (D-33) — the name 2.x had on npm. `npm install -g
homematic-manager` used to give the 2.x desktop app and now gives the server; the desktop app is an
installer from the release. The 1.x versions under that name stay deprecated, and until 3.0.0 moves
the `latest` tag a pre-release has to be asked for by name: `npm install -g homematic-manager@next`.

### Safety: the paramset write path

This is the change with the largest consequence, and it comes out of a measurement on real hardware
(the study is [docs/config-pending.md](docs/config-pending.md)).

- **`putParamset` sends only changed, validated parameters**, and every write shows a preview of the
  exact `putParamset(address, paramset, struct)` call first, with a reason for every parameter that
  was dropped [#98].
- **Multi-apply is restricted to channels with an identical paramset description.** 2.x matched by
  channel _type_, and `MAINTENANCE` has 23, 21 or 9 MASTER parameters depending on the device.
  Channels that do not qualify are listed with the reason instead of being silently included [#98].
- **Every write is read back**, because `rfd` answers `ok` to writes it silently ignores (a `FLOAT`
  sent as a plain integer) or clamps (an `INTEGER` above `MAX`).
- **The two meanings of `CONFIG_PENDING` are distinguished**: a BidCos device with a queued
  configuration that will take it at its next wake-up, versus an HmIP channel that rejected
  something. Only the second gets a repair action.
- **`devices.repairConfig`** dry-runs first, lists the corrections it can make, offers the
  BidCos-only recoveries (`clearConfigCache`, `restoreConfigToDevice`, `determineParameter` — all of
  which answer `-1` on hmipserver) and says plainly when a channel is beyond repair and needs
  re-pairing.
- **ENUM values are sent as their index** everywhere. Both interface processes were measured to
  accept both encodings and to read back the index, so an enum no longer looks changed on every
  write.

### Devices

- The 2.7 grid with its channel sub-grid, device images, decoded flags, `RX_MODE` and `SUBTYPE`
  columns with the rules of 2.x (`SUBTYPE` on HmIP only, `RX_MODE` not on BidCos-Wired).
- The firmware column's update button really disappears when the update has arrived [#95, #113].
- Rename (device, `:0` and optionally every channel), delete with the two flag dropdowns, replace
  through `listReplaceableDevices`, `restoreConfigToDevice`, `clearConfigCache` and repair.
- `reportValueUsage` over a whole selection of channels [#18, PR #138].
- Naming a device right after it pairs [#24].
- BidCos install mode with mode, serial and **temporary key** [#20]; `searchDevices` on
  BidCos-Wired; HmIP with SGTIN and key or key server; a QR scanner that works more than once,
  loaded lazily and started only on request [#112]. The scanner says that it needs https instead
  of failing inside the decoder — a browser hands out no camera on a plain-http page.
- A link count per channel, and "create a link as sender / as receiver" straight from the channel
  sub-grid [#25].
- An **unreach counter per device**, edge-triggered and persisted per CCU, plus an opt-in automatic
  `STICKY_UNREACH` acknowledgement [#26].
- **Smoke-detector teams** on BidCos through `listTeams` / `setTeam` [#97]. HmIP smoke groups are
  built through the group process on `/groups`, outside the RPC catalogue, and are therefore out of
  scope by D-1.

### Paramset editor

- The control for each parameter is decided from the description alone, with the generated device
  metadata layered on top: display order, conditional visibility, option presets, cross-validation,
  labels, enum value names and help texts.
- "Not used" / "infinite" comes from the parameter's own `SPECIAL` entry instead of the hard-coded
  111600 s, which was the BidCos-RF value and wrong on BidCos-Wired (16383000 s) and elsewhere
  [#96].
- A `100%` unit is a fraction on the wire and a percentage on screen.
- `VALUES` has the per-datapoint `setValue` back.
- **Five device-specific editors** on a plug-in point above the generic form: the heating week
  programme (four naming shapes recognised from the description, including the 24-slot
  `TIMEOUT`/`TEMPERATUR` shape a Max! thermostat answers through Homegear) [#100], the HmIP
  switching programme, blind and shutter calibration in seconds beside the raw value, duration
  pickers for every base/factor and HmIP unit/value pair, and plain names for enum values the
  description only knows as numbers. A checkbox shows the raw parameters as well.

### Links

- The grid with both device images and the defective mark the WebUI uses [#79].
- Add through the role matrix, live as the sender selection changes.
- Remove a whole selection at once [#80].
- Play short and long on BidCos-RF only; `setLinkInfo` [#82].
- The link paramset editor with the easy-mode profiles of the receiver/sender pair, the sender's full
  option list with only the profile's _fixed_ parameters greyed out, an expert view that shows
  everything immediately [#105], and `UI_HINT` written on apply so the CCU's own WebUI does not call
  the link "expert".
- **Easy modes for every HmIP receiver** and for WINMATIC, from pinned openccu-data artifacts: 3521
  link profiles over 725 receiver/sender combinations [#50, #22].
- **A name and a description per pair** of a multi-link, instead of one name for the whole set
  [#87].
- **Link profile templates**: a tuned profile saved under a name and applied to another link of the
  same receiver/sender kind. Only templates whose paramset description is identical are offered,
  and applying one fills the form and writes nothing [#21].
- **Changes across several links (and paramsets) staged and written with one Apply** [#124]: a
  review dialog over the paced write queue with progress and cancel; a failed entry keeps its
  reason and stays in the set.

### Radio (RSSI)

- The gateway grid with a receive/send pair per gateway and a peer sub-grid.
- The HmIP matrix built from `RSSI_DEVICE`/`RSSI_PEER` events against the access point.
- "Heard best by" per device [#69].
- `setBidcosInterface` reads the assignment out of the device's own `INTERFACE` and re-reads it
  afterwards, so no interface is falsely marked active while roaming [#122].

### Service messages and events

- Acknowledge one or all — only `STICKY_UNREACH` and `SABOTAGE` can be acknowledged, and the button
  says so when it is off. Where ReGa is available the acknowledgement is also written there, so the
  CCU's own WebUI stops showing the message [#94].
- **Toasts and an RPC log drawer instead of the modal pop-up** [#77], with a persisted quiet mode
  [#102].
- The event view has two filter boxes, a pause that freezes the view, and a per-device counter,
  which is what makes it useful for duty-cycle hunting [#129].

### RPC console

- A generated argument form for the whole 51-method catalogue: struct rows for a paramset, checkboxes
  for a bit field, a select for a fixed value set, the interface's addresses as a datalist [#27].
- The exact tuple is printed above the form, so `device:channel` cannot be lost between the field and
  the call [#136].
- A history that refills the form, and the raw response including faults.

### Configuration and startup

- **The endless "loading"** on a slow or partly reachable CCU is gone: the interface manager has an
  init / ping watchdog / re-init handshake, and the port probe runs in the background and never
  blocks the UI [#121, #126, #134, #93].
- **2.7.1 not starting on Windows 10/11** is answered by the new Electron host [#132, #133]; macOS
  Sonoma likewise [#137].
- **A configuration change no longer restarts the app.** 2.x saved the file, called `app.relaunch()`
  and killed the process; the backend reconnects instead and the open tab survives.
- **Quitting waits for the backend** to de-register its callbacks at the interface processes, bounded
  to eight seconds, instead of racing a 15 s timer against `process.exit(0)`.
- CCU discovery over UDP as a button in the settings dialog.
- **User-defined extra interfaces** (name, host, port, protocol, path) with validation [#135, D-13];
  CUxD and VirtualDevices are configured explicitly instead of only being port-probed [#128].
- **ReGa is optional** [D-2]: a system without it works fully on locally stored names and shows a
  status indicator. A ReGa 401 no longer crashes the app [#127]. Where it is there it can also
  confirm new devices in the inbox [#54].
- **An interface whose port refuses backs off** from 15 seconds to five minutes with one notice per
  outage, is marked as not present in the header, and stops filling the log. BidCos-Wired is
  enabled in the default interface list and does exactly this on every system without a wired
  gateway.
- **The web host and the addon de-register from the interface processes while no browser is
  connected** and re-subscribe on the next page load (`init('')` after five minutes; D-31). Default
  on for the addon, the npm install and Docker, off in the desktop app, and configurable with
  `--idle-unsubscribe` / `HMM_IDLE_UNSUBSCRIBE`.
- Per-interface host, port, TLS and authentication [#106].
- **The CCU addon can ask for a CCU login** (D-32): the button in _Systemsteuerung_ opens the app
  directly as before, but a bookmark straight to `/addons/hmm/` gets a login page checked against
  the CCU's own users, with a session cookie, a logout, and five failed attempts a minute before
  the CCU is asked no further. Off by default, switched on from the addon's own settings page.
- Unhandled errors are always logged, not only when `showUnhandled` was set, and the dialog appears
  once rather than once per error.

### Interface, language and appearance

- **The whole UI is German and English**, with plurals and interpolation, switchable at runtime
  [#119, #29, #28, PR #130]. Turkish easy-mode strings are kept as a fallback locale.
- **Dark mode** follows the OS setting by default, with a manual switch that is remembered; every
  colour that carries meaning (RSSI classes, service-message severity, connection marks) is asserted
  in both themes.
- Cut, copy and paste work on Windows and Linux. 2.x built its Edit menu from macOS-only `selector:`
  strings, so those three items did nothing anywhere else.
- There is a View menu (reload, developer tools, zoom) and a Help menu with the issue tracker and the
  log folder.
- Device pictures come from the connected CCU with a local cache, and a small bundled webp subset
  answers for installations without one (Homegear, a bare `rfd`).

### Updates and releases

- The updater **downloads nothing and installs nothing without being asked**: it notifies, the user
  asks for the download, the user confirms install-on-quit. It can be switched off through
  `host.json` or `HMM_DISABLE_AUTO_UPDATE`. The "install update" exception is gone [#90].
- Every release artefact ships a **CycloneDX 1.6 SBOM** and a signed GitHub attestation, so
  `gh attestation verify` works offline against a downloaded file [D-27]. The SBOMs list the runtime
  that is not an npm dependency — Electron with its Chromium, Node and V8, the bundled Node and
  Alpine packages of the addon, the base image of the Docker build — so a CVE in one of them is
  searchable per release.
- Release notes are generated from the commits [#66].

### Removed

- **The "prefer BIN-RPC" option** and any protocol choice in the settings dialog. No CCU listens for
  BIN-RPC on the LAN: `rfd` and `hs485d` take it on the loopback (32001/32000) and the public ports
  2001/2000 are lighttpd's XML-RPC proxies. Off the CCU everything built-in is XML-RPC; BIN-RPC
  remains for the addon's local mode and for CUxD on 8701 [D-28].
- **Support for the HVL addon** — the project is dead [#123, D-19].
- **Homegear-specific code**, including the `setName` special case. Homegear keeps working through
  the generic XML-RPC path where it behaves like a CCU [#41, #59, #60, #100, #106, D-20].
- **32-bit ARM desktop builds** (see above).
- The 2015 easy-mode conversion, the bundled 34 MB of device images and the hand-maintained string
  table, all replaced by pinned openccu-data artifacts. No receiver type and no sender combination
  was lost; 832 of 837 shared profiles are parameter-identical, and 10 profiles, 1 parameter and 4
  fixed values differ because the CCU's own data moved on since 2015.

### Migration from 2.x

- On the very first start the 2.x configuration is imported **once** — CCU address, TLS,
  authentication, language, RPC pacing, RPC log folder and callback address — from
  `%APPDATA%\hm-manager\config`, `~/Library/Preferences/hm-manager/config` or `~/.hm-manager/config`.
  The 2.x caches are discarded on purpose, and 2.x itself is left untouched [D-17].
- Details, and everything that changed in behaviour, in
  [docs/migration-from-2.x.md](docs/migration-from-2.x.md).

### Licence

- The 3.0 code base is **AGPL-3.0-or-later**; 2.x was GPL-3.0. The 2.x sources under `legacy/` keep
  the contributions of others and stay **GPL-3.0-or-later**, which GPLv3 section 13 lets the AGPL
  work combine with. The generated device data under `data/dist/` is eQ-3 data and stays under the
  **Homematic Software License 2.0** — see [data/NOTICE.md](data/NOTICE.md) [D-26].

### Known issues

- A `°` from `rfd` or CUxD over **BIN-RPC** arrives as U+FFFD: `binrpc@4.2` decodes strings as UTF-8.
  This affects the CCU addon and CUxD, not the XML-RPC path; the fix is a one-line change upstream.
- The **Docker image issues its session cookie on a non-loopback bind** (`HMM_ISSUE_COOKIE=true`),
  so whoever reaches the published port is in. This is still an open question (OQ-15) and
  [docs/install-docker.md](docs/install-docker.md) names three ways to lock it down; the warning line
  the recommendation asks for is not implemented yet.
- The **beta.0 desktop build** shows harmless "unknown method setReadyConfig" notices at start and
  an RPC log drawer that lengthens the page; both are fixed on `master` (beta.1) and ship with the
  next tag.

### Not in this rebuild yet

Automatic best-interface assignment [#69 shows the information, it does not act on it]; HmIP
smoke-detector groups [#97 — they are built through the group process on `/groups`, outside the RPC
catalogue, and are out of scope by D-1]; CCU-Jack as a pre-defined interface [#135 — it serves
XML-RPC on `/RPC3` of port 2121, so a user-defined interface reaches it, but no CCU-Jack was
available to verify that against]; and the extended set of device-specific editors (universal light
effects, RGBW/dual-white, alarm panel, the ESI energy meter, door locks).

[unreleased]: https://github.com/hobbyquaker/homematic-manager/compare/v3.0.0-beta.0...master
[3.0.0-beta.0]: https://github.com/hobbyquaker/homematic-manager/releases/tag/v3.0.0-beta.0
