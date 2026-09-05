# Task 10: Device-specific editors, initial set (done 2026-09-05; extended set stays M5)

Seven commits on `3.0-dev` from `9c36b0e` (one duration pair in core) to `e36d4fe` (README),
interleaved with tasks 13 and 14.

## What was done

A plug-in point on top of the generic paramset editor: detectors in
`packages/ui/src/lib/util/editors/` (pure, offered the description plus a context with the string
table and MASTER metadata; what a detector recognises leaves the generic list, detectors run in
order and see what earlier ones claimed) and components under
`packages/ui/src/routes/paramset/editors/` with a typed dispatch. Editors write into the dialog's
own edited map, so the payload stays the changed-only diff and no editor calls `putParamset`. A
"show the raw parameters as well" checkbox keeps every covered parameter reachable. Five editors:
the heating week programme (profile and weekday strips, 13 or 24 slots as clock times, copy-day,
copy-profile, validation of rising end times ending at 24:00; four naming shapes from the
description alone: HmIP `P1_ENDTIME`/`P1_TEMPERATURE` with the profile count taken from the
description, BidCos `P1..P3` on HM-TC-IT-WM, `ENDTIME`/`TEMPERATURE` on the HM-CC-RT-DN device
MASTER, `TIMEOUT`/`TEMPERATUR` with 24 slots on HM-CC-TC, which is also what Max! answers through
Homegear, no special case per D-20); the HmIP switching programme (one line per `NN_WP_*` slot
with weekday mask, fixed time, condition, astro offset, level, duration, target channels); enum
extensions where the string table names values by index or the metadata assigns a preset; blind
and shutter calibration in plain seconds beside the raw value; duration pickers on every
base/factor and HmIP unit/value pair through core's unified `DurationPair`, with "not used" from
the parameter's own `SPECIAL` where there is one and the pair maximum otherwise, never the
constant of #96. Every string through i18n (about 40 new keys).

## Measured

`packages/ui` 529 tests in 36 files, green in jsdom and unchanged in headless Chromium; core 457
tests with `paramset/time.ts` at 100 %; workspace 1739 tests in 112 files. UI coverage 94.3 %
statements, 82.0 % branches (no regression against task 8). Bundle +39.6 kB JS (+12.3 kB gzip)
and +6.2 kB CSS for the five editors. Fixtures: eight verbatim descriptions from
node-red-contrib-ccu's `paramsets.json` in `packages/ui/test/fixtures/deviceDescriptions.ts`.

## Found

- `findTimePairs` in core was too narrow: `SWITCHING_INTERVAL_BASE/_FACTOR` and the HmIP week
  profile pairs use the same bases under other prefixes, and HmIP's `*_UNIT`/`*_VALUE` is a
  second encoding with six unit vocabularies; hence the unified `DurationPair`.
- 586 of the 3039 value translations in `data/dist` are keyed by index, not by `VALUE_LIST` name
  (141 parameters); 52 channel types assign an option preset to a parameter and a third of those
  are enums, which the generic row never showed as a dropdown. Both are reachable now.
- The BidCos thermostat week profile lives on the device MASTER, not a channel, which is why
  editors match parameters rather than channel types. `DISPLAY_INFORMATION` is a plain
  `TIME|DATE` enum; only its translation is special.
- No real description carries a `SPECIAL` on a base/factor/unit/value parameter, so the pair
  maximum is what "not used" shows in practice.
- Unverified: the `NN_WP_WEEKDAY` bit order (bit 0 taken as Sunday from the documented HmIP
  weekday enums; BidCos starts at Saturday). The editor prints the raw mask next to the
  checkboxes; OQ-16 asks for a lab check against the WebUI.
- 2.7 had no week-profile UI, so these five are new UX rather than a port; D-3 does not
  constrain them. The OpenCCU-Base WebUI checkout the analysis used is no longer on the machine.
- Task 14's `strictTypeChecked` migration for `packages/ui` was uncommitted while this ran; under
  the committed config everything here lints clean.
- Left for the extended set (M5): universal light effects, RGBW/dual-white, alarm panel, energy
  meter ESI, door lock; plus `DIMMER_WEEK_PROFILE` (`RAMP_TIME`) and `BLIND_WEEK_PROFILE`
  (`LEVEL_2`) columns rendered but untested, `TARGET_CHANNELS` shown as the raw 24-bit number,
  and no copy-slot action in the switching editor.
