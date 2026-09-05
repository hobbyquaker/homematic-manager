import {describe, expect, it} from 'vitest';

import {
    AddressError,
    channelAddress,
    channelIndex,
    compareAddresses,
    deviceAddress,
    isChannelAddress,
    isDeviceAddress,
    isMaintenanceAddress,
    MAINTENANCE_CHANNEL,
    maintenanceAddress,
    parentAddress,
    parseAddress,
    tryParseAddress,
} from './address.js';

describe('parseAddress', () => {
    it('parses a BidCos-RF device', () => {
        expect(parseAddress('LEQ0123456')).toEqual({
            address: 'LEQ0123456',
            device: 'LEQ0123456',
            isDevice: true,
            isChannel: false,
            isMaintenance: false,
        });
    });

    it('parses a BidCos-RF channel', () => {
        expect(parseAddress('LEQ0123456:1')).toEqual({
            address: 'LEQ0123456:1',
            device: 'LEQ0123456',
            index: 1,
            channel: 'LEQ0123456:1',
            isDevice: false,
            isChannel: true,
            isMaintenance: false,
        });
    });

    it('parses an HmIP maintenance channel', () => {
        const parsed = parseAddress('0001D3C99C1234:0');
        expect(parsed.device).toBe('0001D3C99C1234');
        expect(parsed.index).toBe(MAINTENANCE_CHANNEL);
        expect(parsed.isMaintenance).toBe(true);
    });

    it('parses a CUxD channel', () => {
        expect(parseAddress('CUX2801001:1')).toMatchObject({device: 'CUX2801001', index: 1});
    });

    it('parses a BidCos-Wired channel', () => {
        expect(parseAddress('IEQ0123456:12')).toMatchObject({device: 'IEQ0123456', index: 12});
    });

    it('parses the interface process own device', () => {
        expect(parseAddress('BidCoS-RF')).toMatchObject({device: 'BidCoS-RF', isDevice: true});
    });

    it('takes a two-digit index as one number', () => {
        expect(channelIndex('LEQ0123456:10')).toBe(10);
    });

    it('throws for an empty address', () => {
        expect(() => parseAddress('')).toThrow(AddressError);
        expect(() => parseAddress('')).toThrow(/empty/);
    });

    it('throws for a missing serial', () => {
        expect(() => parseAddress(':1')).toThrow(/expected SERIAL/);
    });

    it('throws for a non-numeric, negative or empty index', () => {
        expect(() => parseAddress('LEQ0123456:a')).toThrow(AddressError);
        expect(() => parseAddress('LEQ0123456:-1')).toThrow(AddressError);
        expect(() => parseAddress('LEQ0123456:')).toThrow(AddressError);
        expect(() => parseAddress('LEQ0123456:1:2')).toThrow(AddressError);
    });

    it('reports the offending address on the error', () => {
        try {
            parseAddress('nope:x');
            expect.unreachable('should have thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(AddressError);
            expect((error as AddressError).address).toBe('nope:x');
            expect((error as AddressError).name).toBe('AddressError');
        }
    });
});

describe('tryParseAddress', () => {
    it('returns undefined instead of throwing', () => {
        expect(tryParseAddress('')).toBeUndefined();
        expect(tryParseAddress('LEQ0123456:x')).toBeUndefined();
        expect(tryParseAddress('LEQ0123456')?.device).toBe('LEQ0123456');
    });
});

describe('the address predicates', () => {
    it('separates devices from channels', () => {
        expect(isDeviceAddress('LEQ0123456')).toBe(true);
        expect(isDeviceAddress('LEQ0123456:1')).toBe(false);
        expect(isChannelAddress('LEQ0123456:1')).toBe(true);
        expect(isChannelAddress('LEQ0123456')).toBe(false);
    });

    it('calls a malformed address neither device nor channel', () => {
        expect(isDeviceAddress('')).toBe(false);
        expect(isChannelAddress(':2')).toBe(false);
        expect(isMaintenanceAddress('')).toBe(false);
    });

    it('recognises the maintenance channel', () => {
        expect(isMaintenanceAddress('LEQ0123456:0')).toBe(true);
        expect(isMaintenanceAddress('LEQ0123456:1')).toBe(false);
        expect(isMaintenanceAddress('LEQ0123456')).toBe(false);
    });
});

describe('deriving addresses', () => {
    it('reduces a channel to its device', () => {
        expect(deviceAddress('LEQ0123456:3')).toBe('LEQ0123456');
        expect(deviceAddress('LEQ0123456')).toBe('LEQ0123456');
    });

    it('gives a parent only for channels', () => {
        expect(parentAddress('LEQ0123456:3')).toBe('LEQ0123456');
        expect(parentAddress('LEQ0123456')).toBeUndefined();
    });

    it('gives a channel index only for channels', () => {
        expect(channelIndex('LEQ0123456')).toBeUndefined();
    });

    it('builds a channel address', () => {
        expect(channelAddress('LEQ0123456', 4)).toBe('LEQ0123456:4');
        expect(channelAddress('LEQ0123456', 0)).toBe('LEQ0123456:0');
    });

    it('refuses to build a channel address from nonsense', () => {
        expect(() => channelAddress('', 1)).toThrow(AddressError);
        expect(() => channelAddress('LEQ0123456:1', 1)).toThrow(/not a device serial/);
        expect(() => channelAddress('LEQ0123456', -1)).toThrow(/non-negative/);
        expect(() => channelAddress('LEQ0123456', 1.5)).toThrow(/non-negative/);
    });

    it('finds the maintenance channel of a device and of a channel', () => {
        expect(maintenanceAddress('LEQ0123456')).toBe('LEQ0123456:0');
        expect(maintenanceAddress('LEQ0123456:7')).toBe('LEQ0123456:0');
    });
});

describe('compareAddresses', () => {
    it('sorts by serial, then numerically by channel, device first', () => {
        const sorted = ['B:10', 'A:2', 'B', 'A', 'A:10', 'B:2'].sort(compareAddresses);
        expect(sorted).toEqual(['A', 'A:2', 'A:10', 'B', 'B:2', 'B:10']);
    });

    it('treats equal addresses as equal', () => {
        expect(compareAddresses('A:1', 'A:1')).toBe(0);
        expect(compareAddresses('', '')).toBe(0);
    });

    it('sorts unparseable addresses to the end, among themselves lexically', () => {
        expect(['b:x', 'A', 'a:x'].sort(compareAddresses)).toEqual(['A', 'a:x', 'b:x']);
        expect(compareAddresses('b:x', 'a:x')).toBe(1);
        expect(compareAddresses('A', 'b:x')).toBe(-1);
        expect(compareAddresses('b:x', 'A')).toBe(1);
    });
});
