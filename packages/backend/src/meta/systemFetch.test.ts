/**
 * B-67: the system's `fetch` against a real TLS server on the loopback.
 *
 * The certificates in `test/tls/` are a test CA (`hmm-test-ca`) and a leaf for `localhost` only,
 * valid for a hundred years; the server sends the leaf and the CA, as a system that sends its root
 * does. Reached as `127.0.0.1` the name does not fit, which is the "given by IP" case of B-67.
 */

import fs from 'node:fs';
import https from 'node:https';
import type {AddressInfo} from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import {MetaApiClient} from './client.js';
import {SystemCertificateError, certificateProblemOf, createSystemFetch, normaliseFingerprint} from './systemFetch.js';

const TLS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../test/tls');
const CA = fs.readFileSync(path.join(TLS, 'ca.pem'), 'utf8');
const LEAF = fs.readFileSync(path.join(TLS, 'server.pem'), 'utf8');
const KEY = fs.readFileSync(path.join(TLS, 'server.key'), 'utf8');
const LEAF_FINGERPRINT =
    '95:9F:12:9D:4A:80:07:21:E8:D5:0C:29:F8:48:C9:B6:21:DC:56:EB:B8:18:59:FE:6C:5A:9B:8C:40:FA:2D:2F';

let server: https.Server;
let port = 0;
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
                response.end(JSON.stringify({api: 'meta', version: 1, implementation: 'test'}));
            } else if (request.url === '/unchanged') {
                response.writeHead(304);
                response.end();
            } else if (request.url === '/slow') {
                // never answers; the caller's signal ends it
            } else {
                response.writeHead(201, {'Content-Type': 'text/plain', 'X-Twice': ['a', 'b']});
                response.end(`echo ${body}`);
            }
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
});

describe('the system fetch (B-67)', () => {
    it('refuses a certificate nothing trusts before the request is written, and says what it was', async () => {
        const before = seen.length;
        const error: unknown = await createSystemFetch(undefined)(`https://localhost:${String(port)}/x`, {
            headers: {Authorization: 'Bearer secret'},
        }).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(SystemCertificateError);
        const problem = certificateProblemOf(error);
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
        const fetch = createSystemFetch({cas: [CA]});
        const response = await fetch(`https://localhost:${String(port)}/api/meta/v1/version`);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({api: 'meta', version: 1, implementation: 'test'});

        const byIp = await fetch(`https://127.0.0.1:${String(port)}/api/meta/v1/version`).catch(
            (caught: unknown) => caught,
        );
        expect(certificateProblemOf(byIp)?.code).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
    });

    it('takes a trusted certificate by its fingerprint, whatever name it is reached by', async () => {
        const fetch = createSystemFetch({certificates: [LEAF_FINGERPRINT.toLowerCase().replace(/:/g, '')]});
        const response = await fetch(`https://127.0.0.1:${String(port)}/api/meta/v1/version`);
        expect(response.status).toBe(200);
    });

    it('sends the method, the headers and the body, and hands back status, headers and body', async () => {
        const fetch = createSystemFetch({certificates: [LEAF_FINGERPRINT]});
        const response = await fetch(`https://127.0.0.1:${String(port)}/write?x=1`, {
            method: 'PUT',
            headers: {Authorization: 'Bearer t', 'Content-Type': 'application/json'},
            body: '{"a":1}',
        });
        expect(response.status).toBe(201);
        expect(response.headers.get('x-twice')).toBe('a, b');
        expect(await response.text()).toBe('echo {"a":1}');
        expect(seen.at(-1)).toEqual({method: 'PUT', url: '/write?x=1', authorization: 'Bearer t', body: '{"a":1}'});
    });

    it('answers a 304 without a body', async () => {
        const response = await createSystemFetch({certificates: [LEAF_FINGERPRINT]})(
            `https://127.0.0.1:${String(port)}/unchanged`,
        );
        expect(response.status).toBe(304);
        expect(response.body).toBeNull();
    });

    it('ends a request when its signal fires, and refuses one that has fired already', async () => {
        const fetch = createSystemFetch({certificates: [LEAF_FINGERPRINT]});
        await expect(
            fetch(`https://127.0.0.1:${String(port)}/slow`, {signal: AbortSignal.timeout(200)}),
        ).rejects.toThrow();
        const aborted = new AbortController();
        aborted.abort(new Error('gone'));
        await expect(fetch(`https://127.0.0.1:${String(port)}/x`, {signal: aborted.signal})).rejects.toThrow('gone');
    });

    it('hands every http:// URL to the platform fetch unchanged', async () => {
        const calls: string[] = [];
        const base = ((input: string | URL | Request) => {
            calls.push(input instanceof Request ? input.url : input.toString());
            return Promise.resolve(new Response('plain'));
        }) as typeof globalThis.fetch;
        const response = await createSystemFetch({certificates: [LEAF_FINGERPRINT]}, base)('http://ccu/x');
        expect(await response.text()).toBe('plain');
        expect(calls).toEqual(['http://ccu/x']);
    });

    it('fails a host that is not there with the socket error, not a certificate problem', async () => {
        // a port that was just free: refused at once (port 1 is not refused everywhere - WSL)
        const probe = https.createServer();
        await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
        const free = (probe.address() as AddressInfo).port;
        await new Promise((resolve) => probe.close(resolve));
        const error: unknown = await createSystemFetch(undefined)(`https://127.0.0.1:${String(free)}/x`).catch(
            (caught: unknown) => caught,
        );
        expect(error).toBeInstanceOf(Error);
        expect(certificateProblemOf(error)).toBeUndefined();
    });

    it('spells every fingerprint the same way', () => {
        expect(normaliseFingerprint('ab cd:EF')).toBe('AB:CD:EF');
    });
});

describe('the detection through the system fetch (B-67)', () => {
    it('reports the certificate problem instead of "no openccu-lite here"', async () => {
        const found = await new MetaApiClient({
            baseUrl: `https://127.0.0.1:${String(port)}`,
            fetch: createSystemFetch(undefined),
        }).detect(2000);
        expect(found.version).toBeUndefined();
        expect(found.certificate?.certificate.fingerprint256).toBe(LEAF_FINGERPRINT);
    });

    it('finds the system once its certificate is trusted', async () => {
        const found = await new MetaApiClient({
            baseUrl: `https://127.0.0.1:${String(port)}`,
            fetch: createSystemFetch({certificates: [LEAF_FINGERPRINT]}),
        }).detect(2000);
        expect(found.version?.implementation).toBe('test');
        expect(found.certificate).toBeUndefined();
    });
});
