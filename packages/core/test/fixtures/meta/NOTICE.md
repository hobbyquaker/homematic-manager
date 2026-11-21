# The openccu-lite conformance corpus

A verbatim copy of `fixtures/` from [occulited](https://github.com/openccu-lite/occulited), the
system service of openccu-lite (Apache-2.0, © Sebastian Raff), taken from `occulited` commit
`4076d0c1` on 2026-11-21 (cases 10-12: Control's icons in the metadata namespace `control`; case 13:
a name cannot be cleared; serial numbers anonymised).

It is the contract of that project's **D-16**: the metadata store has two implementations - Go in
`occulited`, TypeScript in `packages/core/src/meta/` here - and both run this corpus in their own
CI. If both pass, they agree; if one changes the semantics without changing a fixture, that is the
bug. `CORPUS.md` is the upstream README and describes the file layout and the operations.

`src/meta/conformance.test.ts` runs it. It runs this copy by default so that CI needs no second
checkout, and the upstream directory when `OPENCCU_LITE_FIXTURES` points at it:

```sh
OPENCCU_LITE_FIXTURES=~/repos/occulited/fixtures npm test -w @homematic-manager/core
```

`node scripts/sync-meta-fixtures.mjs ~/repos/occulited` refreshes the copy and says what changed.
A refresh is a commit of its own, and a fixture that starts failing after one is a specification
change to read before it is a bug to fix.
