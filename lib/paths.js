var fs = require('fs');
var mkdirp = require('mkdirp');

var confDir;
var dataDir;

if (fs.existsSync('/opt/hm/')) {
    confDir = '/opt/hm/etc/';
    dataDir = '/opt/hm/var/hm-manager/';
} else {
    var homeDir = process.env[(process.platform === 'win32') ? 'USERPROFILE' : 'HOME'];
    confDir = homeDir + '/.hm-manager/';
    dataDir = homeDir + '/.hm-manager/';
}

mkdirp.sync(confDir);
mkdirp.sync(dataDir);

module.exports = {
    confDir: confDir,
    dataDir: dataDir
};