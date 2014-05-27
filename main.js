/**
 *      homematic-manager
 *
 *  Copyright (c) 2014 Anli, Hobbyquaker
 *
 *  CC BY-NC-SA 4.0 (http://creativecommons.org/licenses/by-nc-sa/4.0/)
 *
 */

"use strict";

var version = '0.1.0';

var fs = require('fs');
var express = require('express');
var socketio = require('socket.io');
var xmlrpc = require('xmlrpc');

var http = require('http');

var config = loadConfig();
config.version = version;

var logStream = openLog(__dirname + '/log/hm-manager.log');
var logStdout = !process.argv[2];

var app;
var server;
var io;
var rpc;

var daemon;

var regaCache = {};
var rpcClients = {};

var rpcServer;
var rpcServerStarted;

initWebServer();
initSocket();

for (var daemon in config.daemons) {

    rpcClients[daemon] = xmlrpc.createClient({
        host: config.daemons[daemon].ip,
        port: config.daemons[daemon].port,
        path: '/'
    });

    if (config.daemons[daemon].init) {
        if (!rpcServerStarted) initRpcServer();
        log("RPC -> " + config.daemons[daemon].ip + ':' + config.daemons[daemon].port + ' init ' + JSON.stringify(['http://' + config.rpcListenIp + ':9090', 'hmm']));
        rpcClients[daemon].methodCall('init', ['http://' + config.rpcListenIp + ':9090', 'hmm'], function (err, data) { });
    }


    if (config.daemons[daemon].isCcu && !regaCache[config.daemons[daemon].ip]) {
        regaCache[config.daemons[daemon].ip] = {};
        getRegaNames(config.daemons[daemon].ip);
    }
}

function initRpcServer() {
    rpcServerStarted = true;
    rpcServer = xmlrpc.createServer({ host: config.rpcListenIp, port: 9090 });

    log('RPC server listening on port 9090');

    rpcServer.on('NotFound', function(method, params) {
        console.log('RPC <- method ' + method + ' undefined!');
    });

    rpcServer.on('system.multicall', function(method, params, callback) {
        var response = [];
        for (var i = 0; i < params[0].length; i++) {
            response.push(methods[params[0][i].methodName](null, params[0][i].params));
        }
        callback(null, response);
    });

    rpcServer.on('system.listMethods', function(err, params, callback) {
        callback(null, methods.listMethods(err, params));
    });
    rpcServer.on('event', function(err, params, callback) {
        callback(null, methods.event(err, params));
    });
    rpcServer.on('listDevices', function(err, params, callback) {
        callback(null, methods.listDevices(err, params));
    });
    rpcServer.on('newDevices', function(err, params, callback) {
        callback(null, methods.newDevices(err, params));
    });

}

var methods = {
    listMethods: function (err, params) {
        console.log('RPC <- system.listMethods ' + JSON.stringify(params));
        return [''];
    },
    event: function (err, params) {
        console.log('RPC <- event ' + JSON.stringify(params));
        return '';
    },
    listDevices: function (err, params) {
        console.log('RPC <- listDevices ' + JSON.stringify(params));
        return [''];
    },
    newDevices: function (err, params) {
        console.log('RPC <- newDevices ' + JSON.stringify(params));
        return '';
    }
};

function initSocket() {

    io.sockets.on('connection', function (socket) {

        socket.on('getConfig', function (callback) {
            callback(config);
        });

        socket.on('getRegaNames', function (callback) {
            callback(regaCache);
        });

        socket.on('rpc', function (daemon, method, paramArray, callback) {
            if (method) {
                log('RPC -> ' + config.daemons[daemon].ip + ':' + config.daemons[daemon].port + ' ' + method + '(' + JSON.stringify(paramArray).slice(1).slice(0, -1).replace(/,/, ', ') + ')');

                rpcClients[daemon].methodCall(method, paramArray, function (error, result) {
                    if (callback) {
                        callback(error, result);
                    }
                });

            }
        });

        socket.on('saveJson', function (file, obj, callback) {
            log('saveJson ' + file);
            saveJson(file, obj, function (err) {
                if (callback) callback(err);
            });
        });

        socket.on('loadJson', function (file, obj, callback) {
            log('saveJson ' + file);
            loadJson(file, function (err, data) {
                callback(err, data);
            });
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
            //log('socket.io debug: ' + obj);
        },
        info: function(obj) {
            log('socket.io info: ' + obj);
        },
        error: function(obj) {
            log('socket.io error: ' + obj);
        },
        warn: function(obj) {
            log('socket.io warn: ' + obj);
        }
    });

    log('webserver listening on port ' + config.webServerPort);
}

function getRegaNames(ip) {
    regaScript(ip, 'reganames.fn', function (res) {
        regaCache[ip] = res;
    });
}

function regaScript(ip, file, callback) {
    fs.readFile(__dirname + '/' + file, 'utf8', function (err, script) {
        if (err) {
            log('readFile ' + file + ' ' + err);
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
        log('ReGa ' + ip + ' ' + file);
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
                    callback(result);
                } catch (e) {
                    log('ReGa ' + ip + ' ' + e);
                }
            });
        });

        post_req.on('error', function (e) {
            log('ReGa ' + ip + ' ' + e);
        });

        post_req.write(script);
        post_req.end();

    });
}

function saveJson(file, obj, callback) {
    fs.writeFile(__dirname + '/' + config.datastorePath + file, JSON.stringify(obj), function (err) {
        if (callback) {
            callback(err);
        }
    });
}

function loadJson(file, callback) {
    fs.readFile(__dirname + '/' + config.datastorePath + file, function (err, data) {
        callback(err, data);
    });
}


function loadConfig() {
    if (!fs.existsSync(__dirname + '/config.json')) {
        fs.writeFileSync(__dirname + '/config.json', fs.readFileSync(__dirname + '/config-default.json'));
    }
    return JSON.parse(fs.readFileSync(__dirname + '/config.json'));
}

function openLog(logfile) {
    return fs.createWriteStream(logfile, {
        flags: 'a', encoding: 'utf8', mode: 420
    });
}

function log(msg) {
    if (logStdout) {
        console.log(msg);
    }
    logStream.write(msg + '\n');
}

function stop() {
    for (var daemon in config.daemons) {


        if (config.daemons[daemon].init) {
            log("RPC -> " + config.daemons[daemon].ip + ':' + config.daemons[daemon].port + ' init ' + JSON.stringify(['http://' + config.rpcListenIp + ':9090', '']));
            rpcClients[daemon].methodCall('init', ['http://' + config.rpcListenIp + ':9090', ''], function (err, data) {

            });
        }


    }
    log('terminating');
    setTimeout(function () {
        process.exit(0);
    }, 2000);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

