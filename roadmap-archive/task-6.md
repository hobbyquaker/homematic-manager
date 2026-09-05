# Task 6: Paramset write safety and the CONFIG_PENDING study (done 2026-09-05)

Six commits on `3.0-dev` from `9d39076` (the repeatable lab script) to `216261f` (assumptions
settled), two on hm-simulator `1.0-dev` (`a7a761c` real channel layouts, `f5cb4d2` measured fault
tables and `CONFIG_PENDING` modes). Write-up: `docs/config-pending.md`. Raw dumps outside the
repository next to the private lab note.

## What was done

`tools/lab/config-pending-study.mjs` runs every provocation and recovery step against a named
host/interface/device with a `--yes` gate and `--dry-run`; nothing in the repository names a
host, an address or a credential. Measured on two lab CCUs (firmware 3.89.8) with HmIPW-DRS8 and
HmIPW-DRI16 (wired), HmIP-PDT and HmIP-WRC2 (radio) and the BidCos-RF HM-CC-TC and HM-Sec-SC.
Changes that followed: ENUMs go to every interface as their index (A-1 refuted: both interfaces
take both encodings, both read back the index); `devices.repairConfig` in the API contract and
`packages/backend/src/write/repair.ts` (13 unit tests, 4 simulator regression tests); the queue
test no longer leaves a write without a rejection handler; `ASSUMPTIONS.md` marks each of the
fifteen assumptions verified, refuted or untested. hm-simulator now defaults to the measured
`hmip` and `bidcos` `CONFIG_PENDING` modes, has the measured fault tables per interface process,
models poisoned channels, implements the maintenance methods on BidCos only and can answer
`getServiceMessages` with `""` as rfd does.

## Measured (all on hardware)

| provocation                    | hmipserver                            | rfd                               |
| ------------------------------ | ------------------------------------- | --------------------------------- |
| valid full re-write, no change | ok, no flag                           | ok, 6 ms                          |
| ENUM as name / as index        | ok / ok                               | ok, converted / ok                |
| FLOAT as plain int             | stored as the integer                 | silently ignored                  |
| INTEGER above MAX              | stored unchecked                      | clamped to MAX                    |
| string in an INTEGER           | fault -5, kept, sticky CONFIG_PENDING | coerced to MIN                    |
| unknown parameter name         | fault -5, stored for ever, no flag    | dropped                           |
| SPECIAL outside MIN..MAX       | not on these devices                  | accepted, read back exactly (A-5) |

The mechanism behind #98: hmipserver stores every entry of a `putParamset` before validating.
An unknown parameter is persisted in the device file, survives a restart and makes every later
`putParamset` on that channel fault, even an empty struct. Nothing in the RPC API removes it.
2.x's multi-apply by channel TYPE (MAINTENANCE has 23/21/9 MASTER parameters on DRS8/PDT/WRC2)
therefore destroyed channels irreversibly. The only recovery that works is a valid full MASTER
write of the channel, which clears the sticky flag even while the call still faults;
`clearConfigCache`, `restoreConfigToDevice` and `determineParameter` answer -1 on hmipserver and
work on rfd. Battery BidCos devices show a normal transient `CONFIG_PENDING` (160–180 s on the
HM-CC-TC, longer on the HM-Sec-SC until a physical wake-up).

Also settled: the LINK description is peer-independent on BidCos (HmIP unverified, an unlinked
peer answers -3); XML-RPC writes UTF-8 and the CCU stores mojibake (`homematic-xmlrpc`), BIN-RPC
writes correctly but reads as UTF-8 (`binrpc`), so our latin1 response decoding is right and both
upstream one-liners of task 15 stand; D-28 confirmed on a stock CCU (2001 is lighttpd XML-RPC,
32001 is firewalled local-only); `getServiceMessages` on rfd answers `""` not `[]`.

## Found and left

- Items 1–5 of the task (changed-only writes, cast/validate, multi-apply by identity, dryRun
  preview with progress and cancel, session write log) were already implemented by task 4 and
  are covered; no gap found.
- For task 8 (sent to its agent): two explanations for `CONFIG_PENDING` (BidCos queued versus
  HmIP invalid, only the latter gets Repair); read-back after a BidCos write because `ok` means
  nothing there; `repairConfig` results with `corrected` and `unrepairable`; the preview renders
  the exact `putParamset` call.
- The two unhandled rejections reported from `queue.test.ts` could not be reproduced; the latent
  cause was removed anyway. One of them was an `ApiRequestError`, a `packages/ui` class.
- Not tested: a second foreign parameter name (same mechanism, would poison another channel for
  good), the `relink` HmIP recovery (implemented as `--recovery relink`, not run), sticky
  unreach on first connect (needs callbacks the CCUs cannot deliver into WSL), BidCos `NOT_USED`
  111600 s, 256-char STRING, INTEGER with `100%`, BidCos-Wired/CUxD/VirtualDevices (no devices).
- Lab state after the study (recorded in the private lab note): one HmIPW-DRS8 channel's MASTER
  is permanently poisoned and answers -5 to every `putParamset`; its VALUES and the other
  channels work; only deleting and re-pairing the device or a CCU backup from before the study
  removes it. The HM-Sec-SC carries a normal `CONFIG_PENDING` until its next wake-up.
