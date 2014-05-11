// Copyright (c) 2012 Kuba Niegowski
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

"use strict";

var fs = require("fs"),
    path = require("path"),
    util = require("util"),
    constants = require("./constants"),
    spawn = require("child_process").spawn,
    EventEmitter = require("events").EventEmitter;


exports.setup = function(options) {
    return new Daemon(options);
};

var Daemon = function(options) {
    EventEmitter.call(this);

    if (!options.main)
        throw new Error("Expected 'main' option for daemonize");

    var dir = path.dirname(module.parent.filename),
        main = path.resolve(dir, options.main),
        name = options.name || path.basename(main, ".js");

    if (!this._isFile(main))
        throw new Error("Can't find daemon main module: '" + main + "'");

    // normalize options
    this._options = {};

    // shallow copy
    for (var arg in options)
        this._options[arg] = options[arg];

    this._options.main = main;
    this._options.name = this.name = name;

    this._options.pidfile = options.pidfile
                        ? path.resolve(dir, options.pidfile)
                        : path.join("/var/run", name + ".pid");

    this._options.user = options.user || "";
    this._options.group = options.group || "";

    if (typeof options.umask == "undefined")
        this._options.umask = 0;
    else if (typeof options.umask == "string")
        this._options.umask = parseInt(options.umask);

    this._options.args = this._makeArray(options.args);
    this._options.argv = this._makeArray(options.argv || process.argv.slice(2));

    this._stopTimeout = options.stopTimeout || 2000;

    this._childExitHandler = null;
    this._childDisconnectHandler = null;
    this._childDisconnectTimer = null;

    if (!options.silent)
        this._bindConsole();
};
util.inherits(Daemon, EventEmitter);

Daemon.prototype.start = function(listener) {

    // make sure daemon is not running
    var pid = this._sendSignal(this._getpid());

    if (pid) {
        this.emit("running", pid);
        if (listener) listener(null, pid);
        return this;
    }

    // callback for started and error
    if (listener) {
        var errorFunc, startedFunc;

        this.once("error", errorFunc = function(err) {
            this.removeListener("started", startedFunc);
            listener(err, 0);
        }.bind(this));

        this.once("started", startedFunc = function(pid) {
            this.removeListener("error", errorFunc);
            listener(null, pid);
        }.bind(this));
    }

    this.emit("starting");

    // check whether we have right to write to pid file
    var err = this._savepid("");
    if (err) {
        this.emit("error", new Error("Failed to write pidfile (" + err + ")"));
        return this;
    }

    // spawn child process
    var child = spawn(process.execPath, (this._options.args || []).concat([
            __dirname + "/wrapper.js"
        ]).concat(this._options.argv), {
            env: process.env,
            stdio: ["ignore", "ignore", "ignore", "ipc"],
            detached: true
        }
    );
    pid = child.pid;

    // save pid
    this._savepid(pid);

    // rethrow childs's exceptions
    child.on("message", function(msg) {
        if (msg.type == "error")
            throw new Error(msg.error);
    });

    // wrapper.js will exit with special exit codes
    child.once("exit", this._childExitHandler = function(code, signal) {

        child.removeListener("disconnect", this._childDisconnectHandler);
        clearTimeout(this._childDisconnectTimer);

        if (code > 0) {
            this.emit("error", new Error(
                code > 1
                ? constants.findExitCode(code)
                : "Module '" + this._options.main + "' stopped unexpected"
            ));
        } else {
            this.emit("stopped");
        }

    }.bind(this));

    // check if it is still running when ipc closes
    child.once("disconnect", this._childDisconnectHandler = function() {

        // check it in 100ms in case this is child's exit
        this._childDisconnectTimer = setTimeout(function() {

            child.removeListener("exit", this._childExitHandler);

            if (this._sendSignal(pid)) {
                this.emit("started", pid);

            } else {
                this.emit("error", new Error("Daemon failed to start"));
            }

        }.bind(this), 100);
    }.bind(this));

    // trigger child initialization
    child.send({type: "init", options: this._options});

    // remove child from reference count to make parent process exit
    child.unref();

    return this;
};

Daemon.prototype.stop = function(listener, signals, timeout) {
    return this._kill(signals || ["SIGTERM"], timeout || 0, listener);
};

Daemon.prototype.kill = function(listener, signals, timeout) {
    return this._kill(signals || ["SIGTERM", "SIGKILL"], timeout || 0, listener);
};

Daemon.prototype.status = function() {
    return this._sendSignal(this._getpid());
};

Daemon.prototype.sendSignal = function(signal) {
    return this._sendSignal(this._getpid(), signal);
};

Daemon.prototype._makeArray = function(args) {
    if (typeof args == "undefined") return [];
    return typeof args == "string" ? args.split(/\s+/) : args;
};

Daemon.prototype._getpid = function() {

    try {
        return parseInt(fs.readFileSync(this._options.pidfile));
    }
    catch (err) {
    }

    return 0;
};

Daemon.prototype._savepid = function(pid) {

    try {
        fs.writeFileSync(this._options.pidfile, pid + "\n");
    }
    catch (ex) {
        return ex.code;
    }
    return "";
};

Daemon.prototype._sendSignal = function(pid, signal) {

    if (!pid) return 0;

    try {
        process.kill(pid, signal || 0);
        return pid;
    }
    catch (err) {
    }

    return 0;
};

Daemon.prototype._kill = function(signals, timeout, listener) {

    var pid = this._sendSignal(this._getpid());

    if (!pid) {
        this.emit("notrunning");
        if (listener) listener(null, 0);
        return this;
    }

    if (listener) {
        this.once("stopped", function(pid) {
            listener(null, pid);
        });
    }

    this.emit("stopping");

    this._tryKill(pid, signals, timeout, function(pid) {

        // try to remove pid file
        try {
            fs.unlinkSync(this._options.pidfile);
        }
        catch (ex) {}

        this.emit("stopped", pid);

    }.bind(this));

    return this;
};

Daemon.prototype._tryKill = function(pid, signals, timeout, callback) {

    if (!this._sendSignal(pid, signals.length > 1 ? signals.shift() : signals[0])) {
        if (callback) callback(pid);
        return true;
    }

    setTimeout(this._tryKill.bind(this, pid, signals, timeout, callback), timeout || this._stopTimeout);
    return false;
};

Daemon.prototype._isFile = function(path) {

    try {
        var stat = fs.statSync(path);
        if (stat && !stat.isDirectory())
            return true;
    }
    catch (err) {
    }

    return false;
};

Daemon.prototype._bindConsole = function() {

    this
        .on("starting", function() {
            console.log("Starting " + this.name + " daemon...");
        })
        .on("started", function(pid) {
            console.log(this.name + " daemon started. PID: " + pid);
        })
        .on("stopping", function() {
            console.log("Stopping " + this.name + " daemon...");
        })
        .on("stopped", function(pid) {
            console.log(this.name + " daemon stopped.");
        })
        .on("running", function(pid) {
            console.log(this.name + " daemon already running. PID: " + pid);
        })
        .on("notrunning", function() {
            console.log(this.name + " daemon is not running");
        })
        .on("error", function(err) {
            console.log(this.name + " daemon failed to start:  " + err.message);
        });

};
