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

var constants = require("./constants");


// wrapper is spawned with no stdio attached so redirect exceptions via ipc
var exceptionHandler = null;
process.on("uncaughtException", exceptionHandler = function(err) {
    process.send({type: "error", error: err.stack || err.message});
    process.disconnect();
    process.exit(1);
});

// now sit and wait for options via ipc
process.on("message", function(message) {

    if (message.type == "init") {
        init(message.options);
    }
});

var init = function(options) {

    // validate options
    if (!options.main) {
        process.exit(constants.exitCodes.argMainRequired[0]);
    }

    // check if main is resolvable
    try {
        require.resolve(options.main);
    }
    catch (ex) {
        process.exit(constants.exitCodes.mainNotFound[0]);
    }

    // rename process
    if (options.name)
        process.title = options.name;

    // change the file mode mask
    process.umask(options.umask);

    // change working directory
    try {
        process.chdir(options.cwd || "/");
    }
    catch (ex) {
        process.exit(constants.exitCodes.chdirFailed[0]);
    }

    // change group id
    if (options.group) {
        try {
            process.setgid(options.group);
        }
        catch (ex) {
            process.exit(ex.code == "EPERM"
                            ? constants.exitCodes.setgidNoPriv[0]
                            : constants.exitCodes.setgidFailed[0]
                        );
        }
    }

    // change user id
    if (options.user) {
        try {
            process.setuid(options.user);
        }
        catch (ex) {
            process.exit(ex.code == "EPERM"
                            ? constants.exitCodes.setuidNoPriv[0]
                            : constants.exitCodes.setuidFailed[0]
                        );
        }
    }

    // make wrapper transparent
    process.argv = [
        process.argv[0],
        options.main
    ].concat(process.argv.slice(2));

    // run main module
    var setup = require(options.main);

    // pass options to exported function
    if (typeof setup == "function") setup(options);

    // stop monitoring uncaughtException
    process.removeListener("uncaughtException", exceptionHandler);

    // close IPC to parent process
    process.disconnect();

};
