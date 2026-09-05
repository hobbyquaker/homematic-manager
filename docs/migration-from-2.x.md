# Coming from Homematic Manager 2.x

Homematic Manager 3.0 is a rebuild, not an upgrade of the 2.7.1 code: a tested TypeScript core, a
Svelte 5 user interface, a Node backend that also runs as a server and as a CCU addon. The tabs, the
grids, the dialogs and the workflows are deliberately the same (D-3) — what changed is underneath,
and in a handful of places the behaviour changed on purpose.

This page is what a 2.x user needs to know: where the old configuration is, what is taken over,
what is not, and which of the old annoyances are gone.

Contents: [Where 2.x kept its files](#where-2x-kept-its-files) ·
[The one-time import](#the-one-time-import-d-17) ·
[What changed on purpose](#what-changed-on-purpose) ·
[What got fixed](#what-got-fixed) · [What is still missing](#what-is-still-missing) ·
[Known limitations](#known-limitations)

## Where 2.x kept its files

2.x stored its configuration with `persist-json@1.2.0` under the name `hm-manager`, and that package
resolves its directory through `persist-path`:

| Platform | Directory |
| --- | --- |
| Windows | `%APPDATA%\hm-manager\` |
| macOS | `~/Library/Preferences/hm-manager/` |
| anything else | `~/.hm-manager/` |

(`%APPDATA%` wins wherever it is set, which is why the table is ordered that way rather than by
platform.)

The configuration file in there is named after the key `pjson.load('config')`, so it is literally
**`config`, without an extension**. 3.0 reads both `config` and `config.json`, the extension-less one
first, because that is what 2.7.1 actually wrote.

Next to it sat the caches, one file per CCU: `devices_<ccu>`, `names_<ccu>` and
`paramset-descriptions-v2_<ccu>`. Those are **not** imported and are never touched.

3.0 keeps its own profile somewhere else entirely, so the two installations do not collide — see
[moving-between-installs.md](moving-between-installs.md) for the table. On a desktop machine it is
`%APPDATA%\Homematic Manager\`, `~/Library/Application Support/Homematic Manager/` or
`~/.config/Homematic Manager/`.

## The one-time import (D-17)

**On the very first start** — that is, when there is no `config.json` in 3.0's own profile directory
yet — the backend looks for the 2.x configuration and takes over:

| 2.x field | becomes | Note |
| --- | --- | --- |
| `ccuAddress` | `connection.host` | trimmed; if it is empty, nothing is imported at all |
| `useTLS` | `connection.tls` | |
| `useAuth`, `user`, `pass` | `connection.auth` | only when `useAuth` was true and a user name was set |
| `language` | `connection.language` | only `de` or `en` |
| `rpcDelay` | `connection.writePaceMs` | the pause between two writes, per interface |
| `rpcLogFolder` | `connection.rpcLogFolder` | the directory for the `putParamset` JSON dumps |
| `rpcInitIp` | `connection.callback.ip` | the address the interfaces call back to |

Everything else is dropped on purpose: the probed `daemons` list (3.0 configures interfaces
explicitly and probes in the background), the window state, `showUnhandled`, and the caches.

The import happens **once**, and the UI says so with a notice. **2.x is left completely untouched**
and keeps working, so you can go back at any time — just not against the same CCU at the same time
as 3.0 (see [below](#running-both)).

The import runs wherever the backend starts and finds a 2.x directory. In practice that is the
desktop app, and a server install on the machine you used to run 2.x on; a CCU addon or a container
has no such directory and simply starts empty.

### The caches are discarded, deliberately

2.x's device, name and paramset-description caches are not carried over. They were keyed
differently, they went stale silently — several of the "endless loading" and "wrong parameters"
reports come from a cache that no longer matched the CCU — and a fresh read from the CCU takes
seconds. 3.0's own caches are keyed by description identity (interface, device type, firmware,
version, channel type, paramset), are written atomically through a temporary file and a rename, and
sit in `cache/<host>/` per CCU so two CCUs can never mix.

### If nothing was imported

Either there was no 2.x configuration where it was looked for, or it had no CCU address (importing
an empty host would only hide the setup dialog). Configure the CCU in the settings dialog; the
discovery button finds CCUs on the same subnet over UDP.

### Running both

Don't run 2.x and 3.0 against the same CCU at the same time. Every interface process keeps a list of
event subscribers and a second `init` with the same identifier replaces the first registration, so
the two will take the event stream from each other in turn and both will look half-alive. Stop one,
start the other.

## What changed on purpose

### Writes send only what changed (#98)

This is the important one. 2.x's paramset editor sent whole paramsets, and "apply to several
channels" matched channels by their channel **TYPE**. `MAINTENANCE` has 23, 21 or 9 MASTER
parameters depending on the device, so applying one device's MAINTENANCE paramset to another's sent
parameters the target had never heard of.

What that does was measured on hardware (the full study is [config-pending.md](config-pending.md)):
**hmipserver stores every entry of a `putParamset` before it validates any of them.** An unknown
parameter is persisted in the device file, survives a restart, and makes every later `putParamset`
on that channel fault — even an empty one. Nothing in the RPC API removes it. 2.x's multi-apply
therefore destroyed channels irreversibly.

3.0:

- sends **only changed, validated parameters**, and shows a preview of the exact
  `putParamset(address, paramset, struct)` before every write, with a reason for each parameter it
  dropped;
- offers multi-apply **only to channels with an identical paramset description**, and disables the
  rest with the reason written next to them;
- **reads back after every write**, because `rfd` answers `ok` to writes it silently ignored (a
  FLOAT sent as a plain integer) or clamped (an INTEGER above `MAX`);
- distinguishes the two meanings of `CONFIG_PENDING` — a BidCos device that has a queued
  configuration and will take it at its next wake-up, versus an HmIP channel that rejected
  something — and offers the repair action only for the second;
- has `devices.repairConfig`, which dry-runs first, lists what it can correct, offers the
  BidCos-only recoveries (`clearConfigCache`, `restoreConfigToDevice`, `determineParameter`, which
  all answer `-1` on hmipserver) and says plainly when a channel is beyond repair and needs
  re-pairing.

### No BIN-RPC off the CCU (D-28)

2.x could be told to prefer BIN-RPC. That option is gone, and the settings dialog has no protocol
choice any more. The reason is that **no CCU listens for BIN-RPC on the LAN**: `rfd` and `hs485d`
take BIN-RPC on 32001/32000 on the loopback, and the public ports 2001/2000 (and 42001/42000) are
lighttpd's XML-RPC proxies. Verified on a stock CCU — port 32001 is firewalled to local only.

So off the CCU every built-in interface speaks XML-RPC. BIN-RPC is used by the CCU addon in local
mode, and for CUxD, which is its own daemon with its own BIN-RPC listener on 8701 (2.x did the same).
A user-defined interface (D-13) may still declare `binrpc` for a non-CCU peer.

### ReGa is optional (D-2)

The CCU's logic layer supplies the friendly names. In 3.0 it is strictly optional: a system without
ReGa — Homegear, a bare `rfd`/`hmipserver`, or a CCU whose Homematic-Script API is firewalled — works
**fully**, using locally stored names, and shows a status indicator saying so. A ReGa failure is
never fatal and never throws into the UI; in 2.x a 401 from ReGa on Big Sur crashed the app (#127).

### ENUMs are sent as their index

2.x sent enum values partly by name. Measured in the lab: both `rfd` and `hmipserver` accept both
encodings and both **read back the index**, so 3.0 sends the index everywhere. The practical effect
is that an enum parameter no longer looks changed on every single write, which is what kept
unnecessary parameters in the payload.

### The HVL addon is not supported (D-19)

Issue #123 asked for HVL devices. The HVL project is dead, and 3.0 does not support it. The issue is
closed with that note.

### No Homegear-specific code (D-20)

Homegear keeps working through the generic XML-RPC path wherever it behaves like a CCU — per-interface
host, port, TLS and authentication are configurable (#106), and a user-defined interface (D-13) can
be pointed at anything that speaks XML-RPC. What is gone is Homegear-*specific* work: the `setName`
special case of #41 is dropped, and #41, #59, #60, #100 and #106 are closed with that note. Checked
on 2026-09-05: Homegear's last release is 0.7.40 from 2019, the project gets build-system commits but
little else.

Where a Homegear request turned out to be a general gap it was filled generally: the thermostat week
programme of #100 is one of the five device-specific editors, and the `TIMEOUT`/`TEMPERATUR` shape
with 24 slots that a Max! thermostat answers through Homegear is one of the four naming shapes that
editor recognises — recognised from the paramset description, not from who is answering.

### Smaller behavioural changes

- **A configuration change no longer restarts the app.** 2.x saved the file, called `app.relaunch()`
  and killed the process. The backend reconnects instead; the RPC log and the open tab survive.
- **Quitting waits for the backend** to de-register its callbacks at the interface processes,
  bounded to eight seconds, instead of racing a 15 s timer against `process.exit(0)`.
- **Success pop-ups are gone** (#77, #102): writes report through toasts and an RPC log drawer, and
  there is a persisted quiet mode that turns the toasts off.
- **Dark mode** follows the OS setting by default, with a manual switch that is remembered (D-22).
- **Cut, copy and paste work on Windows and Linux.** 2.x built its Edit menu from macOS-only
  `selector:` strings, so those three items did nothing anywhere else.
- **There is a View menu** (reload, developer tools, zoom) and a Help menu with the issue tracker and
  the log folder.
- **Unhandled errors are always logged**, not only when `showUnhandled` was set — and the dialog
  appears once, not once per error.
- **The device metadata is new.** Easy-mode profiles, translations, help texts and device images come
  from pinned [openccu-data](https://github.com/SukramJ/openccu-data) artifacts instead of the 2015
  conversion in `legacy/www/easymodes`. No receiver type and no sender combination was lost against
  2.x; 832 of 837 shared profiles are parameter-identical, and 10 profiles, 1 parameter and 4 fixed
  values differ because the CCU's own data moved on since 2015.

## What got fixed

Grouped by what a user notices; the issue numbers are the ones each answers.

| Area | Change | Issues |
| --- | --- | --- |
| Startup | The endless "loading" on a slow or partly reachable CCU is gone: the interface manager has an init/ping/re-init handshake, and the port probe runs in the background and never blocks the UI | #121, #126, #134, #93 |
| Startup | 2.7.1 not starting on Windows 10/11 is answered by the new Electron host, not by a 2.x fix | #132, #133 |
| Platforms | Apple Silicon (universal build), arm64 Linux; **32-bit ARM desktop builds are gone** — Electron 44 has no `linux-armv7l` binary. Use the CCU addon or the npm package there | #139, #115 |
| Platforms | macOS Sonoma "does not open" is answered by the new build; signing and notarisation are in the workflows and wait on the Apple/SignPath side | #137, #68 |
| Language | The whole UI is German **and** English, with plurals and interpolation, switchable at runtime | #119, #29, #28, PR #130 |
| Devices | The firmware column's update button really disappears when the update has arrived | #95, #113 |
| Devices | Name a device right after it pairs | #24 |
| Devices | BidCos pairing with a temporary key | #20 |
| Devices | `reportValueUsage` over a whole selection of channels | #18, PR #138 |
| Devices | CUxD and VirtualDevices are configured explicitly instead of only being port-probed | #128 |
| Paramsets | "Not used"/"infinite" comes from the parameter's own `SPECIAL` entry instead of the hard-coded 111600 s, which was the BidCos-RF value and wrong everywhere else | #96 |
| Paramsets | Expert parameters show immediately in the link editor | #105 |
| Links | HmIP link easy modes for every HmIP receiver, and WINMATIC | #50, #22 |
| Links | Defective links are marked as the WebUI marks them | #79 |
| Links | Several links removed in one action | #80 |
| Links | The link name is where it belongs | #82 |
| Radio | Roaming: no interface is falsely marked active, and the assignment is read out of the device's own `INTERFACE` and re-read after `setBidcosInterface` | #122 |
| Radio | "Heard best by" per device | #69 |
| Console | Generated argument forms — struct rows for a paramset, bit fields, value lists — so `device:channel` is not lost and `putParamset` is usable at all | #27, #136 |
| Add device | The QR scanner works more than once | #112 |
| Service messages | Toasts instead of the modal pop-up, and a persisted quiet mode | #77, #102 |
| Events | A per-device event counter, useful for duty-cycle hunting | #129 |
| Updates | The "install update" exception is gone; the updater downloads and installs nothing without being asked | #90 |
| Releases | Release notes are generated from the commits | #66 |

Issues #60 and #59 (Homegear, 2018) are closed as obsolete with an ask to retest against 3.0.

## What is still missing

Planned but not in this rebuild yet:

- staged changes across several links with one Apply (#124);
- names and descriptions per pair in a multi-link (#87);
- automatic `STICKY_UNREACH` acknowledgement and unreach counters (#26);
- creating and showing links from the Devices tab (#25);
- link profile templates (#21);
- ReGa inbox auto-confirm (#54) and service-message acknowledgement in ReGa (#94) — both need ReGa,
  which is optional, so both have to degrade;
- smoke-detector teams (#97);
- automatic best-interface assignment (#69 shows the information, it does not act on it);
- CCU-Jack as a user-defined interface (#135) — user-defined interfaces exist, but CCU-Jack's RPC
  surface has not been verified;
- the extended set of device-specific editors: universal light effects, RGBW/dual-white, alarm panel,
  the ESI energy meter, door locks.

## Known limitations

Things that are known, measured and not fixed:

- **Umlauts and `°` over BIN-RPC.** `binrpc@4.2` decodes strings as UTF-8, so a `°` coming from
  `rfd` or CUxD over BIN-RPC arrives as U+FFFD. This affects the CCU addon and CUxD, not the
  XML-RPC path, and the fix is a one-line change in that library. The XML-RPC direction was measured
  too: requests go out as UTF-8 without an encoding declaration and the CCU stores the mojibake —
  which is the same thing 2.x did, and why the app repairs the known mojibake in unit labels when it
  displays them.
- **A `CONFIG_PENDING` from before the upgrade** does not go away by installing 3.0. If a channel was
  poisoned by 2.x's multi-apply — an unknown parameter name persisted in an HmIP device file — the
  only thing that removes it is deleting and re-pairing the device, or restoring a CCU backup from
  before the damage. 3.0 will tell you which of the two `CONFIG_PENDING` cases you are looking at,
  and will not make it worse.
- **The HmIP switching programme's weekday bit order is unverified** (OQ-16). Nothing in the paramset
  descriptions or in the metadata says which bit is which weekday; the editor took bit 0 = Sunday
  from the documented HmIP weekday enums (BidCos enums start at Saturday) and always prints the raw
  mask next to the checkboxes so you can check it against the WebUI.
- **BidCos-Wired is shown as "not present"** on any system that has no wired gateway. It is in
  the default interface list, its port refuses the connection, and 2.x answered that with an
  error line every 15 seconds for as long as it ran. 3.0 says it once, marks the interface with
  a grey dash instead of a red cross and retries at most every five minutes. Untick it in the
  settings dialog if you would rather not see it at all.

## See also

- [config-pending.md](config-pending.md) — the write-path study, what each interface process really
  does with a bad `putParamset`, and which recoveries work
- [moving-between-installs.md](moving-between-installs.md) — moving a 3.0 profile between install
  types
- [../CHANGELOG.md](../CHANGELOG.md) — the full list of changes
- [../ROADMAP.md](../ROADMAP.md) — the plan, the decisions D-1..D-30 and the open questions
