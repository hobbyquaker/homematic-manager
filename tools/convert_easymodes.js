/**
 *      convert_easymode.js
 *      Copyright (c) 2015 Sebastian 'hobbyquaker' Raff
 *
 *      Converts Easymodes and Easymode-specific translations into Javascript Objects
 *
 *      Please configure occuPath, languages and receivers!
 */


var occuPath = '/Users/basti/PhpstormProjects/homematic-manager/occu/occu/';
var langs = ['de', 'en', 'tr'];
//var langs = ['de'];
var receivers = ['SWITCH', 'DIMMER', 'BLIND', 'ACTOR_SECURITY', 'ACTOR_WINDOW', 'ALARMACTUATOR',
    'CLIMATECONTROL_RECEIVER', 'CLIMATECONTROL_RT_RECEIVER', 'CLIMATECONTROL_VENT_DRIVE',
    'DDC', 'HMW_BLIND', 'HMW_DIMMER', 'HMW_INPUT_OUTPUT', 'HMW_SWITCH', 'KEYMATIC',
    'REMOTECONTROL_RECEIVER', 'SIGNAL_CHIME', 'SIGNAL_LED', 'STATUS_INDICATOR', 'SWITCH',
    'VIRTUAL_DIMMER', 'WEATHER', 'WEATHER_RECEIVER', 'WINDOW_SWITCH_RECEIVER', /*'WINMATIC'*/, 'WS_TH'
];

var receivers = ['RGBW_AUTOMATIC', 'RGBW_COLOR', 'SWITCH_VIRTUAL_RECEIVER'];

var receivers = ['HMW_BLIND', 'HMW_DIMMER', 'HMW_INPUT_OUTPUT', 'HMW_SWITCH'];

var receivers = ['SIGNAL_CHIMEM', 'SIGNAL_LEDM'];

var files = ['GENERIC', 'PNAME'];

var fs = require('fs');
var mkdirp = require('mkdirp');
var Entities = require('html-entities').AllHtmlEntities;
var entities = new Entities();

var easymodePath = occuPath + '/WebUI/www/config/easymodes/';

var obj = {lang: {}};


files.forEach(function (file) {
    langs.forEach(function (lang) {
        if (typeof obj.lang[lang] === 'undefined') obj.lang[lang] = {};
        console.log('reading', occuPath + 'WebUI/www/config/easymodes/etc/localization/' + lang + '/' + file + '.txt');
        var content = fs.readFileSync(occuPath + 'WebUI/www/config/easymodes/etc/localization/' + lang + '/' + file + '.txt');
        var data = JSON.parse('{' + content.toString().replace(/,\s*$/, '') + '}');
        var match;
        for (var param in data) {
            if (match = data[param].match(/<span class="translated">(.*)<\/span>/)) {
                data[param] = entities.decode(match[1]);
            }
        }
        obj.lang[lang][file] = data;
    });
});


receivers.forEach(function (receiver) {
    langs.forEach(function (lang) {
        try {
            var files = fs.readdirSync(easymodePath + '/' + receiver + '/localization/' + lang + '/');
            var data = {};
            for (var index in files) {
                var match = files[index].match(/^([A-Z0-9_]+)\.txt/);
                if (match) {
                    console.log('reading', easymodePath + '/' + receiver + '/localization/' + lang + '/' + files[index]);
                    var content = fs.readFileSync(easymodePath + '/' + receiver + '/localization/' + lang + '/' + files[index]);
                    data[match[1]] = JSON.parse('{' + content.toString().replace(/"\s*\+\s*"/, '').replace(/,\s*$/, '') + '}');
                    for (var param in data[match[1]]) {
                        var matchInner;
                        if (matchInner = data[match[1]][param].match(/<span class="translated">(.*)<\/span>/)) {
                            data[match[1]][param] = entities.decode(matchInner[1]);
                        }
                    }
                }
            }
            obj.lang[lang][receiver] = data;
        } catch (e) {
            console.log('error', receiver, lang, e);
        }
    });

    var files = fs.readdirSync(easymodePath + receiver);
    for (var index in files) {
        var match;
        if (match = files[index].match(/^([A-Z0-9_]+)\.tcl$/)) {
            readFile(receiver, match[1]);
        }
    }
});

for (var elem in obj) {
    if (elem == 'lang') {
        var langs = obj[elem];
        for (var lang in langs) {
            var dir = __dirname + '/../www/easymodes/localization/' + lang;
            mkdirp(dir);
            console.log(lang);
            for (var trans in langs[lang]) {
                var file = dir + '/' + trans + '.json';
                console.log('writing', file);
                fs.writeFileSync(file, JSON.stringify(langs[lang][trans], null, '  '));

            }
        }

    } else {
        mkdirp(__dirname + '/../www/easymodes/' + elem);

        var dev = obj[elem];
        for (var partner in dev) {
            var file = __dirname + '/../www/easymodes/' + elem + '/' + partner + '.json';
            if (dev[partner]) {
                console.log('writing ' + file);
                fs.writeFileSync(file, JSON.stringify(dev[partner] , null, '  '));

            }
        }

    }

}


/*
console.log('writing www/js/easymodes.js');
fs.writeFileSync(__dirname + '/../www/js/easymodes_test.js', 'var easymodes=' + JSON.stringify(obj , null, '  ') + ';\n');
console.log('done.');
*/


function readFile(receiver, sender) {
    if (typeof obj[receiver] === 'undefined') obj[receiver] = {};
    var filename = easymodePath + receiver + '/' + sender + '.tcl';
    console.log('reading', filename);
    var res = fs.readFileSync(filename);
    if (!res) return;
    var lines = res.toString().split('\r\n');
    var match;
    var prn = 0;
    var pref = 1;
    lines.forEach(function (line) {
        if (match = line.match(/set PROFILE_([0-9]+)\(([A-Z_]+)\)\s+"?([^"]+)"?/)) {
            var profile = match[1];
            if (profile == 0) return;
            var param = match[2];
            var val;

            if (val = match[3].match(/\{([^}]*)}/)) {
                var tmp = val[1].split(' ');
                val = {val: tmp[0]};
            } else {
                val = {readonly: true, val: match[3]};
            }
            if (!obj[receiver][sender]) obj[receiver][sender] = {};
            if (!obj[receiver][sender][profile]) obj[receiver][sender][profile] = {params:{}};
            obj[receiver][sender][profile].params[param] = val;

        } else if (match = line.match(/set PROFILES_MAP\(([0-9]+)\)\s+"([^"]+)"/)) {
            var val = match[2].match(/\\\$\{(.*)}/);
            if (val) {
                val = val[1];
            } else {
                val = match[2];
            }
            var profile = match[1];
            if (!obj[receiver][sender]) obj[receiver][sender] = {};
            if (!obj[receiver][sender][profile]) obj[receiver][sender][profile] = {params: {}, options: {}};
            obj[receiver][sender][profile].name = val;
        } else if (match = line.match(/set SUBSET_([0-9]+)\(([A-Z_]+)\)\s+"?([^"]+)"?/)) {
            var subset = match[1];
            var param = match[2];
            var val = match[3];

            //TODO

        } else if (match = line.match(/incr prn/)) {
            prn += 1;
        } else if (match = line.match(/set pref ([0-9]+)$/)) {
            pref = parseInt(match[1], 10);
        } else if (match = line.match(/incr pref/)) {
            pref += 1;
        } else if (match = line.match(/option ([A-Z_]+)/)) {
            if (!obj[receiver][sender][prn].options[pref]) obj[receiver][sender][prn].options[pref] = {};
            obj[receiver][sender][prn].options[pref].option = match[1];
        } else if (match = line.match(/(Enter[^ ]+) .* ([A-Z_]+)/)) {
            if (!obj[receiver][sender][prn].options[pref]) obj[receiver][sender][prn].options[pref] = {};
            obj[receiver][sender][prn].options[pref].input = match[1];
            obj[receiver][sender][prn].options[pref].param = match[2];
            if (obj[receiver][sender][prn].params[match[2]]) delete obj[receiver][sender][prn].params[match[2]].readonly;
        } else if (match = line.match(/append HTML_PARAMS\(separate_\$prn\) "<tr><td>\\\$\{([A-Z_]+)\}<\/td><td>"/)) {
            if (!obj[receiver][sender][prn].options[pref]) obj[receiver][sender][prn].options[pref] = {};
            obj[receiver][sender][prn].options[pref].desc = match[1];
        } else if (match = line.match(/get_ComboBox options ([A-Z_\|]+)/)) {
            var combo = match[1].split('|');
            combo.forEach(function (p) {
                if (obj[receiver][sender][prn].params[p]) delete obj[receiver][sender][prn].params[p].readonly;
            });
            if (!obj[receiver][sender][prn].options[pref]) obj[receiver][sender][prn].options[pref] = {};
            obj[receiver][sender][prn].options[pref].combo = combo;
        }
    });


    if (receiver === 'SIGNAL_LED') {
        pref = parseInt(Object.keys(obj[receiver][sender][1].options).sort().pop(), 10);
        obj[receiver][sender][1].options[++pref] = {
            "desc": "signal_kind",
            "option": "SHORT_LONG",
            "combo": [
                "SHORT_ACT_TYPE",
                "LONG_ACT_TYPE"
            ],
            "param": "SHORT_ACT_TYPE"
        };
        obj[receiver][sender][1].options[++pref] = {
            "desc": "signal_count",
            "combo": [
                "SHORT_ACT_NUM",
                "LONG_ACT_NUM"
            ],
            "param": "SHORT_ACT_NUM"
        };

        //console.log('\n\n', JSON.stringify(obj[receiver][sender], null, '  '), '\n\n');


    } else if (receiver === 'SIGNAL_CHIME') {
        pref = parseInt(Object.keys(obj[receiver][sender][1].options).sort().pop(), 10) || 0;
        obj[receiver][sender][1].options[++pref] = {
            "desc": "signal_kind",
            "option": "SHORT_LONG",
            "combo": [
                "SHORT_ACT_TYPE",
                "LONG_ACT_TYPE"
            ],
            "param": "SHORT_ACT_TYPE"
        };
        obj[receiver][sender][1].options[++pref] = {
            "desc": "signal_kind_count",
            "combo": [
                "SHORT_ACT_NUM",
                "LONG_ACT_NUM"
            ],
            "param": "SHORT_ACT_NUM"
        };


    }

}


