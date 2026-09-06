# Homematic Manager as a CCU addon

The Homematic Manager running **on the CCU itself**, behind the CCU's own lighttpd, opened from
_Systemsteuerung_. Same backend, same UI and same `config.json` as every other install type (D-25) —
but no second machine, no port to open, no firewall rule and no CCU address to configure, because
it is running on the box it configures.

```
Browser ──► CCU lighttpd ──► /addons/hmm/settings.cgi   session check, hands out the token
                        └──► /addons/hmm/…             proxied to 127.0.0.1:8090
                             127.0.0.1:8090 ──► rfd 32001, hs485d 32000, HmIPServer 32010,
                                                VirtualDevices 39292, CUxD 8701, ReGa 8183
```

Contents: [Requirements](#requirements) · [Which package](#which-package) ·
[Install](#install) · [Verifying the download](#verifying-the-download-d-27) ·
[The token and the cookie](#the-token-and-the-cookie) · [The lighttpd rule](#the-lighttpd-rule) ·
[Where things live](#where-things-live) · [Update and uninstall](#update-and-uninstall) ·
[Configuration](#configuration) · [Troubleshooting](#troubleshooting) ·
[Size and flash budget](#size-and-flash-budget)

## Requirements

- A **CCU3** with the official eQ-3 firmware **3.61.5 or newer**, an **ELV-Charly**, or a current
  **OpenCCU** (formerly RaspberryMatic) on `armv7l`, `aarch64` or `x86_64`.
  The firmware floor is the lighttpd rule: only from 3.61.5 does the CCU3 firmware read
  `/usr/local/etc/config/lighttpd/*.conf`, and without that file nothing of the addon is reachable.
  OpenCCU has always read it.
- CCU1, CCU2 and armv6l (Raspberry Pi 1 / Zero) are out — the bundled Node runtime does not exist
  for them.
- About **130 MB** free on `/usr/local` (72 MB on armv7l) and 500 free inodes. See
  [Size and flash budget](#size-and-flash-budget).

> **3.0 is available as a beta.** The three packages of [3.0.0-beta.0](https://github.com/hobbyquaker/homematic-manager/releases/tag/v3.0.0-beta.0) are on the release
> page as a pre-release, each with its `.sha256` and `.cdx.json`; `addon.yml` builds the same
> packages on every push to `master` as workflow artifacts, and a checkout builds them too
> ([BUILD.md](../BUILD.md)).

## Which package

The **architecture** decides, not the firmware. `uname -m` on the CCU says which one it is, and a
CCU3 with the original eQ-3 firmware is always `armv7l`:

| Platform | Package |
| --- | --- |
| CCU3 with the official eQ-3 firmware, ELV-Charly, OpenCCU 32-bit | `hmm-ccu-armv7l-<version>.tar.gz` |
| OpenCCU 64-bit (Raspberry Pi 3/4/5) | `hmm-ccu-aarch64-<version>.tar.gz` |
| OpenCCU on x86_64 (debmatic, virtual machines, containers) | `hmm-ccu-x86_64-<version>.tar.gz` |

A package uploaded to the wrong architecture refuses to install with **`Error (13)`**. That is the
firmware's own check, and it happens before anything is written — a wrong upload cannot damage the
CCU.

## Install

Download the package for your architecture from the
[latest release](https://github.com/hobbyquaker/homematic-manager/releases/latest) and upload it in
_Einstellungen → Systemsteuerung → Zusatzsoftware → Zusatzsoftware installieren_.

- **OpenCCU installs live.** The WebUI offers a reboot on a first install, but the addon is already
  running when it does; the reboot is not needed.
- **The CCU3 firmware installs addons during the shutdown of a reboot**, in a chroot. There a first
  install really does need the reboot the WebUI asks for. Measured on a lab CCU3: ssh answered again
  after 239 s, with the addon started at boot and all interface processes back.

Afterwards a **Homematic Manager** button appears in _Systemsteuerung_. It opens the app, and there
is nothing else to set up: the addon talks to the interface processes on the CCU's own loopback and
takes the device pictures from the CCU's `/config/img/devices/`.

The same thing over ssh, which is what the firmware does minus the reboot:

```sh
scp hmm-ccu-x86_64-<version>.tar.gz root@ccu:/usr/local/tmp/new_addon.tar.gz
ssh root@ccu /bin/install_addon        # the exact path the WebUI takes; prints the exit code
```

Exit code 10 means "fresh install", 0 means "update".

## Verifying the download (D-27)

Every package has a `.sha256` next to it and a CycloneDX 1.6 SBOM (`<package>.tar.gz.cdx.json`)
listing what is really inside — including the bundled Node.js and, on `armv7l`, the Alpine packages
it was assembled from, so a CVE in the runtime is searchable per release. Package and SBOM are both
signed as GitHub artifact attestations:

```sh
sha256sum -c hmm-ccu-aarch64-<version>.tar.gz.sha256
gh attestation verify hmm-ccu-aarch64-<version>.tar.gz --repo hobbyquaker/homematic-manager
```

`gh attestation verify` works offline once the attestation bundle has been fetched once.

## The token and the cookie

The API socket the UI talks to is guarded by a token. A browser cannot set a header on a
`WebSocket`, and the CCU's own login is a ReGaHSS session the backend knows nothing about — so the
two are bridged by the one thing that can check a WebUI session, `settings.cgi`:

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

What that means in practice:

- **Only a logged-in WebUI session gets in.** The addon adds no login of its own and no second
  password.
- The token is generated at install time (`openssl rand -hex 32`, `/dev/urandom` as a fallback),
  lives in `/usr/local/hmm/token` with mode 600 and **survives updates**, so a browser tab left open
  keeps working across one.
- The backend runs with `--no-issue-cookie`: behind lighttpd it only ever *accepts* the cookie and
  never hands one out itself. The token reaches it through the environment (`HMM_TOKEN`), never on
  the command line where every `ps` would show it.
- `Secure` is added when the WebUI was reached over https and left off otherwise — a CCU is usually
  plain http, and a `Secure` cookie would silently never be sent.
- `SameSite=Strict` means a foreign page cannot make the browser send the cookie, which is what
  makes the deliberately missing Origin check on the socket harmless.

## Optional: a login with a CCU user

By default the WebUI session is the only way in, and a browser that opens `http://<ccu>/addons/hmm/`
directly — a bookmark, a second tab, a phone — gets a page that never connects, because it has no
cookie. Switching the addon to `HMM_AUTH_MODE=rega` puts a small login page in front of the UI
instead:

```
GET /addons/hmm/            no session   ->  the login page (German/English)
POST /addons/hmm/login      user + password
      ├─ dom.GetObject(ID_USERS).Get("<user>")   ReGa on 127.0.0.1:8183, and its UserLevel()
      ├─ "<user>:<password>"                     udp 1998, the CCU's authentication daemon, answers 1
      └─ both yes  ->  302 to /addons/hmm/ with Set-Cookie: hmm_session=…
GET /addons/hmm/logout      ends the session and clears the cookie
```

Those are the same two services the CCU's own WebUI uses; there is no JSON-API involved (D-1) and no
second password anywhere — **the users are the CCU's users**, and changing one on the CCU changes it
here. Both services listen on the CCU's loopback only, which is why this exists for the addon and
nowhere else: an npm or Docker install that asks for `--auth-mode rega` refuses to start and says
so.

What it does and does not change:

- the `settings.cgi` hand-over is **untouched**. The button in Systemsteuerung still opens the app
  directly, and a browser carrying the token cookie never sees the login page;
- the session cookie is `HttpOnly; SameSite=Strict` (`Secure` over https), lasts 24 hours of
  inactivity (`HMM_SESSION_TTL`) and slides — a tab in use never expires, one left over the weekend
  does. Sessions live in the process, so restarting the addon logs everybody out;
- the header of the app then shows the user name and a **Abmelden / Log out** link;
- five failed attempts from one address per minute and the login stops answering for a minute. A
  wrong password and a user the CCU does not have get exactly the same message, so the form cannot
  be used to find out which user names exist;
- the user's ReGa level (8 admin, 2 user, 1 guest) is shown but does not restrict anything yet:
  everyone who may log in may write, exactly as in the WebUI.

Switch it on from the **Addon-Einstellungen** link on the Zusatzsoftware page
(`/addons/hmm/settings.cgi?cmd=config`, which writes the file and restarts the service), or by hand:

```sh
echo 'HMM_AUTH_MODE=rega' >> /usr/local/addons/hmm/etc/hmm.env
/usr/local/etc/config/rc.d/hmm restart
```

## The lighttpd rule

`/usr/local/etc/config/lighttpd/hmm.conf` is written at install time with the port from
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
WebSocket through the CCU's lighttpd. RedMatic has been proving that works on CCU3 firmware and
OpenCCU alike, with the Node-RED editor's socket, for years. The negative lookahead is what lets the
UI and the three CGIs share one `/addons/hmm/` prefix — everything is proxied to the backend except
the CGIs, which lighttpd runs itself. Verified on **lighttpd 1.4.50** (CCU3 firmware) and **1.4.82**
(OpenCCU).

Both firmwares include `/usr/local/etc/config/lighttpd/*.conf` — OpenCCU always, **the CCU3 firmware
since 3.61.5**. The install restarts lighttpd once after writing the file; the uninstall removes it
and restarts lighttpd again.

## Where things live

| Path | What |
| --- | --- |
| `/usr/local/addons/hmm/` | the addon: `bin/node`, `app/`, `rc.d/hmm`, `etc/`, `www/`, `var/hmm.log` |
| `/usr/local/hmm/` | the **profile**: `config.json`, the caches, `images/`, `token` (mode 600) |
| `/usr/local/etc/config/rc.d/hmm` | symlink to the service script |
| `/usr/local/etc/config/addons/www/hmm` | symlink to `www/` — this is what serves the CGIs |
| `/usr/local/etc/config/lighttpd/hmm.conf` | the proxy rule above |
| `/usr/local/etc/monit-hmm.cfg` | symlink to `etc/monit.cfg`, OpenCCU only (the CCU3 has no monit) |
| `/usr/local/etc/config/hm_addons.cfg` | one entry, so the button appears |

Nothing outside these is written, patched or linked. The bundled Node.js resolves its libraries
inside `/usr/local/addons/hmm` only, so another addon's Node (RedMatic ships one) is neither used
nor disturbed. `bin/`, `lib/`, `share/`, `app/` and `www/` carry a `.nobackup` file, so a CCU backup
keeps the configuration and not the runtime.

**`/usr/local/hmm/config.json` is the same profile format as every other install type** — the same
file the desktop app writes into its `userData` directory and the npm install writes into
`/var/lib/homematic-manager`. See [moving-between-installs.md](moving-between-installs.md).

## Update and uninstall

**Update**: upload the new package the same way. The update stops the service, replaces
`/usr/local/addons/hmm` wholesale, **keeps** `etc/hmm.env`, **keeps the profile and the token**,
rewrites the lighttpd rule and starts the service again — exit code 0, no reboot, on either
firmware. The Zusatzsoftware page shows the newest release through `update_check.cgi`.

**Uninstall** through the WebUI stops the service and removes the addon directory, both symlinks,
the lighttpd rule, the monit link and the Systemsteuerung entry. It **keeps `/usr/local/hmm`**: the
CCU configuration and the caches live there, and a reinstall picks them straight back up. To really
get rid of it, delete that directory by hand or use `uninstall purge`.

The rc.d script is the interface for everything:

```sh
/usr/local/etc/config/rc.d/hmm start|stop|restart|status
/usr/local/etc/config/rc.d/hmm uninstall          # keeps /usr/local/hmm
/usr/local/etc/config/rc.d/hmm uninstall purge    # deletes the profile as well
```

The same commands are behind `service.cgi` (`?sid=…&cmd=start|stop|restart|status|log`), and the
_Neu starten_ and _Deinstallieren_ buttons on the Zusatzsoftware page call `restart` and
`uninstall`. On OpenCCU monit restarts the process when it dies — passively, because starting it at
boot is `S98StartAddons`'s job and two backends on one port would fight over the interface
callbacks.

## Configuration

There is nothing to configure for the addon to work. Everything the *app* offers — extra interfaces
(D-13), the write pace, the language, ReGa on or off — is in its own settings dialog and is stored
in `/usr/local/hmm/config.json`.

The *host process* reads `/usr/local/addons/hmm/etc/hmm.env`, which is copied from `etc/default.env`
on the first install and never overwritten again:

```sh
HMM_PORT=8090        # loopback only; change hmm.conf with it, or re-run the update
HMM_LOG_LEVEL=info   # error, warn, info, debug
HMM_AUTH_MODE=token  # token (default) or rega - see "Optional: a login with a CCU user"
HMM_SESSION_TTL=24h  # with rega: how long a login lasts without being used
```

`HMM_AUTH_MODE` is also settable from the addon's own settings page,
`/addons/hmm/settings.cgi?cmd=config`, which is linked from the addon's entry on the Zusatzsoftware
page; it writes the same file and restarts the service.

Every option of the host has an `HMM_*` environment mirror, so anything else can be added here too.
What the rc.d script passes on the command line — `--local --ccu 127.0.0.1 --base /addons/hmm --host
127.0.0.1 --no-issue-cookie --data-dir /usr/local/hmm` — wins over the file, because those are not
settings but the definition of "we are the addon".

## Troubleshooting

| Symptom | Look at |
| --- | --- |
| The button opens a page saying the session is invalid | The WebUI session expired. Reload the WebUI and open the addon again. |
| The button opens a 503 page | The service is not running: `service.cgi?…&cmd=log`, or `/usr/local/addons/hmm/var/hmm.log`. Start it with the _Neu starten_ button. |
| The UI loads but stays disconnected | The WebSocket did not get through. `grep hmm /var/log/messages`, and check that `/usr/local/etc/config/lighttpd/hmm.conf` exists and lighttpd was restarted after the install (`/etc/init.d/S50lighttpd restart`). **CCU3 firmware older than 3.61.5 does not read that directory at all.** |
| No devices, interfaces marked red | The interface processes answer on the CCU's loopback only (D-28). `netstat -tlnp` should show 32001 / 32010; a CCU in safe mode or with `HM_MODE` other than `NORMAL` starts neither them nor addons. |
| Device pictures are missing | They come from the CCU's own `/config/img/devices/`; the app falls back to the pictures that ship in `app/data/icons/`. |
| `BidCos-Wired` shows as "not present" | `hs485d` only runs on a CCU that has a BidCos-Wired gateway, and the default interface list enables it anyway. Its port refuses the connection, so the app says so once, marks the interface as not present in the header and retries at most every five minutes. Nothing is wrong; untick BidCos-Wired in the settings dialog to be rid of the entry. |
| The QR scanner says the camera needs https | `getUserMedia` exists only in a secure context, and the addon is reached as `http://<ccu>/addons/hmm/`. Open the same page over the CCU's https port (`https://<ccu>/addons/hmm/`, accepting the certificate warning) and the scanner works; otherwise type the SGTIN and the key in by hand. |
| `Error (13)` when installing | Wrong architecture. Compare `uname -m` with the package name. |
| Everything is slow on a CCU3 | It is a 1 GB armv7 board. The addon raises its own `oom_score_adj` to 800, so the kernel takes it before it takes `rfd` or `ReGaHSS`. |

Log lines are tagged `hmm` in `/var/log/messages`; the process's own output is
`/usr/local/addons/hmm/var/hmm.log`, rotated at 1 MB.

The token itself is **not** in that log: the addon supplies it through the environment, and a
supplied token is logged at `debug` only (a generated one is printed once at `info`, because that is
the only place a user could read it).

## Size and flash budget

Measured on the lab boxes at `3.0.0-dev.0`:

| | package | installed | inodes |
| --- | --- | --- | --- |
| armv7l (musl Node 24.18.1, 18 apk packages) | 27 MB | 71.7 MB | 503 |
| aarch64 (Node 24.20.0) | 44 MB | 127 MB | 461 |
| x86_64 (Node 24.20.0) | 44 MB | 131 MB | 461 |

Almost all of it is the Node binary; the app, the UI and the device metadata together are 9.7 MB.
The `armv7l` package is the small one because Alpine's musl build is stripped and the nodejs.org
binaries are not.

**Inodes are what a CCU3 is short of**, not bytes: it has 96 256 on `/usr/local`, and a stock box
with a few addons already uses half of them. The install cost **519** of them on the lab CCU3 and
72 MB of the 2 GB partition. Backend RSS during operation was 71–100 MB depending on the box.

The generated device metadata ships **minified, not pre-gzipped** (D-30, decided by measuring this):
pretty-printed 9.62 MB, minified 7.45 MB, gzipped 0.64 MB — but all three cost the same 199 inodes,
the download differs by 50 KB because the package is a `.tar.gz` anyway, and pre-gzipping would need
a `Content-Encoding` branch in the static server that all install types share.

## What was actually tested on hardware

All three packages were installed on real boxes for `3.0.0-dev.0`: CCU3 firmware 3.89.8 on `armv7l`
(the reboot install, Tcl 8.2.3, lighttpd 1.4.50), and OpenCCU 3.89.8 on `x86_64` and on `aarch64`
(the live install). On each one: the Zusatzsoftware entry, the session check with a right and a
wrong session id, the UI and its assets through the proxy rule, the WebSocket upgrade and an API
round trip, a socket left idle for ten minutes, the `service.cgi` restart, and the device list
filling from `rfd` and `HmIPServer` on the loopback. Update, uninstall and reinstall were verified
on both OpenCCU boxes; **the CCU3-firmware box got the single reboot install only**, so update and
uninstall on that firmware rest on the container replay of `/bin/install_addon`, not on hardware.

## See also

- [moving-between-installs.md](moving-between-installs.md) — taking the profile somewhere else
- [migration-from-2.x.md](migration-from-2.x.md) — coming from Homematic Manager 2.x
- [../apps/ccu-addon/README.md](../apps/ccu-addon/README.md) — how the package is built and tested
- [../BUILD.md](../BUILD.md) — building a package from a checkout
