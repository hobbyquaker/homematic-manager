/**
 *      homematic-manager
 *
 *  Copyright (c) 2014 Anli, Hobbyquaker
 *
 *  CC BY-NC-SA 4.0 (http://creativecommons.org/licenses/by-nc-sa/4.0/)
 *
 */

"use strict";

var version = '0.9.3';

var fs =        require('fs');
var http =      require('http');
var express =   require('express');
var socketio =  require('socket.io');
var xmlrpc =    require('homematic-xmlrpc');
var binrpc =    require('binrpc');

/*var Iconv  =  require('iconv-lite').Iconv;
var iconv =     new Iconv('UTF-8', 'ISO-8859-1');*/
var encoding =  require('encoding');

var config = loadConfig();
config.version = version;

var logStream = openLog(__dirname + '/log/hm-manager.log');
var logStdout = !process.argv[2];

var app;
var server;
var io;
var rpc;

var daemon;
var daemonIndex =       [];

var regaNames =         {};
var regaIDs =           {};
var regaNamesLoaded =   {};
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

        rpcClients[daemon] = (config.daemons[daemon].isCcu ? binrpc : xmlrpc).createClient({
            host: config.daemons[daemon].ip,
            port: config.daemons[daemon].port,
            path: '/'
        });

        if (config.daemons[daemon].init) {
            if (!rpcServerStarted) initRpcServer();
            var protocol = config.daemons[daemon].isCcu ? 'xmlrpc_bin://' : 'http://';
            log('RPC -> ' + config.daemons[daemon].ip + ':' + config.daemons[daemon].port + ' init ' + JSON.stringify([protocol + config.rpcListenIp + ':' + (config.daemons[daemon].isCcu ? config.rpcListenPortBin : config.rpcListenPort), 'hmm_' + count]));
            rpcClients[daemon].methodCall('init', [protocol + config.rpcListenIp + ':' + (config.daemons[daemon].isCcu ? config.rpcListenPortBin : config.rpcListenPort), 'hmm_' + count], function (err, data) { });
        }

        if (config.daemons[daemon].isCcu) {
            getRegaNames(daemon);
        }
        config.daemons[daemon].ident = 'hmm_' + count;
        daemonIndex[count++] = daemon;
    }
}

function initRpcServer() {
    rpcServerStarted =  true;
    rpcServerBin =      binrpc.createServer({ host: config.rpcListenIp, port: config.rpcListenPortBin });
    rpcServer =         xmlrpc.createServer({ host: config.rpcListenIp, port: config.rpcListenPort });

    log('XML-RPC server listening on ' + config.rpcListenIp + ':' + (config.rpcListenPort));
    log('BIN-RPC server listening on ' + config.rpcListenIp + ':' + (config.rpcListenPortBin));

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

    rpcServerBin.on('NotFound', function(method, params) {
        log('RPC <- undefined method ' + method + ' ' + JSON.stringify(params).slice(0,80));
        io.sockets.emit('rpc', method, params);
    });

    rpcServerBin.on('system.multicall', function(method, params, callback) {
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

    rpcServerBin.on('event', function(err, params, callback) {
        callback(null, methods.event(err, params));
    });

    rpcServerBin.on('newDevices', function(err, params, callback) {
        callback(null, methods.newDevices(err, params));
    });
    rpcServerBin.on('deleteDevices', function(err, params, callback) {
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
            var names = {};
            for (var daemon in localNames) {
                names[daemon] = {};
                for (var addr in localNames[daemon]) {
                    names[daemon][addr] = localNames[daemon][addr];
                }
            }
            for (var daemon in config.daemons) {
                var ip = config.daemons[daemon].ip;
                if (!names[daemon]) names[daemon] = {};
                for (var addr in regaNames[ip]) {
                    names[daemon][addr] = regaNames[ip][addr];
                }
            }
            callback(names);
        });

        socket.on('setName', function (daemon, address, name, callback) {
            if (config.daemons[daemon].isCcu) {
                if (!regaNames[config.daemons[daemon].ip]) regaNames[daemon] = {};
                regaNames[config.daemons[daemon].ip][address] = name;
                if (!regaIDs[config.daemons[daemon].ip] || !regaIDs[config.daemons[daemon].ip][address]) {
                    log('error: no rega id found for ' + address);
                    return;
                }
                log('rega rename ' + regaIDs[config.daemons[daemon].ip][address] + ' "' + name + '"');
                rega(config.daemons[daemon].ip, 'var dev = dom.GetObject(' + regaIDs[config.daemons[daemon].ip][address] + ');\ndev.Name("' + name + '");', function () {
                    if (callback) callback();
                });
            } else {
                if (!localNames[daemon]) localNames[daemon] = {};
                localNames[daemon][address] = name;
                log('local rename ' + address + ' "' + name + '"');
                if (!address.match(/:/)) {
                    localNames[daemon][address + ':0'] = name + ':0';
                }
                saveJson('names.json', localNames, function () {
                    if (callback) callback();
                });
            }
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

function getRegaNames(daemon) {
    if (regaNamesLoaded[config.daemons[daemon].ip]) return;
    log('getRegaNames ' + config.daemons[daemon].ip);
    regaNamesLoaded[config.daemons[daemon].ip] = true;
    regaScript(config.daemons[daemon].ip, 'reganames.fn', function (res) {
        for (var addr in res) {
            if (!regaNames[config.daemons[daemon].ip]) regaNames[config.daemons[daemon].ip] = {};
            regaNames[config.daemons[daemon].ip][addr] = res[addr].Name;
            if (!regaIDs[config.daemons[daemon].ip]) regaIDs[config.daemons[daemon].ip] = {};
            regaIDs[config.daemons[daemon].ip][addr] = res[addr].ID;
        }
    });
}

function rega(ip, script, callback) {
    var post_options = {
        host: ip,
        port: '8181',
        path: '/rega.exe',
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=iso-8859-1;',
            'Content-Length': script.length
        }
    };

    script = encoding.convert(script, 'ISO-8859-1');
    var post_req = http.request(post_options, function(res) {
        var data = '';
        res.setEncoding('utf8');
        res.on('data', function (chunk) {
            data += chunk.toString();
        });
        res.on('end', function () {
            if (callback) callback(data);
        });
    });

    post_req.on('error', function (e) {
        log('ReGa ' + ip + ' ' + e);
    });

    post_req.write(script);
    post_req.end();

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
        log('ReGa ' + ip + ' script file: ' + file);
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
        if (err) {
            callback(err, null);
        } else {
            callback(null, JSON.parse(data.toString()));
        }
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
            var protocol = config.daemons[daemon].isCcu ? 'xmlrpc_bin://' : 'http://';
            log("RPC -> " + config.daemons[daemon].ip + ':' + config.daemons[daemon].port + ' init ' + JSON.stringify([protocol + config.rpcListenIp + ':' + (config.daemons[daemon].isCcu ? config.rpcListenPortBin : config.rpcListenPort), '']));
            rpcClients[daemon].methodCall('init', [protocol + config.rpcListenIp + ':' + (config.daemons[daemon].isCcu ? config.rpcListenPortBin : config.rpcListenPort), ''], function (err, data) {});
        }
    }
    log('terminating');
    setTimeout(function () {
        process.exit(0);
    }, 2000);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
