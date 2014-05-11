
var fs = require("fs"),
    http = require("http"),
    cluster = require('cluster');


var config = loadConfig(),
    logStream = openLog("/tmp/sampleapp.log");


function loadConfig() {
    return JSON.parse(fs.readFileSync(__dirname + "/config.json"));
}

function openLog(logfile) {
    return fs.createWriteStream(logfile, {
        flags: "a", encoding: "utf8", mode: 0644
    });
}

function log(msg) {
    logStream.write(msg + "\n");
}


log("Starting...");


if (cluster.isMaster) {
    log("Forking workers")

    var cpus = require('os').cpus().length;
    for (var i = 0; i < cpus; i++) {
        cluster.fork();
    }
    return;
}

log("Initiating worker")




var server = http.createServer(function(req, res) {
    log("Request from " + req.connection.remoteAddress);

    res.writeHead(200, {
        "Content-Type": "text/plain"
    });
    res.end(config.msg);

}).listen(8080);

log("Started.");


process.on("uncaughtException", function(err) {
    log(err.stack);
});

process.on("SIGUSR1", function() {
    log("Reloading...");

    config = loadConfig();

    log("Reloaded.");
});

process.once("SIGTERM", function() {
    log("Stopping...");

    server.on("close", function() {
        log("Stopped.");

        logStream.on("close", function() {
            process.exit(0);
        }).end();

    }).close();
});
