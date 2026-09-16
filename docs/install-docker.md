# Homematic Manager in Docker

The image is `ghcr.io/hobbyquaker/homematic-manager`, built for `linux/amd64`, `linux/arm64` and
`linux/arm/v7`. It contains the same program the `homematic-manager` npm package does: the backend of
`packages/backend` behind an HTTP/WebSocket host serving the built UI, running as the unprivileged
`node` user with `/data` as its state directory. Base image `node:22-alpine`, two build stages, about
59 MB on amd64 and arm64 and 55 MB on arm/v7.

Contents: [The callback](#the-one-thing-to-get-right-the-callback) ·
[Host networking](#variant-1-recommended-host-networking) ·
[Bridge with published ports](#variant-2-bridge-network-with-published-ports) ·
[The CCU's firewall](#the-ccus-own-firewall) · [Configuration](#configuration) ·
[Authentication](#authentication-and-what-the-default-means) · [State, updates, logs](#state-updates-logs) ·
[Verifying what you pulled](#verifying-what-you-pulled-d-27) · [Troubleshooting](#troubleshooting) ·
[When Docker is the wrong answer](#when-docker-is-the-wrong-answer)

> **3.0 is available as a beta.** `ghcr.io/hobbyquaker/homematic-manager:3.0.0-beta.4` is
> published (multi-arch); `latest` still points nowhere useful until 3.0.0, so name the tag. The
> image's SBOM is an asset of [the current beta's release](https://github.com/hobbyquaker/homematic-manager/releases). CI builds the amd64 image on every push and
> checks `--version`, `--demo` and the SBOM; a checkout builds it with `docker build .`
> ([BUILD.md](../BUILD.md)).

## The one thing to get right: the callback

The CCU does not answer questions the app asks and then go quiet. Every interface process is told,
in its `init` call, an **address and port to push events to**, and it opens a connection _back_ to
that address. So a Homematic Manager that the CCU cannot reach shows its interfaces as connected
and receives no state changes at all.

That is easy on a normal host and easy to get wrong in a container, because a container on a bridge
network sees `172.17.0.2` as its own address and announces exactly that. Hence the two variants
below.

## Variant 1 (recommended): host networking

The container shares the host's network stack. The backend sees the host's real addresses and takes
the one in the CCU's network (or the one on the route to the CCU), the CCU reaches the callback ports
at the host, and nothing has to be published or configured.

```sh
docker run -d --name homematic-manager \
    --network host \
    -v homematic-manager-data:/data \
    -e HMM_CCU=ccu3.local \
    --restart unless-stopped \
    ghcr.io/hobbyquaker/homematic-manager:latest
```

Then open <http://the-docker-host:8090/>.

`--network host` is Linux only. Docker Desktop on macOS and Windows has no real host network, and
neither has Podman in a rootless user namespace with the default settings.

## Variant 2: bridge network with published ports

Two things have to be added: the address the CCU should call back to, and the two callback ports,
published **unchanged** — the CCU connects to precisely the port it was told, so `-p 12031:2031`
would not work.

```sh
docker run -d --name homematic-manager \
    -p 8090:8090 -p 2031:2031 -p 2032:2032 \
    -v homematic-manager-data:/data \
    -e HMM_CCU=ccu3.local \
    -e HMM_CALLBACK_IP=192.168.1.10 \
    --restart unless-stopped \
    ghcr.io/hobbyquaker/homematic-manager:latest
```

`HMM_CALLBACK_IP` is the address of the **Docker host** on the CCU's network, not the container's.
`2031` is the XML-RPC callback (every built-in interface off the CCU speaks XML-RPC, D-28) and
`2032` the BIN-RPC one (CUxD, which is its own daemon on port 8701). They are the image's defaults,
the same pair the CCU addon uses; change them with `HMM_CALLBACK_XMLRPC_PORT` and
`HMM_CALLBACK_BINRPC_PORT` and publish whatever you set.

> **Changed in 3.0.0-beta.16:** until beta.15 the image used **2126/2127**, which is also
> hm2mqtt.js's default pair. A container that publishes `-p 2126:2126 -p 2127:2127` receives no
> events after the update: change the mapping to `2031`/`2032`, or keep the old pair with
> `-e HMM_CALLBACK_XMLRPC_PORT=2126 -e HMM_CALLBACK_BINRPC_PORT=2127`. With `--network host` nothing
> has to change, unless a firewall on the Docker host opens the callback ports by number.

What is set this way wins over the settings dialog: `HMM_CALLBACK_IP` and the two ports are shown
there read-only with "Set at start (`HMM_CALLBACK_XMLRPC_PORT` / `--callback-xmlrpc-port`)", and a
value saved in the dialog before stays in `/data/config.json` without effect for as long as the
variable is set (the log says so once at start). The interface popup in the header shows, under each
interface, the callback URL the CCU was told — `http://192.168.1.10:2031` — with "Publish this port
unchanged" beside it.

`compose.yml` in the repository root has both variants written out.

## The CCU's own firewall

`Settings → Control panel → Security → Firewall`: "Remote Homematic-Script API" and "XML-RPC API"
have to allow the Docker host's address (`Restricted access` with the address in the list, or
`Full access` on a trusted LAN). The callback direction is outbound from the CCU, so nothing else
needs opening there — but a firewall on the Docker host does need the callback ports open.

ReGa ("Remote Homematic-Script API") is optional (D-2): without it the app works fully and uses
locally stored names instead of the CCU's.

## Configuration

Everything is an `HMM_*` environment variable, and each one mirrors a command line option one to
one (`--data-dir` is `HMM_DATA_DIR`, `--no-auth` is `HMM_AUTH=false`). `docker run --rm
ghcr.io/hobbyquaker/homematic-manager --help` prints the whole list, `--config-schema` prints it as
JSON Schema.

Only what a container cannot work out for itself belongs here. Everything about the CCU —
interfaces, ReGa, the language, the write pace, the callback address once it is reachable — is
configured in the UI's settings dialog and stored in `/data/config.json`. That file is the same
profile format every other install type uses; see
[moving-between-installs.md](moving-between-installs.md).

The image sets these by default:

| variable | default | why |
| --- | --- | --- |
| `HMM_HOST` | `0.0.0.0` | a container's loopback is nobody's |
| `HMM_PORT` | `8090` | |
| `HMM_DATA_DIR` | `/data` | the volume |
| `HMM_ISSUE_COOKIE` | `true` | see below |
| `HMM_CALLBACK_XMLRPC_PORT` | `2031` | a freely picked port cannot be published; the addon's pair (2126 until beta.15) |
| `HMM_CALLBACK_BINRPC_PORT` | `2032` | likewise (2127 until beta.15) |
| `HMM_IN_CONTAINER` | `true` | the interface popup reminds you to publish the callback ports unchanged |

## Authentication, and what the default means

The API socket is guarded by a token. A browser cannot set headers on a WebSocket, so the page load
hands the token over as a cookie and the browser replays it on the upgrade of the same origin. The
host issues that cookie **only on a loopback bind** by default — and a container never binds
loopback, so the image turns cookie issuing on explicitly. Without it the UI would load and its
socket would be refused with a 401.

The consequence is plain: **whoever can reach the published port is in.** On a home LAN that is the
same position 2.x was in. Where it is not acceptable:

- put a reverse proxy with `auth.require` / `auth_basic` in front and let it be the gate — see
  [lighttpd-homematic-manager.conf](lighttpd-homematic-manager.conf),
  [nginx-homematic-manager.conf](nginx-homematic-manager.conf) and
  [Caddyfile-homematic-manager](Caddyfile-homematic-manager);
- publish `8090` on the loopback of the Docker host only (`-p 127.0.0.1:8090:8090`) and reach it
  through that proxy or an SSH tunnel;
- set `HMM_ISSUE_COOKIE=false` and `HMM_TOKEN=<something long>`, and open the UI once as
  `http://host:8090/?token=<the token>`; nothing else will get in.

**This default is decided (D-41, 2026-09-09): the image keeps `true`.** So that it is never a
surprise, the host prints one warning line at start whenever it issues the cookie on a bind that is
not the loopback — which in a container is every start with the default — naming the three ways
above. The host itself never terminates TLS and cannot see a reverse proxy in front of it, so the
line appears in a locked-down setup as well; `HMM_ISSUE_COOKIE=false` is what silences it, and
behind a proxy that issues the token that is the right setting anyway.

## Idle unsubscribe (D-31)

After five minutes with no browser page open, the backend de-registers from the CCU's interface
processes (`init('')` per interface) and stops polling for service messages; the next page load
subscribes again and shows "subscribing" in the header for a moment while the devices are re-read.
Configuration, names and caches are untouched. It is on by default; `--idle-unsubscribe 0` /
`HMM_IDLE_UNSUBSCRIBE=0` keeps the subscriptions up permanently, which is what to do if the point
of the installation is to watch events around the clock.

## State, updates, logs

`/data` holds `config.json`, the per-CCU caches, the device image cache and the write log. Keep it
on a named volume or a bind mount — a fresh one means configuring the CCU again.

```sh
docker compose pull && docker compose up -d      # update
docker logs -f homematic-manager                 # logs; HMM_LOG_LEVEL=debug says more
docker exec homematic-manager cat /data/config.json
```

The container stops on `SIGTERM` by de-registering from the interface processes first (a bounded
`backend.stop()`), which is what keeps the CCU from pushing events at a port nobody is listening on
any more. `docker stop` gives it ten seconds by default; that is enough.

## Verifying what you pulled (D-27)

Every published image carries an SBOM and a provenance statement, and the CycloneDX file is a
release asset as well:

```sh
gh attestation verify oci://ghcr.io/hobbyquaker/homematic-manager:3.0.0 \
    --repo hobbyquaker/homematic-manager
docker buildx imagetools inspect ghcr.io/hobbyquaker/homematic-manager:3.0.0 \
    --format '{{ json .SBOM }}'
```

The `latest` tag is not moved by a pre-release, so an alpha or beta never becomes what a plain
`docker pull` gets.

## Troubleshooting

| Symptom | Look at |
| --- | --- |
| The UI loads and stays disconnected | The socket was refused. With `HMM_ISSUE_COOKIE=false` and no `?token=` that is expected; otherwise check a reverse proxy in front passes the upgrade through. |
| Interfaces green, no state ever changes | The callback. On a bridge network `HMM_CALLBACK_IP` must be the **Docker host's** address, and 2031/2032 must be published unchanged. The interface popup shows the callback URL each interface was given; that address and port are what the CCU connects to. `--network host` avoids the whole question. |
| No events after the update to beta.16 | The image's callback ports moved from 2126/2127 to 2031/2032. Publish `-p 2031:2031 -p 2032:2032` instead, or set `HMM_CALLBACK_XMLRPC_PORT=2126` and `HMM_CALLBACK_BINRPC_PORT=2127` to keep the old mapping. |
| Interfaces stay red | The CCU's XML-RPC API firewall setting, or the wrong `HMM_CCU`. |
| Everything is gone after a recreate | `/data` was not on a volume. |
| Port 2031 or 2032 already in use | The log says `callback server: the xmlrpc port 2031 set by HMM_CALLBACK_XMLRPC_PORT / --callback-xmlrpc-port is in use`, and the interface popup shows "Callback port 2031 is in use" under every interface of that protocol. They stay unsubscribed: a fixed port never falls back to a free one, because a free port is one nobody published. Typically a second Homematic Manager container on the same host network. Move one with `HMM_CALLBACK_XMLRPC_PORT` / `HMM_CALLBACK_BINRPC_PORT`, publish what you set, and restart. |
| Device pictures are missing | They are fetched from the CCU and cached in `/data/images`. With TLS the CCU's certificate is self-signed and cannot be accepted, so the small bundled set answers instead. |
| The QR scanner says the camera needs https | Browsers hand out a camera in a secure context only: https, or `localhost`. Reach the UI over https (a reverse proxy with a certificate, see above) or open it on the machine itself; otherwise type the SGTIN and the key in by hand. |
| `--network host` does nothing useful | Docker Desktop on macOS/Windows and rootless Podman have no real host network. Use variant 2, or run in an LXC or a VM. |

## When Docker is the wrong answer

The callback is why the recommended server deployment is a Proxmox LXC and not a container: an LXC
has no NAT, so the address the backend finds is the address the CCU reaches, and nothing has to be
told anything. See [install-lxc.md](install-lxc.md).

And if the CCU is the only machine in the house that runs all the time, skip the server altogether:
the [CCU addon](install-addon.md) is the same program on the CCU itself.
