import {readFileSync} from 'node:fs';
import path from 'node:path';

import {describe, expect, it} from 'vitest';

import {
    extractForms,
    extractMasterControls,
    extractTimeSelectorOptions,
    htmlParamsBody,
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
});
