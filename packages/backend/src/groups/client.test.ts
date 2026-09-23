/**
 * The heating groups client against a `fetch` that answers whatever the test needs (task 57).
 *
 * What is asserted is the protocol: which URL a call goes to, that every call carries the one
 * credential, what a body looks like, how the box's `snake_case` becomes the contract's shape, and
 * what each refusal becomes - the status decides the `kind` the UI acts on, the box's message is
 * kept. The shapes are the ones the box answered in the lab (the OVA, occulited `8b2d8b5`): the
 * list with `type_label` and `devices_to_configure`, the types with `assignable` and `leftover`,
 * `404 unknown-group` for an id the list does not have.
 */

import {describe, expect, it} from 'vitest';

import {BackendError} from '../errors.js';
import {GROUPS_TIMEOUT_MS, HeatingGroupsApiError, HeatingGroupsClient} from './client.js';

interface Call {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: unknown;
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
}

/** A `fetch` that records what it was asked and answers by route. */
function box(
    routes: Record<string, Response | ((call: Call) => Response)>,
    // `null` is "no credential at all"; `undefined` would only pick the default
    credential: string | null = 'olt_0123456789abcdef0123456789abcdef',
): {client: HeatingGroupsClient; calls: Call[]} {
    const calls: Call[] = [];
    const fetchImpl = ((input: string | URL, init?: RequestInit) => {
        const headers = Object.fromEntries(
            Object.entries((init?.headers ?? {}) as Record<string, string>).map(([key, value]) => [
                key.toLowerCase(),
                value,
            ]),
        );
        const call: Call = {
            url: String(input),
            method: init?.method ?? 'GET',
            headers,
            ...(typeof init?.body === 'string' ? {body: JSON.parse(init.body) as unknown} : {}),
        };
        calls.push(call);
        const route = `${call.method} ${call.url.replace('http://box/api/system/v1', '')}`;
        const answer = routes[route];
        if (answer === undefined) {
            return Promise.resolve(json({error: 'unknown-path', message: `no route ${route}`}, 404));
        }
        return Promise.resolve(typeof answer === 'function' ? answer(call) : answer);
    }) as unknown as typeof globalThis.fetch;
    return {
        client: new HeatingGroupsClient({
            baseUrl: 'http://box',
            credential: () => credential ?? undefined,
            fetch: fetchImpl,
        }),
        calls,
    };
}

const SEC_SC = {id: 'KEQ0165114', serial: 'KEQ0165114', type: 'HM-Sec-SC'};
const WRC2_1 = {id: '000193C9951175:1', serial: '000193C9951175:1', type: 'REMOTE_CONTROL'};

const LIST = {
    groups: [
        {
            id: 1,
            name: 'Bad',
            type: 'HomeMatic.heating',
            type_label: 'Heating_Control',
            device: 'INT0000001',
            ref: 'VirtualDevices.INT0000001',
        },
        {
            id: 2,
            name: 'Flur',
            type: 'hmip.heating.group',
            type_label: 'HmIP-Heizungssteuerung',
            device: 'INT0000002',
            ref: 'VirtualDevices.INT0000002',
        },
    ],
    devices_to_configure: [SEC_SC],
};

const DETAIL_1 = {
    id: 1,
    name: 'Bad',
    type: 'HomeMatic.heating',
    device: 'INT0000001',
    ref: 'VirtualDevices.INT0000001',
    device_name: '',
    forbid_single_operation: false,
    members: [SEC_SC],
    assignable: [],
    leftover: [],
    types: [
        {id: 'HomeMatic.heating', label: 'Heating_Control'},
        {id: 'hmip.heating.group', label: 'HmIP-Heizungssteuerung'},
    ],
};

describe('the list', () => {
    it('reads the groups, then each one for its members, and carries the devices to configure', async () => {
        const {client, calls} = box({
            'GET /groups': json(LIST),
            'GET /groups/1': json(DETAIL_1),
            'GET /groups/2': json({...DETAIL_1, id: 2, name: 'Flur', type: 'hmip.heating.group', members: [WRC2_1]}),
        });
        const list = await client.list();
        expect(list.devicesToConfigure).toEqual([SEC_SC]);
        expect(list.groups).toEqual([
            {
                id: 1,
                name: 'Bad',
                type: 'HomeMatic.heating',
                typeLabel: 'Heating_Control',
                device: 'INT0000001',
                ref: 'VirtualDevices.INT0000001',
                members: [SEC_SC],
            },
            expect.objectContaining({id: 2, name: 'Flur', typeLabel: 'HmIP-Heizungssteuerung', members: [WRC2_1]}),
        ]);
        expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
            'GET http://box/api/system/v1/groups',
            'GET http://box/api/system/v1/groups/1',
            'GET http://box/api/system/v1/groups/2',
        ]);
        // one credential for everything, as a bearer token
        for (const call of calls) {
            expect(call.headers['authorization']).toBe('Bearer olt_0123456789abcdef0123456789abcdef');
            expect(call.headers['accept']).toBe('application/json');
        }
    });

    it('lists a group whose detail is gone in between without members rather than failing the list', async () => {
        const {client} = box({
            'GET /groups': json(LIST),
            'GET /groups/1': json(DETAIL_1),
            'GET /groups/2': json({error: 'unknown-group', message: 'there is no group 2'}, 404),
        });
        const list = await client.list();
        expect(list.groups.map((group) => [group.id, group.members.length])).toEqual([
            [1, 1],
            [2, 0],
        ]);
    });

    it('answers an empty box with empty lists', async () => {
        const {client} = box({'GET /groups': json({groups: [], devices_to_configure: []})});
        expect(await client.list()).toEqual({groups: [], devicesToConfigure: []});
    });
});

describe('the types', () => {
    it('lists what a new group can be, with what each type could take and what is already connected', async () => {
        const {client} = box({
            'GET /groups/types': json({
                types: [
                    {id: 'HomeMatic.heating', label: 'Heating_Control', assignable: [SEC_SC], leftover: []},
                    {id: 'hmip.heating.group', label: 'HmIP-Heizungssteuerung', assignable: [], leftover: [WRC2_1]},
                ],
            }),
        });
        const types = await client.types();
        expect(types).toEqual([
            {id: 'HomeMatic.heating', label: 'Heating_Control', assignable: [SEC_SC], leftover: []},
            {id: 'hmip.heating.group', label: 'HmIP-Heizungssteuerung', assignable: [], leftover: [WRC2_1]},
        ]);
    });
});

describe('one group', () => {
    it('maps the editor view into the contract, with the type label looked up among the types', async () => {
        const {client} = box({'GET /groups/1': json(DETAIL_1)});
        const detail = await client.get(1);
        expect(detail).toEqual({
            id: 1,
            name: 'Bad',
            type: 'HomeMatic.heating',
            typeLabel: 'Heating_Control',
            device: 'INT0000001',
            ref: 'VirtualDevices.INT0000001',
            deviceName: '',
            forbidSingleOperation: false,
            members: [SEC_SC],
            assignable: [],
            leftover: [],
            types: DETAIL_1.types,
        });
    });

    it('turns 404 unknown-group into a validation error carrying the box’s message', async () => {
        const {client} = box({'GET /groups/7': json({error: 'unknown-group', message: 'there is no group 7'}, 404)});
        const error = await client.get(7).catch((thrown: unknown) => thrown);
        expect(error).toBeInstanceOf(HeatingGroupsApiError);
        expect(error).toMatchObject({
            kind: 'validation',
            status: 404,
            code: 'unknown-group',
            message: 'there is no group 7',
        });
    });
});

describe('the changes', () => {
    it('creates a group with name, type and members, and answers the group plus the devices to configure', async () => {
        const {client, calls} = box({
            'POST /groups': (call) =>
                json({...DETAIL_1, id: 3, name: (call.body as {name: string}).name, devices_to_configure: [SEC_SC]}),
        });
        const change = await client.create('Küche', 'HomeMatic.heating', ['KEQ0165114']);
        expect(calls[0]).toMatchObject({
            method: 'POST',
            url: 'http://box/api/system/v1/groups',
            body: {name: 'Küche', type: 'HomeMatic.heating', members: ['KEQ0165114']},
        });
        expect(calls[0]?.headers['content-type']).toBe('application/json');
        expect(change).toMatchObject({id: 3, name: 'Küche', members: [SEC_SC], devicesToConfigure: [SEC_SC]});
    });

    it('sends the name and the members as a whole on an update, and leaves out what is not changed', async () => {
        const {client, calls} = box({
            // a function: a `Response` body can be read once, and this route answers twice
            'PUT /groups/1': () => json({...DETAIL_1, members: [], devices_to_configure: []}),
        });
        await client.update(1, {members: []});
        expect(calls[0]).toMatchObject({method: 'PUT', url: 'http://box/api/system/v1/groups/1', body: {members: []}});
        expect(calls[0]?.body).not.toHaveProperty('name');

        await client.update(1, {name: 'Bad oben', members: ['KEQ0165114']});
        expect(calls[1]?.body).toEqual({name: 'Bad oben', members: ['KEQ0165114']});
    });

    it('deletes a group and answers with its former members', async () => {
        const {client, calls} = box({'DELETE /groups/1': json({deleted: true, former_members: [SEC_SC]})});
        expect(await client.remove(1)).toEqual([SEC_SC]);
        expect(calls[0]).toMatchObject({method: 'DELETE', url: 'http://box/api/system/v1/groups/1'});
    });

    it('turns 422 invalid into a validation error with the field the box named', async () => {
        const {client} = box({
            'POST /groups': json({error: 'invalid', message: 'name: 1 to 64 characters on one line'}, 422),
        });
        await expect(client.create('', 'HomeMatic.heating', [])).rejects.toMatchObject({
            kind: 'validation',
            code: 'invalid',
            message: 'name: 1 to 64 characters on one line',
        });
    });
});

describe('the refusals', () => {
    it('is a config problem when the credential is refused, told apart from a missing route', async () => {
        const {client} = box({'PUT /groups/1': json({error: 'forbidden', message: 'system:write needed'}, 403)});
        const error = await client.update(1, {name: 'x'}).catch((thrown: unknown) => thrown);
        expect(error).toMatchObject({kind: 'config', status: 403, code: 'forbidden'});
        expect((error as Error).message).toContain('system:write needed');
        expect((error as Error).message).toContain('the system refused');
        expect((error as Error).message).toContain('403');
    });

    it('is a connection problem when the box cannot reach its group process, and when the box is off', async () => {
        const {client} = box({'GET /groups': json({error: 'hmipserver', message: 'errorCode 42'}, 502)});
        await expect(client.list()).rejects.toMatchObject({kind: 'connection', code: 'hmipserver'});

        const off = new HeatingGroupsClient({
            baseUrl: 'http://box',
            credential: () => 'olt_x',
            fetch: () => Promise.reject(new TypeError('fetch failed')),
        });
        const error = await off.list().catch((thrown: unknown) => thrown);
        expect(error).toBeInstanceOf(BackendError);
        expect(error).toMatchObject({kind: 'connection'});
        expect((error as Error).message).toContain('fetch failed');
    });

    it('keeps the status when the answer is no JSON at all - a proxy error page', async () => {
        const {client} = box({
            'GET /groups': new Response('<html>Bad Gateway</html>', {status: 502, statusText: 'Bad Gateway'}),
        });
        await expect(client.list()).rejects.toMatchObject({
            kind: 'connection',
            status: 502,
            message: '502 Bad Gateway',
        });
    });

    it('sends no Authorization header without a credential, so the box answers 401 and says so', async () => {
        const {client, calls} = box(
            {'GET /groups': json({error: 'unauthenticated', message: 'login required'}, 401)},
            null,
        );
        await expect(client.list()).rejects.toMatchObject({kind: 'config', status: 401});
        expect(calls[0]?.headers['authorization']).toBeUndefined();
    });

    it('outlasts the thirty seconds the box waits for its group process', () => {
        expect(GROUPS_TIMEOUT_MS).toBeGreaterThan(30_000);
    });
});

describe('the probe', () => {
    it('says available when the list answers, whatever it holds', async () => {
        const {client} = box({'GET /groups': json({groups: [], devices_to_configure: []})});
        expect(await client.probe()).toEqual({available: true});
    });

    it('names the reason otherwise: no group process, an older box, a credential without the right, anything else', async () => {
        const unsupported = box({'GET /groups': json({error: 'unsupported', message: 'no hmipserver port'}, 501)});
        expect(await unsupported.client.probe()).toEqual({
            available: false,
            reason: 'unsupported',
            message: 'no hmipserver port',
        });

        const older = box({});
        expect(await older.client.probe()).toMatchObject({available: false, reason: 'not-offered'});

        const forbidden = box({'GET /groups': json({error: 'forbidden', message: 'system:read needed'}, 403)});
        expect(await forbidden.client.probe()).toMatchObject({available: false, reason: 'forbidden'});

        const down = box({'GET /groups': json({error: 'hmipserver', message: 'errorCode 42'}, 502)});
        expect(await down.client.probe()).toEqual({available: false, reason: 'error', message: 'errorCode 42'});

        const off = new HeatingGroupsClient({
            baseUrl: 'http://box',
            credential: () => undefined,
            fetch: () => Promise.reject(new TypeError('fetch failed')),
        });
        expect(await off.probe()).toMatchObject({available: false, reason: 'error'});
    });
});
