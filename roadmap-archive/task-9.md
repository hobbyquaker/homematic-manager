# Task 9: Device metadata pipeline (done 2026-09-05)

Commits on `3.0-dev`: `d866997` (data workspace, pinned fetch), `6aa1754` (contract additions),
`0e93809` (conversion and validation), `c5dc32a` (legacy comparison), `9be6d2d` (webp icon subset
and CCU fetch tool), `582ae98` (documentation), `6f6c6c9` (reproducible second run).

## What was done

- `data/` is the workspace `@homematic-manager/data`: `npm run fetch` downloads the 80 pinned
  openccu-data `2026.7.2` artifacts (sha256 in `data/sources.json`) into the git-ignored
  `data/upstream/`; `npm run convert` writes `data/dist/` in the format of
  `packages/core/src/data/types.ts`; `npm run update` does both and is idempotent.
- `data/dist/`: 195 files, 9.2 MB: 65 receiver profile files (3521 link profiles over 725
  receiver/sender combinations, every HmIP receiver included, closes #50 and #22), 3 aliases,
  `master-metadata.json` (54 channel types), `option-presets.json` (85), `cross-validations.json`
  (5), `translations/{de,en,tr}.json` (de: 253 channel types, 488 device models, 2359 parameters,
  3042 values, 167 help texts, 5465 UI labels; tr is the 2.x fallback per D-15),
  `device-icons.json` (535), `icons/*.webp` (121 BidCos device images, 79 KiB, D-10),
  `manifest.json`.
- `scripts/icons-from-ccu.mjs <url> <dir>` fetches the images from a CCU for the apps (not run
  against any CCU). `npm run compare-legacy` produces `data/COMPARISON.md`.
- The contract gained two optional fields: `MasterMetadata.parameterGroups` and
  `ReceiverProfiles.senderMetadata` (link-side display order, preset assignment, value subsets;
  the 2.x per-profile `options` block flattened per sender type).

## Measured

Against the 28 receiver types of 2.x: no receiver type and no sender combination lost; 832 of 837
shared profiles parameter-identical; 10 profiles, 1 parameter and 4 fixed values differ (the CCU
data moved on since 2015). 29 tests in the workspace; root `npm test` picks them up since the
`projects` list names `data`.

## Found

- openccu-data's `easymode_extract` is a literal dump of the WebUI's Tcl (`"149 ;# match with
profile 4"`, `"[subst {$ON_DELAY ...}]"`). The jump-target symbol table was derived empirically
  from the 1082 profiles both artifacts describe and is re-derived by a test; one malformed
  upstream constraint is dropped.
- Precedence: `profiles/*.json.gz` > `easymode_extract` > legacy 2.x localisation for profiles;
  `translation_custom` (hand-curated upstream overrides) > `translation_extract` for strings.
- `UI_HINT` (= `LinkProfile.id`) and `UI_TEMPLATE` are not in the data; the link writer must send
  `UI_HINT` itself or the WebUI shows the link as "expert" (noted under task 6).
- The per-profile `options` granularity of 2.x is gone; task 8 shows the sender's full option
  list and greys out what the profile fixes.
- `dist/` is 9.2 MB pretty-printed JSON; whether the CCU addon ships it gzipped is OQ-13.
