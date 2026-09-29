/**
 * The connection to an openccu-lite system's own HTTP APIs - `/api/meta/v1/` and
 * `/api/system/v1/` - through occulite-client (task 72).
 *
 * Until 3.0.0-beta.31 this application carried its own client for them: a `fetch` wrapper for the
 * metadata API, a hand-written Server-Sent Events parser for its change stream, a `node:https`
 * transport that pinned the system's certificate (B-67) and a reader for the local token file.
 * openccu-lite's own package, occulite-client, does all of that for every program that talks to
 * such a system (hm2mqtt.js, node-red-contrib-ccu, matterbridge-homematic), so what is left here is
 * the part that is this application's:
 *
 * - **the trust of a profile** ({@link systemTransport}): any of the certificates it pinned, or a
 *   chain to Node's CAs plus the CAs it trusts - B-67's rule, on the package's transport;
 * - **the detection** ({@link detectSystem}): `GET /version` on the configured host, the one
 *   redirect to `https://` followed, a certificate nothing trusts said rather than taken for "a
 *   CCU";
 * - **two credentials** ({@link SystemLink}): the metadata store is read as the addon (the local
 *   token, or the profile's token) and written as the person looking at the page (their session),
 *   so every request is sent by an `OccuLite` built for the credential it needs;
 * - **the errors the UI already knows**: the API's refusals become core's `MetaError`, a
 *   certificate the transport refused becomes the `SystemCertificateProblem` the settings dialog
 *   offers to trust.
 *
 * `OccuLite.ready()` is not used here: it would open lite-rpc's event stream as well whenever the
 * credential may read devices, and the RPC side of this application does not go through the
 * package yet. The metadata stream is followed by the provider, which owns its policy - the
 * backoff, the state it shows, the cache file.
 */

import os from 'node:os';

import type {MetaCopy, Transport, WriteResult} from 'occulite-client';
import {OccuLite, OccuLiteError, fetchTransport, parseSSE, type Auth} from 'occulite-client';
import {nodeTransport, pair, type Paired, type PairOptions} from 'occulite-client/node';

import {
    MetaError,
    parseDocument,
    type ConnectionTest,
    type MetaDocument,
    type MetaErrorCode,
    type MetaEvent,
    type MetaHmipPairing,
    type MetaVersion,
    type SystemCertificate,
    type SystemCertificateProblem,
    type SystemTrust,
} from '@homematic-manager/core';

/** How long a plain request may take. The system is on the LAN or on the loopback. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * How long the detection call may take.
 *
 * Short on purpose: it runs on every connect, a CCU answers 404 in milliseconds and an
 * openccu-lite system answers just as fast. What this timeout is really for is the host that
 * neither answers nor refuses - a firewall that drops the packet - and three seconds of that is
 * already more patience than the answer is worth.
 */
export const DETECT_TIMEOUT_MS = 3000;

const VERSION_PATH = '/api/meta/v1/version';

/** The header occulited wants on a state-changing call; harmless beside a Bearer. */
const REQUEST_HEADER = 'X-Occulite-Request';

/*
 * transport and trust
 */

/** `AB:CD:…`, upper case with colons - the form Node prints and the profile stores. */
export function normaliseFingerprint(value: string): string {
    const hex = value.replace(/[^0-9a-f]/gi, '').toUpperCase();
    return hex.match(/.{1,2}/g)?.join(':') ?? '';
}

/**
 * B-67: the transport for a profile's trust, on occulite-client's `node:https` transport - which
 * judges the certificate before a byte of the request, the credential least of all, is written.
 *
 * The package's transport trusts one thing at a time: a pinned fingerprint, or a chain to Node's
 * CAs plus a CA of the caller's. A profile may trust several certificates *and* CAs, any of which
 * lets the request through, so this tries the chain first and then each pinned certificate, and
 * remembers the one that worked - a self-signed system costs one refused handshake per start, not
 * one per request. When nothing is accepted the chain's refusal is what is reported: it carries
 * Node's reason (`DEPTH_ZERO_SELF_SIGNED_CERT`, …), which is what the settings dialog shows.
 * `http://` URLs go out over plain `node:http`; redirects are never followed.
 */
export function systemTransport(trust: SystemTrust | undefined): Transport {
    const cas = (trust?.cas ?? []).filter((pem) => pem.trim() !== '');
    const chain = abortable(nodeTransport(cas.length === 0 ? undefined : {ca: cas.join('\n')}));
    const pins = (trust?.certificates ?? [])
        .map((fingerprint) => normaliseFingerprint(fingerprint))
        .filter((fingerprint) => fingerprint !== '')
        .map((fingerprint256) => abortable(nodeTransport({fingerprint256})));
    if (pins.length === 0) {
        return chain;
    }
    let preferred: Transport = chain;
    const attempt = async <T>(run: (transport: Transport) => Promise<T>): Promise<T> => {
        let refusal: unknown;
        for (const transport of [preferred, ...[chain, ...pins].filter((one) => one !== preferred)]) {
            try {
                const answer = await run(transport);
                preferred = transport;
                return answer;
            } catch (error) {
                if (!(error instanceof OccuLiteError) || error.code !== 'certificate') {
                    throw error;
                }
                if (transport === chain || refusal === undefined) {
                    refusal = error;
                }
            }
        }
        throw refusal;
    };
    return {
        request: (method, url, headers, body, signal) =>
            attempt((transport) => transport.request(method, url, headers, body, signal)),
        stream: (url, headers, signal) => attempt((transport) => transport.stream(url, headers, signal)),
    };
}

/**
 * A transport whose requests end when their signal fires, whatever the transport underneath does.
 *
 * occulite-client 0.2.0's `node:https` transport opens its own TLS socket for every request, and a
 * signal that fires while that socket is still connecting ends nothing: a host that swallows the
 * handshake (off, or a firewall that drops the packet) left the detection waiting for the
 * operating system's connect timeout - two minutes - instead of its three seconds. The socket
 * itself cannot be reached from here and is left to that timeout; the caller is not.
 */
function abortable(transport: Transport): Transport {
    const race = <T>(pending: Promise<T>, signal: AbortSignal | undefined): Promise<T> => {
        if (signal === undefined) {
            return pending;
        }
        return new Promise<T>((resolve, reject) => {
            const onAbort = (): void => {
                const reason = signal.reason as {name?: string} | undefined;
                reject(
                    reason?.name === 'TimeoutError'
                        ? new OccuLiteError('timeout', 'the request timed out', {detail: {code: 'timeout'}})
                        : new OccuLiteError('aborted', 'the request was aborted', {detail: {code: 'aborted'}}),
                );
            };
            if (signal.aborted) {
                onAbort();
                return;
            }
            signal.addEventListener('abort', onAbort, {once: true});
            pending.then(resolve, reject).finally(() => {
                signal.removeEventListener('abort', onAbort);
            });
        });
    };
    return {
        request: (method, url, headers, body, signal) =>
            race(transport.request(method, url, headers, body, signal), signal),
        stream: (url, headers, signal) => race(transport.stream(url, headers, signal), signal),
    };
}

/** The transport for a connection: the tests' `fetch` when they inject one, else the profile's trust. */
export function transportFor(options: {
    readonly fetch?: typeof globalThis.fetch | undefined;
    readonly trust?: SystemTrust | undefined;
}): Transport {
    return options.fetch === undefined ? systemTransport(options.trust) : fetchTransport(options.fetch);
}

function certificateOf(info: {
    subject?: string;
    issuer?: string;
    fingerprint256?: string;
    validTo?: string;
    altNames?: string;
}): SystemCertificate {
    return {
        subject: info.subject ?? '',
        issuer: info.issuer ?? '',
        fingerprint256: normaliseFingerprint(info.fingerprint256 ?? ''),
        validTo: info.validTo ?? '',
        ...(info.altNames === undefined ? {} : {altNames: info.altNames}),
    };
}

/**
 * B-67: the certificate problem in an error the transport raised, for the request to `url` - what
 * the settings dialog shows and offers to trust (the certificate, or the CA that issued it).
 */
export function certificateProblemOf(error: unknown, url: string): SystemCertificateProblem | undefined {
    if (!(error instanceof OccuLiteError) || error.code !== 'certificate') {
        return undefined;
    }
    let origin = url;
    try {
        origin = new URL(url).origin;
    } catch {
        // the URL as it was given; it named the request that failed either way
    }
    return {
        url: origin,
        code: error.reason ?? 'UNTRUSTED',
        certificate: certificateOf(error.certificate ?? {}),
        ...(error.ca === undefined ? {} : {ca: {...certificateOf(error.ca), pem: error.ca.pem}}),
    };
}

/*
 * errors
 */

const META_CODES: ReadonlySet<string> = new Set<MetaErrorCode>([
    'invalid-ref',
    'invalid-name',
    'invalid-id',
    'unknown-object',
    'unknown-enum',
    'unknown-path',
    'duplicate-id',
    'duplicate-path',
    'has-members',
    'invalid-move',
    'too-deep',
    'format-unsupported',
    'revision-conflict',
    'forbidden',
]);

/**
 * A refusal of the metadata API as core's `MetaError`: the API's code where it is one of the
 * specification's, `forbidden` for 401 and 403, `unknown-path` for everything else (a proxy's error
 * page, a CCU answering something else entirely).
 */
export function metaRefusal(status: number, body: unknown): MetaError {
    const answer = (typeof body === 'object' && body !== null ? body : {}) as {error?: unknown; message?: unknown};
    const message = typeof answer.message === 'string' ? answer.message : `HTTP ${String(status)}`;
    if (status === 401) {
        // told apart from a 403 on purpose: no credential at all is what the provider degrades on,
        // a credential without the role is what a write reports to the user
        return new MetaError('forbidden', `the metadata API refused the credential (401): ${message}`, {status});
    }
    if (status === 403) {
        return new MetaError('forbidden', message, {status});
    }
    const code = typeof answer.error === 'string' && META_CODES.has(answer.error) ? answer.error : 'unknown-path';
    return new MetaError(code as MetaErrorCode, message, {status});
}

/**
 * What occulite-client threw, as the rest of the backend expects it: an HTTP refusal as a
 * `MetaError` (with the API's own message, not the package's hint about pairing - a person's
 * session is refused here too), anything else - unreachable, a timeout, a certificate - as it is.
 */
export function metaErrorOf(error: unknown): unknown {
    if (!(error instanceof OccuLiteError) || error.status === undefined) {
        return error;
    }
    const detail = error.detail as {message?: unknown} | undefined;
    const message = typeof detail?.message === 'string' ? detail.message : error.message;
    return metaRefusal(error.status, {error: error.code === 'unauthenticated' ? 'forbidden' : error.code, message});
}

/*
 * the detection
 */

/**
 * B-67: what the detection found - the version answer when there is an openccu-lite system, the
 * base URL every later call goes to (the `https://` one when the system redirected there), and
 * the certificate problem when its `https://` could not be trusted.
 */
export interface MetaDetection {
    readonly version?: MetaVersion;
    readonly baseUrl: string;
    readonly certificate?: SystemCertificateProblem;
    /**
     * Task 72: something answered over HTTP - the version, a CCU's 404 or HTML, anything. False
     * when the request itself failed; `reason` then says how (`refused`, `dns`, `timeout`, or the
     * transport's own word), and never for a certificate problem, which is `certificate` above.
     */
    readonly answered: boolean;
    readonly reason?: string;
}

/**
 * B-67: where a redirect of the version request points, when it is the one to follow - the same
 * resource on `https://`, which is what openccu-lite answers `http://` with. Its base URL is the
 * redirect target less the API path. Anything else (a login page, another path, back to `http`)
 * is not followed: it is not the metadata API.
 */
export function httpsRedirectTarget(
    location: string | undefined,
    requested: string,
): {url: string; baseUrl: string} | undefined {
    if (location === undefined || location === '') {
        return undefined;
    }
    let target: URL;
    try {
        target = new URL(location, requested);
    } catch {
        return undefined;
    }
    if (target.protocol !== 'https:' || !target.pathname.endsWith(VERSION_PATH)) {
        return undefined;
    }
    const prefix = target.pathname.slice(0, -VERSION_PATH.length);
    return {url: target.href, baseUrl: `${target.origin}${prefix}`};
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

const KEYSERVER_MODES: readonly MetaHmipPairing['keyserver_mode'][] = ['LOCAL', 'KEYSERVER', 'KEYSERVER_LOCAL'];

/** The `hmip` object of the version answer when it has the defined shape, else `undefined`. */
export function hmipPairingOf(value: unknown): MetaHmipPairing | undefined {
    if (typeof value !== 'object' || value === null) {
        return undefined;
    }
    const {keyserver_mode, device_keys, offline_pairing} = value as Record<string, unknown>;
    if (
        typeof keyserver_mode !== 'string' ||
        !(KEYSERVER_MODES as readonly string[]).includes(keyserver_mode) ||
        typeof device_keys !== 'number' ||
        !Number.isInteger(device_keys) ||
        device_keys < 0 ||
        typeof offline_pairing !== 'boolean'
    ) {
        return undefined;
    }
    return {keyserver_mode: keyserver_mode as MetaHmipPairing['keyserver_mode'], device_keys, offline_pairing};
}

/** The version answer in a response body, when it is one. */
function versionOf(status: number, body: string): MetaVersion | undefined {
    if (status < 200 || status > 299) {
        return undefined;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch {
        // HTML: a CCU's WebUI
        return undefined;
    }
    if (typeof parsed !== 'object' || parsed === null) {
        return undefined;
    }
    const answer = parsed as Partial<MetaVersion>;
    if (answer.api !== 'meta' || typeof answer.version !== 'number') {
        return undefined;
    }
    // task 66: the pairing fact is kept only in the shape openccu-lite task 192 defines;
    // anything else is treated as "the system does not say", never as a broken dialog
    const {hmip, ...rest} = answer;
    const pairing = hmipPairingOf(hmip);
    return {...(rest as MetaVersion), ...(pairing === undefined ? {} : {hmip: pairing})};
}

/**
 * `GET /api/meta/v1/version` - the runtime detection, and the only call that needs no credential.
 *
 * A CCU answers 404 or HTML here, which is exactly the point: no `/VERSION` sniffing, no host
 * names, no ports. The one redirect an openccu-lite system answers `http://` with is followed.
 * Never throws: a system that is off, a CCU that answers HTML, a name that does not resolve all
 * mean "no metadata API here" - but a certificate nothing trusts is said (B-67), because the
 * system may well be openccu-lite.
 */
export async function detectSystem(
    transport: Transport,
    baseUrl: string,
    timeoutMs = DETECT_TIMEOUT_MS,
): Promise<MetaDetection> {
    const headers = {Accept: 'application/json'};
    let requested = `${baseUrl.replace(/\/$/, '')}${VERSION_PATH}`;
    let found = baseUrl;
    try {
        const signal = AbortSignal.timeout(timeoutMs);
        let response = await transport.request('GET', requested, headers, undefined, signal);
        if (REDIRECTS.has(response.status)) {
            const target = httpsRedirectTarget(response.headers['location'], requested);
            if (target === undefined) {
                return {baseUrl: found, answered: true};
            }
            found = target.baseUrl;
            requested = target.url;
            response = await transport.request('GET', target.url, headers, undefined, signal);
        }
        const version = versionOf(response.status, response.body);
        return version === undefined ? {baseUrl: found, answered: true} : {version, baseUrl: found, answered: true};
    } catch (error) {
        const certificate = certificateProblemOf(error, requested);
        if (certificate !== undefined) {
            return {baseUrl: found, certificate, answered: false};
        }
        const reason =
            error instanceof OccuLiteError
                ? (error.reason ?? error.code)
                : (error as {name?: string}).name === 'TimeoutError'
                  ? 'timeout'
                  : 'error';
        return {baseUrl: found, answered: false, reason};
    }
}

/*
 * task 72: the connection test and the pairing
 */

/**
 * Does a credential with these scopes read devices and values? openccu-lite's rpc scopes are tiers
 * (`internal/auth/scopes.go`: operate covers read, configure covers operate, admin covers all), and
 * a paired token lists only the tier it was approved with - `rpc:admin`, not `rpc:read` beside it.
 * occulite-client 0.2.0 looks for the literal `rpc:read` and takes such a token for names-only
 * (occulite-client B-3); until that is fixed the tiers are known here.
 */
export function readsDevices(scopes: readonly string[]): boolean {
    return scopes.some((scope) => scope === '*' || RPC_TIERS.has(scope));
}

const RPC_TIERS: ReadonlySet<string> = new Set(['rpc:read', 'rpc:operate', 'rpc:configure', 'rpc:admin']);

/**
 * occulite-client B-3: the client decides "names only" from the scopes `GET /api/auth/v1/state`
 * lists, looking for the literal `rpc:read`; a paired token names its tier (`rpc:admin`) and would
 * get no devices, no values and no stream. This transport hands the client the answer with the
 * tier's `rpc:read` spelled out. Nothing else passes through it changed; it goes when the package
 * knows the tiers.
 */
export function tierAwareTransport(transport: Transport): Transport {
    return {
        request: async (method, url, headers, body, signal) => {
            const response = await transport.request(method, url, headers, body, signal);
            if (method !== 'GET' || !/\/api\/auth\/v1\/state(\?|$)/.test(url) || response.status !== 200) {
                return response;
            }
            let parsed: unknown;
            try {
                parsed = JSON.parse(response.body);
            } catch {
                return response;
            }
            if (
                typeof parsed !== 'object' ||
                parsed === null ||
                !Array.isArray((parsed as {scopes?: unknown}).scopes)
            ) {
                return response;
            }
            const scopes = (parsed as {scopes: unknown[]}).scopes.filter(
                (scope): scope is string => typeof scope === 'string',
            );
            if (scopes.includes('rpc:read') || !readsDevices(scopes)) {
                return response;
            }
            return {...response, body: JSON.stringify({...parsed, scopes: [...scopes, 'rpc:read']})};
        },
        stream: (url, headers, signal) => transport.stream(url, headers, signal),
    };
}

/**
 * The settings dialog's *Test connection*: what is at `baseUrl` and what `token` is worth there.
 * Nothing is kept open. Never throws for a system that does not answer - that is the answer.
 */
export async function testSystem(
    transport: Transport,
    baseUrl: string,
    token: string,
    timeoutMs = DETECT_TIMEOUT_MS,
): Promise<ConnectionTest> {
    const found = await detectSystem(transport, baseUrl, timeoutMs);
    if (found.certificate !== undefined) {
        return {
            kind: 'unreachable',
            reachable: true,
            reason: 'certificate',
            url: found.certificate.url,
            certificate: found.certificate,
        };
    }
    if (found.version === undefined) {
        return found.answered
            ? {kind: 'ccu', reachable: true, url: found.baseUrl}
            : {kind: 'unreachable', reachable: false, reason: found.reason ?? 'error', url: found.baseUrl};
    }
    const result: ConnectionTest = {
        kind: 'openccu-lite',
        reachable: true,
        url: found.baseUrl,
        ...(found.version.implementation === undefined ? {} : {implementation: found.version.implementation}),
        token: {state: 'none', scopes: []},
    };
    if (token === '') {
        return result;
    }
    const box = new OccuLite({url: found.baseUrl, transport, auth: {token}, timeout: DEFAULT_TIMEOUT_MS});
    try {
        const state = await box.request<{scopes?: string[]; authenticated?: boolean}>('GET', '/api/auth/v1/state');
        const scopes = Array.isArray(state.scopes)
            ? state.scopes.filter((s): s is string => typeof s === 'string')
            : [];
        if (state.authenticated === false) {
            return {...result, token: {state: 'refused', scopes: []}};
        }
        return {...result, token: {state: readsDevices(scopes) ? 'full' : 'names-only', scopes}};
    } catch (error) {
        if (error instanceof OccuLiteError && (error.code === 'unauthenticated' || error.code === 'forbidden')) {
            return {...result, token: {state: 'refused', scopes: []}};
        }
        throw error;
    }
}

export interface PairWithSystemOptions {
    /** The transport with the profile's trust, for the detection that finds the `https://` URL. */
    readonly transport: Transport;
    readonly baseUrl: string;
    readonly appVersion: string;
    readonly detectTimeoutMs?: number;
    readonly onCode: (code: string) => void;
    readonly signal: AbortSignal;
    /** occulite-client's `pair()`, replaced by the tests. */
    readonly pair?: (options: PairOptions) => Promise<Paired>;
}

/**
 * Pairs this application with the openccu-lite system at `baseUrl` (openccu-lite task 219): one
 * request, a six-digit code both sides show, an administrator's click on the system's Status page.
 * The system's `https://` is found first (an `http://` request would only be redirected), and the
 * pairing itself accepts whatever certificate the system presents - this is the first contact, and
 * the fingerprint it answers is the one the profile pins from then on. The access asked for is what
 * this application does: it administers devices (delete, re-key, firmware, install mode), edits
 * names and rooms, and changes heating groups.
 */
export async function pairWithSystem(options: PairWithSystemOptions): Promise<Paired> {
    const found = await detectSystem(options.transport, options.baseUrl, options.detectTimeoutMs ?? DETECT_TIMEOUT_MS);
    if (found.version === undefined && found.certificate === undefined) {
        throw new Error(
            found.answered
                ? `${options.baseUrl} is not an openccu-lite system`
                : `${options.baseUrl} does not answer (${found.reason ?? 'error'})`,
        );
    }
    const url = found.certificate?.url ?? found.baseUrl;
    return (options.pair ?? pair)({
        url,
        app: 'homematic-manager',
        appVersion: options.appVersion,
        instance: os.hostname(),
        access: {devices: 'administer', names: 'configure', system: 'configure'},
        purpose: {
            devices: 'configure devices, direct links and paramsets; pair, delete and update devices',
            names: 'rename devices and channels, edit rooms and functions',
            system: 'heating groups, service messages and the radio health',
        },
        onCode: options.onCode,
        signal: options.signal,
    });
}

/*
 * one system, two credentials
 */

export interface SystemLinkOptions {
    /** `http://ccu`, `https://10.0.0.5` or `http://127.0.0.1` - scheme and authority, no path. */
    readonly baseUrl: string;
    readonly transport: Transport;
    /** The credential for reads; `undefined` means "unauthenticated", which only `/version` accepts. */
    readonly readCredential: () => Auth | undefined;
    /** The credential for writes, and for the system API (task 57). */
    readonly writeCredential: () => Auth | undefined;
    readonly timeoutMs?: number;
}

/**
 * One openccu-lite system, reached with the credential each call needs.
 *
 * An `OccuLite` holds one credential for its life; this application reads with one and writes
 * with another, and the write credential changes when a person opens the page. So every call gets
 * an `OccuLite` built for it: the object is a handful of closures, it connects nothing until a
 * request is made, and `ready()` is never called on it (see the file comment).
 */
export class SystemLink {
    readonly #options: SystemLinkOptions;

    constructor(options: SystemLinkOptions) {
        this.#options = options;
    }

    get baseUrl(): string {
        return this.#options.baseUrl;
    }

    /** A client for one call, with the credential of `purpose`. */
    client(purpose: 'read' | 'write'): OccuLite {
        const auth = purpose === 'read' ? this.#options.readCredential() : this.#options.writeCredential();
        return new OccuLite({
            url: this.#options.baseUrl,
            transport: this.#options.transport,
            ...(auth === undefined ? {} : {auth}),
            timeout: this.#options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        });
    }

    /** `GET /snapshot` - the whole document, validated as if it came off disk. */
    async snapshot(): Promise<MetaDocument> {
        try {
            return parseDocument(await this.client('read').request('GET', '/api/meta/v1/snapshot'));
        } catch (error) {
            throw metaErrorOf(error);
        }
    }

    /** One metadata write through the package's routes, with the write credential. */
    async write(run: (meta: MetaCopy) => Promise<WriteResult>): Promise<WriteResult> {
        try {
            return await run(this.client('write').meta);
        } catch (error) {
            throw metaErrorOf(error);
        }
    }

    /**
     * The change stream as an async iterator over parsed events.
     *
     * `since` replays what the system still has; a `{"kind": "resync"}` answer means the history
     * is gone and the consumer has to fetch the snapshot again. The iterator ends when the
     * connection does - reconnecting is the provider's job, because only it knows the revision to
     * resume from - and when `signal` fires, whatever the transport underneath does about it.
     */
    async *events(since: number | undefined, signal: AbortSignal): AsyncGenerator<MetaEvent> {
        const auth = this.#options.readCredential();
        const credential = auth?.token ?? auth?.session;
        const headers: Record<string, string> = {
            [REQUEST_HEADER]: '1',
            ...(credential === undefined || credential === '' ? {} : {Authorization: `Bearer ${credential}`}),
        };
        const query = since === undefined ? '' : `?since=${String(since)}`;
        const url = `${this.#options.baseUrl.replace(/\/$/, '')}/api/meta/v1/events/sse${query}`;
        const stream = await this.#options.transport.stream(url, headers, signal);
        if (stream.status !== 200) {
            let body: unknown = stream.body;
            try {
                body = JSON.parse(stream.body ?? '');
            } catch {
                // not JSON: a proxy's error page
            }
            throw metaRefusal(stream.status, body);
        }
        for await (const message of parseSSE(untilAborted(stream.chunks, signal))) {
            const event = parseEvent(message.data);
            if (event !== undefined) {
                yield event;
            }
        }
    }
}

/**
 * The chunks of a stream until `signal` fires. A pending read does not notice a signal by itself
 * on every transport, and without this a `stop()` waits for a system that has nothing more to say.
 */
async function* untilAborted<T>(chunks: AsyncIterable<T>, signal: AbortSignal): AsyncGenerator<T> {
    const iterator = chunks[Symbol.asyncIterator]();
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<IteratorResult<T>>((resolve) => {
        onAbort = () => {
            resolve({done: true, value: undefined});
        };
        if (signal.aborted) {
            onAbort();
        } else {
            signal.addEventListener('abort', onAbort, {once: true});
        }
    });
    try {
        for (;;) {
            const next = await Promise.race([iterator.next(), aborted]);
            if (next.done === true) {
                return;
            }
            yield next.value;
        }
    } finally {
        if (onAbort !== undefined) {
            signal.removeEventListener('abort', onAbort);
        }
        // not awaited: a generator suspended in a read that never ends would hold this up for good
        void iterator.return?.().catch(() => undefined);
    }
}

/** One message of the stream as a change event; a message that is not one is skipped, not thrown. */
function parseEvent(data: string): MetaEvent | undefined {
    if (data === '') {
        return undefined;
    }
    try {
        const parsed: unknown = JSON.parse(data);
        if (typeof parsed !== 'object' || parsed === null) {
            return undefined;
        }
        const event = parsed as Partial<MetaEvent>;
        return typeof event.kind === 'string' ? (event as MetaEvent) : undefined;
    } catch {
        return undefined;
    }
}
