# Task 12: Web host and npm package (done 2026-09-05, Docker follow-up open)

Eight commits on `3.0-dev` from `0e380ad` (the building blocks) to `d3af709` (the installer's
root guard), plus `.github/workflows/release-npm.yml` and a job in `ci.yml`.

## What was done

`apps/web`: `createWebHost` serving the built UI, the `ApiFrame` WebSocket at `<base>api`, device
images at `<base>images/<type>` (memory → disk → CCU `/config/img/devices/50/` with an upper-cased
lookup, because the mapping says `HM-LC-SW1-PL` and the CCU reports `HM-LC-Sw1-Pl` → bundled webp
→ 404, source named in a response header) and `data/dist` as static files under `<base>data/`,
also injected as the backend's data root so `data.file` behaves as in Electron. Token auth without
any UI change: `index.html` sets an `HttpOnly; SameSite=Strict` cookie scoped to the base path,
the same-origin upgrade replays it and the host rewrites it into the `?token=` form the backend's
`ApiWebSocketServer` already accepts; query token and sub-protocol keep working for curl, e2e and
the addon CGI. Cookie issuing defaults to on for a loopback bind and off otherwise (behind
lighttpd the addon's session-checked CGI sets the same cookie). No Origin check, on purpose and
tested through a real reverse proxy. Base path support (`--base /addons/hmm`: 301 on the bare
prefix, 404 outside), development mode with vite HMR, `startForTest` for task 14, a yargs-free
CLI whose help and `--config-schema` come from one definition (`HMM_*` environment mirrors, CLI
wins), `--install` / `--uninstall` / `--purge` / `--prefix` writing the system user, env file and
hardened unit of D-25, and the npm deliverable of D-24: `private` removed, AGPL (D-26), backend
and core bundled through `bundleDependencies` materialised by `prepack.mjs` (0.94 MB, 332 files),
CycloneDX 1.6 SBOM of the real tarball attested in `release-npm.yml` and generated on every push.

## Measured

156 tests in 13 files; 96.3 % statements, 96.9 % lines, 87.8 % branches; workspace 1390 tests
green with hm-simulator installed. Manual: `--demo`, a real backend on a temp profile under
`--base /addons/hmm` (WebSocket 401/101/101 without, with query token, with cookie), and a fresh
install of the packed tarball (bin runs, UI, data, bundled image, auth, graceful shutdown).

## Found

- `ApiWebSocketServer` in the backend aborts foreign upgrades with 400 and has no heartbeat: the
  host feeds it a surrogate emitter and pings idle sockets with a raw frame every 25 s. Two small
  backend options (`noServer`/`onUpgrade` and `keepAliveMs`) would remove both workarounds
  (follow-up).
- The bundled-packages choice is a decision worth recording: the workspace packages are not
  published separately (D-29).
- With `tls` the CCU image fetch cannot accept the self-signed certificate and falls through to
  the bundled picture.
- Not done, scheduled as the task 12 follow-up: `Dockerfile`, `compose.yml`,
  `release-docker.yml` with the image SBOM and provenance, the CI image build, and moving the
  lighttpd/nginx/Caddy snippets from `apps/web/README.md` to `docs/`.
- For task 13: start the host with `--base /addons/hmm --host 127.0.0.1 --no-issue-cookie
--token "$TOKEN" --local --data-dir <addon dir>`; `settings.cgi` sets `hmm_token` with
  `Path=/addons/hmm/; HttpOnly; SameSite=Strict; Secure` after the `tclrega.so` check and
  redirects to the UI; `--config-schema` gives the CGI the option list.
- For task 14: `startForTest({simulator: true})` returns `url`, `token`, `close()`; the cookie
  makes the socket connect with no Playwright setup; CI must `npm run build` before the web e2e.
