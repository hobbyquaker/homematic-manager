# Agent instructions for the Homematic Manager

The Homematic Manager configures and administers Homematic and HomematicIP devices: devices and
channels, direct links, paramsets, RSSI, service messages, events and an RPC console. Version 3 is
a rebuild of the 2.7.1 code on current Electron, Svelte 5 and a tested TypeScript core, delivered
as a desktop app **and** as a CCU3 / OpenCCU addon.

**Read [ROADMAP.md](ROADMAP.md) before making changes**, and work on the task you were given, not
next to it. Task numbers are stable and are never reused. A finished task moves to
`roadmap-archive/task-N.md` with what was done, measured and found, and its line in the roadmap
contents gets a ✅ marker. Decisions are **D-n**, open questions **OQ-n**; a decision is only
changed by the maintainer, and the change is recorded in the roadmap with its date. The analysis
the plan is built on is [docs/analysis-2026-09.md](docs/analysis-2026-09.md).

## Layout

- `packages/core`: pure domain logic, no I/O and no DOM - interface table, address/channel model,
  device index, paramset descriptions, `cast`/`validate`, paramset diff, easy-mode and profile
  engine, link role matrix, service-message and RSSI model, i18n, RPC method catalogue.
- `packages/backend`: Node - XML-RPC/BIN-RPC clients and callback servers, init/ping/re-init,
  caches with persistence, optional ReGa, UDP discovery, the paced write queue, and one
  transport-agnostic API (typed request/response plus an event stream).
- `packages/ui`: Svelte 5 components and stores; talks to a `Transport` (Electron IPC or
  WebSocket) and never to Node directly.
- `apps/electron`: electron-vite host - main (backend in-process, typed IPC), preload (context
  isolation on), renderer (`packages/ui`); electron-builder targets.
- `apps/web`: the backend as a local HTTP/WebSocket server serving the built UI - development mode,
  the fast e2e target, and the process that runs on the CCU.
- `apps/ccu-addon`: the addon package (bundled musl Node, `rc.d`, monit, tclsh CGIs with the WebUI
  session check, lighttpd proxy).
- `data/`: pinned openccu-data artifacts and the converter. Not AGPLv3 - see `data/NOTICE.md`.
- `legacy/`: the 2.7.1 code, reference only, never built or linted, deleted when 3.0 ships.
- `scripts/version-dev.mjs`: the version bump (see below). CI: `.github/workflows/ci.yml`.

## Rules

- **Always use a Linux shell (WSL on Windows), never PowerShell**, and commit LF only: CRLF, BOMs
  and lost execute bits break the addon's busybox `sh` and tclsh silently, and they poison diffs.
  `.gitattributes` enforces `eol=lf`; verify before committing.
- **D-18 version and commits**: 3.0 development runs at `3.0.0-dev.n`; every dev build bumps the
  counter with `npm run version:dev` (then `3.0.0-alpha.n`, `3.0.0-beta.n`, `3.0.0`). One commit
  per significant change, with a message that explains _why_; no squashed "WIP" commits. **Never
  tag, release, publish or push to `master`** without the maintainer - releases are cut by the
  maintainer and the workflows. Pushing the `3.0-dev` branch for CI and artifact builds is allowed
  (D-21); only the main session pushes, subagents never do.
- **D-1 protocols**: the app talks XML-RPC / BIN-RPC to the interface processes, plus optional ReGa
  scripts. The CCU JSON-API is out; do not reintroduce it.
- **D-2 ReGa is optional**: it supplies friendly names (and later service-message acknowledgement).
  Systems without it - Homegear, bare rfd/hmipserver - must work fully, and a ReGa failure degrades
  to local names with a status indicator. It is never fatal and never throws into the UI.
- **D-3 keep the UX**: same tabs, grids, dialogs and workflows as 2.7. The implementation is
  replaced, the design is not. When in doubt, look at `legacy/www/js/homematic-manager.js` - it is
  the only specification of the old behaviour that exists.
- **Writes are dangerous**: `putParamset` sends only changed, validated parameters (task 6). Never
  widen that; devices end up in `CONFIG_PENDING` when it goes wrong.
- Tests belong to the change that introduces them (TDD). Coverage is reported, never enforced
  (D-12): targets are core 100 %, backend 95 %, ui 95 %, reviewed by hand.
- **Lab details never go into the repository**, the wiki or issues: CCU addresses, credentials and
  the private lab note stay outside. Refer to "the lab", not to hosts.
- **Report faithfully.** Say what was run, what passed, what failed and what was skipped. Do not
  claim hardware was tested when only the simulator was, and do not paper over a red check.

- Versions (D-18, D-35): every significant change bumps the number behind `-dev` with
  `npm run version:dev`. Only the main session bumps, at the end of an archived task or feature
  batch, in its own commit before pushing; subagents never run the bump (it rewrites every
  package.json and the lockfile).
- `git commit` takes the whole index. In the shared working tree another agent may have staged
  files at any moment, so commit with explicit paths (`git commit -- <files>`) or stage and commit
  in one uninterrupted shell invocation; commit `23da912` swallowed sixteen files of task 15
  that way.
- `HANDOFF.md` is the resume point for a new session: read it before `ROADMAP.md` when there is no conversation history. The main session refreshes it about every half hour and after each archived task; keep it short and never put decisions there.
