# Handoff — 2026-09-05

Where the 3.0 rebuild stands, so that a new session (after a usage-limit pause, on another
machine, with no conversation history) can continue without re-deriving anything. Refreshed
about every half hour while the agent works; the timestamp above is the last refresh.

## Read first

1. `AGENTS.md` — the rules (WSL only, LF, D-18 versioning, never tag/release/publish/push to
   `master`; pushing `3.0-dev` is allowed for the main session, D-21).
2. `ROADMAP.md` — decisions D-1..D-27, tasks 2–17, effort, open questions OQ-12..OQ-14, lab notes.
   Done tasks are ticked in the Contents; each has a report in `roadmap-archive/task-N.md`.
3. `docs/analysis-2026-09.md` — the analysis the roadmap is built on (only when a decision needs
   its background).
4. The private lab note `~/repos/redmatic-lab.md` (never in the repo) — lab boxes, credentials,
   which BidCos-RF devices sit where.

## State of the branch

- Branch `3.0-dev`, version `3.0.0-dev.0`, pushed up to `69cab48` (task 11 archive). Push again
  with `git push origin 3.0-dev` from WSL after each archived task; nothing on the branch is
  secret.
- Done and archived: tasks 2 (foundation), 3 (core), 4 (backend), 5 (hm-simulator 1.0), 7 (UI
  foundation), 9 (data pipeline), 11 (Electron host; `build.yml` builds the desktop artifacts on
  every push to `3.0-dev` once Actions is enabled). Workspace was green at the last full run: 73 test files,
  1082 tests, `npm run lint`, `npm run typecheck`.
- In progress by three background subagents (Opus), each committing distinct commits on
  `3.0-dev` in the shared working tree (each stages only its own files):
  - **Task 6** write-safety lab study: lab boxes only, never a production CCU, no deletes, no
    install mode. Deliverables: `docs/config-pending.md`, calibrated hm-simulator faults,
    `devices.repairConfig`, fix for two unhandled rejections in
    `packages/backend/src/write/queue.test.ts`.
  - **Task 12** web host `apps/web`: uncommitted work in `apps/web/src/index.ts`,
    `index.test.ts`, `package.json`, `tsconfig.json`; the agent was told about the base path
    for the addon proxy, D-24/D-25 (npm package, `--install`, Dockerfile, proxy examples) and
    D-27 (SBOMs), with permission to stop after host + base path + npm packaging + `--install`
    and report the rest.
  - **Task 8** UI feature parity (started after task 11 was archived): tab by tab in
    `packages/ui`, additive API changes in core/backend, `API_EVENT_NAMES` export from core,
    host bridge consumers (update notice, About, device images). Expected to take the longest.
- If a session ends with those agents mid-flight: uncommitted files in the working tree are
  theirs. Look at `git status`, `git diff`, run `npm test -w <workspace>`; either finish the
  piece and commit it with an explanatory message, or `git stash` it with a note here. Do not
  discard it silently.

## What the maintainer still has to do (agent cannot)

- Enable GitHub Actions on `hobbyquaker/homematic-manager` (the API call was blocked for the
  agent). Until then, no CI and no Windows build artifact from `build.yml`.
- Push `~/repos/hm-simulator` branch `1.0-dev` and tag `v1.0.0-dev.0` (`release.yml` publishes
  with npm OIDC). Until then the backend installs it with
  `npm install --no-save /home/basti/repos/hm-simulator` and the simulator tests are
  `describe.skipIf`.
- Decide OQ-14 (npm name for the web host package; recommendation: reuse `homematic-manager`).

## Next steps, in order

1. When task 6, 12 (and later 8) finish: verify (`npm run lint && npm run typecheck && npm test` in WSL,
   with the simulator installed), write `roadmap-archive/task-{6,11,12}.md`, tick them in the
   ROADMAP Contents, update the status line at the top of ROADMAP.md, commit, push `3.0-dev`
   (task 11 is archived and pushed already: `69cab48`).
2. Task 8 is running (see above); when it finishes, verify and archive it the same way.
3. Task 13 (CCU addon) can start once task 12 has landed; task 14 (test infra, Playwright in
   CI, browser mode default) after 8/11/12; then 10, 15, 16, 17.
4. Bump `npm run version:dev` when a dev build is cut for the maintainer (D-18).

## Environment (short form; details in the memory note and AGENTS.md)

- Repo lives in WSL Debian at `/home/basti/repos/homematic-manager`; from Windows it is
  `\\wsl.localhost\Debian\home\basti\repos\homematic-manager`.
- Every git/gh/npm call goes through `wsl.exe -d Debian -- bash -c '...'`. The Windows→WSL
  command line drops `$vars` and executes backticks: write scripts to `/tmp/<name>.sh` (Windows
  path `\\wsl.localhost\Debian\tmp\`), run after `sed -i 's/\r$//'`.
- Files written from Windows can carry CRLF: normalise before committing.
- Commits: `git -c core.autocrlf=false commit`, one commit per significant change, trailer
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Subagents: Opus 5, one task each, they commit themselves; only the main session pushes.

## Decisions made today that are easy to miss

D-18 (3.0.0-dev.n, distinct commits), D-19 (no HVL), D-20 (no Homegear-specific work), D-21
(push `3.0-dev` for CI), D-22 (dark mode required), D-23 (jsdom default, browser mode later),
D-24 (four independent release pipelines), D-25 (install matrix: addon ×3, Docker, npm
`--install` with Proxmox LXC recommended, Electron ×3), D-26 (AGPL-3.0-or-later; `legacy/`
stays GPL-3.0 with its contributors), D-27 (CycloneDX SBOM + attestation for every artefact).
Hard constraints from the maintainer: no JSON-API, XML/BIN-RPC and ReGa scripts only; ReGa
strictly optional.
