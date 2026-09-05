# Task 16: Documentation (done 2026-09-05)

Seven documentation-only commits on `3.0-dev` from `d4b0f54` (README) to `e0af3ac` (BUILD.md lab
section linking `tools/lab/README.md`).

## What was written

`Readme.md` for 3.0 (German user-facing with an English section, as 2.7 had): the D-25 install
matrix as one table, a feature overview per tab, what 3.0 does differently, a documentation index
and the D-26 licence split; the 2.7 screenshots kept and captioned as such. `docs/install-addon.md`
(everything task 13 listed: per-architecture table with `uname -m`, `Error (13)`, checksum and
attestation verification, OpenCCU live versus CCU3 reboot install, token/cookie flow, lighttpd
rule with the ≥ 3.61.5 requirement, update and uninstall keeping `/usr/local/hmm`,
troubleshooting, inode and flash budget), `docs/install-electron.md` (per-OS download, SmartScreen
workaround until SignPath, notarisation state, confirm-only updater, `host.json`, profile and cache
locations), `docs/install-lxc.md` and `docs/install-docker.md` completed,
`docs/moving-between-installs.md` (one profile format; token, callback address, `local` and the
log folder are not portable), `docs/migration-from-2.x.md` (2.x locations, the D-17 import field by
field, behaviour changes with issue numbers), `BUILD.md` (layout, scripts, D-18 versioning, the
four release workflows and their re-run-alone dispatch, D-27 SBOMs, the hm-simulator situation,
lab rules, roadmap archive), `CHANGELOG.md` (3.0.0 unreleased, grouped by user-visible change with
Removed, Known issues and Not-yet sections) and `docs/README.md` as the index. Fact fixes in
`apps/electron/README.md` and `data/README.md` in their own commit.

## Measured

A throwaway link checker resolved 201 local links and anchors across the ten new or changed pages
and the six package READMEs with no problem. `prettier --check .` clean (`.prettierignore`
excludes `docs/` and `Readme.md`, so those are hand-formatted).

## Found

- Stated as unconfirmed in the docs, on purpose: no release exists and no release workflow has
  run; CCU3-firmware update and uninstall rest on the container replay; the packaged Electron app
  has never been click-tested; OQ-14, OQ-15 and OQ-16 are pending; notarisation depends on the
  Apple secrets, Windows signing on SignPath.
- `apps/electron/src/main/images.ts` still carries the CCU image-directory bug task 13 measured
  (`50/<file>` resolves none of the 278 types; `apps/web` was fixed in `405f108`), and
  `data/scripts/icons-from-ccu.mjs` still defaults to `--size 50`. Both are task 15 items; the
  Electron README states the measured truth meanwhile.
- `Readme.md` lost its executable bit from 2.7 (a mode change in the diff, correct for markdown).
- For task 17: new screenshots (the three `docs/hmm*.png` are 2.7), the forum announcement,
  closing the triaged issues with the references collected in `CHANGELOG.md` and
  `migration-from-2.x.md`, and the OQ-16 lab check.
