# Homematic Manager in a Proxmox LXC

This is the recommended server deployment (D-25). An unprivileged LXC container on Debian 12 or 13
gets a real address on the LAN, so the callback the CCU pushes its events to needs no NAT, no port
publishing and no configuration - which is the one thing that is fiddly about Docker.

Task 16 will polish this page. It is meant to be correct rather than complete.

## 1. The container

Proxmox → *Create CT*, or from the shell of the Proxmox host:

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

2 cores, 1 GB RAM and 8 GB disk are comfortable; the app itself needs far less. Unprivileged is
right - nothing here wants host capabilities. Give it a **fixed address or a DHCP reservation**:
the CCU's firewall list and the callback both refer to it.

`nesting=1` is only needed if you also want to run something containerised inside; leave it off
otherwise.

## 2. Node 22

Debian 13 has Node 22 in the archive:

```sh
apt update && apt install -y nodejs npm
node --version    # v22.x or newer is what package.json requires
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

`--install` needs root and does the whole thing (it is the pattern of `she` and hm2mqtt.js):

- creates the system user `homematic-manager`;
- writes `/etc/homematic-manager/config.env` from the options given, generating a token if none was
  and **printing it once** - write it down;
- writes `/etc/systemd/system/homematic-manager.service` with `User=`,
  `StateDirectory=homematic-manager`, `EnvironmentFile=`, `Restart=always`, `NoNewPrivileges=true`
  and `ProtectSystem=full`;
- `systemctl daemon-reload`, then `enable --now`.

State - `config.json`, the caches, the device images, the write log - lives in
`/var/lib/homematic-manager`.

```sh
systemctl status homematic-manager
journalctl -u homematic-manager -f
```

Open <http://the-container:8090/>. Running `--install` again rewrites the unit (so an
`npm update -g` that moved the binary is picked up) and keeps the configuration; `--uninstall`
removes the service and keeps `/var/lib`, `--uninstall --purge` deletes that too.

### The token, and who gets to see the UI

The host hands the token to the browser as a cookie on the page load, but only for a loopback bind.
With `--host 0.0.0.0` it does not, so pick one:

- `--issue-cookie` as well, and let the LAN be the boundary (what 2.x effectively did); or
- keep it off, put a reverse proxy with authentication in front and bind loopback only:
  `--host 127.0.0.1 --base /hmm/ --no-issue-cookie`. See
  [lighttpd-homematic-manager.conf](lighttpd-homematic-manager.conf),
  [nginx-homematic-manager.conf](nginx-homematic-manager.conf) and
  [Caddyfile-homematic-manager](Caddyfile-homematic-manager).

Every option is also an `HMM_*` environment variable, so `/etc/homematic-manager/config.env` is
where you change any of this afterwards; `systemctl restart homematic-manager` picks it up.

## 4. The CCU's firewall

`Settings → Control panel → Security → Firewall`:

- **XML-RPC API**: `Restricted access` with the container's address in the list (or
  `Full access` on a trusted LAN). Without this the interface processes refuse the connection.
- **Remote Homematic-Script API**: the same, if ReGa should supply the friendly names. ReGa is
  optional (D-2) - without it the app works fully and uses locally stored names.

The events travel the other way: the CCU *connects out* to the container on the callback ports, so
nothing has to be opened on the CCU for that. What matters is that the **container** is reachable
from the CCU. In an LXC that is automatic; there is no NAT and no port mapping. If you run a
firewall on the container or in Proxmox's firewall rules, the callback ports have to be open there.

By default the callback ports are picked freely at start. Pin them if a firewall rule needs fixed
numbers:

```sh
homematic-manager-web --install --ccu ccu3.local --host 0.0.0.0 \
    --callback-xmlrpc-port 2126 --callback-binrpc-port 2127
```

`--callback-ip` is not needed here - the backend finds the container's address itself, and offers
the candidates in the settings dialog. That option exists for the case an LXC does not have:
a container behind NAT.

## 5. Checking that events actually arrive

The interfaces show as connected in the UI's status bar, and a device that is switched physically
updates in the device list within a second. If the interfaces connect but nothing ever changes, the
callback is the thing to look at - the CCU could reach the app but not the other way round.

```sh
journalctl -u homematic-manager -f          # with HMM_LOG_LEVEL=debug in config.env
ss -lntp | grep -i node                     # the ports the callback servers took
```

## Backup

`/var/lib/homematic-manager` and `/etc/homematic-manager/config.env` are everything. A Proxmox
container backup covers both; `vzdump 210` on the host is the one-liner.
