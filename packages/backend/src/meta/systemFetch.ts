/**
 * B-67: `fetch` for the system's own HTTP APIs (`/api/meta/v1/`, `/api/system/v1/`), with the
 * certificates the profile trusts and a certificate error that says what was presented.
 *
 * An openccu-lite system answers `http://` with a redirect to `https://`, and its certificate is
 * usually one of a LAN CA - or one it made itself - which Node's `fetch` rejects without saying
 * more than a code. Before this, the detection read that as "no openccu-lite here" and the app
 * treated the system as a CCU. Here an `https://` request goes through `node:https` on a TLS
 * socket that is verified *before* a byte of the request is written:
 *
 * - the chain is checked against the default CAs plus the CAs the profile trusts, and the name
 *   against the host, as `fetch` would;
 * - or the leaf's SHA-256 fingerprint is one the profile trusts ("trust this certificate"), which
 *   holds whatever name the system is reached by - an IP address, typically;
 * - otherwise the request fails with a {@link SystemCertificateError} carrying the certificate
 *   and the CA that were presented, so the UI can show them and offer to trust either.
 *
 * `http://` URLs go to the platform's `fetch` unchanged. Redirects are never followed here: the
 * detection follows the one redirect it expects itself (`MetaApiClient.detect`), and every other
 * call goes to the `https://` base URL it found.
 *
 * The response is a real `Response` over the socket's stream, so the SSE change stream reads the
 * same way it does off `fetch`. Nothing but Node's standard library (the porting rules: no HTTP
 * dependency).
 */

import https from 'node:https';
import net from 'node:net';
import {Readable} from 'node:stream';
import tls from 'node:tls';

import type {SystemCertificate, SystemCertificateProblem, SystemTrust} from '@homematic-manager/core';

/** A certificate the system presented that nothing trusts; what the UI needs to offer trust. */
export class SystemCertificateError extends Error {
    readonly code: string;
    readonly problem: SystemCertificateProblem;

    constructor(problem: SystemCertificateProblem) {
        super(`the certificate of ${problem.url} is not trusted (${problem.code})`);
        this.name = 'SystemCertificateError';
        this.code = problem.code;
        this.problem = problem;
    }
}

/** The certificate problem inside whatever `fetch` threw, or `undefined`. */
export function certificateProblemOf(error: unknown): SystemCertificateProblem | undefined {
    let current: unknown = error;
    for (let depth = 0; depth < 4 && current !== undefined && current !== null; depth += 1) {
        if (current instanceof SystemCertificateError) {
            return current.problem;
        }
        current = (current as {cause?: unknown}).cause;
    }
    return undefined;
}

/** `AB:CD:…`, upper case with colons - the form Node prints and the profile stores. */
export function normaliseFingerprint(value: string): string {
    const hex = value.replace(/[^0-9a-f]/gi, '').toUpperCase();
    return hex.match(/.{1,2}/g)?.join(':') ?? '';
}

function describe(certificate: tls.PeerCertificate): SystemCertificate {
    const name = (entry: tls.Certificate | undefined): string =>
        entry === undefined ? '' : String(entry.CN ?? entry.O ?? Object.values(entry).join(', '));
    return {
        subject: name(certificate.subject),
        issuer: name(certificate.issuer),
        fingerprint256: normaliseFingerprint(certificate.fingerprint256),
        validTo: certificate.valid_to,
        ...(certificate.subjectaltname === undefined ? {} : {altNames: certificate.subjectaltname}),
    };
}

function pemOf(certificate: tls.PeerCertificate): string {
    const base64 =
        certificate.raw
            .toString('base64')
            .match(/.{1,64}/g)
            ?.join('\n') ?? '';
    return `-----BEGIN CERTIFICATE-----\n${base64}\n-----END CERTIFICATE-----\n`;
}

/**
 * The CA to offer: the topmost certificate of the chain the system sent that is a CA. A system
 * that sends its root sends that; one that sends only its issuing CA (a step-ca does by default) gets
 * that one, which is trusted as a partial chain.
 */
function presentedCa(leaf: tls.DetailedPeerCertificate): tls.DetailedPeerCertificate | undefined {
    let found: tls.DetailedPeerCertificate | undefined;
    const seen = new Set<string>();
    // a root is its own issuer, and a chain without one ends in `undefined`, whatever the types say
    let current = leaf.issuerCertificate as tls.DetailedPeerCertificate | undefined;
    while (current !== undefined && !seen.has(current.fingerprint256)) {
        seen.add(current.fingerprint256);
        if ((current as {ca?: boolean}).ca === true) {
            found = current;
        }
        current = current.issuerCertificate;
    }
    return found;
}

/** Whether the socket may carry the request; the problem to report when it may not. */
export function judgeSocket(
    socket: tls.TLSSocket,
    hostname: string,
    trust: SystemTrust | undefined,
    url: string,
): SystemCertificateProblem | undefined {
    const leaf = socket.getPeerCertificate(true);
    if (Object.keys(leaf).length === 0) {
        return {url, code: 'NO_CERTIFICATE', certificate: {subject: '', issuer: '', fingerprint256: '', validTo: ''}};
    }
    const fingerprint = normaliseFingerprint(leaf.fingerprint256);
    if ((trust?.certificates ?? []).some((pinned) => normaliseFingerprint(pinned) === fingerprint)) {
        return undefined;
    }
    let code: string | undefined;
    if (!socket.authorized) {
        const reason = socket.authorizationError as unknown;
        code = reason instanceof Error ? ((reason as {code?: string}).code ?? reason.message) : String(reason);
    } else {
        const identity = tls.checkServerIdentity(hostname, leaf);
        if (identity !== undefined) {
            code = (identity as {code?: string}).code ?? 'ERR_TLS_CERT_ALTNAME_INVALID';
        }
    }
    if (code === undefined) {
        return undefined;
    }
    const ca = presentedCa(leaf);
    return {
        url,
        code,
        certificate: describe(leaf),
        ...(ca === undefined ? {} : {ca: {...describe(ca), pem: pemOf(ca)}}),
    };
}

/** The CA list for a profile that trusts CAs of its own; `undefined` keeps Node's default. */
function caList(trust: SystemTrust | undefined): string[] | undefined {
    const extra = trust?.cas ?? [];
    if (extra.length === 0) {
        return undefined;
    }
    const defaults =
        typeof (tls as {getCACertificates?: (kind: string) => string[]}).getCACertificates === 'function'
            ? (tls as {getCACertificates: (kind: string) => string[]}).getCACertificates('default')
            : [...tls.rootCertificates];
    return [...defaults, ...extra];
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
        out[key] = value;
    });
    return out;
}

const NULL_BODY = new Set([101, 204, 205, 304]);

/**
 * A `fetch` for the system: `https://` through {@link judgeSocket}, everything else through
 * `base` (the platform's `fetch`).
 */
export function createSystemFetch(
    trust: SystemTrust | undefined,
    base: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch {
    const ca = caList(trust);
    return (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.protocol !== 'https:') {
            return base(input, init);
        }
        const hostname = url.hostname.replace(/^\[|\]$/g, '');
        const origin = url.origin;
        return new Promise<Response>((resolve, reject) => {
            const signal = init?.signal ?? undefined;
            if (signal?.aborted === true) {
                reject(signal.reason as Error);
                return;
            }
            let settled = false;
            // the TLS socket while it is being judged, before `https.request` owns it: an abort has to
            // end it itself, or a host that swallows the handshake keeps the process alive
            let connecting: tls.TLSSocket | undefined;
            const fail = (error: unknown): void => {
                if (!settled) {
                    settled = true;
                    reject(error instanceof Error ? error : new Error(String(error)));
                }
            };
            const request = https.request(
                {
                    method: init?.method ?? 'GET',
                    host: hostname,
                    port: url.port === '' ? 443 : Number(url.port),
                    path: `${url.pathname}${url.search}`,
                    headers: headersOf(init),
                    // no agent: only then does `https.request` take `createConnection` (and it keeps nothing alive)
                    // the socket is judged before the request goes out - see the file comment
                    createConnection: (
                        _options: unknown,
                        done: (error: Error | null, socket?: net.Socket) => void,
                    ): undefined => {
                        const socket = tls.connect({
                            host: hostname,
                            port: url.port === '' ? 443 : Number(url.port),
                            ...(net.isIP(hostname) === 0 ? {servername: hostname} : {}),
                            rejectUnauthorized: false,
                            ...(ca === undefined ? {} : {ca, allowPartialTrustChain: true}),
                        });
                        connecting = socket;
                        let answered = false;
                        socket.once('secureConnect', () => {
                            answered = true;
                            connecting = undefined;
                            const problem = judgeSocket(socket, hostname, trust, origin);
                            if (problem !== undefined) {
                                socket.destroy();
                                done(new SystemCertificateError(problem));
                                return;
                            }
                            done(null, socket);
                        });
                        socket.once('error', (error) => {
                            if (!answered) {
                                answered = true;
                                connecting = undefined;
                                done(error);
                            }
                        });
                        return undefined;
                    },
                } as https.RequestOptions,
                (response) => {
                    settled = true;
                    const status = response.statusCode ?? 0;
                    const headers = new Headers();
                    for (const [key, value] of Object.entries(response.headers)) {
                        if (Array.isArray(value)) {
                            for (const one of value) {
                                headers.append(key, one);
                            }
                        } else if (value !== undefined) {
                            headers.set(key, value);
                        }
                    }
                    let body: ReadableStream<Uint8Array> | null = null;
                    if (NULL_BODY.has(status)) {
                        response.resume();
                    } else {
                        body = Readable.toWeb(response) as ReadableStream<Uint8Array>;
                    }
                    resolve(new Response(body, {status, statusText: response.statusMessage ?? '', headers}));
                },
            );
            request.on('error', fail);
            if (signal !== undefined) {
                const abort = (): void => {
                    connecting?.destroy();
                    request.destroy(signal.reason as Error);
                    fail(signal.reason);
                };
                signal.addEventListener('abort', abort, {once: true});
                request.once('close', () => {
                    signal.removeEventListener('abort', abort);
                });
            }
            const body = init?.body;
            if (typeof body === 'string') {
                request.end(body);
            } else {
                request.end();
            }
        });
    };
}
