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
`uninstall`. On OpenCCU monit restarts the process when it dies (passively — the boot is
`S98StartAddons`'s job, and two backends on one port would fight over the interface callbacks).

**Update**: upload the new package the same way. `update_script` stops the service, replaces
`/usr/local/addons/hmm` wholesale, keeps `etc/hmm.env`, keeps the profile and the token, rewrites
the lighttpd rule and starts the service again — exit code 0, no reboot. The Zusatzsoftware page
shows the newest release through `update_check.cgi`.

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
  profile and the token kept), uninstall, reinstall and purge.

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

## Rules for anything added here

- shell scripts that run on the CCU are **POSIX sh** — busybox `ash` runs them, and there is no bash;
- CGIs are **Tcl 8.2**-compatible: no `dict`, no `{*}`, no `eq`/`ne` in `expr`, no `string is`, no
  `file normalize`, no `lassign`. OpenCCU has 8.6 and would not notice; the CCU3 has 8.2.3 from 1999
  and answers with a blank WebUI page. `cgi-test.sh` greps for all of them;
- LF line endings and the execute bit on `update_script`, `rc.d/hmm`, `bin/update_addon` and the
  CGIs, or the firmware silently does nothing with the upload.
