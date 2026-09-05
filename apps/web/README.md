# @homematic-manager/web

The Homematic Manager as a server: the backend of `packages/backend` behind a local HTTP +
WebSocket host that also serves the built UI of `packages/ui`. One process, one port, no Electron.

It has three jobs, and they are the same program:

- **development** - `npm run dev` puts a vite dev server behind this host, so the UI hot-reloads
  against a real backend and a real CCU or hm-simulator;
- **the e2e target** of task 14 - `startForTest()` starts the whole stack on a free port with a
  temporary profile directory, optionally against hm-simulator, and Playwright drives a browser
  against it in a fraction of the time an Electron run takes;
- **the third deliverable** (D-24) - published to npm, so `npm install -g` gives a Homematic
  Manager server on a Raspberry Pi next to the CCU, on a NAS or in a container; and the exact same
  process is what the CCU addon of task 13 runs behind the CCU's lighttpd.

## Install and run

```sh
npm install -g @homematic-manager/web        # the npm name is OQ-14 and may change before 3.0
homematic-manager-web --ccu ccu3.local
```

Then open <http://127.0.0.1:8090/>. The first start writes `config.json` into the profile
directory; everything about the CCU - interfaces, ReGa, callback addresses - is configured in the
UI's settings dialog, not on the command line.

From a checkout:

```sh
npm run build -w @homematic-manager/ui       # the host serves packages/ui/dist
npm run build -w @homematic-manager/web
node apps/web/dist/cli.js --ccu ccu3.local
```

## Options

Every option is also an environment variable with the `HMM_` prefix (`--data-dir` is
`HMM_DATA_DIR`, `--no-auth` is `HMM_AUTH=false`); the command line wins over the environment. There
is no configuration file - what this host needs is a port and a few paths, and everything about the
CCU lives in the backend's `config.json`. `--config-schema` prints the whole option set as JSON
Schema, which is what a configuration UI (and task 13's `settings.cgi`) should read instead of
hard-coding it.

| option | default | what it does |
| --- | --- | --- |
| `-p, --port` | `8090` | TCP port; `0` picks a free one |
| `--host` | `127.0.0.1` | bind address; `0.0.0.0` exposes the host to the network |
| `--base` | `/` | URL prefix everything is served under, e.g. `/addons/hmm/` |
| `--data-dir`, `--profile` | `~/.config/homematic-manager` | profile directory: `config.json` and the caches |
| `--ui-dir` | `packages/ui/dist`, or `ui/` next to the host | the built UI |
| `--metadata-dir` | `data/dist`, or `data/` next to the host | generated device metadata (task 9) |
| `--ui-dev-server` | - | proxy everything but the API to a vite dev server |
| `--token` | random | the token clients have to present |
| `--auth` / `--no-auth` | on | require a token on the API socket |
| `--issue-cookie` | loopback binds only | hand the token to the browser on the page load |
| `-a, --ccu` | - | CCU address; written to the configuration when it differs |
| `--local` | - | we run on the CCU itself: talk to the interface processes directly |
| `--callback-ip` | auto | address the interfaces call back to; needed where this host cannot see it (Docker) |
| `--callback-xmlrpc-port`, `--callback-binrpc-port` | free ports | fixed callback ports, so a container can publish them |
| `--demo` | off | serve the UI on its demo fixture and start no backend |
| `--log-level` | `info` | `error`, `warn`, `info`, `debug` |
| `--install` / `--uninstall` | - | systemd service; `--purge` also deletes the state |
| `--prefix` | - | write the systemd files under this root (packaging, tests) |
| `--config-schema`, `--version`, `-h, --help` | - | print and exit |

`SIGINT` and `SIGTERM` stop the host and run `backend.stop()` - the de-registration the CCU's
interface processes want - with a five second bound, so a `systemctl restart` cannot hang.

## What is served, and where

| route | what |
| --- | --- |
| `<base>api` | the WebSocket of `ApiWebSocketServer`: `ApiFrame` JSON, the only thing the UI talks to |
| `<base>images/<deviceType>` | device pictures from the CCU, cached, with the bundled webp fallback |
| `<base>data/...` | `data/dist` as plain files: metadata, profiles, translations, icons |
| `<base>...` | the built UI |

**Device images** (D-10) resolve memory → disk → CCU → bundled → 404. `data/dist/device-icons.json`
maps the (upper-cased) device type to a file name; the CCU serves it as
`/config/img/devices/50/<file>`, and what comes back is cached under `<data-dir>/images/`. When
there is no CCU - Homegear, a bare rfd, or one that is simply off - the webp subset that ships in
`data/dist/icons/` answers instead, so the app is never without pictures (D-2). The response says
which of the four it was in `X-Hmm-Image-Source`. Known limitation: with `tls` the CCU's
certificate is self-signed and `fetch` cannot be told to accept it, so such a request falls through
to the bundled picture; the addon talks plain HTTP to `127.0.0.1` and is unaffected.

**The generated metadata** is served as **static files** under `<base>data/`, not through the
backend's `data.file`: it is nine megabytes of JSON that a browser should cache like any other
asset, and base64 through the API socket would put it in the same queue as the RPC traffic. The
same directory is *also* injected as the backend's `data` file root (and `<data-dir>/images` as
`images`), so `data.file` keeps working and an Electron renderer and a browser see the same two
roots under the same names.

**Caching**: an asset whose name carries a content hash (`assets/index-C9tqDdX1.js`) is
`immutable` for a year; everything else revalidates and answers a reload with a 304. There is no
`index.html` fallback for arbitrary paths - the UI routes on the hash (`#/<interface>/<tab>`), so
`/nope` is a 404 and not the app shell - no directory listing, and a path that tries to leave its
root (`..`, an encoded `..`, a symlink pointing out) is refused.

## Authentication

The API socket is guarded by a token. The backend's `ApiWebSocketServer.authorise()` accepts it as
`?token=` on the upgrade URL or as a `Sec-WebSocket-Protocol` entry - and the UI's
`createTransport()` sends neither: it opens `ws://<host>/<base>api` and knows nothing about tokens,
and the browser `WebSocket` API cannot set headers.

So **the page load hands the token over as a cookie**, and the browser replays it on the upgrade
request of the same origin all by itself:

```
GET /            ->  200 index.html + Set-Cookie: hmm_token=…; Path=/; HttpOnly; SameSite=Strict
GET /api  (ws)   ->  Cookie: hmm_token=…   ->  rewritten to /api?token=…  ->  101
GET /api  (ws)   ->  no cookie, no ?token= ->  401
```

That needs **no change in `packages/ui`**. The cookie is translated into the query form the backend
understands in `auth.ts`, before `ws` sees the request; a request that has neither is answered with
a real 401 during the handshake, not with a socket that opens and closes again.

Who may be *handed* a cookie is the part that matters:

- `--issue-cookie` defaults to **on for a loopback bind and off otherwise**. On `127.0.0.1` the
  machine boundary is the only thing between a caller and the socket anyway, and development and
  the Playwright suites need the browser to just work.
- On any other bind - and behind the CCU's lighttpd - the cookie has to come from something that
  checked who is asking. Task 13's `settings.cgi` does the `tclrega.so` session check and sets the
  same cookie (`hmm_token`, `Path=/addons/hmm/`, `HttpOnly`, `SameSite=Strict`, `Secure`); this
  process then only *accepts* it and never issues one. Start it with `--no-issue-cookie`.
- `?token=` keeps working for everything that is not a browser: `curl`, the e2e helper, and a CGI
  that would rather put the token in the page than in a cookie.
- `--no-auth` turns the token off entirely. Only sensible on loopback.

There is **no Origin check**, deliberately: a reverse proxy forwards the browser's `Origin` and its
own `Host`, and the token - not the origin - is what guards this socket. The cookie is
`SameSite=Strict`, so a foreign page cannot make the browser send it.

## Behind a reverse proxy (task 13)

`--base /addons/hmm` serves the UI, the images, the metadata *and* the API socket under that
prefix; `/addons/hmm` without the trailing slash redirects to `/addons/hmm/`, and anything outside
the prefix is a 404. The UI needs no build-time base: it builds with `base: './'` and
`createTransport()` derives the socket URL from the page's own directory.

An idle WebSocket is pinged every 25 seconds (`--` internally `keepAliveMs`), below lighttpd's
`server.max-read-idle` / `server.max-write-idle` default of 60 seconds, so a proxied socket is not
cut for being quiet. A browser answers the ping on its own.

lighttpd, the way RedMatic proves it works on the CCU3 and OpenCCU
(`/usr/local/etc/config/lighttpd/hmm.conf`):

```lighttpd
$HTTP["url"] =~ "^/addons/hmm/" {
    proxy.server = ( "" => (( "host" => "127.0.0.1", "port" => 8090 )) )
    proxy.header = ( "upgrade" => "enable" )
}
```

nginx:

```nginx
location /addons/hmm/ {
    proxy_pass http://127.0.0.1:8090;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;   # map $http_upgrade -> "upgrade"/""
    proxy_read_timeout 3600s;
}
```

Caddy:

```caddy
handle_path /addons/hmm/* {
    reverse_proxy 127.0.0.1:8090
}
```

Start the host with `--base /addons/hmm --host 127.0.0.1 --no-issue-cookie --token "$TOKEN"`.

## As a systemd service

```sh
sudo homematic-manager-web --install --ccu ccu3.local --port 8090
```

writes

```
/etc/systemd/system/homematic-manager.service   User=, StateDirectory=, Restart=always,
                                                NoNewPrivileges, ProtectSystem=full
/etc/homematic-manager/config.env               the HMM_* variables of the options given
/var/lib/homematic-manager/                     the profile directory
```

creates the system user `homematic-manager`, then `daemon-reload` and `enable --now`. Installing
again rewrites the unit (so an `npm update -g` that moved the binary is picked up) and backs up an
existing `config.env`. `--uninstall` stops and removes the service but **keeps** `/var/lib` - the
CCU configuration and the caches live there; `--uninstall --purge` deletes those too. `--prefix
<dir>` writes everything under a fake root, which is what the tests use.

## Development

```sh
npm run dev -w @homematic-manager/web
```

starts a vite dev server for `packages/ui` on a free port and this host in front of it. Everything
that is not the API is proxied to vite - including vite's own HMR socket - so there is one origin,
the UI's relative `api` path resolves to the real backend, and editing a `.svelte` file updates the
page while the WebSocket stays up. `VITE_HMM_DEMO=false` is forced, otherwise
`packages/ui/.env.development` would put the UI on its demo fixture and the backend would have
nobody to talk to.

`--demo` is the opposite: the UI on its fixture and no backend at all, for a bug report or a look
at the app without a CCU.

## For the e2e suites (task 14)

```ts
import {startForTest, simulatorAvailable} from '@homematic-manager/web';

const host = await startForTest({simulator: true});
await page.goto(host.url); // the cookie is set by the page load, the socket connects
await host.close();        // backend, simulator and the temporary profile directory
```

Port `0`, a temporary profile directory, and `simulator: true` starts an in-process hm-simulator
with two devices and points the backend at it in `local` mode - which is the only way to reach the
simulator's rfd, because BIN-RPC exists on a CCU's loopback only (D-28). hm-simulator is not
published yet, so it is imported lazily; `await simulatorAvailable()` is what a suite gates itself
on, the same `describe.skipIf` arrangement `packages/backend/test/simulator` uses.

## The npm package

`npm pack -w apps/web` produces a self-contained tarball, about 0.9 MB compressed:

- `dist/` - this host;
- `ui/` and `data/` - the built UI and the generated metadata, copied in by `scripts/prepack.mjs`
  because npm packs nothing from outside the package directory, and put exactly where
  `defaultUiDir()` and `defaultMetadataDir()` look first;
- `node_modules/@homematic-manager/{backend,core}` - **bundled**, not published on their own. They
  are internal packages (`private: true`), their API is not a contract for anyone outside this
  repository, and three packages that must be version-locked to each other is three ways for a user
  to end up with a broken tree. `bundleDependencies` normally packs a package's own
  `node_modules/<name>` directory - but in a workspace those are symlinks hoisted to the repository
  root and npm packs nothing for them, so `prepack.mjs` materialises them as real directories first
  and `postpack.mjs` removes them again, so this checkout keeps using the symlinks.
- Their registry dependencies - `binrpc`, `homematic-rega`, `homematic-xmlrpc`, `ws` - are declared
  as dependencies of this package, so npm installs them normally. A fresh install pulls six
  packages in total.

`npm run sbom` writes a CycloneDX 1.6 document next to the tarball (D-27). It is taken from the
tree the tarball really installs - the tarball is unpacked into a temporary directory first - so
the bundled workspace packages are in it, which a plain `cyclonedx-npm` run against the repository
would never show. `release-npm.yml` publishes with npm trusted publishing (OIDC, no token secret)
and attests both the provenance and the SBOM; CI packs and builds the SBOM on every push so a
broken `files` list is found before a tag.

## Tests

```sh
npx vitest run --project web      # from the repository root, or:
npm test -w @homematic-manager/web
```

The suites cover static serving (MIME types, immutable caching, 304, traversal, no listing), the
token on the upgrade in all three forms, an `ApiFrame` round trip over a real WebSocket against a
real `Backend`, the image proxy against a fake CCU, the base path behind a real reverse proxy in
the test, the dev-server proxy including its upgrade, the CLI and its environment variables, the
systemd installer against a fake root with a stubbed `systemctl`, and the graceful shutdown.
Coverage is reported, never enforced (D-12).
