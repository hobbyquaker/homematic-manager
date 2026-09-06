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
 * the session on the URL: `?sid=@xxxxxxxxxx@`, the CCU convention. That session id **is** a valid
 * credential for the box's own APIs, so the check is one request:
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

/** A session id as the shell hands it over, `@…@` and all, or `undefined` when it is not one. */
export function parseSid(value: string | null | undefined): string | undefined {
    const bare = (value ?? '').replace(/^@|@$/g, '').trim();
    return /^[0-9a-zA-Z]{6,64}$/.test(bare) ? bare : undefined;
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
    async check(rawSid: string | null | undefined): Promise<OcculiteSession | undefined> {
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
