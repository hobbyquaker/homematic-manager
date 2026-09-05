# Homematic Manager: state analysis and modernisation study

Written 2026-09-05. Research only, nothing was implemented. The plan derived from this document
is [ROADMAP.md](../ROADMAP.md). Sources: this repository, the sibling projects
[node-red-contrib-ccu](https://github.com/rdmtc/node-red-contrib-ccu) 4.3,
[hm2mqtt.js](https://github.com/hobbyquaker/hm2mqtt.js) 3.5, [RedMatic](https://github.com/rdmtc/RedMatic) 9,
[hm-simulator](https://github.com/hobbyquaker/hm-simulator) 0.1.1,
[ccu-addon-howto](https://github.com/homematic-community/ccu-addon-howto),
[OpenCCU-Base](https://github.com/OpenCCU/OpenCCU-Base) (WebUI sources) and
[openccu-data](https://github.com/SukramJ/openccu-data), plus the GitHub issue tracker of this repo.

Decisions the maintainer made while this was written (2026-09-05):

- **D-1** The CCU JSON-API is out. The app talks XML-RPC / BIN-RPC to the interface processes and,
  optionally, ReGa scripts. Nothing else.
- **D-2** ReGa is optional. It is used for friendly names (and later service-message acknowledgement
  in ReGa), never required. Systems without ReGa (Homegear, bare rfd/hmipserver setups) must work.
- **D-3** The UX stays. Same tabs, grids, dialogs and workflows; the implementation is replaced.
- **D-4** UI framework: Svelte 5. Current Electron. Comprehensive unit, integration and e2e tests
  with a near-100 % coverage target.
- **D-5** Two deliverables: the Electron desktop app (as today) and a CCU addon that integrates
  with the CCU WebUI.

## 1. Summary

- Version 2.7.1 (2023-01-28) is the last release; the last commit is a PR from 2024-07. 197 stars,
  26 forks, 53 open issues, 2 open PRs, 67 closed issues, 15 merged PRs, 418 commits since 2014.
- The code is two files: `main.js` (903 lines, Electron main process: RPC clients, RPC callback
  server, ReGa, caches) and `www/js/homematic-manager.js` (4886 lines, one jQuery/jqGrid renderer
  with `require()` access to Node). No module boundaries, no tests, dead CI (Travis, AppVeyor).
- Every dependency is 2018-2019 vintage. Electron 4.0.5 (2019-02, Chromium 69) cannot run on Apple
  Silicon natively, is unsigned on macOS, and the current Windows binaries reportedly do not start
  at all (#132, #133). free-jqgrid, instascan, jquery-ui-multiselect-widget, electron-ipc-rpc,
  persist-json and yalm are unmaintained.
- The most severe functional problem is the paramset write path: since 2019 every `putParamset`
  sends *all* editable parameters, and the multi-channel apply offers channels that merely share a
  channel *type*, not the same paramset description. Users have reported > 100 HmIP devices stuck in
  `CONFIG_PENDING` after such an operation (#98). Section 4 has the analysis and the fix.
- Everything needed for a modern rebuild already exists in the sibling projects: maintained
  `homematic-xmlrpc` 2.0, `binrpc` 4.2, `homematic-rega` 2.0, a tested value-casting module, a CCU
  simulator to build on, a complete CCU addon packaging pipeline (bundled Node runtime, Tcl CGIs,
  session check, container install test, GitHub Actions), and openccu-data, which turns the WebUI's
  Tcl easy modes, link profiles, parameter help and translations into JSON for 105 channel types.
- The estimate for the full programme (Electron 3.0 with feature parity, tests, CCU addon) is
  **93-138 person-days** for one experienced maintainer working with an AI agent, see the roadmap.
  The Electron-only part is 85-126 PD, the addon adds 8-12 PD on top of the shared backend.

## 2. The project today

| Fact | Value |
| --- | --- |
| Release | 2.7.1, 2023-01-28 (2.7.0: 2020-08-09) |
| Runtime | Electron 4.0.5 (2019-02-15), built with Node 12 (Travis) / Node 8 (AppVeyor) |
| Main process | `main.js`, 903 lines, callback style with `async` 2.x |
| Renderer | `www/js/homematic-manager.js`, 4886 lines; `www/index.html`, 387 lines; 326 lines CSS |
| UI libraries | jQuery 3.3.1, jQuery UI 1.12, free-jqgrid 4.15.5, ui-contextmenu, jquery-ui-multiselect-widget, instascan (QR) |
| Protocol libraries | homematic-xmlrpc 1.0.2, binrpc 3.3.1, homematic-rega 1.4, hm-discover 1.1.0 |
| Data shipped | `www/easymodes` 2.7 MB (293 JSON files converted from OCCU Tcl in 2015-2019, de/en/tr), `www/images` 34 MB (455 device images copied from a CCU), `stringtable.json` 90 KB, `rpcMethods.json` 31 KB (51 methods), `deviceImages.json`, `helpLinkParamset.json`, `language.json` (74 UI strings) |
| Tests | none (`npm test` exits 1) |
| CI | `.travis.yml` and `appveyor.yml` (both services dead for this repo) |
| Lint | xo 0.24 |
| Packaging | electron-builder 20: dmg, deb/tar.gz, nsis/portable, x64 only |

### 2.1 What the app does (feature inventory, to be preserved)

Tabs: Devices (grid with channel sub-grid, device images, flags, firmware update buttons, paramset
buttons per channel), Links (direct links grid, add/remove/edit, play short/long), RPC Console
(any of 51 methods with generated argument forms), Radio/"Funk" (interfaces grid, RSSI matrix,
`setBidcosInterface`/roaming), Service messages (list, acknowledge), Events (live XML-RPC events,
searchable, 8192 rows ring buffer).

Dialogs: paramset editor (MASTER/VALUES/SERVICE, multi-channel apply, `setValue` per datapoint,
help texts from stringtable), link paramset editor with easy-mode profiles and expert view, add
device (BidCos install mode, HmIP with key or QR scan), rename (local and ReGa), delete (flags),
replace device, add link (role matrix), service-message pop-ups, configuration (CCU address with
discovery, callback IP/port, TLS, auth, language, RPC delay, RPC log folder, cache reset).

Interfaces: BidCos-RF 2001, BidCos-Wired 2000, HmIP 2010, VirtualDevices 9292 `/groups`, CUxD 8701
(BIN-RPC), ReGa 8181 (names via `getChannels`, renames via script). Detection by TCP port probe at
start, TLS by adding 40000 to the port, basic auth. Persistent caches per CCU address: devices,
names, paramset descriptions (keyed by interface/device type/firmware/version/channel type/paramset).

## 3. Code and dependency assessment

### 3.1 Architecture as-is

```
Electron main (main.js)                          Renderer (www/, nodeIntegration on)
 ├ xmlrpc/binrpc clients per interface   IPC    ├ jQuery UI tabs + jqGrid + dialogs
 ├ xmlrpc + binrpc callback servers  <=======>  ├ builds HTML by string concatenation (119 places)
 ├ rpcProxy(): caching layer for             ├ ipcRpc.send('rpc', [iface, method, params])
 │   listDevices, paramset descriptions,     ├ easymodes/*.json loaded with $.getJSON
 │   rssiInfo, HmIP service messages         └ instascan QR scanner
 ├ ReGa: names on start, rename script
 ├ persist-json caches, config
 └ hm-discover, nextport, os.networkInterfaces
```

The renderer is a privileged Node process (`require('electron')`, `require('jquery')` in
`www/js/homematic-manager.js:4-19`). Modern Electron requires context isolation and a preload
script; the IPC layer (`electron-ipc-rpc`, unmaintained) has to be replaced anyway.

### 3.2 Dependencies

| Package | Used | Latest | Last publish | Assessment |
| --- | --- | --- | --- | --- |
| electron | 4.0.5 | 44.2.0 (2026-08-25) | monthly | 40 majors behind; new major every ~8 weeks, 3 supported |
| electron-builder | 20.40 | 26.15 | 2026-09 | fine, needs config rewrite (universal mac, arm64) |
| homematic-xmlrpc | 1.0.2 | 2.0.0 | 2026-08 | 2.0: `sax` only, server `close()` promise, used by nrccu/hm2mqtt |
| binrpc | 3.3.1 | 4.2.0 | 2026-09 | 4.x: zero deps, TCP frame reassembly fix, socket error handling |
| homematic-rega | ^1.4 | 2.0.0 | 2026-08 | 2.0: ESM, promises, no `request`; `getChannels()` kept |
| hm-discover | 1.1.0 | 1.1.3 | 2022 | nrccu vendored it; hm2mqtt has its own UDP 43439 discovery |
| free-jqgrid | 4.15.5 | 4.15.5 | 2022 | unmaintained (author died 2019) |
| jquery / jquery-ui-dist | 3.3.1 / 1.12 | 4.0 / 1.13 | 2026 / 2024 | to be removed |
| jquery-ui-multiselect-widget, ui-contextmenu | 2.0 / 1.18 | 3.0 / 1.18 | 2022 | to be removed |
| instascan | 1.0.0 | 1.0.0 | 2017 | unmaintained; replace by `@zxing/browser` |
| electron-ipc-rpc, persist-json, yalm, nextport | 2018 | same | 2022 | maintainer's own, superseded in the sibling projects |
| async | 2.6.2 | 3.2.6 | 2026 | not needed with promises |
| electron-is-dev, electron-unhandled, electron-window-state | old | 3.0 / 5.0 / 5.0 | 2024 | fine or trivial to replace |
| xo | 0.24 | 4.0 | 2026 | siblings moved to ESLint 9 + Prettier |

### 3.3 Code quality findings

- One 4886-line renderer file with ~120 HTML-by-string-concatenation sites, global mutable state
  (`daemon`, `config`, `names`, `indexChannels`, ...), jQuery selectors as the data model
  (`$('#grid-links tr#' + rowId + ' td[aria-describedby=...]').html()` to read a link's sender).
  Untestable without a browser and a CCU.
- Data objects returned by the CCU are mutated in place while rendering: `data[param] *= 100` for
  `100%` units, `desc[param].MIN = VALUE_LIST.indexOf(...)`, `desc[param].UNIT` fix-ups
  (`homematic-manager.js:1730-1760`, `3450-3480`). The mutated objects are later used as "previous
  value" (`data-val-prev`) and as the cached description.
- The main process mixes protocol handling, caching, persistence, ReGa and window management in one
  file; its `rpcProxy` special-cases five methods by name.
- Interface detection by TCP probing six ports on every start (`main.js:157-175`) with a 5 s
  timeout each; the UI waits for the result (`config-ready`). This is the root of the "endless
  loading" family of issues (#121, #126, #134, and the Windows reports).
- `config.useTLS` is passed to the interface clients but `config.useTls` (different case) to ReGa
  (`main.js:187` vs `main.js:207`): ReGa never uses TLS.
- `getRegaNames()` throws inside an async callback on any ReGa error or empty result
  (`main.js:853`, `:862`); with auth enabled this is the "401 Unauthorized" crash in #127. ReGa
  failure must never take the app down (D-2).
- `listBidcosInterfaces` result is dereferenced without a check (`main.js:319`, issue #93).
- ENUM selects are emitted with `data-type="INTEGER"` (`homematic-manager.js:1782`); the HmIP branch
  puts enum *names* into the option values, BidCos puts indexes. The write path then relies on
  `isNaN()` to decide whether to send a string or an int.
- `DISPLAY_INFORMATION` gets two hard-coded extra options outside `VALUE_LIST`
  (`homematic-manager.js:1805`).
- Renderer requests are serialised through a modal "RPC dialog" with a fixed `rpcDelay` of 3000 ms
  between calls (`main.js:47`, `homematic-manager.js:4619`); a multi-apply to 100 channels takes
  five minutes with a modal dialog open.
- `index.html` loads CSS from `../node_modules/...` (`www/index.html:7-10`), coupling the renderer
  to the packaged `node_modules` layout. Whether this is what broke 2.7.1 on Windows (#132, #133:
  "everything looks broken", package half the size of 2.7.0) is unverified.
- Translations: 74 UI strings in `language.json` with `de` only, English via key fallback;
  stringtable and easymode translations for de/en/tr. PR #130 (2021) adds a language setting.

### 3.4 Release and build state

- Travis (macOS + Linux) and AppVeyor (Windows) are dead. No GitHub Actions.
- macOS: unsigned, not notarised (#137: right-click to open), Intel only (#139). A user got 2.7.0
  running on an M4 with Electron 11 and reported a blank window (renderer breaks with newer
  Electron defaults).
- Windows: unsigned (#68), 2.7.1 reportedly does not start (#132, #133, last comment 2025-04).
- Linux: x64 deb/tar.gz only; arm builds requested (#115).

## 4. The paramset write path and `CONFIG_PENDING`

### 4.1 What the code does

`putParamset()` (`homematic-manager.js:2046-2119`) collects every enabled input of the paramset
dialog and sends **all** of them in one `putParamset` call. The "skip unchanged" branch is
commented out since commit `660711f` (2019-02-22, "always set all params of paramset"). The
link-paramset variant `putLinkParamset()` (`:2935-3011`) does the same for both link directions,
always.

Multi-channel apply: the dialog offers every channel with the same channel `TYPE` and the same
device/channel-ness (`homematic-manager.js:1860-1875`). It does **not** compare paramset
descriptions. The maintainer's comment in #98 ("multi-select is offered when the paramset
descriptions are equal") does not match the code. Channel types such as `SWITCH_VIRTUAL_RECEIVER`,
`DIMMER_VIRTUAL_RECEIVER`, `KEY_TRANSCEIVER` or `SHUTTER_CONTACT` exist on dozens of HmIP device
types with different `MASTER` parameter sets and different firmware versions. The reporter in #98
(pacco81) did exactly this: multi-selected mixed device types and ended with > 100 devices in
`CONFIG_PENDING`. The device rejects (or never acknowledges) parameters it does not have, the
interface process keeps the pending configuration, the flag sticks.

Value casting (`:2058-2110`, `:2960-3005`, and a third copy for `setValue` at `:1985-2020`):

- `FLOAT` becomes `{explicitDouble: parseFloat(val)}`; an empty or malformed field becomes `NaN`,
  which the XML-RPC encoder cannot represent (nrccu 4.0 fixed the same bug: "unparseable numbers
  become 0 instead of NaN, which XML-RPC cannot encode").
- `100%` units are divided by 100 before the type switch; an `INTEGER` with a `100%` unit is then
  `parseInt`ed (truncated).
- `ENUM` for HmIP sends the enum *name* string, for BidCos the index; whichever `isNaN()` decides.
- No range check against `MIN`/`MAX` beyond the HTML `min`/`max` attributes on number inputs;
  `FLOAT` and `STRING` are free-text inputs.
- Time parameters with base/factor encoding (`*_TIME_BASE`/`*_TIME_FACTOR`) are shown raw; #96
  reports "infinite" displayed as 111600 s where the CCU shows 16383000 s.

There is no preview, no confirmation, no per-parameter diff, no write log except the debug option
`rpcLogFolder` (`main.js:830-833`), which dumps every `putParamset` as JSON. That option is the
right forensic tool and should stay.

### 4.2 Why this matters more for HmIP

For BidCos-RF, `putParamset MASTER` on a battery device queues a config transfer until the device
wakes; `CONFIG_PENDING` until then is normal and clears by itself. For HmIP, hmipserver validates
against the device's paramset description; unknown or out-of-range parameters are the scenario
reported in #98 and the maintainer's own hypothesis ("CONFIG_PENDING is generated by crRFD, not
the device"). Recovery today is a backup restore or a factory reset per device.

A second report in #98 (maxbec, 2019-10) describes `STICKY_UNREACH` on all devices right after the
first connect from a new machine, then `CONFIG_PENDING` after re-pairing. Nothing in the code
explains that directly; the start-up sequence (init, listDevices answer from the local cache,
`getParamset(:0, VALUES)` per HmIP device for RSSI, `rssiInfo`) only reads. It has to be reproduced
in the lab before it can be ruled out.

### 4.3 The fix (roadmap task 6)

1. Write only changed parameters by default; "write all" is an explicit option per dialog.
2. Cast and validate every value against its description in one shared, unit-tested module (port of
   node-red-contrib-ccu's `nodes/lib/cast.js`, extended with range and `VALUE_LIST` checks, base/
   factor time helpers and `100%` units). Never emit `NaN`; never emit a parameter that is not in
   the description or not writeable (`OPERATIONS & 2`).
3. Multi-channel apply only across channels whose paramset description *identity* is equal. The
   identity key already exists: `paramsetName()` in `main.js:660-673` builds
   `interface/deviceType/firmware/version/channelType/paramset` for the description cache.
4. A preview dialog listing exactly the parameters and values that will be sent per channel,
   with the RPC call shown, before anything is written. Writes go through a queue with a
   configurable pace (default well above today's 3 s for bulk operations to HmIP).
5. Every write is logged (method, params, result, duration) into a session log the user can export;
   the `rpcLogFolder` option stays.
6. Lab study on the test systems: provoke a bad `putParamset` deliberately on the HmIPW-DRS8
   (charly) and the HmIP-PDT (openccu), record what hmipserver reports (`getServiceMessages`,
   `CONFIG_PENDING` events, `getParamset MASTER` afterwards), and document the recovery that works
   (re-writing a valid full paramset, `clearConfigCache`, `restoreConfigToDevice` for BidCos).
   Turn the recovery into a "repair configuration" action in the device context menu.
7. Regression tests against the simulator with `CONFIG_PENDING` semantics (task 5).

## 5. What the sibling projects contribute

### 5.1 node-red-contrib-ccu 4.x

- `nodes/lib/cast.js`: pure value casting against a paramset description (BOOL/ACTION/FLOAT with
  `explicitDouble`/ENUM by `VALUE_LIST`/INTEGER/STRING, optional MIN/MAX clamping), unit-tested.
  Direct reuse for the core package.
- `paramsets.json`: 962 paramset descriptions from real firmware (3.87.6 and 3.89.8, 70 device
  type/firmware combinations, BidCos-RF/Wired/HmIP/groups) and the tools `tools/paramsets-fetch.js`
  (live fetch with throttling) and `paramsets-join.js`. Ideal test fixtures for the paramset editor
  and for the simulator.
- Local-CCU detection by probing the direct interface ports (32001/32000/32010/39292, ReGa 8183),
  which the addon variant needs.
- Tooling and CI that the maintainer already accepted: ESLint 9 + Prettier, GitHub Actions matrix
  (Node 22/24), release workflow with OIDC npm publishing and generated release notes
  (`.github/release-notes.js`), roadmap conventions (stable task numbers, `roadmap-archive/`).
- Its changelog documents pitfalls that apply here too: the CCU sends enum names in `VALUE_LIST`
  (never `ENUM`), `!(OPERATIONS) && 2` style writeable checks that never fire, and binrpc frame
  reassembly.

### 5.2 hm2mqtt.js 3.x

- A complete CCU addon pipeline for a Node.js program: `addon/build.sh` (per-arch package),
  `addon/build-runtime.sh` (musl Node 24 from Alpine, `patchelf`, ICU), `update_script`, rc.d
  script, monit config, `bin/update_addon` (tclsh, Systemsteuerung button), Tcl CGIs with the
  session check (`lib/session.tcl`), `update_check.cgi`, a **Svelte 5 + Vite single-file
  settings UI** (`addon/ui`), container package test (`addon/test/package-test.sh`), CGI test with
  a Tcl stub, and the `addon-runtime.yml` workflow building armv7l/aarch64/x86_64 on GitHub
  Actions. Everything the addon variant needs, proven on the three lab systems.
- `lib/interfaces.js`: the interface table (public, TLS and local ports, protocol, init/ping
  behaviour, `HmIP-RF` 600 s ping timeout), local-mode detection, UDP discovery on 43439
  (`--discover`) replacing `hm-discover`.
- e2e test pattern: hm-simulator (rfd binrpc, hmip xmlrpc, ReGa mock) started in-process, the
  program under test connected to it, assertions on RPC traffic.

### 5.3 hm-simulator 0.1.1

Last change 2019. Implements `init`, `listDevices` (outgoing), `getParamsetDescription`, `ping`,
`setValue`, events via behaviour scripts, a ReGa mock on 8181, and ships 8.4 MB of paramset
descriptions plus HmIP/rfd device lists. Missing for this project: `getParamset`/`putParamset` with
MASTER/LINK/VALUES storage and `CONFIG_PENDING` semantics, `getLinks`/`addLink`/`removeLink`/
`getLinkInfo`/`setLinkInfo`/`activateLinkParamset`, `rssiInfo`, `listBidcosInterfaces`/
`setBidcosInterface`, `getServiceMessages`, install mode with `newDevices`, `deleteDevice`/
`replaceDevice`, `reportValueUsage`, `getDeviceDescription`, `system.methodHelp`, error responses
(fault codes) for invalid calls, VirtualDevices and CUxD servers, TLS and basic auth. Both sibling
projects would profit from a 1.0; it is a shared asset (roadmap task 5).

### 5.4 ccu-addon-howto and RedMatic

The handbook covers package layout, `update_script` exit codes, the CCU3 chroot install at reboot
versus OpenCCU's live install, the rc.d `info` contract, `hm_addons.cfg`, lighttpd (`/addons/`
pass-through, `.cgi` via tclsh, proxy rules for own HTTP servers), the CCU session check through
`tclrega.so`, Tcl 8.2 pitfalls, self-contained musl binaries, `.nobackup`, monit, the container
e2e replay, the hardware checklist, roadmap conventions and an `AGENTS.md` template. RedMatic adds
the lighttpd proxy configuration for a Node HTTP server behind `/addons/<name>/` and the
self-update worker.

## 6. OpenCCU-Base WebUI and openccu-data: easy modes and device-specific UI

### 6.1 What the WebUI has

`www/config/easymodes/` in OpenCCU-Base holds 2832 files:

- 66 receiver-type directories with one Tcl profile file per sender type (link easy modes), 28 of
  which this project converted in 2015-2019. Missing here: every HmIP receiver
  (`*_VIRTUAL_RECEIVER`, `HEATING_*`, `DOOR_*`, `UNIVERSAL_LIGHT_RECEIVER_*`, `JALOUSIE`, ...),
  which is issue #50.
- 142 HmIP channel-type files under `easymodes/hmip/` plus `etc/hmipChannelConfigDialogs.tcl`
  (8310 lines, ~50 procedures such as `getBlindTransmitter`, `getHeatingClimateControlTransceiver`,
  `getEnergieMeterTransmitterESI`): the device- and channel-specific MASTER dialogs.
- ~80 `*_ch_master.tcl` / `*_ch_link.tcl` files for BidCos channel types, `MASTER_LANG/` (16 help
  files), `js/` (16 device-specific behaviours: HmIP weekly programs, blind auto-calibration, RGBW
  controller, dual-white, air quality, repeater, ...).
- `ic_deviceparameters.cgi` (1462 lines) is the page that sources them; it is procedural Tcl
  emitting HTML, not data.
- `www/config/img/devices/` (593 images), `devdescr/DEVDB.tcl`, `stringtable_de.txt`,
  `webui/js/lang/{de,en}/translate.lang.*.js` (parameter names, values, help, channel and device
  descriptions).

License: OpenCCU-Base publishes `www/` under the Homematic Software License 2.0 (free for private
and non-commercial use). The easy modes, stringtable and images this project ships are already
derived from it; the new data pipeline must keep the same notice and keep the data outside the
GPLv3 code (as openccu-data does with its `NOTICE.md`).

### 6.2 What openccu-data already extracted

openccu-data (MIT code, HMSL 2.0 data, releases `2026.7.2`, used by aiohomematic / Home Assistant)
parses exactly these Tcl and JS files into JSON:

| Artifact | Content | Use here |
| --- | --- | --- |
| `easymode_extract.json.gz` (5.6 MB raw) | `channel_metadata` for 105 channel types: 54 with `_MASTER` metadata (`parameter_order`, `conditional_visibility`, `option_presets` per parameter), 65 with link profiles per sender type (`profiles[]` with `params` as `fixed`/`list`/`range` constraints); 85 `option_presets` (e.g. `DELAY`: none/5s/.../1h + custom); 5 `cross_validations` rules (`DIM_MAX_LEVEL >= DIM_MIN_LEVEL`, ...) | the generic paramset editor's metadata layer and the easy-mode engine |
| `profiles/<RECEIVER>.json.gz` (66 receivers) + `_receiver_type_aliases.json` | per sender type: profile list with `name`/`description` in de+en and parameter constraints; aliases `OPTICAL_SIGNAL_RECEIVER -> DIMMER_VIRTUAL_RECEIVER` etc. | replaces `www/easymodes/*` and `tools/convert_easymodes.js`, closes #50 and #22 |
| `translation_extract.json.gz` | de+en: 234 channel types, 373 device models, 1843 parameter names, 1851 parameter values, 167 parameter help texts, 5455 UI labels, 535 device icon mappings | replaces `stringtable.json`, `helpLinkParamset.json`, `deviceImages.json`; gives English (#119, PR #130) |

What openccu-data cannot give: the procedural dialogs (weekly program tables, calibration wizards,
effect editors). Those need hand-written editors; the metadata layer (order, visibility, presets,
validation, help) covers the generic case for every channel type.

Caveat from openccu-data's `DATA_SOURCES.md`: until OpenCCU folds its 131 WebUI patches into
OpenCCU-Base, the committed artifacts (merged from a running CCU) are more accurate than a fresh
extraction from OpenCCU-Base. Pin a released artifact version and update deliberately.

### 6.3 Device images

34 MB of `www/images` (455 files) is the largest part of the repository and of every build. The
images are HMSL-licensed copies from a CCU. Options for the new build: ship a compressed subset
(webp, ~5 MB), fetch `/config/img/devices/<size>/<name>` from the connected CCU at runtime with a
local cache (Homegear users get a placeholder), or both. The addon variant needs none: the CCU
serves them. Open question OQ-4 in the roadmap.

## 7. Target architecture

Monorepo (npm workspaces) in this repository, TypeScript throughout, ESM:

```
packages/core       pure domain logic, no I/O, no DOM               unit tests, 100 %
  interfaces table, address/channel model, device index, paramset description model,
  cast/validate (from nrccu cast.js), paramset diff, time base/factor, units,
  easy-mode/profile engine on openccu-data, link role matrix, service-message model,
  RSSI model, i18n (de/en), RPC method catalogue (rpcMethods.json + methodHelp)
packages/backend    Node: protocol and state                         unit + simulator tests
  xmlrpc/binrpc clients (TLS, auth), callback servers, init/ping/re-init, event bus,
  caches (devices, descriptions, RSSI, service messages) with persistence, optional ReGa
  (names, rename, later acks), UDP discovery, write queue with pacing and log,
  a transport-agnostic API (typed request/response + event stream)
packages/ui         Svelte 5 components and stores                    component + e2e tests
  talks to `Transport` (Electron IPC | WebSocket); same tabs/dialogs as today
apps/electron       electron-vite: main (backend + preload + IPC transport), renderer (ui)
apps/web            backend as local HTTP/WS server + ui in a browser: dev mode and the
                    fast e2e target; also what runs on the CCU
apps/ccu-addon      package build (hm2mqtt pattern): bundled Node, rc.d, monit, CGIs with
                    session check, lighttpd proxy to the backend, ui as static files
data/               openccu-data artifacts (pinned), converter script, HMSL notice
```

The renderer never gets Node access. Electron main hosts the backend in-process; the CCU addon runs
the same backend as a service. The `Transport` interface is the only difference the UI sees.

## 8. Variant study: Electron app and CCU addon

### 8.1 Electron (desktop)

Feasible without reservation. Electron 44 (Chromium 148 class) with electron-vite 5, Svelte 5 and
Vite 8; electron-builder 26 for macOS universal dmg, Windows x64/arm64 nsis + portable, Linux
x64/arm64/armv7l deb + AppImage (closes #115, #139). Electron majors ship every ~8 weeks with
three supported at a time: plan a quarterly bump. Code signing is a decision (OQ-3): Apple
Developer ID (notarisation, ~99 USD/year) removes the right-click dance (#137); Windows signing via
SignPath (free for OSS) or Azure Trusted Signing removes SmartScreen warnings (#68). Without them
the README documents the workarounds. QR scanning moves from instascan to `@zxing/browser` on
`getUserMedia`.

### 8.2 CCU addon (Node backend on the CCU)

Feasible; all mechanisms exist and are verified on the three lab systems by hm2mqtt.js and RedMatic:

- Package per architecture (armv7l for the CCU3 and 32-bit OpenCCU, aarch64, x86_64) with a
  bundled musl Node 24 (~35-45 MB installed; the CCU3's `/usr/local` has 96k inodes, so
  `node_modules` must stay small: the backend needs only `homematic-xmlrpc`, `binrpc`,
  `homematic-rega` and a WebSocket library; the UI is a single built file; no images shipped).
- The backend runs as an rc.d service under monit, binds to 127.0.0.1, and talks to the interface
  processes directly: BidCos-RF binrpc 32001, BidCos-Wired binrpc 32000, hmipserver xmlrpc 32010,
  VirtualDevices 39292 `/groups`, CUxD 8701, ReGa 8183. No CCU auth, no firewall rules, no
  callback problems: the callback server is local too.
- The UI is served through lighttpd under `/addons/hmm/`: `settings.cgi` validates the WebUI
  session (`tclrega.so`, `system.GetSessionVarStr`), hands the browser a short-lived token, and a
  lighttpd proxy rule forwards `/addons/hmm/api/` and the WebSocket to the backend, which checks
  the token. The Systemsteuerung button comes from `hm_addons.cfg` via the tclsh `update_addon`.
- Differences to the desktop app: no discovery/configuration dialog (the CCU is localhost), no
  window state, images from the CCU's own `/config/img/devices/`, German-first UI (WebUI
  convention), CCU3 reboot-time install versus OpenCCU live install, Tcl 8.2 on the CCU3 for the
  CGIs, the container install replay in CI, hardware checks on all three boxes per release.
- A variant without a Node backend on the CCU (static UI on the CCU JSON-API) was considered and
  rejected by D-1 on 2026-09-05.

### 8.3 Effort comparison

| | Electron only | Electron + CCU addon |
| --- | --- | --- |
| Shared (core, backend, ui, simulator, tests, data, docs, beta) | 78-115 PD | 78-115 PD |
| Electron host, builds, signing, release workflow | 5-8 PD | 5-8 PD |
| Web host (dev/e2e) | 2-3 PD | 2-3 PD |
| CCU addon package, service, CGIs, proxy, container test, lab installs | - | 8-12 PD |
| **Total** | **85-126 PD** | **93-138 PD** |

The addon is cheap *because* the web host is needed for the e2e strategy anyway and because the
packaging is copied from hm2mqtt.js. Details and per-task numbers are in the roadmap.

## 9. Test strategy and the lab

| Layer | Tool | Target | Runs |
| --- | --- | --- | --- |
| Unit: core | vitest, `@vitest/coverage-v8` | 100 % lines/branches, enforced per file | every push |
| Unit: backend | vitest, socket-level mocks | ≥ 95 % | every push |
| Integration: backend against hm-simulator 1.0 | vitest, simulator in-process (rfd binrpc, hmipserver xmlrpc, VirtualDevices, CUxD, ReGa mock, TLS/auth) | every RPC method the app uses, init/ping/re-init, events, `CONFIG_PENDING` semantics, caches, write queue | every push |
| Component: ui | vitest browser mode (Playwright provider) + `@testing-library/svelte` | every component and store, ≥ 95 % | every push |
| e2e: web host + simulator | Playwright | every user workflow of section 2.1, coverage merged via v8 | every push |
| e2e: Electron | Playwright `_electron` | cold start, config dialog, one workflow per tab | matrix macOS/Windows/Linux, every push |
| Package: addon | container replay of `install_addon` (busybox sh, tclsh, lighttpd stub) | install, update, uninstall, session check, proxy | every push |
| Hardware | Playwright against the lab CCUs, ssh checklist | install on CCU3 fw + OpenCCU x86 + OpenCCU aarch64; write-path study on real HmIP/HmIPW devices | before each release, manually or nightly from WSL |

Lab (see the private hand-over note `../redmatic-lab.md`, credentials stay out of the repo):
CCU3 firmware 3.89.8 on a Charly with HmIPW-DRAP/DRI16/DRS8 (wired, relays audible), OpenCCU
3.89.8 x86_64 with HmIP-WRC2 and HmIP-PDT, OpenCCU aarch64 without radio (install and UI checks
only), all with ssh and the JSON-API login for scripted session handling, WSL -> CCU open, CCU ->
WSL blocked (so callback servers for hardware tests must run on a CCU or on the `mqtt-ifaces` box;
the addon variant has no such problem). Gaps: **no BidCos-RF or BidCos-Wired device in the lab**;
the production CCU3 (3.87.6) may be read slowly (client calls only, no init) for BidCos paramset
fixtures. Recommendation: two cheap BidCos-RF devices for the Charly (roadmap OQ-8).

Near-100 % is realistic for `core` and `backend`. For the Svelte UI the honest target is ≥ 95 %
from component tests plus e2e coverage merged in; the remaining lines are browser-API glue.

## 10. Issue and PR triage

Categories: **R** resolved by the rebuild (close when 3.0 ships, referencing the task), **F**
feature to schedule, **Q** question to answer and close, **O** obsolete or not reproducible, **X**
out of scope.

| # | Title (short) | Cat. | Disposition |
| --- | --- | --- | --- |
| 139 | Apple Silicon build | R | task 11 (universal dmg) |
| 137 | macOS Sonoma: does not open | R | task 11 / OQ-3 signing; README workaround meanwhile |
| 136 | RPC console loses `device:channel` in getValue | R | task 8 (console with generated forms, #27) |
| 135 | CCU-Jack devices | F | task 4: user-defined extra interfaces (name, host, port, protocol, path); CCU-Jack's virtual devices publish an RPC interface, to verify |
| 134 | CCU3: endless loading (macOS) | R | #121 family, task 4/7 |
| 133, 132 | 2.7.1 does not start on Windows 10/11 | R | task 11 (no stopgap release, D-7) |
| 129 | What is in the Events tab | Q | answer (XML-RPC `event` calls from the interface; a device that shows up often does send often; useful for duty-cycle hunting) and add per-device event counters (task 15) |
| 128 | CUxD / VirtualDevices not shown | R | task 4: explicit interface configuration instead of port probing only; verify CUxD binrpc in the simulator and with a real CUxD |
| 127 | Big Sur: 401 from ReGa crashes app | R | task 4 (ReGa optional, errors non-fatal, TLS flag typo) |
| 126 | TypeError on start | R | duplicate of #121 |
| 124 | Edit several links, apply once | F | task 15 (staged changes with one Apply) |
| 123 | HVL addon devices | F | same mechanism as #135 (extra interface) |
| 122 | Roaming vs active interface | Q/F | answered 2019; UI: no interface marked active while roaming (task 8) |
| 121 | Endless loading (33 comments) | R | task 4/7 ready handshake; e2e cold-start test (task 14) |
| 119 | English UI | R | task 7 i18n de/en (openccu-data + own strings) |
| 115 | arm builds | R | task 11 (linux arm64/armv7l) |
| 113 | Auto-refresh update status on event | F | task 8 |
| 112 | QR scanner works only once | R | task 8 (new scanner) |
| 106 | Homegear TLS + auth | R | task 4 (per-interface host/port/TLS/auth) |
| 105 | Expert parameters not shown immediately | R | task 8 link editor |
| 102 | Success pop-up only on error / configurable | F | task 8 (quiet mode, RPC log panel instead of modal) |
| 100 | Week-program editor for thermostats (Max!/Homegear) | F | task 10 |
| 98 | `CONFIG_PENDING` after multi-apply | R | **task 6**, highest priority |
| 97 | Sec-SD-2 smoke detector groups | Q/F | teams via `listTeams`/`setTeam`; small team UI (task 15) |
| 96 | "infinite" shown as 111600 s; expert profile empty | R | task 3 (base/factor time model), task 8 |
| 95 | Available firmware not shown | R | task 4/8 (`AVAILABLE_FIRMWARE` from `listDevices`, cache invalidation) |
| 94 | Acknowledge service messages in ReGa too | F | task 15 (ReGa script, optional) |
| 93 | Sporadic exception on start (`listBidcosInterfaces`) | R | task 4 |
| 90 | Exception on "install update" | R | task 8 |
| 87 | Names/descriptions per pair in multi-links | F | task 15 |
| 82 | Link name in wrong place | R | task 8 |
| 80 | Multi-delete links | F | task 15 |
| 79 | Show defective links like the WebUI | F | task 15 (link `FLAGS`/`getLinkInfo`) |
| 77 | `_focusTabbable` exception | R | task 7 (no jQuery UI dialogs) |
| 69 | Auto-assign best interface by RSSI | F | task 15 |
| 68 | Windows code signing | Q | OQ-3 |
| 66 | Changelog from commits | R | task 11 (release notes script) |
| 60 | Homegear: app hangs after parameter change (2018 beta) | O | close, ask to retest with 3.0 |
| 59 | Homegear `setInterface` / roaming | O | answered 2018, close |
| 54 | Auto-confirm new devices in ReGa inbox | F | task 15 (ReGa optional) |
| 50 | HmIP link easy modes | R | task 9 (openccu-data profiles for all HmIP receivers) |
| 41 | Rename not stored in Homegear | F | task 15: use Homegear's `setName` RPC when `system.listMethods` lists it |
| 29, 28 | i18n plural/printf, split language files | R | task 7 |
| 27 | Console: dynamic fields for putParamset | F | task 8 |
| 26 | Auto-ack `STICKY_UNREACH`, unreach counter | F | task 15 |
| 25 | Show/create links from the Devices tab | F | task 15 |
| 24 | Name a device right after pairing | F | task 8 |
| 22 | WINMATIC easy modes | R | task 9 (present in openccu-data) |
| 21 | Link profile templates | F | task 15 |
| 20 | BidCos pairing with temporary key | F | task 8 (`setTempKey` exists) |
| 18 | Multi-channel `reportValueUsage` | F | task 8 (PR #138 intent) |
| PR 130 | Language setting + translations (2021, mergeable) | - | fold into task 7; thank the author and close when 3.0 ships |
| PR 138 | Shift-select + multi `reportValueUsage` (2024) | - | fold into task 8; same handling |

## 11. Open decisions

OQ-1 to OQ-11 were asked and answered on 2026-09-05; the answers are decisions D-7 to D-17 in
[ROADMAP.md](../ROADMAP.md).
