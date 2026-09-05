# Task 5: hm-simulator 1.0 (done 2026-09-05)

Repository `hobbyquaker/hm-simulator`, branch `1.0-dev`, version `1.0.0-dev.0`, ten commits from
`ef572c6` (modernised base) to `18b7a2b` (behaviour scripts write as the device). Not pushed, not
tagged, not published: the maintainer cuts the release (`release.yml` publishes with npm OIDC
trusted publishing on a `v*` tag).

## What was done

- Runtime dependencies reduced to `binrpc@^4.2` and `homematic-xmlrpc@^2.0` (express, body-parser,
  request, async, yalm gone); Node 20.19+; CommonJS `sim.js` kept for the consumers plus an ESM
  `sim.mjs`; ESLint 9 + Prettier, `node --test` (93 tests), CI and release workflows.
- New RPC methods: `getParamset`/`putParamset` (MASTER, VALUES, LINK with per-direction state),
  `getValue`, `getDeviceDescription`, `system.methodHelp`, `system.multicall`, the link family
  (`getLinks`, `getLinkPeers`, `getLinkInfo`, `setLinkInfo`, `addLink`, `removeLink`,
  `activateLinkParamset`), `rssiInfo`, `listBidcosInterfaces`/`setBidcosInterface`,
  `getServiceMessages`, install mode with scripted `newDevices`, `deleteDevice`, `replaceDevice`,
  `reportValueUsage`, firmware stubs, `clearConfigCache`, `restoreConfigToDevice`,
  `determineParameter`; fault responses from an overridable table (`lib/faults.js`).
- `CONFIG_PENDING` per interface: `strict` (invalid MASTER write is a fault) or `pending`
  (accepted, sticky `CONFIG_PENDING` on `:0`), plus the BidCos battery-device transient pending;
  three modelled recoveries.
- Servers: rfd binrpc, hmipserver xmlrpc, BidCos-Wired, VirtualDevices (`/groups`), CUxD binrpc,
  optional TLS (self-signed at start or given) and basic auth, ReGa mock. All off unless configured.
- Scenario API: `whenReady()`, `ports` (port 0 supported), `addDevice`, `removeDevice`,
  `fireEvent`, `setServiceMessage`, `scriptNewDevices`, `dropConnection`, `getWriteLog()`,
  `getConfigPending()`. Fixtures built from node-red-contrib-ccu's `paramsets.json` for the lab
  device types (`tools/`).

## Measured

node-red-contrib-ccu `test:unit` 23/23 and hm2mqtt.js e2e 7/7 with the new simulator, identical
to the 0.1.1 baseline (one regression found and fixed in `18b7a2b`). Both consumer checkouts
restored.

## Found (assumptions task 6 calibrates in the lab)

- Fault codes (`-1` unknown method … `-10` invalid arguments) follow the eQ-3 convention but are
  not measured; the `faults` option overrides them without a release.
- Which `CONFIG_PENDING` hypothesis hmipserver/crRFD implement, and which recovery works, is
  unmeasured; both modes exist so both can be tested.
- binrpc fault framing (type `0xff`) is unverified against real crRFD; `FLAGS & 8` as the
  service-message bit is assumed; channel indexes in the fixtures are synthesised (a `listDevices`
  dump per lab device type fixes that).
- Environment: port 8181 is taken on the Windows side by a 3Dconnexion driver, visible in WSL with
  mirrored networking; nrccu's tests should use port 0. hm2mqtt.js's aedes fallback is broken with
  aedes 1.1.2 (default export gone). Both are one-line fixes in those repos.
