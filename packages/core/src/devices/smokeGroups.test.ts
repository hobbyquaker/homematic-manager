/**
 * Task 58: smoke groups - BidCos teams from `TEAM_CHANNELS` / `TEAM`, HmIP groups from the
 * detectors' `GROUP_n`. The shapes are the ones a CCU3 with four BidCos detectors reported, and
 * the eight booleans the WebUI shows as checkboxes on an HmIP-SWSD.
 */

import {describe, expect, it} from 'vitest';

import {DeviceIndex, type DeviceDescription} from './index.js';
import {
    hmipSmokeGroups,
    isSmokeDetectorChannel,
    isSmokeGroupAddress,
    isSmokeTeamDevice,
    lowestFreeSmokeGroup,
    SMOKE_GROUP_TYPE,
    smokeGroupAddress,
    smokeGroupChanges,
    smokeGroupDescription,
    smokeGroupNumber,
    smokeGroupParameter,
    smokeGroupsOf,
    smokeTeams,
    teamDeviceOf,
} from './smokeGroups.js';

function detector(serial: string, type: 'HM-Sec-SD' | 'HM-Sec-SD-2', team: string): DeviceDescription[] {
    return [
        {ADDRESS: serial, TYPE: type, PARENT: '', CHILDREN: [`${serial}:0`, `${serial}:1`], PARAMSETS: ['MASTER']},
        {ADDRESS: `${serial}:0`, TYPE: 'MAINTENANCE', PARENT: serial, PARENT_TYPE: type, TEAM: '', TEAM_TAG: ''},
        {
            ADDRESS: `${serial}:1`,
            TYPE: 'SMOKE_DETECTOR',
            PARENT: serial,
            PARENT_TYPE: type,
            TEAM: team,
            TEAM_TAG: 'smoke_detector',
            TEAM_CHANNELS: [],
        },
    ];
}

function team(serial: string, type: 'HM-Sec-SD-Team' | 'HM-Sec-SD-2-Team', members: string[]): DeviceDescription[] {
    const channelType = type === 'HM-Sec-SD-Team' ? 'SMOKE_DETECTOR_TEAM' : 'SMOKE_DETECTOR_TEAM_V2';
    return [
        {ADDRESS: `*${serial}`, TYPE: type, PARENT: '', CHILDREN: [`*${serial}:0`, `*${serial}:1`], FLAGS: 9},
        {ADDRESS: `*${serial}:0`, TYPE: 'MAINTENANCE', PARENT: `*${serial}`, PARENT_TYPE: type, TEAM_CHANNELS: []},
        {
            ADDRESS: `*${serial}:1`,
            TYPE: channelType,
            PARENT: `*${serial}`,
            PARENT_TYPE: type,
            TEAM: '',
            TEAM_TAG: 'smoke_detector',
            TEAM_CHANNELS: members,
        },
    ];
}

/** The CCU3 of 2026-09-19: three -2 detectors in one team, one older detector in a team of its own. */
const CCU3 = new DeviceIndex('BidCos-RF', [
    ...detector('NEQ0448334', 'HM-Sec-SD-2', '*NEQ0448334:1'),
    ...detector('NEQ0448077', 'HM-Sec-SD-2', '*NEQ0448334:1'),
    ...detector('NEQ0448223', 'HM-Sec-SD-2', '*NEQ0448334:1'),
    ...detector('NEQ0220721', 'HM-Sec-SD', '*NEQ0220721:1'),
    ...team('NEQ0448334', 'HM-Sec-SD-2-Team', ['NEQ0448077:1', 'NEQ0448223:1', 'NEQ0448334:1']),
    ...team('NEQ0220721', 'HM-Sec-SD-Team', ['NEQ0220721:1']),
    // a switch actuator, with the empty team fields a CCU sends on everything
    {ADDRESS: 'LEQ0000001', TYPE: 'HM-LC-Sw1-Pl', PARENT: '', CHILDREN: ['LEQ0000001:1']},
    {ADDRESS: 'LEQ0000001:1', TYPE: 'SWITCH', PARENT: 'LEQ0000001', TEAM: '', TEAM_TAG: '', TEAM_CHANNELS: []},
]);

describe('BidCos teams', () => {
    it('lists every team device with its channel, tag and members - a team of one included', () => {
        expect(smokeTeams(CCU3)).toEqual([
            {
                address: '*NEQ0220721',
                kind: 'team',
                teamChannel: '*NEQ0220721:1',
                teamTag: 'smoke_detector',
                members: ['NEQ0220721:1'],
            },
            {
                address: '*NEQ0448334',
                kind: 'team',
                teamChannel: '*NEQ0448334:1',
                teamTag: 'smoke_detector',
                members: ['NEQ0448077:1', 'NEQ0448223:1', 'NEQ0448334:1'],
            },
        ]);
    });

    it('knows a team device from an ordinary one, whatever empty TEAM_CHANNELS the CCU sends', () => {
        expect(isSmokeTeamDevice(CCU3, '*NEQ0448334')).toBe(true);
        expect(isSmokeTeamDevice(CCU3, 'NEQ0448334')).toBe(false);
        expect(isSmokeTeamDevice(CCU3, 'LEQ0000001')).toBe(false);
        expect(isSmokeTeamDevice(CCU3, 'nowhere')).toBe(false);
    });

    it('finds the team device of a detector channel through its TEAM', () => {
        expect(teamDeviceOf(CCU3, 'NEQ0448077:1')).toBe('*NEQ0448334');
        expect(teamDeviceOf(CCU3, 'NEQ0220721:1')).toBe('*NEQ0220721');
        // no TEAM, an unknown channel, a TEAM the index does not list
        expect(teamDeviceOf(CCU3, 'LEQ0000001:1')).toBeUndefined();
        expect(teamDeviceOf(CCU3, 'NEQ0448077:0')).toBeUndefined();
        expect(teamDeviceOf(CCU3, 'nowhere:1')).toBeUndefined();
        const orphan = new DeviceIndex('BidCos-RF', detector('NEQ0000001', 'HM-Sec-SD-2', '*NEQ0000009:1'));
        expect(teamDeviceOf(orphan, 'NEQ0000001:1')).toBeUndefined();
    });

    it('tells the smoke channel from the rest', () => {
        expect(isSmokeDetectorChannel(CCU3.require('NEQ0448077:1'))).toBe(true);
        expect(isSmokeDetectorChannel(CCU3.require('NEQ0448077:0'))).toBe(false);
        expect(isSmokeDetectorChannel(CCU3.require('*NEQ0448334:1'))).toBe(false);
        // a device of that type name is not a channel
        expect(isSmokeDetectorChannel({ADDRESS: 'X', TYPE: 'SMOKE_DETECTOR'})).toBe(false);
    });
});

describe('HmIP smoke groups', () => {
    it('reads the groups a channel is in from its GROUP_n, booleans or ones', () => {
        expect(smokeGroupsOf({REPEAT_ENABLE: true, GROUP_1: true, GROUP_2: false, GROUP_3: 1, GROUP_8: 0})).toEqual([
            1, 3,
        ]);
        expect(smokeGroupsOf({GROUP_1: false, GROUP_2: false})).toEqual([]);
    });

    it('answers undefined for the older channel type, which has no GROUP_n at all', () => {
        expect(smokeGroupsOf({REPEAT_ENABLE: true})).toBeUndefined();
        expect(smokeGroupsOf({})).toBeUndefined();
    });

    it('names the parameter and the row address of a group, and reads the number back', () => {
        expect(smokeGroupParameter(3)).toBe('GROUP_3');
        expect(smokeGroupAddress(3)).toBe('*GROUP_3');
        expect(smokeGroupNumber('*GROUP_3')).toBe(3);
        expect(smokeGroupNumber('*GROUP_9')).toBeUndefined();
        expect(smokeGroupNumber('GROUP_3')).toBeUndefined();
        expect(smokeGroupNumber('*NEQ0448334')).toBeUndefined();
        expect(isSmokeGroupAddress('*GROUP_8')).toBe(true);
        expect(isSmokeGroupAddress('*GROUP_8:1')).toBe(false);
    });

    it('makes one row per group that has a member, members sorted, groups in order', () => {
        expect(
            hmipSmokeGroups({
                '0001D3C9000002:1': [3, 1],
                '0001D3C9000001:1': [1],
                '0001D3C9000003:1': [],
                '0001D3C9000004:1': null,
            }),
        ).toEqual([
            {address: '*GROUP_1', kind: 'hmip', number: 1, members: ['0001D3C9000001:1', '0001D3C9000002:1']},
            {address: '*GROUP_3', kind: 'hmip', number: 3, members: ['0001D3C9000002:1']},
        ]);
        expect(hmipSmokeGroups({})).toEqual([]);
    });

    it('gives New the lowest free number, and none when all eight are taken', () => {
        expect(lowestFreeSmokeGroup({})).toBe(1);
        expect(lowestFreeSmokeGroup({a: [1, 2], b: [4], c: null})).toBe(3);
        expect(lowestFreeSmokeGroup({a: [1, 2, 3, 4], b: [5, 6, 7, 8]})).toBeUndefined();
    });

    it('draws the group row as a device without channels or paramsets', () => {
        expect(smokeGroupDescription(2)).toEqual({
            ADDRESS: '*GROUP_2',
            TYPE: SMOKE_GROUP_TYPE,
            PARENT: '',
            CHILDREN: [],
            PARAMSETS: [],
            FLAGS: 0,
        });
    });
});

describe('smokeGroupChanges', () => {
    it('is who joins and who leaves, nothing for the unchanged', () => {
        expect(smokeGroupChanges(['a', 'b'], ['b', 'c'])).toEqual({added: ['c'], removed: ['a']});
        expect(smokeGroupChanges(['a'], ['a'])).toEqual({added: [], removed: []});
        expect(smokeGroupChanges([], [])).toEqual({added: [], removed: []});
    });
});
