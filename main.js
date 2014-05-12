//

"use strict";

var fs = require("fs");
var express = require("express");
var socketio = require("socket.io");
var xmlrpc = require("xmlrpc");
var http = require("http");

var config = loadConfig();
var logStream = openLog(__dirname + "/log/hm-manager.log");

var app;
var server;
var io;
var rpc;

var rpcCache = {};
var regaCache = {};

initWebServer();
initSocket();

for (var daemon in config.daemons) {
    if (config.daemons[daemon].isCcu && !regaCache[config.daemons[daemon].ip]) {
        regaCache[config.daemons[daemon].ip] = {};
        getRegaObjects(config.daemons[daemon].ip);
    }
}


function initSocket() {

    io.sockets.on('connection', function (socket) {

        socket.on("getConfig", function (callback) {
            callback(config);
        });

        socket.on("getRegaObjects", function (callback) {
            callback(regaCache);
        });

        socket.on("bidcosConnect", function (daemon, callback) {
            console.log("connect "+daemon);
            rpc = xmlrpc.createClient({
                host: config.daemons[daemon].ip,
                port: config.daemons[daemon].port,
                path: '/'
            });
           callback();

        });

        socket.on("listDevices", function (callback) {
            if (rpcCache[daemon] && rpcCache[daemon].listDevices) {
                console.log("listDevices cache hit");
                callback(rpcCache[daemon].listDevices);
            } else {
                console.log("listDevices RPC");
                rpc.methodCall("listDevices", [], function (error, result) {
                    // TODO catch errors
                    if (!rpcCache[daemon]) rpcCache[daemon] = {};
                    rpcCache[daemon].listDevices = result;
                    callback(error, result);
                });
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


function getRegaObjects(ip) {
    console.log("loading rega devices from " + ip);
    regaScript(ip, "devices.fn", function (res) {
        regaCache[ip].devices = res;
        console.log("loading rega channels from " + ip);
        regaScript(ip, "channels.fn", function (res) {
            regaCache[ip].channels = res;
            console.log("loading rega rooms from " + ip);
            regaScript(ip, "rooms.fn", function (res) {
                regaCache[ip].rooms = res;
                console.log("loading rega functions from " + ip);
                regaScript(ip, "functions.fn", function (res) {
                    regaCache[ip].functions = res;
                });
            });
        });
    });
}

function regaScript(ip, file, callback) {
    fs.readFile(__dirname + '/regascripts/' + file, 'utf8', function (err, script) {
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
                var stdout = (data.substring(0, pos));
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



function loadConfig() {
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
