/**
 *      homematic-manager
 *
 *  Copyright (c) 2014, 2015 Anli, Hobbyquaker
 *
 *  CC BY-NC-SA 4.0 (http://creativecommons.org/licenses/by-nc-sa/4.0/)
 *
 */

"use strict";

var fs =        require('fs');
var http =      require('http');
var express =   require('express');
var socketio =  require('socket.io');
var xmlrpc =    require('homematic-xmlrpc');

var encoding =  require('encoding');

var paths =    require('./lib/paths.js');

var confDir = paths.confDir;
var dataDir = paths.dataDir;

if (!fs.existsSync(confDir + 'hm-manager.json')) {
    console.log('creating ' + confDir + 'hm-manager.json');
    fs.writeFileSync(confDir + 'hm-manager.json', JSON.stringify(require('./settings-default.json'), null, '    '));
}

var config =    require(confDir + 'hm-manager.json');
var pkg =       require('./package.json');

config.version = pkg.version;
config.rpcListenIp = config.rpcListenIp || '127.0.0.1';
config.rpcListenPort = config.rpcListenPort || 2015;
config.datastorePath = confDir;

var app;
var server;
var io;
var rpc;

var daemon;
var daemonIndex =       [];

var localNames =        {};

var rpcClients =        {};

var rpcServer;
var rpcServerBin;
var rpcServerStarted;

loadJson('names.json', function (err, data) {
    if (!err) localNames = data;
});

initWebServer();
initDaemons();

function initDaemons() {
    var count = 0;
    for (var daemon in config.daemons) {

        //rpcClients[daemon] = (config.daemons[daemon].useRega ? binrpc : xmlrpc).createClient({
        rpcClients[daemon] = xmlrpc.createClient({
            host: config.daemons[daemon].ip,
            port: config.daemons[daemon].port,
            path: '/'
        });

        if (config.daemons[daemon].init) {
            if (!rpcServerStarted) initRpcServer();
            var protocol = 'http://';
            log('RPC -> ' + config.daemons[daemon].ip + ':' + config.daemons[daemon].port + ' init ' + JSON.stringify([protocol + config.rpcListenIp + ':' + config.rpcListenPort, 'hmm_' + count]));
            rpcClients[daemon].methodCall('init', [protocol + config.rpcListenIp + ':' + config.rpcListenPort, 'hmm_' + count], function (err, data) { });
        }

        if (config.daemons[daemon].useRega) {
            getRegaNames(daemon);
        }

        config.daemons[daemon].ident = 'hmm_' + count;
        daemonIndex[count] = daemon;
        count += 1;
    }
}

function initRpcServer() {
    rpcServerStarted =  true;
    rpcServer =         xmlrpc.createServer({ host: config.rpcListenIp, port: config.rpcListenPort });

    log('XML-RPC server listening on ' + config.rpcListenIp + ':' + (config.rpcListenPort));

    rpcServer.on('NotFound', function(method, params) {
        log('RPC <- undefined method ' + method + ' ' + JSON.stringify(params).slice(0,80));
        io.sockets.emit('rpc', method, params);
    });

    rpcServer.on('system.multicall', function(method, params, callback) {
        var response = [];
        for (var i = 0; i < params[0].length; i++) {
            if (methods[params[0][i].methodName]) {
                response.push(methods[params[0][i].methodName](null, params[0][i].params));
            } else {
                response.push('');
            }
        }
        callback(null, response);
    });

    rpcServer.on('event', function(err, params, callback) {
        callback(null, methods.event(err, params));
    });

    rpcServer.on('newDevices', function(err, params, callback) {
        callback(null, methods.newDevices(err, params));
    });

    rpcServer.on('deleteDevices', function(err, params, callback) {
        callback(null, methods.deleteDevices(err, params));
    });


}

var methods = {
    event: function (err, params) {
        log('RPC <- event ' + JSON.stringify(params));
        io.sockets.emit('rpc', 'event', params);
        return '';
    },
    newDevices: function (err, params) {
        log('RPC <- newDevices ' + JSON.stringify(params));
        io.sockets.emit('rpc', 'newDevices', params);
        return '';
    },
    deleteDevices: function (err, params) {
        log('RPC <- deleteDevices ' + JSON.stringify(params));
        io.sockets.emit('rpc', 'deleteDevices', params);
        return '';
    }
};

function initSocket() {

    io.sockets.on('connection', function (socket) {

        socket.on('getConfig', function (callback) {
            callback(config);
        });

        socket.on('getNames', function (callback) {
            callback(localNames);
        });

        socket.on('setName', function (address, name, callback) {
                localNames[address] = name;
                log('local rename ' + address + ' "' + name + '"');
                if (!address.match(/:/)) {
                    localNames[address + ':0'] = name + ':0';
                }
                saveJson('names.json', localNames, function () {
                    if (callback) callback();
                });
        });

        socket.on('rpc', function (daemon, method, paramArray, callback) {
            if (!rpcClients[daemon]) {
                log('RPC unknown daemon ' + daemon);
                if (callback) {
                    callback('unknown daemon', null);
                }
                return;
            }
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
    initSocket();

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




function saveJson(file, obj, callback) {
    fs.writeFile(dataDir + file, JSON.stringify(obj), function (err) {
        if (callback) {
            callback(err);
        }
    });
}

function loadJson(file, callback) {
    fs.readFile(dataDir + file, function (err, data) {
        if (err) {
            callback(err, null);
        } else {
            callback(null, JSON.parse(data.toString()));
        }
    });
}


function log(msg) {
    console.log(msg);
}

var stopping;

function stop() {
    if (stopping) {

    }

    for (var daemon in config.daemons) {
        if (config.daemons[daemon].init) {
            var protocol = 'http://';
            log("RPC -> " + config.daemons[daemon].ip + ':' + config.daemons[daemon].port + ' init ' + JSON.stringify([protocol + config.rpcListenIp + ':' + config.rpcListenPort, '']));
            rpcClients[daemon].methodCall('init', [protocol + config.rpcListenIp + ':' + config.rpcListenPort, ''], function (err, data) {});
        }
    }
    log('terminating');
    setTimeout(function () {
        log('')
        process.exit(0);
    }, 2000);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
