# Task 13: CCU addon (done 2026-09-05)

Nine commits on `3.0-dev` from `90db461` (the bundled Node runtime) to `43ed3b5`, plus
`.github/workflows/addon.yml` and `release-addon.yml`. `ci.yml` untouched.

## What was done

`apps/ccu-addon`: `build-runtime.sh` with `alpine-packages.js` (Alpine musl Node 24 with the
patchelf'ed loader and ICU for armv7l, stock nodejs.org binaries for aarch64 and x86_64),
`build.sh` producing `hmm-ccu-<arch>-<version>.tar.gz`, `sbom.mjs` (npm tree of `app/` merged
with the Node version and the apk packages as `pkg:apk/alpine/...` components, D-27), the
installed tree under `files/` (rc.d, monit, `settings.cgi` with the `tclrega.so` session check
that sets the `hmm_token` cookie and redirects, `service.cgi`, `update_check.cgi`,
`update_script` with exit 10 on a fresh install, uninstall, `.nobackup`), the lighttpd rule for
`/addons/hmm/` with the WebSocket upgrade enabled and the three CGIs excluded by a negative
lookahead (verified on lighttpd 1.4.50 and 1.4.82), and `README.md`. `app/` is the packed
`apps/web` tarball installed the way a user installs it (one recipe with npm and Docker, D-29).
The profile lives in `/usr/local/hmm`, outside the addon tree, so config, caches and token
survive update and uninstall (`uninstall purge` removes it). The token reaches the host through
the environment, never as a command-line argument visible in `ps`. `addon.yml` builds the three
packages on push (`fail-fast: false`, artifacts); `release-addon.yml` runs on a `v*` tag or by
dispatch, attests and attaches to the draft release, no `needs:` (D-24).

## Measured

|                                             | package | installed | inodes |
| ------------------------------------------- | ------- | --------- | ------ |
| armv7l (musl Node 24.18.1, 18 apk packages) | 27 MB   | 72 MB     | 503    |
| aarch64 (Node 24.20.0)                      | 44 MB   | 127 MB    | 461    |
| x86_64 (Node 24.20.0)                       | 44 MB   | 131 MB    | 461    |

On the CCU3 the install cost 519 of 96 256 inodes and 72 MB of the 2 GB `/usr/local`; backend
RSS 71–100 MB depending on the box. OQ-13 decided by measurement (D-30): `data/dist` is
minified, not pre-gzipped; all three variants cost the same inodes, the download differs by
50 KB, and pre-gzip would need a `Content-Encoding` branch in the shared static server.

Tests: 47 CGI checks against a Tcl stub, 33 package checks per architecture, a 40-check container
replay of `/bin/install_addon` with a real lighttpd (install, update, uninstall, session check,
proxy rule, WebSocket upgrade, a socket idle for 70 s; x86_64 only, the runner cannot execute the
arm binaries), web + ccu-addon vitest 166 tests. Lab, all three boxes at `3.0.0-dev.0`: WebUI
entry, session check with wrong and absent sid rejected, UI/assets/metadata/images through the
addon path, WebSocket round trip and 401 without cookie, device lists filling where the box has a
radio, a 10-minute idle session, `service.cgi` restart. Update, uninstall and reinstall verified
on both OpenCCU boxes; the CCU3-firmware box got the single reboot install only (ssh back after
239 s, addon started at boot, all interface processes and the wired devices back).

## Found

- Device images never came from the CCU (`405f108`, erratum for task 12): the `50` directory
  holds the WebUI thumbnails with a `_thumb` suffix, the plain names are in `250`. Measured on
  both firmwares: 267 in `250/`, 11 in `250/coupling/`, 254 thumbnails, union 278 of 278. The
  image service now walks those candidates. `data/scripts/icons-from-ccu.mjs` (task 9) carries
  the same wrong assumption and is still to fix (task 15 note).
- BidCos-Wired retries `init` every 15 s with an ERROR line on any CCU without a wired gateway;
  the default interface list enables it. README troubleshooting row for now; a quieter default
  (probe once, back off) is a task 15 item.
- `apps/web` logs the token at `info`, so it lands in the addon log that `service.cgi?cmd=log`
  shows to any WebUI session (which gets the token from `settings.cgi` anyway); should be `debug`
  when the token was supplied (task 15 note).
- The Node binaries are not stripped (x86_64 126 → 108 MB possible); cross-stripping the arm
  binaries needs binutils the runner lacks, consistency was preferred.
- Neither workflow has run on GitHub yet.
- For task 16 → `docs/install-addon.md`: the per-architecture table (`uname -m` decides,
  `Error (13)` on a mismatch, `.sha256` and `gh attestation verify`), OpenCCU live versus CCU3
  reboot install, the token/cookie flow, the lighttpd rule with the CCU3 firmware ≥ 3.61.5
  requirement, update and uninstall (keeps `/usr/local/hmm`), troubleshooting, the inode and
  flash budget, and that `/usr/local/hmm/config.json` is the same profile format as the npm and
  Docker installs (D-25).
