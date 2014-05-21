//

"use strict";

var fs = require('fs');
var express = require('express');
var socketio = require('socket.io');
var xmlrpc = require('xmlrpc');
var http = require('http');

var config = loadConfig();
var logStream = openLog(__dirname + '/log/hm-manager.log');

var app;
var server;
var io;
var rpc;

var daemon;
var rpcCache = {};
var regaCache = {};

initWebServer();
initSocket();

for (var daemon in config.daemons) {
    if (config.daemons[daemon].isCcu && !regaCache[config.daemons[daemon].ip]) {
        regaCache[config.daemons[daemon].ip] = {};
        getRegaNames(config.daemons[daemon].ip);
    }
}


function initSocket() {

    io.sockets.on('connection', function (socket) {

        socket.on('getConfig', function (callback) {
            callback(config);
        });

        socket.on('getRegaNames', function (callback) {
            callback(regaCache);
        });

        socket.on('bidcosConnect', function (d, callback) {
            daemon = d;
            console.log('connect ' + daemon);
            rpc = xmlrpc.createClient({
                host: config.daemons[daemon].ip,
                port: config.daemons[daemon].port,
                path: '/'
            });
           callback();

        });

        socket.on('rpc', function (method, paramArray, callback) {
            if (method) {
                console.log("RPC " + method + " " + JSON.stringify(paramArray));
                switch (method) {
                    case 'listDevices':
                    // Todo implement cache?
                    // break;
                    default:
                        rpc.methodCall(method, paramArray, function (error, result) {
                            if (callback) {
                                callback(error, result);
                            }
                        });
                        break;
                }
            }
        });
    });
}

function initWebServer() {
    app = express();
    app.use('/', express.static(__dirname + '/www'));
    server = require('http').createServer(app);
    server.listen(config.webServerPort);

    io = socketio.listen(server);

    // redirect socket.io logging to log file
    io.set('logger', {
        debug: function(obj) {
            log("socket.io debug: "+obj);
        },
        info: function(obj) {
            log("socket.io info: "+obj);
        },
        error: function(obj) {
            log("socket.io error: "+obj);
        },
        warn: function(obj) {
            log("socket.io warn: "+obj);
        }
    });

    log("webserver listening on port "+config.webServerPort);
}

function getRegaNames(ip) {
    console.log("loading rega names from " + ip);
    regaScript(ip, "reganames.fn", function (res) {
        regaCache[ip] = res;
    });
}

function regaScript(ip, file, callback) {
    fs.readFile(__dirname + '/' + file, 'utf8', function (err, script) {
        if (err) {
            console.log("regaScript " + err);
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
            var data = "";
            res.setEncoding('utf8');
            res.on('data', function (chunk) {
                data += chunk.toString();
            });
            res.on('end', function () {
                var pos = data.lastIndexOf("<xml>");
                var stdout = unescape(data.substring(0, pos));
                try {
                    var result = JSON.parse(stdout);
                    callback(result);
                } catch (e) {
                    console.log("regaScript error " + e);
                }
            });
        });

        post_req.on('error', function (e) {
            console.log("regaScript POST " + e);
        });

        post_req.write(script);
        post_req.end();

    });
}

function saveJson(file, obj) {

}

function loadJson(file) {

    return obj;
}


function loadConfig() {
    if (!fs.existsSync(__dirname + "/config.json")) {
        fs.writeFileSync(__dirname + "/config.json", fs.readFileSync(__dirname + "/config-default.json"));
    }
    return JSON.parse(fs.readFileSync(__dirname + "/config.json"));
}

function openLog(logfile) {
    return fs.createWriteStream(logfile, {
        flags: "a", encoding: "utf8", mode: 420
    });
}

function log(msg) {
    logStream.write(msg + "\n");
}

function stop() {
    log("terminating");
    process.exit(0);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
