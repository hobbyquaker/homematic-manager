# Assumptions of `@homematic-manager/core`

Everything in this package is derived from three sources: the 2.x code in `legacy/` (the only
specification of the old behaviour that exists, D-3), the eQ-3 XML-RPC specification as the 2.x
`rpcMethods.json` carries it, and 962 real paramset descriptions from
[node-red-contrib-ccu](https://github.com/rdmtc/node-red-contrib-ccu)'s `paramsets.json`.

None of it has been run against hardware. The list below is what
[roadmap task 6](../../ROADMAP.md#6-paramset-write-safety-and-the-config_pending-study) has to
verify in the lab, in the order in which getting it wrong hurts. Each entry says what the code
does today, where it says so, and what would prove or disprove it.

## A-1 HmIP wants enum names, BidCos wants enum indexes

`enumEncodingFor(interfaceName)` in `src/paramset/cast.ts` returns `name` for `HmIP-RF` and `index`
for everything else, so a `putParamset` to hmipserver sends `"BASE_1_H"` and one to rfd sends `7`.

This is what 2.x does (`homematic-manager.js:1782`, `daemon === 'HmIP' ? VALUE_LIST[i] : i`) and it
has worked in production for years, but nobody has checked whether hmipserver **also** accepts the
index, or whether rfd **also** accepts the name. If both accept both, the option can go away; if
hmipserver rejects an index with a fault rather than with silence, that fault is worth showing.

**Verify:** `putParamset` an `ENUM` parameter on the HmIP-PDT once as a name and once as an index,
and on a BidCos-RF actor the other way round. Record the fault, the `getParamset` afterwards and
whether `CONFIG_PENDING` appears.

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

## A-5 A `SPECIAL` value must pass validation although it is outside `MIN`..`MAX`

`validateNumber()` in `src/paramset/validate.ts` lets a value through when it equals one of the
parameter's `SPECIAL` entries. This is not a guess about the data - the descriptions say so, e.g.
BidCos-RF `LONG_OFF_TIME` has `MAX 108000` and `SPECIAL [{NOT_USED, 111600}]` - but it is a guess
about the _device_: that writing 111600 is accepted rather than faulted.

**Verify:** write the `NOT_USED` value of a `*_TIME` parameter of a link paramset and read it back.

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

**Verify:** during the task 6 lab session, fetch `getParamsetDescription` for every channel of the
test devices and check that two channels with the same identity really return the same description
(node-red-contrib-ccu's `tools/paramsets-fetch.js` does exactly this fetch).

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

**Verify:** compare `getParamset MASTER` with `getParamsetDescription MASTER` on every lab device
and check that the value set is complete.

## A-16 (settled) BIN-RPC is loopback-only on a CCU

Not an assumption any more: the maintainer confirmed on 2026-09-05 that rfd and hs485d accept
BIN-RPC on their process ports 32001/32000 only, and that the public ports are lighttpd XML-RPC
proxies (D-28). The interface table therefore never resolves a public port to `binrpc`; only the
addon's local mode and CUxD use it. Task 6 still compares umlauts over XML-RPC and BIN-RPC, but
the BIN-RPC side of that only matters for the addon.

## A-15 `HmIP-WRC6` stands in for the `HmIP-WRC2` of the lab

`test/fixtures/paramset-descriptions.json` has no HmIP-WRC2 - the source set does not contain one -
so the WRC6 is used instead. Both expose `KEY_TRANSCEIVER`, which is what the tests exercise.

**Verify:** fetch the WRC2's descriptions in the lab and add them to the fixture.
