import {describe, expect, it} from 'vitest';

import type {MetaObjectView} from '@homematic-manager/core';

import {
    FILTER_THRESHOLD,
    assignRequests,
    changedPaths,
    filterOptions,
    foldForFilter,
    membershipStates,
    nextState,
    selectionState,
    targetState,
    type AssignTarget,
    type CheckState,
} from './assignment.js';
import type {NodeOption} from './taxonomy.js';

/** Task 49: the tri-state of the assignment dialog and the requests a save sends. */

function view(...enums: string[]): MetaObjectView {
    return {name: 'x', enums, rooms: [], functions: []};
}

const OBJECTS: Record<string, MetaObjectView> = {
    // a channel in the kitchen and in the light function
    'BidCos-RF.A:1': view('room/kueche', 'function/licht'),
    // a channel in the kitchen and the hall
    'BidCos-RF.B:1': view('room/kueche', 'room/flur'),
    // a device with two channels: :1 in the bath, :2 in the bath and the hall, :0 in the hall
    'BidCos-RF.C:0': view('room/flur'),
    'BidCos-RF.C:1': view('room/bad'),
    'BidCos-RF.C:2': view('room/bad', 'room/flur'),
    // a device that is in the garden itself, with a channel that is not
    'BidCos-RF.D': view('room/garten'),
    'BidCos-RF.D:1': view(),
};

const lookup = (ref: string): MetaObjectView | undefined => OBJECTS[ref];

const channel = (ref: string): AssignTarget => ({ref, channels: []});
const deviceC: AssignTarget = {ref: 'BidCos-RF.C', channels: ['BidCos-RF.C:0', 'BidCos-RF.C:1', 'BidCos-RF.C:2']};
const deviceD: AssignTarget = {ref: 'BidCos-RF.D', channels: ['BidCos-RF.D:1']};

describe('targetState', () => {
    it('is the own membership of a channel, exactly the path', () => {
        expect(targetState(channel('BidCos-RF.A:1'), 'room/kueche', lookup)).toBe('on');
        expect(targetState(channel('BidCos-RF.A:1'), 'room/flur', lookup)).toBe('off');
        // not "somewhere below": a floor is a node of its own
        expect(targetState(channel('BidCos-RF.A:1'), 'room', lookup)).toBe('off');
        // an object the store does not know yet is in nothing
        expect(targetState(channel('BidCos-RF.Z:1'), 'room/kueche', lookup)).toBe('off');
    });

    it('counts a device as in a node when it is itself, or when every channel but :0 is', () => {
        expect(targetState(deviceC, 'room/bad', lookup)).toBe('on');
        // :2 is in the hall, :1 is not; that :0 is too does not make it all
        expect(targetState(deviceC, 'room/flur', lookup)).toBe('mixed');
        expect(targetState(deviceC, 'room/kueche', lookup)).toBe('off');
        expect(targetState(deviceD, 'room/garten', lookup)).toBe('on');
    });

    it('does not count a device whose only channel is :0 as in the room of that channel', () => {
        expect(targetState({ref: 'BidCos-RF.C', channels: ['BidCos-RF.C:0']}, 'room/flur', lookup)).toBe('off');
    });
});

describe('selectionState and membershipStates', () => {
    it('is on for one object in the node and off for one that is not', () => {
        const targets = [channel('BidCos-RF.A:1')];
        expect(membershipStates(targets, ['room/kueche', 'room/flur', 'function/licht'], lookup)).toEqual({
            'room/kueche': 'on',
            'room/flur': 'off',
            'function/licht': 'on',
        });
    });

    it('is on when every row is in it, off when none is, mixed otherwise', () => {
        const targets = [channel('BidCos-RF.A:1'), channel('BidCos-RF.B:1'), deviceC];
        expect(
            membershipStates(
                targets,
                ['room/kueche', 'room/flur', 'room/bad', 'room/garten', 'function/licht'],
                lookup,
            ),
        ).toEqual({
            'room/kueche': 'mixed',
            'room/flur': 'mixed',
            'room/bad': 'mixed',
            'room/garten': 'off',
            'function/licht': 'mixed',
        });
        expect(selectionState([channel('BidCos-RF.A:1'), channel('BidCos-RF.B:1')], 'room/kueche', lookup)).toBe('on');
    });

    it('is off for an empty selection', () => {
        expect(selectionState([], 'room/kueche', lookup)).toBe('off');
    });
});

describe('nextState', () => {
    it('toggles a box that opened checked or unchecked', () => {
        expect(nextState('on', 'on')).toBe('off');
        expect(nextState('on', 'off')).toBe('on');
        expect(nextState('off', 'off')).toBe('on');
        expect(nextState('off', 'on')).toBe('off');
    });

    it('takes a box that opened mixed to all, none, and back to "leave as it was"', () => {
        let state: CheckState = 'mixed';
        const seen: CheckState[] = [];
        for (let click = 0; click < 4; click += 1) {
            state = nextState('mixed', state);
            seen.push(state);
        }
        expect(seen).toEqual(['on', 'off', 'mixed', 'on']);
    });
});

describe('changedPaths', () => {
    const initial: Record<string, CheckState> = {a: 'on', b: 'off', c: 'mixed', d: 'mixed', e: 'on'};

    it('lists only what the user changed, in the order of the list', () => {
        const desired: Record<string, CheckState> = {a: 'off', b: 'off', c: 'on', d: 'mixed', e: 'on'};
        expect(changedPaths(['e', 'd', 'c', 'b', 'a'], initial, desired)).toEqual(['c', 'a']);
    });

    it('leaves an untouched mixed box alone, and one clicked back to mixed too', () => {
        expect(changedPaths(['c', 'd'], initial, {c: 'mixed', d: 'mixed'})).toEqual([]);
    });

    it('treats a node the dialog created as unchecked when it opened', () => {
        expect(changedPaths(['new'], initial, {new: 'on'})).toEqual(['new']);
        expect(changedPaths(['new'], initial, {new: 'off'})).toEqual([]);
    });

    it('ignores a path nobody touched', () => {
        expect(changedPaths(['a', 'b'], initial, {})).toEqual([]);
    });
});

describe('assignRequests', () => {
    it('puts only the rows that are not in the node yet into it', () => {
        const targets = [channel('BidCos-RF.A:1'), channel('BidCos-RF.B:1'), deviceC, deviceD];
        expect(assignRequests(targets, ['room/flur'], {'room/flur': 'on'}, lookup)).toEqual([
            {path: 'room/flur', on: true, refs: ['BidCos-RF.A:1', 'BidCos-RF.C', 'BidCos-RF.D']},
        ]);
    });

    it('takes every row and every channel of a device that holds the node out of it, :0 included', () => {
        const targets = [channel('BidCos-RF.A:1'), channel('BidCos-RF.B:1'), deviceC];
        expect(assignRequests(targets, ['room/flur'], {'room/flur': 'off'}, lookup)).toEqual([
            {path: 'room/flur', on: false, refs: ['BidCos-RF.B:1', 'BidCos-RF.C:0', 'BidCos-RF.C:2']},
        ]);
        // a device that is in the garden itself leaves it as the device
        expect(assignRequests([deviceD], ['room/garten'], {'room/garten': 'off'}, lookup)).toEqual([
            {path: 'room/garten', on: false, refs: ['BidCos-RF.D']},
        ]);
    });

    it('sends one request per changed node, and none for a change with nothing to move', () => {
        const targets = [channel('BidCos-RF.A:1')];
        expect(
            assignRequests(
                targets,
                ['room/kueche', 'function/licht', 'room/bad'],
                {'room/kueche': 'off', 'function/licht': 'on', 'room/bad': 'on'},
                lookup,
            ),
        ).toEqual([
            {path: 'room/kueche', on: false, refs: ['BidCos-RF.A:1']},
            {path: 'room/bad', on: true, refs: ['BidCos-RF.A:1']},
        ]);
    });
});

describe('the filter', () => {
    const options: NodeOption[] = [
        {path: 'room/eg', label: 'Erdgeschoss', depth: 1, hasChildren: true},
        {path: 'room/eg/kueche', label: 'Küche', depth: 2, hasChildren: false},
        {path: 'room/eg/flur', label: 'Flur', depth: 2, hasChildren: false},
        {path: 'room/og', label: 'Obergeschoss', depth: 1, hasChildren: true},
        {path: 'room/og/bad', label: 'Bad', depth: 2, hasChildren: false},
        {path: 'room/aussen', label: 'Außen', depth: 1, hasChildren: false},
    ];

    it('matches case- and accent-insensitive and keeps the parents of a match', () => {
        expect(filterOptions(options, 'KUCHE').map((option) => option.path)).toEqual(['room/eg', 'room/eg/kueche']);
        expect(filterOptions(options, 'geschoss').map((option) => option.path)).toEqual(['room/eg', 'room/og']);
        expect(filterOptions(options, 'au').map((option) => option.path)).toEqual(['room/aussen']);
        expect(filterOptions(options, 'nothing')).toEqual([]);
    });

    it('leaves everything for an empty query', () => {
        expect(filterOptions(options, '  ')).toEqual(options);
    });

    it('folds the way the list is searched', () => {
        expect(foldForFilter('Küche Außen')).toBe('kuche außen');
        expect(FILTER_THRESHOLD).toBe(10);
    });
});
