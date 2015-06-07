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

var async =     require('async');

var express =   require('express');
var socketio =  require('socket.io');

var xmlrpc =    require('homematic-xmlrpc');
var binrpc =    require('binrpc');

var config =    require('./lib/config.js');

var app;
var server;
var io;
var rpc;

var localNames = {};
var localDevices = {};
var localParamsetDescriptions = {};
var rpcClients = {};

var rpcServer;
var rpcServerBin;
var rpcServerStarted;
var rpcServerBinStarted;
var daemonIndex = {};
var lastEvent = {};

var log = {
    debug: function (msg) {
        if (config.debug) {
            console.log(msg);
        }
    },
    info: function (msg) {
        console.log(msg);
    },
    error: function (msg) {
        console.error(msg)
    }
};


loadJson(config.devicesFile, function (err, data) {
    if (!err && data) localDevices = data;
    loadJson(config.paramsetDescriptionsFile, function (err, data) {
        if (!err && data) localParamsetDescriptions = data;
        loadJson(config.namesFile, function (err, data) {
            if (!err && data) localNames = data;
            initWebServer();
            initRpcClients();
        });
    });
});


function initRpcClients() {

    function init(_daemon) {
        var protocol = (config.daemons[_daemon].protocol === 'binrpc' ? 'xmlrpc_bin://' : 'http://');
        var port = (config.daemons[_daemon].protocol === 'binrpc' ? config.rpcListenPortBin : config.rpcListenPort);
        var initUrl = protocol + config.rpcListenIp + ':' + port;
        var ident = config.daemons[_daemon].ident;

        log.debug('RPC -> ' + config.daemons[_daemon].ip + ':' + config.daemons[_daemon].port + ' init ' + initUrl + ' ' + ident);
        rpcClients[_daemon].methodCall('init', [initUrl, ident], function (err, data) {
            log.debug('    <- init response ' + JSON.stringify(err) + ' ' + JSON.stringify(data));
        });
    }

    function pingPong() {
        var now = (new Date()).getTime();
        for (var daemon in config.daemons) {
            var elapsed = now - lastEvent[daemon];
            if (elapsed > 45000) {
                log.debug('RPC -> re-init ' + daemon + ' ' + elapsed);
                init(daemon);
            } else if (elapsed > 29000) {
                log.debug('RPC -> ping ' + daemon + ' ' + elapsed);
                rpcClients[daemon].methodCall('ping', ['hmm']);
            }
        }
    }

    var count = 0;
    for (var daemon in config.daemons) {
        config.daemons[daemon].ident = 'hmm_' + count;


        daemonIndex[config.daemons[daemon].ident] = daemon;

        rpcClients[daemon] = (config.daemons[daemon].protocol === 'binrpc' ? binrpc : xmlrpc).createClient({
            host: config.daemons[daemon].ip,
            port: config.daemons[daemon].port,
            path: '/'
        });

        initRpcServer(config.daemons[daemon].protocol);

        (function (_daemon) {
            if (config.daemons[_daemon].protocol === 'binrpc') {
                rpcClients[_daemon].on('connect', function () {
                    init(_daemon);
                });
            } else {
                init(_daemon);
            }
        })(daemon);

        count += 1;
    }
    setInterval(pingPong, 15000);
}

function initRpcServer(protocol) {
    var server;
    if (protocol === 'binrpc' && !rpcServerBinStarted) {
        rpcServerBinStarted =  true;
        rpcServerBin =      binrpc.createServer({host: config.rpcListenIp, port: config.rpcListenPortBin});
        server = rpcServerBin;
        log.debug('binrpc server listening on ' + config.rpcListenIp + ':' + (config.rpcListenPortBin));
    } else if (!rpcServerStarted) {
        rpcServerStarted =  true;
        rpcServer =         xmlrpc.createServer({host: config.rpcListenIp, port: config.rpcListenPort});
        server = rpcServer;
        log.debug('xmlrpc server listening on ' + config.rpcListenIp + ':' + (config.rpcListenPort));
    } else {
        log.debug(protocol + ' server already started');
        return;
    }

    server.on('NotFound', function (method, params) {
        log.debug('RPC <- undefined method ' + method + ' ' + JSON.stringify(params).slice(0,80));
        io.sockets.emit('rpc', method, params);
    });

    server.on('system.multicall', function (method, params, callback) {
        var response = [];
        for (var i = 0; i < params[0].length; i++) {
            if (rpcMethods[params[0][i].methodName]) {
                response.push(rpcMethods[params[0][i].methodName](null, params[0][i].params));
            } else {
                log.debug('RPC <- undefined method ' + method + ' ' + JSON.stringify(params).slice(0,80));
                response.push('');
            }
        }
        callback(null, response);
    });

    server.on('event', function (err, params, callback) {
        lastEvent[daemonIndex[params[0]]] = (new Date()).getTime();
        callback(null, rpcMethods.event(err, params));
    });
    server.on('newDevices', function (err, params, callback) {
        callback(null, rpcMethods.newDevices(err, params));
    });
    server.on('deleteDevices', function(err, params, callback) {
        callback(null, rpcMethods.deleteDevices(err, params));
    });
    server.on('replaceDevice', function(err, params, callback) {
        callback(null, rpcMethods.replaceDevice(err, params));
    });
    server.on('listDevices', function(err, params, callback) {
        callback(null, rpcMethods.listDevices(err, params));
    });
    server.on('system.listMethods', function(err, params, callback) {
        callback(null, rpcMethods['system.listMethods'](err, params));
    });

}

var rpcMethods = {
    event: function (err, params) {
        log.debug('RPC <- event ' + JSON.stringify(params));
        io.sockets.emit('rpc', 'event', params);
        return '';
    },
    newDevices: function (err, params) {
        log.debug('RPC <- newDevices ' + JSON.stringify(params).slice(0, 80));
        io.sockets.emit('rpc', 'newDevices', params);
        var daemon = daemonIndex[params[0]];
        lastEvent[daemon] = (new Date()).getTime();
        if (!localDevices[daemon]) localDevices[daemon] = {};
        for (var i = 0; i < params[1].length; i++) {
            var dev = params[1][i];
            localDevices[daemon][dev.ADDRESS] = dev;
        }
        saveJson(config.devicesFile, localDevices);
        return '';
    },
    deleteDevices: function (err, params) {
        log.debug('RPC <- deleteDevices ' + JSON.stringify(params));
        io.sockets.emit('rpc', 'deleteDevices', params);
        var daemon = daemonIndex[params[0]];
        lastEvent[daemon] = (new Date()).getTime();
        if (!localDevices[daemon] || !params[1]) return;

        for (var i = 0; i < params[1].length; i++) {
            var address = params[1][i];
            delete localDevices[daemon][address];
        }
        saveJson(config.devicesFile, localDevices);
        return '';
    },
    replaceDevice: function (err, params) {
        log.debug('RPC <- replaceDevice ' + JSON.stringify(params));
        io.sockets.emit('rpc', 'replaceDevice', params);
        var daemon = daemonIndex[params[0]];
        lastEvent[daemon] = (new Date()).getTime();
        if (!localDevices[daemon] || !params[1]) return;
        localNames[params[2]] = localNames[params[1]];
        delete localNames[params[1]];
        saveJson(config.namesFile, localNames);
        delete localDevices[daemon][params[1]];
        saveJson(config.devicesFile, localDevices);
        return '';
    },
    listDevices: function (err, params) {
        log.debug('RPC <- listDevices ' + JSON.stringify(params));
        io.sockets.emit('rpc', 'listDevices', params);
        var daemon = daemonIndex[params[0]];
        var res = [];
        for (var address in localDevices[daemon]) {
            res.push({ADDRESS: address, VERSION: localDevices[daemon][address].VERSION});
        }
        log.debug('RPC -> listDevices response length ' + res.length);
        return res;
    },
    'system.listMethods': function (err, params) {
        return ['system.multicall', 'system.listMethods', 'listDevices', 'deleteDevices', 'newDevices', 'event'];
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
                log.debug('local rename ' + address + ' "' + name + '"');
                if (!address.match(/:/)) {
                    localNames[address + ':0'] = name + ':0';
                }
                saveJson(config.namesFile, localNames, function () {
                    if (callback) callback();
                });
        });

        socket.on('rpc', function (daemon, method, paramArray, callback) {
            if (!rpcClients[daemon]) {
                log.debug('RPC unknown daemon ' + daemon);
                if (callback) {
                    callback(new Error('unknown daemon'), null);
                }
                return;
            }
            if (method) rpcProxy(daemon, method, paramArray, callback);
        });

    });
}

function rpcProxy(daemon, method, params, callback) {
    switch (method) {
        case 'listDevices':
            var res = [];
            for (var address in localDevices[daemon]) {
                res.push(localDevices[daemon][address]);
            }
            log.debug('RPC -> respond to listDevices from cache (' + res.length + ')');
            callback(null, res);
            break;

        case 'getParamsetDescription':
            var dev = localDevices[daemon][params[0]];
            console.log('...', params[0], dev);
            var ident = dev.TYPE + '/' + dev.VERSION + '/' + params[1];
            if (dev.PARENT_TYPE) ident = dev.PARENT_TYPE + '/' + ident;

            if (localParamsetDescriptions[ident]) {
                console.log('paramset cache hit ' + ident);
                callback(null, localParamsetDescriptions[ident]);
            } else {
                rpcClients[daemon].methodCall(method, params, function (error, result) {
                    if (!error && result) localParamsetDescriptions[ident] = result;
                    saveJson(config.paramsetDescriptionsFile, localParamsetDescriptions);
                    if (callback) callback(error, result);
                });
            }
            break;

        default:
            log.debug('RPC -> ' + config.daemons[daemon].ip + ':' + config.daemons[daemon].port + ' ' + method + '(' + JSON.stringify(params).slice(1).slice(0, -1).replace(/,/, ', ') + ')');
            rpcClients[daemon].methodCall(method, params, function (error, result) {
                if (callback) callback(error, result);
            });
    }
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
            log.debug('socket.io info: ' + obj);
        },
        error: function(obj) {
            log.debug('socket.io error: ' + obj);
        },
        warn: function(obj) {
            log.debug('socket.io warn: ' + obj);
        }
    });

    initSocket();

    log.debug('webserver/socket.io listening on port ' + config.webServerPort);
}




function saveJson(file, obj, callback) {
    log.debug('saveJson ' + file);
    fs.writeFile(file, JSON.stringify(obj, null, '    '), function (err) {
        if (callback) {
            callback(err);
        }
    });
}

function loadJson(file, callback) {
    log.debug('loadJson ' + file);
    fs.readFile(file, function (err, data) {
        if (err) {
            callback(err, null);
        } else {
            callback(null, JSON.parse(data.toString()));
        }
    });
}



var stopping;

function stop() {
    if (stopping) {
        log.debug('force terminate');
        process.exit(1);
        return;
    }

    var tasks = [];
    for (var daemon in config.daemons) {
        var protocol = (config.daemons[daemon].protocol === 'binrpc' ? 'xmlrpc_bin://' : 'http://');
        var initUrl = protocol + config.rpcListenIp + ':' + (config.daemons[daemon].protocol === 'binrpc' ? config.rpcListenPortBin : config.rpcListenPort);

        (function (_daemon, _initUrl) {
            tasks.push(function (cb) {
                log.debug("RPC -> " + config.daemons[daemon].ip + ':' + config.daemons[daemon].port + ' init ' + initUrl + ' ""');
                rpcClients[_daemon].methodCall('init', [_initUrl, ''], function (err, data) {
                    log.debug("    <- " + JSON.stringify(err) + ' ' + JSON.stringify(data));
                    cb(null, data);
                });
            })
        })(daemon, initUrl);

    }
    async.parallel(tasks, function () {
        log.debug('terminate');
        process.exit(0);
    });
    setTimeout(stop, 2000);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
