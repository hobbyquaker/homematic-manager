import {describe, expect, it} from 'vitest';

import {renameEntries} from './names.js';

describe('renameEntries (task 65)', () => {
    const on = {channels: true};
    const off = {channels: false};

    it('names a device, its :0 and every other channel by the index the channel carries', () => {
        // a gap in the indices: channel 2 does not exist, channel 3 is still "3"
        expect(renameEntries('ABC0000001', 'Licht', ['ABC0000001:0', 'ABC0000001:1', 'ABC0000001:3'], on)).toEqual([
            {address: 'ABC0000001', name: 'Licht'},
            {address: 'ABC0000001:0', name: 'Licht:0'},
            {address: 'ABC0000001:1', name: 'Licht:1'},
            {address: 'ABC0000001:3', name: 'Licht:3'},
        ]);
    });

    it('names the device and :0 only when the channels are not wanted', () => {
        expect(renameEntries('ABC0000001', 'Licht', ['ABC0000001:0', 'ABC0000001:1'], off)).toEqual([
            {address: 'ABC0000001', name: 'Licht'},
            {address: 'ABC0000001:0', name: 'Licht:0'},
        ]);
    });

    it('names :0 of a device that has only :0, and of one whose channels have not arrived yet', () => {
        const expected = [
            {address: 'ABC0000001', name: 'Licht'},
            {address: 'ABC0000001:0', name: 'Licht:0'},
        ];
        expect(renameEntries('ABC0000001', 'Licht', ['ABC0000001:0'], on)).toEqual(expected);
        expect(renameEntries('ABC0000001', 'Licht', [], on)).toEqual(expected);
    });

    it('renames a channel alone, whatever the channel list says', () => {
        expect(renameEntries('ABC0000001:2', 'Taster', ['ABC0000001:0', 'ABC0000001:1'], on)).toEqual([
            {address: 'ABC0000001:2', name: 'Taster'},
        ]);
    });

    it('never renames :0 on its own', () => {
        expect(renameEntries('ABC0000001:0', 'Wartung', [], on)).toEqual([]);
    });

    it('writes nothing for an empty name, and trims the one it writes', () => {
        expect(renameEntries('ABC0000001', '   ', ['ABC0000001:1'], on)).toEqual([]);
        expect(renameEntries('ABC0000001', ' Licht ', [], off)).toEqual([
            {address: 'ABC0000001', name: 'Licht'},
            {address: 'ABC0000001:0', name: 'Licht:0'},
        ]);
    });

    it('ignores a malformed address, another device and a channel listed twice', () => {
        expect(renameEntries('ABC:x', 'Licht', [], on)).toEqual([]);
        expect(
            renameEntries('ABC0000001', 'Licht', ['OTHER00001:1', 'ABC0000001:1', 'ABC0000001:1', 'bad:'], on),
        ).toEqual([
            {address: 'ABC0000001', name: 'Licht'},
            {address: 'ABC0000001:0', name: 'Licht:0'},
            {address: 'ABC0000001:1', name: 'Licht:1'},
        ]);
    });
});
