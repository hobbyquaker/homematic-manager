# openccu-lite

[openccu-lite](https://github.com/hobbyquaker/openccu-lite) is a Homematic CCU firmware **without
ReGaHSS**. The radio stack is unchanged — `rfd`, `hs485d`, `multimacd`, `hmipserver` are the same
processes on the same ports — and everything above it is replaced: there is no ReGa DOM, no
HM-Script interpreter, no CCU WebUI and no JSON-RPC API. The box boots into a system UI that can
administer the hardware and install addons, and it installs a frontend from its catalogue to
configure devices. **The Homematic Manager is that frontend**, and the addon package is the same
one a CCU3 or OpenCCU installs (`hmm-ccu-<arch>-<version>.tar.gz`).

The box supplies what ReGa used to: a **metadata store** — friendly names, rooms, functions and any
other taxonomy the user makes — behind a small JSON API. On openccu-lite the Homematic Manager is
not a consumer of that store, it is its **editor**: renaming a device or a channel, creating a
room, moving a channel into it are writes to the box, and every other program on the box sees them
immediately.

## What works, and what it looks like

| | on a CCU / OpenCCU | on openccu-lite |
| --- | --- | --- |
| Devices, channels, paramsets, direct links, RSSI, service messages, events, the RPC console | XML-RPC / BIN-RPC to `rfd`, `hs485d`, `hmipserver` | identical — the interface processes are the same |
| Friendly names | ReGa when it is on, else this profile's own store | the box's metadata store; a rename is written there |
| Rooms, functions, floors | this profile's own store (new in 3.0.0-beta.3) | the box's, as trees; shared with every other program on the box |
| The login of the addon | the WebUI session (`settings.cgi`), optionally a CCU user (`--auth-mode rega`) | the session openccu-lite's shell hands over (`--auth-mode occulite`) |
| Device images | fetched from the CCU | the bundled subset — the box has no `/config/img/devices/` |
| System variables, programs, HM-Script | ReGa | **not available** — see below |

Nothing has to be configured for any of this. The Homematic Manager asks
`GET /api/meta/v1/version` on the host it is configured for, once per connection: an openccu-lite
box answers with `{"api":"meta","version":1,…}` and its store is used, a CCU answers 404 and
everything stays exactly as it was. A profile that is moved from one to the other and back needs no
edit — which is the point, because moving between OpenCCU and openccu-lite in both directions is a
supported operation of that project (its D-17).

## What has no replacement

Copied from openccu-lite's own porting guide rather than paraphrased, because these are the
answers that save a round trip:

- **System variables** and **programs**: there is no ReGa DOM. Users who need them run automation
  in Node-RED (RedMatic), Home Assistant, or whatever the box is bridged to. The Homematic Manager
  never had a variable or program editor, so nothing is missing here that used to be there.
- **`exec()` of HM-Script**, `dom.GetObject`, `system.GetSessionVarStr` from application code:
  gone. The Tcl form `rega_script` used by addon settings pages for the **session check** keeps
  working through openccu-lite's `tclrega.so` shim, and this addon's `settings.cgi` uses exactly
  that one call and no other.
- **ReGa ids** (`dom.GetObject(1234)`): there are none. The identity of an object is its **ref**,
  `<interface>.<address>` — `BidCos-RF.JEQ0230153:1` for a channel, `HmIP-RF.0001D3C99C7D4B` for a
  device.
- **Service messages / alarms as ReGa variables** (40 and 41): interface-level state only. The
  Homematic Manager reads service messages from the interface processes anyway, so its list is the
  same on both firmwares; what it cannot do on openccu-lite is acknowledge the CCU's *own* alarm
  afterwards, because there is none.
- **The CCU WebUI's JSON-RPC API**: not present, and never used by this application (D-1).
- **The CCU's inbox** (issue #54, "confirm newly paired devices"): a ReGa concept. The option stays
  in the settings and does nothing on openccu-lite.

## The addon on the box

Install it from the box's catalogue (it is listed there as `hmm`) or upload the package for the
box's architecture on the addon page. The `update_script` is the same one a CCU runs; nothing in
the package is openccu-lite-specific. What the addon does differently is decided **at every start**
from the firmware's own `/VERSION`, which carries an extra `VARIANT=lite` line:

- **the login**: `--auth-mode occulite`. openccu-lite's shell opens the addon with the user's
  session on the URL (`?sid=@xxxxxxxxxx@`, the CCU convention), the addon checks that session
  against the box's metadata API and turns it into a session of its own. There is no login form of
  its own — the users are the box's — so a browser that arrives without a session is sent to the
  box's login. The token hand-over of `settings.cgi` keeps working unchanged next to it.
- **the credentials for the store**: reads use the box's local token
  (`/usr/local/etc/occulite/local-token`, role `user`, read-only by design); writes use the session
  of the person looking at the page. A rename is therefore attributed to a user, and nothing
  renames a device unless somebody asked for it.

Nothing is written into `etc/hmm.env` for any of this. Setting `HMM_AUTH_MODE` there by hand
overrides the automatic choice and then stays wrong if the same `/usr/local` is later moved to the
other firmware; the addon's settings page (`/addons/hmm/settings.cgi?cmd=config`) offers the two
modes that fit the firmware it is running on.

## Off the box: a desktop, a server, Docker

The same detection applies wherever the Homematic Manager runs: point it at the box's address and
it finds the metadata API. Reads and writes then need an **API token**, because the local token
file only exists on the box:

1. on the box, open *Users* and create a token — role `user` to read the names, `admin` to edit
   them;
2. paste it into the connection settings (`metaToken` in `config.json`).

Without a token the box answers `401`, and the Homematic Manager runs with the names it has in its
own store, says so in the connection state, and tries again on the next reconnect. It never fails
to start because a box refused a credential.

`metaUrl` in `config.json` overrides the address the store is looked for at — for a reverse proxy
on a non-standard port, and for the integration tests. It is not needed for a normal installation.

## What is in the profile

| Key in `config.json` → `connection` | Meaning |
| --- | --- |
| `metaProvider` | `auto` (the default: probe once per connect), `local` (never probe, keep everything in this profile), `occulite` (insist on the box and say so when it does not answer) |
| `metaToken` | the API token for an installation that is not on the box |
| `metaUrl` | the box's base URL when it is not `http(s)://<host>` |

The `local` store is `meta.json` in the profile directory, next to `config.json` — the user's own
work, like the link templates, so `config.clearCaches` never touches it and
[moving a profile](moving-between-installs.md) takes it along. The box's last snapshot is cached in
the per-CCU cache directory instead, so a restart while the box is unreachable still shows names.

## For other integrations

The provider is deliberately readable as a reference: openccu-lite's format and API are implemented
in [`packages/core/src/meta/`](../packages/core/src/meta) (the document, its validation, the store
with every operation and its revisions, and `applyEvent` for following the change stream), and the
HTTP side in [`packages/backend/src/meta/`](../packages/backend/src/meta) (the client, the two
providers, the detection and the credentials). Both halves run openccu-lite's **conformance
corpus** — its D-16 contract between the Go implementation and this one — from
`packages/core/test/fixtures/meta/`, refreshed with `node scripts/sync-meta-fixtures.mjs
<checkout>`, and there is an integration test against a real `occulited` in
`packages/backend/test/occulite/`.

The normative documents are `docs/meta-format.md`, `docs/meta-api.md` and `docs/PORTING-PROMPT.md`
in the openccu-lite repository. Nothing here may diverge from them without a change there first.
