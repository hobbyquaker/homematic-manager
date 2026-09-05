import {readFileSync} from 'node:fs';

import {describe, expect, it} from 'vitest';

import {
    CENTRAL_DEVICE_TYPES,
    DeviceIndex,
    decodeDeviceFlags,
    decodeDirection,
    decodeRxMode,
    isCentralDeviceType,
    isChannelDescription,
    parseRoles,
    paramsetIdentity,
    type DeviceDescription,
} from './index.js';

const fixtures = JSON.parse(
    readFileSync(new URL('../../test/fixtures/devices.json', import.meta.url), 'utf8'),
) as Record<string, DeviceDescription[]>;

const bidcos = fixtures['BidCos-RF'] ?? [];
const hmip = fixtures['HmIP-RF'] ?? [];

function index(): DeviceIndex {
    return new DeviceIndex('BidCos-RF', bidcos);
}

describe('decodeDeviceFlags', () => {
    it('decodes the three flags the specification names', () => {
        expect(decodeDeviceFlags(1)).toMatchObject({visible: true, internal: false, dontDelete: false});
        expect(decodeDeviceFlags(3)).toMatchObject({visible: true, internal: true, dontDelete: false});
        expect(decodeDeviceFlags(9)).toMatchObject({visible: true, internal: false, dontDelete: true});
    });

    it('produces the labels the 2.x grid printed', () => {
        expect(decodeDeviceFlags(11).labels).toEqual(['Visible', 'Internal', 'DontDelete']);
        expect(decodeDeviceFlags(0).labels).toEqual([]);
    });

    it('treats a missing FLAGS as no flags', () => {
        expect(decodeDeviceFlags(undefined)).toMatchObject({visible: false, unknownBits: 0, labels: []});
    });

    it('keeps bits the specification does not name', () => {
        expect(decodeDeviceFlags(4 | 1).unknownBits).toBe(4);
    });
});

describe('decodeRxMode', () => {
    it('decodes single and combined modes', () => {
        expect(decodeRxMode(1)).toEqual(['ALWAYS']);
        expect(decodeRxMode(12)).toEqual(['CONFIG', 'WAKEUP']);
        expect(decodeRxMode(31)).toEqual(['ALWAYS', 'BURST', 'CONFIG', 'WAKEUP', 'LAZY_CONFIG']);
    });

    it('is empty for zero and for a missing RX_MODE', () => {
        expect(decodeRxMode(0)).toEqual([]);
        expect(decodeRxMode(undefined)).toEqual([]);
    });
});

describe('decodeDirection', () => {
    it('maps the three directions', () => {
        expect(decodeDirection(0)).toBe('NONE');
        expect(decodeDirection(1)).toBe('SENDER');
        expect(decodeDirection(2)).toBe('RECEIVER');
    });

    it('falls back to NONE for a missing or unexpected value', () => {
        expect(decodeDirection(undefined)).toBe('NONE');
        expect(decodeDirection(7)).toBe('NONE');
    });
});

describe('isCentralDeviceType', () => {
    it('knows the CCU own devices of every interface', () => {
        for (const type of CENTRAL_DEVICE_TYPES) {
            expect(isCentralDeviceType(type)).toBe(true);
        }
        expect(isCentralDeviceType('HM-LC-Sw1-Pl-CT-R1')).toBe(false);
    });
});

describe('isChannelDescription', () => {
    it('takes a non-empty PARENT as the mark of a channel', () => {
        expect(isChannelDescription({ADDRESS: 'A:1', TYPE: 'SWITCH', PARENT: 'A'})).toBe(true);
        expect(isChannelDescription({ADDRESS: 'A', TYPE: 'X', PARENT: ''})).toBe(false);
        expect(isChannelDescription({ADDRESS: 'A', TYPE: 'X'})).toBe(false);
    });
});

describe('parseRoles', () => {
    it('splits the space-separated role list', () => {
        expect(parseRoles('SWITCH KEYMATIC WINMATIC')).toEqual(['SWITCH', 'KEYMATIC', 'WINMATIC']);
    });

    it('tolerates odd whitespace', () => {
        expect(parseRoles('  SWITCH   DIMMER  ')).toEqual(['SWITCH', 'DIMMER']);
    });

    it('is empty for an empty or missing list', () => {
        expect(parseRoles('')).toEqual([]);
        expect(parseRoles('   ')).toEqual([]);
        expect(parseRoles(undefined)).toEqual([]);
    });
});

describe('paramsetIdentity', () => {
    const device: DeviceDescription = {
        ADDRESS: 'MEQ0123456',
        TYPE: 'HM-LC-Sw1-Pl-CT-R1',
        FIRMWARE: '2.5',
        VERSION: 8,
    };
    const channel: DeviceDescription = {
        ADDRESS: 'MEQ0123456:1',
        TYPE: 'SWITCH',
        PARENT: 'MEQ0123456',
    };

    it('builds the key the description cache uses for a channel', () => {
        expect(paramsetIdentity('BidCos-RF', channel, 'MASTER', device)).toBe(
            'BidCos-RF/HM-LC-Sw1-Pl-CT-R1/2.5/8/SWITCH/MASTER',
        );
    });

    it('leaves the channel type empty for a device', () => {
        expect(paramsetIdentity('BidCos-RF', device, 'MASTER')).toBe('BidCos-RF/HM-LC-Sw1-Pl-CT-R1/2.5/8//MASTER');
    });

    it('leaves missing firmware and version as empty segments', () => {
        expect(paramsetIdentity('CUxD', {ADDRESS: 'CUX2801001', TYPE: 'CUX28-01'}, 'MASTER')).toBe(
            'CUxD/CUX28-01////MASTER',
        );
    });

    it('refuses to guess a channel device', () => {
        expect(() => paramsetIdentity('BidCos-RF', channel, 'MASTER')).toThrow(/without its device/);
    });
});

describe('DeviceIndex', () => {
    it('is empty without descriptions', () => {
        const empty = new DeviceIndex('BidCos-RF');
        expect(empty.size).toBe(0);
        expect(empty.devices()).toEqual([]);
        expect(empty.channels()).toEqual([]);
        expect(empty.all()).toEqual([]);
    });

    it('separates devices from channels', () => {
        const it_ = index();
        expect(it_.size).toBe(bidcos.length);
        expect(it_.devices().map((d) => d.ADDRESS)).toEqual([
            'BidCoS-RF',
            'LEQ0654321',
            'MEQ0123456',
            'MEQ0888888',
            'MEQ0999999',
        ]);
        expect(it_.channels()).toHaveLength(bidcos.length - 5);
    });

    it('sorts everything with the device before its channels', () => {
        expect(
            index()
                .all()
                .slice(0, 4)
                .map((d) => d.ADDRESS),
        ).toEqual(['BidCoS-RF', 'BidCoS-RF:0', 'BidCoS-RF:1', 'LEQ0654321']);
    });

    it('looks descriptions up by address', () => {
        const it_ = index();
        expect(it_.has('MEQ0123456:1')).toBe(true);
        expect(it_.has('nope')).toBe(false);
        expect(it_.get('MEQ0123456:1')?.TYPE).toBe('SWITCH');
        expect(it_.get('nope')).toBeUndefined();
        expect(it_.require('MEQ0123456').TYPE).toBe('HM-LC-Sw1-Pl-CT-R1');
        expect(() => it_.require('nope')).toThrow(/unknown address nope on interface BidCos-RF/);
    });

    it('finds the channels of a device, sorted by index', () => {
        expect(
            index()
                .childrenOf('LEQ0654321')
                .map((c) => c.ADDRESS),
        ).toEqual(['LEQ0654321:0', 'LEQ0654321:1', 'LEQ0654321:2']);
    });

    it('falls back to CHILDREN when the channels are not in the index', () => {
        const partial = new DeviceIndex('BidCos-RF', [
            {ADDRESS: 'A', TYPE: 'T', CHILDREN: ['A:0', 'A:1']},
            {ADDRESS: 'A:1', TYPE: 'SWITCH'},
        ]);
        // A:1 has no PARENT here, so it is not derived as a child; CHILDREN still resolves it,
        // and the entry the index does not know is dropped instead of returned as undefined
        expect(partial.childrenOf('A').map((c) => c.ADDRESS)).toEqual(['A:1']);
    });

    it('has no children for an unknown device and none for a device without any', () => {
        expect(index().childrenOf('nope')).toEqual([]);
        expect(new DeviceIndex('X', [{ADDRESS: 'A', TYPE: 'T'}]).childrenOf('A')).toEqual([]);
    });

    it('finds the device of a channel', () => {
        const it_ = index();
        expect(it_.parentOf('MEQ0123456:1')?.ADDRESS).toBe('MEQ0123456');
        expect(it_.parentOf('MEQ0123456')).toBeUndefined();
        expect(it_.parentOf('nope')).toBeUndefined();
    });

    it('returns no device when the parent is missing from the index', () => {
        const orphan = new DeviceIndex('X', [{ADDRESS: 'A:1', TYPE: 'SWITCH', PARENT: 'A'}]);
        expect(orphan.parentOf('A:1')).toBeUndefined();
    });

    it('finds the maintenance channel from a device and from any channel', () => {
        const it_ = index();
        expect(it_.maintenanceChannelOf('MEQ0123456')?.ADDRESS).toBe('MEQ0123456:0');
        expect(it_.maintenanceChannelOf('MEQ0123456:1')?.ADDRESS).toBe('MEQ0123456:0');
        expect(it_.maintenanceChannelOf('nope')).toBeUndefined();
        expect(it_.maintenanceChannelOf('')).toBeUndefined();
    });

    it('flags the CCU own devices and their channels', () => {
        const it_ = index();
        expect(it_.isCentral('BidCoS-RF')).toBe(true);
        expect(it_.isCentral('BidCoS-RF:1')).toBe(true);
        expect(it_.isCentral('MEQ0123456')).toBe(false);
        expect(it_.isCentral('nope')).toBe(false);
        expect(it_.centralDevices().map((d) => d.ADDRESS)).toEqual(['BidCoS-RF']);
    });

    it('flags a central channel by its device when PARENT_TYPE is missing', () => {
        const noParentType = new DeviceIndex('HmIP-RF', [
            {ADDRESS: 'HmIP-RCV-50', TYPE: 'HmIP-RCV-50'},
            {ADDRESS: 'HmIP-RCV-50:1', TYPE: 'KEY_TRANSCEIVER', PARENT: 'HmIP-RCV-50'},
        ]);
        expect(noParentType.isCentral('HmIP-RCV-50:1')).toBe(true);
    });

    it('does not flag a channel whose device is unknown', () => {
        const orphan = new DeviceIndex('X', [{ADDRESS: 'A:1', TYPE: 'SWITCH', PARENT: 'A'}]);
        expect(orphan.isCentral('A:1')).toBe(false);
    });

    it('indexes link roles in both directions', () => {
        const it_ = index();
        expect(it_.sourceRole('SWITCH')).toEqual(['BidCoS-RF:1', 'LEQ0654321:1', 'LEQ0654321:2']);
        expect(it_.targetRole('SWITCH')).toEqual(['MEQ0123456:1', 'MEQ0999999:1', 'MEQ0888888:1']);
        expect(it_.sourceRoles()).toEqual(['KEYMATIC', 'SWITCH', 'WINMATIC']);
        expect(it_.targetRoles()).toEqual(['SWITCH']);
    });

    it('has no addresses for an unknown role and hands out copies', () => {
        const it_ = index();
        expect(it_.sourceRole('NOPE')).toEqual([]);
        expect(it_.targetRole('NOPE')).toEqual([]);
        const roles = it_.sourceRole('SWITCH');
        roles.push('tampered');
        expect(it_.sourceRole('SWITCH')).not.toContain('tampered');
    });

    it('builds the paramset identity of a channel and of a device', () => {
        const it_ = index();
        expect(it_.paramsetIdentity('MEQ0123456:1', 'MASTER')).toBe('BidCos-RF/HM-LC-Sw1-Pl-CT-R1/2.5/8/SWITCH/MASTER');
        expect(it_.paramsetIdentity('MEQ0123456', 'MASTER')).toBe('BidCos-RF/HM-LC-Sw1-Pl-CT-R1/2.5/8//MASTER');
    });

    it('has no paramset identity for an unknown address or an orphaned channel', () => {
        expect(index().paramsetIdentity('nope', 'MASTER')).toBeUndefined();
        const orphan = new DeviceIndex('X', [{ADDRESS: 'A:1', TYPE: 'SWITCH', PARENT: 'A'}]);
        expect(orphan.paramsetIdentity('A:1', 'MASTER')).toBeUndefined();
    });

    it('gives two channels of the same device type, firmware and version the same identity', () => {
        const it_ = index();
        expect(it_.paramsetIdentity('MEQ0999999:1', 'MASTER')).toBe(it_.paramsetIdentity('MEQ0123456:1', 'MASTER'));
        // the same channel type on older firmware is a different description
        expect(it_.paramsetIdentity('MEQ0888888:1', 'MASTER')).not.toBe(it_.paramsetIdentity('MEQ0123456:1', 'MASTER'));
    });

    it('indexes an HmIP interface the same way', () => {
        const it_ = new DeviceIndex('HmIP-RF', hmip);
        expect(it_.isCentral('HmIP-RCV-50')).toBe(true);
        expect(it_.paramsetIdentity('0001D3C99C1234:2', 'LINK')).toBe(
            'HmIP-RF/HmIP-PDT/1.4.8/2/DIMMER_VIRTUAL_RECEIVER/LINK',
        );
        expect(it_.childrenOf('0001D3C99C1234')).toHaveLength(4);
    });
});
