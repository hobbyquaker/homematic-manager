# The openccu-lite conformance corpus

A verbatim copy of `fixtures/` from [openccu-lite](https://github.com/hobbyquaker/openccu-lite)
(Apache-2.0, © Sebastian Raff), taken from commit `b8d8a0d` on 2026-09-06.

It is the contract of that project's **D-16**: the metadata store has two implementations - Go in
`occulited`, TypeScript in `packages/core/src/meta/` here - and both run this corpus in their own
CI. If both pass, they agree; if one changes the semantics without changing a fixture, that is the
bug. `CORPUS.md` is the upstream README and describes the file layout and the operations.

`src/meta/conformance.test.ts` runs it. It runs this copy by default so that CI needs no second
checkout, and the upstream directory when `OPENCCU_LITE_FIXTURES` points at it:

```sh
OPENCCU_LITE_FIXTURES=~/repos/openccu-lite/fixtures npm test -w @homematic-manager/core
```

`node scripts/sync-meta-fixtures.mjs ~/repos/openccu-lite` refreshes the copy and says what changed.
A refresh is a commit of its own, and a fixture that starts failing after one is a specification
change to read before it is a bug to fix.
