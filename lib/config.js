var fs =        require('fs');
var path =      require('path');
var mkdirp =    require('mkdirp');

var settingsDefault = {
    "webServerPort": 8081,
    "rpcListenIp": "127.0.0.1",
    "rpcListenPort": "2015",
    "rpcListenPortBin": "2016",
    "daemons": {
        "RF": {
            "type": "BidCos-RF",
            "ip": "127.0.0.1",
            "port": 2001,
            "protocol": 'bin'
        }
    },
    "language": "de"
};


//      determine paths for config and data

var moduleDir = path.join(__dirname, '..');
var baseDir = path.join(moduleDir, '..');
var homeDir = process.env[(process.platform === 'win32') ? 'USERPROFILE' : 'HOME'];

var confDir;
var dataDir;

if (fs.existsSync(path.join(baseDir, 'hmcon.json'))) {
    // Installed inside Hmcon
    confDir = path.join(baseDir, 'etc');
    dataDir = path.join(baseDir, 'var', 'hm-manager');
    mkdirp.sync(confDir);
    mkdirp.sync(dataDir);

// TODO else if (... ioBroker?) { ... config and data in some ioBroker subdir? } //

} else {
    // Standalone installation
    confDir = path.join(homeDir, '.hm-manager');
    dataDir = confDir;
    mkdirp.sync(confDir);
}

var configFile = path.join(confDir, 'hm-manager.json');



//      Read or create config file

var config;

if (!fs.existsSync(configFile)) {
    console.log('creating', configFile);
    fs.writeFileSync(configFile, JSON.stringify(settingsDefault), null, '    ');
    config = settingsDefault;
} else {
    config = JSON.parse(fs.readFileSync(configFile));
}

var pkg = require(path.join(moduleDir, 'package.json'));

config.version =                    pkg.version;
config.dataDir =                    dataDir;
config.pidFile =                    path.join(dataDir, 'hm-manager.pid');
config.namesFile =                  path.join(dataDir, 'names.json');
config.devicesFile =                path.join(dataDir, 'devices.json');
config.paramsetDescriptionsFile =   path.join(dataDir, 'paramsetDescriptions.json');

config.rpcListenPort =              config.rpcListenPort || 2015;
config.rpcListenPortBin =           config.rpcListenPortBin || 2016;

module.exports = config;
