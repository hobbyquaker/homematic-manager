const fs = require('fs');
const path = require('path');

const tcl = fs.readFileSync(path.join(__dirname, '../../occu/WebUI/www/config/devdescr/DEVDB.tcl')).toString();

const tclArr = tcl.match(/array set DEV_PATHS\s([^\n]+)/)[1].trim();

const arr = tclArr.match(/[\s{][^\s]+ \{\{50 [^\s^}]+/g);

const res = {};

arr.forEach(str => {
    str = str.trim();
    // Console.log(str);
    const tmp = str.match(/^\{?([^\s]+) \{\{50 (.*)$/);
    if (tmp && !tmp[1].match(/\}$/)) {
        res[tmp[1]] = tmp[2].replace(/\/config\/img/, 'images');
    }
});

fs.writeFileSync(path.join(__dirname, '../www/js/deviceImages.json'), JSON.stringify(res, null, '  '));

