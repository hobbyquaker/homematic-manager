var xmlrpc = require('xmlrpc');

var rpcServer = xmlrpc.createServer({ host: '0.0.0.0', port: 9090 });
console.log('RPC server listening on port 9090');

rpcServer.on('NotFound', function(method, params, callback) {
    console.log('RPC ' + method + ' undefined');
    callback(null, ['']);
});