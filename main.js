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
var socket;

initWebServer();



function initWebServer() {
    app = express();
    app.use('/', express.static(__dirname + '/www'));
    server = require('http').createServer(app);
    server.listen(config.webServerPort);

    socket = socketio.listen(server);

    // redirect socket.io logging to log file
    socket.set('logger', {
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
