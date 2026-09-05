# Task 15: Backlog features from the triage (done 2026-09-05)

Seventeen commits on `3.0-dev` from `e46ed34` (one device-image chain) to `ae4e8ff`, plus
`2add60e` on hm-simulator `1.0-dev` (`setTempKey`, version 1.0.1, not released yet). One erratum:
the BidCos-Wired back-off and the "not present" indicator went in with the main session's commit
`23da912` ("Roadmap and handoff: hm-simulator 1.0.0 is published"), because that commit took the
whole index including the agent's sixteen staged files; the code is in HEAD and tested, the
message does not describe it.

## What was done

Correctness first: one `DeviceImageService` in `packages/backend/src/images/` used by both hosts
(the union of the web and Electron copies; the Electron copy had asked the wrong CCU directory),
and the icon script gets the same four candidates; interfaces whose port refuses (BidCos-Wired on
a CCU without a wired gateway) back off 15 s to 5 min with one notice per outage, an
`InterfaceState.absent` flag and a grey dash in the header; a supplied token is logged at `debug`,
a generated one once at `info`; the add-device dialog again has the two buttons 2.7 had
(`addDevice(serial, mode)` without install mode, `setInstallMode` with the countdown). hm-simulator
1.0.0 from npm as a devDependency with `SIMULATOR_REQUIRED=1` in CI. D-31 idle unsubscribe in the
backend (fake-timer tests, simulator test), `--idle-unsubscribe` defaulting to 5 m in the web host,
inherited by the addon and Docker. The QR scanner says that it needs https instead of failing
inside the decoder (jsdom shims for `mediaDevices` and `isSecureContext` so both test runs test the
same thing). The temporary BidCos key e2e, feature-detected against the simulator. Features: staged
changes with one Apply (#124, `ChangeSetStore` and a review dialog over the paced queue with
progress and cancel, failed entries keep their reason); a name and a description per pair in a
multi-link (#87); an edge-triggered unreach counter per device persisted per CCU plus an opt-in
`STICKY_UNREACH` auto-acknowledge (#26); link count and "create link as sender/receiver" from the
Devices tab (#25); link profile templates in the profile directory guarded by the joined LINK
paramset identity (#21); ReGa inbox confirm (#54) and ReGa service-message acknowledge (#94) from
one `rega/scripts.ts` using eQ-3's own idioms, tested with and without ReGa; smoke-detector teams
for BidCos through `listTeams`/`setTeam` (#97). `docs/upstream/` with the two patches (`binrpc`
latin1 decode verified on a copy; `homematic-xmlrpc` server `responseEncoding`) and what CCU-Jack
needs (#135: it serves XML-RPC on `/RPC3` of port 2121, so a user-defined interface covers it).

## Measured

1820 tests in 118 files, all green with the simulator required; UI 560 in browser mode and 560 in
jsdom; web e2e 20 passed, 1 skipped (temporary key, until simulator 1.0.1); hm-simulator 116.
Coverage lines/branches: core 100.0/99.9, backend 97.0/91.9, ui 93.8/81.3 (below the 95 % target,
reported not enforced), web 97.5/88.5, electron 68.6. Bundle JS 346.5 → 375.3 kB (gzip 106.5 →
115.0), CSS 35.3 → 36.9 kB; the lazy QR chunk unchanged.

## Found

- HmIP smoke-detector groups are built through the group process on `/groups`, outside the RPC
  catalogue; the HmIP half of #97 is out of scope by D-1 and says so in the backend README.
- A D-31 race in the simulator test (`init('')` reaches the simulator before the manager's state
  is updated) needs a `waitFor`; persisting "unreachable now" is what keeps the restart sweep from
  counting the same outage twice.
- `homematic-rega`'s own `channels.rega` filters on `ReadyConfig()` while enumerating
  `EnumUsedIDs()`, which is the evidence that inbox devices are enumerable and made the #54 script
  safe to write without a CCU.
- The `homematic-xmlrpc` request-encoding change is deliberately not prepared as a patch: changing
  what goes out changes what every consumer has already written to their CCUs.
- Not run here: shellcheck and tclsh are not installed, so the addon CGI assertion that the
  redirect never grows a scheme runs only in the container test and CI. No hardware was used.
- The CCU addon passes nothing for `--idle-unsubscribe` and inherits 5 m; `HMM_IDLE_UNSUBSCRIBE`
  in its `etc/hmm.env` overrides it.
