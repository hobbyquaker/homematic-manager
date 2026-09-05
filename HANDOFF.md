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
  every push to `3.0-dev` once Actions is enabled), 12 (web host, npm package with `--install`,
  `release-npm.yml`, Docker image, compose, proxy docs, `release-docker.yml`), 8 (UI feature
  parity: every 2.7 tab in `packages/ui`, 445 component tests, browser mode green), 6 (lab study: `docs/config-pending.md`,
  `devices.repairConfig`, hm-simulator calibrated; M1 complete). Lab state after the study is in
  the private lab note (one DRS8 channel poisoned on purpose, needs re-pairing). Workspace was green at the last full run: 73 test files,
  1082 tests, `npm run lint`, `npm run typecheck`.
- In progress by two background subagents (Opus), each committing distinct commits on
  `3.0-dev` in the shared working tree (each stages only its own files):
  - **Task 13** CCU addon (started after task 6 landed): packages per architecture with the
    bundled musl Node, tclsh CGIs, lighttpd WebSocket proxy rule, container tests, `addon.yml`
    and `release-addon.yml`; then lab installs on the two OpenCCU boxes and, after messaging the
    main session, one install on the Charly (CCU3 firmware, reboot).
  - **Task 14** test infrastructure (started after task 8 landed): Playwright in CI, browser
    mode as the default for component tests (D-23), e2e suites against the web host + simulator,
    Electron smoke per OS, coverage merge and report, `strictTypeChecked` lint for `packages/ui`,
    shellcheck for the addon scripts.
  - **Task 10** device-specific editors, initial set (started with task 14): plug-ins on
    `packages/ui/src/lib/util/paramsetForm.ts` (weekly programs, thermostat week profiles,
    enum extensions, blind calibration, time pickers).
- If a session ends with those agents mid-flight: uncommitted files in the working tree are
  theirs. Look at `git status`, `git diff`, run `npm test -w <workspace>`; either finish the
  piece and commit it with an explanatory message, or `git stash` it with a note here. Do not
  discard it silently.

## What the maintainer still has to do (agent cannot)

- Enable GitHub Actions on `hobbyquaker/homematic-manager` (the API call was blocked for the
  agent). Until then, no CI and no Windows build artifact from `build.yml`.
- Push `~/repos/hm-simulator` branch `1.0-dev` (now 12 commits incl. task 6's calibration) and tag `v1.0.0-dev.0` (`release.yml` publishes
  with npm OIDC). Until then the backend installs it with
  `npm install --no-save /home/basti/repos/hm-simulator` and the simulator tests are
  `describe.skipIf`.
- Decide OQ-14 (npm name for the web host package; recommendation: reuse `homematic-manager`).

## Next steps, in order

1. When tasks 13, 14 and 10 finish: verify (`npm run lint && npm run typecheck && npm test` in WSL,
   with the simulator installed), write `roadmap-archive/task-{6,11,12}.md`, tick them in the
   ROADMAP Contents, update the status line at the top of ROADMAP.md, commit, push `3.0-dev`
   (task 11 is archived and pushed already: `69cab48`).
2. After 13/14/10: tasks 15 (backlog features), 16 (docs), 17 (beta). The first Electron
   click-through and the first dev bump (`npm run version:dev`, D-18) happen as soon as the
   maintainer enables Actions and a `build.yml` run has produced the Windows artifact.
3. Task 13 is running (see above); task 14 (test infra, Playwright in
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
