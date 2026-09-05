# @homematic-manager/backend

The protocol and state layer of the Homematic Manager: XML-RPC and BIN-RPC clients and callback
servers, the init/ping/re-init watchdog, the caches with their per-CCU persistence, optional ReGa,
UDP discovery, the paced write queue, and one transport-agnostic API.

It implements the contract in `packages/core/src/api/types.ts` - every method of `ApiMethods`, every
event of `ApiEvents`, every rejection an `ApiError` - and nothing above it ever sees a socket, a file
or an RPC library. Electron main (task 11) hosts it in-process, `apps/web` (task 12) serves it over
a WebSocket, and the CCU addon (task 13) runs the same process on the CCU.

## Architecture

```
                    ApiMethods / ApiEvents  (packages/core/src/api/types.ts)
                                  |
   InProcessTransport   ApiWebSocketServer         <- api/transport.ts, transport/wsServer.ts
                    \      /
                     Backend                        <- api/backend.ts
        ______________|________________________________________
       |          |            |          |          |         |
  ConfigStore  InterfaceManager  CacheStore  RegaService  WriteQueue  DataFileServer
       |            |               |            |          |
  config/      interfaces/       cache/        rega/      write/
                    |
          RpcClient + CallbackServers            <- rpc/client.ts, rpc/server.ts
                    |
        homematic-xmlrpc / binrpc  -> the CCU's interface processes
```

| module | what it is |
| --- | --- |
| `api/backend.ts` | `Backend`: every method of the contract, every event, the connect sequence |
| `api/transport.ts` | `InProcessTransport`: the `Transport` without a wire (Electron main, tests) |
| `transport/codec.ts` | `ApiFrame` as JSON, strict about what it accepts |
| `transport/wsServer.ts` | `ApiWebSocketServer`: the contract over `ws`, with token auth |
| `config/defaults.ts` | defaults, normalisation, validation, interface resolution (D-13) |
| `config/legacyImport.ts` | the one-time import of the 2.x configuration (D-17) |
| `config/store.ts` | `config.json`, the profile directory, the per-host cache directory |
| `rpc/client.ts` | one promise-shaped RPC client per interface: timeout, faults, call log |
| `rpc/server.ts` | the xmlrpc and binrpc callback servers and the `listDevices` answer |
| `interfaces/manager.ts` | `init`, the ping watchdog, re-init, `init('')`, the background port probe |
| `cache/devices.ts` | device descriptions per interface, and the core's `DeviceIndex` |
| `cache/descriptions.ts` | paramset descriptions by `paramsetIdentity()` |
| `cache/names.ts` | the local name store, with ReGa as an overlay (D-2) |
| `cache/unreach.ts` | how often each device went unreachable (#26), edge-counted and persisted |
| `cache/store.ts` | all caches of one connection, and what of them is persisted |
| `rega/client.ts` | names and renames through ReGa; every failure is a state, never an exception |
| `discovery/discover.ts` | the eQ-3 UDP broadcast probe on 43439 (ported from hm2mqtt.js) |
| `write/queue.ts` | one paced queue per interface, cancellable |
| `write/log.ts` | the session write log and the 2.x `rpcLogFolder` dumps |
| `write/paramset.ts` | the changed-only `putParamset`, multi-apply, link writes, `setValue` |
| `write/repair.ts` | `devices.repairConfig`: the recovery task 6 measured, per channel |
| `devices/installMode.ts` | install mode in all its variants, incl. the HmIP key conversion |
| `data/files.ts` | `data.file`: reads from injected roots and nothing else |
| `images/deviceImages.ts` | device pictures (D-10): memory, disk, the CCU's four candidate URLs, the bundled webp subset |
| `util/*` | the typed event emitter, atomic and debounced JSON files, net helpers |
| `errors.ts` | `ApiError` as a throwable, and the classification of anything thrown |

## Using it

```ts
import {Backend, InProcessTransport} from '@homematic-manager/backend';

const backend = await Backend.open({dataDir: app.getPath('userData'), version: '3.0.0-dev.0'});
await backend.start();                       // connects if a CCU is configured
const transport = new InProcessTransport(backend);   // this is what the UI talks to
// ...
await backend.stop();                        // de-registers, closes, flushes the caches
```

Over a WebSocket instead:

```ts
const server = new ApiWebSocketServer({backend, port: 8181, token: process.env.HMM_TOKEN});
await server.start();
```

Three rules run through the whole class:

- **reads never queue.** Only writes are paced, so opening a paramset editor is immediate where 2.x
  waited three seconds per call and blocked the UI with a modal dialog.
- **nothing rejects except as `ApiError`.** A CCU that is off, a ReGa that wants a password, a cache
  file that cannot be written - each is a typed rejection or a `notice` event, never an exception in
  the host process.
- **nothing invalid reaches an interface process.** Not as a courtesy: the lab study of task 6
  ([`docs/config-pending.md`](../../docs/config-pending.md)) found that hmipserver **stores what it
  rejects**, so one `putParamset` with a parameter the channel does not have leaves that channel
  unwritable for the life of the pairing, and that **neither** interface process checks
  `MIN`..`MAX` - hmipserver keeps an out-of-range value, rfd clamps it without a word. Every write
  is cast and validated against the channel's own description first, `ENUM` goes out as the index on
  every interface, `FLOAT` always as an explicit double (required on BidCos), and multi-apply is
  restricted to identical descriptions.

## What is persisted, and where

Everything lives under the injected `dataDir` (Electron: `app.getPath('userData')`; the addon: its
own directory; a test: a temporary one).

| file | content | written |
| --- | --- | --- |
| `config.json` | the `AppConfig` (connection only; the rest is derived) | on every `config.set`, atomically |
| `cache/<host>/devices.json` | device descriptions per interface | debounced, on every change |
| `cache/<host>/descriptions.json` | paramset descriptions by identity | debounced, when one was fetched |
| `cache/<host>/names.json` | the local names and the ReGa object ids | debounced, on every rename |
| `cache/<host>/write-log.json` | the write log of the session | debounced, on every write |

The cache directory is keyed by host, so switching between two CCUs cannot mix their device lists.
Every write goes through a temporary file and a rename: 2.x used `persist-json` without its
`{secure: true}` option, so an interrupted write lost the configuration.

**Not** persisted: RSSI, service messages and the event ring. Each is a snapshot of the radio's
current state, and a stale one is worse than none.

`data.file` reads from the roots the host injects (`fileRoots`), and refuses anything else - a path
that leaves its root, a root that is not configured, a symlink that points outside, an extension that
is not on the list.

## Running against hm-simulator

`test/simulator/*.test.ts` drives the whole backend over real sockets against an in-process
[hm-simulator](https://github.com/hobbyquaker/hm-simulator): connect over BIN-RPC and XML-RPC, TLS,
basic auth, the callbacks, `dropConnection()`, the caches, the ReGa mock, the write path, the
`CONFIG_PENDING` modes and both transports.

Since task 6 the simulator's `hmip` and `bidcos` modes are what the two interface processes of a
CCU on firmware 3.89.8 were **measured** to do, and the suites run against those by default: the
wrong type that sticks in `CONFIG_PENDING`, the unknown parameter that makes a channel unwritable
for good, and `devices.repairConfig` on both. `configPendingMode: 'strict'` in
`test/simulator/helpers.ts` still gets the stricter hypothesis where a test wants it.

`hm-simulator` is a devDependency of this package since its 1.0.0 release, so `npm ci` installs it:

```sh
npm test                                   # or: npm run test:sim -w @homematic-manager/backend
```

Every suite still gates itself on `simulatorAvailable`, so a tree without dev dependencies stays
green; `SIMULATOR_REQUIRED=1` turns that skip into a failure, and CI sets it. To try an unpublished
change to the simulator, `npm install --no-save ../hm-simulator` from the repository root.

Every port in those tests is `0`: the operating system picks one, `sim.ports` says which, and the
backend is pointed at it through `InterfaceManager.portOverride`. That is what lets the suites run in
parallel, and why they do not care which ports are taken on the development machine.

## ISO-8859-1, and what is still wrong in the libraries

The CCU's interface processes speak ISO-8859-1, and their XML carries no encoding declaration. What
this package does about it, and what it cannot:

- **XML-RPC answers are decoded correctly.** Every client is created with
  `responseEncoding: 'latin1'` (`rpc/client.ts`). Without it a `°C` unit arrives as the replacement
  character - the mojibake 2.x showed, which `unitLabel()` in the core still has to repair.
- **The ReGa client is correct on its own.** `homematic-rega` 2.0 encodes and decodes `latin1` and
  un-escapes ReGa's `WriteURL()` output; nothing to do here.
- **UDP discovery decodes `latin1`** for the type and serial of an answer.
- **BIN-RPC decodes strings as UTF-8.** `binrpc@4.2`'s `decodeString()` ends in
  `strContent.toString()`, which is UTF-8; a `°` (0xB0) from rfd or CUxD therefore becomes U+FFFD
  and cannot be recovered. Encoding is fine - `Buffer.from(str, 'ascii')` is `latin1` on the write
  side in Node. **A fix belongs in `binrpc`**, which is the maintainer's own package: decode with
  `latin1`, or make the encoding an option.
- **The XML-RPC callback server decodes as UTF-8.** `homematic-xmlrpc`'s `Server` constructs its
  `Deserializer` without an encoding and offers no option for one, so an incoming `event` or
  `newDevices` carrying a non-ASCII string is mangled the same way. In practice those payloads are
  addresses, datapoint names and numbers, so nothing has been observed - but **the option belongs in
  `homematic-xmlrpc`**.
- **Requests are sent as UTF-8, always.** `homematic-xmlrpc` writes the body with `request.write(xml,
  'utf8')` and emits `<?xml version="1.0"?>` with no encoding declaration; `binrpc` writes `latin1`.
  **Measured in the lab on 2026-09-05** (task 6, `docs/config-pending.md`), by writing
  `Tür Küche äöüß °C` into device metadata and reading the raw bytes back over both transports:
  rfd stores what XML-RPC sends, so the string lands on the CCU as **UTF-8 bytes in an ISO-8859-1
  world** and the WebUI shows mojibake. A value stored correctly comes back correctly through our
  `latin1` response decoding, so the read side is right and the **request side is the bug**;
  `request.write(xml, 'latin1')` is the fix, in `homematic-xmlrpc`.
- **BIN-RPC is the mirror image.** Its encoder is right (`Buffer.from(str, 'ascii')` keeps the low
  byte, so `0xFC` goes out as `0xFC`), its decoder is wrong: `decodeString()` ends in
  `toString()`, i.e. UTF-8, so `0xFC` comes back as U+FFFD and the character is gone. Verified by
  running the round trip on the CCU itself, because **BIN-RPC is not reachable from outside a stock
  CCU at all**: port 2001 is lighttpd and speaks XML-RPC over HTTP only, and rfd's own port 32001 is
  `local-only` in the CCU firewall. BIN-RPC is in practice an addon transport (task 13).

## Tests

```sh
npm test                                  # unit tests; simulator suites skip themselves
npm run test:cov                          # with coverage
npm run typecheck && npm run lint
```

`packages/backend/src/**` is linted with `strictTypeChecked`, like the core: it is the layer that
puts values on a wire, and the unsafe-any rules are exactly the class of bug a struct from an
interface process can cause.
