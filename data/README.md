# data

The device metadata of the Homematic Manager: pinned [openccu-data](https://github.com/SukramJ/openccu-data)
artifacts, the converter that turns them into the runtime format, and the committed result.

`dist/` is the only thing the application ever reads, through the `DataSource` interface of
[`packages/core/src/data/types.ts`](../packages/core/src/data/types.ts). That file is the contract;
this one explains where its content comes from and how to renew it.

This replaces `legacy/www/easymodes`, `stringtable.json`, `helpLinkParamset.json`,
`deviceImages.json` and `legacy/tools/convert_*.js`. What the switch gains and what it costs is
measured in [COMPARISON.md](COMPARISON.md).

## What is in `dist/`

Currently 195 files, 9.2 MB, built from openccu-data **2026.7.2**.

| File | Type | Content |
| --- | --- | --- |
| `manifest.json` | `DataManifest` | version, URL and sha256 of every source, the receiver types, the languages |
| `profiles/<RECEIVER_TYPE>.json` | `ReceiverProfiles` | 65 files, 7.5 MB, 3521 link profiles over 725 receiver/sender combinations; the largest is `SHUTTER_VIRTUAL_RECEIVER.json` at 624 KB, the smallest `WS_TH.json` at 435 B. The core loads one file per receiver type, lazily |
| `receiver-type-aliases.json` | `ReceiverTypeAliases` | 3 receiver types that reuse another type's profiles |
| `master-metadata.json` | `Record<channelType, MasterMetadata>` | 40 KB, 54 channel types: display order, conditional visibility, option-preset assignment, parameter groups |
| `option-presets.json` | `Record<id, OptionPreset>` | 34 KB, 85 dropdowns of typical values (`DELAY`: none/5s/…/1h plus a free value) |
| `cross-validations.json` | `CrossValidationRule[]` | 5 rules between parameters of one paramset (`DIM_MAX_LEVEL >= DIM_MIN_LEVEL`, …) |
| `translations/de.json`, `en.json` | `Translations` | 767 KB / 746 KB: 253 channel types, 488 device models, 2359 parameters, ~3040 parameter values, 167 help texts, ~5470 UI labels |
| `translations/tr.json` | `Translations` | 4 KB, the 2015 Turkish easy-mode strings as a fallback locale (D-15) |
| `device-icons.json` | `DeviceIcons` | 535 device type → image file name |
| `icons/<name>.webp` | — | 121 images, 79 KB: the BidCos-only fallback subset for installations without a CCU (D-10) |

Turkish profile names and descriptions do not live in `translations/tr.json` - a profile carries its
own `Localized` name and description, so they sit in `profiles/*.json` next to `de` and `en` (1050
names, 480 descriptions).

## Updating

1. Bump `version` in `sources.json` (the file list and the URLs derive from it; add or remove entries
   when upstream adds or removes artifacts).
2. `npm run fetch -- --update-hashes` — downloads into `upstream/` and records the new sha256.
   Without `--update-hashes` a changed artifact is an error, which is the point of the pin.
3. `npm run convert` — rewrites `dist/profiles/`, `dist/translations/` and the top-level files.
   Read the warnings it prints: every value it could not resolve is listed.
4. `npm run compare-legacy` — refreshes `COMPARISON.md` while `legacy/` still exists.
5. Review `git diff data/dist`. The output is Prettier-formatted two-space JSON with sorted keys, so
   a real change is visible; `manifest.json` keeps its `generatedAt` when nothing else moved, and a
   second `npm run update` therefore produces no diff at all.
6. Commit `sources.json` and `dist/` together.

`npm run update` is steps 2 and 3 (without `--update-hashes`). `npm run icons-subset` is not part of
it: it needs `sharp` and the `legacy/` tree, and its output changes only when the images do.

`upstream/` is git-ignored. `npm test` and everything the app does read `dist/` only, so a fresh
checkout never needs to fetch anything.

## Where each value comes from

Three sources overlap, and they do not agree. The order below is what the converter applies.

### Link profiles

1. **`profiles/<RECEIVER_TYPE>.json.gz`** wins for the parameter constraints and for the German and
   English name and description. Its extractor evaluates the WebUI's Tcl, so its numbers are the
   trustworthy ones. It covers 1113 profiles.
2. **`easymode_extract.json.gz`** adds the 494 sender types and 2408 profiles the profiles files do
   not have, and is the only source of `name_key`, which becomes `LinkProfile.key`. Its values are
   still literal Tcl, so the converter resolves them: trailing comments (`149 ;# match with profile
   4`), word booleans, Tcl lists (`{3 4}`) and jump-target substitutions
   (`[subst {$ON_DELAY $OFF_DELAY}]`). The symbol table for the last one was derived from the 1082
   profiles both sources describe, by aligning every token with the number the profiles extractor
   produced for it; `test/constraints.test.mjs` re-derives it and shows both sources agree on 99 % of
   the ~25 000 shared constraints. A value that still does not resolve is **dropped**, not shipped -
   a half-resolved constraint would end up in a `putParamset`.
3. **`legacy/www/easymodes/`** fills descriptions the first two have none for, supplies every Turkish
   string (D-15), and supplies the name key of the ten profiles that only exist in the profiles
   files.

### Translations

**`translation_custom/*.json` over `translation_extract.json.gz`.** openccu-data's `NOTICE.md` calls
the custom files "hand-curated translation overrides", and they are the newer, corrected texts; they
also are the only MIT-licensed part of the data. The 2.x localisation contributes only Turkish, and
only keys that German or English actually have, so the fallback never invents an identifier.

### Keys

`translations/*.json` uses the CCU's own identifiers, as the contract asks:

| Map | Key | Upstream |
| --- | --- | --- |
| `channelTypes` | `DIMMER` | `dimmer` |
| `deviceModels` | `HM-LC-SW1-FM`, `263_130` | `hm-lc-sw1-fm`, `263 130` |
| `parameters` | `LONG_ON_TIME`, `DIMMER\|LEVEL` | `long_on_time`, `dimmer\|level` |
| `parameterValues` | `ACTION_TYPE\|JUMP_TO_TARGET` | `action_type=jump_to_target` |
| `parameterHelp` | `ACOUSTIC_ALARM_SIGNAL` | `acoustic_alarm_signal` |
| `uiLabels` | `lblignore`, `stringtableeventdelay` | verbatim |

`uiLabels` is the exception: its keys are WebUI label keys rather than CCU identifiers, and
openccu-data already lower-cases them while extracting. Every `labelKey` and `errorKey` the pipeline
emits is lower-cased to match, so `uiLabels[labelKey]` is a direct hit and no casing rule leaks into
the core. Where openccu-data keeps a label key under `parameters` instead of `ui_labels`, the
converter copies it into `uiLabels`, so that lookup always works. Six WebUI keys have no string
upstream at all (two of them are unevaluated Tcl expressions there); `test/dist.test.mjs` pins that
list, so a seventh one would fail the build.

The three `cross_validation.*` error messages are the only hand-written strings in
`dist/translations/`: openccu-data defines the rule ids but no texts for them.

## Device images (D-10)

`device-icons.json` maps a device type to the bare file name the CCU serves under
`/config/img/devices/<size>/`. Ten of the 535 entries live in the CCU's `coupling/` subdirectory;
the contract asks for a bare name, so `scripts/icons-from-ccu.mjs` retries that path.

`dist/icons/` is the fallback for installations without a CCU (Homegear, bare rfd/hmipserver): the
BidCos-RF and BidCos-Wired images of the 2.x tree at 50 px height as webp, 121 files for 201 device
types, 79 KB. They are named after the entry in `device-icons.json`, so both sources resolve the same
way - take `deviceIcons[type]` and swap the extension for `.webp`.

`scripts/icons-from-ccu.mjs <http://ccu> <directory>` downloads the full set from a CCU. It is a
tool, never part of `npm run update`, and takes the address as an argument so that none is ever
committed.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run fetch` | download `sources.json` into `upstream/`, verify sha256 (`-- --update-hashes` re-pins, `-- --force` re-downloads) |
| `npm run convert` | write `dist/` from `upstream/` |
| `npm run update` | fetch + convert |
| `npm run compare-legacy` | write `COMPARISON.md` from `dist/` and `legacy/www/easymodes/` |
| `npm run icons-subset` | rebuild `dist/icons/` (`-- --height 40 --quality 75` to shrink it) |
| `npm test` | validate `dist/` against the contract and against the facts in `docs/analysis-2026-09.md` |

## Licensing

The code in this repository is GPLv3; the data here is not. See [NOTICE.md](NOTICE.md).

- Everything derived from openccu-data's `easymode_extract`, `profiles/`, `translation_extract` and
  `device_icons` - that is `dist/profiles/`, `dist/master-metadata.json`, `dist/option-presets.json`,
  `dist/cross-validations.json`, most of `dist/translations/de.json` and `en.json`, and
  `dist/device-icons.json` - is a derivative of OpenCCU-Base's `www/` tree and keeps the **Homematic
  Software License 2.0**: free for private and non-commercial use, commercial redistribution needs
  eQ-3's permission.
- openccu-data's `translation_custom/` overrides are **MIT**.
- `dist/translations/tr.json` and the Turkish profile texts come from this project's own 2015
  easy-mode localisation - which was itself derived from OCCU and therefore carries the same HMSL 2.0
  terms.
- `dist/icons/` are converted copies of OCCU device images: HMSL 2.0 as well.
- The three `cross_validation.*` messages are ours.

## Caveat on the upstream artifacts

openccu-data extracts from either a local OpenCCU checkout or a running CCU, and merges both when
both are configured. Until OpenCCU's WebUI patches land in OpenCCU-Base, the committed artifacts -
merged from a running CCU - are more accurate than a fresh extraction from OpenCCU-Base would be.
That is the reason this directory pins a released version and updates deliberately instead of
re-extracting: what is committed upstream is the better data, and it is reproducible.

At 2026.7.2 the upstream repository has no `DATA_SOURCES.md` any more; its `README.md` documents the
same merge behaviour.
