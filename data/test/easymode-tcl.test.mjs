import {readFileSync} from 'node:fs';
import path from 'node:path';

import {describe, expect, it} from 'vitest';

import {
    branchWays,
    extractForms,
    extractMasterBranches,
    extractMasterControls,
    extractTimeSelectorOptions,
    htmlParamsBody,
    parseBranchTest,
    parseLocalization,
    parseProcs,
    timeOptionMeaning,
} from '../scripts/lib/easymode-tcl.mjs';
import {distDir} from '../scripts/lib/paths.mjs';

// A cut-down set_htmlParams in the shape of the WebUI's DIMMER_VIRTUAL_RECEIVER/KEY_TRANSCEIVER.tcl;
// `@{...}` stands for TCL's `${...}`, which a template literal would interpolate.
const TCL = String.raw`
proc getDescription {longAvailable prn} {
  return "\${description_$prn}"
}

proc set_htmlParams {iface address pps pps_descr special_input_id peer_type} {
  set prn 0
  append HTML_PARAMS(separate_$prn) [cmd_link_paramset2 $iface $address ps_descr ps "LINK" @{special_input_id}_$prn]

#1
  incr prn
  # RAMPON_TIME
  append HTML_PARAMS(separate_$prn) "[getTimeSelector RAMPON_TIME_FACTOR_DESCR ps PROFILE_$prn rampOnOff $prn $special_input_id SHORT_RAMPON_TIME TIMEBASE_LONG]"
  incr pref
  append HTML_PARAMS(separate_$prn) "<tr><td>\${ON_LEVEL}</td><td>"
  option DIM_ONLEVEL
  append HTML_PARAMS(separate_$prn) [get_ComboBox options SHORT_ON_LEVEL|LONG_ON_LEVEL separate_@{special_input_id}_$prn\_$pref PROFILE_$prn SHORT_ON_LEVEL "onchange=\"ActivateFreePercent()\""]
  EnterPercent $prn $pref @{special_input_id} ps_descr SHORT_ON_LEVEL
  append HTML_PARAMS(separate_$prn) "</td></tr>"

  if {[info exists ps(SHORT_ON_MIN_LEVEL)] == 1} {
    append HTML_PARAMS(separate_$prn) "<tr><td>\${ON_MIN_LEVEL}</td><td>"
    option DIM_LEVELwoLastValue
    append HTML_PARAMS(separate_$prn) [get_ComboBox options SHORT_ON_MIN_LEVEL separate_@{special_input_id}_$prn\_$pref PROFILE_$prn SHORT_ON_MIN_LEVEL]
  }

  set param SHORT_PROFILE_REPETITIONS
  if {[info exists ps($param)] == 1} {
    append HTML_PARAMS(separate_$prn) [getRepetitionSelector PROFILE_$prn @{special_input_id} $param]
    append HTML_PARAMS(separate_$prn) "[getTimeSelector OFF_TIME_FACTOR_DESCR ps PROFILE_$prn blink0 $prn $special_input_id SHORT_OFF_TIME TIMEBASE_LONG]"
  }

  if {$longKeypressAvailable} {
    append HTML_PARAMS(separate_$prn) "<tr><td>\${DIM_MAX_LEVEL}</td><td>"
    option DIM_ONLEVEL
    append HTML_PARAMS(separate_$prn) [get_ComboBox options LONG_DIM_MAX_LEVEL separate_@{special_input_id}_$prn\_$pref PROFILE_$prn LONG_DIM_MAX_LEVEL]
  }

#2
  incr prn
  append HTML_PARAMS(separate_$prn) "<tr><td>\${SWITCH_MODE}</td><td>"
  append HTML_PARAMS(separate_$prn) [subset2combobox {SUBSET_1 SUBSET_2} subset_$prn\_$pref separate_@{special_input_id}_$prn\_$pref PROFILE_$prn ]

#3 has nothing of its own
  incr prn
  append HTML_PARAMS(separate_$prn) "\${description_$prn}"
}
`.replaceAll('@{', '${');

describe('extractForms (task 62)', () => {
    const forms = extractForms(TCL);

    it('lists each profile form in the WebUI order, and skips the expert form 0', () => {
        expect(Object.keys(forms)).toEqual(['1', '2']);
        expect(
            forms['1']?.map((c) => (c.kind === 'time' ? c.prefix : c.kind === 'param' ? c.param : 'subset')),
        ).toEqual([
            'SHORT_RAMPON_TIME',
            'SHORT_ON_LEVEL',
            'SHORT_ON_MIN_LEVEL',
            'SHORT_PROFILE_REPETITIONS',
            'SHORT_OFF_TIME',
            'LONG_DIM_MAX_LEVEL',
        ]);
    });

    it('reads a time selector: the pair prefix, the preset type and the label key', () => {
        expect(forms['1']?.[0]).toEqual({
            kind: 'time',
            prefix: 'SHORT_RAMPON_TIME',
            selector: 'rampOnOff',
            labelKey: 'RAMPON_TIME_FACTOR_DESCR',
        });
    });

    it('reads a combo box with its option set and row label, and the parameters it writes along', () => {
        expect(forms['1']?.[1]).toEqual({
            kind: 'param',
            param: 'SHORT_ON_LEVEL',
            also: ['LONG_ON_LEVEL'],
            option: 'DIM_ONLEVEL',
            labelKey: 'ON_LEVEL',
        });
    });

    it('carries what an enclosing info exists asks for, also through $param', () => {
        expect(forms['1']?.[2]).toMatchObject({param: 'SHORT_ON_MIN_LEVEL', requires: ['SHORT_ON_MIN_LEVEL']});
        expect(forms['1']?.[3]).toMatchObject({
            param: 'SHORT_PROFILE_REPETITIONS',
            requires: ['SHORT_PROFILE_REPETITIONS'],
        });
        expect(forms['1']?.[4]).toMatchObject({prefix: 'SHORT_OFF_TIME', requires: ['SHORT_PROFILE_REPETITIONS']});
        // a branch on something else asks for nothing
        expect(forms['1']?.[5]).not.toHaveProperty('requires');
    });

    it('reads a subset choice', () => {
        expect(forms['2']).toEqual([{kind: 'subset', subsets: [1, 2], labelKey: 'SWITCH_MODE'}]);
    });

    it('answers nothing for a file without set_htmlParams', () => {
        expect(extractForms('proc other {} {}\n')).toEqual({});
    });
});

describe('the time selector presets', () => {
    const helper = String.raw`
proc getComboBox {prn pref specialElement type {extraparam ""}} {
    switch $type {
      "timeOnOff" {
        append s [getTimeOnOff $prn $pref $specialElement]
      }
    }
}

proc getTimeOnOff {prn pref specialElement {paramType ""}} {
      append s "<option value=\"0\">\${optionNotActive}</option>"
      append s "<option value=\"1\">\${optionUnit100MS}</option>"
      append s "<option value=\"2\">\${optionUnit2M}</option>"
      append s "<option value=\"3\">\${stringTablePermanent}</option>"
      append s "<option value=\"4\">\${stringTableEnterValue}</option>"
      append s "</select>"
      append s "optionMap\[\"00\"\] = 0;"
}
`;

    it('lists the option keys of each type, in order', () => {
        expect(extractTimeSelectorOptions(helper)).toEqual({
            timeOnOff: [
                'optionNotActive',
                'optionUnit100MS',
                'optionUnit2M',
                'stringTablePermanent',
                'stringTableEnterValue',
            ],
        });
    });

    it('knows what each option key stands for', () => {
        expect(timeOptionMeaning('optionUnit100MS')).toEqual({seconds: 0.1});
        expect(timeOptionMeaning('optionUnit2M')).toEqual({seconds: 120});
        expect(timeOptionMeaning('optionUnit24H')).toEqual({seconds: 86400});
        expect(timeOptionMeaning('optionNotActive')).toEqual({special: 'notActive'});
        expect(timeOptionMeaning('stringTablePermanent')).toEqual({special: 'permanent'});
        expect(timeOptionMeaning('stringTableEnterValue')).toEqual({special: 'enterValue'});
        expect(timeOptionMeaning('optionSomethingElse')).toBeUndefined();
    });
});

describe('parseLocalization', () => {
    it('takes the text out of the HTML wrapper and the entities', () => {
        const text = String.raw`
"ON_LEVEL" : "<span class=\"translated\">Minimaler Pegel im Zustand \"ein\"</span>",
    "optionUnit1S": "1 Sekunde",
"DIM_MAX_LEVEL" : "<span class=\"translated\">&Ouml;ffnungsweite f&uuml;r &quot;auf&quot;</span>",
"EMPTY" : "",
`;
        expect(parseLocalization(text)).toEqual({
            ON_LEVEL: 'Minimaler Pegel im Zustand "ein"',
            optionUnit1S: '1 Sekunde',
            DIM_MAX_LEVEL: 'Öffnungsweite für "auf"',
        });
    });
});

describe('the committed forms in dist/', () => {
    // The WRC2 -> PDT pairing of B-58: the WebUI's "Dimmer - ein/heller" form (task 62).
    const profiles = JSON.parse(readFileSync(path.join(distDir, 'profiles', 'DIMMER_VIRTUAL_RECEIVER.json'), 'utf8'));
    const onBrighter = profiles.senders.KEY_TRANSCEIVER.find((profile) => profile.id === 1);

    it('carries the WebUI form of "Dimmer - ein/heller" for a button', () => {
        const names = onBrighter.controls.map((c) =>
            c.kind === 'time' ? c.prefix : c.kind === 'param' ? c.param : 'subset',
        );
        expect(names.slice(0, 4)).toEqual([
            'SHORT_RAMPON_TIME',
            'SHORT_ON_TIME',
            'SHORT_ON_LEVEL',
            'SHORT_ON_MIN_LEVEL',
        ]);
        expect(names).toContain('LONG_ON_TIME');
        expect(names).toContain('LONG_DIM_MAX_LEVEL');
        expect(names).toContain('LONG_DIM_STEP');
        expect(onBrighter.controls[0]).toMatchObject({kind: 'time', selector: 'rampOnOff'});
        expect(onBrighter.controls[1].label?.de).toBe('Einschaltdauer');
    });

    it('has the presets of every time selector a form uses', () => {
        const selectors = JSON.parse(readFileSync(path.join(distDir, 'easymode-time-selectors.json'), 'utf8')).types;
        expect(selectors.timeOnOff[0]).toMatchObject({special: 'notActive'});
        expect(selectors.timeOnOff.at(-1)).toMatchObject({special: 'enterValue'});
        expect(selectors.rampOnOff.length).toBeGreaterThan(3);
    });
});

describe('the MASTER forms (task 63)', () => {
    // In the shape of etc/hmipChannelConfigDialogs.tcl and hmip/KEY_TRANSCEIVER.tcl.
    const DIALOGS = String.raw`
proc getKeyTransceiver {chn p descr} {
  set param CHANNEL_OPERATION_MODE
  if { [info exists ps($param)] == 1 } {
    append html "<tr>"
      append html "<td>\${lblChannelActivInactiv}</td>"
      option LOGIC_COMBINATION
      append html  "<td>[getOptionBox '$param' options $ps($param) $chn $prn]</td>"
    append html "</tr>"
  }

set comment {
  set param DISABLE_ACOUSTIC_CHANNELSTATE
  if { [info exists ps($param)] == 1 } {
      append html  "<td>[getCheckBox '$param' $ps($param) $chn $prn]</td>"
  }
}

  set param "LED_DISABLE_CHANNELSTATE"
  if { [info exists ps($param)] == 1 } {
      append html "<td>\${stringTableLEDDisableChannelState}</td>"
      append html  "<td>[getCheckBox '$param' $ps($param) $chn $prn]</td>"
  }

  set param REPEATED_LONG_PRESS_TIMEOUT_UNIT
  if { [info exists ps($param)] == 1  } {
      append html "<td>\${stringTableKeyLongPressTimeOut}</td>"
      append html [getComboBox $chn $prn "$specialID" "timeOnOffShort"]
      append html [getTimeUnitComboBoxShort $param $ps($param) $chn $prn $special_input_id]
      set param REPEATED_LONG_PRESS_TIMEOUT_VALUE
      append html "<td>[getTextField $param $ps($param) $chn $prn]&nbsp;[getMinMaxValueDescr $param]</td>"
  }
  append html "[getHelper $chn ps psDescr]"
}

proc getHelper {chn p descr} {
  set param DBL_PRESS_TIME
  append html "<td>[getTextField $param $ps($param) $chn $prn]</td>"
}
`;
    const FORM = String.raw`
proc set_htmlParams {iface address pps pps_descr special_input_id peer_type} {
  append HTML_PARAMS(separate_1) "<table class=\"ProfileTbl\">"
  append HTML_PARAMS(separate_1) "[getKeyTransceiver $chn ps psDescr]"
  append HTML_PARAMS(separate_1) "</table>"
}
`;

    it('reads a procedure to its last closing brace, past a commented-out block', () => {
        const procs = parseProcs(DIALOGS);
        expect([...procs.keys()]).toEqual(['getKeyTransceiver', 'getHelper']);
        expect(procs.get('getKeyTransceiver')).toContain('REPEATED_LONG_PRESS_TIMEOUT_VALUE');
    });

    it('lists the controls of the form through the procedures it calls', () => {
        const controls = extractMasterControls(htmlParamsBody(FORM) ?? '', parseProcs(DIALOGS));
        expect(controls).toEqual([
            {
                kind: 'param',
                param: 'CHANNEL_OPERATION_MODE',
                option: 'LOGIC_COMBINATION',
                labelKey: 'lblChannelActivInactiv',
                requires: ['CHANNEL_OPERATION_MODE'],
            },
            {
                kind: 'param',
                param: 'LED_DISABLE_CHANNELSTATE',
                labelKey: 'stringTableLEDDisableChannelState',
                requires: ['LED_DISABLE_CHANNELSTATE'],
            },
            {
                kind: 'time',
                prefix: 'REPEATED_LONG_PRESS_TIMEOUT',
                selector: 'timeOnOffShort',
                labelKey: 'stringTableKeyLongPressTimeOut',
                requires: ['REPEATED_LONG_PRESS_TIMEOUT_UNIT'],
            },
            {kind: 'param', param: 'DBL_PRESS_TIME'},
        ]);
    });

    // B-73 (#168): hmip/BLIND_VIRTUAL_RECEIVER.tcl calls getBlindVirtualReceiver in two of its three
    // `channelMode` branches and getShutterVirtualReceiver in the third; a branch the extract cannot
    // decide (it is device metadata, not the description) must not list the same control again.
    it('lists a control once when several branches of the form call procedures that draw it', () => {
        const dialogs = String.raw`
proc getBlind {chn p descr} {
  set param LOGIC_COMBINATION
  if { [info exists ps($param)] == 1 } {
    append html "<td>\${stringTableLogicCombinationBlind}</td>"
    option LOGIC_COMBINATION
    append html  "<td>[getOptionBox '$param' options $ps($param) $chn $prn]</td>"
  }
  set param POSITION_SAVE_TIME
  append html "<td>[getTextField $param $ps($param) $chn $prn]</td>"
}

proc getShutter {chn p descr} {
  set param LOGIC_COMBINATION
  if { [info exists ps($param)] == 1 } {
    append html "<td>\${stringTableLogicCombination}</td>"
    option LOGIC_COMBINATION
    append html  "<td>[getOptionBox '$param' options $ps($param) $chn $prn]</td>"
  }
  set param POSITION_SAVE_TIME
  append html "<td>[getTextField $param $ps($param) $chn $prn]</td>"
}
`;
        const form = String.raw`
proc set_htmlParams {iface address pps pps_descr special_input_id peer_type} {
  set devMode [xmlrpc $url getMetadata [list string $address] channelMode]
  append HTML_PARAMS(separate_1) "<table class=\"ProfileTbl\">"
    if {[string equal $devMode blind] != 0} {
      append HTML_PARAMS(separate_1) "[getBlind $chn ps psDescr ]"
    } elseif {[string equal $devMode shutter] == 1} {
      append HTML_PARAMS(separate_1) "[getShutter $chn ps psDescr]"
    } else {
      append HTML_PARAMS(separate_1) "[getBlind $chn ps psDescr]"
    }
  append HTML_PARAMS(separate_1) "</table>"
}
`;
        const controls = extractMasterControls(htmlParamsBody(form) ?? '', parseProcs(dialogs));
        expect(controls).toEqual([
            {
                kind: 'param',
                param: 'LOGIC_COMBINATION',
                option: 'LOGIC_COMBINATION',
                labelKey: 'stringTableLogicCombinationBlind',
                requires: ['LOGIC_COMBINATION'],
            },
            {kind: 'param', param: 'POSITION_SAVE_TIME'},
        ]);
    });

    it('reads a BidCos form keyed by paramset id: the kind before the parameter, and getComboBox (task 64)', () => {
        const bidcos = String.raw`
proc set_htmlParams {iface address pps pps_descr special_input_id peer_type} {
  set param BURST_RX
  append HTML_PARAMS(separate_1) "<td>\${stringTableBurstRx}</td><td>[getCheckBox $DEVICE '$param' $ps($param) $prn]</td>"
  set param AVERAGING
  append HTML_PARAMS(separate_1) "<td>[getTextField $CHANNEL '$param' $ps($param) separate_$prn]</td>"
  set param TX_THRESHOLD_POWER
  append HTML_PARAMS(separate_1) [getComboBox $param $prn $special_input_id]
}
`;
        expect(extractMasterControls(htmlParamsBody(bidcos) ?? '', new Map())).toEqual([
            {kind: 'param', param: 'BURST_RX', labelKey: 'stringTableBurstRx'},
            {kind: 'param', param: 'AVERAGING'},
            {kind: 'param', param: 'TX_THRESHOLD_POWER'},
        ]);
    });

    it('decodes the %XX escapes of the WebUI language files', () => {
        const text = '    "stringTableKeyLongPressTimeOut" :  "Timeout f%FCr langen Tastendruck",\n';
        expect(parseLocalization(text, {percent: true})).toEqual({
            stringTableKeyLongPressTimeOut: 'Timeout für langen Tastendruck',
        });
    });

    it('carries the CCU form of an HmIP button channel in dist/master-metadata.json', () => {
        const master = JSON.parse(readFileSync(path.join(distDir, 'master-metadata.json'), 'utf8'));
        const controls = master.KEY_TRANSCEIVER.controls;
        expect(controls.map((c) => (c.kind === 'time' ? c.prefix : c.param))).toContain('LED_DISABLE_CHANNELSTATE');
        expect(controls.find((c) => c.kind === 'time')).toMatchObject({
            prefix: 'REPEATED_LONG_PRESS_TIMEOUT',
            selector: 'timeOnOffShort',
        });
        expect(controls.find((c) => c.param === 'LED_DISABLE_CHANNELSTATE').label.de).toBe('Geräte-LED deaktivieren');
    });

    // B-73 (#168): the blind forms listed every control once per `channelMode` branch, and the
    // dialog's keyed each threw on the second copy
    it('lists no control twice in any committed MASTER form', () => {
        const identity = (control) =>
            control.kind === 'time'
                ? `time:${control.prefix}`
                : control.kind === 'param'
                  ? `param:${control.param}`
                  : `subset:${control.subsets.join(',')}`;
        const doubled = (controls) => {
            const seen = new Set();
            const twice = [];
            for (const id of controls.map(identity)) {
                if (seen.has(id)) twice.push(id);
                seen.add(id);
            }
            return twice;
        };
        const master = JSON.parse(readFileSync(path.join(distDir, 'master-metadata.json'), 'utf8'));
        for (const [channelType, entry] of Object.entries(master)) {
            expect(doubled(entry.controls ?? []), channelType).toEqual([]);
        }
        const byId = JSON.parse(readFileSync(path.join(distDir, 'master-forms.json'), 'utf8')).byParamsetId;
        for (const [id, entry] of Object.entries(byId)) {
            expect(doubled(entry.controls ?? []), id).toEqual([]);
        }
    });
});

// Task 75: the ways of a MASTER form the WebUI decides on something the description does not say
describe('the branches of a MASTER form (task 75)', () => {
    const dialogs = String.raw`
proc getBlind {chn p descr} {
  set param LOGIC_COMBINATION
  if { [info exists ps($param)] == 1 } {
    append html "<td>\${stringTableLogicCombinationBlind}</td>"
    option LOGIC_COMBINATION
    append html  "<td>[getOptionBox '$param' options $ps($param) $chn $prn]</td>"
  }
  set param LOGIC_COMBINATION_2
  if { [info exists ps($param)] == 1 } {
    append html "<td>\${stringTableLogicCombinationSlats}</td>"
    append html  "<td>[getOptionBox '$param' options $ps($param) $chn $prn]</td>"
  }
  set param POSITION_SAVE_TIME
  append html "<td>[getTextField $param $ps($param) $chn $prn]</td>"
}

proc getShutter {chn p descr} {
  set param LOGIC_COMBINATION
  if { [info exists ps($param)] == 1 } {
    append html "<td>\${stringTableLogicCombination}</td>"
    append html  "<td>[getOptionBox '$param' options $ps($param) $chn $prn]</td>"
  }
  set param POSITION_SAVE_TIME
  append html "<td>[getTextField $param $ps($param) $chn $prn]</td>"
}
`;
    const blindForm = String.raw`
proc set_htmlParams {iface address pps pps_descr special_input_id peer_type} {
  set devMode [xmlrpc $url getMetadata [list string $address] channelMode]
  append HTML_PARAMS(separate_1) "<table class=\"ProfileTbl\">"
    if {[string equal $devMode blind] != 0} {
      append HTML_PARAMS(separate_1) "[getBlind $chn ps psDescr ]"
    } elseif {[string equal $devMode shutter] == 1} {
      append HTML_PARAMS(separate_1) "[getShutter $chn ps psDescr]"
    } else {
      append HTML_PARAMS(separate_1) "[getBlind $chn ps psDescr]"
    }
  append HTML_PARAMS(separate_1) "</table>"
}
`;
    const names = (controls) => controls.map((c) => (c.kind === 'time' ? c.prefix : c.param));

    it('reads the tests the WebUI branches on, and nothing else', () => {
        expect(parseBranchTest('[string equal $devMode blind] != 0')).toEqual({channelMode: 'blind'});
        expect(parseBranchTest('[string equal $devMode shutter] == 1')).toEqual({channelMode: 'shutter'});
        expect(parseBranchTest('[string equal $devMode shutter] == 0')).toEqual({channelMode: 'shutter', not: true});
        expect(parseBranchTest('[string equal $devType HmIP-ESI] == 1')).toEqual({deviceType: 'HmIP-ESI'});
        expect(parseBranchTest('([string first "HmIP-DLP" $dev_descr(TYPE)] == -1)')).toEqual({
            deviceTypeIncludes: 'HmIP-DLP',
            not: true,
        });
        expect(parseBranchTest('[string first "HmIP-ASIR" $dev_descr(TYPE)] != -1')).toEqual({
            deviceTypeIncludes: 'HmIP-ASIR',
        });
        expect(parseBranchTest('$chn == 1')).toEqual({channel: 1});
        expect(parseBranchTest('$chn ==2')).toEqual({channel: 2});
        // a firmware version, an empty mode, a local flag: not read, the chain stays whole
        expect(parseBranchTest('($devFwMajor == 1 && $devFwMinor > 5) || ($devFwMajor > 1)')).toBeUndefined();
        expect(parseBranchTest('[string equal $devMode ""] == 1')).toBeUndefined();
        expect(parseBranchTest('$channelOperationModeExists == 1')).toBeUndefined();
    });

    it("splits the blind form by channelMode, each way with its own controls in the WebUI's order", () => {
        const branches = extractMasterBranches(htmlParamsBody(blindForm) ?? '', parseProcs(dialogs));
        expect(branches?.map((branch) => branch.when)).toEqual([
            [{channelMode: 'blind'}],
            [{channelMode: 'blind', not: true}, {channelMode: 'shutter'}],
            [
                {channelMode: 'blind', not: true},
                {channelMode: 'shutter', not: true},
            ],
        ]);
        expect(branches?.map((branch) => names(branch.controls))).toEqual([
            ['LOGIC_COMBINATION', 'LOGIC_COMBINATION_2', 'POSITION_SAVE_TIME'],
            ['LOGIC_COMBINATION', 'POSITION_SAVE_TIME'],
            ['LOGIC_COMBINATION', 'LOGIC_COMBINATION_2', 'POSITION_SAVE_TIME'],
        ]);
        expect(branches?.[1].controls[0].labelKey).toBe('stringTableLogicCombination');
        // the union for everyone else stays as B-73 left it
        expect(names(extractMasterControls(htmlParamsBody(blindForm) ?? '', parseProcs(dialogs)))).toEqual([
            'LOGIC_COMBINATION',
            'LOGIC_COMBINATION_2',
            'POSITION_SAVE_TIME',
        ]);
    });

    it('follows a nested chain, and a chain without else has a way that draws none of it', () => {
        const form = String.raw`
proc set_htmlParams {iface address pps pps_descr special_input_id peer_type} {
  set param EVENT_DELAY
  append HTML_PARAMS(separate_1) "<td>[getTextField $param $ps($param) $chn $prn]</td>"
  if {[string equal $devType HmIP-ESI] == 1} {
    if {$chn == 1} {
      append HTML_PARAMS(separate_1) "[getBlind $chn ps psDescr]"
    }
  } else {
    append HTML_PARAMS(separate_1) "[getShutter $chn ps psDescr]"
  }
}
`;
        const branches = extractMasterBranches(htmlParamsBody(form) ?? '', parseProcs(dialogs));
        expect(branches?.map((branch) => [branch.when, names(branch.controls)])).toEqual([
            [
                [{deviceType: 'HmIP-ESI'}, {channel: 1}],
                ['EVENT_DELAY', 'LOGIC_COMBINATION', 'LOGIC_COMBINATION_2', 'POSITION_SAVE_TIME'],
            ],
            [[{deviceType: 'HmIP-ESI'}, {channel: 1, not: true}], ['EVENT_DELAY']],
            [[{deviceType: 'HmIP-ESI', not: true}], ['EVENT_DELAY', 'LOGIC_COMBINATION', 'POSITION_SAVE_TIME']],
        ]);
    });

    it('has no branches where every way draws the same, or the test is not one it reads', () => {
        const same = String.raw`
proc set_htmlParams {iface address pps pps_descr special_input_id peer_type} {
  if {[string equal $devMode blind] != 0} {
    append HTML_PARAMS(separate_1) "[getShutter $chn ps psDescr]"
  } else {
    append HTML_PARAMS(separate_1) "[getShutter $chn ps psDescr]"
  }
}
`;
        expect(extractMasterBranches(htmlParamsBody(same) ?? '', parseProcs(dialogs))).toBeUndefined();
        const firmware = String.raw`
proc set_htmlParams {iface address pps pps_descr special_input_id peer_type} {
  if {($devFwMajor == 1 && $devFwMinor > 5) || ($devFwMajor > 1)} {
    append HTML_PARAMS(separate_1) "[getBlind $chn ps psDescr]"
  } else {
    append HTML_PARAMS(separate_1) "[getShutter $chn ps psDescr]"
  }
}
`;
        expect(extractMasterBranches(htmlParamsBody(firmware) ?? '', parseProcs(dialogs))).toBeUndefined();
        expect(branchWays(['a', 'b'])).toEqual([{when: [], lines: ['a', 'b']}]);
    });

    it('carries the ways of the blind and the other branched forms in dist/master-metadata.json', () => {
        const master = JSON.parse(readFileSync(path.join(distDir, 'master-metadata.json'), 'utf8'));
        const wayOf = (channelType, test) =>
            master[channelType].branches.find((branch) => JSON.stringify(branch.when) === JSON.stringify(test));
        const receiverShutter = wayOf('BLIND_VIRTUAL_RECEIVER', [
            {channelMode: 'blind', not: true},
            {channelMode: 'shutter'},
        ]);
        expect(names(receiverShutter.controls)).toEqual(['LOGIC_COMBINATION', 'POSITION_SAVE_TIME']);
        expect(names(wayOf('BLIND_VIRTUAL_RECEIVER', [{channelMode: 'blind'}]).controls)).toContain(
            'LOGIC_COMBINATION_2',
        );
        const transmitterShutter = wayOf('BLIND_TRANSMITTER', [
            {channelMode: 'blind', not: true},
            {channelMode: 'shutter'},
        ]);
        expect(names(transmitterShutter.controls)).not.toContain('REFERENCE_RUNNING_TIME_SLATS_VALUE');
        expect(names(wayOf('BLIND_TRANSMITTER', [{channelMode: 'blind'}]).controls)).toContain(
            'REFERENCE_RUNNING_TIME_SLATS_VALUE',
        );
        expect(master.ACCELERATION_TRANSCEIVER.branches).toHaveLength(2);
        expect(master.ENERGIE_METER_TRANSMITTER.branches.length).toBeGreaterThan(2);
        // the sabotage contact of an HmIP-ASIR claims to be a button and has no form in the WebUI
        expect(wayOf('KEY_TRANSCEIVER', [{deviceTypeIncludes: 'HmIP-ASIR'}]).controls).toEqual([]);
        // every way's controls are listed once, and every way's tests are ones the app knows
        for (const entry of Object.values(master)) {
            for (const branch of entry.branches ?? []) {
                expect(new Set(names(branch.controls)).size, entry.channelType).toBe(branch.controls.length);
                for (const test of branch.when) {
                    const keys = Object.keys(test).filter((key) => key !== 'not');
                    expect(keys).toHaveLength(1);
                    expect(['channelMode', 'deviceType', 'deviceTypeIncludes', 'channel']).toContain(keys[0]);
                }
            }
        }
    });
});
