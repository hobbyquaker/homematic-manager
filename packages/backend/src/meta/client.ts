/**
 * The HTTP client for openccu-lite's metadata API - `/api/meta/v1/`.
 *
 * Nothing but `fetch` and `AbortSignal`, both of which Node has had since 18 and Electron has
 * always had: the porting rules of openccu-lite say in so many words not to add an HTTP or SSE
 * dependency to an application that already has one, and a CCU addon pays for every kilobyte it
 * ships. The change stream is Server-Sent Events read off `response.body`, parsed in
 * {@link readEvents} - fifty lines against a `eventsource` package that would come with its own
 * reconnect policy we would have to fight.
 *
 * Every call returns a typed value or throws a {@link MetaError}: `401` becomes `forbidden` with
 * the credential named, which is what the provider degrades on rather than failing.
 */

import {
    MetaError,
    parseDocument,
    type MetaDocument,
    type MetaEnum,
    type MetaErrorCode,
    type MetaEvent,
    type MetaImportMode,
    type MetaNodePatch,
    type MetaObjectPatch,
    type MetaVersion,
} from '@homematic-manager/core';

/** How long a plain request may take. The box is on the LAN or on the loopback. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * How long the detection call may take.
 *
 * Short on purpose: it runs on every connect, a CCU answers 404 in milliseconds and an
 * openccu-lite box answers just as fast. What this timeout is really for is the host that neither
 * answers nor refuses - a firewall that drops the packet - and three seconds of that is already
 * more patience than the answer is worth.
 */
export const DETECT_TIMEOUT_MS = 3000;

export interface MetaApiClientOptions {
    /** `http://ccu` or `http://127.0.0.1` - scheme and authority, no path. */
    readonly baseUrl: string;
    /**
     * The credential for reads: an API token (`olt_…`), the box's local token, or a session id.
     * `undefined` means "unauthenticated", which only `/version` accepts.
     */
    readonly credential?: (() => string | undefined) | undefined;
    /**
     * The credential for writes, when it is a different one.
     *
     * On the box it is: reads use the local token (role `user`, read-only by design) and writes use
     * the session of the person who is looking at the page, handed to the addon as `?sid=@…@`.
     */
    readonly writeCredential?: (() => string | undefined) | undefined;
    readonly timeoutMs?: number;
    /** Injected by the tests. */
    readonly fetch?: typeof globalThis.fetch;
}

/** What a mutating call answers with. */
export interface MetaWriteAnswer {
    readonly revision: number;
    readonly changed: boolean;
}

/** Thin, typed access to one box's metadata API. */
export class MetaApiClient {
    readonly #options: MetaApiClientOptions;
    readonly #fetch: typeof globalThis.fetch;

    constructor(options: MetaApiClientOptions) {
        this.#options = options;
        this.#fetch = options.fetch ?? globalThis.fetch;
    }

    get baseUrl(): string {
        return this.#options.baseUrl;
    }

    /**
     * `GET /version` - the runtime detection, and the only call that needs no credential.
     *
     * A CCU answers 404 or HTML here, which is exactly the point: no `/VERSION` sniffing, no host
     * names, no ports. `undefined` means "this is not an openccu-lite box".
     */
    async version(timeoutMs = DETECT_TIMEOUT_MS): Promise<MetaVersion | undefined> {
        try {
            const response = await this.#fetch(this.#url('/version'), {
                signal: AbortSignal.timeout(timeoutMs),
                headers: {Accept: 'application/json'},
            });
            if (!response.ok) {
                return undefined;
            }
            const body: unknown = await response.json();
            if (typeof body !== 'object' || body === null) {
                return undefined;
            }
            const answer = body as Partial<MetaVersion>;
            return answer.api === 'meta' && typeof answer.version === 'number' ? (answer as MetaVersion) : undefined;
        } catch {
            // a box that is off, a CCU that answers HTML, a DNS name that does not resolve: all of
            // them mean the same thing here, and none of them is worth an exception
            return undefined;
        }
    }

    /** `GET /snapshot` - the whole document, validated as if it came off disk. */
    async snapshot(): Promise<MetaDocument> {
        return parseDocument(await this.#json('GET', '/snapshot'));
    }

    /** `PATCH /objects/{ref}` - the rename, and the room assignment. */
    async patchObject(ref: string, patch: MetaObjectPatch): Promise<MetaWriteAnswer> {
        return this.#write('PATCH', `/objects/${encodeRef(ref)}`, patch);
    }

    /** `POST /objects:bulk` - many objects as one revision; what a multi-select assign sends. */
    async bulk(
        sets: Readonly<Record<string, MetaObjectPatch>>,
        deletes: readonly string[] = [],
    ): Promise<MetaWriteAnswer> {
        return this.#write('POST', '/objects:bulk', {set: sets, delete: deletes});
    }

    /** `POST /enums`. */
    async createEnum(id: string, name: Readonly<Record<string, string>>): Promise<MetaWriteAnswer> {
        return this.#write('POST', '/enums', {id, name});
    }

    /** `PATCH /enums/{enum}`. */
    async updateEnum(id: string, name: Readonly<Record<string, string>>): Promise<MetaWriteAnswer> {
        return this.#write('PATCH', `/enums/${encodeURIComponent(id)}`, {name});
    }

    /** `DELETE /enums/{enum}` - refused while it has members unless `detach` is asked for. */
    async deleteEnum(id: string, members: 'refuse' | 'detach'): Promise<MetaWriteAnswer> {
        const query = members === 'detach' ? '?members=detach' : '';
        return this.#write('DELETE', `/enums/${encodeURIComponent(id)}${query}`, undefined);
    }

    /** `POST /enums/{enum}/nodes` - a new room, or a new floor above it. */
    async createNode(
        enumId: string,
        body: {parent: string | null; id: string; name: string; icon?: string; position?: number},
    ): Promise<MetaWriteAnswer> {
        return this.#write('POST', `/enums/${encodeURIComponent(enumId)}/nodes`, body);
    }

    /**
     * `PATCH /enums/{enum}/nodes/{path…}` - rename, move, reorder.
     *
     * The path in the URL is **relative to the enum**: the node `room/eg/wohnzimmer` is
     * `/enums/room/nodes/eg/wohnzimmer`. Writing the whole path there answers `unknown-path` for
     * `room/room/eg/…`, which is a confusing five minutes the first time.
     */
    async updateNode(path: string, patch: MetaNodePatch): Promise<MetaWriteAnswer> {
        return this.#write('PATCH', nodeUrl(path), patch);
    }

    /** `DELETE /enums/{enum}/nodes/{path…}`, with the same `detach` rule as an enum. */
    async deleteNode(path: string, members: 'refuse' | 'detach'): Promise<MetaWriteAnswer> {
        const query = members === 'detach' ? '?members=detach' : '';
        return this.#write('DELETE', `${nodeUrl(path)}${query}`, undefined);
    }

    /** `PUT /import` - a whole document, validated and applied as one revision. */
    async import(document: unknown, mode: MetaImportMode): Promise<MetaWriteAnswer> {
        return this.#write('PUT', `/import?mode=${mode}`, document);
    }

    /** `GET /export` - the document as the box would hand it to a user. */
    async export(): Promise<MetaDocument> {
        return parseDocument(await this.#json('GET', '/export?format=json'));
    }

    /** `GET /enums` - the trees alone, which is the cheapest authenticated read there is. */
    async enums(): Promise<Readonly<Record<string, MetaEnum>>> {
        const body = await this.#json('GET', '/enums');
        const answer = body as {enums?: unknown};
        return (answer.enums ?? {}) as Readonly<Record<string, MetaEnum>>;
    }

    /**
     * The change stream as an async iterator over parsed events.
     *
     * `since` replays what the box still has; a `{"kind": "resync"}` answer means the history is
     * gone and the consumer has to fetch the snapshot again. The iterator ends when the connection
     * does - reconnecting is the provider's job, because only it knows the revision to resume from.
     */
    async *events(since: number | undefined, signal: AbortSignal): AsyncGenerator<MetaEvent> {
        const query = since === undefined ? '' : `?since=${String(since)}`;
        const response = await this.#fetch(this.#url(`/events/sse${query}`), {
            signal,
            headers: {...this.#headers(false), Accept: 'text/event-stream'},
        });
        if (!response.ok) {
            throw await httpError(response);
        }
        if (!response.body) {
            throw new MetaError('unknown-path', 'the event stream answered without a body');
        }
        yield* readEvents(response.body, signal);
    }

    #url(path: string): string {
        return `${this.#options.baseUrl.replace(/\/$/, '')}/api/meta/v1${path}`;
    }

    /**
     * The credential, as a Bearer header.
     *
     * The API takes a session id or an API token in the same three places, and it accepts the CCU's
     * `@…@` wrapping around a session id - but stripping it here keeps one shape on the wire and
     * makes a log line readable.
     */
    #headers(write: boolean): Record<string, string> {
        const credential = write
            ? (this.#options.writeCredential?.() ?? this.#options.credential?.())
            : (this.#options.credential?.() ?? this.#options.writeCredential?.());
        if (credential === undefined || credential === '') {
            return {};
        }
        return {Authorization: `Bearer ${credential.replace(/^@|@$/g, '')}`};
    }

    async #json(method: string, path: string): Promise<unknown> {
        const response = await this.#fetch(this.#url(path), {
            method,
            signal: AbortSignal.timeout(this.#options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
            headers: {...this.#headers(false), Accept: 'application/json'},
        });
        if (!response.ok) {
            throw await httpError(response);
        }
        return response.json();
    }

    async #write(method: string, path: string, body: unknown): Promise<MetaWriteAnswer> {
        const response = await this.#fetch(this.#url(path), {
            method,
            signal: AbortSignal.timeout(this.#options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
            headers: {
                ...this.#headers(true),
                Accept: 'application/json',
                // lighttpd's mod_proxy answers 411 for a body-less PUT/POST/DELETE, which is why
                // even a DELETE goes out with `{}` rather than nothing at all
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body ?? {}),
        });
        // 304: the write was valid and changed nothing, and the revision did not move
        if (response.status === 304) {
            return {revision: Number.NaN, changed: false};
        }
        if (!response.ok) {
            throw await httpError(response);
        }
        const answer = (await response.json()) as {revision?: unknown; changed?: unknown};
        return {
            revision: typeof answer.revision === 'number' ? answer.revision : Number.NaN,
            changed: answer.changed !== false,
        };
    }
}

/** `BidCos-RF.JEQ0230153:1` as one path segment: the colon has to be percent-encoded. */
export function encodeRef(ref: string): string {
    return encodeURIComponent(ref);
}

/** `room/eg/wohnzimmer` → `/enums/room/nodes/eg/wohnzimmer`. */
export function nodeUrl(path: string): string {
    const [enumId, ...ids] = path.split('/');
    return `/enums/${encodeURIComponent(enumId ?? '')}/nodes/${ids.map((id) => encodeURIComponent(id)).join('/')}`;
}

/** The error body of the API, or the status when there is none. */
async function httpError(response: Response): Promise<MetaError> {
    let code: MetaErrorCode = response.status === 403 || response.status === 401 ? 'forbidden' : 'unknown-path';
    let message = `${String(response.status)} ${response.statusText}`;
    try {
        const body = (await response.json()) as {error?: unknown; message?: unknown};
        if (typeof body.error === 'string') {
            code = body.error as MetaErrorCode;
        }
        if (typeof body.message === 'string') {
            message = body.message;
        }
    } catch {
        // not JSON: a proxy error page, or a CCU answering something else entirely
    }
    if (response.status === 401) {
        // told apart from a 403 on purpose: no credential at all is what the provider degrades on,
        // a credential without the role is what a write reports to the user
        return new MetaError('forbidden', `the metadata API refused the credential (401): ${message}`, {status: 401});
    }
    return new MetaError(code, message, {status: response.status});
}

/**
 * Server-Sent Events off a byte stream: `data:` lines until a blank one, everything else ignored.
 *
 * The API sends one JSON object per message and a comment line every 30 s as a heartbeat; there are
 * no event names and no ids, because the resume point is `?since=<revision>` and not
 * `Last-Event-ID`. A message that is not JSON is skipped rather than thrown - a stream that carries
 * one bad line still carries the next good one.
 */
export async function* readEvents(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<MetaEvent> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let data = '';
    // a pending `read()` does not notice a signal by itself; cancelling the reader is what ends it,
    // and without this a `stop()` waits for a box that has nothing more to say
    const cancel = (): void => {
        void reader.cancel().catch(() => undefined);
    };
    signal?.addEventListener('abort', cancel, {once: true});
    try {
        for (;;) {
            if (signal?.aborted === true) {
                return;
            }
            const chunk = await reader.read();
            if (chunk.done) {
                return;
            }
            buffer += decoder.decode(chunk.value, {stream: true});
            let newline = buffer.indexOf('\n');
            while (newline !== -1) {
                const line = buffer.slice(0, newline).replace(/\r$/, '');
                buffer = buffer.slice(newline + 1);
                newline = buffer.indexOf('\n');
                if (line === '') {
                    const event = parseEvent(data);
                    data = '';
                    if (event) {
                        yield event;
                    }
                    continue;
                }
                if (line.startsWith(':')) {
                    // the heartbeat comment; it exists so that a dead connection is noticed
                    continue;
                }
                if (line.startsWith('data:')) {
                    data += line.slice('data:'.length).trimStart();
                }
            }
        }
    } finally {
        signal?.removeEventListener('abort', cancel);
        // a reader that is not released keeps the socket, and the provider reconnects into it
        reader.releaseLock();
    }
}

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
