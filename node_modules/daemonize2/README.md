About
=======

Node module for easy creation of daemons for Node 0.8.x and above.

For Node 0.6.x compatibility see daemonize https://github.com/niegowski/node-daemonize

Just write your daemon as plain node.js application
(like `/examples/simple/app.js`) and a simple controller with Daemonize
(like `/examples/simple/ctrl.js`).


Installation
==============
```
$ npm install daemonize2
```


Example
=========

``` js
var daemon = require("daemonize2").setup({
    main: "app.js",
    name: "sampleapp",
    pidfile: "sampleapp.pid"
});

switch (process.argv[2]) {

    case "start":
        daemon.start();
        break;

    case "stop":
        daemon.stop();
        break;

    default:
        console.log("Usage: [start|stop]");
}
```

For more examples see `examples` folder.

Documentation
===============

Daemonize works like standard `require()` but loaded module is
forked to work in background as a daemon.

Keep in mind that `stdin`, `stdout` and `stderr` are redirected
to `/dev/null` so any output from daemon won't display in console.
You need to use file for logging (ie like `/examples/advanced/app.js`).

Also any uncaught exception won't be displayed in the console,
so `process.on("uncaughtException", ...)` should be used to
redirect output to some log file.

## daemonize.setup(options)
Creates new `Daemon` instance. Supported `options`:

* `main` - main application module file to run as daemon (required); `string`
* `name` - daemon name (default: basename of main); `string`
* `pidfile` - pidfile path (default: `/var/run/[name].pid`); `string`
* `user` - name or id of user (default: current); `string`
* `group` - name or id of group (default: current); `string`
* `umask` - file mode mask (default: 0); `number` or `string`
* `silent` - disable printing info to console (default: `false`); `boolean`
* `stopTimeout` - interval (ms) of daemon killing retry (default: `2s`); `number`
* `args` - additional node runtime arguments, ie `--debug`; `array` or `string`
* `argv` - argv for daemon (default: `process.argv.slice(2)`); `array` or `string`

All paths are resolved relative to file that uses "daemonize".

All commandline arguments will be passed to the child process unless
overriden with `argv` option.

## Daemon
Daemon control class. It references controlled daemon.

### Event: "starting"
`function() { }`

Emitted when `start()` is called and if daemon is not already running.

### Event: "started"
`function(pid) { }`

Emitted when daemon successfully started after calling `start()`.

### Event: "running"
`function(pid) { }`

Emitted when `start()` is called and a daemon is already running.

### Event: "stopping"
`function() { }`

Emitted when `stop()` or `kill()` is called and a daemon is running.

### Event: "stopped"
`function(pid) { }`

Emitted when daemon was successfully stopped after calling `stop()`
or `kill()`.

### Event: "notrunning"
`function() { }`

Emitted when `stop()` or `kill()` is called and a deamon is not running.

### Event: "error"
`function(error) { }`

Emitted when `start()` failed. `error` is instance of `Error`.
`error.message` contains information what went wrong.

### daemon.start([listener])
Start daemon asynchronously. Emits `running` in case when daemon is
already running and `starting` when daemon is not running. Then emits
`started` when daemon is successfully started.

Optional `listener` callback is once called on `running`, `started` or `error`
event. The callback gets two arguments `(err, pid)`.

Emits `error` in case of any problem during daemon startup.

### daemon.stop([listener])
Asynchronously stop daemon. Sends `SIGTERM` to daemon every 2s (or time
set in options).

Emits `notrunning` when daemon is not running, otherwise
emits `stopping` and then `stopped` when daemon successfully stopped.

Optional `listener` callback is once called on `notrunning`, `stopped` or
`error` event. The callback gets two arguments `(err, pid)`.

### daemon.kill([listener])
Kill daemon asynchronously. Sends `SIGTERM` and after 2s `SIGKILL` to the
child if needed. Repeats sending `SIGKILL` every 2s untill daemon
stops (interval can be changed in options).

Emits events same as `stop()`.

Optional `listener` callback is same as `stop`.

### daemon.status()
Synchronously returns pid for running daemon or 0 when daemon is not running.

### daemon.sendSignal(signal)
Synchronously sends `signal` to daemon and returns pid of daemon or 0 when
daemon is not running.


Changelog
===========

Daemonize is maintained under the [Semantic Versioning]
(https://github.com/niegowski/semver/blob/master/semver.md)
guidelines.

### 0.4.2 - Jun 09 2013
  - update node version dependency

### 0.4.1 - Jun 09 2013
  - split `args` and `argv` on whitespaces
  - added `umask` option

### 0.4.0 - Jun 05 2013
  - added argv option

### 0.4.0-rc.6 - Nov 28 2012
  - args option to enable node arguments ie --debug
  - fix for: Wrapper seems to eat one argument

### 0.4.0-rc.5 - Aug 28 2012
  - Wrapper is transparent now

### 0.4.0-rc.4 - Aug 16 2012
  - The callback for start, stop and kill handles errors

### 0.4.0-rc.3 - Aug 14 2012
  - Optional callback argument for start, stop and kill

### 0.4.0-rc.2 - Jul 29 2012
  - Passing command line arguments to child process

### 0.4.0-rc.1 - Jul 29 2012
  - Daemonize forked as Daemonize2 for Node 0.8.x compatibility
  - Removed native module for setsid - using child_process.spawn detached
  - Passing options via ipc instead of command line arguments
  - Rethrowing wrapper exceptions via ipc

### 0.3.2 - Jul 29 2012
  - Daemonize is compatible only with Node 0.6.x

### 0.3.1 - Apr 2 2012

### 0.3.0 - Jan 29 2012
  - Daemon emits Events instead of console.log()
  - API change - events in place of callbacks

### 0.2.2 - Jan 27 2012
  - root priviledges no longer required
  - changed error exit codes
  - try to remove pidfile on daemon stop
  - configurable timeouts for start monitoring and killing
  - closing FD-s on daemon start
  - better examples

### 0.2.1 - Jan 26 2012
  - fix for calling callback in stop/kill when process is not running

### 0.2.0 - Jan 26 2012
  - code refactor
  - stop listening for uncaughtException
  - logfile removed

### 0.1.2 - Jan 25 2012
  - fixed stdout, stderr replacement
  - checking for daemon main module presence
  - signals change (added custom signals)
  - better log messages
  - gracefull terminate in example app
  - close logfile on process exit

### 0.1.1 - Jan 24 2012
  - print stacktrace for uncaughtException

### 0.1.0 - Jan 24 2012
  - First release


License
=========

(The MIT License)

Copyright (c) 2012 Kuba Niegowski

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
