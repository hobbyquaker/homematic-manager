/**
 * D-40: the login of the addon when it runs on openccu-lite.
 *
 * The CCU case (D-32, task 18) is unchanged and untouched: a user name and a password, checked
 * against ReGa's user list and the CCU's authentication daemon on UDP 1998, both loopback-only.
 * openccu-lite has neither - there is no ReGaHSS, and its own users live in `occulited` - so the
 * question is a different one, and so is the answer.
 *
 * On openccu-lite nobody logs in *here*. The box's shell has already done it, lighttpd's gate has
 * already refused everyone who has no session (their D-28), and the shell opens an addon page with
 * the session on the URL: `?sid=@xxxxxxxxxx@`, the CCU convention. On an image from before their
 * task 125 that session id **is** a valid credential for the box's own APIs, so the check is one
 * request (on a newer image the shell sends the gate's `X-Occulite-Session` instead, see below):
 *
 * ```
 * GET /api/meta/v1/enums   Authorization: Bearer <sid>   ->  200 valid, 401 not
 * ```
 *
 * and nothing else is believed. The name of the user behind it comes from `/api/auth/v1/state`
 * afterwards, best effort, only so that the UI can show who is logged in - a box that answers the
 * first call and not the second still lets the session in.
 *
 * The metadata API and not the auth API for the decision, on purpose: it is the one openccu-lite
 * declares normative (their D-16), it is the API this application depends on anyway, and a session
 * that cannot read the metadata store is of no use to a device manager whatever else it can do.
 */

/** What the check answers with: who it is, in the shape the rest of the host already speaks. */
export interface OcculiteSession {
    readonly name: string;
    /**
     * ReGa's `UserLevel()`, so that `SessionInfo` keeps one meaning across the two boxes: 8 for an
     * administrator, 2 for a user. openccu-lite has exactly those two roles.
     */
    readonly level: number;
    /** The session id, which is also the credential every write to the box goes out with. */
    readonly sid: string;
}

export interface OcculiteAuthOptions {
    /** `http://127.0.0.1` on the box; a test points it at its own server. */
    readonly baseUrl: string;
    readonly timeoutMs?: number;
    readonly fetch?: typeof globalThis.fetch;
    readonly onNotice?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

export const OCCULITE_TIMEOUT_MS = 5000;

/**
 * B-94, D-65: the header openccu-lite's lighttpd gate sets on every request it lets through under
 * `/addons/`, to the bare id of the session it found (from either session cookie or `?sid=`). The
 * gate removes a copy the client sent first. A CCU has no gate and passes a client's header through,
 * an older openccu-lite image does the same, and the backend's port is open to every process on the
 * box - so the header is only a claim, and the box is asked about it like about any other session.
 */
export const OCCULITE_SESSION_HEADER = 'x-occulite-session';

export interface OcculiteCheckOptions {
    /**
     * The addon contract's validation (openccu-lite `docs/PORTING-PROMPT.md`): the session only
     * counts when `GET /api/auth/v1/state` confirms it. The `?sid=` hand-over keeps the D-40 check,
     * where that second answer only supplies the name.
     */
    readonly requireState?: boolean;
}

/**
 * B-36: what an openccu-lite session id looks like, and nothing else is one.
 *
 * - **Since openccu-lite task 125** (occulited `1f71597`, their D-77) a session id is what Go's
 *   `crypto/rand.Text` hands out: 26 characters of base32, `A-Z` and `2-7`. The box's API and its gate
 *   match exactly this (`sidRe`, the gate's `SID_PATTERN`).
 * - **Before task 125** it was the CCU's shape, ten of `[0-9a-zA-Z]` (auth-off's fixed id too). Since
 *   then that shape is only a session's *legacy alias*, which the addon CGIs parse and the box's API
 *   refuses as a credential from anywhere. The two cannot be told apart by their characters: a
 *   ten-character value is a session on an older box and never one on a newer box.
 * - **An API token** (`olt_` and 32 hex digits) is neither and is never a session: the header path
 *   asks `/api/auth/v1/state`, which also answers for a token.
 *
 * A value of another shape or length cannot be an openccu-lite session on any image, so it is refused
 * here, without asking the box.
 */
const SESSION_ID = /^[A-Z2-7]{26}$/;
const LEGACY_ID = /^[0-9a-zA-Z]{10}$/;

/** A session id as the shell or the gate hands it over, `@…@` and all, or `undefined` when it is not one. */
export function parseSid(value: string | null | undefined): string | undefined {
    const bare = (value ?? '').replace(/^@|@$/g, '').trim();
    return SESSION_ID.test(bare) || LEGACY_ID.test(bare) ? bare : undefined;
}

/**
 * B-36: can the `?sid=` of a request be a session of the box whose gate named `gate`?
 *
 * A gate header of the 26-character shape says the box issues session ids of that shape (task 125),
 * so a `?sid=` of any other shape there is the session's legacy alias, which the box's API refuses:
 * the answer is known without asking. Without such a header - a CCU, an image from before the header,
 * a ten-character header - nothing can be concluded, and the box decides as before. This only ever
 * *refuses*: a `true` still has to be confirmed by the box.
 */
export function sidCanBeSession(sid: string, gate: string | undefined): boolean {
    return gate === undefined || !SESSION_ID.test(gate) || SESSION_ID.test(sid);
}

/** Checks a session id against the box that issued it. */
export class OcculiteAuthenticator {
    readonly #options: OcculiteAuthOptions;
    readonly #fetch: typeof globalThis.fetch;

    constructor(options: OcculiteAuthOptions) {
        this.#options = options;
        this.#fetch = options.fetch ?? globalThis.fetch;
    }

    get baseUrl(): string {
        return this.#options.baseUrl.replace(/\/$/, '');
    }

    /**
     * The session, or `undefined` - which is the answer for an unknown id, an expired one and a box
     * that cannot be asked alike. A caller cannot tell them apart, and therefore cannot use this to
     * find out whether a session exists.
     */
    async check(
        rawSid: string | null | undefined,
        options: OcculiteCheckOptions = {},
    ): Promise<OcculiteSession | undefined> {
        const sid = parseSid(rawSid);
        if (sid === undefined) {
            return undefined;
        }
        try {
            const response = await this.#fetch(`${this.baseUrl}/api/meta/v1/enums`, {
                signal: AbortSignal.timeout(this.#options.timeoutMs ?? OCCULITE_TIMEOUT_MS),
                headers: {Authorization: `Bearer ${sid}`, Accept: 'application/json'},
            });
            if (response.status === 401 || response.status === 403) {
                return undefined;
            }
            if (!response.ok) {
                this.#options.onNotice?.('warn', `the box answered ${String(response.status)} for a session check`);
                return undefined;
            }
        } catch (error) {
            this.#options.onNotice?.('warn', `the box could not be asked about a session: ${String(error)}`);
            return undefined;
        }
        const who = await this.#who(sid);
        if (who === undefined && options.requireState === true) {
            this.#options.onNotice?.('warn', 'the box did not confirm the session of the X-Occulite-Session header');
            return undefined;
        }
        return {sid, name: who?.name ?? 'openccu-lite', level: who?.level ?? 2};
    }

    /**
     * Who the session belongs to. Best effort: the session is already valid at this point, and a
     * name that could not be read costs a label in the header and nothing else.
     */
    async #who(sid: string): Promise<{name: string; level: number} | undefined> {
        try {
            const response = await this.#fetch(`${this.baseUrl}/api/auth/v1/state`, {
                signal: AbortSignal.timeout(this.#options.timeoutMs ?? OCCULITE_TIMEOUT_MS),
                headers: {Authorization: `Bearer ${sid}`, Accept: 'application/json'},
            });
            if (!response.ok) {
                return undefined;
            }
            const body = (await response.json()) as {user?: unknown; role?: unknown; authenticated?: unknown};
            if (body.authenticated !== true || typeof body.user !== 'string') {
                return undefined;
            }
            return {name: body.user, level: body.role === 'admin' ? 8 : 2};
        } catch {
            return undefined;
        }
    }
}
