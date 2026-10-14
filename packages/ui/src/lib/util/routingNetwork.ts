import type {DeviceDescription} from '@homematic-manager/core';

import type {RoutingEntry} from './routingTable.js';

/**
 * Task 98: the routing tables of every router merged into one graph of the HmIP network.
 *
 * What a table says (eQ-3's addendum, task 26's parser): per destination the next hop, the
 * distance in hops, the RSSI of the link where the router measured one, and flags - neighbour,
 * static, and what the destination is (access controller, router, portable device). A neighbour
 * (or a destination that is its own next hop) is one hop from the router; anything else is
 * reached through the next hop. The tables are the routers' view: a device that no router lists
 * is assumed to talk to the access point directly, and a router whose table names no access point
 * is assumed to reach it directly too - both drawn as assumed edges, not as measured ones.
 *
 * Sleeping battery devices are listed the same way, from the last time the router heard them; the
 * table carries no age, so an entry can be stale. The view says so instead of pretending.
 */

/** How a table's address resolves to a device of the interface. */
export type Resolver = (id: string) => string;

/**
 * Destinations and next hops are not necessarily the device addresses (serials) the device list
 * uses: an HmIP device also has a 24-bit radio address (`RF_ADDRESS`, decimal in the description).
 * The resolver maps a serial, a decimal radio address and a hexadecimal one (with or without `0x`
 * and leading zeros, any case) to the device's address; anything else stays as it is.
 */
export function routingResolver(devices: readonly DeviceDescription[], accessPoint?: AccessPointRef): Resolver {
    const byAddress = new Map<string, string>();
    const byRadio = new Map<number, string>();
    for (const device of devices) {
        byAddress.set(device.ADDRESS.toUpperCase(), device.ADDRESS);
        if (typeof device.RF_ADDRESS === 'number' && !byRadio.has(device.RF_ADDRESS)) {
            byRadio.set(device.RF_ADDRESS, device.ADDRESS);
        }
    }
    if (accessPoint) {
        byAddress.set(accessPoint.id.toUpperCase(), accessPoint.id);
        for (const radio of accessPoint.radioAddresses) {
            // the access point's radio address names the access point, not its module's device
            byRadio.set(radio, accessPoint.id);
        }
    }
    return (raw: string): string => {
        const id = raw.trim();
        const upper = id.toUpperCase();
        const exact = byAddress.get(upper);
        if (exact !== undefined) {
            return exact;
        }
        if (/^\d+$/.test(id)) {
            const found = byRadio.get(Number(id));
            if (found !== undefined) {
                return found;
            }
        }
        const hex = upper.startsWith('0X') ? upper.slice(2) : upper;
        if (/^[0-9A-F]{1,6}$/.test(hex)) {
            const found = byRadio.get(Number.parseInt(hex, 16));
            if (found !== undefined) {
                return found;
            }
        }
        return id;
    };
}

/** The access point at the centre: its id (the gateway's serial) and the radio addresses it answers to. */
export interface AccessPointRef {
    readonly id: string;
    readonly radioAddresses: readonly number[];
}

export type NetworkNodeKind = 'access-point' | 'router' | 'device';

export interface NetworkNode {
    readonly id: string;
    readonly kind: NetworkNodeKind;
    /** Whether a table names this node at all (`false`: placed on an assumed edge only). */
    readonly listed: boolean;
}

export interface NetworkEdge {
    readonly from: string;
    readonly to: string;
    readonly distance?: number | undefined;
    readonly rssi?: number | undefined;
    readonly isStatic: boolean;
    /** Not from a table: a device no router lists, or a router whose table names no access point. */
    readonly assumed: boolean;
}

/** One route as a router reported it, with the addresses resolved - the table beside the graph. */
export interface NetworkRoute {
    readonly router: string;
    readonly destination: string;
    readonly nextHop: string;
    readonly distance: number;
    readonly rssi: number | undefined;
    readonly neighbour: boolean;
    readonly isStatic: boolean;
}

export interface RoutingNetwork {
    readonly accessPoint: string;
    readonly nodes: NetworkNode[];
    readonly edges: NetworkEdge[];
    readonly routes: NetworkRoute[];
}

export interface RoutingNetworkInput {
    readonly accessPoint: string;
    /** The routers whose tables were read, with their entries. */
    readonly tables: ReadonlyArray<{readonly router: string; readonly entries: readonly RoutingEntry[]}>;
    /** Every device of the interface that belongs in the picture (the access point's own excluded). */
    readonly devices: readonly string[];
    /** The other access points (HAP, DRAP): drawn as such, next to the central one. */
    readonly accessPoints?: readonly string[];
    /** Routers whose module is on but whose table was not read (or not offered). */
    readonly routers?: readonly string[];
    readonly resolve?: Resolver;
}

function pairKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Merges the tables. Edges are undirected and kept once per pair, the measured one before an assumed one. */
export function routingNetwork(input: RoutingNetworkInput): RoutingNetwork {
    const resolve = input.resolve ?? ((id: string) => id);
    const ap = input.accessPoint;
    const otherAccessPoints = new Set(input.accessPoints ?? []);
    const routerIds = new Set([...input.tables.map((table) => table.router), ...(input.routers ?? [])]);
    const nodes = new Map<string, NetworkNode>();
    const edges = new Map<string, NetworkEdge>();
    const routes: NetworkRoute[] = [];

    const kindOf = (id: string, entry?: RoutingEntry): NetworkNodeKind => {
        if (id === ap || otherAccessPoints.has(id) || entry?.accessController === true) {
            return 'access-point';
        }
        return routerIds.has(id) || entry?.router === true ? 'router' : 'device';
    };
    const addNode = (id: string, listed: boolean, entry?: RoutingEntry): void => {
        if (id === '') {
            return;
        }
        const known = nodes.get(id);
        const kind = kindOf(id, entry);
        if (!known) {
            nodes.set(id, {id, kind, listed});
            return;
        }
        // a later sighting can only add knowledge: listed, or a more specific kind
        const rank = {device: 0, router: 1, 'access-point': 2} as const;
        if ((listed && !known.listed) || rank[kind] > rank[known.kind]) {
            nodes.set(id, {
                id,
                kind: rank[kind] > rank[known.kind] ? kind : known.kind,
                listed: known.listed || listed,
            });
        }
    };
    const addEdge = (edge: NetworkEdge): void => {
        if (edge.from === edge.to || edge.from === '' || edge.to === '') {
            return;
        }
        const key = pairKey(edge.from, edge.to);
        const known = edges.get(key);
        const better =
            !known ||
            (known.assumed && !edge.assumed) ||
            (!edge.assumed && known.distance === undefined && edge.distance !== undefined) ||
            (!edge.assumed &&
                edge.distance !== undefined &&
                known.distance !== undefined &&
                edge.distance < known.distance);
        if (better) {
            edges.set(key, edge);
        }
    };

    addNode(ap, true);
    for (const id of otherAccessPoints) {
        addNode(id, false);
    }
    for (const id of routerIds) {
        addNode(id, true);
    }

    for (const table of input.tables) {
        const router = table.router;
        for (const entry of table.entries) {
            const destination = resolve(entry.destination);
            const nextHop = entry.nextHop === '' ? destination : resolve(entry.nextHop);
            if (destination === router) {
                continue;
            }
            addNode(destination, true, entry);
            const direct = entry.isNeighbour || nextHop === destination;
            routes.push({
                router,
                destination,
                nextHop,
                distance: entry.distance,
                rssi: entry.rssi,
                neighbour: direct,
                isStatic: entry.isStatic,
            });
            if (direct) {
                addEdge({
                    from: router,
                    to: destination,
                    distance: entry.distance,
                    rssi: entry.rssi,
                    isStatic: entry.isStatic,
                    assumed: false,
                });
            } else {
                addNode(nextHop, true);
                addEdge({from: router, to: nextHop, isStatic: entry.isStatic, assumed: false});
                addEdge({from: nextHop, to: destination, isStatic: entry.isStatic, assumed: false});
            }
        }
    }

    const touches = (id: string): boolean => [...edges.values()].some((edge) => edge.from === id || edge.to === id);
    /** The nodes a chain of measured edges joins to an access point. */
    const connected = (): Set<string> => {
        const seen = new Set([...nodes.values()].filter((node) => node.kind === 'access-point').map((node) => node.id));
        const queue = [...seen];
        while (queue.length > 0) {
            const id = queue.shift() ?? '';
            for (const edge of edges.values()) {
                const other = edge.from === id ? edge.to : edge.to === id ? edge.from : undefined;
                if (other !== undefined && !edge.assumed && !seen.has(other)) {
                    seen.add(other);
                    queue.push(other);
                }
            }
        }
        return seen;
    };

    // the other access points hang on the central one; a router that names none reaches it directly
    for (const id of otherAccessPoints) {
        if (!touches(id)) {
            addEdge({from: ap, to: id, isStatic: false, assumed: true});
        }
    }
    const joined = connected();
    for (const id of routerIds) {
        if (!joined.has(id)) {
            addEdge({from: ap, to: id, isStatic: false, assumed: true});
        }
    }
    // a device nobody lists talks to the access point directly, as far as anybody can tell
    for (const id of input.devices) {
        if (id === ap) {
            continue;
        }
        addNode(id, false);
        if (!touches(id)) {
            addEdge({from: ap, to: id, isStatic: false, assumed: true});
        }
    }

    return {accessPoint: ap, nodes: [...nodes.values()], edges: [...edges.values()], routes};
}

/** A node's place in the drawing. */
export interface NodePosition {
    readonly x: number;
    readonly y: number;
    readonly ring: number;
}

/**
 * A radial layout: the access point in the middle, the nodes one edge away on the first ring,
 * the rest outside, each next to the first-ring node it hangs on so the lines do not cross the
 * whole picture. Deterministic: the same network draws the same way every time.
 */
export function layoutNetwork(network: RoutingNetwork, size: number): Map<string, NodePosition> {
    const centre = size / 2;
    const positions = new Map<string, NodePosition>();
    positions.set(network.accessPoint, {x: centre, y: centre, ring: 0});

    const neighbours = new Map<string, string[]>();
    for (const edge of network.edges) {
        neighbours.set(edge.from, [...(neighbours.get(edge.from) ?? []), edge.to]);
        neighbours.set(edge.to, [...(neighbours.get(edge.to) ?? []), edge.from]);
    }
    // breadth-first from the access point: the ring is the hop count in the drawing
    const ringOf = new Map<string, number>([[network.accessPoint, 0]]);
    const parentOf = new Map<string, string>();
    const queue = [network.accessPoint];
    while (queue.length > 0) {
        const id = queue.shift() ?? '';
        for (const next of [...(neighbours.get(id) ?? [])].sort()) {
            if (!ringOf.has(next)) {
                ringOf.set(next, (ringOf.get(id) ?? 0) + 1);
                parentOf.set(next, id);
                queue.push(next);
            }
        }
    }
    const unplaced = network.nodes.map((node) => node.id).filter((id) => !ringOf.has(id));
    for (const id of unplaced) {
        ringOf.set(id, 1);
    }
    const maxRing = Math.max(1, ...ringOf.values());
    const kindRank = (id: string): number => {
        const kind = network.nodes.find((node) => node.id === id)?.kind;
        return kind === 'access-point' ? 0 : kind === 'router' ? 1 : 2;
    };

    // the first ring evenly round the access point; every further ring grouped behind its parent,
    // so a router's devices fan out behind it instead of across the picture
    const radiusOf = (ring: number): number =>
        maxRing === 1 ? size * 0.38 : size * (0.17 + (0.27 * (ring - 1)) / (maxRing - 1));
    const angles = new Map<string, number>([[network.accessPoint, -Math.PI / 2]]);
    for (let ring = 1; ring <= maxRing; ring += 1) {
        const ids = [...ringOf.entries()].filter(([, r]) => r === ring).map(([id]) => id);
        if (ring === 1) {
            ids.sort((a, b) => kindRank(a) - kindRank(b) || a.localeCompare(b));
            ids.forEach((id, index) => {
                angles.set(id, -Math.PI / 2 + (2 * Math.PI * index) / Math.max(ids.length, 1));
            });
        } else {
            const groups = new Map<string, string[]>();
            for (const id of ids.sort((a, b) => kindRank(a) - kindRank(b) || a.localeCompare(b))) {
                const parent = parentOf.get(id) ?? network.accessPoint;
                groups.set(parent, [...(groups.get(parent) ?? []), id]);
            }
            // about a label's width (130 px at the drawing's scale) between two neighbours on the ring
            const step = Math.min((2 * Math.PI) / Math.max(ids.length, 1), Math.max(0.45, 130 / radiusOf(ring)));
            for (const [parent, children] of groups) {
                const base = angles.get(parent) ?? -Math.PI / 2;
                children.forEach((id, index) => {
                    angles.set(id, base + (index - (children.length - 1) / 2) * step);
                });
            }
        }
        const radius = radiusOf(ring);
        for (const id of ids) {
            const angle = angles.get(id) ?? 0;
            positions.set(id, {x: centre + radius * Math.cos(angle), y: centre + radius * Math.sin(angle), ring});
        }
    }
    return positions;
}
