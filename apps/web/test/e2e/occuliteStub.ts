/**
 * A stand-in for openccu-lite's `occulited`, as far as the Groups tab needs one (task 57).
 *
 * The e2e suite has no system with a group process, so this answers what the backend asks of one:
 * the metadata API's detection, snapshot and event stream - enough for the `occulite` provider to
 * come up and hand the names out - and the heating groups API with a small in-memory store behind
 * it, in the shapes the real system answered in the lab. Every groups request is recorded, because
 * what goes over the wire is half of what the spec asserts: the members as a whole, an unchanged
 * name left out.
 *
 * Test scaffolding for one spec, kept here rather than in `apps/web/src` for the same reason the
 * fixtures are: `apps/web` is a published package.
 */

import http from 'node:http';
import type {AddressInfo, Socket} from 'node:net';

/** The API token the spec configures; the stub accepts this one and nothing else. */
export const STUB_TOKEN = 'olt_0123456789abcdef0123456789abcdef';

export interface StubMember {
    id: string;
    serial: string;
    type: string;
}

export interface StubGroup {
    id: number;
    name: string;
    type: string;
    members: string[];
}

/** A device the stub knows: its address, type and the name its metadata store hands out. */
export interface StubDevice {
    address: string;
    type: string;
    name: string;
    /** The group type it fits, or none. */
    fits?: string;
    /** Already connected elsewhere: listed as leftover, never assignable. */
    connected?: boolean;
}

export interface OcculiteStub {
    readonly url: string;
    /** The groups as the stub holds them now. */
    readonly groups: StubGroup[];
    /** Every request under the groups API, oldest first: `PUT /groups/1 {"members":[]}`. */
    readonly requests: string[];
    close(): Promise<void>;
}

const TYPES = [
    {id: 'HomeMatic.heating', label: 'Heating_Control'},
    {id: 'hmip.heating.group', label: 'HmIP-Heizungssteuerung'},
];

function serial(id: number): string {
    return `INT${String(id).padStart(7, '0')}`;
}

export async function startOcculiteStub(options: {devices: StubDevice[]; groups?: StubGroup[]}): Promise<OcculiteStub> {
    const groups: StubGroup[] = structuredClone(options.groups ?? []);
    const requests: string[] = [];
    const sockets = new Set<Socket>();
    let nextId = groups.reduce((max, group) => Math.max(max, group.id), 0) + 1;
    let revision = 1;

    const member = (device: StubDevice): StubMember => ({
        id: device.address,
        serial: device.address,
        type: device.type,
    });
    const inGroup = (address: string): boolean => groups.some((group) => group.members.includes(address));
    const assignable = (type: string): StubMember[] =>
        options.devices
            .filter((device) => device.fits === type && device.connected !== true && !inGroup(device.address))
            .map(member);
    const leftover = (type: string): StubMember[] =>
        options.devices.filter((device) => device.fits === type && device.connected === true).map(member);
    const members = (group: StubGroup): StubMember[] =>
        group.members.map((address) => {
            const device = options.devices.find((entry) => entry.address === address);
            return device === undefined ? {id: address, serial: address, type: ''} : member(device);
        });
    const detail = (group: StubGroup): Record<string, unknown> => ({
        id: group.id,
        name: group.name,
        type: group.type,
        device: serial(group.id),
        ref: `VirtualDevices.${serial(group.id)}`,
        device_name: '',
        forbid_single_operation: false,
        members: members(group),
        assignable: assignable(group.type),
        leftover: leftover(group.type),
        types: TYPES,
    });
    const snapshot = (): Record<string, unknown> => ({
        format: 1,
        revision,
        objects: Object.fromEntries(
            options.devices.map((device) => [
                `${device.address.startsWith('00') ? 'HmIP-RF' : 'BidCos-RF'}.${device.address}`,
                {name: device.name, enums: [], meta: {}},
            ]),
        ),
        enums: {
            room: {name: {en: 'Rooms', de: 'Räume'}, tree: []},
            function: {name: {en: 'Functions', de: 'Gewerke'}, tree: []},
        },
    });

    const readBody = (request: http.IncomingMessage): Promise<string> =>
        new Promise((resolve) => {
            let body = '';
            request.on('data', (chunk: Buffer) => (body += chunk.toString()));
            request.on('end', () => resolve(body));
        });

    const json = (response: http.ServerResponse, status: number, body: unknown): void => {
        response.writeHead(status, {'Content-Type': 'application/json'});
        response.end(JSON.stringify(body));
    };

    const server = http.createServer((request, response) => {
        void (async () => {
            const url = new URL(request.url ?? '/', 'http://stub');
            const method = request.method ?? 'GET';
            const body = method === 'GET' || method === 'DELETE' ? '' : await readBody(request);

            if (url.pathname.startsWith('/api/meta/v1/')) {
                const route = url.pathname.slice('/api/meta/v1'.length);
                if (route === '/version') {
                    json(response, 200, {
                        api: 'meta',
                        version: 1,
                        format: 1,
                        revision,
                        implementation: 'occulite-stub',
                    });
                } else if (route === '/snapshot') {
                    json(response, 200, snapshot());
                } else if (route === '/events/sse') {
                    // the stream stays open until the stub is closed; the provider follows it
                    response.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache'});
                    response.write(': hello\n\n');
                } else {
                    json(response, 200, {revision, changed: false});
                }
                return;
            }

            if (url.pathname.startsWith('/api/system/v1/groups')) {
                const route = url.pathname.slice('/api/system/v1'.length);
                requests.push(body === '' ? `${method} ${route}` : `${method} ${route} ${body}`);
                if (request.headers.authorization !== `Bearer ${STUB_TOKEN}`) {
                    json(response, 401, {error: 'unauthenticated', message: 'login required'});
                    return;
                }
                const idMatch = /^\/groups\/(\d+)$/.exec(route);
                const group = idMatch === null ? undefined : groups.find((entry) => entry.id === Number(idMatch[1]));
                if (route === '/groups' && method === 'GET') {
                    json(response, 200, {
                        groups: groups.map((entry) => ({
                            id: entry.id,
                            name: entry.name,
                            type: entry.type,
                            type_label: TYPES.find((type) => type.id === entry.type)?.label ?? entry.type,
                            device: serial(entry.id),
                            ref: `VirtualDevices.${serial(entry.id)}`,
                        })),
                        devices_to_configure: [],
                    });
                } else if (route === '/groups/types' && method === 'GET') {
                    json(response, 200, {
                        types: TYPES.map((type) => ({
                            ...type,
                            assignable: assignable(type.id),
                            leftover: leftover(type.id),
                        })),
                    });
                } else if (route === '/groups' && method === 'POST') {
                    const wanted = JSON.parse(body) as {name?: string; type?: string; members?: string[]};
                    const name = (wanted.name ?? '').trim();
                    if (name === '' || name.length > 64) {
                        json(response, 422, {error: 'invalid', message: 'name: 1 to 64 characters on one line'});
                        return;
                    }
                    if (!TYPES.some((type) => type.id === wanted.type)) {
                        json(response, 422, {error: 'invalid', message: 'type: one of GET /groups/types'});
                        return;
                    }
                    const created: StubGroup = {
                        id: nextId,
                        name,
                        type: wanted.type ?? '',
                        members: wanted.members ?? [],
                    };
                    nextId += 1;
                    groups.push(created);
                    revision += 1;
                    json(response, 200, {...detail(created), devices_to_configure: members(created)});
                } else if (idMatch !== null && group === undefined) {
                    json(response, 404, {error: 'unknown-group', message: `there is no group ${idMatch[1] ?? ''}`});
                } else if (group !== undefined && method === 'GET') {
                    json(response, 200, detail(group));
                } else if (group !== undefined && method === 'PUT') {
                    const wanted = JSON.parse(body) as {name?: string; members?: string[]};
                    const before = new Set(group.members);
                    if (wanted.name !== undefined) {
                        group.name = wanted.name.trim();
                    }
                    if (wanted.members !== undefined) {
                        group.members = [...wanted.members];
                    }
                    revision += 1;
                    const changed = options.devices
                        .filter((device) => before.has(device.address) !== group.members.includes(device.address))
                        .map(member);
                    json(response, 200, {...detail(group), devices_to_configure: changed});
                } else if (group !== undefined && method === 'DELETE') {
                    groups.splice(groups.indexOf(group), 1);
                    revision += 1;
                    json(response, 200, {deleted: true, former_members: members(group)});
                } else {
                    json(response, 405, {error: 'method-not-allowed', message: `${method} ${route}`});
                }
                return;
            }

            json(response, 404, {error: 'unknown-path', message: url.pathname});
        })();
    });
    server.on('connection', (socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
    });

    await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve());
    });
    const {port} = server.address() as AddressInfo;

    return {
        url: `http://127.0.0.1:${String(port)}`,
        groups,
        requests,
        close: () =>
            new Promise<void>((resolve) => {
                // the event stream holds its socket open; a plain close would wait for it forever
                for (const socket of sockets) {
                    socket.destroy();
                }
                server.close(() => resolve());
            }),
    };
}
