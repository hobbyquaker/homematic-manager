#!/usr/bin/env node

/**
 * The two loopback services the optional login of D-32 asks, stubbed for the container replay.
 *
 * A CCU answers these; a Debian container does not, so `container-test.sh` starts this with the
 * addon's *bundled* node before it switches the addon to `HMM_AUTH_MODE=rega`:
 *
 *   ReGaHSS script interface   http://127.0.0.1:8183/rega.exe   (ISO-8859-1, `<xml>` variable block)
 *   authentication daemon      udp 127.0.0.1:1998               ("user:password" -> "1" or "0")
 *
 * It answers exactly like the real ones for the one script the login sends: an object variable
 * comes back as the object's `Name()`, which is what "this user exists" looks like, and an unknown
 * user leaves `user` empty. Every other script gets an empty JSON array as its output, so the
 * backend's own ReGa client (`getChannels`) sees an empty CCU and degrades instead of hanging.
 *
 * The default password contains a colon on purpose: the datagram splits on the first unescaped
 * one, and that escaping is the part most likely to be got wrong.
 */

import {createSocket} from 'node:dgram';
import {createServer} from 'node:http';

const USER = process.env['HMM_STUB_USER'] ?? 'ccuadmin';
const PASSWORD = process.env['HMM_STUB_PASSWORD'] ?? 'a:b\\c';
const LEVEL = process.env['HMM_STUB_LEVEL'] ?? '8';
const REGA_PORT = Number(process.env['HMM_STUB_REGA_PORT'] ?? 8183);
const AUTH_PORT = Number(process.env['HMM_STUB_AUTH_PORT'] ?? 1998);

/** The same escaping the daemon expects, so the expected datagram can be built here. */
function escapeField(value) {
    return value.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
}

createServer((request, response) => {
    let body = '';
    request.setEncoding('latin1');
    request.on('data', (chunk) => {
        body += chunk;
    });
    request.on('end', () => {
        const match = /Get\("(.*?)"\)/.exec(body);
        let payload;
        if (match) {
            const name = match[1].replace(/\\(.)/g, '$1');
            payload =
                name === USER ? `<xml><user>${name}</user><level>${LEVEL}</level></xml>` : '<xml><user></user></xml>';
            console.log(`rega stub: lookup ${JSON.stringify(name)} -> ${name === USER ? 'found' : 'unknown'}`);
        } else {
            payload = '[]<xml></xml>';
        }
        const data = Buffer.from(payload, 'latin1');
        response.writeHead(200, {'Content-Type': 'text/plain; charset=iso-8859-1', 'Content-Length': data.length});
        response.end(data);
    });
}).listen(REGA_PORT, '127.0.0.1', () => {
    console.log(`rega stub on 127.0.0.1:${REGA_PORT}`);
});

const socket = createSocket('udp4');
socket.on('message', (message, remote) => {
    const seen = message.toString('latin1');
    const expected = `${escapeField(USER)}:${escapeField(PASSWORD)}`;
    const ok = seen === expected;
    console.log(`auth stub: ${JSON.stringify(seen)} -> ${ok ? '1' : '0'}`);
    socket.send(ok ? '1' : '0', remote.port, remote.address);
});
socket.bind(AUTH_PORT, '127.0.0.1', () => {
    console.log(`auth stub on udp 127.0.0.1:${AUTH_PORT}`);
});
