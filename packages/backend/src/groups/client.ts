/**
 * Task 57: the HTTP client for openccu-lite's heating groups - `/api/system/v1/groups`.
 *
 * The heating groups (the `VirtualDevices` group devices `INT000000N`) are the group process's,
 * and that process has no RPC method to create one, change its members or delete it: the CCU's
 * WebUI does all of that through the process's own HTTP pages, behind a WebUI session. On
 * openccu-lite the box's `occulited` is the one client of those pages and offers them as a plain
 * JSON API with the box's own login - the one this application already has for the metadata store
 * (D-40). This client speaks that API and nothing else; on a CCU it is never built.
 *
 * Like the metadata client: `fetch` and `AbortSignal` only, a typed answer or a thrown
 * {@link BackendError} whose `kind` says what the UI should make of it. The box's error body
 * (`{error, message}`) is kept, because its message is the one worth showing - "there is no group
 * 7", "members: hmipserver's device ids, as GET /groups/types lists them".
 */

import type {
    HeatingGroup,
    HeatingGroupChange,
    HeatingGroupDetail,
    HeatingGroupList,
    HeatingGroupMember,
    HeatingGroupType,
    HeatingGroupsState,
} from '@homematic-manager/core';

import {BackendError} from '../errors.js';

/**
 * How long a call may take. A change makes the box's group process configure direct links, and the
 * box itself waits up to thirty seconds for that process before it answers `502`; this has to
 * outlast it, or the UI reports a timeout for a change that went through.
 */
export const GROUPS_TIMEOUT_MS = 45_000;

export interface HeatingGroupsClientOptions {
    /** `http://ccu` or `http://127.0.0.1` - scheme and authority, no path. */
    readonly baseUrl: string;
    /**
     * The credential every call goes out with. Reads need the box's `system:read`, changes
     * `system:write`: the person's session on the box, or the API token off it. Never the addon's
     * local token by choice - it reads metadata and nothing else, and the box answers 403.
     */
    readonly credential: () => string | undefined;
    readonly timeoutMs?: number;
    /** Injected by the tests. */
    readonly fetch?: typeof globalThis.fetch;
}

/** The box refused or could not answer; `status` and `code` are what it said. */
export class HeatingGroupsApiError extends BackendError {
    readonly status: number;
    /** The API's error word: `unknown-group`, `invalid`, `unsupported`, `hmipserver`, `forbidden`. */
    readonly code: string;

    constructor(status: number, code: string, message: string) {
        super({message, kind: kindOf(status, code)});
        this.name = 'HeatingGroupsApiError';
        this.status = status;
        this.code = code;
    }
}

/**
 * What the UI should make of a status: a credential problem is `config` (the settings dialog is
 * where the token lives), a refused body or an id the box no longer has is `validation` (the
 * dialog shows the message), a box or group process that does not answer is `connection`.
 */
function kindOf(status: number, code: string): BackendError['kind'] {
    if (status === 401 || status === 403 || code === 'unsupported') {
        return 'config';
    }
    if (status === 404 || status === 422 || status === 400) {
        return 'validation';
    }
    if (status === 502 || status === 503 || status === 504) {
        return 'connection';
    }
    return 'internal';
}

/** What the box's list answers with; the wire shape, before it becomes the contract's. */
interface GroupWire {
    id: number;
    name: string;
    type: string;
    type_label?: string;
    device: string;
    ref: string;
}

interface DetailWire {
    id: number;
    name: string;
    type: string;
    device: string;
    ref: string;
    device_name?: string;
    forbid_single_operation?: boolean;
    members?: HeatingGroupMember[];
    assignable?: HeatingGroupMember[];
    leftover?: HeatingGroupMember[];
    types?: Array<{id: string; label: string}>;
    devices_to_configure?: HeatingGroupMember[];
}

export class HeatingGroupsClient {
    readonly #options: HeatingGroupsClientOptions;
    readonly #fetch: typeof globalThis.fetch;

    constructor(options: HeatingGroupsClientOptions) {
        this.#options = options;
        this.#fetch = options.fetch ?? globalThis.fetch;
    }

    get baseUrl(): string {
        return this.#options.baseUrl;
    }

    /**
     * Does this box have the groups API, and may this credential read it? One `GET /groups`; the
     * answer's status is the whole result. Never throws: the state is what the UI decides the tab by.
     */
    async probe(): Promise<HeatingGroupsState> {
        try {
            await this.#json('GET', '/groups');
            return {available: true};
        } catch (error) {
            if (error instanceof HeatingGroupsApiError) {
                if (error.code === 'unsupported') {
                    return {available: false, reason: 'unsupported', message: error.message};
                }
                if (error.status === 401 || error.status === 403) {
                    return {available: false, reason: 'forbidden', message: error.message};
                }
                if (error.status === 404) {
                    // an older box: the route itself is missing, not a group
                    return {available: false, reason: 'not-offered', message: error.message};
                }
            }
            return {available: false, reason: 'error', message: error instanceof Error ? error.message : String(error)};
        }
    }

    /**
     * `GET /groups`, then each group once for its members - the list itself names none, and a
     * grid of groups without their members would say nothing. A group whose detail fails (deleted
     * between the two calls) is listed without members rather than failing the list.
     */
    async list(): Promise<HeatingGroupList> {
        const answer = (await this.#json('GET', '/groups')) as {
            groups?: GroupWire[];
            devices_to_configure?: HeatingGroupMember[];
        };
        const groups = await Promise.all(
            (answer.groups ?? []).map(async (wire): Promise<HeatingGroup> => {
                let members: HeatingGroupMember[] = [];
                try {
                    members = (await this.get(wire.id)).members;
                } catch {
                    // listed without members; the next refresh has them, or the group is gone
                }
                return {...toGroup(wire), members};
            }),
        );
        return {groups, devicesToConfigure: answer.devices_to_configure ?? []};
    }

    /** `GET /groups/types` - what a new group can be, and what each type could take now. */
    async types(): Promise<HeatingGroupType[]> {
        const answer = (await this.#json('GET', '/groups/types')) as {types?: Partial<HeatingGroupType>[]};
        return (answer.types ?? []).map((type) => ({
            id: type.id ?? '',
            label: type.label ?? type.id ?? '',
            assignable: type.assignable ?? [],
            leftover: type.leftover ?? [],
        }));
    }

    /** `GET /groups/{id}`. */
    async get(id: number): Promise<HeatingGroupDetail> {
        return toDetail((await this.#json('GET', `/groups/${String(id)}`)) as DetailWire);
    }

    /** `POST /groups` - the box's `create` then `save`, and the metadata side effects in one go. */
    async create(name: string, type: string, members: readonly string[]): Promise<HeatingGroupChange> {
        return toChange((await this.#json('POST', '/groups', {name, type, members: [...members]})) as DetailWire);
    }

    /**
     * `PUT /groups/{id}` - the name and the members as a whole; a field left out keeps its value.
     * Adding and removing is this call with the new list, exactly as the WebUI saved it.
     */
    async update(
        id: number,
        change: {readonly name?: string | undefined; readonly members?: readonly string[] | undefined},
    ): Promise<HeatingGroupChange> {
        const body = {
            ...(change.name === undefined ? {} : {name: change.name}),
            ...(change.members === undefined ? {} : {members: [...change.members]}),
        };
        return toChange((await this.#json('PUT', `/groups/${String(id)}`, body)) as DetailWire);
    }

    /** `DELETE /groups/{id}` - answers with the former members, whose group membership is gone. */
    async remove(id: number): Promise<HeatingGroupMember[]> {
        const answer = (await this.#json('DELETE', `/groups/${String(id)}`)) as {
            former_members?: HeatingGroupMember[];
        };
        return answer.former_members ?? [];
    }

    #url(route: string): string {
        return `${this.#options.baseUrl.replace(/\/$/, '')}/api/system/v1${route}`;
    }

    async #json(method: 'GET' | 'POST' | 'PUT' | 'DELETE', route: string, body?: unknown): Promise<unknown> {
        const credential = this.#options.credential();
        let response: Response;
        try {
            response = await this.#fetch(this.#url(route), {
                method,
                signal: AbortSignal.timeout(this.#options.timeoutMs ?? GROUPS_TIMEOUT_MS),
                headers: {
                    Accept: 'application/json',
                    ...(body === undefined ? {} : {'Content-Type': 'application/json'}),
                    ...(credential === undefined ? {} : {Authorization: `Bearer ${credential}`}),
                },
                ...(body === undefined ? {} : {body: JSON.stringify(body)}),
            });
        } catch (error) {
            // the box is off, or the change outlasted the timeout above
            throw new BackendError(
                {
                    message: `the groups API at ${this.#options.baseUrl} did not answer: ${errorText(error)}`,
                    kind: 'connection',
                },
                {cause: error},
            );
        }
        if (!response.ok) {
            throw await refusal(response);
        }
        if (response.status === 204) {
            return {};
        }
        try {
            return await response.json();
        } catch (error) {
            throw new BackendError(
                {message: `the groups API answered ${String(response.status)} without JSON`, kind: 'internal'},
                {cause: error},
            );
        }
    }
}

function toGroup(wire: GroupWire): Omit<HeatingGroup, 'members'> {
    return {
        id: wire.id,
        name: wire.name,
        type: wire.type,
        typeLabel: wire.type_label ?? wire.type,
        device: wire.device,
        ref: wire.ref,
    };
}

function toDetail(wire: DetailWire): HeatingGroupDetail {
    const types = wire.types ?? [];
    return {
        id: wire.id,
        name: wire.name,
        type: wire.type,
        typeLabel: types.find((type) => type.id === wire.type)?.label ?? wire.type,
        device: wire.device,
        ref: wire.ref,
        deviceName: wire.device_name ?? '',
        forbidSingleOperation: wire.forbid_single_operation === true,
        members: wire.members ?? [],
        assignable: wire.assignable ?? [],
        leftover: wire.leftover ?? [],
        types,
    };
}

function toChange(wire: DetailWire): HeatingGroupChange {
    return {...toDetail(wire), devicesToConfigure: wire.devices_to_configure ?? []};
}

/** The API's `{error, message}` body as the error, or the status when there is none. */
async function refusal(response: Response): Promise<HeatingGroupsApiError> {
    let code = response.status === 401 || response.status === 403 ? 'forbidden' : 'error';
    let message = `${String(response.status)} ${response.statusText}`.trim();
    try {
        const body = (await response.json()) as {error?: unknown; message?: unknown};
        if (typeof body.error === 'string') {
            code = body.error;
        }
        if (typeof body.message === 'string') {
            message = body.message;
        }
    } catch {
        // not JSON: lighttpd's own error page, or a box that is not openccu-lite at all
    }
    if (response.status === 401 || response.status === 403) {
        message = `the system refused the credential for the heating groups (${String(response.status)}): ${message}`;
    }
    return new HeatingGroupsApiError(response.status, code, message);
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
