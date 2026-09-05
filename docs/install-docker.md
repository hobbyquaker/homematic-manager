# Homematic Manager in Docker

The image is `ghcr.io/hobbyquaker/homematic-manager`, built for `linux/amd64`, `linux/arm64` and
`linux/arm/v7`. It contains the same program the npm package does: the backend of
`packages/backend` behind an HTTP/WebSocket host serving the built UI, running as the unprivileged
`node` user with `/data` as its state directory.

Task 16 will polish this page. It is meant to be correct rather than complete.

## The one thing to get right: the callback

The CCU does not answer questions the app asks and then go quiet. Every interface process is told,
in its `init` call, an **address and port to push events to**, and it opens a connection *back* to
that address. So a Homematic Manager that the CCU cannot reach shows its interfaces as connected
and receives no state changes at all.

That is easy on a normal host and easy to get wrong in a container, because a container on a bridge
network sees `172.17.0.2` as its own address and announces exactly that. Hence the two variants
below.

## Variant 1 (recommended): host networking

The container shares the host's network stack. The backend sees the host's real addresses, the CCU
reaches the callback ports at the host, and nothing has to be published or configured.

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
published **unchanged** - the CCU connects to precisely the port it was told, so `-p 12126:2126`
would not work.

```sh
docker run -d --name homematic-manager \
    -p 8090:8090 -p 2126:2126 -p 2127:2127 \
    -v homematic-manager-data:/data \
    -e HMM_CCU=ccu3.local \
    -e HMM_CALLBACK_IP=192.168.1.10 \
    --restart unless-stopped \
    ghcr.io/hobbyquaker/homematic-manager:latest
```

`HMM_CALLBACK_IP` is the address of the **Docker host** on the CCU's network, not the container's.
`2126` is the XML-RPC callback (every built-in interface off the CCU speaks XML-RPC) and `2127` the
BIN-RPC one (CUxD, which is its own daemon on port 8701). They are the image's defaults; change
them with `HMM_CALLBACK_XMLRPC_PORT` and `HMM_CALLBACK_BINRPC_PORT` and publish whatever you set -
hm2mqtt.js uses the same pair, so one of the two has to move when both run on the same host.

`compose.yml` in the repository root has both variants written out.

## The CCU's own firewall

`Settings → Control panel → Security → Firewall`: "Remote Homematic-Script API" and "XML-RPC API"
have to allow the Docker host's address (`Restricted access` with the address in the list, or
`Full access` on a trusted LAN). The callback direction is outbound from the CCU, so nothing else
needs opening there - but a firewall on the Docker host does need the callback ports open.

## Configuration

Everything is an `HMM_*` environment variable, and each one mirrors a command line option one to
one (`--data-dir` is `HMM_DATA_DIR`, `--no-auth` is `HMM_AUTH=false`). `docker run --rm
ghcr.io/hobbyquaker/homematic-manager --help` prints the whole list, `--config-schema` prints it as
JSON Schema.

Only what a container cannot work out for itself belongs here. Everything about the CCU -
interfaces, ReGa, the callback address once it is reachable - is configured in the UI's settings
dialog and stored in `/data/config.json`.

The image sets these by default:

| variable                    | default | why                                                       |
| --------------------------- | ------- | --------------------------------------------------------- |
| `HMM_HOST`                  | `0.0.0.0` | a container's loopback is nobody's                       |
| `HMM_PORT`                  | `8090`  |                                                           |
| `HMM_DATA_DIR`              | `/data` | the volume                                                |
| `HMM_ISSUE_COOKIE`          | `true`  | see below                                                 |
| `HMM_CALLBACK_XMLRPC_PORT`  | `2126`  | a freely picked port cannot be published                   |
| `HMM_CALLBACK_BINRPC_PORT`  | `2127`  | likewise                                                   |

## Authentication, and what the default means

The API socket is guarded by a token. A browser cannot set headers on a WebSocket, so the page load
hands the token over as a cookie and the browser replays it on the upgrade of the same origin. The
host issues that cookie **only on a loopback bind** by default - and a container never binds
loopback, so the image turns cookie issuing on explicitly. Without it the UI would load and its
socket would be refused with a 401.

The consequence is plain: **whoever can reach the published port is in.** On a home LAN that is the
same position 2.x was in. Where it is not acceptable:

- put a reverse proxy with `auth.require` / `auth_basic` in front and let it be the gate - see
  `docs/lighttpd-homematic-manager.conf`, `docs/nginx-homematic-manager.conf` and
  `docs/Caddyfile-homematic-manager`;
- publish `8090` on the loopback of the Docker host only (`-p 127.0.0.1:8090:8090`) and reach it
  through that proxy or an SSH tunnel;
- set `HMM_ISSUE_COOKIE=false` and `HMM_TOKEN=<something long>`, and open the UI once as
  `http://host:8090/?token=<the token>`; nothing else will get in.

## State, updates, logs

`/data` holds `config.json`, the per-CCU caches, the device image cache and the write log. Keep it
on a named volume or a bind mount - a fresh one means configuring the CCU again.

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

## When Docker is the wrong answer

The callback is why the recommended server deployment is a Proxmox LXC and not a container: an LXC
has no NAT, so the address the backend finds is the address the CCU reaches, and nothing has to be
told anything. See [install-lxc.md](install-lxc.md).
