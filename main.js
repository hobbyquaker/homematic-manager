//

"use strict";

var fs = require("fs");
var express = require("express");
var socketio = require("socket.io");
var xmlrpc = require("xmlrpc");

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
getRegaObjects();

function getRegaObjects() {

}

function initSocket() {

    io.sockets.on('connection', function (socket) {

        socket.on("getConfig", function (callback) {
            callback(config);
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
