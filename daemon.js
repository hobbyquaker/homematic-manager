#!/usr/bin/env node
/**
 *      homematic-manager daemon
 *
 *  Copyright (c) 2014, 2015 Anli, Hobbyquaker
 *
 *  CC BY-NC-SA 4.0 http://creativecommons.org/licenses/by-nc-sa/4.0/
 *
 */

var config = require('./lib/config.js');

var daemon = require('daemonize2').setup({
    main: 'main.js',
    name: 'hm-manager',
    pidfile: config.pidFile
});

switch (process.argv[2]) {

    case 'start':
        daemon.start();
        break;

    case 'stop':
        daemon.stop();
        break;

    case 'kill':
        daemon.kill();
        break;

    case 'restart':
        daemon.stop(function(err) {
            daemon.start();
        });
        break;

    case 'status':
        var pid = daemon.status();
        if (pid)
            console.log('Daemon running. PID: ' + pid);
        else
            console.log('Daemon is not running.');
        break;

    default:
        console.log('Usage: [start|stop|kill|restart|status]');
        break;
}
