# Patches for the two upstream libraries

Two bugs found while building 3.0 are not in this repository: they are in `binrpc` and in
`homematic-xmlrpc`, both of which are the maintainer's own packages. They are prepared here as
patches rather than fixed here, because a workaround in this code base would hide a bug every other
consumer of those packages has as well.

Neither is forked and neither has a pull request: the maintainer owns both repositories, so opening
one against himself is ceremony. What each patch says is where it goes.

| patch | repository | file | what it is |
| --- | --- | --- | --- |
| [`binrpc-decodeString-latin1.patch`](binrpc-decodeString-latin1.patch) | [hobbyquaker/binrpc](https://github.com/hobbyquaker/binrpc) | `lib/protocol.js` | `decodeString()` decodes UTF-8; the CCU speaks ISO-8859-1 |
| [`homematic-xmlrpc-server-responseEncoding.patch`](homematic-xmlrpc-server-responseEncoding.patch) | [hobbyquaker/homematic-xmlrpc](https://github.com/hobbyquaker/homematic-xmlrpc) | `lib/server.js` | `Server` has no `responseEncoding`, although `Client` has one |

Both are one-liners in effect; both were verified against the published version named in the patch
(`binrpc` 4.2.0, `homematic-xmlrpc` 2.0.0). To apply one for a local test:

```sh
cd ~/repos/binrpc
git apply ~/repos/homematic-manager/docs/upstream/binrpc-decodeString-latin1.patch
```

The `index 0000000..1111111` lines are placeholders — `git apply` does not need real blob hashes,
and inventing them would only pretend the patch was cut from a checkout that does not exist here.

## Why they matter here

The CCU's interface processes speak **ISO-8859-1** and their XML carries no encoding declaration,
so every layer has to be told. `packages/backend/README.md` has the full account of what is right
and what is not; the short version:

- XML-RPC **responses** are already decoded correctly, because `Client` takes a `responseEncoding`
  and `rpc/client.ts` passes `latin1`.
- XML-RPC **callbacks** are not: `Server` builds its `Deserializer` with no encoding and offers no
  way to give it one. A device name in `newDevices` or a string datapoint in an `event` is decoded
  as UTF-8. Nothing has been observed in the wild — those payloads are usually addresses and
  numbers — but there is currently no way to ask for the right thing.
- **BIN-RPC** encodes correctly and decodes as UTF-8, so a `°` (0xB0) from rfd or CUxD arrives as
  U+FFFD and is gone. Measured on a CCU3 (firmware 3.89.8) during task 6 by writing
  `Tür Küche äöüß °C` into device metadata and reading the raw bytes back over both transports.

## What is *not* here

A third finding of the same measurement is that `homematic-xmlrpc` sends its **requests** as UTF-8
(`request.write(xml, 'utf8')`, with `<?xml version="1.0"?>` and no encoding declaration), so a
string written to the CCU lands there as UTF-8 bytes in an ISO-8859-1 world and the WebUI shows
mojibake. That is a real bug and the fix is as small (`request.write(xml, 'latin1')`), but it is
**not** prepared as a patch: changing what goes out changes what every existing consumer has
already written to their CCUs, and whether to do that — and whether to do it behind an option — is
the maintainer's call, not a one-liner. `docs/config-pending.md` has the measurement.

## Third item, not prepared as a patch: the `binrpc` reconnect storm

`binrpc@4.2` schedules a reconnect 2.5 s after its socket dies from the `error`, `end` and
`close` handlers alike, and `connect()` destroys the current socket first, so every reconnect
schedules more of them: against a refused port the client made 2 attempts in the first 4 s and
377 within a minute, with the socket destroyed nearly the whole time, which turns every call's
`ECONNREFUSED` into "Cannot call write after a stream was destroyed". Homematic Manager works
around it in `packages/backend/src/rpc/client.ts` (timer reconnect off, a dead socket replaced
before the call that needs it). The upstream fix is one reconnect per disconnect, cancelled by
`connect()`, and honouring `reconnectTimeout: 0`; measured on 2026-09-06, worth an issue with
these numbers.
