# Task 17: Beta cycle, agent-side part (done 2026-09-05; the release itself is the maintainer's)

Twelve commits on `3.0-dev` from `a689844` (screenshots) to `ceaaf92` (`3.0.0-dev.1`).

## What was done

3.0 screenshots from the demo mode through `tools/screenshots.mjs` (`npm run screenshots`):
Devices with the channel sub-grid, the paramset editor with the write preview, the Links tab with
the easy-mode dialog, light and dark, 89–115 KB each, both themes in the README.
`docs/announcement-3.0-beta.md` (German, forum register, placeholders for what is undecided) and
`docs/release-checklist.md` (one-time setup, `version:dev`, tag, the four workflows and their
re-run, an attestation-verify loop over every asset, publishing the draft, the pasteable issue
list). `CHANGELOG.md` corrected (nine task 15 features had been listed as missing, three fixed
items as open). OQ-16 answered as A-17: bit 0 of `NN_WP_WEEKDAY` is Sunday, proven against the
CCU's own `HmIPWeeklyProgram.js` (byte-identical on both firmwares) without writing to a device;
the editor was already right, a test pins it. Hardware checklist in `docs/hardware-checklist.md`
for all three lab boxes with build `c4b04fd`, updated in place through the firmware's own
installer with profile and token intact. Found and fixed: monit was watching nothing (`ONREBOOT
NOSTART` leaves the check unmonitored on every reload; `rc.d/hmm` now arms and disarms it the
RedMatic way, verified "Monitored / OK" on the boxes); `tools/lab/addon-check.sh` had never met
hardware and looked in the wrong places, rewritten and re-run. `scripts/version-dev.mjs` read the
old version after `npm version` had rewritten it, so the workspace ranges were never retargeted
and the first `npm run version:dev` failed; fixed, then bumped to `3.0.0-dev.1`, `npm ci`
verified.

## Measured

|                                                       | CCU3 firmware                          | OpenCCU x86_64                           | OpenCCU aarch64 |
| ----------------------------------------------------- | -------------------------------------- | ---------------------------------------- | --------------- |
| update in place                                       | ok, 224 s                              | exit 0, 5 s                              | exit 0, 14 s    |
| task 13 checks (session, cookie, UI, WebSocket, idle) | ✅                                     | ✅                                       | ✅              |
| D-31 `init('')` after the last session                | 306 s                                  | 301 s                                    | 306 s           |
| resubscribe on the next page load                     | 1.7 s                                  | 0.1 s                                    | 1.5 s           |
| service message raised while idle                     | —                                      | visible 1.0 s after the load             | —               |
| https: secure context and camera API                  | ✅                                     | ✅                                       | ✅              |
| device image source `ccu`                             | ✅                                     | ✅                                       | ✅              |
| task 18 login                                         | settings page on Tcl 8.2.3 + one login | all eight steps, level 8, 401×5 then 429 | not run         |

Workspace 1900 tests green at `3.0.0-dev.1`, lint and typecheck clean.

## Found, left open

- The CCU3 chroot has no `/var/run`, so a live `install_addon` there leaves the old process
  running; `VirtualDevices` answers `getServiceMessages` with invalid XML-RPC once a minute; the
  BIN-RPC client logs "write after a stream was destroyed" once on the resubscribe after an idle
  unsubscribe. All three handed to a follow-up agent the same day.
- The CCU3 firmware's `install_addon` never propagates an exit code (ends with `sync`).
- Task 18 was exercised with the lab's admin user only; a lower-level CCU user is untested.
- PNG optimisation skipped (no oxipng or pngquant on the machine; the script uses them when found).
- Waits on the maintainer: GitHub Actions has never run (no CI run, artifact, release or
  attestation exists, and the D-25 round of installing every type from the published artefacts
  cannot start), OQ-14 and OQ-15, the Electron click-through, the forum post, closing the issues.
