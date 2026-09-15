#!/usr/bin/env node

/**
 * An openccu-lite box, as far as the addon's session check asks one, for the container replay (B-32).
 *
 * `container-test.sh` starts this with the addon's *bundled* node and points the installed addon at it
 * with `HMM_AUTH_MODE=occulite` and `HMM_OCCULITE_URL`. The backend then has to `fetch` both answers
 * before it lets a session in, so a node started with flags that break `fetch` - 3.0.0-beta.16's
 * `--lite-mode` switched off the WebAssembly its HTTP parser runs on - fails the login visibly:
 *
 *   GET /api/meta/v1/enums   200 for `Authorization: Bearer <sid>` with the live session, 401 otherwise
 *   GET /api/auth/v1/state   `{"authenticated":true,"user":…,"role":"admin","sid":…}` for it, not authenticated otherwise
 *
 * Every request is logged, so the test can see the backend's requests arrive. Anything else is a 404.
 */

import {createServer} from 'node:http';

const PORT = Number(process.env['HMM_STUB_OCCULITE_PORT'] ?? 18181);
const SID = process.env['HMM_STUB_SID'] ?? 'abcdefgh12';
const USER = process.env['HMM_STUB_USER'] ?? 'labuser';

createServer((request, response) => {
    const live = request.headers.authorization === `Bearer ${SID}`;
    const path = (request.url ?? '').split('?')[0];
    console.log(`occulite stub: ${request.method} ${path} ${live ? 'live' : 'unknown'}`);
    const send = (status, body) => {
        const data = Buffer.from(JSON.stringify(body));
        response.writeHead(status, {'Content-Type': 'application/json', 'Content-Length': data.length});
        response.end(data);
    };
    if (request.method === 'GET' && path === '/api/meta/v1/enums') {
        if (live) {
            send(200, {rooms: [], functions: []});
        } else {
            send(401, {error: 'unauthorized'});
        }
    } else if (request.method === 'GET' && path === '/api/auth/v1/state') {
        // `sid` as occulited writes it for a session that is not a token: the settings page's
        // header check wants the state to name the very session it asked about (task 50)
        send(200, live ? {authenticated: true, user: USER, role: 'admin', sid: SID} : {authenticated: false});
    } else {
        send(404, {error: 'not found'});
    }
}).listen(PORT, '127.0.0.1', () => {
    console.log(`occulite stub on 127.0.0.1:${PORT}`);
});
