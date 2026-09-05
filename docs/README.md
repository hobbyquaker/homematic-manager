# Documentation

The user-facing documentation of the Homematic Manager. The starting point is the
[README](../Readme.md), which has the install matrix; this is the index of everything else.

## Installing

One page per install type of D-25. All four run the same backend and the same UI and share one
`config.json` format.

| Page | For |
| --- | --- |
| [install-addon.md](install-addon.md) | the **CCU addon** — CCU3 firmware ≥ 3.61.5, ELV-Charly, OpenCCU, in three architectures |
| [install-electron.md](install-electron.md) | the **desktop app** — Windows, macOS, Linux |
| [install-lxc.md](install-lxc.md) | the **npm package with a systemd service**, in a Proxmox LXC — the recommended server deployment |
| [install-docker.md](install-docker.md) | the **Docker image**, and what the CCU's event callback means in a container |
| [moving-between-installs.md](moving-between-installs.md) | taking a profile from one of those to another, and what does not travel with it |

Reverse-proxy examples for the two server install types, commented with what each one has to pass
through and why the token is still required behind it:

- [lighttpd-homematic-manager.conf](lighttpd-homematic-manager.conf)
- [nginx-homematic-manager.conf](nginx-homematic-manager.conf)
- [Caddyfile-homematic-manager](Caddyfile-homematic-manager)

## Coming from 2.x

- [migration-from-2.x.md](migration-from-2.x.md) — where 2.x kept its configuration, what the
  one-time import takes over, what changed in behaviour and which issue each answers.
- [../CHANGELOG.md](../CHANGELOG.md) — everything that changed, grouped by what a user notices.

## Understanding what the app does to your devices

- [config-pending.md](config-pending.md) — the lab study of the paramset write path: what `rfd` and
  `hmipserver` really do with a bad `putParamset`, why a channel can end up permanently unwritable,
  which recoveries work on which interface, and what was **not** tested.

## Building and contributing

- [../BUILD.md](../BUILD.md) — the monorepo, the scripts, the tests, the release workflows, the
  SBOMs and the lab scripts.
- [../AGENTS.md](../AGENTS.md) — the working rules for this repository.

## Background

- [../ROADMAP.md](../ROADMAP.md) — the plan for 3.0: tasks, the decisions **D-1..D-30** and the open
  questions **OQ-n**.
- [../roadmap-archive/](../roadmap-archive/) — one report per finished task, with what was done,
  measured and found. Where a page here says something was measured, this is where the number comes
  from.
- [analysis-2026-09.md](analysis-2026-09.md) — the analysis the plan is built on: the state of the
  2.x code, the feature inventory to preserve, the write-path problem, and the issue triage.
- [../data/README.md](../data/README.md) and [../data/NOTICE.md](../data/NOTICE.md) — where the
  device metadata comes from, how it is renewed, and under which terms it may be used.
- [upstream/](upstream/) — the two library bugs found while building 3.0, as patches for `binrpc`
  and `homematic-xmlrpc`: what each one is, what was measured, and which repository and file it
  belongs in.

## Screenshots

`hmm1.png`, `hmm2.png` and `hmm3.png` in this directory are the ones the README shows, and
`hmm1-dark.png`, `hmm2-dark.png`, `hmm3-dark.png` are the same three in the dark theme (D-22).
They are taken from the running 3.0 UI by [`../tools/screenshots.mjs`](../tools/screenshots.mjs)
(`npm run screenshots`), which starts `apps/web` in `--demo` mode and drives chromium through the
three workflows at 1280×800 in German. Nothing in them comes from a real installation. Re-run the
script rather than editing an image; the header of the script says what each shot shows.
