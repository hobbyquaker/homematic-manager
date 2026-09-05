# `CONFIG_PENDING`, and what a bad `putParamset` really does

Roadmap task 6. Measured on 2026-09-05 against two lab CCUs (firmware 3.89.8), on an HmIPW-DRS8
and an HmIPW-DRI16 on a wired access point, an HmIP-PDT and an HmIP-WRC2 on radio, and a BidCos-RF
HM-CC-TC and HM-Sec-SC. The measurement is repeatable:
[`tools/lab/config-pending-study.mjs`](../tools/lab/config-pending-study.mjs) does every step of
it. Raw dumps stay outside the repository, next to the private lab note; nothing here names a
host, an address or a credential, and the device serials in the simulator fixtures are anonymised.

Everything marked **verified on hardware** below was produced by that script against the devices
above. Everything marked _simulator only_ or _untested_ is exactly that.

## The short version

Issue [#98](https://github.com/hobbyquaker/homematic-manager/issues/98) is worse than the analysis
assumed, and in a way that changes what the application is allowed to send.

1. **hmipserver stores what it rejects.** A `putParamset` that hmipserver answers with a fault has
   already written every entry of the struct into its own configuration for that channel. The
   fault is raised when the resulting configuration cannot be transferred to the device.
2. **A parameter the channel does not have poisons the channel for good.** It is stored, it is
   persisted in `crRFD/data/<SGTIN>.dev`, it survives a restart of hmipserver, and from then on
   **every** `putParamset` on that channel - including one with an empty struct - answers
   `-5 Invalid parameter or value`. No RPC method removes it: `clearConfigCache`,
   `restoreConfigToDevice` and `determineParameter` all answer `-1 Generic error` on hmipserver.
   The channel's `VALUES` (i.e. `setValue`) keeps working, and the other channels of the device are
   untouched.
3. **Neither interface process validates ranges.** hmipserver stores an `INTEGER` of 62 in a
   parameter whose `MAX` is 31 and answers `ok`; rfd clamps it to the `MAX` silently. A range check
   that the user can see has to happen in the application - it will not happen anywhere else.
4. **A wrong *type* is what raises the sticky flag.** A string in an `INTEGER`, an enum name that
   is not in the `VALUE_LIST`, an enum index outside it: hmipserver answers `-5`, keeps the bad
   value and leaves `CONFIG_PENDING` set on `<device>:0` until a valid configuration is written.
   The recovery that works is a **valid full MASTER write of that channel**.
5. **rfd is silent instead.** It drops an unknown parameter, ignores an `INTEGER` where a `FLOAT`
   belongs, coerces a string to a number, clamps out-of-range values - and answers `ok` to all of
   it. Nothing is ever reported to the user. `CONFIG_PENDING` on BidCos means only "a configuration
   is queued for the device", and it clears when the device takes it.

The 2.x behaviour - send every parameter of the dialog to every channel with the same channel
`TYPE` - is exactly the recipe for (2): `MAINTENANCE` on the HmIPW-DRS8, the HmIP-PDT and the
HmIP-WRC2 has 23, 21 and 9 parameters, so a multi-apply across those three writes `LONGITUDE`,
`OVERTEMP_LEVEL` and `DISPLAY_CONTRAST` to devices that do not have them, and each of those
channels is then permanently unwritable. That is the reporter's ">100 devices in CONFIG_PENDING",
and it cannot be undone from the application.

## Method

Per target: a baseline dump (`listDevices` entry, `getParamsetDescription` + `getParamset` for
every paramset of every channel, `getServiceMessages`, `getLinks`, the tails of `/var/log/messages`
and `/var/log/hmserver.log`), then a control re-write of the unchanged MASTER, then one provocation
at a time, each followed by 20-300 s of polling `getParamset(<device>:0, VALUES)` and
`getServiceMessages`, a MASTER read-back, and the log lines the box gained meanwhile. Recoveries
were tried in order. Every target was written back to its baseline at the end.

The CCU logs turned out to be useless for this: **hmipserver logs nothing at all** for a rejected
`putParamset` at the default log level, and rfd logs nothing either. The only trace of a rejected
write is the XML-RPC fault and, where it appears, the `CONFIG_PENDING` event. That is why #98 was
so hard to diagnose from a CCU.

## Fault codes, measured

Neither table was published by eQ-3; both are what these two interface processes answered.
hm-simulator's `lib/faults.js` is calibrated from them.

### hmipserver (HmIP-RF, firmware 3.89.8) - **verified on hardware**

| situation | `faultCode` | `faultString` |
| --- | --- | --- |
| unknown method | none (HTTP-level) | `Invalid XML-RPC message` |
| unknown device or channel | `-2` | `Invalid device` |
| unknown paramset name | `-2` | `Invalid device` |
| unknown parameter (`getValue`) | `-5` | `Unknown Parameter for value key: <name>` |
| `setValue` on a read-only datapoint | `-5` | `Invalid parameter or value` |
| `putParamset` whose result cannot be transferred | `-5` | `Invalid parameter or value` |
| device not reachable (battery device asleep) | `-1` | `Generic error (UNREACH)` |
| method not implemented for this interface | `-1` | `Generic error` |
| wrong number of arguments | `-321` | `Cannot invoke "String.indexOf(String)" because "deviceId" is null` |

`-321` is an unhandled Java `NullPointerException` reaching the RPC layer; it is not a documented
code and must be treated as "unexpected".

### rfd (BidCos-RF, firmware 3.89.8) - **verified on hardware**

| situation | `faultCode` | `faultString` |
| --- | --- | --- |
| unknown method | `-1` | `<method>: unknown method name` |
| unknown device or channel | `-2` | `Unknown instance` |
| unknown parameter (`getValue`) | `-5` | `Unknown parameter` |
| unknown link (`getLinkInfo`) | `-1` | `Failure` |
| unknown paramset name | no fault | the name is taken as a **peer address**, the LINK defaults are returned |
| wrong number of arguments | no fault | the missing argument defaults |
| `setValue` on a read-only datapoint | no fault | accepted, the value is set |

The last three are worth repeating: rfd answers `ok` where hmipserver answers a fault, and
`getParamset(<channel>, 'ANYTHING')` on rfd returns a link paramset rather than an error. An
application must not read "no fault" as "the write was understood".

Two more shape differences, both measured:

- `getServiceMessages` on **rfd answers the empty string** `""` when there is no message, and an
  array of `[address, datapoint, value]` triples otherwise. hmipserver answers an empty array.
  Anything that calls `.filter()` on the answer has to guard for that.
- **BIN-RPC is not reachable from outside the CCU.** Port 2001 is lighttpd and speaks XML-RPC over
  HTTP only; rfd's own port 32001 speaks BIN-RPC but the CCU firewall marks it `local-only`. So
  BIN-RPC is in practice an addon-only transport (task 13), and the core's interface table saying
  the *public* port also accepts BIN-RPC is wrong for a stock CCU - see "What this changes" below.

## HmIP: what each provocation did

Target: `HmIPW-DRS8` channels `:2` and `:3` (`SWITCH_VIRTUAL_RECEIVER`, wired) and `:0`
(`MAINTENANCE`), plus `HmIP-PDT` channels `:1` (`KEY_TRANSCEIVER`) and `:3`
(`DIMMER_VIRTUAL_RECEIVER`, radio). Both boxes behaved identically, so wired and radio are not
distinguished below. **All verified on hardware.**

| # | provocation | RPC answer | stored in hmipserver? | `CONFIG_PENDING` | recovery |
| --- | --- | --- | --- | --- | --- |
| control | full MASTER re-write, nothing changed | `ok` | yes | no | - |
| h | empty struct `{}` | `ok` | - | no | - |
| d | `ENUM` as its **name** (`"100MS"`) | `ok` | yes | no | - |
| d | `ENUM` as its **index** (`0`) | `ok` | yes | no | - |
| g | `FLOAT` as `<double>` (`explicitDouble`) | `ok` | yes, exact | no | - |
| g | `FLOAT` as a plain `<int>` (13 into 13.4) | `ok` | yes, as `13` | no | write the right value |
| b | `INTEGER` **above `MAX`** (62, `MAX` 31) | `ok` | yes, unchecked | no | write a valid value |
| c | string in an `INTEGER` | `-5 Invalid parameter or value` | yes | **yes, sticky** | valid full MASTER write |
| - | `ENUM` name not in `VALUE_LIST` | `-5 Invalid parameter or value` | yes | **yes, sticky** | valid full MASTER write |
| - | `ENUM` index outside `VALUE_LIST` | `-5 Invalid parameter or value` | yes | **yes, sticky** | valid full MASTER write |
| a | a parameter the channel does not have | `-5 Invalid parameter or value` | **yes, permanently** | no | **none found** |
| f | a parameter of another device type with the same channel type | not executed, see below | - | - | - |

Notes that matter more than the table:

- **The out-of-range case was a false lead at first.** On the channel that had already been
  poisoned by case (a) it answered `-5` and raised `CONFIG_PENDING`; repeated on a clean channel it
  answered `ok` and stored `62`. hmipserver does not range-check at all. Everything that looked
  like a range fault in the first run was the residual unknown parameter.
- **`CONFIG_PENDING` is set when a change is pending that cannot be transferred.** Case (a) writes
  no known parameter, so nothing needs transferring and the flag stays `false` even though the
  channel is now broken. A silent break with no flag and no service message is worse than a flag.
- **A valid full MASTER write is the recovery**, and it works even when the call itself still
  faults: on the poisoned channel the write answered `-5` and nevertheless replaced the
  wrongly-typed values and cleared `CONFIG_PENDING`. On a channel with no unknown parameter it
  answers `ok`.
- `getParamset` returns the *stored* configuration including everything hmipserver rejected -
  which is how the bogus parameter and the string in the `INTEGER` were found. The paramset
  **description** never lists it.
- **Case (f) was deliberately not executed.** It is case (a) with a name that happens to exist on
  another device type, and hmipserver only knows the description of the channel it is writing to,
  so the outcome cannot differ - while the cost is one more permanently unwritable channel. The
  scenario itself is documented from the descriptions instead: `MAINTENANCE` MASTER has 23
  parameters on the HmIPW-DRS8, 21 on the HmIP-PDT and 9 on the HmIP-WRC2; `DISABLE_MSG_TO_AC`,
  `DISPLAY_CONTRAST` and `OVERTEMP_LEVEL` exist only on the first, `DUTYCYCLE_LIMIT` only on the
  second, `LOW_BAT_LIMIT` only on the third. A 2.x multi-apply over the three would poison two of
  them. `tools/lab/config-pending-study.mjs provoke --case f --param <name> --dry-run` shows the
  call without making it.

### The poisoned channel, in detail

After one `putParamset(<channel>, 'MASTER', {HMM_LAB_NO_SUCH_PARAM: 1})`:

- `getParamset(<channel>, 'MASTER')` lists `HMM_LAB_NO_SUCH_PARAM: 1` next to the real parameters.
- `getParamsetDescription(<channel>, 'MASTER')` does **not** list it.
- `putParamset(<channel>, 'MASTER', {})` -> `-5 Invalid parameter or value`. So the fault comes
  from the stored configuration, not from the struct that was sent.
- `putParamset(<channel>, 'VALUES', ...)` and `setValue(<channel>, ...)` keep working.
- `putParamset` on every other channel of the same device keeps working.
- The name is in `/usr/local/etc/config/crRFD/data/<SGTIN>.dev` (a Kryo serialisation of
  hmipserver's device configuration) and survives a restart of hmipserver - verified by restarting
  the service and repeating the probes.
- `clearConfigCache(<device>)`, `clearConfigCache(<channel>)`, `restoreConfigToDevice(<device>)`,
  `restoreConfigToDevice(<channel>)` and `determineParameter(<channel>, 'MASTER', <name>)` all
  answer `-1 Generic error`: they exist in `system.listMethods` but are BidCos methods.
- Add-a-link-and-remove-it as a way to make hmipserver rebuild the channel configuration was **not
  tested** (see "What could not be tested").

What is left: delete the device and pair it again, or restore a CCU backup taken before the write.
Both are outside what an application may do on its own, which is why the only real fix is never to
send a parameter that is not in the channel's own description.

## BidCos-RF: what each provocation did

Target: `HM-CC-TC` device MASTER (three parameters, `RX_MODE` 12) and `HM-Sec-SC` channel `:1`
MASTER (six parameters, wake-up only). **All verified on hardware.**

| # | provocation | RPC answer | stored in rfd? | `CONFIG_PENDING` |
| --- | --- | --- | --- | --- |
| control | full MASTER re-write, nothing changed | `ok`, 6 ms | - | no |
| - | one real change | `ok`, ~1.1 s | yes | yes, until the device takes it |
| h | empty struct `{}` | `ok`, 6 ms | - | no |
| a | a parameter the device does not have | `ok`, 6 ms | **no, dropped** | no |
| d | `ENUM` as its **name** (`"0s"`) | `ok`, ~1.1 s | yes | yes (transfer) |
| d | `ENUM` as its **index** (`0`) | `ok` | yes | only if it is a change |
| - | `ENUM` name not in `VALUE_LIST` | `ok`, 6 ms | **no, ignored** | no |
| c | string in an `INTEGER` (`"not-a-number"`) | `ok`, ~1.1 s | **yes, coerced to `MIN`** | yes |
| c | integer `1` in a `BOOL` | `ok`, 6 ms | **no, ignored** | no |
| b | `INTEGER` above `MAX` (19, `MAX` 10) | `ok`, ~1.1 s | **yes, clamped to 10** | yes |
| g | `FLOAT` as `<double>` | `ok`, ~1.1 s | yes, exact | yes |
| g | `FLOAT` as a plain `<int>` | `ok`, ~1.1 s | **no, ignored** | no change transferred |
| e | `SPECIAL` value outside `MIN`..`MAX` | `ok` | yes, exact | - |

The duration is the tell: a call that changes nothing answers in ~6 ms, a call that queues a
configuration transfer takes ~1.1 s. An application cannot use that, but it explains why "nothing
happened" and "it worked" look identical over BidCos.

`FLOAT` as a plain `<int>` deserves its own line, because it is the one encoding question with a
different answer per interface: writing `LED_ONTIME` (FLOAT, `MAX` 1.275) as `<int>0` after it was
`1.0` left it at `1.0`; writing it as `<double>0.5` set it to `0.5`. **A `FLOAT` must be sent as
`<double>` on BidCos**; hmipserver accepts an `<int>` and converts it.

### How long `CONFIG_PENDING` stays

- **HM-CC-TC** (`RX_MODE` 12, transmits regularly): a real MASTER change raised `CONFIG_PENDING`
  and the service message `["<device>:0", "CONFIG_PENDING", true]` immediately, and both cleared
  **between 160 and 180 s** later without any help.
- **HM-Sec-SC** (door contact, wakes on a state change): `CONFIG_PENDING` came up immediately and
  was **still set after 300 s**, after a valid full re-write of the original values and after the
  restore at the end of the session. That is normal: the queued configuration is transferred when
  the contact next wakes up. Neither `clearConfigCache` nor `restoreConfigToDevice` was needed for
  this, and nothing an application does can shorten it - the flag is the correct answer to "the
  device has not confirmed the configuration yet".
- A **no-change** full re-write on BidCos raises nothing at all: rfd compares against its cache and
  queues no transfer.

That is the difference the UI has to make visible: on BidCos `CONFIG_PENDING` is a normal, expected,
self-clearing state on a battery device; on HmIP it is either a transient during transfer or a
permanent sign that the stored configuration is broken.

## The other questions of task 6

### A-1: HmIP wants enum names, BidCos wants enum indexes - **refuted**

Both interfaces accept **both**. On hmipserver, `POWERUP_ONDELAY_UNIT` as `"100MS"` and as `0` are
both answered `ok` and stored identically. On rfd, `DISPLAY_BACKLIGHT_TIME` as `"0s"` and as `0`
are both accepted, and the name is converted to the index. `getParamset` answers with the **index**
on both interfaces.

Consequences for the code:

- `enumEncodingFor()` may keep the 2.x split - it is not wrong - but it is not load-bearing any
  more, and the safer choice is to send the **index on both**, because that is what a read returns
  and therefore what the changed-only diff compares against. Sending the name where the read
  returns an index makes every `ENUM` look changed on every write.
- What *is* dangerous is an enum value that is in neither form: an unknown **name** or an index
  outside the `VALUE_LIST` is a `-5` plus a sticky `CONFIG_PENDING` on hmipserver, and is silently
  ignored by rfd. Validation against `VALUE_LIST` is not optional.

### A-5: a `SPECIAL` value must pass validation although it is outside `MIN`..`MAX` - **verified**

`SETPOINT` of the HM-CC-TC's `CLIMATECONTROL_REGULATOR` channel is `FLOAT`, `MIN` 6, `MAX` 30, with
`SPECIAL` `VENT_CLOSED` = 0 and `VENT_OPEN` = 100. Both were written with `setValue` and read back
unchanged (`0` and `100`), and the original value was restored. So `validateNumber()` letting a
`SPECIAL` through is right, and clamping to `MIN`/`MAX` would break the device's own semantics.

Not answerable in this lab: the BidCos `NOT_USED` = 111600 s value of a `*_TIME` parameter (A-6).
No device here has a link paramset with such a parameter - the HM-CC-TC's only link parameter is
`TEMPERATUR_WINDOW_OPEN_VALUE`, and the HmIP link paramsets use `*_TIME_BASE`/`*_TIME_FACTOR`
pairs and carry no `SPECIAL` at all. It needs a BidCos-RF actor (`HM-LC-Sw1`, `HM-LC-Dim1`) or a
BidCos-Wired device.

### Does a LINK description depend on the peer? - **no on BidCos, unverified on HmIP**

On rfd, `getParamsetDescription(<channel>, <peer>)` answers for **any** peer, linked or not, and
the answer was byte-identical for three different peers and identical to
`getParamsetDescription(<channel>, 'LINK')`. So caching a link description by channel identity plus
`LINK` - which is what task 4's cache does - is right for BidCos.

On hmipserver the same call answers `-3 Unknown Paramset: <peer>` unless the link exists, so the
question could only have been answered by creating two links; that was not done (see below).
`getParamsetDescription(<channel>, 'LINK')` works there and is what the cache uses anyway.

Worth recording next to it: **`getParamsetId`**, which both interfaces implement, is the CCU's own
identity for a paramset description. It is per channel **type** on BidCos (`cc_tc_ch_master`,
`sc_ch_master`, `cc_tc_ch_link_climatecontrol`) and per channel **index** on HmIP
(`hmipw-drs8_2_master`, `hmipw-drs8_3_master`, `hmip-pdt_1_master`). It would be the natural key
for the description cache and for multi-apply, and it is one RPC call per channel.

### A-8: equal paramset identity means the same description - **holds, and our key is conservative**

All 24 `SWITCH_VIRTUAL_RECEIVER` channels of the HmIPW-DRS8 return byte-identical MASTER
descriptions although `getParamsetId` gives each of them a different id. The `KEY_TRANSCEIVER`
MASTER descriptions of the HmIP-PDT and the HmIP-WRC2 are byte-identical across two device types,
where our identity key (which contains the device type) refuses a multi-apply that would have been
safe. Refusing too much is the right direction; no case was found where equal identity meant
different descriptions.

### The umlaut, XML-RPC vs BIN-RPC - **verified on hardware, both libraries are wrong in one direction**

Measured by writing `Tür Küche äöüß °C` into device metadata (`setMetadata`, the same string
encoders as `setLinkInfo`, but it needs no link) and reading it back over both transports, with the
raw bytes recorded:

| path | bytes on the CCU | what comes back |
| --- | --- | --- |
| write over XML-RPC (`homematic-xmlrpc`) | `54 c3bc 72 ...` - **UTF-8** | round trip through our own client is byte-exact, but the CCU stores UTF-8 in an ISO-8859-1 world, so the WebUI shows mojibake |
| write over BIN-RPC (`binrpc`) | `54 fc 72 ...` - **ISO-8859-1, correct** | - |
| read over XML-RPC with `responseEncoding: 'latin1'` | - | correct: a value stored as ISO-8859-1 comes back as `Tür Küche äöüß °C` |
| read over BIN-RPC | - | **broken**: `decodeString()` decodes UTF-8, so `0xFC` becomes U+FFFD and the character is unrecoverable |

So each library is right in one direction and wrong in the other:

- `homematic-xmlrpc` writes the request body as UTF-8 with no encoding declaration. **A name with an
  umlaut written over XML-RPC is stored wrong on the CCU.** The fix is an encoding option on the
  request side (`request.write(xml, 'latin1')`); it is the maintainer's own package.
- `binrpc` encodes correctly (`Buffer.from(str, 'ascii')` keeps the low byte) but decodes with
  `toString()`, i.e. UTF-8. **A name with an umlaut read over BIN-RPC is destroyed.** One-line fix
  in the same repository family; roadmap task 15 already lists it.

Until both are fixed, the application should write names over XML-RPC only after transliterating,
or accept that non-ASCII names it writes look wrong in the WebUI. The `latin1` response decoding
task 4 already sets is confirmed as correct and necessary.

## What could not be tested, and why

| what | why |
| --- | --- |
| case (f), a real foreign parameter name | deliberately skipped: identical mechanism to case (a), and the cost is a second permanently unwritable channel |
| add-a-link / remove-a-link as an HmIP recovery | the action was refused by the sandbox this session ran in; it is implemented as `--recovery relink` and is the first thing to try next time |
| the LINK description for two different peers on HmIP | needs two real links, see above |
| `STICKY_UNREACH` on first connect (#98, second report) | needs `init` and callbacks; the lab CCUs cannot reach the development machine. It belongs to task 13 (addon) or a run from the callback-capable lab host |
| BidCos `NOT_USED` (111600 s) on a real `*_TIME` link parameter | no BidCos-RF actor and no BidCos-Wired device in the lab (roadmap "Lab and hardware") |
| BidCos-Wired, CUxD, VirtualDevices write behaviour | no such devices in the lab; simulator only |
| an `INTEGER` with `UNIT` `100%` (A-13) | none exists in the descriptions of the lab devices |
| a 256-character `STRING` (A-2) | no writable `STRING` parameter without a link on the lab devices |

## What is left behind in the lab

One channel of the HmIPW-DRS8 (`:2`, `SWITCH_VIRTUAL_RECEIVER`) carries the parameter
`HMM_LAB_NO_SUCH_PARAM` in hmipserver's stored configuration and answers `-5` to every
`putParamset` on its MASTER paramset. Its `VALUES` (`STATE`, `ON_TIME`) and every other channel of
the device work normally, and the channel's MASTER values are back at their baseline. Removing the
parameter needs the device to be deleted and paired again, or a CCU backup from before
2026-09-05 - the maintainer decides which, or leaves it as the lab's permanent example of the bug.

The HM-Sec-SC has `CONFIG_PENDING` set: the restore wrote its original configuration back and rfd
will transfer it the next time the contact wakes up. Nothing else was left changed; every other
target was verified equal to its baseline MASTER.

## What this changes in the application

### The write path (task 4, adjusted here)

1. **Never send a parameter that is not in the channel's own paramset description.** This is not a
   nicety, it is the difference between a recoverable mistake and a channel that has to be
   re-paired. The description used must be the one of *that* channel, freshly fetched or cached by
   an identity that cannot collide.
2. **Never send a value that is not valid for its parameter**: type, `VALUE_LIST` membership,
   `MIN`..`MAX` (with `SPECIAL` values exempt, verified above). Neither interface process will
   catch it, and one of the two will hold the bad value against the device.
3. **`ENUM` goes out as the index on both interfaces**, because that is what `getParamset` returns
   and therefore what the changed-only diff compares against. Both forms are accepted, so this is a
   free choice; sending the name makes every enum look changed.
4. **`FLOAT` always goes out as an explicit double.** Required on BidCos, harmless on HmIP.
5. **Multi-apply only across identical descriptions.** `MAINTENANCE` on three HmIP device types is
   three different paramsets; the 2.x rule (same channel `TYPE`) is what produced #98.
6. **An empty payload is not sent at all.** Both interfaces answer `ok`, so it is only noise in the
   log, but the preview should say "nothing to write" rather than showing an empty call.
7. **A fault is not the only failure.** rfd answers `ok` to writes it silently drops. After a write
   the application should read the paramset back and show what actually arrived - that is the only
   feedback BidCos gives.

### "Repair configuration" (task 6.7)

The recovery that was measured to work is a **valid full MASTER write of the affected channel**,
built from the channel's own description and its current values. `devices.repairConfig` does that:

1. read the paramset description and the current paramset of every affected channel;
2. drop everything the description does not contain (that is the poison, and it cannot be written
   back) and everything that is not writable;
3. clamp nothing - fix values that are outside their range or of the wrong type to a valid one and
   show the user what will be corrected;
4. write the result per channel, paced;
5. for BidCos additionally offer `clearConfigCache` and `restoreConfigToDevice`, which exist there;
   on HmIP they answer `-1 Generic error` and must not be offered.

It repairs the sticky-`CONFIG_PENDING` case completely. It cannot repair a channel that already
carries an unknown parameter; the dialog has to say so, and say why: the parameter is in the
interface process' own store and only re-pairing removes it.

### What the UI has to show (task 8)

- The preview dialog lists exactly what will be sent per channel, and refuses to offer a channel
  whose description differs. The reason a channel is not offered is shown, not hidden.
- `CONFIG_PENDING` needs two different explanations: on BidCos "the device has not picked the
  configuration up yet - a battery device does that when it wakes", on HmIP "the configuration
  could not be transferred". Only the second one deserves a repair button.
- A `-5 Invalid parameter or value` from hmipserver after a write the application itself validated
  means the channel's stored configuration is already broken. That is the one message that should
  point at the documentation instead of at the user.
- After a BidCos write, show the read-back, because `ok` means nothing there.

## Reproducing this

```sh
S="node tools/lab/config-pending-study.mjs --host <ccu> --interface HmIP-RF --device <address>"
$S --channel 3 --out ~/lab-results --label demo --ssh <alias> baseline
$S --channel 3 --out ~/lab-results --label demo --yes rewrite            # the control
$S --channel 3 --out ~/lab-results --label demo --yes provoke --case c   # sticky CONFIG_PENDING
$S --channel 3 --out ~/lab-results --label demo --yes recover --recovery fullwrite
$S --channel 3 --out ~/lab-results --label demo --yes restore
$S --channel 3 --out ~/lab-results --label demo faults                   # the fault table
```

`--dry-run` prints every call without making one. `provoke --case a` is the one that breaks a
channel permanently; the script will run it, but nothing in the application ever may.
