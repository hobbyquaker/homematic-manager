# Building the Homematic Manager

Everything below happens in a checkout of this repository. If you only want to _use_ the program,
the [README](Readme.md) has the install matrix; this page is for building it, changing it and
releasing it.

Contents: [Requirements](#requirements) · [Layout](#layout) · [First build](#first-build) ·
[The scripts](#the-scripts) · [Building each deliverable](#building-each-deliverable) ·
[Tests](#tests) · [hm-simulator](#hm-simulator) · [Versioning](#versioning-d-18) ·
[Release workflows](#release-workflows-d-24) · [SBOMs and attestations](#sboms-and-attestations-d-27) ·
[Lab scripts](#lab-scripts) · [Where the plan lives](#where-the-plan-lives)

## Requirements

- **Node ≥ 22.12** (`engines`), and `.nvmrc` says **24**, which is what CI uses for everything except
  the test matrix (Node 22 and 24).
- A **Linux shell**. On Windows use WSL, not PowerShell: the repository commits **LF only**
  (`.gitattributes` sets `eol=lf`), and a CRLF, a BOM or a lost execute bit breaks the CCU addon's
  busybox `sh` and its Tcl CGIs silently.
- For the CCU addon package: `curl`, `tar`, and `patchelf` for the `armv7l` runtime. For its CGI
  tests: `tclsh` (a plain Debian has none — there is a test image for that). For the container
  replay: Docker.
- For the browser-based tests: `npx playwright install chromium`. `npm ci` does not fetch browsers.
- Electron 44 no longer downloads its binary in `postinstall`; run `npx install-electron` before
  working on the desktop app.

## Layout

npm workspaces, one lockfile at the root, every package at the same version:

| Path               | Package                        | What it is                                                                                                                                                                                                                                                                                                                |
| ------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`    | `@homematic-manager/core`      | pure domain logic, no I/O and no DOM: the interface table, the address and device model, paramset descriptions, `cast`/`validate`, the changed-only diff, the easy-mode and profile engine, the link role matrix, service messages, RSSI, i18n, the RPC method catalogue, and the API contract every other package speaks |
| `packages/backend` | `@homematic-manager/backend`   | Node: XML-RPC and BIN-RPC clients and callback servers, init/ping/re-init, the persisted caches, optional ReGa, UDP discovery, the paced write queue, and one transport-agnostic API                                                                                                                                      |
| `packages/ui`      | `@homematic-manager/ui`        | Svelte 5 components and stores; talks to a `Transport` (Electron IPC or WebSocket) and never to Node                                                                                                                                                                                                                      |
| `apps/electron`    | `@homematic-manager/electron`  | the desktop app: backend in the main process, UI in the renderer, typed IPC between them, electron-builder targets                                                                                                                                                                                                        |
| `apps/web`         | `homematic-manager`            | the same backend behind an HTTP/WebSocket host serving the built UI: development mode, the e2e target, the npm deliverable, and the process the CCU addon runs. Unscoped and published under the 2.x npm name (D-33), so address it as `-w apps/web` — the workspace root has the same name                               |
| `apps/ccu-addon`   | `@homematic-manager/ccu-addon` | the addon package: bundled musl Node, `rc.d`, monit, Tcl CGIs with the WebUI session check, the lighttpd rule                                                                                                                                                                                                             |
| `data`             | `@homematic-manager/data`      | pinned openccu-data artifacts, the converter, and the committed result under `data/dist/` — **not** AGPL, see [data/NOTICE.md](data/NOTICE.md)                                                                                                                                                                            |
| `legacy/`          | —                              | the 2.7.1 code, reference only. Never built, never linted, deleted when 3.0 ships                                                                                                                                                                                                                                         |
| `tools/lab/`       | —                              | scripts that talk to real hardware, run by hand, never in CI                                                                                                                                                                                                                                                              |
| `roadmap-archive/` | —                              | one report per finished roadmap task                                                                                                                                                                                                                                                                                      |

The workspace packages depend on each other with **exact** versions, and `@homematic-manager/core`,
`backend`, `ui` and `data` are **not published separately** (D-29): the npm deliverable bundles them
into its own tarball, so there is no way to end up with a mismatched tree.

## First build

```sh
npm ci                 # installs the whole workspace from the lockfile
npm run build          # every workspace that has a build script, in order
npm test               # 1739 tests in 112 files at the last full run
npm run lint
npm run typecheck
```

`npm ci` is fast (a couple of seconds) because no Electron binary is downloaded.

## The scripts

At the root:

| Command                               | What it does                                                                                                                                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`                       | `npm run build --workspaces --if-present`: `tsc -b` for core, backend, web and the addon, `vite build` for the UI, `electron-vite build` for the desktop app; `data` only prints that `dist/` is committed |
| `npm run lint`                        | `eslint .` and `prettier --check .`                                                                                                                                                                        |
| `npm run lint:fix` / `npm run format` | the same with `--fix` / `--write`                                                                                                                                                                          |
| `npm run typecheck`                   | `tsc -b`, the e2e project, then each workspace's own (`svelte-check` for the UI and the Electron renderer, which `tsc -b` cannot cover because they import `.svelte`)                                      |
| `npm test`                            | vitest across every workspace project                                                                                                                                                                      |
| `npm run test:cov`                    | the same with v8 coverage. Coverage is **reported, never enforced** (D-12); targets are core 100 %, backend ≥ 95 %, ui ≥ 95 %, reviewed by hand                                                            |
| `npm run test:e2e`                    | Playwright against the web host (`--project=web`)                                                                                                                                                          |
| `npm run test:e2e:electron`           | the Electron smoke suites                                                                                                                                                                                  |
| `npm run coverage:report`             | merges the unit, component and e2e coverage into one report                                                                                                                                                |
| `npm run screenshots`                 | the six README screenshots, from the UI in `--demo` mode; needs `npm run build` first ([`tools/screenshots.mjs`](tools/screenshots.mjs))                                                                   |
| `npm run version:dev`                 | the version bump, see [below](#versioning-d-18)                                                                                                                                                            |

Per workspace (`npm run <script> -w <package>`):

| Package                          | Scripts                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| `@homematic-manager/ui`          | `dev` (the UI on its demo fixture), `build`, `preview`, `typecheck`, `test:browser`, `test:jsdom` |
| `@homematic-manager/electron`    | `dev`, `build`, `start`, `typecheck`, `dist`, `dist:linux`, `dist:mac`, `dist:win`, `sbom`        |
| `homematic-manager` (`apps/web`) | `build`, `dev` (vite dev server behind the real host), `start`, `prepack`/`postpack`, `sbom`      |
| `@homematic-manager/backend`     | `build`, `test:sim` (the hm-simulator suites alone)                                               |
| `@homematic-manager/ccu-addon`   | `build`, `package`, `test:cgi`, `test:package`, `test:container`                                  |
| `@homematic-manager/data`        | `fetch`, `convert`, `update`, `compare-legacy`, `icons-subset`, `test`                            |

## Building each deliverable

### The desktop app

```sh
npm ci
npx install-electron
npm run dev -w @homematic-manager/electron     # renderer with HMR, backend in-process, real CCU
npm run build                                  # every workspace first
npm run dist -w @homematic-manager/electron    # this platform
npm run dist:linux -w @homematic-manager/electron
```

Output lands in `apps/electron/dist-electron/` (git-ignored). electron-builder downloads the
Electron binary of the target platform itself. Cross-building works in one direction that matters:
Linux arm64 builds on an x64 runner; the macOS universal build needs a macOS runner; Windows
installers are built on Windows.

### The web host and the npm package

```sh
npm run build -w @homematic-manager/ui
npm run build -w apps/web
node apps/web/dist/cli.js --ccu ccu3.local
npm pack -w apps/web                           # homematic-manager-<version>.tgz, ~1.2 MB
npm run sbom -w apps/web
```

`prepack.mjs` copies the built UI and `data/dist` into the package and materialises the bundled
workspace packages as real directories (in a workspace they are symlinks that npm would pack
nothing for); `postpack.mjs` puts the symlinks back.

`npm run dev -w apps/web` is the development mode: a vite dev server for `packages/ui` behind the
real host, so there is one origin, the UI's relative `api` path reaches the real backend, and editing
a `.svelte` file updates the page while the WebSocket stays up.

### The Docker image

```sh
docker build -t homematic-manager:dev .
docker run --rm homematic-manager:dev --version
```

Two stages on `node:22-alpine`; the second stage installs the packed tarball globally and runs as a
non-root user with `/data` as its state directory. `compose.yml` has the host-network and the
published-ports variants.

### The CCU addon

```sh
npm run build                                  # the UI and the metadata the package carries
apps/ccu-addon/build.sh x86_64                 # or aarch64, or armv7l
```

The result is `apps/ccu-addon/out/hmm-ccu-<arch>-<version>.tar.gz` with its `.sha256` and its SBOM.
`build-runtime.sh` assembles the bundled Node: the stock nodejs.org tarball for `aarch64` and
`x86_64`, and for `armv7l` the Alpine musl build with its loader and libraries copied in and
`patchelf`'ed to resolve everything inside `/usr/local/addons/hmm` — the CCU3's glibc 2.27 cannot run
any nodejs.org binary since Node 18, and nodejs.org stopped building `armv7l` after v23.
`alpine-packages.js` resolves the apk dependency closure from `APKINDEX` without an `apk` binary or a
container.

### The device metadata

`data/dist/` is **committed**, so a fresh checkout never has to fetch anything. Regenerating it is a
deliberate act:

```sh
npm run fetch -w @homematic-manager/data       # into the git-ignored data/upstream/, sha256-checked
npm run convert -w @homematic-manager/data
```

The pin is the point: without `-- --update-hashes` a changed upstream artifact is an error. The full
procedure is in [data/README.md](data/README.md).

## Tests

- **Unit and component tests** run with vitest across every workspace. `packages/ui`'s component
  tests run in headless Chromium by default (D-23; `npx playwright install chromium` first) and the
  same suites also pass in jsdom (`npm run test:jsdom -w @homematic-manager/ui`).
- **e2e** drives a browser against the web host with hm-simulator behind it
  (`npm run test:e2e`), which is a fraction of the time an Electron run takes; the Electron smoke
  suites are `npm run test:e2e:electron`.
- **The addon** has three layers that need no CCU: `test:cgi` runs every CGI against a Tcl stub for
  `tclrega.so` (including a grep for Tcl constructs newer than 8.2, which is what the CCU3 firmware
  has), `test:package` unpacks a built package into the layout a CCU installs it into and checks the
  SBOM against it, and `test:container` replays OpenCCU's `/bin/install_addon` in a container with
  busybox as `/bin/sh`, a real lighttpd and a compiled stub `tclrega.so` — install, update,
  uninstall, the session check, the proxy rule, the WebSocket upgrade and an idle socket.
- **Beyond that there is only hardware.** See [Lab scripts](#lab-scripts).

`ci.yml` runs lint, the test matrix on Node 22 and 24, the web e2e suites, the merged coverage
report, an `npm pack` with its SBOM and an amd64 Docker build with its SBOM, on every push and pull
request. `addon.yml` builds the three addon packages on every push. `build.yml` packages the desktop
app for all three platforms on every push to `3.0-dev` and keeps the artifacts for 14 days (D-21),
which is how the maintainer gets a dev build without cutting a release.

## hm-simulator

The backend's integration suites and the web e2e suites drive
[hm-simulator](https://github.com/hobbyquaker/hm-simulator) over real sockets. Since 1.0.0 it is on
npm and a devDependency of `packages/backend` and `apps/web`, so `npm ci` installs it and nothing
has to be done by hand.

The suites still gate themselves on `describe.skipIf(!simulatorAvailable)` (and
`await simulatorAvailable()` in the web host's helper) so a checkout with a pruned dev tree stays
green — but `SIMULATOR_REQUIRED=1` turns every such skip into a failure, and CI sets it on the test,
coverage and e2e steps. A suite that quietly disappears from a green run is the thing that variable
exists to prevent.

To try a change to the simulator before it is published, point npm at a checkout:

```sh
npm install --no-save ~/repos/hm-simulator
```

## Versioning (D-18)

3.0 development runs at `3.0.0-dev.n`; every dev build bumps the counter:

```sh
npm run version:dev
```

`scripts/version-dev.mjs` runs `npm version prerelease --preid dev --no-git-tag-version` at the root
and writes the same version into every workspace `package.json`, **including the exact
`"@homematic-manager/core": "3.0.0-dev.n"` ranges the workspaces pin each other with** — leaving
those behind would break the next `npm ci`. It does not commit, tag, push or publish.

The series is `3.0.0-dev.n` → `3.0.0-alpha.n` → `3.0.0-beta.n` → `3.0.0`. One commit per significant
change, with a message that explains _why_; no squashed "WIP" commits. **Tags, releases and pushes to
`master` are the maintainer's**, never an agent's; pushing the `3.0-dev` branch for CI and artifact
builds is fine (D-21).

## Release workflows (D-24)

Four deliverables, four workflows, four failure domains. **None has a `needs:` on any other**, so one
failing never blocks or rolls back the others, and any one can be re-run alone:

| Workflow               | Deliverable                                                                    | Trigger            | Re-run alone                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `release-electron.yml` | the installers for the three platforms, attached to the release                | push of a `v*` tag | `workflow_dispatch` with `tag` = the existing tag, e.g. `v3.0.0-beta.1`                                                      |
| `release-npm.yml`      | the npm package, published with **trusted publishing** (OIDC, no token secret) | push of a `v*` tag | the same                                                                                                                     |
| `release-docker.yml`   | the multi-arch image to ghcr.io (`amd64`, `arm64`, `arm/v7`)                   | push of a `v*` tag | the same                                                                                                                     |
| `release-addon.yml`    | the three addon packages, attached to the release                              | push of a `v*` tag | the same; and inside it `fail-fast: false` per architecture, so a broken `armv7l` runtime still ships the two glibc packages |

Whichever workflow gets there first **creates the GitHub release as a draft**, and the others attach
to it. It is published by the maintainer, deliberately: `electron-updater` polls the latest
_published_ release, so publishing one whose installers are still uploading would offer every running
app an update it cannot download. `latest` on the Docker tag is not moved by a pre-release.

**None of the four has ever run.** GitHub Actions is not enabled on the repository yet, and no tag
exists. The npm publish additionally needs the trusted publisher configured once on npmjs.com for the
package (repository `hobbyquaker/homematic-manager`, workflow `release-npm.yml`); until that is done
the publish step fails with `ENEEDAUTH`, which is the intended failure and not a reason to add a
token secret.

## SBOMs and attestations (D-27)

Every release artefact ships a CycloneDX 1.6 JSON named `<artefact>.cdx.json`, and every one is
signed as a GitHub artifact attestation, so anyone can check a downloaded file offline:

```sh
gh attestation verify <file> --repo hobbyquaker/homematic-manager
gh attestation verify oci://ghcr.io/hobbyquaker/homematic-manager:<version> \
    --repo hobbyquaker/homematic-manager
```

The SBOMs list **what is really inside the artefact**, not only the npm tree — which for these
deliverables is a small minority of the bytes:

- the **Electron installers**: Electron, its Chromium, Node and V8 as four separate components (a CVE
  feed is searched for "chromium 152", not for "electron 44"), plus the packaging tools
  electron-builder downloaded for that build, plus the installer itself as `metadata.component` with
  its SHA-512;
- the **npm tarball**: generated from the tree the tarball really installs — it is unpacked into a
  temporary directory first — so the bundled workspace packages are in it, which a plain scan of the
  repository would never show;
- the **Docker image**: syft's SBOM and a full SLSA provenance statement in the registry
  (`sbom: true`, `provenance: mode=max`), plus the same content as a CycloneDX file on the release —
  it covers the Alpine packages of the base image and the Node binary inside it;
- the **addon packages**: the npm tree of `app/` merged with the bundled Node version and, on
  `armv7l`, the Alpine packages as `pkg:apk/alpine/...` components.

The SBOM steps run on **every push build** as well, so a broken one is found before a tag rather than
during a release. The Electron SBOM script fails when the document has fewer components than a floor
or no Electron runtime in it. The release checklist verifies that every asset has its `.cdx.json` and
that `gh attestation verify` passes for each; a release with a missing SBOM is not published.

## Lab scripts

`tools/lab/` holds the scripts that talk to **real hardware**. They are run by hand from a shell,
never from CI, and they are written so that nothing about the lab ends up in the repository: every
host, alias, device address and credential comes from the command line or the environment, no script
contains one, and the private lab note lives outside the repository. A script that grows a default
host has a bug.

What is there and how to run it is [tools/lab/README.md](tools/lab/README.md). Read
[docs/config-pending.md](docs/config-pending.md) and
[roadmap-archive/task-6.md](roadmap-archive/task-6.md) before pointing the write-path study at a
device you care about: it provokes bad writes on purpose, and one lab channel was poisoned to the
point where only re-pairing the device recovers it.

## Where the plan lives

- [ROADMAP.md](ROADMAP.md) — the tasks, the decisions **D-1..D-30** and the open questions
  **OQ-n**. A decision is only changed by the maintainer, and the change is recorded there with its
  date.
- [roadmap-archive/](roadmap-archive/) — one file per finished task (`task-N.md`) with what was done,
  what was measured and what was found. Task numbers are stable and never reused; a dropped task
  keeps its number. These are the primary record: where a document here says something was measured,
  the number comes from one of them.
- [docs/analysis-2026-09.md](docs/analysis-2026-09.md) — the analysis the plan is built on, including
  the feature inventory and the issue triage.
- [AGENTS.md](AGENTS.md) — the working rules, which apply to humans too: LF only, one commit per
  change with a message that says why, and nothing about the lab in the repository.
- [docs/README.md](docs/README.md) — the index of the user-facing documentation.
