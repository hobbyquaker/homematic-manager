# Task 3: Core package (done 2026-09-05)

Twelve commits on `3.0-dev` from `a597c42` (type-aware linting for the core) to `d6a17d6`
(barrel export and `ASSUMPTIONS.md`); the API contract `api/types.ts` (`8eb165b`) and the data
contract `data/types.ts` came from the main session and task 9.

## What was done

`packages/core`, pure TypeScript, no dependencies, no I/O: interface table with remote/TLS/local
resolution and user-defined interfaces (D-13); address model; `DeviceIndex` with flag/RX_MODE/
direction decoding and the 2.x `paramsetIdentity`; paramset description model, `cast` (port of
node-red-contrib-ccu's `cast.js`, MIT), `validate` (structured problems, `SPECIAL` bypasses the
range), `units` (`100%`, mojibake repair), `time` (base/factor pairs), `diff` (changed-only
`putParamset` payloads with reasons for every dropped parameter), `multiApply` eligibility by
description identity; easy-mode engine on the `DataSource` contract (profiles with alias chains,
`applyProfile` setting `UI_HINT`, `detectProfile`, `masterMetadataFor` with order, visibility,
presets, cross-validation, `linkMetadataFor`); in-memory `DataSource`; link role matrix and link
`FLAGS`; service-message store with BidCos tuples and HmIP derivation; RSSI normalisation, HmIP
mapping, colour classes, best interface (#69); event ring buffer and filter; the 51-method RPC
catalogue with `methodHelp` merge; i18n with plurals, interpolation, the 74 legacy strings and the
CCU string-table lookups. `eslint.config.js` runs `strictTypeChecked` on the core.

## Measured

440 tests in 22 files; 100 % statements, branches, functions and lines on every file with
executable code; no `v8 ignore`, no `any`, no eslint-disable. Two tests run against the real
pipeline output in `data/dist/` so core and data cannot drift apart. Fixtures: 18 real paramset
descriptions (312 parameters) from node-red-contrib-ccu's `paramsets.json`.

## Found

- Issue #96 is answered by the data: the "not used / infinite" value is the parameter's own
  `SPECIAL` entry (`ID: NOT_USED`), 111600 s on BidCos-RF (`BASE_1_H` × 31) and 16383000 s on
  BidCos-Wired; 2.x hard-coded the RF value. Hard-coding either number is wrong; a `SPECIAL` value
  lies outside `MIN..MAX` on purpose and must pass validation.
- `cast` deviates from the nrccu original in one way: an ENUM value that is neither a `VALUE_LIST`
  name nor a number passes through unchanged instead of silently becoming index 0.
- The real translation file also uses three-segment keys (`CHANNEL_TYPE|PARAM|VALUE`); the lookup
  handles them.
- Fifteen assumptions for the lab are listed in `packages/core/ASSUMPTIONS.md` (A-1 HmIP enum
  names vs. BidCos indexes and A-5 `SPECIAL` outside the range are the two that would produce a
  `CONFIG_PENDING` if wrong).
- HmIP-WRC2 has no description in the fixture source; HmIP-WRC6 stands in (A-15).
- D-11 is realistic now: `cast`, `validate`, `description`, `time`, `units` and the interface table
  have no dependencies outside the package.
