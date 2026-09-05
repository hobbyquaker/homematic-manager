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
| `/usr/local/addons/hmm/`                    | the addon: `bin/node`, `app/`, `rc.d/hmm`, `etc/`, `www/`, `var/hmm.log` |
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
open.

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
since 3.61.5). `update_script` restarts lighttpd once after writing the file, and the uninstall
removes it and restarts lighttpd again.

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

On the **CCU3 firmware** the update runs in a chroot during the reboot the WebUI asks for, and that
chroot binds `/usr/local`, `/dev`, `/proc` and `/sys` — not `/var/run`, where the pidfile is. So
`update_script`'s stop finds nothing to stop there, which is harmless in the firmware's own flow
(the box is going down anyway) but means that **running `/bin/install_addon` by hand on a CCU3 to
avoid the reboot leaves the old process running on the replaced tree**: finish such an update with
`/usr/local/etc/config/rc.d/hmm restart`. Measured in the lab on 2026-09-05, see
[`docs/hardware-checklist.md`](../../docs/hardware-checklist.md). The firmware's
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
HMM_AUTH_MODE=token  # token (default) or rega - see "The optional login (D-32)"
HMM_SESSION_TTL=24h  # with rega: how long a login lasts without being used
```

Every option of the host has an `HMM_*` environment mirror
(`homematic-manager-web --help`), so anything else can be added here too. What the rc.d script
passes on the command line — `--local --ccu 127.0.0.1 --base /addons/hmm --host 127.0.0.1
--no-issue-cookie --data-dir /usr/local/hmm` — wins over the file, because those are not settings
but the definition of "we are the addon".

## Idle unsubscribe

With no browser page open for five minutes the backend de-registers from `rfd`, `hmipserver` and
the rest with `init('')` and stops polling for service messages; the next page load subscribes
again and the header shows "subscribing" until the first device sweep is through. That is the
host's default (D-31) and the addon does not override it - `HMM_IDLE_UNSUBSCRIBE` in
`etc/hmm.env` changes the grace period, `0` disables it. Caches, names and `config.json` are not
touched by it.

## Troubleshooting

| Symptom | Look at |
| --- | --- |
| The button opens a page saying the session is invalid | The WebUI session expired. Reload the WebUI and open the addon again. |
| The button opens a 503 page | The service is not running: `service.cgi?…&cmd=log`, or `/usr/local/addons/hmm/var/hmm.log`. Start it with the _Neu starten_ button. |
| The UI loads but stays disconnected | The WebSocket did not get through. `grep hmm /var/log/messages`, and check that `/usr/local/etc/config/lighttpd/hmm.conf` exists and lighttpd was restarted after the install (`/etc/init.d/S50lighttpd restart`). CCU3 firmware older than 3.61.5 does not read that directory at all. |
| No devices, interfaces marked red | The interface processes answer on the CCU's loopback only (D-28). `netstat -tlnp` should show 32001 / 32010; a CCU in safe mode or with `HM_MODE` other than `NORMAL` starts neither them nor addons. |
| Device pictures are missing | They come from the CCU's own `/config/img/devices/`; the app falls back to the pictures that ship in `app/data/icons/`. |
| `BidCos-Wired ... init failed` every 15 seconds in the log | `hs485d` only runs on a CCU that has a BidCos-Wired gateway. Untick BidCos-Wired in the app's settings dialog and the retries stop. |
| The QR scanner says the camera needs https | `getUserMedia` exists only in a secure context, and the addon is reached as `http://<ccu>/addons/hmm/`. Open the same page over the CCU's https port (`https://<ccu>/addons/hmm/`, accepting the certificate warning) and the scanner works; otherwise type the SGTIN and the key in by hand. |
| `Error (13)` when installing | Wrong architecture. Compare `uname -m` with the package name. |
| Everything is slow on a CCU3 | It is a 1 GB armv7 board. The addon raises its own `oom_score_adj` to 800 so the kernel takes it before it takes rfd or ReGaHSS. |

Log lines are tagged `hmm` in `/var/log/messages`; the process's own output is
`/usr/local/addons/hmm/var/hmm.log`, rotated at 1 MB.

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
apps/ccu-addon/test/cgi-test.sh                      # needs tclsh
apps/ccu-addon/test/package-test.sh out/hmm-ccu-x86_64-*.tar.gz
apps/ccu-addon/test/container-test.sh --idle         # needs docker
```

- **cgi-test.sh** runs every CGI against a Tcl stub for `tclrega.so`: the cookie and its attributes,
  a valid, an expired, a malformed and a percent-encoded session id, a query string that tries to
  make the decoder execute commands, the service commands, and a grep for Tcl constructs newer than
  8.2 (the CCU3 firmware's interpreter) and for paths outside `/usr/local`.
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
  and the way back to `token`.

Without `tclsh` on the machine (a plain WSL Debian has none) the first two run in the test image:

```sh
docker build -t hmm-addon-test apps/ccu-addon/test
docker run --rm -v "$PWD:/repo" -w /repo hmm-addon-test bash apps/ccu-addon/test/cgi-test.sh
```

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
# 1. switch the addon over and restart it
ssh root@<box> "echo 'HMM_AUTH_MODE=rega' >> /usr/local/addons/hmm/etc/hmm.env; \
    /usr/local/etc/config/rc.d/hmm restart; sleep 3; grep -c 'login:' /usr/local/addons/hmm/var/hmm.log"

# 2. the login page instead of the UI, and the form against the real ReGa + udp 1998
curl -s  http://<box>/addons/hmm/ | grep -c 'name="password"'          # 1
curl -si -X POST http://<box>/addons/hmm/login \
    -d 'user=<ccu-user>&password=<wrong>'   | head -1                   # 401
curl -si -X POST http://<box>/addons/hmm/login \
    -d 'user=<ccu-user>&password=<right>'   | grep -i set-cookie        # hmm_session=…
curl -s -b 'hmm_session=<id>' http://<box>/addons/hmm/ | grep -c 'id="app"'   # 1

# 3. the level ReGa really reports for that user, in the log and in session.info
ssh root@<box> "grep 'login:' /usr/local/addons/hmm/var/hmm.log | tail -2"   # level 8 for an admin

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
