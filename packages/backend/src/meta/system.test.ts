/**
 * The connection to an openccu-lite system on occulite-client (task 72): the profile's certificate
 * trust on the package's transport (B-67), the detection, the errors the UI knows, the change
 * stream and the credentials.
 *
 * The TLS half runs against a real server on the loopback. The certificates in `test/tls/` are a
 * test CA (`hmm-test-ca`) and a leaf for `localhost` only, valid for a hundred years; the server
 * sends the leaf and the CA, as a system that sends its root does. Reached as `127.0.0.1` the name
 * does not fit, which is the "given by IP" case of B-67.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import https from 'node:https';
import net, {type AddressInfo} from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {OccuLiteError, fetchTransport, type Transport} from 'occulite-client';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import {MetaError} from '@homematic-manager/core';

import {normaliseSid, readLocalToken} from './service.js';
import {
    SystemLink,
    certificateProblemOf,
    detectSystem,
    hmipPairingOf,
    httpsRedirectTarget,
    metaErrorOf,
    metaRefusal,
    normaliseFingerprint,
    systemTransport,
    readsDevices,
    tierAwareTransport,
} from './system.js';

const TLS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../test/tls');
const CA = fs.readFileSync(path.join(TLS, 'ca.pem'), 'utf8');
const LEAF = fs.readFileSync(path.join(TLS, 'server.pem'), 'utf8');
const KEY = fs.readFileSync(path.join(TLS, 'server.key'), 'utf8');
const LEAF_FINGERPRINT =
    '95:9F:12:9D:4A:80:07:21:E8:D5:0C:29:F8:48:C9:B6:21:DC:56:EB:B8:18:59:FE:6C:5A:9B:8C:40:FA:2D:2F';
const VERSION = {api: 'meta', version: 1, format: 1, revision: 3, implementation: 'test'};

let server: https.Server;
let port = 0;
let handshakes = 0;
const seen: {method: string; url: string; authorization: string | undefined; body: string}[] = [];

beforeAll(async () => {
    server = https.createServer({cert: `${LEAF}${CA}`, key: KEY}, (request, response) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk: string) => {
            body += chunk;
        });
        request.on('end', () => {
            seen.push({
                method: request.method ?? '',
                url: request.url ?? '',
                authorization: request.headers.authorization,
                body,
            });
            if (request.url === '/api/meta/v1/version') {
                response.writeHead(200, {'Content-Type': 'application/json'});
                response.end(JSON.stringify(VERSION));
            } else if (request.url === '/slow') {
                // never answers; the caller's signal ends it
            } else {
                response.writeHead(201, {'Content-Type': 'text/plain', 'X-Twice': ['a', 'b']});
                response.end(`echo ${body}`);
            }
        });
    });
    server.on('secureConnection', () => {
        handshakes += 1;
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
});

const at = (host: string, route: string): string => `https://${host}:${String(port)}${route}`;

describe("the profile's trust on the package's transport (B-67)", () => {
    it('refuses a certificate nothing trusts before the request is written, and says what it was', async () => {
        const before = seen.length;
        const url = at('localhost', '/x');
        const error: unknown = await systemTransport(undefined)
            .request('GET', url, {Authorization: 'Bearer secret'})
            .catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(OccuLiteError);
        const problem = certificateProblemOf(error, url);
        expect(problem?.url).toBe(`https://localhost:${String(port)}`);
        expect(problem?.code).toMatch(/SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_GET_ISSUER_CERT/);
        expect(problem?.certificate).toMatchObject({
            subject: 'localhost',
            issuer: 'hmm-test-ca',
            fingerprint256: LEAF_FINGERPRINT,
            altNames: 'DNS:localhost',
        });
        expect(problem?.certificate.validTo).toContain('2126');
        expect(problem?.ca?.subject).toBe('hmm-test-ca');
        expect(problem?.ca?.pem.replace(/\s/g, '')).toBe(CA.replace(/\s/g, ''));
        // not a byte of the request - and so not the token - reached the server
        expect(seen.length).toBe(before);
    });

    it('takes a trusted CA for the chain, with the name checked as usual', async () => {
        const transport = systemTransport({cas: [CA]});
        const answer = await transport.request('GET', at('localhost', '/api/meta/v1/version'), {});
        expect(answer.status).toBe(200);
        expect(JSON.parse(answer.body)).toEqual(VERSION);

        const url = at('127.0.0.1', '/api/meta/v1/version');
        const byIp = await transport.request('GET', url, {}).catch((caught: unknown) => caught);
        expect(certificateProblemOf(byIp, url)?.code).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
    });

    it('takes a trusted certificate by its fingerprint, however it is spelt and whatever name it is reached by', async () => {
        const transport = systemTransport({certificates: [LEAF_FINGERPRINT.toLowerCase().replace(/:/g, '')]});
        expect((await transport.request('GET', at('127.0.0.1', '/api/meta/v1/version'), {})).status).toBe(200);
    });

    it('takes any of several trusted certificates and CAs, and remembers the one that worked', async () => {
        const transport = systemTransport({
            certificates: ['AA:BB', LEAF_FINGERPRINT],
            cas: [CA],
        });
        // by IP the chain's name check fails and the pin holds
        expect((await transport.request('GET', at('127.0.0.1', '/api/meta/v1/version'), {})).status).toBe(200);
        const before = handshakes;
        expect((await transport.request('GET', at('127.0.0.1', '/api/meta/v1/version'), {})).status).toBe(200);
        // the second request went straight to the pin that worked: one handshake, not three
        expect(handshakes - before).toBe(1);
    });

    it('reports the refusal of the chain when nothing it trusts fits', async () => {
        const url = at('localhost', '/x');
        const error: unknown = await systemTransport({certificates: ['AA:BB']})
            .request('GET', url, {})
            .catch((caught: unknown) => caught);
        expect(certificateProblemOf(error, url)?.code).toMatch(/SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_GET_ISSUER_CERT/);
    });

    it('sends the method, the headers and the body, and hands back status, headers and body', async () => {
        const answer = await systemTransport({certificates: [LEAF_FINGERPRINT]}).request(
            'PUT',
            at('127.0.0.1', '/write?x=1'),
            {Authorization: 'Bearer t', 'Content-Type': 'application/json'},
            '{"a":1}',
        );
        expect(answer.status).toBe(201);
        expect(answer.headers['x-twice']).toBe('a, b');
        expect(answer.body).toBe('echo {"a":1}');
        expect(seen.at(-1)).toEqual({method: 'PUT', url: '/write?x=1', authorization: 'Bearer t', body: '{"a":1}'});
    });

    it('ends a request when its signal fires', async () => {
        const error: unknown = await systemTransport({certificates: [LEAF_FINGERPRINT]})
            .request('GET', at('127.0.0.1', '/slow'), {}, undefined, AbortSignal.timeout(200))
            .catch((caught: unknown) => caught);
        expect(error).toMatchObject({code: 'timeout'});
    });

    it('gives up on a host that swallows the handshake when the signal fires, not minutes later', async () => {
        // a TCP port that accepts and never says a word: the TLS handshake never completes
        const held: net.Socket[] = [];
        const silent = net.createServer((socket) => held.push(socket));
        await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
        try {
            const url = `https://127.0.0.1:${String((silent.address() as AddressInfo).port)}`;
            const started = Date.now();
            expect(await detectSystem(systemTransport({certificates: [LEAF_FINGERPRINT]}), url, 100)).toEqual({
                baseUrl: url,
                answered: false,
                reason: 'timeout',
            });
            expect(Date.now() - started).toBeLessThan(2000);
        } finally {
            for (const socket of held) {
                socket.destroy();
            }
            await new Promise((resolve) => silent.close(resolve));
        }
    });

    it('fails a host that is not there with the socket error, not a certificate problem', async () => {
        // a port that was just free: refused at once (port 1 is not refused everywhere - WSL)
        const probe = https.createServer();
        await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
        const free = (probe.address() as AddressInfo).port;
        await new Promise((resolve) => probe.close(resolve));
        const url = `https://127.0.0.1:${String(free)}/x`;
        const error: unknown = await systemTransport(undefined)
            .request('GET', url, {})
            .catch((caught: unknown) => caught);
        expect(error).toMatchObject({code: 'unreachable', reason: 'refused'});
        expect(certificateProblemOf(error, url)).toBeUndefined();
    });

    it('spells every fingerprint the same way', () => {
        expect(normaliseFingerprint('ab cd:EF')).toBe('AB:CD:EF');
    });
});

/** A `fetch` that answers by URL, for the detection's cases. */
function fetchOf(answer: (url: string) => Response | Promise<Response>): {
    fetch: typeof globalThis.fetch;
    urls: string[];
} {
    const urls: string[] = [];
    const fetchImpl = ((input: string | URL) => {
        urls.push(String(input));
        return Promise.resolve(answer(String(input)));
    }) as unknown as typeof globalThis.fetch;
    return {fetch: fetchImpl, urls};
}

const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});

describe('the rpc tiers (occulite-client B-3)', () => {
    it('knows that a higher tier reads devices too', () => {
        expect(readsDevices(['rpc:admin', 'meta:write'])).toBe(true);
        expect(readsDevices(['rpc:operate'])).toBe(true);
        expect(readsDevices(['*'])).toBe(true);
        expect(readsDevices(['meta:read'])).toBe(false);
        expect(readsDevices([])).toBe(false);
    });

    it('spells rpc:read out in the auth state for the client, and touches nothing else', async () => {
        const answers: Record<string, unknown> = {
            'http://box/api/auth/v1/state': {authenticated: true, scopes: ['rpc:admin', 'meta:write']},
            'http://box/api/meta/v1/version': {api: 'meta', version: 1},
        };
        const seen: string[] = [];
        const inner: Transport = {
            request: (method, url) => {
                seen.push(`${method} ${url}`);
                return Promise.resolve({status: 200, headers: {}, body: JSON.stringify(answers[url] ?? null)});
            },
            stream: () => Promise.reject(new Error('not here')),
        };
        const transport = tierAwareTransport(inner);
        const state = await transport.request('GET', 'http://box/api/auth/v1/state', {}, undefined, undefined);
        expect(JSON.parse(state.body)).toEqual({authenticated: true, scopes: ['rpc:admin', 'meta:write', 'rpc:read']});
        const version = await transport.request('GET', 'http://box/api/meta/v1/version', {}, undefined, undefined);
        expect(JSON.parse(version.body)).toEqual({api: 'meta', version: 1});
        // a token that reads names only stays what it is
        answers['http://box/api/auth/v1/state'] = {authenticated: true, scopes: ['meta:read']};
        const names = await transport.request('GET', 'http://box/api/auth/v1/state', {}, undefined, undefined);
        expect(JSON.parse(names.body)).toEqual({authenticated: true, scopes: ['meta:read']});
        expect(seen).toHaveLength(3);
    });
});

describe('the detection', () => {
    it('answers with the version a system reports, and the URL it answered at', async () => {
        const box = fetchOf(() => json(VERSION));
        expect(await detectSystem(fetchTransport(box.fetch), 'http://box/')).toEqual({
            version: VERSION,
            baseUrl: 'http://box/',
            answered: true,
        });
        expect(box.urls).toEqual(['http://box/api/meta/v1/version']);
    });

    it('answers no version for a CCU, which 404s or serves HTML, and for JSON that is not this API', async () => {
        for (const answer of [
            new Response('not found', {status: 404}),
            new Response('<html>WebUI</html>', {status: 200}),
            json({hello: 'world'}),
            json({...VERSION, version: 'one'}),
        ]) {
            const found = await detectSystem(fetchTransport(fetchOf(() => answer).fetch), 'http://ccu');
            expect(found).toEqual({baseUrl: 'http://ccu', answered: true});
        }
    });

    it('answers no version when the host does not answer at all, and never throws', async () => {
        const refused = fetchTransport(() => Promise.reject(new TypeError('fetch failed')));
        expect(await detectSystem(refused, 'http://gone')).toEqual({
            baseUrl: 'http://gone',
            answered: false,
            reason: 'error',
        });
        const silent = fetchTransport(
            (_input, init) =>
                new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => {
                        reject(new DOMException('aborted', 'AbortError'));
                    });
                }),
        );
        expect(await detectSystem(silent, 'http://silent', 50)).toEqual({
            baseUrl: 'http://silent',
            answered: false,
            reason: 'timeout',
        });
    });

    it('follows the system to https:// and hands back the base URL there', async () => {
        const box = fetchOf((url) =>
            url.startsWith('http://')
                ? new Response(null, {status: 301, headers: {Location: 'https://10.0.0.5/api/meta/v1/version'}})
                : json(VERSION),
        );
        const found = await detectSystem(fetchTransport(box.fetch), 'http://10.0.0.5');
        expect(found).toEqual({version: VERSION, baseUrl: 'https://10.0.0.5', answered: true});
        expect(box.urls).toEqual(['http://10.0.0.5/api/meta/v1/version', 'https://10.0.0.5/api/meta/v1/version']);
    });

    it('does not follow a redirect anywhere else - a login page is not the API', async () => {
        const box = fetchOf(() => new Response(null, {status: 302, headers: {Location: '/login.htm'}}));
        expect(await detectSystem(fetchTransport(box.fetch), 'http://ccu')).toEqual({
            baseUrl: 'http://ccu',
            answered: true,
        });
        expect(box.urls.length).toBe(1);
    });

    it('keeps a path prefix of a proxy in the base URL', () => {
        expect(
            httpsRedirectTarget('https://proxy/lite/api/meta/v1/version', 'http://proxy/lite/api/meta/v1/version'),
        ).toEqual({
            url: 'https://proxy/lite/api/meta/v1/version',
            baseUrl: 'https://proxy/lite',
        });
        expect(httpsRedirectTarget(undefined, 'http://x/api/meta/v1/version')).toBeUndefined();
        expect(httpsRedirectTarget('http://x/api/meta/v1/version', 'http://x/api/meta/v1/version')).toBeUndefined();
    });

    it('says what was wrong with the certificate at the https:// end', async () => {
        const found = await detectSystem(systemTransport(undefined), `https://127.0.0.1:${String(port)}`, 2000);
        expect(found.version).toBeUndefined();
        expect(found.certificate).toMatchObject({
            url: `https://127.0.0.1:${String(port)}`,
            certificate: {fingerprint256: LEAF_FINGERPRINT},
        });
    });

    it('finds the system once its certificate is trusted', async () => {
        const found = await detectSystem(
            systemTransport({certificates: [LEAF_FINGERPRINT]}),
            `https://127.0.0.1:${String(port)}`,
            2000,
        );
        expect(found.version?.implementation).toBe('test');
        expect(found.certificate).toBeUndefined();
    });

    it('keeps the hmip pairing fact in its defined shape and drops anything else', async () => {
        const fact = {keyserver_mode: 'LOCAL', device_keys: 2, offline_pairing: true};
        const found = await detectSystem(
            fetchTransport(fetchOf(() => json({...VERSION, hmip: fact})).fetch),
            'http://box',
        );
        expect(found.version?.hmip).toEqual(fact);
        const odd = await detectSystem(
            fetchTransport(fetchOf(() => json({...VERSION, hmip: {keyserver_mode: 'CLOUD'}})).fetch),
            'http://box',
        );
        expect(odd.version).toEqual(VERSION);
        expect(hmipPairingOf({...fact, device_keys: -1})).toBeUndefined();
        expect(hmipPairingOf({...fact, offline_pairing: 'yes'})).toBeUndefined();
        expect(hmipPairingOf(null)).toBeUndefined();
    });
});

describe('the errors', () => {
    it('turns a 401 into forbidden, which is what the provider degrades on', () => {
        const error = metaRefusal(401, {error: 'unauthenticated', message: 'login required'});
        expect(error).toBeInstanceOf(MetaError);
        expect(error).toMatchObject({code: 'forbidden', detail: {status: 401}});
        expect(error.message).toBe('the metadata API refused the credential (401): login required');
    });

    it("keeps the API's code where the specification has it, and survives a body that is not JSON", () => {
        expect(metaRefusal(409, {error: 'has-members', message: 'room/eg has members'})).toMatchObject({
            code: 'has-members',
            message: 'room/eg has members',
        });
        expect(metaRefusal(403, {error: 'forbidden', message: 'administrator role required'})).toMatchObject({
            code: 'forbidden',
            message: 'administrator role required',
        });
        expect(metaRefusal(502, '<html>Bad Gateway</html>')).toMatchObject({code: 'unknown-path', message: 'HTTP 502'});
        expect(metaRefusal(418, {error: 'teapot'})).toMatchObject({code: 'unknown-path'});
    });

    it("turns the package's HTTP errors into MetaError with the API's own message, and leaves the rest alone", () => {
        const forbidden = new OccuLiteError('forbidden', 'the credential lacks meta:write (the credential lacks …)', {
            status: 403,
            scope: 'meta:write',
            detail: {error: 'forbidden', message: 'the credential lacks meta:write'},
        });
        expect(metaErrorOf(forbidden)).toMatchObject({
            name: 'MetaError',
            code: 'forbidden',
            message: 'the credential lacks meta:write',
        });
        const unauthenticated = new OccuLiteError('unauthenticated', 'login required', {status: 401});
        expect(metaErrorOf(unauthenticated)).toMatchObject({code: 'forbidden', detail: {status: 401}});
        const unreachable = new OccuLiteError('unreachable', 'the system does not answer');
        expect(metaErrorOf(unreachable)).toBe(unreachable);
        const other = new Error('x');
        expect(metaErrorOf(other)).toBe(other);
        expect(certificateProblemOf(unreachable, 'https://x')).toBeUndefined();
    });
});

describe('the change stream', () => {
    /** A system whose stream sends `chunks` and then stays open until the reader goes away. */
    function streaming(
        chunks: string[],
        status = 200,
    ): {link: SystemLink; urls: string[]; headers: Record<string, string>[]} {
        const urls: string[] = [];
        const headers: Record<string, string>[] = [];
        const fetchImpl = ((input: string | URL, init?: RequestInit) => {
            urls.push(String(input));
            headers.push((init?.headers ?? {}) as Record<string, string>);
            if (status !== 200) {
                return Promise.resolve(json({error: 'unauthenticated', message: 'login required'}, status));
            }
            const encoder = new TextEncoder();
            return Promise.resolve(
                new Response(
                    new ReadableStream<Uint8Array>({
                        start(controller) {
                            for (const chunk of chunks) {
                                controller.enqueue(encoder.encode(chunk));
                            }
                            // and then nothing: a stream that never ends, and ignores the signal
                        },
                    }),
                    {headers: {'Content-Type': 'text/event-stream'}},
                ),
            );
        }) as unknown as typeof globalThis.fetch;
        const link = new SystemLink({
            baseUrl: 'http://box',
            transport: fetchTransport(fetchImpl),
            readCredential: () => ({session: 'QL5IGTZSCJSV4H4AHCVOX4MQVC'}),
            writeCredential: () => undefined,
        });
        return {link, urls, headers};
    }

    it('reads one event per message, wherever a chunk ends, past the heartbeat and a line that is not JSON', async () => {
        const {link, urls, headers} = streaming([
            ': heartbeat\n\n',
            'data: {"revision":5,"kind":"object.updated","ref":"BidCos-RF.A:1","value":{"name":"x"}}\n\n',
            'data: not json\n\ndata: {"no":"kind"}\n\n',
            'data: {"revision":6,',
            '"kind":"object.deleted","ref":"BidCos-RF.A:1"}\n\n',
        ]);
        const abort = new AbortController();
        const events: string[] = [];
        for await (const event of link.events(4, abort.signal)) {
            events.push(`${String(event.revision)} ${event.kind}`);
            if (events.length === 2) {
                abort.abort();
            }
        }
        expect(events).toEqual(['5 object.updated', '6 object.deleted']);
        expect(urls).toEqual(['http://box/api/meta/v1/events/sse?since=4']);
        expect(headers[0]?.['Authorization']).toBe('Bearer QL5IGTZSCJSV4H4AHCVOX4MQVC');
    });

    it('stops when the signal is aborted, even on a stream that never ends by itself', async () => {
        const {link} = streaming([]);
        const abort = new AbortController();
        setTimeout(() => {
            abort.abort();
        }, 30);
        const events: unknown[] = [];
        for await (const event of link.events(undefined, abort.signal)) {
            events.push(event);
        }
        expect(events).toEqual([]);
    });

    it('refuses a stream the system refuses, as the MetaError the provider degrades on', async () => {
        const {link} = streaming([], 401);
        const iterator = link.events(0, new AbortController().signal);
        await expect(iterator.next()).rejects.toMatchObject({name: 'MetaError', code: 'forbidden'});
    });
});

describe('the credentials', () => {
    it('reads the local token the way occulite-client does: the first line, or nothing', async () => {
        const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hmm-token-'));
        try {
            const file = path.join(dir, 'local-token');
            await fsp.writeFile(file, 'olt_0123456789abcdef0123456789abcdef\n');
            expect(await readLocalToken(file)).toBe('olt_0123456789abcdef0123456789abcdef');
            await fsp.writeFile(file, '\n');
            expect(await readLocalToken(file)).toBeUndefined();
            expect(await readLocalToken(path.join(dir, 'missing'))).toBeUndefined();
        } finally {
            await fsp.rm(dir, {recursive: true, force: true});
        }
    });

    it('takes a session id in the CCU spelling and the bare one, and nothing else', () => {
        expect(normaliseSid('@QL5IGTZSCJSV4H4AHCVOX4MQVC@')).toBe('QL5IGTZSCJSV4H4AHCVOX4MQVC');
        expect(normaliseSid('QL5IGTZSCJSV4H4AHCVOX4MQVC')).toBe('QL5IGTZSCJSV4H4AHCVOX4MQVC');
        expect(normaliseSid('no spaces allowed')).toBeUndefined();
        expect(normaliseSid(undefined)).toBeUndefined();
    });
});
