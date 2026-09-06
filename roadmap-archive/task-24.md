# Task 24: The metadata store — rooms, functions and openccu-lite (done 2026-09-06)

D-40. The Homematic Manager gains a taxonomy of its own — rooms, functions, floors and whatever
else a user makes — and on [openccu-lite](https://github.com/hobbyquaker/openccu-lite), the CCU
firmware without ReGaHSS, it becomes the **editor of that box's metadata store**: names, rooms and
functions are read from the box, followed over its change stream, and written back through its API.

## What was done

**The model, in `packages/core/src/meta/`.** openccu-lite's `docs/meta-format.md` and
`docs/meta-api.md` are normative for two implementations — `occulited` in Go and this one — so this
is a port of their specification and not an interpretation of it: `types.ts` (the document, the
fourteen error codes), `paths.ts` (refs, ids, names, node paths, the subtree rule), `document.ts`
(validation of a whole document, rejected entirely on the first error), `tree.ts` (immutable tree
edits, shared by the two writers), `store.ts` (`MetaStore`: every operation of the API with its
revisions, its "a write that changes nothing is not a write" rule and a replayable event history),
`follow.ts` (`applyEvent`: somebody else's store, followed event by event, with a revision gap
answered by `'resync'`), `view.ts` (trees → the arrays of names every consumer of ReGa's rooms and
functions has always been given) and `slug.ts` (a stable id out of a name, umlauts transcribed,
collisions numbered).

**The providers, in `packages/backend/src/meta/`.** `client.ts` is the HTTP client for
`/api/meta/v1/` including the Server-Sent Events reader — `fetch` and `AbortSignal`, no new
dependency, as their invariant 7 asks. `localProvider.ts` keeps the store in the profile
(`<dataDir>/meta.json`, next to the link templates: the user's own work, which `config.clearCaches`
may not touch and which moves with the profile). `occuliteProvider.ts` is the box: snapshot,
change stream with reconnect and resync, the last snapshot cached per CCU so a restart without the
box still has names, and every failure turned into a state — unreachable, or read-only after a
403, never an exception. `service.ts` decides which of the two it is (one `GET /version` on the
configured host), resolves an address to the store's ref from the device caches, and turns "assign
these rows to this room" into one revision.

**The contract.** `packages/core/src/api/types.ts` gains `meta.state`, `meta.get`, `meta.enums`,
`meta.objects`, `meta.setMembership`, `meta.assign`, `meta.enum.*`, `meta.node.*`, `meta.export`,
`meta.import` and the three events `meta.changed`, `meta.enums.changed`, `meta.objects.changed`;
`connection` gains `metaProvider`, `metaToken` and `metaUrl`. `names.set` writes to the store as
well as to ReGa, so the rename that already existed is the store's rename on a box.

**The addon's login.** `--auth-mode occulite` (`apps/web/src/occulite.ts`, `server.ts`): the box's
shell opens the addon with the user's session on the URL (`?sid=@xxxxxxxxxx@`), the host checks it
with one authenticated call to the metadata API — 401 means no — turns it into a session of its
own and takes the id off the URL. There is no login form: openccu-lite's users are the box's, so a
browser without a session is sent to the box's login. The session is also the credential every
write to the box goes out with, while reads use the box's read-only local token; the ReGa login of
D-32 is untouched. The rc.d script picks the mode from `/VERSION`'s `VARIANT=lite` line at **every**
start and writes nothing into `hmm.env`, because the same `/usr/local` may be moved to the other
firmware (openccu-lite's D-17) and a remembered answer would be wrong there.

## What was measured

- **openccu-lite's conformance corpus** (their D-16, the contract between the Go store and this
  one) runs in CI from a vendored copy in `packages/core/test/fixtures/meta/`, refreshed by
  `scripts/sync-meta-fixtures.mjs`, and against the upstream checkout with
  `OPENCCU_LITE_FIXTURES=…`. 19 cases, green in both, first time without a change to the corpus.
- **A real `occulited`** (built from the openccu-lite checkout, `OCCULITED_BINARY=…`): ten
  integration tests in `packages/backend/test/occulite/` — detection, snapshot, the names in the
  name cache, trees as names, a rename, a room created and assigned, a room renamed and moved with
  its members, a change made elsewhere arriving over the stream, an import answered with a fresh
  snapshot, a write refused for a read-only credential, and a box that is not there.
- **End to end**, by hand, with the web host in `--auth-mode occulite` against that `occulited`:
  the hand-over (`302` + session cookie, the sid stripped from the URL), the UI behind it, a
  request without a session sent to the box, `names.set` landing in the box, a room created and a
  channel assigned to it, a rename made on the box arriving here in under 50 ms, and the logout.
- The addon's CGI suite in the test container (`apps/ccu-addon/test/cgi-test.sh`), with eleven new
  cases for the lite branch of the settings page, and the busybox check that the rc.d detection
  really reads `VARIANT=lite`.
- Workspace: `npm run lint`, `npm run typecheck`, `npm test` green — 2345 tests in 142 files.

## What it found

- **`null` as a parameter is not carried by both transports.** `meta.node.create` took
  `parent: string | null`; the backend maps a `null` parameter to `undefined` (the two transports
  disagree about an omitted argument), so "create a room at the root" arrived as a `TypeError`.
  Found by the end-to-end run, not by any unit test — the contract now says `parent: string |
undefined` and the rule is written down where it can be read.
- **`normaliseConnection` silently dropped the three new options.** It rebuilds the connection
  field by field, so `metaUrl`, `metaToken` and `metaProvider` survived neither a load nor a save.
  The box was therefore never detected in the first end-to-end run. Fixed with four tests, one of
  which is the round trip that would have caught it.
- **A stream that says nothing cannot be stopped.** `readEvents` only checked the abort signal
  before a read, so `stop()` waited for the box's next heartbeat — up to 30 seconds. It now cancels
  the reader on abort.
- **A credential that arrives later needs a nudge.** On the box the addon has no credential until
  someone opens the page; the provider now re-reads and wakes its event loop when the session
  changes, which took the first names from "after the backoff" to "at once".
- **The document must be visible only with the notification.** The provider updated its document
  and told the backend one `await` later (the cache write sat in between), so a reader could see a
  change nobody had announced. It made the integration test flaky, which is the good outcome.

## What was not done

The **user interface** for any of it — a rooms column, the multi-select assign, the tree dialog,
the filter and the provider indicator. That is task 25; every method and event it needs exists and
is tested. Until then the taxonomy is reachable through the API and through whatever else the box
runs, and the rename in the grid is already the box's rename.

Not tested on hardware: no lab box runs openccu-lite yet, and the addon package was not rebuilt and
installed on one. What was tested is the same code against the same `occulited` the image ships,
plus the CGI suite in the container.
