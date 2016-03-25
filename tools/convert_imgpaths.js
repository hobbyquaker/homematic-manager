var fs = require('fs');

var tcl = fs.readFileSync('../occu/occu/WebUI/www/config/devdescr/DEVDB.tcl').toString();

var tclArr = tcl.match(/array set DEV_PATHS\s([^\n]+)/)[1].trim();

var arr = tclArr.match(/[\s{][^\s]+ \{\{50 [^\s^}]+/g);

var res = {};





arr.forEach(function (str) {
    str = str.trim();
    //console.log(str);
    var tmp = str.match(/^\{?([^\s]+) \{\{50 (.*)$/);
    if (tmp && !tmp[1].match(/\}$/)) {
        res[tmp[1]] = tmp[2].replace(/\/config\/img/, 'images');
    }

});

var out = 'var deviceImages = ' + JSON.stringify(res, null, '  ') + ';';

fs.writeFileSync('../www/js/deviceImages.js', out);

console.log('cp -Rv ../occu/occu/WebUI/www/config/img/devices ../www/images/');