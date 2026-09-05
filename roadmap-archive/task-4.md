# Task 4: Backend package (done 2026-09-05)

Fourteen commits on `3.0-dev` from `ca69f70` (foundation) to `39a9b44` (README and remaining
tests); two additive extensions of the API contract (`write.cancel`, `ConnectionConfig.local` /
`.binrpc`).

## What was done

`packages/backend`: configuration store with profile directory and the one-time 2.x import
(D-17; persist-json kept the file as `hm-manager/config` without extension under `%APPDATA%`,
`~/Library/Preferences` or `~/.hm-manager`); XML-RPC and BIN-RPC clients with timeout, one fault
shape and `responseEncoding: 'latin1'`; callback servers for both protocols with the reduced HmIP
`listDevices` answer of 2.x; interface manager with init, ping watchdog, re-init, bounded
`init('')` on stop and a background port probe that never blocks the UI (#121); caches for
devices, descriptions by identity, names with the ReGa overlay, RSSI, service messages and the
event ring, persisted per host; optional ReGa (D-2) whose failures become state plus notices;
UDP discovery ported from hm2mqtt.js; the write path with one paced queue per interface
(250 ms, HmIP double), cancellable bulk writes with progress, the session write log and the 2.x
`rpcLogFolder` dumps, changed-only `putParamset` through the core diff, multi-apply by identity,
link writes with forced `UI_HINT`; every install-mode variant including the base-32 HmIP key;
the `Backend` class implementing the whole contract, an in-process `Transport`, the `ApiFrame`
codec and a `ws` server with token auth for task 12.

## Measured

381 tests (351 unit, 30 against hm-simulator, skipped with a warning when it is not installed);
97.2 % statements, 91.9 % branches, 96.0 % functions, 97.6 % lines. Four bugs found by the first
simulator run and fixed (`8517ef0`).

## Found

- Latin-1: fixed for XML-RPC responses and ReGa. Not fixable here: `binrpc@4.2` decodes strings as
  UTF-8 (a `°` from rfd/CUxD becomes U+FFFD) and `homematic-xmlrpc`'s `Server` has no encoding
  option; both are one-line changes upstream (roadmap task 15 note). XML-RPC requests go out as
  UTF-8 without an encoding declaration, BIN-RPC as latin1: an umlaut in a link name may arrive
  differently per protocol, to be checked in the lab (task 6).
- hmipserver deletes and re-sends every HmIP device on each `init` (eq-3/occu#45): the device
  cache is briefly empty and the UI must not read an empty list as "no devices" (task 8).
- Assumption for task 6: a channel's LINK paramset description does not depend on the peer (the
  cache keys it by channel identity plus `LINK`).
- `test/simulator/**` is not type-checked by `tsc -b` because hm-simulator is untyped; it is
  linted with the untyped rule set.
