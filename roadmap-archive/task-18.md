# Task 18: Addon login against ReGa (implemented 2026-09-05, lab check pending)

Six commits on `3.0-dev` from `6fe734c` (credential check) to `8a099f7` (container replay), no
package.json touched, no new runtime dependency.

## What was done

`packages/backend/src/rega/auth.ts`: `RegaAuthenticator` looks the user up with `UserLevel()`
through the ReGa client on the local port and checks the password with one UDP datagram to 1998
using RedMatic's colon and backslash escaping, both against 127.0.0.1 only; 15-minute user
cache, in-flight de-duplication per user, a known user stays logged in while ReGa is unreachable
(the RedMatic 9.2.0 lesson, D-32); unknown user and wrong password are indistinguishable. The
contract gains read-only `session.info`, answered by the transport per socket (the backend and
the demo data answer `null`). `apps/web`: `--auth-mode token|rega` (default `token`) and
`--session-ttl` (default 24 h, sliding); a framework-free login page in the UI's theme tokens,
German and English; the `hmm_session` cookie accepted by the WebSocket upgrade like the token
cookie; `<base>logout`; five failures per source per minute with the source taken from the last
`X-Forwarded-For` entry behind a loopback proxy so a client cannot forge itself unlimited
attempts; `rega` refused without `--local` or with `--no-auth`, each with a sentence why. The
`settings.cgi` hand-over is untouched and bypasses the login page. UI header shows the user and a
logout link only when a session exists. Addon: the two variables in `etc/default.env`, a Tcl 8.2
settings page `settings.cgi?cmd=config` that switches the mode and restarts the service, linked
from `hmm.cfg`; README and `docs/install-addon.md` paragraphs.

## Measured

Workspace 1900 tests in 121 files with the simulator required; typecheck clean; CGI test 62
checks (was 47); container replay 67 checks (was 40), 27 of them the login through the real
lighttpd against a stub ReGa on 8183 and a stub UDP 1998 responder whose password contains a
colon and a backslash, asserting the exact bytes the daemon received; package test green on the
rebuilt x86_64 package (132 MB, 477 inodes).

## Found

- Judgement call for the maintainer: the WebUI appends the `sid` to the single `Config-Url`, which
  must keep opening the app, so the settings page accepts a valid `sid` or the addon's own token
  cookie (both prove the same ReGaHSS check) and `hmm.cfg` links to it in the description.
- The rate-limit source must be the last `X-Forwarded-For` entry; the first is client-writable.
- Two files landed with control characters from the authoring tool once; one commit was amended
  before anything built on it. All files are LF without NULs, `settings.cgi` kept mode 755.
- Not done: the hardware pass (eight steps listed in `apps/ccu-addon/README.md` under "Still to
  check on hardware"); only the x86_64 package was rebuilt. The task counts as finished after the
  lab check, which is part of task 17's hardware run.
