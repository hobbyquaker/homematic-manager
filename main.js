/**
 *      homematic-manager
 *
 *  Copyright (c) 2014-2017 Sebastian Raff
 *  Copyright (c) 2014, 2015 Anli
 *
 *  CC BY-NC-SA 4.0 (http://creativecommons.org/licenses/by-nc-sa/4.0/)
 *
 */

const electron = require('electron');
const app = electron.app;
const Menu = electron.Menu;
const ipc = electron.ipcMain;
const BrowserWindow = electron.BrowserWindow;
const dialog = electron.dialog;

const Rpc = require('electron-ipc-rpc');
let ipcRpc;

const storage = require('electron-json-storage');
const windowStateKeeper = require('electron-window-state');
const isDev = require('electron-is-dev');

const net = require('net');
const path = require('path');
const url = require('url');
const fs = require('fs');
const http = require('http');
const request = require('request');

const pjson = require('persist-json')('hm-manager');
const nextPort = require('nextport');

const async = require('async');

const xmlrpc = require('homematic-xmlrpc');
const binrpc = require('binrpc');

const log = require('yalm');
log.setLevel(isDev ? 'debug' : 'error');

const config = {
    "rpcListenIp": "0.0.0.0",
    "rpcInitIp": "172.17.23.6",
    "ccuAddress": "172.16.23.130",
    "language": "de"
};

let mainWindow;

function createWindow() {

    let mainWindowState = windowStateKeeper({
        defaultWidth: 1280,
        defaultHeight: 620,

        minHeight: 620,
        minWidth: 1200,

    });

    let devWindowState = {
        width: 1280,
        height: 620,
        minHeight: 620,
        minWidth: 1200
    };

    let windowState = isDev ? devWindowState : mainWindowState;

    mainWindow = new BrowserWindow(windowState);

    mainWindow.loadURL(url.format({
        pathname: path.join(__dirname, 'www', 'index.html'),
        protocol: 'file:',
        slashes: true
    }));

    if (isDev) mainWindow.webContents.openDevTools();

    ipcRpc = new Rpc(electron.ipcMain, mainWindow.webContents);
    initIpc();

    nextPort(2000, port => {
        config.rpcListenPort = port;
        nextPort(port + 1, portBin => {
            config.rpcListenPortBin = portBin;
            findInterfaces();
        });
    });
}

function checkservice(host, port, callback) {
    const c = net.connect({
        port,
        host,
        timeout: this.timeout
    }, () => {
        callback(null, true);
        c.end();
    });
    c.on('error', () => {
        callback(null, false);
    });
}

let regaPresent = false;

function findInterfaces() {
    const ports = {
        "BidCos-Wired": 2000,
        "BidCos-RF": 2001,
        "HmIP": 2010,
        "CUxD": 8701,
        "rega": 8181,
    };
    const queue = {};
    Object.keys(ports).forEach(iface => {
        queue[iface] = callback => {
            checkservice(config.ccuAddress, ports[iface], callback);
        }
    });

    async.parallel(queue, (err, res) => {
        regaPresent = res.rega;
        config.daemons = {};
        Object.keys(res).forEach(iface => {
            if (res[iface] && iface !== 'rega') {
                config.daemons[iface] = {
                    type: iface,
                    ip: config.ccuAddress,
                    port: ports[iface],
                    protocol: iface === 'HmIP' ? 'xmlrpc' : 'binrpc',
                    reinitTimeout: iface === 'HmIP' ? 240000 : 45000,
                }
            }
        });
        initRpcClients();
        if (regaPresent) {
            getRegaNames();
        }
    });
}

app.on('ready', () => {
    createWindow();

});

app.on('window-all-closed', () => {
    app.quit();
});

app.on('activate', () => {
    log.debug('...activate!');
    if (mainWindow === null) {
    //    createWindow();
    }
});

app.on('quit', stop);

var io;
var rpc;

var localNames = pjson.load('names_' + config.ccuAddress) || {};
var localNamesIds = {};
var localDevices = pjson.load('devices_' + config.ccuAddress) || {};
var localParamsetDescriptions = pjson.load('paramset-descriptions_' + config.ccuAddress) || {};
var rpcClients = {};

var rpcServer;
var rpcServerBin;
var rpcServerStarted;
var rpcServerBinStarted;
var daemonIndex = {};
var lastEvent = {};

function initRpcClients() {
    log.info('initRpcClients');

    function init(_daemon) {
        var protocol = (config.daemons[_daemon].protocol === 'binrpc' ? 'xmlrpc_bin://' : 'http://');
        var port = (config.daemons[_daemon].protocol === 'binrpc' ? config.rpcListenPortBin : config.rpcListenPort);
        var initUrl = protocol + config.rpcInitIp + ':' + port;
        var ident = config.daemons[_daemon].ident;

        log.debug('RPC -> ' + config.daemons[_daemon].ip + ':' + config.daemons[_daemon].port + ' init ' + initUrl + ' ' + ident);
        rpcClients[_daemon].methodCall('init', [initUrl, ident], function (err, data) {
            lastEvent[_daemon] = (new Date()).getTime();
            log.debug('    <- init response ' + JSON.stringify(err) + ' ' + JSON.stringify(data));
        });
    }

    function pingPong() {
        var now = (new Date()).getTime();
        for (var daemon in config.daemons) {
            var elapsed = now - lastEvent[daemon];
            if (elapsed > (config.daemons[daemon].reinitTimeout || 45000)) {
                log.debug('RPC -> re-init ' + daemon + ' ' + elapsed);
                init(daemon);
            } else if (elapsed > (((config.daemons[daemon].reinitTimeout || 45000) / 1.5) - 1000)) {
                log.debug('RPC -> ping ' + daemon + ' ' + elapsed);
                rpcClients[daemon].methodCall('ping', ['hmm'], function (err, res) {
                    if (err) {
                        log.error('RPC -> ping', err)
                    }
                });
            }
        }
    }

    var count = 0; //Math.floor(Math.random() * 65536);
    for (var daemon in config.daemons) {
        config.daemons[daemon].ident = 'hmm_' + count;


        daemonIndex[config.daemons[daemon].ident] = daemon;

        rpcClients[daemon] = (config.daemons[daemon].protocol === 'binrpc' ? binrpc : xmlrpc).createClient({
            host: config.daemons[daemon].ip,
            port: config.daemons[daemon].port,
            path: '/'
        });


        initRpcServer(config.daemons[daemon].protocol);
        init(daemon);



        count += 1;
    }
    setInterval(pingPong, 15000);
}

function initRpcServer(protocol) {
    let server;
    if (protocol === 'binrpc' && !rpcServerBinStarted) {
        rpcServerBinStarted = true;
        rpcServerBin = binrpc.createServer({host: config.rpcListenIp, port: config.rpcListenPortBin});
        server = rpcServerBin;
        log.debug('binrpc server listening on ' + config.rpcListenIp + ':' + (config.rpcListenPortBin));
    } else if (!rpcServerStarted) {
        rpcServerStarted = true;
        rpcServer = xmlrpc.createServer({host: config.rpcListenIp, port: config.rpcListenPort});
        server = rpcServer;
        log.debug('xmlrpc server listening on ' + config.rpcListenIp + ':' + (config.rpcListenPort));
    } else {
        log.debug(protocol + ' server already started');
        return;
    }

    server.on('NotFound', function (method, params) {
        log.debug('RPC <- undefined method ' + method + ' ' + JSON.stringify(params).slice(0, 80));
    });

    Object.keys(rpcMethods).forEach(m => {
        server.on(m, rpcMethods[m]);
    });
}

const rpcMethods = {
    'system.multicall': function (err, params, callback) {
        const queue = [];
        params[0].forEach(c => {
            const m = c.methodName;
            const p = c.params;
            if (rpcMethods[m]) {
                queue.push(cb => {
                    rpcMethods[m](null, p, cb);
                });
            } else {
                log.debug('RPC <- undefined method ' + m + ' ' + JSON.stringify(p).slice(0, 80));
                queue.push(cb => {
                    cb(null, '');
                });
            }
        });
        async.series(queue, callback);
    },
    event: function (err, params, callback) {
        log.debug('RPC <- event ' + JSON.stringify(params));
        lastEvent[daemonIndex[params[0]]] = (new Date()).getTime();
        ipcRpc.send('rpc', ['event', params]);
        callback(null, '');
    },
    newDevices: function (err, params, callback) {
        log.debug('RPC <- newDevices ' + JSON.stringify(params).slice(0, 80));
        ipcRpc.send('rpc', ['newDevices', params]);
        mainWindow.webContents.send('rpc', ['newDevices', params]);
        var daemon = daemonIndex[params[0]];
        if (!localDevices[daemon]) localDevices[daemon] = {};
        for (var i = 0; i < params[1].length; i++) {
            var dev = params[1][i];
            localDevices[daemon][dev.ADDRESS] = dev;
        }
        pjson.save('devices_' + config.ccuAddress, localDevices);
        callback(null, '');
    },
    deleteDevices: function (err, params, callback) {
        log.debug('RPC <- deleteDevices ' + JSON.stringify(params));
        ipcRpc.send('rpc', ['deleteDevices', params]);
        var daemon = daemonIndex[params[0]];
        if (!localDevices[daemon] || !params[1]) return;

        for (var i = 0; i < params[1].length; i++) {
            var address = params[1][i];
            delete localDevices[daemon][address];
        }
        pjson.save('devices_' + config.ccuAddress, localDevices);
        callback(null, '');
    },
    replaceDevice: function (err, params, callback) {
        log.debug('RPC <- replaceDevice ' + JSON.stringify(params));
        ipcRpc.send('rpc', ['replaceDevice', params]);
        var daemon = daemonIndex[params[0]];
        if (!localDevices[daemon] || !params[1]) return;
        localNames[params[2]] = localNames[params[1]];
        delete localNames[params[1]];
        pjson.save('names_' + config.ccuAddress, localNames);
        delete localDevices[daemon][params[1]];
        pjson.save('devices_' + config.ccuAddress, localDevices);
        callback(null, '');
    },
    listDevices: function (err, params, callback) {
        log.debug('RPC <- listDevices ' + JSON.stringify(params));
        ipcRpc.send('rpc', ['listDevices', params]);
        var daemon = daemonIndex[params[0]];
        var res = [];
        for (var address in localDevices[daemon]) {
            res.push({ADDRESS: address, VERSION: localDevices[daemon][address].VERSION});
        }
        log.debug('RPC -> listDevices response length ' + res.length);
        callback(null, res);
    },
    'system.listMethods': function (err, params, callback) {
        callback(null, Object.keys(rpcMethods));
    }
};

function initIpc() {

    ipcRpc.on('getConfig', function (params, callback) {
        log.debug('getConfig!');
        callback(null, config);
    });

    ipcRpc.on('getNames', function (params, callback) {
        callback(null, localNames);
    });

    ipcRpc.on('setName', function (address, name, callback) {
        localNames[address] = name;
        log.debug('local rename ' + address + ' "' + name + '"');
        if (!address.match(/:/)) {
            localNames[address + ':0'] = name + ':0';
        }

         pjson.save('names_' + config.ccuAddress, localNames, function () {
            if (callback) callback();
         });

    });

    ipcRpc.on('rpc', function (params, callback) {
        log.debug('ipcRpc <', params);
        const daemon = params[0];
        const method = params[1];
        const paramArray = params[2];
        if (!rpcClients[daemon]) {
            log.debug('RPC unknown daemon ' + daemon);
            if (callback) {
                callback(new Error('unknown daemon'), null);
            }
            return;
        }
        if (method) rpcProxy(daemon, method, paramArray, callback);
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
            var ident = dev.TYPE + '/' + dev.VERSION + '/' + params[1];
            if (dev.PARENT_TYPE) ident = dev.PARENT_TYPE + '/' + ident;

            if (localParamsetDescriptions[ident]) {
                log.debug('paramset cache hit ' + ident);
                callback(null, localParamsetDescriptions[ident]);
            } else {
                rpcClients[daemon].methodCall(method, params, function (error, result) {
                    if (!error && result) localParamsetDescriptions[ident] = result;
                    pjson.save('paramset-descriptions_' + config.ccuAddress, localParamsetDescriptions);
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



function rega(script, callback) {
    const url = 'http://' + config.ccuAddress + ':8181/rega.exe';
    log.debug('sending script to', url);
    request({
        method: 'POST',
        url,
        body: script,
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': script.length
        }
    }, (err, res, body) => {
        if (!err && body) {
            const end = body.indexOf('<xml>');
            const data = body.substr(0, end);
            callback(null, data);
        } else {
            callback(err);
        }
    });
}

function regaJson(file, callback) {
    const filepath = path.join(__dirname, 'regascripts', file);
    const script = fs.readFileSync(filepath).toString();
    rega(script, (err, res) => {
        if (err) {
            log.error(err);
        } else {
            try {
                callback(null, JSON.parse(unescape(res)));
            } catch (err) {
                callback(err);
            }
        }
    });
}

function getRegaNames() {
    log.debug('getRegaNames');
    regaJson('devices.fn', (err, res) => {
        if (err) {
            log.debug(err);
        } else {
            log.debug(res);
            Object.keys(res).forEach(address => {
                localNames[address] = res[address].name;
            });
            pjson.save('names_' + config.ccuAddress, localNames);
        }
    })
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
        var initUrl = protocol + config.rpcInitIp + ':' + (config.daemons[daemon].protocol === 'binrpc' ? config.rpcListenPortBin : config.rpcListenPort);

        (function (_daemon, _initUrl) {
            tasks.push(function (cb) {
                log.debug("RPC -> " + config.daemons[_daemon].ip + ':' + config.daemons[_daemon].port + ' init ' + _initUrl + ' ""');
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
