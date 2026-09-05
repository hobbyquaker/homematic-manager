#!/usr/bin/env node

/**
 * A WebSocket client for the container test, run by the *bundled* node from inside the installed
 * addon, so it uses the very `ws` the package ships.
 *
 *   node ws-probe.mjs <url> <cookie header|-> [idle seconds]
 *
 * It opens the API socket through the CCU's lighttpd, sends one `ApiFrame` request, optionally sits
 * idle for a while (the interesting case: longer than lighttpd's 60 s `server.max-read-idle`, which
 * the host's 25 s ping is there to survive) and then sends a second request. Every step is printed
 * as one line so the shell test can assert on it:
 *
 *   open / res:<method> / idle:<seconds> / alive / closed:<code> / error:<message>
 *
 * curl cannot do this: it can perform the upgrade handshake, but it never answers a WebSocket ping,
 * so it proves nothing about an idle connection.
 */

import WebSocket from 'ws';

const [url, cookieArgument = '-', idleArgument = '0'] = process.argv.slice(2);
const cookie = cookieArgument === '-' ? undefined : cookieArgument;
const idleMs = Number(idleArgument) * 1000;

if (!url) {
    console.error('usage: ws-probe.mjs <url> <cookie|-> [idle seconds]');
    process.exit(2);
}

const socket = new WebSocket(url, cookie === undefined ? {} : {headers: {Cookie: cookie}});
const pending = new Map();
let nextId = 1;

const timeout = setTimeout(() => {
    console.log('error:timeout');
    process.exit(1);
}, idleMs + 60_000);

socket.on('unexpected-response', (_request, response) => {
    console.log(`error:http ${response.statusCode}`);
    process.exit(1);
});

socket.on('error', (error) => {
    console.log(`error:${error.message}`);
    process.exit(1);
});

socket.on('close', (code) => {
    console.log(`closed:${code}`);
    process.exit(1);
});

socket.on('message', (data) => {
    const frame = JSON.parse(String(data));
    if (frame.t === 'res' || frame.t === 'err') {
        const method = pending.get(frame.id);
        pending.delete(frame.id);
        console.log(frame.t === 'res' ? `res:${method}` : `err:${method}:${frame.e?.message ?? ''}`);
        if (pending.size === 0) {
            step();
        }
    }
});

function request(method) {
    const id = nextId;
    nextId += 1;
    pending.set(id, method);
    socket.send(JSON.stringify({t: 'req', id, m: method, p: []}));
}

let phase = 0;

function step() {
    phase += 1;
    if (phase === 1) {
        if (idleMs <= 0) {
            finish();
            return;
        }
        console.log(`idle:${idleMs / 1000}`);
        setTimeout(() => {
            request('config.get');
        }, idleMs);
        return;
    }
    console.log('alive');
    finish();
}

function finish() {
    clearTimeout(timeout);
    socket.removeAllListeners('close');
    socket.close();
    process.exit(0);
}

socket.on('open', () => {
    console.log('open');
    request('config.get');
});
