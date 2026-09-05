const fs = require('fs');
const path = require('path');
const Entities = require('html-entities').AllHtmlEntities;

const occuPath = __dirname + '../../../occu/';
const langs = ['de', 'en'];
const channels = [
    {channelType: 'MOTION_DETECTOR', file: 'md_ch_master.tcl', langFile: 'MASTER_LANG/MOTION_DETECTOR.js'},
    {channelType: 'MOTION_DETECTOR', file: 'md_ch_master.tcl', langFile: 'MASTER_LANG/MOTION_DETECTOR.js'},
];

const entities = new Entities();

const easymodePath = path.join(occuPath, '/WebUI/www/config/easymodes/');

const obj = {};

const easymodeMasterLang = {};

function readEasymodeMasterLang(channelType, file) {
    if (easymodeMasterLang[channelType]) return;
    try {
        let json = fs.readFileSync(path.join(easymodePath, file)).toString();
        json = json.replace(/jQuery\.extend\s*\(\s*true\s*,\s*langJSON\s*,\s*/, '').replace(/\);\s*$/, '');
        json = JSON.parse(json);
        easymodeMasterLang[channelType] = json;
    } catch (error) {
        easymodeMasterLang[channelType] = {};
    }
}

const stringtable = {};
let lines = fs.readFileSync(path.join(occuPath, 'WebUI/www/config/stringtable_de.txt')).toString().replace(/\r/g, '').split('\n');
lines.forEach(line => {
   let match;
   if (match = line.match(/([A-Z0-9|_]+)\s+\${([A-Za-z0-9]+)}/)) {
       const [, key, val] = match;
       stringtable[key] = val;
   }
});


const translateStringtable = {};
langs.forEach(lang => {
    obj[lang] = {};
    translateStringtable[lang] = {};
    let json = fs.readFileSync(path.join(occuPath, 'WebUI/www/webui/js/lang', lang, 'translate.lang.stringtable.js')).toString();
    json = json.replace(/jQuery\.extend\s*\(\s*true\s*,\s*langJSON\s*,\s*/, '').replace(/\);\s*$/, '').replace(/"\s*\+\s*"/g, '');
    json = JSON.parse(json)[lang];
    Object.keys(json).forEach(key => {
        json[key] = entities.decode(unescape(json[key]));
    });
    translateStringtable[lang] = json;
});

let strings = {}
langs.forEach(lang => {
    strings[lang] = {};
    Object.keys(stringtable).forEach(key => {
        strings[lang][key] = translateStringtable[lang][stringtable[key]];
    });
});

fs.writeFileSync(path.join(__dirname, '..', 'www', 'js', 'stringtable.json'), JSON.stringify(strings, null, '  '));

/*

channels.forEach(ch => {
    const {file, channelType, langFile} = ch;
    langs.forEach(lang => {
        obj[lang][channelType] = {};
    });
    const lines = fs.readFileSync(path.join(easymodePath, file)).toString().replace(/\r/g, '').split('\n');
    lines.forEach((line, i) => {
        if (line.startsWith('set PROFILE_PNAME(')) {
            let match;
            if (match = line.match(/PROFILE_PNAME\(([^)]+)\)\s+"(([A-Z0-9_]+)\|([A-Z0-9_]+))/)) {
                const [, id, typeParam, type, param] = match;
                let str = stringtable[typeParam] ||stringtable[param];
                console.log(id, typeParam, type, param, str);
                if (str) {
                    langs.forEach(lang => {
                        if (!obj[lang][type]) {
                            obj[lang][type] = {};
                        }
                        obj[lang][type][param] = translateStringtable[lang][str];

                    });
                }
            } else if (match = line.match(/PROFILE_PNAME\(([A-Z]+)\)\s+"\\\${([^"]+)}/)) {
                const [, id, placeholder] = match;
                //let match2 = lines.join(' ').match(new RegExp('\\$PROFILE_PNAME\\(' + id + '\\)(?!.*name).*(name=\\\\"[^"]+\\\\")'));
                //console.log('name', match2 && match2[1]);

                readEasymodeMasterLang(channelType, langFile);
                langs.forEach(lang => {
                    console.log(lang, id, placeholder, easymodeMasterLang[channelType] && easymodeMasterLang[channelType][lang] && easymodeMasterLang[channelType][lang][placeholder]);

                });
            }

        } else if (line.match(/set help_txt/)) {
            let match;
            if (match = line.match(/help_txt\s+"\\\${([^}]+)}/)) {
                let [, placeholder] = match
                langs.forEach(lang => {
                    if ( easymodeMasterLang[channelType] && easymodeMasterLang[channelType][lang]) {
                        const help_txt = easymodeMasterLang[channelType] && easymodeMasterLang[channelType][lang] && easymodeMasterLang[channelType][lang][placeholder];
                        obj[lang][channelType].help_txt = help_txt;
                    }

                });
            }
        }
    });
});

fs.writeFileSync(path.join(__dirname, '..', 'www', 'js', 'helpMasterParamset.json'), JSON.stringify(obj, null, '  '));
*/