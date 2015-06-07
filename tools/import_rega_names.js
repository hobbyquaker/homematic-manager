if (!process.argv[2]) {
    console.log('usage: node import_rega_names.js <host>');
    console.log('   example: node import_rega_names.js 192.168.1.50');
} else {
    var ccuIp = process.argv[2];
}

var fs = require('fs');
var config = require('../lib/config.js');


var http = require('http');

var script = fs.readFileSync(__dirname + '/reganames.fn').toString();

console.log('executing reganames.fn on ' + ccuIp);
regaScript(ccuIp, 'reganames.fn', function (err, res) {
    if (err) {
        console.log(err);
    } else {
        console.log('saving response in ' + config.namesFile);
        fs.writeFileSync(config.namesFile, JSON.stringify(res));
        console.log('done.');
    }
});

function regaScript(ip, file, callback) {
    fs.readFile(__dirname + '/' + file, 'utf8', function (err, script) {
        if (err) {
            callback(err);
            return false;
        }
        var post_options = {
            host: ip,
            port: '8181',
            path: '/rega.exe',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': script.length
            }
        };
        var post_req = http.request(post_options, function(res) {
            var data = '';
            res.setEncoding('utf8');
            res.on('data', function (chunk) {
                data += chunk.toString();
            });
            res.on('end', function () {
                var pos = data.lastIndexOf("<xml>");
                var stdout = unescape(data.substring(0, pos));
                try {
                    var result = JSON.parse(stdout);
                    callback(null, result);
                } catch (e) {
                    callback(e)

                }
            });
        });

        post_req.on('error', function (e) {
            callback(e);
        });

        post_req.write(script);
        post_req.end();

    });
}


