import {describe, expect, it} from 'vitest';

import {layoutNetwork, routingNetwork, routingResolver, type RoutingNetwork} from './routingNetwork.js';
import type {RoutingEntry} from './routingTable.js';

function entry(
    destination: string,
    nextHop: string,
    distance: number,
    extra: Partial<RoutingEntry> = {},
): RoutingEntry {
    return {
        index: 0,
        destination,
        nextHop,
        distance,
        rssi: undefined,
        isStatic: false,
        isNeighbour: distance === 1,
        macSequenceValid: true,
        accessController: false,
        router: false,
        portable: false,
        listenerMode: '',
        omValid: true,
        ...extra,
    };
}

function edgeKeys(network: RoutingNetwork): string[] {
    return network.edges.map((edge) => `${edge.from}-${edge.to}${edge.assumed ? '?' : ''}`).sort();
}

describe('the routing resolver (task 98)', () => {
    const devices = [
        {ADDRESS: '001357098D41DA', TYPE: 'HmIP-BBL', RF_ADDRESS: 2_353_240},
        {ADDRESS: '000193C99510F3', TYPE: 'HMIP-WRC2', RF_ADDRESS: 7_387_176},
        {ADDRESS: 'HmIP-RCV-1', TYPE: 'HmIP-RCV-50', RF_ADDRESS: 12_042_205},
    ];
    const resolve = routingResolver(devices, {id: 'AP-SGTIN', radioAddresses: [12_042_205]});

    it('maps a serial in any case, a decimal and a hexadecimal radio address to the device', () => {
        expect(resolve('001357098d41da')).toBe('001357098D41DA');
        expect(resolve('2353240')).toBe('001357098D41DA');
        expect(resolve('23E858')).toBe('001357098D41DA');
        expect(resolve('0x23e858')).toBe('001357098D41DA');
        expect(resolve(' 70B828 ')).toBe('000193C99510F3');
    });

    it('maps the access point radio address and its own id to the access point, and leaves the unknown alone', () => {
        expect(resolve('12042205')).toBe('AP-SGTIN');
        expect(resolve('B7BFDD')).toBe('AP-SGTIN');
        expect(resolve('ap-sgtin')).toBe('AP-SGTIN');
        expect(resolve('FFFFFF')).toBe('FFFFFF');
        expect(resolve('something else')).toBe('something else');
    });
});

describe('the merged routing network (task 98)', () => {
    it('joins two routers by their tables, the neighbours direct and the rest through their next hop', () => {
        const network = routingNetwork({
            accessPoint: 'AP',
            tables: [
                {
                    router: 'R1',
                    entries: [entry('AP', 'AP', 1, {accessController: true, rssi: -50}), entry('D1', 'D1', 1)],
                },
                {
                    router: 'R2',
                    entries: [entry('R1', 'R1', 1, {rssi: -60}), entry('D2', 'R1', 2), entry('D3', 'D3', 1)],
                },
            ],
            devices: ['R1', 'R2', 'D1', 'D2', 'D3', 'D4'],
        });
        expect(edgeKeys(network)).toEqual(['AP-D4?', 'R1-AP', 'R1-D1', 'R1-D2', 'R2-D3', 'R2-R1']);
        // R2 reaches the access point through R1 - no assumed edge for it
        expect(network.edges.find((edge) => edge.from === 'AP' && edge.to === 'R2')).toBeUndefined();
        const byId = Object.fromEntries(network.nodes.map((node) => [node.id, node]));
        expect(byId['AP']?.kind).toBe('access-point');
        expect(byId['R1']?.kind).toBe('router');
        expect(byId['D2']?.kind).toBe('device');
        expect(byId['D4']?.listed).toBe(false);
        expect(byId['D1']?.listed).toBe(true);
        expect(network.edges.find((edge) => edge.from === 'R1' && edge.to === 'AP')?.rssi).toBe(-50);
        // the routes as the routers reported them, for the table beside the graph
        expect(network.routes.map((route) => `${route.router}>${route.destination} via ${route.nextHop}`)).toEqual([
            'R1>AP via AP',
            'R1>D1 via D1',
            'R2>R1 via R1',
            'R2>D2 via R1',
            'R2>D3 via D3',
        ]);
    });

    it('assumes a direct link for a router whose table names no access point, and for every unlisted device', () => {
        const network = routingNetwork({
            accessPoint: 'AP',
            tables: [{router: 'R1', entries: [entry('D1', 'D1', 1)]}],
            devices: ['R1', 'D1', 'D2', 'AP'],
            routers: ['R3'],
            accessPoints: ['HAP'],
        });
        expect(edgeKeys(network)).toEqual(['AP-D2?', 'AP-HAP?', 'AP-R1?', 'AP-R3?', 'R1-D1']);
        expect(network.nodes.find((node) => node.id === 'HAP')?.kind).toBe('access-point');
        expect(network.nodes.find((node) => node.id === 'R3')?.kind).toBe('router');
    });

    it('keeps one edge per pair, the measured one with the shorter distance', () => {
        const network = routingNetwork({
            accessPoint: 'AP',
            tables: [
                {router: 'R1', entries: [entry('AP', 'AP', 1), entry('R2', 'R2', 1, {rssi: -70})]},
                {router: 'R2', entries: [entry('R1', 'R1', 1, {rssi: -65}), entry('AP', 'R1', 2)]},
            ],
            devices: [],
        });
        const between = network.edges.filter(
            (edge) => [edge.from, edge.to].includes('R1') && [edge.from, edge.to].includes('R2'),
        );
        expect(between).toHaveLength(1);
        expect(between[0]?.assumed).toBe(false);
    });

    it('skips a router listing itself, resolves through the resolver, and marks what a table calls a router', () => {
        const network = routingNetwork({
            accessPoint: 'AP',
            tables: [
                {
                    router: 'R1',
                    entries: [entry('r1', 'r1', 0), entry('0A', '0A', 1, {router: true}), entry('AP', 'AP', 1)],
                },
            ],
            devices: [],
            resolve: (id) => (id === 'r1' ? 'R1' : id === '0A' ? 'DEV' : id),
        });
        expect(network.routes.map((route) => route.destination)).toEqual(['DEV', 'AP']);
        expect(network.nodes.find((node) => node.id === 'DEV')?.kind).toBe('router');
    });

    it('lays the access point out in the middle and every node on a ring by its hops from it', () => {
        const network = routingNetwork({
            accessPoint: 'AP',
            tables: [{router: 'R1', entries: [entry('AP', 'AP', 1), entry('D1', 'D1', 1), entry('D2', 'D1', 2)]}],
            devices: ['D3'],
        });
        const positions = layoutNetwork(network, 600);
        expect(positions.get('AP')).toEqual({x: 300, y: 300, ring: 0});
        expect(positions.get('R1')?.ring).toBe(1);
        expect(positions.get('D3')?.ring).toBe(1);
        expect(positions.get('D1')?.ring).toBe(2);
        expect(positions.get('D2')?.ring).toBe(3);
        for (const node of network.nodes) {
            const p = positions.get(node.id);
            expect(p, node.id).toBeDefined();
            expect(p!.x).toBeGreaterThanOrEqual(0);
            expect(p!.x).toBeLessThanOrEqual(600);
            expect(p!.y).toBeGreaterThanOrEqual(0);
            expect(p!.y).toBeLessThanOrEqual(600);
        }
        // the same network draws the same way
        expect(layoutNetwork(network, 600)).toEqual(positions);
    });
});
