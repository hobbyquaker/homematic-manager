import {readFileSync} from 'node:fs';

import {describe, expect, it} from 'vitest';

import {
    canLink,
    canReceive,
    canSend,
    decodeLinkFlags,
    GET_LINKS_FLAGS,
    LINK_FLAGS,
    linkReceivers,
    linkSenders,
    linkSourcesFor,
    linkTargetsFor,
    sharedRoles,
} from './roles.js';
import {DeviceIndex, type DeviceDescription} from '../devices/index.js';

const fixtures = JSON.parse(
    readFileSync(new URL('../../test/fixtures/devices.json', import.meta.url), 'utf8'),
) as Record<string, DeviceDescription[]>;

const index = new DeviceIndex('BidCos-RF', fixtures['BidCos-RF'] ?? []);
const hmip = new DeviceIndex('HmIP-RF', fixtures['HmIP-RF'] ?? []);

function channel(from: DeviceIndex, address: string): DeviceDescription {
    const found = from.get(address);
    if (!found) {
        throw new Error(`fixture has no channel ${address}`);
    }
    return found;
}

describe('decodeLinkFlags', () => {
    it('decodes the two broken bits', () => {
        expect(decodeLinkFlags(LINK_FLAGS.SENDER_BROKEN)).toMatchObject({
            senderBroken: true,
            receiverBroken: false,
            broken: true,
        });
        expect(decodeLinkFlags(LINK_FLAGS.RECEIVER_BROKEN)).toMatchObject({
            senderBroken: false,
            receiverBroken: true,
            broken: true,
        });
        expect(decodeLinkFlags(3).broken).toBe(true);
    });

    it('calls an intact link intact', () => {
        expect(decodeLinkFlags(0)).toEqual({
            senderBroken: false,
            receiverBroken: false,
            broken: false,
            unknownBits: 0,
        });
        expect(decodeLinkFlags(undefined).broken).toBe(false);
    });

    it('keeps bits nobody documented', () => {
        expect(decodeLinkFlags(8 | 1).unknownBits).toBe(8);
    });

    it('knows the getLinks request flags the RPC console offers', () => {
        expect(GET_LINKS_FLAGS).toEqual({GROUP: 1, SENDER_PARAMSET: 2, RECEIVER_PARAMSET: 4});
    });
});

describe('who can send and who can receive', () => {
    it('takes the role lists of a channel', () => {
        expect(canSend(channel(index, 'LEQ0654321:1'))).toBe(true);
        expect(canReceive(channel(index, 'LEQ0654321:1'))).toBe(false);
        expect(canReceive(channel(index, 'MEQ0123456:1'))).toBe(true);
        expect(canSend(channel(index, 'MEQ0123456:1'))).toBe(false);
    });

    it('excludes devices, which have no roles', () => {
        expect(canSend(channel(index, 'LEQ0654321'))).toBe(false);
        expect(canReceive(channel(index, 'MEQ0123456'))).toBe(false);
    });

    it('excludes the maintenance channel', () => {
        const maintenance: DeviceDescription = {
            ...channel(index, 'MEQ0123456:0'),
            LINK_TARGET_ROLES: 'SWITCH',
            LINK_SOURCE_ROLES: 'SWITCH',
        };
        expect(canSend(maintenance)).toBe(false);
        expect(canReceive(maintenance)).toBe(false);
    });
});

describe('sharedRoles and canLink', () => {
    it('finds the role a remote and a switch have in common', () => {
        expect(sharedRoles(channel(index, 'LEQ0654321:1'), channel(index, 'MEQ0123456:1'))).toEqual(['SWITCH']);
        expect(canLink(channel(index, 'LEQ0654321:1'), channel(index, 'MEQ0123456:1'))).toBe(true);
    });

    it('finds nothing when the roles do not overlap', () => {
        const winmaticOnly: DeviceDescription = {ADDRESS: 'X:1', TYPE: 'W', PARENT: 'X', LINK_TARGET_ROLES: 'WINMATIC'};
        const keymaticOnly: DeviceDescription = {ADDRESS: 'Y:1', TYPE: 'K', PARENT: 'Y', LINK_SOURCE_ROLES: 'DIMMER'};
        expect(sharedRoles(keymaticOnly, winmaticOnly)).toEqual([]);
        expect(canLink(keymaticOnly, winmaticOnly)).toBe(false);
    });

    it('refuses the wrong direction', () => {
        expect(canLink(channel(index, 'MEQ0123456:1'), channel(index, 'LEQ0654321:1'))).toBe(false);
    });

    it('refuses a channel linked to itself', () => {
        const both: DeviceDescription = {
            ADDRESS: 'Z:1',
            TYPE: 'T',
            PARENT: 'Z',
            LINK_SOURCE_ROLES: 'SWITCH',
            LINK_TARGET_ROLES: 'SWITCH',
        };
        expect(canLink(both, both)).toBe(false);
    });

    it('refuses a sender or receiver that has no roles at all', () => {
        expect(sharedRoles(channel(index, 'MEQ0123456:1'), channel(index, 'MEQ0123456:1'))).toEqual([]);
        expect(sharedRoles(channel(index, 'LEQ0654321:1'), channel(index, 'LEQ0654321:1'))).toEqual([]);
    });
});

describe('the add-link dialog lists', () => {
    it('offers every channel that can send', () => {
        expect(linkSenders(index).map((entry) => entry.ADDRESS)).toEqual([
            'BidCoS-RF:1',
            'LEQ0654321:1',
            'LEQ0654321:2',
        ]);
    });

    it('offers every channel that can receive', () => {
        expect(linkReceivers(index).map((entry) => entry.ADDRESS)).toEqual([
            'MEQ0123456:1',
            'MEQ0888888:1',
            'MEQ0999999:1',
        ]);
    });

    it('narrows the receivers to the ones the chosen sender fits', () => {
        expect(linkTargetsFor(index, 'LEQ0654321:1').map((entry) => entry.ADDRESS)).toEqual([
            'MEQ0123456:1',
            'MEQ0888888:1',
            'MEQ0999999:1',
        ]);
    });

    it('narrows the senders to the ones the chosen receiver fits', () => {
        expect(linkSourcesFor(index, 'MEQ0123456:1').map((entry) => entry.ADDRESS)).toEqual([
            'BidCoS-RF:1',
            'LEQ0654321:1',
            'LEQ0654321:2',
        ]);
    });

    it('offers nothing for an unknown address', () => {
        expect(linkTargetsFor(index, 'nope')).toEqual([]);
        expect(linkSourcesFor(index, 'nope')).toEqual([]);
    });

    it('offers nothing for a channel that cannot take part', () => {
        expect(linkTargetsFor(index, 'MEQ0123456:0')).toEqual([]);
        expect(linkSourcesFor(index, 'LEQ0654321:0')).toEqual([]);
    });

    it('works the same way on HmIP, where the sender is a KEY_TRANSCEIVER', () => {
        expect(linkTargetsFor(hmip, '0001D3C99C5678:1').map((entry) => entry.ADDRESS)).toEqual([
            '0001D3C99C1234:2',
            '0001D3C99C1234:3',
            '0002D3C9AA0001:2',
        ]);
        expect(sharedRoles(channel(hmip, '0002D3C9AA0001:1'), channel(hmip, '0002D3C9AA0001:2'))).toEqual(['SWITCH']);
    });
});
