# Homematic Manager in a Proxmox LXC

This is the **recommended server deployment** (D-25). An unprivileged LXC container on Debian 12 or
13 gets a real address on the LAN, so the callback the CCU pushes its events to needs no NAT, no port
publishing and no configuration — which is the one thing that is fiddly about
[Docker](install-docker.md).

Nothing on this page is specific to Proxmox beyond section 1: a Debian VM, a Raspberry Pi next to
the CCU or a NAS with Node on it all work the same way, and the `--install` step is the same.

Contents: [The container](#1-the-container) · [Node](#2-node-22) ·
[Install and register the service](#3-install-and-register-the-service) ·
[The token, and who gets to see the UI](#the-token-and-who-gets-to-see-the-ui) ·
[The CCU's firewall](#4-the-ccus-firewall) ·
[Checking that events arrive](#5-checking-that-events-actually-arrive) ·
[Update, backup, uninstall](#update-backup-uninstall) · [Troubleshooting](#troubleshooting)

> **There is no release of 3.0 yet.** `release-npm.yml` publishes with npm trusted publishing (OIDC)
> on a `v*` tag and has never run, so the package is not on the registry. Until then the same tarball
> comes out of a checkout with `npm pack -w apps/web` — see [BUILD.md](../BUILD.md).
>
> **The npm package name is still open (OQ-14).** In the workspace it is `@homematic-manager/web`;
> the roadmap recommends reusing the 2.x name `homematic-manager`, whose `npm i -g` audience wanted a
> headless install anyway. It is decided before the first alpha tag. The binary is
> `homematic-manager-web` either way.

## 1. The container

Proxmox → _Create CT_, or from the shell of the Proxmox host:

```sh
pct create 210 local:vztmpl/debian-13-standard_13.0-1_amd64.tar.zst \
    --hostname homematic-manager \
    --cores 2 --memory 1024 --swap 512 \
    --rootfs local-lvm:8 \
    --net0 name=eth0,bridge=vmbr0,ip=dhcp \
    --unprivileged 1 --features nesting=1 \
    --onboot 1
pct start 210
pct enter 210
```

2 cores, 1 GB RAM and 8 GB disk are comfortable; the app itself needs far less (the backend's
resident size on a CCU is 71–100 MB). Unprivileged is right — nothing here wants host capabilities.
Give it a **fixed address or a DHCP reservation**: the CCU's firewall list and the callback both
refer to it.

`nesting=1` is only needed if you also want to run something containerised inside; leave it off
otherwise.

## 2. Node 22

Debian 13 has Node 22 in the archive:

```sh
apt update && apt install -y nodejs npm
node --version    # v22.12 or newer is what package.json requires
```

On Debian 12, whose `nodejs` is too old, use NodeSource:

```sh
apt update && apt install -y curl ca-certificates
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
```

## 3. Install and register the service

```sh
npm install -g @homematic-manager/web        # the npm name is OQ-14 and may still change
homematic-manager-web --install --ccu ccu3.local --host 0.0.0.0
```

`--install` needs root and does the whole thing (it is the pattern of
[she](https://github.com/hobbyquaker/she) and
[hm2mqtt.js](https://github.com/hobbyquaker/hm2mqtt.js)):

- creates the system user `homematic-manager`;
- writes `/etc/homematic-manager/config.env` from the options given, generating a token if none was
  and **printing it once** — write it down;
- writes `/etc/systemd/system/homematic-manager.service` with `User=`,
  `StateDirectory=homematic-manager`, `EnvironmentFile=`, `Restart=always`, `NoNewPrivileges=true`
  and `ProtectSystem=full`;
- `systemctl daemon-reload`, then `enable --now`.

State — `config.json`, the caches, the device images, the write log — lives in
`/var/lib/homematic-manager`. That `config.json` is the same profile format every other install type
uses; see [moving-between-installs.md](moving-between-installs.md).

```sh
systemctl status homematic-manager
journalctl -u homematic-manager -f
```

Open <http://the-container:8090/>. Running `--install` again rewrites the unit (so an
`npm update -g` that moved the binary is picked up) and backs up the existing `config.env`;
`--uninstall` removes the service and keeps `/var/lib`, `--uninstall --purge` deletes that too.

Without `--install` the same binary runs in the foreground on a normal user account and keeps its
profile in `~/.config/homematic-manager`:

```sh
homematic-manager-web --ccu ccu3.local
```

### The token, and who gets to see the UI

The API socket is guarded by a token, and the host hands that token to the browser as a cookie on the
page load — but **only for a loopback bind**. With `--host 0.0.0.0` it does not, so pick one:

- `--issue-cookie` as well, and let the LAN be the boundary (which is effectively what 2.x did); or
- keep it off, put a reverse proxy with authentication in front and bind loopback only:
  `--host 127.0.0.1 --base /hmm/ --no-issue-cookie`. See
  [lighttpd-homematic-manager.conf](lighttpd-homematic-manager.conf),
  [nginx-homematic-manager.conf](nginx-homematic-manager.conf) and
  [Caddyfile-homematic-manager](Caddyfile-homematic-manager); or
- keep the cookie off and open the UI once with the token in the URL:
  `http://the-container:8090/?token=<the token printed at install>`.

`--no-auth` turns the token off entirely and is only sensible on a loopback bind.

Every option is also an `HMM_*` environment variable, so `/etc/homematic-manager/config.env` is where
you change any of this afterwards; `systemctl restart homematic-manager` picks it up.
`homematic-manager-web --help` prints the full list, `--config-schema` prints it as JSON Schema
(which is what a configuration UI should read rather than hard-coding the options).

Only what the *host process* needs belongs in `config.env`. Everything about the CCU — interfaces,
ReGa, the callback address, the language, the write pace — is configured in the UI's settings dialog
and stored in `/var/lib/homematic-manager/config.json`.

## 4. The CCU's firewall

`Settings → Control panel → Security → Firewall`:

- **XML-RPC API**: `Restricted access` with the container's address in the list (or `Full access` on
  a trusted LAN). Without this the interface processes refuse the connection.
- **Remote Homematic-Script API**: the same, if ReGa should supply the friendly names. ReGa is
  optional (D-2) — without it the app works fully and uses locally stored names.

The events travel the other way: the CCU _connects out_ to the container on the callback ports, so
nothing has to be opened on the CCU for that. What matters is that the **container** is reachable
from the CCU. In an LXC that is automatic; there is no NAT and no port mapping. If you run a firewall
on the container or in Proxmox's firewall rules, the callback ports have to be open there.

By default the callback ports are picked freely at start. Pin them if a firewall rule needs fixed
numbers:

```sh
homematic-manager-web --install --ccu ccu3.local --host 0.0.0.0 \
    --callback-xmlrpc-port 2126 --callback-binrpc-port 2127
```

Those two numbers are also hm2mqtt.js's defaults, so one of the two has to move if both run on the
same box.

`--callback-ip` is not needed here — the backend finds the container's address itself and offers the
candidates in the settings dialog. That option exists for the case an LXC does not have: a container
behind NAT.

## 5. Checking that events actually arrive

The interfaces show as connected in the UI's status bar, and a device that is switched physically
updates in the device list within a second. If the interfaces connect but nothing ever changes, the
callback is the thing to look at — the CCU could reach the app but not the other way round.

```sh
journalctl -u homematic-manager -f          # with HMM_LOG_LEVEL=debug in config.env
ss -lntp | grep -i node                     # the ports the callback servers took
```

## Idle unsubscribe (D-31)

After five minutes with no browser page open, the backend de-registers from the CCU's interface
processes (`init('')` per interface) and stops polling for service messages; the next page load
subscribes again and shows "subscribing" in the header for a moment while the devices are re-read.
Configuration, names and caches are untouched. It is on by default; `--idle-unsubscribe 0` /
`HMM_IDLE_UNSUBSCRIBE=0` keeps the subscriptions up permanently, which is what to do if the point
of the installation is to watch events around the clock.

## Update, backup, uninstall

```sh
npm update -g @homematic-manager/web
homematic-manager-web --install             # rewrites the unit, keeps the configuration
systemctl restart homematic-manager
```

`/var/lib/homematic-manager` and `/etc/homematic-manager/config.env` are the whole backup. A Proxmox
container backup covers both; `vzdump 210` on the host is the one-liner.

```sh
homematic-manager-web --uninstall           # stops and removes the service, keeps /var/lib
homematic-manager-web --uninstall --purge   # and deletes /var/lib as well
npm uninstall -g @homematic-manager/web
```

### Verifying what you installed (D-27)

The published package carries npm provenance, and a CycloneDX 1.6 SBOM of the **real tarball** — the
tarball is unpacked into a temporary directory first, so the bundled workspace packages are in the
SBOM, which a plain scan of the repository would never show — is attached to the release and attested:

```sh
npm view @homematic-manager/web dist.attestations
gh attestation verify homematic-manager-web-<version>.tgz --repo hobbyquaker/homematic-manager
```

The tarball is self-contained on purpose: `@homematic-manager/backend` and `core` are **bundled**
into it rather than published separately (D-29), so there is no way to end up with a mismatched tree.
A fresh install pulls six packages in total.

## Troubleshooting

| Symptom | Look at |
| --- | --- |
| The UI loads, then says it is disconnected | The API socket was refused (401). With a non-loopback bind no cookie is issued: use `--issue-cookie`, or open the UI once with `?token=…`. See [above](#the-token-and-who-gets-to-see-the-ui). |
| The service does not start | `journalctl -u homematic-manager -n 50`. A port already in use and a profile directory the service user cannot write are the two usual ones. |
| Interfaces stay red | The CCU's XML-RPC API firewall setting, or a wrong address in the settings dialog. `--ccu` only seeds it on the first start. |
| Interfaces are green, nothing ever updates | The callback: the CCU cannot reach the container. Check the container's own firewall and Proxmox's, and pin the callback ports if a rule needs fixed numbers. |
| `BidCos-Wired` shows as "not present" | `hs485d` runs only on a CCU with a wired gateway, and the default interface list enables it anyway. One warning line, then a retry at most every five minutes. Untick BidCos-Wired in the settings dialog to hide it. |
| The QR scanner says the camera needs https | Browsers hand out a camera in a secure context only: https, or `localhost`. Reach the UI over https (a reverse proxy with a certificate, see above) or open it on the machine itself; otherwise type the SGTIN and the key in by hand. |
| Names are missing, ReGa shows red | ReGa is optional (D-2). Allow "Remote Homematic-Script API" in the CCU's firewall to get the CCU's names, or carry on with the local ones. |
| Device pictures are missing | They are fetched from the CCU and cached under `/var/lib/homematic-manager/images`. With TLS the CCU's self-signed certificate cannot be accepted, and a small bundled set answers instead. |
| The callback ports collide with hm2mqtt | Both default to 2126/2127. Move one of them. |

## See also

- [install-docker.md](install-docker.md) — the same program in a container, and why the callback
  makes it the harder option
- [moving-between-installs.md](moving-between-installs.md) — bringing a profile from the desktop app
  or the CCU addon
- [../apps/web/README.md](../apps/web/README.md) — the full option table and how the host works
