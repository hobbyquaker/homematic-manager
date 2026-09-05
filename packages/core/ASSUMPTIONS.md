# Assumptions of `@homematic-manager/core`

Everything in this package is derived from three sources: the 2.x code in `legacy/` (the only
specification of the old behaviour that exists, D-3), the eQ-3 XML-RPC specification as the 2.x
`rpcMethods.json` carries it, and 962 real paramset descriptions from
[node-red-contrib-ccu](https://github.com/rdmtc/node-red-contrib-ccu)'s `paramsets.json`.

The list below is what [roadmap task 6](../../ROADMAP.md#6-paramset-write-safety-and-the-config_pending-study)
had to verify in the lab, in the order in which getting it wrong hurts. Each entry says what the
code does today, where it says so, and what would prove or disprove it.

**Status 2026-09-05.** Task 6 ran the study on two lab CCUs on firmware 3.89.8 (an HmIPW-DRS8 and
an HmIPW-DRI16 on a wired access point, an HmIP-PDT and an HmIP-WRC2 on radio, a BidCos-RF HM-CC-TC
and HM-Sec-SC). The write-up is [docs/config-pending.md](../../docs/config-pending.md), the script
is `tools/lab/config-pending-study.mjs`. Each entry below now starts with what came of it:

|      |                                                              | 2026-09-05                                                            |
| ---- | ------------------------------------------------------------ | --------------------------------------------------------------------- |
| A-1  | enum names on HmIP, indexes elsewhere                        | **refuted** - both take both; the code sends the index everywhere now |
| A-2  | `STRING` at most 255 characters                              | untested - no writable `STRING` without a link on the lab devices     |
| A-3  | link `FLAGS` bits                                            | untested                                                              |
| A-4  | which service messages can be acknowledged                   | untested                                                              |
| A-5  | a `SPECIAL` value passes although it is outside `MIN`..`MAX` | **verified**                                                          |
| A-6  | "not used" is the parameter's own `SPECIAL`                  | untested - the lab has no `*_TIME` parameter with one                 |
| A-7  | `encodeTime` picks the base the device would pick            | untested                                                              |
| A-8  | equal identity means the same description                    | **verified**, and the key is conservative                             |
| A-9  | the link roles in the fixtures                               | partly - real `listDevices` dumps exist now                           |
| A-10 | the HmIP RSSI mapping                                        | untested                                                              |
| A-11 | `DUTY_CYCLE` as a boolean                                    | untested                                                              |
| A-12 | `hmm_<name>` as the init identity                            | untested                                                              |
| A-13 | a `100%` unit means a fraction                               | untested - no such parameter on the lab devices                       |
| A-14 | `writeAll` may fall back to `DEFAULT`                        | **verified as a real case** - the repair reports it                   |
| A-15 | the HmIP-WRC6 stands in for the WRC2                         | **fixed** - the WRC2's own descriptions were dumped                   |
| A-17 | `NN_WP_WEEKDAY` bit 0 is Sunday                              | **verified 2026-09-05** in the lab (task 17, OQ-16)                    |

Two things the study found that were not on this list at all, and that matter more than most of
it: hmipserver **stores what it rejects**, so a parameter a channel does not have is kept for ever
and makes every later `putParamset` on that channel fault; and **neither interface process checks
`MIN`..`MAX`** - hmipserver stores an out-of-range value, rfd clamps it silently. Both are in
`docs/config-pending.md`.

## A-1 HmIP wants enum names, BidCos wants enum indexes - **REFUTED 2026-09-05**

`enumEncodingFor(interfaceName)` used to return `name` for `HmIP-RF` and `index` for everything
else, copying 2.x (`homematic-manager.js:1782`, `daemon === 'HmIP' ? VALUE_LIST[i] : i`).

Measured on both lab CCUs: **both interface processes accept both forms.**
`putParamset(<channel>, 'MASTER', {POWERUP_ONDELAY_UNIT: "100MS"})` and the same with `0` are both
answered `ok` by hmipserver and stored identically; rfd takes `"0s"` and `0` for
`DISPLAY_BACKLIGHT_TIME` and converts the name to its index. **`getParamset` answers with the index
on both**, which decides the question: sending the name would make a changed-only diff see every
`ENUM` as changed on every write and send parameters the user never touched.

`enumEncodingFor()` therefore returns `index` for every interface. What is dangerous is a value
that is in neither form - an unknown name, or an index outside the `VALUE_LIST`: hmipserver answers
`-5 Invalid parameter or value` **and keeps the bad value**, leaving `CONFIG_PENDING` set until a
valid full `MASTER` write; rfd ignores it in silence. `validate.ts` refuses both before the wire.

## A-2 A `STRING` parameter accepts at most 255 characters

`DEFAULT_MAX_STRING_LENGTH` in `src/paramset/validate.ts` is 255. The paramset descriptions carry
no length at all for `STRING` (`MIN` and `MAX` are empty strings), and the CCU's own name fields
stop at 255, so that is the guess. A device with a shorter limit would be rejected by the device,
not by us.

**Verify:** write a 256-character string to a writable `STRING` parameter (for instance a link
`NAME`) and see whether the interface faults or truncates.

## A-3 A link's `FLAGS` bit 1 means "sender broken", bit 2 "receiver broken"

`LINK_FLAGS` in `src/links/roles.ts`. 2.x showed the link grid but never looked at `FLAGS`, so a
half-written link looked exactly like a working one and there is no working code to compare
against. The two bits come from the eQ-3 specification.

**Verify:** create a link, take the receiver off power, delete the link, put it back - or provoke a
failed transfer in whatever way the lab allows - and read `getLinks` with and without
`GL_FLAG_SENDER_PARAMSET`.

## A-4 `STICKY_UNREACH`, `SABOTAGE` and `ERROR*` can be acknowledged, the rest cannot

`ACKNOWLEDGEABLE_DATAPOINTS` and `isAcknowledgeable()` in `src/serviceMessages/index.ts`, taken from
where the CCU WebUI offers a "confirm" button. 2.x had no acknowledgement at all - it needs ReGa
(D-2) - so this is inferred from the WebUI, not from our own code.

**Verify:** acknowledge each kind in the WebUI and watch what the datapoint does; then reproduce it
through ReGa from the backend (task 4) and check that the same datapoint clears.

## A-5 A `SPECIAL` value must pass validation although it is outside `MIN`..`MAX` - **VERIFIED 2026-09-05**

`validateNumber()` in `src/paramset/validate.ts` lets a value through when it equals one of the
parameter's `SPECIAL` entries.

Measured on the BidCos-RF HM-CC-TC: `SETPOINT` of its `CLIMATECONTROL_REGULATOR` channel is
`FLOAT`, `MIN` 6, `MAX` 30, with `SPECIAL` `VENT_CLOSED` = 0 and `VENT_OPEN` = 100. Both were
written with `setValue` and read back unchanged, and the device's own resting value was already one
of them. Clamping to `MIN`/`MAX` would break the device's semantics.

Still untested (A-6): the BidCos `NOT_USED` = 111600 s value of a `*_TIME` parameter. No device in
the lab has a link paramset with one - the HM-CC-TC's only link parameter is
`TEMPERATUR_WINDOW_OPEN_VALUE`, and the HmIP link paramsets use `*_TIME_BASE`/`*_TIME_FACTOR` pairs
and carry no `SPECIAL` at all. It needs a BidCos-RF actor or a BidCos-Wired device.

## A-6 "Not used / infinite" is the parameter's own `SPECIAL` value, not a constant

`notUsedValue()` in `src/paramset/time.ts` and the long note at the top of that file. Issue #96
reports 111600 s where the WebUI shows 16383000 s; the descriptions say both are right, for their
own device (BidCos-RF and HmIP-RF: 111600 = `BASE_1_H` * 31; BidCos-Wired: 16383000, with `MAX`
982980 = 16383 * 60). 2.x has 111600 hard-coded in a select and therefore shows the wrong one on a
wired device.

**Verify:** on the wired HmIPW/HMW devices in the lab, set a duration to "unlimited" in the CCU
WebUI, then read the paramset and compare with what this code would write.

## A-7 `encodeTime` picks the base the device would pick

`encodeTime()` in `src/paramset/time.ts` chooses the smallest base that represents the value
exactly with a factor 0..31, and the closest one otherwise. The device only ever sees base and
factor, so any pair with the same product should behave identically - but the WebUI may prefer a
different pair, and a paramset written by us would then differ from one written by the WebUI even
though both mean the same duration.

**Verify:** set the same duration in the WebUI and compare the stored `*_TIME_BASE` /
`*_TIME_FACTOR` pair.

## A-8 Equal paramset identity means literally the same description

`paramsetIdentity()` in `src/devices/index.ts` and `multiApplyEligibility()` in
`src/paramset/multiApply.ts` treat `interface/deviceType/firmware/version/channelType/paramset` as
the identity of a description. It is the key 2.x already used for its description cache, and the
key node-red-contrib-ccu's `paramsets.json` is keyed by, so a collision would already have shown up
there - but "no collision seen" is not "no collision possible".

**Measured 2026-09-05:** all 24 `SWITCH_VIRTUAL_RECEIVER` channels of the HmIPW-DRS8 return
byte-identical `MASTER` descriptions, and the `KEY_TRANSCEIVER` `MASTER` descriptions of the
HmIP-PDT and the HmIP-WRC2 are identical across two device types. No case was found where equal
identity meant a different description.

Worth knowing next to it: **`getParamsetId`**, which both interface processes implement, is the
CCU's own identity for a description. It is per channel **type** on BidCos (`cc_tc_ch_master`,
`sc_ch_master`) and per channel **index** on HmIP (`hmipw-drs8_2_master`, `hmipw-drs8_3_master`,
`hmip-pdt_1_master`). Ours is coarser than the HmIP one and finer than the BidCos one - it refuses
some multi-applies that would have been safe, which is the right direction, and it costs no RPC
call. Using `getParamsetId` instead is one call per channel and a possible follow-up.

The counter-example that matters for #98 is a different one: `MAINTENANCE` `MASTER` has 23
parameters on the HmIPW-DRS8, 21 on the HmIP-PDT and 9 on the HmIP-WRC2 - same channel `TYPE`,
three different paramsets. 2.x offered exactly that as one multi-apply.

## A-9 The link roles in the device fixtures are plausible, not measured

`test/fixtures/devices.json` is hand-built. Device types, firmware and versions match the real
paramset descriptions next to it, but the `LINK_SOURCE_ROLES` / `LINK_TARGET_ROLES` strings were
written by hand and only the well-known BidCos role names (`SWITCH`, `KEYMATIC`, `WINMATIC`) are
certain. What is tested is the matching logic, not the role vocabulary.

**Verify:** replace the fixture with a real `listDevices` answer from the lab once there is one.

## A-10 The HmIP RSSI mapping of 2.x is the right way round

`RssiStore.applyHmipValue()` in `src/rssi/index.ts` files `RSSI_DEVICE` as what the access point
receives from the device and `RSSI_PEER` as what the device receives from the access point, copied
from `legacy/main.js:404-432`. If 2.x had them the wrong way round, the radio tab has been showing
transposed values for years and nobody noticed, which is entirely possible for two numbers that are
usually within a few dBm of each other.

**Verify:** move an HmIP device far from the access point and watch which of the two numbers drops.

## A-11 `DUTY_CYCLE` is a service message only as a boolean

`countsAsServiceMessage()` in `src/serviceMessages/index.ts`, from `legacy/main.js:406`
("Not a Service Message!"). On HmIP the same name is also an `INTEGER` datapoint carrying the
transmitter's duty cycle in percent.

**Verify:** provoke a duty-cycle event on both interfaces and check the type of the value.

## A-12 `hmm_<name>` is a free choice, `CUxD` is not

`interfaceIdent()` in `src/interfaces/table.ts`. The init identity is ours to choose except for
CUxD, which matches the literal string `CUxD` and silently drops any other subscription. Keeping
the 2.x prefix means a 3.0 and a 2.x running against the same CCU do not fight over one
subscription - which is worth confirming rather than assuming.

**Verify:** run 3.0 and 2.7.1 against the same CCU at the same time and check that both receive
events.

## A-13 A `100%` unit means the stored value is a fraction, for every type

`displayFactor()` in `src/paramset/units.ts` scales by 100 in both directions whenever `UNIT` is
`100%`. 2.x divided by 100 and then `parseInt`ed an `INTEGER` with that unit, which truncates -
so if an `INTEGER` parameter with a `100%` unit exists, 2.x wrote nonsense to it and the correct
behaviour is unknown.

**Verify:** look for an `INTEGER` with `UNIT` `100%` in the descriptions of the lab devices; if one
exists, write a value and read it back.

## A-14 `writeAll` may fall back to `DEFAULT` for a parameter that was never read

`diffParamset()` in `src/paramset/diff.ts` uses, in that order, the edited value, the value read
from the device, and the description's `DEFAULT`. The fallback only happens when `getParamset` did
not return the parameter at all, which should not occur - but if it does, writing `DEFAULT` is a
change the user did not ask for.

**Measured 2026-09-05:** on an undamaged channel the two agree. On a channel a bad write reached
they do **not**, and in both directions: `getParamset` returns parameters the description does not
have (everything hmipserver stored and rejected), and after a `clearConfigCache` on BidCos it can
return fewer than the description has. So the fallback is a real case, not a theoretical one -
`devices.repairConfig` reports every parameter it had to fill in from the `DEFAULT` as a
correction, because writing one is a change the user did not ask for.

## A-16 (settled) BIN-RPC is loopback-only on a CCU

Not an assumption any more: the maintainer confirmed on 2026-09-05 that rfd and hs485d accept
BIN-RPC on their process ports 32001/32000 only, and that the public ports are lighttpd XML-RPC
proxies (D-28). The interface table therefore never resolves a public port to `binrpc`; only the
addon's local mode and CUxD use it. Task 6 still compares umlauts over XML-RPC and BIN-RPC, but
the BIN-RPC side of that only matters for the addon.

## A-15 `HmIP-WRC6` stands in for the `HmIP-WRC2` of the lab

`test/fixtures/paramset-descriptions.json` has no HmIP-WRC2 - the source set does not contain one -
so the WRC6 is used instead. Both expose `KEY_TRANSCEIVER`, which is what the tests exercise.

**Measured 2026-09-05:** the WRC2's own descriptions were dumped in the lab. Its
`KEY_TRANSCEIVER` `MASTER` is byte-identical to the HmIP-PDT's, so the stand-in was harmless for
what the tests exercise - but its `MAINTENANCE` `MASTER` has 9 parameters where the PDT has 21 and
the DRS8 23, which is exactly the difference that makes a multi-apply across device types dangerous.
The anonymised `listDevices` dumps are in hm-simulator's `data/fixtures/lab-devices.json`.

## A-17 `NN_WP_WEEKDAY` bit 0 is Sunday - **VERIFIED 2026-09-05 (OQ-16)**

`WEEKDAY_BIT_LABELS` in `packages/ui/src/lib/util/editors/switchProfile.ts` labels the seven bits of
the HmIP switching programme's weekday mask Sunday first. Nothing in the paramset description and
nothing in `data/dist` says which bit is which day; task 10 inferred it from the HmIP weekday enums
the descriptions do document (`DECALCIFICATION_WEEKDAY` and `DST_START_DAY_OF_WEEK` on HmIP start at
Sunday, while the *BidCos* `DECALCIFICATION_WEEKDAY` starts at Saturday), and printed the raw mask
beside the checkboxes because of the doubt.

**Measured 2026-09-05 on the lab boxes, and the inference was right.** The mask is produced by the
CCU's own dialog, `/www/config/easymodes/js/HmIPWeeklyProgram.js`, which is byte-identical
(md5 `929085c9751a95b15d7ff1cc43d15414`) on CCU3 firmware 3.89.8 and on OpenCCU 3.89.8. Its
`_getWeekDay()` emits one checkbox per day carrying the bit value as the checkbox `value`, and
`setWPWeekday()` adds or subtracts that value from the hidden `NN_WP_WEEKDAY` field the WebUI
submits. Loading that file and the WebUI's jQuery from a lab box into a browser, rebuilding the row
it emits and ticking one day at a time gives:

| bit | value | day       |
| --- | ----- | --------- |
| 0   | 1     | Sunday    |
| 1   | 2     | Monday    |
| 2   | 4     | Tuesday   |
| 3   | 8     | Wednesday |
| 4   | 16    | Thursday  |
| 5   | 32    | Friday    |
| 6   | 64    | Saturday  |

All seven ticked is 127. The same file says it a second way where it fills the checkboxes back in
from a stored value: it renders the mask as a seven-character binary string, most significant bit
first, and reads Saturday from index 0 and Sunday from index 6.

No device was written to for this. The measurement runs the CCU's own function over its own markup
and never submits the form - which is also why it can be repeated on any box without a week
programme configured, as the lab's HmIP-PDT (`DIMMER_WEEK_PROFILE`, 75 slots, every `NN_WP_WEEKDAY`
still 0) is. The raw mask stays next to the checkboxes in the editor: it costs nothing, and it is
what would have made a wrong answer visible.
