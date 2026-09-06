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
  parity: every 2.7 tab in `packages/ui`, 445 component tests, browser mode green), 18 (optional
  addon login against ReGa, D-32: implemented, container-tested, and checked on the x86_64 box
  with the admin user), 17 agent side (screenshots, announcement, release checklist, hardware
  checklist with D-31 timings, OQ-16 = A-17, version `3.0.0-dev.1`), 14 (test
  infrastructure: browser mode default, 20 Playwright e2e specs, merged coverage, strict UI lint,
  shellcheck), 15 (backlog: #124 change set, #87, #26, #25, #21, #54, #94, #97 BidCos, D-31 idle
  unsubscribe, image chain in the backend, hm-simulator 1.0.0 from npm; 1820 tests in the
  workspace), 10 (five
  device-specific editors; OQ-16 weekday bit order to check in the lab), 16 (docs: README with
  the install matrix, one page per install type, migration notes, BUILD.md, CHANGELOG.md), 13 (CCU
  addon: three packages, container replay, all three lab boxes checked; the Charly runs the
  addon now, pre-image-fix build), 6 (lab study: `docs/config-pending.md`,
  `devices.repairConfig`, hm-simulator calibrated; M1 complete). Lab state after the study is in
  the private lab note (one DRS8 channel poisoned on purpose, needs re-pairing). Workspace was green at the last full run: 73 test files,
  1082 tests, `npm run lint`, `npm run typecheck`.
- In progress by background subagents (Opus), committing distinct commits on
  `3.0-dev` in the shared working tree (each stages only its own files):
  - none; task 21 (interface popup) is archived at `3.0.0-dev.6` and deployed to the x86_64 box.
    The Electron investigation is archived (`roadmap-archive/task-11-electron-startup.md`):
    the quit no-op, the early smoke wait, the image scheme and the unpackaged data path are fixed
    at `3.0.0-dev.5`.
  - Tasks 19 and 20 (UI after the maintainer.s first and second look) are archived; version
    `3.0.0-dev.4` is deployed to the x86_64 lab box.
    Next lab run: a live `install_addon` update on the CCU3 box (the `/proc/1/root` start path
    is container-tested only), and the task 18 login with a lower-level CCU user.
- If a session ends with those agents mid-flight: uncommitted files in the working tree are
  theirs. Look at `git status`, `git diff`, run `npm test -w <workspace>`; either finish the
  piece and commit it with an explanatory message, or `git stash` it with a note here. Do not
  discard it silently.

## What the maintainer still has to do (agent cannot)

- GitHub Actions is enabled (2026-09-06) and npm trusted publishing is configured for the
  `homematic-manager` name; the trusted publisher on npmjs.com must name the workflow file
  `release-npm.yml` (it was entered as `release.yml`). Workflow dispatch does not work while
  `master` lacks the workflow files; the push trigger on `3.0-dev` does.
- hm-simulator 1.0.0 is published (2026-09-05, tag `v1.0.0`, branch `1.0-dev` pushed; `master`
  of that repository still points at 0.1.1 and wants a fast-forward). Task 15 switches the
  backend to the registry package and makes a missing simulator a CI failure. Later simulator
  changes (task 15 adds `setTempKey`) are committed on `1.0-dev` and released as 1.0.1 by the
  main session on request.
- OQ-14 decided as D-33 (2026-09-06): the npm package is `homematic-manager`, trusted publishing configured; the npmjs.com publisher entry must name `release-npm.yml`.

## Next steps, in order

1. When a task finishes: verify (`npm run lint && npm run typecheck && npm test` in WSL,
   with the simulator installed), write `roadmap-archive/task-{6,11,12}.md`, tick them in the
   ROADMAP Contents, update the status line at the top of ROADMAP.md, commit, push `3.0-dev`
   (task 11 is archived and pushed already: `69cab48`).
2. The beta itself: follow `docs/release-checklist.md` once the maintainer has enabled Actions
   and decided OQ-15; the agent side of task 17 is done. hm-simulator 1.0.1 release on
   request. Was: tasks 15 (backlog features), 16 (docs), 17 (beta). The first Electron
   click-through and the first dev bump (`npm run version:dev`, D-18) happen as soon as the
   maintainer enables Actions and a `build.yml` run has produced the Windows artifact.
3. Task 13 is done; task 14 (test infra, Playwright in
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
