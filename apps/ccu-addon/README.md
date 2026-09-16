# @homematic-manager/ccu-addon

The Homematic Manager as a **CCU3 / OpenCCU addon**: the same backend and the same UI as every other
deliverable (D-25), running on the CCU itself behind the CCU's own lighttpd. No second installation,
no port to open, no configuration dialog — the app is opened from _Systemsteuerung_ and is already
connected, because it is running on the box it configures.

```
Browser ──► CCU lighttpd ──► /addons/hmm/settings.cgi   session check, hands out the token
                        └──► /addons/hmm/…             proxied to 127.0.0.1:8090
                                                        HTTP: the UI, the metadata, device images
                                                        WebSocket: the one API socket (ApiFrame)
                             127.0.0.1:8090 ──► rfd 32001, hs485d 32000, HmIPServer 32010,
                                                VirtualDevices 39292, CUxD 8701, ReGa 8183
```

## Install

Download the package for the architecture of your CCU from the
[latest release](https://github.com/hobbyquaker/homematic-manager/releases/latest) and upload it in
_Einstellungen → Systemsteuerung → Zusatzsoftware_:

| Platform                                                         | Package                          |
| ---------------------------------------------------------------- | -------------------------------- |
| CCU3 with the official eQ-3 firmware, ELV-Charly, OpenCCU 32-bit | `hmm-ccu-armv7l-<version>.tar.gz`  |
| OpenCCU 64-bit (Raspberry Pi 3/4/5)                              | `hmm-ccu-aarch64-<version>.tar.gz` |
| OpenCCU on x86_64 (debmatic, virtual machines, containers)       | `hmm-ccu-x86_64-<version>.tar.gz`  |

The **architecture** decides, not the firmware — `uname -m` on the CCU says which one it is; a CCU3
with the original eQ-3 firmware is always `armv7l`. A package uploaded to the wrong architecture
refuses to install with `Error (13)`. Each package has a `.sha256` and a CycloneDX SBOM
(`.tar.gz.cdx.json`, D-27) next to it, and both the package and the SBOM are signed as GitHub
attestations:

```sh
gh attestation verify hmm-ccu-aarch64-<version>.tar.gz --repo hobbyquaker/homematic-manager
```

**OpenCCU** installs live; the WebUI offers a reboot on a first install but the addon is already
running when it does. The **CCU3 firmware** installs addons during the shutdown of a reboot, in a
chroot — so there a first install really does need the reboot the WebUI asks for.

Afterwards a **Homematic Manager** button appears in _Systemsteuerung_. It opens the app. There is
nothing else to configure: the addon talks to the interface processes on the CCU's own loopback and
takes the device pictures from the CCU's `/config/img/devices/`. Everything the app itself offers —
extra interfaces (D-13), pacing, language — is in its own settings dialog and is stored in
`/usr/local/hmm/config.json`.

Manual install over ssh, which is what the firmware does minus the reboot:

```sh
scp hmm-ccu-x86_64-<version>.tar.gz root@ccu:/usr/local/tmp/new_addon.tar.gz
ssh root@ccu /bin/install_addon        # OpenCCU: the exact path the WebUI takes, prints the exit code
```

## What it installs, and where

| Path                                        | What                                                        |
| ------------------------------------------- | ----------------------------------------------------------- |
| `/usr/local/addons/hmm/`                    | the addon: `bin/node`, `app/`, `rc.d/hmm`, `etc/`, `www/`, `var/hmm.pid`, `var/hmm.log` (only with `HMM_ADDON_LOG=addon`) |
| `/var/log/hmm.log`                          | the backend's log by default, on the CCU's tmpfs (not on openccu-lite; see [Troubleshooting](#troubleshooting)) |
| `/usr/local/hmm/`                           | the **profile**: `config.json`, the caches, `images/`, `token` (mode 600) |
| `/usr/local/etc/config/rc.d/hmm`            | symlink to the service script                                |
| `/usr/local/etc/config/addons/www/hmm`      | symlink to `www/` — this is what serves the CGIs             |
| `/usr/local/etc/config/lighttpd/hmm.conf`   | the proxy rule (see below)                                   |
| `/usr/local/etc/monit-hmm.cfg`              | symlink to `etc/monit.cfg`, OpenCCU only (the CCU3 has no monit) |
| `/usr/local/etc/config/hm_addons.cfg`       | one entry, so the button appears                             |

Nothing outside these is written, patched or linked. The bundled Node.js runtime resolves its
libraries inside `/usr/local/addons/hmm` only, so another addon's Node (RedMatic ships one) is
neither used nor disturbed. `bin/`, `lib/`, `share/`, `app/` and `www/` carry a `.nobackup` file, so
a CCU backup keeps the configuration and not the runtime.

### Size, measured on the lab boxes

| | package | installed | inodes |
| --- | --- | --- | --- |
| armv7l (musl Node 24.18.1) | 27 MB | 71.7 MB | 503 |
| aarch64 (Node 24.20.0) | 44 MB | 127 MB | 461 |
| x86_64 (Node 24.20.0) | 44 MB | 131 MB | 461 |

Almost all of it is the Node binary; the app, the UI and the metadata together are 9.7 MB. The
armv7l package is the small one because Alpine's musl build is stripped and the nodejs.org binaries
are not. Inodes are what a CCU3 is short of - it has 96k on `/usr/local` and a stock box with a few
addons already uses half of them - and 500 of those is what this costs.

**OQ-13** was decided here: the generated metadata (`data/dist`, 74 JSON files and 121 webp icons)
ships **minified, not pre-gzipped**. Measured on the tree this package is built from:

| | bytes | on disk | inodes |
| --- | --- | --- | --- |
| pretty-printed, as generated | 9.62 MB | 9.96 MB | 199 |
| minified | 7.45 MB | 7.84 MB | 199 |
| minified and gzipped | 0.64 MB | 1.22 MB | 199 |

All three cost the same inodes, which is the resource that is actually scarce; gzipping would need a
`Content-Encoding` branch in the shared static server of `apps/web` and would not even shrink the
download, because the package is a `.tar.gz` and gzip does that work anyway (692 KB against 638 KB
for the metadata part of it).

## The token and the cookie

The backend's API socket is guarded by a token (task 12). The browser cannot set a header on a
`WebSocket`, and the CCU's own login is a ReGaHSS session that the backend knows nothing about — so
the two are bridged by the one thing that can check a WebUI session, `settings.cgi`:

```
GET /addons/hmm/settings.cgi?sid=@xxxxxxxxxx@
      │
      ├─ rega_script "Write(system.GetSessionVarStr('xxxxxxxxxx'))"  via tclrega.so
      │
      ├─ empty  ->  200, "Sitzung ungültig / Invalid session", and no cookie
      └─ a user ->  302 to /addons/hmm/
                    Set-Cookie: hmm_token=…; Path=/addons/hmm/; HttpOnly; SameSite=Strict[; Secure]

GET /addons/hmm/api   (upgrade)  ->  Cookie: hmm_token=…  ->  101
GET /addons/hmm/api   (upgrade)  ->  no cookie            ->  401
```

- the token is generated at install time (`openssl rand -hex 32`, `/dev/urandom` as a fallback),
  lives in `/usr/local/hmm/token` with mode 600 and **survives updates**, so an open browser tab
  keeps working across one;
- the host process is started with `--no-issue-cookie`: behind lighttpd it only ever *accepts* the
  cookie and never hands one out itself. The token reaches it through the environment
  (`HMM_TOKEN`), not on the command line, where every `ps` would show it;
- `Secure` is added when the WebUI was reached over https, and left off otherwise — a CCU is
  usually reachable over plain http, and a `Secure` cookie would silently never be sent;
- `SameSite=Strict` means a foreign page cannot make the browser send it, which is what makes the
  missing Origin check on the socket harmless.

**On openccu-lite the same page is opened without `?sid=`** (task 50). The box's lighttpd gate lets
no request under `/addons/` through without a live session and hands the CGI the id of that session
as `X-Occulite-Session` (`HTTP_X_OCCULITE_SESSION`), after removing any copy a client sent. The
header is a claim until the box confirms it: `settings.cgi` asks `GET http://127.0.0.1/api/auth/v1/state`
with the id as Bearer (5 s timeout), and the answer has to say `"authenticated": true` and name that
very `sid` — an API token (authenticated, no `sid`), another session, a non-200 or a box that cannot
be asked all mean *refused*. Only an id of one of the two shapes of occulited's session ids (26
characters of base32, or ten alphanumerics on images from before their task 125) goes into a
header. The header is read on openccu-lite only (`VARIANT=lite` in `/VERSION`, the rule of
`rc.d/hmm`): a CCU's lighttpd passes a client's header straight through, so there it counts for
nothing. The order is header, then `?sid=` through ReGa (on openccu-lite the `tclrega.so` shim
answers the session's legacy alias), then the token cookie; a header the box does not confirm falls
through to `?sid=`. Because both the frontend (task 45) and this page read the header, the catalogue
can declare `session.header_since` for the addon and the box stops putting `?sid=` into its URLs.

**On openccu-lite the settings page and `service.cgi` are for administrators** (B-37, D-49); the
hand-over above is not the settings page and keeps taking any session. `settings.cgi?cmd=config`
and every command of `service.cgi` want the box to name the session's role as `admin`, and only the
box can: the state answer for the header's session has to say `"role": "admin"` as well, and a
header it confirms decides — a `?sid=` next to it is not asked. Only where the box does not confirm
the header is the id in `?sid=` asked about the same way; on an image from before openccu-lite's
task 125 that is the session id itself. The legacy alias of a current image is refused by the box's
API, and the `tclrega.so` shim knows the user name behind it and no role, so `?sid=@alias@` proves a
session and never an administrator. The `hmm_token` cookie is one secret for everybody the hand-over
let into the app and opens neither page there. A session that is not a confirmed administrator's
gets a 403 — a page "Nur für Administratoren / Administrators only" from `settings.cgi`,
`{"error":"administrators only"}` from `service.cgi` — and nothing is written or restarted; without
any session the answers stay as before. A CCU and OpenCCU are unchanged: any WebUI session.

## The optional login (D-32)

`HMM_AUTH_MODE=rega` in `etc/hmm.env` puts a login page in front of the UI for everybody who does
_not_ arrive through `settings.cgi` — a bookmark straight to `http://<ccu>/addons/hmm/`, a second
tab, a phone — instead of a page that silently never connects. Off by default; the hand-over stays
the primary path.

```
GET  /addons/hmm/       no session  ->  the login page, framework-free, German/English
POST /addons/hmm/login  user + password
       ├─ dom.GetObject(ID_USERS).Get("<user>") + UserLevel()   ReGa, 127.0.0.1:8183
       ├─ "<user>:<password>"                                   udp 1998, answers "1"
       └─ both yes  ->  302 /addons/hmm/  + Set-Cookie: hmm_session=…; HttpOnly; SameSite=Strict
GET  /addons/hmm/api    Cookie: hmm_session=…  ->  101, exactly like the token cookie
GET  /addons/hmm/logout ends the session, clears the cookie
```

- the two services are the CCU's own — no JSON-API (D-1), no second password, no user list of our
  own. Both are loopback-only, so `--auth-mode rega` is refused with a clear message unless the
  host runs with `--local`, which is what the rc.d script does and no npm or Docker install does;
- **`settings.cgi` is untouched**: a browser with the token cookie is let in without ever seeing
  the form, so the Systemsteuerung button behaves exactly as before;
- sessions slide, 24 h by default (`HMM_SESSION_TTL`), live in the process and are re-sent as
  `Max-Age` on every page load. Restarting the addon logs everybody out;
- five failures per source per minute, counted per source and never per user name; a wrong password
  and an unknown user get the same answer, so the form cannot enumerate the CCU's users. Behind
  lighttpd the source is the **last** `X-Forwarded-For` entry, the one lighttpd itself added;
- the UI header then shows the user and a logout link (`session.info` on the API contract). The
  ReGa level (8/2/1) is carried and shown but gates nothing: everyone who may log in may write, as
  in the WebUI;
- ReGa runs one script at a time, so looked-up users are cached for 15 minutes, parallel lookups of
  one name share a single script run, and a user we already know stays logged in while ReGa is busy
  or down. That is the RedMatic 9.2.0 lesson and the reason the cache exists at all.

Switched on from the addon's settings page, `/addons/hmm/settings.cgi?cmd=config` (linked from the
addon's entry in Systemsteuerung; it writes `etc/hmm.env` and restarts the service), or by hand:

```sh
echo 'HMM_AUTH_MODE=rega' >> /usr/local/addons/hmm/etc/hmm.env
/usr/local/etc/config/rc.d/hmm restart
```

The settings page takes a WebUI `sid` or the addon's own token cookie — both are proof of the same
ReGaHSS session check — so the link works from Systemsteuerung and from a browser that has the app
open. On openccu-lite it takes the gate's `X-Occulite-Session` first (task 50, above), so the box
frames it without `?sid=`, and it is for administrators only there (B-37, above): the token cookie
does not open it on openccu-lite.

`HMM_AUTH_MODE` is the CCU's setting. On openccu-lite the rc.d script reads `HMM_AUTH_MODE_LITE`
instead (`occulite`, the box's own login, unless it says `token`) and never `HMM_AUTH_MODE`: every
install from the CCU days has `HMM_AUTH_MODE=token` in its `hmm.env`, and a `/usr/local` upgraded to
openccu-lite with that line kept the addon in token mode, where the box's shell can never get in
(B-22). Each firmware has its own line, each is ignored on the other, so the same `/usr/local` can
move between them; the settings page writes the line of the firmware it runs on. A lite line that is
neither `token` nor `occulite` runs `occulite`, and the syslog says so.

## The lighttpd rule

`/usr/local/etc/config/lighttpd/hmm.conf`, written at install time with the port from
`etc/hmm.env`:

```lighttpd
$HTTP["url"] == "/addons/hmm" {
    url.redirect = ("^/addons/hmm$" => "/addons/hmm/")
}

$HTTP["url"] =~ "^/addons/hmm/(?!settings\.cgi|service\.cgi|update_check\.cgi)" {
    proxy.server = ("" => (("host" => "127.0.0.1", "port" => 8090)))
    proxy.header = ("upgrade" => "enable")
    server.errorfile-prefix = "/usr/local/addons/hmm/www/lighttpd-error-"
}
```

`proxy.header = ("upgrade" => "enable")` is the line the whole addon depends on: it is what lets a
WebSocket through the CCU's lighttpd, and RedMatic has been proving it works on CCU3 firmware and
OpenCCU alike with the Node-RED editor's socket for years. The negative lookahead is what lets the
UI and the CGIs share one `/addons/hmm/` prefix — everything is proxied to the backend except the
three CGIs, which lighttpd runs itself.

Both firmwares include `/usr/local/etc/config/lighttpd/*.conf` (OpenCCU always, the CCU3 firmware
since 3.61.5). `update_script` writes the file and, when it is new or changed, tells lighttpd with
`/etc/init.d/S50lighttpd reload` — a graceful restart on both firmwares (SIGUSR1 with
`server.graceful-restart-bg` on OpenCCU, SIGHUP to lighttpd-angel on the CCU3 firmware), never a
`restart`: the install runs *inside* the WebUI's own `cp_software.cgi` request, and a restart cuts
the connection the "installation successful" popup goes out on, leaving the WebUI in its dialog
until an F5 (#141). An update whose rule is unchanged does not touch lighttpd at all; where an
init script has no `reload`, the restart is detached and delayed until the answer is out. The
uninstall removes the file and reloads the same way.

## Service, update, uninstall

The rc.d script is the only interface:

```sh
/usr/local/etc/config/rc.d/hmm start|stop|restart|status
/usr/local/etc/config/rc.d/hmm uninstall          # keeps /usr/local/hmm
/usr/local/etc/config/rc.d/hmm uninstall purge    # deletes the profile as well
```

The same commands are behind `service.cgi` (`?sid=…&cmd=start|stop|restart|status|log`), and the
_Neu starten_ and _Deinstallieren_ buttons on the Zusatzsoftware page call `restart` and
`uninstall`. On OpenCCU monit watches the process (passively — starting it is `S98StartAddons`'s
job, and two backends on one port would fight over the interface callbacks); `rc.d/hmm` arms that
watch after it starts the service and disarms it before it stops one, because `ONREBOOT NOSTART`
leaves the check unmonitored on every monit reload — measured in the lab, see `etc/monit.cfg`.

**Update**: upload the new package the same way. `update_script` stops the service, replaces
`/usr/local/addons/hmm` wholesale, keeps `etc/hmm.env`, keeps the profile and the token, rewrites
the lighttpd rule and starts the service again — exit code 0, no reboot. The Zusatzsoftware page
shows the newest release through `update_check.cgi`.

On the **CCU3 firmware** the install runs inside a chroot the firmware builds first, and that
chroot binds `/usr/local`, `/dev`, `/proc` and `/sys` — not `/var/run`. That is why the pidfile is
`/usr/local/addons/hmm/var/hmm.pid` and not `/var/run/hmm.pid`: in `/var/run` it was invisible to
`update_script` exactly where it mattered, so the stop reported "not running" and the old backend
kept running on the replaced tree — **an `install_addon` driven by hand on a CCU3 used to need a
`rc.d/hmm restart` afterwards** (measured in the lab on 2026-09-05, see
[`docs/hardware-checklist.md`](../../docs/hardware-checklist.md)). It does not any more:
`update_script` stops the old process by either pidfile and, failing that, by its command line in
`/proc`, and if it *was* running — which is what tells a hand-driven update on a live box apart from
the firmware's own install around a reboot — it starts the new one through `/proc/1/root`, the real
root of the running system, because a backend started from inside the chroot would keep a directory
that is about to be deleted as its root. The firmware's own flow is unchanged: nothing is started
there, `S98StartAddons` does it at the boot. Replayed by `container-test.sh`; not re-measured on the
CCU3 box itself. The firmware's
`/bin/install_addon` also ends with `sync` rather than propagating the exit code, so a CCU3 always
reports 0 whether the install was an update or a fresh one; only OpenCCU's wrapper passes the 0/10
through.

**Uninstall** through the WebUI stops the service and removes the addon directory, both symlinks,
the lighttpd rule, the monit link and the Systemsteuerung entry. It **keeps** `/usr/local/hmm`: the
CCU configuration and the caches live there, and a reinstall picks them straight back up. Delete it
by hand, or use `uninstall purge`, when you really want it gone.

## Configuration of the host process

`/usr/local/addons/hmm/etc/hmm.env` is copied from `etc/default.env` on the first install and never
overwritten again:

```sh
HMM_PORT=8090        # loopback only; change hmm.conf with it, or re-run update_script
HMM_LOG_LEVEL=info   # error, warn, info, debug
HMM_ADDON_LOG=varlog # varlog (/var/log/hmm.log, default) or addon (var/hmm.log) - see "Troubleshooting"
HMM_AUTH_MODE=token  # on a CCU: token (default) or rega - see "The optional login (D-32)"
HMM_AUTH_MODE_LITE=occulite  # on openccu-lite: occulite (default) or token - not read on a CCU, and vice versa
HMM_SESSION_TTL=24h  # with rega or occulite: how long a login lasts without being used
HMM_CALLBACK_XMLRPC_DEFAULT_PORT=2031  # the callback ports while the settings say 0, see "Callback ports"
HMM_CALLBACK_BINRPC_DEFAULT_PORT=2032  # (set by the rc.d script; 0 here: a free port at every start)
HMM_NODE_FLAGS="--max-semi-space-size=1 --optimize-for-size"  # node's flags (the default), read by rc.d only - see "Memory"
```

Every option of the host has an `HMM_*` environment mirror
(`homematic-manager-web --help`), so anything else can be added here too. What the rc.d script
passes on the command line — `--local --ccu 127.0.0.1 --base /addons/hmm --host 127.0.0.1
--no-issue-cookie --data-dir /usr/local/hmm` — wins over the file, because those are not settings
but the definition of "we are the addon".

## Callback ports

The interface processes call the backend back on two ports, one for XML-RPC (`hmipserver`, the group
process behind `VirtualDevices`) and one for BIN-RPC (`rfd`, `hs485d`). In the addon they are **fixed by
default: 2031 for XML-RPC, 2032 for BIN-RPC** (D-43, #144). The Docker image fixes the same pair since
3.0.0-beta.16 (task 38; 2126/2127 before); the desktop app and npm keep the free port the kernel picks.

Why fixed: the group process behind `VirtualDevices` keeps its handlers by URL and does not drop the
entry of a backend that ended without `init(url, '')` — a `kill -9` after the 15 s of `rc.d/hmm stop`,
a power cut, the OOM killer, an interface process restarting under a running backend. With a new free
port at every start each of those left one more entry in `/var/HMSERVER.handlers`; with a fixed port
the next start registers the same URL and replaces its own entry.

How it works:

- `rc.d/hmm` sets `HMM_CALLBACK_XMLRPC_DEFAULT_PORT=2031` and `HMM_CALLBACK_BINRPC_DEFAULT_PORT=2032`
  before it reads `etc/hmm.env`, so `hmm.env` can move them, or set `0` for a free port at every start.
- They are used only while the settings dialog says `0` for a port, which is its default, and they are
  never written to `config.json`. **Ports set in the settings dialog always win**, and no addon update
  can overwrite them. The dialog says what `0` means in the addon: "0 uses port 2031, or a free one when
  it is taken".
- The host logs `callback: default ports xmlrpc=2031 binrpc=2032 while the configuration says 0` at
  start.
- **A taken default port is not fatal**: the log says `callback server: the default xmlrpc port 2031 is
  taken, a free port is used until the next start (...)`, once, and the backend subscribes on a free
  port. A port set in the settings dialog that is taken stays an error, as it always was.
- The URLs registered are `http://127.0.0.1:2031` and `xmlrpc_bin://127.0.0.1:2032` (#144), and the two
  servers listen on `127.0.0.1` only — before, they listened on every interface of the box. No firewall
  rule is needed on any of the firmwares: their firewalls accept everything on `lo`, and nothing outside
  the box has to reach these ports.

How the two were chosen — `netstat -lntup` on three openccu-lite boxes in the lab on 2026-09-12 (x86_64,
Raspberry Pi 3 and Pi 4, with RedMatic, Mosquitto, hm2mqtt.js and this addon installed), their firewall
rules, a connect check of the two candidates on a stock OpenCCU, and the lighttpd and firewall
configuration of the OpenCCU tree. Taken, and therefore avoided:

| Ports | Used by |
| --- | --- |
| 22, 80, 443 | sshd, lighttpd |
| 1999, 2000, 2001, 2002, 2010, 8181, 9292; 41999, 42000, 42001, 42010, 48181, 49292 | lighttpd, the CCU's remote API ports (plain; TLS) |
| 8183, udp 1998, udp 8182 | ReGaHSS, the authentication daemon, `hss_led` |
| 32000, 32001, 32010, 39292, 9293, 9294, udp 43438, udp 43439, udp 1900 | `hs485d`, `rfd`, `hmipserver`, `eq3configd`, `ssdpd` |
| 2121, 2122 | occulited on openccu-lite, CCU-Jack on a CCU |
| 1880, 1883–1886, 8883, 8884, udp 5540 | RedMatic's Node-RED, Mosquitto, Matter |
| 2040–2091 | node-red-contrib-ccu, which picks its callback pair at random in this range |
| 2126, 2127 | hm2mqtt.js |
| 8088, 9099 | firewall rules an addon left on a box converted from OpenCCU |
| 8090 | this addon's own HTTP port (`HMM_PORT`) |
| 32768–60999 | the kernel's ephemeral range, where every free port comes from |

`HMM_PORT` is deliberately not next to them: the backend starts its callback servers before its HTTP
listener, so a callback port right beside it would take the port from a user who moves `HMM_PORT` up by
one — and cost the UI, not the callback.

## Idle unsubscribe

With no browser page open for five minutes the backend de-registers from `rfd`, `hmipserver` and
the rest with `init('')` and stops polling for service messages; the next page load subscribes
again and the header shows "subscribing" until the first device sweep is through. That is the
host's default (D-31) and the addon does not override it - `HMM_IDLE_UNSUBSCRIBE` in
`etc/hmm.env` changes the grace period, `0` disables it. Caches, names and `config.json` are not
touched by it.

## Memory

Since 3.0.0-beta.17 `rc.d/hmm` starts node with `--max-semi-space-size=1 --optimize-for-size` (B-32,
task 44): a young generation of 1 MB instead of V8's default, which grows with a page and is never given
back, and V8's heuristics for a small heap. The backend allocates little, so the more frequent
collections cost next to nothing. `HMM_NODE_FLAGS=` in `etc/hmm.env` starts node without flags, and
any other value replaces the default.

**Not `--lite-mode` and not `--jitless`.** 3.0.0-beta.16 started node with `--lite-mode`, which saved a
little more, but it switches off WebAssembly, and node's built-in `fetch` parses HTTP with WebAssembly:
every request of the backend failed, and on openccu-lite no session was let in, so the addon could not
be opened. `--jitless` does the same. `rc.d/hmm` drops both from `HMM_NODE_FLAGS` with a log line, and
the update takes them out of `etc/hmm.env`.

Measured on 2026-09-13 with the x86_64 package of beta.16 (Node v24.21.0) on a development machine,
not on a CCU: the addon's own `bin/node` and app against hm-simulator on the CCU's loopback ports with
the device list of a lab box (5 devices), in four phases - 45 s after the port listens, a page open
for 75 s with the tabs visited, the page closed, and after the idle unsubscribe (grace 60 s for the
run). Two runs each, alternating; MiB of PSS, anonymous memory in brackets:

| | started | page open (40 s) | page closed | after the unsubscribe | peak RSS |
| --- | --- | --- | --- | --- | --- |
| without flags, run 1 | 85.2 (58.3) | 92.7 (65.6) | 92.7 (65.6) | 60.7 (33.6) | 101.4 |
| without flags, run 2 | 87.3 (60.2) | 65.2 (37.7) | 66.5 (39.0) | 60.1 (32.4) | 89.1 |
| the default flags, run 1 | 56.0 (28.8) | 57.2 (29.6) | 57.5 (29.8) | 58.0 (30.4) | 71.5 |
| the default flags, run 2 | 56.2 (29.4) | 60.4 (32.8) | 60.5 (32.8) | 61.1 (33.4) | 70.5 |

So about **30 MiB less PSS after the start, 5–35 MiB less with a page open, about the same after the
idle unsubscribe**, 18–31 MiB less at the peak, and a steadier figure: without flags the same run lands
up to 27 MiB apart depending on when V8 collects. About 26 MiB of the PSS in every run is the code of
`bin/node`, which sat on a tmpfs and counts as shared memory; on a CCU it is file-backed and
reclaimable. For comparison, beta.16's `--lite-mode` held 21–24 MiB of anonymous memory in the same
harness on 2026-09-12, against 29–34 MiB here. Not measured yet on a CCU, and not for the time a page
takes to load there.

## Troubleshooting

| Symptom | Look at |
| --- | --- |
| The button opens a page saying the session is invalid | The WebUI session expired. Reload the WebUI and open the addon again. |
| The button opens a 503 page | The service is not running: `service.cgi?…&cmd=log`, or `/var/log/hmm.log` (`/usr/local/addons/hmm/var/hmm.log` with `HMM_ADDON_LOG=addon`); on openccu-lite the box's Log page with unit `addon-hmm`, or `journalctl -t addon-hmm`. Start it with the _Neu starten_ button. |
| The UI loads but stays disconnected | The WebSocket did not get through. `grep hmm /var/log/messages`, and check that `/usr/local/etc/config/lighttpd/hmm.conf` exists and lighttpd has read it (`/etc/init.d/S50lighttpd reload`). CCU3 firmware older than 3.61.5 does not read that directory at all. |
| No devices, interfaces marked red | The interface processes answer on the CCU's loopback only (D-28). `netstat -tlnp` should show 32001 / 32010; a CCU in safe mode or with `HM_MODE` other than `NORMAL` starts neither them nor addons. |
| Device pictures are missing | They come from the CCU's own `/config/img/devices/`; the app falls back to the pictures that ship in `app/data/icons/`. |
| `BidCos-Wired ... init failed` every 15 seconds in the log | `hs485d` only runs on a CCU that has a BidCos-Wired gateway. Untick BidCos-Wired in the app's settings dialog and the retries stop. |
| The QR scanner says the camera needs https | `getUserMedia` exists only in a secure context, and the addon is reached as `http://<ccu>/addons/hmm/`. Open the same page over the CCU's https port (`https://<ccu>/addons/hmm/`, accepting the certificate warning) and the scanner works; otherwise type the SGTIN and the key in by hand. |
| `Error (13)` when installing | Wrong architecture. Compare `uname -m` with the package name. |
| Everything is slow on a CCU3 | It is a 1 GB armv7 board. The addon raises its own `oom_score_adj` to 800 so the kernel takes it before it takes rfd or ReGaHSS. |

Log lines are tagged `hmm` in `/var/log/messages`; the process's own output is
`/var/log/hmm.log` by default, rotated at 1 MB.

On a CCU and OpenCCU the location is a setting (task 43, #159): the _Log_ section of the addon's
settings page (`settings.cgi?cmd=config`), or `HMM_ADDON_LOG` in `etc/hmm.env`.

| `HMM_ADDON_LOG`             | File                                | Trade-off                                                            |
| --------------------------- | ----------------------------------- | -------------------------------------------------------------------- |
| `varlog` (the default, and unset) | `/var/log/hmm.log`            | the CCU convention; on a tmpfs, so no SD-card writes, and gone after a reboot |
| `addon`                     | `/usr/local/addons/hmm/var/hmm.log` | survives a reboot, and writes to the SD card                         |

- **Rotation:** both files are rotated at 1 MB into `hmm.log.1`.
- **A switch** takes effect with the restart the settings page does. That start removes the file at the
  other location (and its `hmm.log.1`), so the log views never show a stale log and nothing old stays on
  the SD card.
- **The fallback:** when `/var/log` cannot be created or written, the start logs to the addon directory
  instead, and says so in syslog.
- **The log views:** `service.cgi?…&cmd=log` and the settings page's last lines show the chosen file, or
  the other one when only that one exists.
- **An uninstall** removes `/var/log/hmm.log` too.

On openccu-lite there is no log file (task 41, following openccu-lite's rule that everything logs to
the journal): the process's output goes to the journal under the unit's identifier `addon-hmm`. The
box's Log page shows it with the unit `addon-hmm` chosen, `journalctl -t addon-hmm` on the box, and
`service.cgi?…&cmd=log` sends the browser to that Log page. A `var/hmm.log` from an earlier version is
removed at the first start. The log level (`HMM_LOG_LEVEL`) is the same on both. The settings page shows
no location to choose there, only a link to the Log page; where the journal is stored is set in occulited.

## Building it

```sh
npm run build                                # the UI and the metadata the package carries
apps/ccu-addon/build.sh x86_64               # or aarch64, or armv7l
```

Needs `curl`, `tar`, `node` and — for `armv7l` — `patchelf`. The result is
`apps/ccu-addon/out/hmm-ccu-<arch>-<version>.tar.gz` with its `.sha256` and its SBOM.

`build-runtime.sh` assembles the bundled Node: for `aarch64` and `x86_64` the stock nodejs.org
tarball, for `armv7l` the Alpine musl build with its loader and libraries copied in and
`patchelf`'ed to resolve everything inside `/usr/local/addons/hmm` — the CCU3's glibc 2.27 cannot
run any nodejs.org binary since Node 18, and nodejs.org stopped building armv7l after v23.
`alpine-packages.js` resolves the apk dependency closure from `APKINDEX` without an `apk` binary or
a container, and its `--json` output is what puts the `pkg:apk/alpine/...` components into the SBOM.

## Tests

```sh
npm run test:cgi -w apps/ccu-addon                                   # tclsh + shellcheck, or docker
npm run test:package -w apps/ccu-addon -- out/hmm-ccu-x86_64-<version>.tar.gz
npm run test:container -w apps/ccu-addon -- --idle                   # needs docker
```

- **cgi-test.sh** runs every CGI against a Tcl stub for `tclrega.so`: the cookie and its attributes,
  a valid, an expired, a malformed and a percent-encoded session id, a query string that tries to
  make the decoder execute commands, the service commands, and a grep for Tcl constructs newer than
  8.2 (the CCU3 firmware's interpreter) and for paths outside `/usr/local`. Since task 50 it also
  runs `occulite-state-stub.tcl`, a stub `/api/auth/v1/state` with a request log, and drives the
  openccu-lite session header through `settings.cgi` and `service.cgi`: the hand-over and the
  settings page with the header alone, a header the box does not confirm, an answer without a `sid`,
  one naming another session, a 500, garbage, a box that cannot be asked (all refused after one
  call), an `@`-wrapped, line-broken, doubled, colon-carrying, token-shaped, over-long and empty
  header (refused with no call), the fall-through to `?sid=` and to the token cookie, and a CCU
  and a firmware without `/VERSION` ignoring the header with no call. Since B-37 the stub answers
  both roles, and on a lite tree an administrator's session opens the settings page and
  `service.cgi` while a user's gets the 403 through each way in - the header (also with an
  administrator's id in `?sid=` next to it), `?sid=` with a user's session id or with an alias the
  shim confirms, the alias as the header, the token cookie - with nothing written or restarted;
  an answer without a role, `Admin`, an escaped role, a user name spelling `"role":"admin"` and every
  failed lookup are refused too, the hand-over still takes a user's session, and a CCU still takes
  any WebUI session and the cookie without asking a box.
- **package-test.sh** unpacks a built package into the layout a CCU installs it into — including the
  `addons/www/hmm` symlink the CGIs are reached through, which the source tree never has — runs the
  CGIs from there, and checks the SBOM against the package: its `node` component must say what the
  bundled binary's own `node -v` says.
- **container-test.sh** replays OpenCCU's `/bin/install_addon` in a Debian container with busybox as
  `/bin/sh`, a real lighttpd with the firmware's CGI rules and a compiled stub `tclrega.so`: fresh
  install (exit 10), the links, the token's mode, the session check over HTTP with a right and a
  wrong sid, the UI and the metadata through the proxy rule, the CGIs *not* being proxied, the
  WebSocket upgrade, a socket left idle past lighttpd's 60 second timeout, an update (exit 0, the
  profile and the token kept), uninstall, reinstall and purge. Since task 18 it also switches the
  installed addon to `HMM_AUTH_MODE=rega` against `ccu-auth-stub.mjs` — a stub ReGa on 8183 and a
  stub authentication daemon on udp 1998, run by the *bundled* node — and drives the whole login
  through lighttpd: the login page instead of the UI, a 401 for the metadata, a wrong password, an
  unknown user, the right credentials (whose password contains a colon and a backslash, so the
  datagram escaping is exercised), the cookie's attributes, the WebSocket and `session.info` on it,
  the `settings.cgi` hand-over still bypassing the login, the settings page, logout, the rate limit,
  and the way back to `token`. Since task 43 it also follows the log: `/var/log/hmm.log` after the
  install, the settings page's switch to the addon directory and back with `service.cgi`'s log view
  following, the 1 MB rotation of both files, the fallback when `/var/log/hmm.log` cannot be written,
  and the file going with an uninstall. Since task 50 the openccu-lite part also proxies
  `/api/auth/` to the stub box and opens the hand-over, the settings page and `service.cgi` through
  lighttpd with only `X-Occulite-Session` (the CGI's real state URL), refuses an unconfirmed and an
  `@`-wrapped header, falls through to `?sid=`, and shows a CCU ignoring a client-sent header.

The first two need `tclsh` and `shellcheck`. A plain WSL Debian has neither, so `test:cgi` and
`test:package` go through `test/in-image.sh`: it runs the script right here when both are installed
and otherwise inside the `hmm-addon-test` image, built from `test/Dockerfile` on first use, with the
checkout mounted at its own path and the script running as the calling user
(`HMM_TEST_IN=host|image` forces the place). Called directly, `cgi-test.sh` fails without shellcheck
instead of skipping it; `SKIP_SHELLCHECK=1` turns that back into a skip for a machine with neither
shellcheck nor Docker (B-50).

`.github/workflows/addon.yml` runs all of it for the three architectures on every push,
`release-addon.yml` for a `v*` tag (D-24: no `needs:` on any other workflow).

Beyond that there is only hardware. All three packages were installed on real boxes for 3.0.0-dev.0
— CCU3 firmware 3.89.8 on armv7l (the reboot install, Tcl 8.2.3, lighttpd 1.4.50), OpenCCU 3.89.8 on
x86_64 and on aarch64 (the live install) — and on each one: the Zusatzsoftware entry, the session
check with a right and a wrong session id, the UI and its assets through the proxy rule, the
WebSocket upgrade and an ApiFrame round trip, a socket left idle for ten minutes, `service.cgi`
restart, and the device list filling from `rfd` and `HmIPServer` on the loopback. The lookahead in
the proxy rule works on lighttpd 1.4.50 (CCU3 firmware) and 1.4.82 (OpenCCU) alike.

### The optional login on hardware (D-32, task 18) — **checked 2026-09-05**

All eight steps below were run in task 17's hardware pass on the OpenCCU x86_64 box against the
real ReGaHSS and the real authentication daemon on UDP 1998, and the settings page plus one login
round on the CCU3-firmware box (Tcl 8.2.3). Everything passed, ReGa reports **level 8** for the
lab's admin user, and both boxes were left in `token` mode. The results are in
[`docs/hardware-checklist.md`](../../docs/hardware-checklist.md); what is still untested is a CCU
user at a *lower* ReGa level. The recipe stays here because it is how the check is repeated:

```sh
# the log is /var/log/hmm.log since task 43; with HMM_ADDON_LOG=addon it is /usr/local/addons/hmm/var/hmm.log
# 1. switch the addon over and restart it
ssh root@<box> "echo 'HMM_AUTH_MODE=rega' >> /usr/local/addons/hmm/etc/hmm.env; \
    /usr/local/etc/config/rc.d/hmm restart; sleep 3; grep -c 'login:' /var/log/hmm.log"

# 2. the login page instead of the UI, and the form against the real ReGa + udp 1998
curl -s  http://<box>/addons/hmm/ | grep -c 'name="password"'          # 1
curl -si -X POST http://<box>/addons/hmm/login \
    -d 'user=<ccu-user>&password=<wrong>'   | head -1                   # 401
curl -si -X POST http://<box>/addons/hmm/login \
    -d 'user=<ccu-user>&password=<right>'   | grep -i set-cookie        # hmm_session=…
curl -s -b 'hmm_session=<id>' http://<box>/addons/hmm/ | grep -c 'id="app"'   # 1

# 3. the level ReGa really reports for that user, in the log and in session.info
ssh root@<box> "grep 'login:' /var/log/hmm.log | tail -2"   # level 8 for an admin

# 4. the hand-over still bypasses the login: open the button in Systemsteuerung, expect the UI
#    with no login page, then check the header shows no user for that path and does for the other

# 5. the rate limit, from one machine, and that the CCU is not asked a sixth time
for i in 1 2 3 4 5 6; do curl -so /dev/null -w '%{http_code} ' -X POST \
    http://<box>/addons/hmm/login -d 'user=<ccu-user>&password=<wrong>'; done   # 401×5 then 429

# 6. logout, and that the api socket refuses the cookie afterwards
curl -si -b 'hmm_session=<id>' http://<box>/addons/hmm/logout | head -1         # 302

# 7. ReGa restarting under a live session: the known user must stay logged in
ssh root@<box> "/etc/init.d/S70ReGaHss restart"                                  # page keeps working

# 8. put it back
ssh root@<box> "sed -i 's/^HMM_AUTH_MODE=rega/HMM_AUTH_MODE=token/' \
    /usr/local/addons/hmm/etc/hmm.env; /usr/local/etc/config/rc.d/hmm restart"
```

Steps 1 and 8 are easier through the addon's own settings page than by editing `hmm.env`:
`/addons/hmm/settings.cgi?cmd=config&auth_mode=rega&sid=@<sid>@` writes the variable and restarts
the service itself, which is also what a user would do. That page was checked on the CCU3 firmware
box too (Tcl 8.2.3): it renders with no Tcl error, names the mode in force, writes `HMM_AUTH_MODE`
**once** on a second switch rather than appending a line, and restarts the service.

## Rules for anything added here

- shell scripts that run on the CCU are **POSIX sh** — busybox `ash` runs them, and there is no bash;
- CGIs are **Tcl 8.2**-compatible: no `dict`, no `{*}`, no `eq`/`ne` in `expr`, no `string is`, no
  `file normalize`, no `lassign`. OpenCCU has 8.6 and would not notice; the CCU3 has 8.2.3 from 1999
  and answers with a blank WebUI page. `cgi-test.sh` greps for all of them;
- LF line endings and the execute bit on `update_script`, `rc.d/hmm`, `bin/update_addon` and the
  CGIs, or the firmware silently does nothing with the upload.
