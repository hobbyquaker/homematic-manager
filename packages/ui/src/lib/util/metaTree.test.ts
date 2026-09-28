import {describe, expect, it} from 'vitest';

import type {MetaEnum, MetaObjectView} from '@homematic-manager/core';

import {
    countMembers,
    deletionMembers,
    enumNameAfterRename,
    enumRows,
    indentOf,
    isChannelRef,
    moveTargets,
    nodeRows,
    rowIndex,
} from './metaTree.js';

const ENUMS: Record<string, MetaEnum> = {
    room: {
        name: {de: 'Räume', en: 'Rooms'},
        tree: [
            {
                id: 'eg',
                name: 'Erdgeschoss',
                children: [{id: 'kueche', name: 'Küche', children: [{id: 'ecke', name: 'Essecke'}]}],
            },
            {id: 'aussen', name: 'Außen'},
        ],
    },
    function: {name: {en: 'Functions'}, tree: [{id: 'licht', name: 'Licht'}]},
    floor: {name: {de: 'Etagen', en: 'Floors'}, tree: []},
};

const view = (enums: string[]): MetaObjectView => ({name: 'x', enums, rooms: [], functions: []});

const OBJECTS: Record<string, MetaObjectView> = {
    'BidCos-RF.MEQ0123456:1': view(['room/eg/kueche', 'function/licht']),
    'BidCos-RF.MEQ0123456:2': view(['room/eg/kueche/ecke']),
    'BidCos-RF.GEQ0567890': view(['room/eg']),
    'HmIP-RF.000A1B2C3D4E5F:4': view(['room/aussen', 'function/licht']),
};

describe('counting members', () => {
    it('tells a channel from a device by the colon in the address, never in the interface', () => {
        expect(isChannelRef('BidCos-RF.MEQ0123456:1')).toBe(true);
        expect(isChannelRef('BidCos-RF.MEQ0123456')).toBe(false);
        expect(isChannelRef('CUxD:1.CUX0000001')).toBe(false);
        expect(countMembers(['a.b:1', 'a.c', 'a.d:0'])).toEqual({devices: 3, channels: 2});
        expect(countMembers([])).toEqual({devices: 0, channels: 0});
    });

    // B-76 (#167): a CCU assigns channels only, so the devices are the distinct ones behind them
    it('counts a device once, whether it is a member itself or through one or more channels', () => {
        expect(countMembers(['BidCos-RF.MEQ0123456:1', 'BidCos-RF.MEQ0123456:2', 'BidCos-RF.MEQ0123456:3'])).toEqual({
            devices: 1,
            channels: 3,
        });
        expect(countMembers(['HmIP-RF.0001D3C99ABCDE', 'HmIP-RF.0001D3C99ABCDE:3'])).toEqual({devices: 1, channels: 1});
        // the same address on two interfaces is two devices
        expect(countMembers(['BidCos-RF.X:1', 'HmIP-RF.X:1'])).toEqual({devices: 2, channels: 2});
    });
});

describe('nodeRows', () => {
    it('lists one taxonomy depth first, with the members of every subtree', () => {
        const rows = nodeRows(ENUMS, OBJECTS, 'room');
        expect(rows.map((row) => [row.id, row.depth, row.devices, row.channels, row.hasChildren])).toEqual([
            ['room/eg', 1, 2, 2, true],
            ['room/eg/kueche', 2, 1, 2, true],
            ['room/eg/kueche/ecke', 3, 1, 1, false],
            ['room/aussen', 1, 1, 1, false],
        ]);
        expect(rows[0]).toMatchObject({kind: 'node', enumId: 'room', path: 'room/eg', name: 'Erdgeschoss'});
        expect(rows[0]).not.toHaveProperty('nodes');
    });

    it('is empty for a taxonomy that does not exist', () => {
        expect(nodeRows(ENUMS, OBJECTS, 'zone')).toEqual([]);
    });
});

describe('enumRows', () => {
    it('makes every taxonomy a top-level row named in the language, with its nodes under it', () => {
        const rows = enumRows(ENUMS, OBJECTS, 'de');
        expect(rows.map((row) => [row.id, row.name, row.devices, row.channels, row.hasChildren])).toEqual([
            ['room', 'Räume', 3, 3, true],
            ['function', 'Functions', 2, 2, true],
            ['floor', 'Etagen', 0, 0, false],
        ]);
        expect(rows[0]?.kind).toBe('enum');
        expect(rows[0]?.depth).toBe(0);
        expect(rows[0]?.nodes?.map((node) => node.id)).toEqual([
            'room/eg',
            'room/eg/kueche',
            'room/eg/kueche/ecke',
            'room/aussen',
        ]);
        expect(rows[2]?.nodes).toEqual([]);
    });

    it('falls back to English and then to the id for the name', () => {
        expect(enumRows(ENUMS, {}, 'tr').map((row) => row.name)).toEqual(['Rooms', 'Functions', 'Floors']);
        expect(enumRows({zone: {name: {}, tree: []}}, {}, 'de')[0]?.name).toBe('zone');
    });

    it('indexes taxonomies and nodes by id', () => {
        const index = rowIndex(enumRows(ENUMS, OBJECTS, 'en'));
        expect(index.get('room')?.kind).toBe('enum');
        expect(index.get('room/eg/kueche')?.name).toBe('Küche');
        expect(index.has('room/nowhere')).toBe(false);
    });
});

describe('indentation', () => {
    it('is nothing for a root node and one step per level below', () => {
        expect(indentOf(0)).toBe(0);
        expect(indentOf(1)).toBe(0);
        expect(indentOf(2)).toBe(14);
        expect(indentOf(4, 10)).toBe(30);
    });
});

describe('moveTargets', () => {
    it('offers the nodes of the same taxonomy, never the node itself or anything below it', () => {
        expect(moveTargets(ENUMS, 'room/eg/kueche').map((option) => option.path)).toEqual(['room/eg', 'room/aussen']);
        expect(moveTargets(ENUMS, 'room/eg').map((option) => option.path)).toEqual(['room/aussen']);
        expect(moveTargets(ENUMS, 'function/licht')).toEqual([]);
    });
});

describe('deletionMembers', () => {
    it('lists what a node deletion detaches, and for a taxonomy everything in it', () => {
        const rows = rowIndex(enumRows(ENUMS, OBJECTS, 'en'));
        expect(deletionMembers(OBJECTS, rows.get('room/eg/kueche')!)).toEqual([
            'BidCos-RF.MEQ0123456:1',
            'BidCos-RF.MEQ0123456:2',
        ]);
        expect(deletionMembers(OBJECTS, rows.get('function')!)).toEqual([
            'BidCos-RF.MEQ0123456:1',
            'HmIP-RF.000A1B2C3D4E5F:4',
        ]);
        expect(deletionMembers(OBJECTS, rows.get('floor')!)).toEqual([]);
    });
});

describe('enumNameAfterRename', () => {
    it('writes the name in the UI language and in English, keeping every other language', () => {
        expect(enumNameAfterRename({de: 'Räume', en: 'Rooms', tr: 'Odalar'}, 'Zimmer', 'de')).toEqual({
            de: 'Zimmer',
            en: 'Zimmer',
            tr: 'Odalar',
        });
        expect(enumNameAfterRename(undefined, 'Zones', 'en')).toEqual({en: 'Zones'});
    });
});
