import {describe, expect, it} from 'vitest';

import {DeviceIndex, type DeviceDescription} from '../devices/index.js';
import type {Paramset} from '../rpc/values.js';
import {hiddenLinkChannels, isSameDeviceClimatePair, linkFilterMasters} from './partnerFilter.js';

interface ChannelSpec {
    readonly type: string;
    /** 1 = sender, 2 = receiver. */
    readonly direction?: number;
    readonly flags?: number;
}

/** A device and its channels; channel `n` of the list is `<address>:<n>`, `:0` is the maintenance channel. */
function device(
    address: string,
    type: string,
    channels: readonly ChannelSpec[],
    firmware = '1.0.0',
): DeviceDescription[] {
    return [
        {ADDRESS: address, TYPE: type, FIRMWARE: firmware, VERSION: 1, FLAGS: 1},
        {
            ADDRESS: `${address}:0`,
            TYPE: 'MAINTENANCE',
            PARENT: address,
            PARENT_TYPE: type,
            INDEX: 0,
            VERSION: 1,
            FLAGS: 1,
        },
        ...channels.map((channel, at) => ({
            ADDRESS: `${address}:${String(at + 1)}`,
            TYPE: channel.type,
            PARENT: address,
            PARENT_TYPE: type,
            INDEX: at + 1,
            VERSION: 1,
            FLAGS: channel.flags ?? 1,
            DIRECTION: channel.direction ?? 2,
            ...(channel.direction === 1
                ? {LINK_SOURCE_ROLES: 'REMOTE_CONTROL'}
                : {LINK_TARGET_ROLES: 'REMOTE_CONTROL'}),
        })),
    ];
}

const KEY: ChannelSpec = {type: 'KEY_TRANSCEIVER', direction: 1};
const SWITCH_STATE: ChannelSpec = {type: 'SWITCH_TRANSMITTER', direction: 1};
const SWITCH: ChannelSpec = {type: 'SWITCH_VIRTUAL_RECEIVER'};
const DIMMER: ChannelSpec = {type: 'DIMMER_VIRTUAL_RECEIVER'};
const LIGHT: ChannelSpec = {type: 'UNIVERSAL_LIGHT_RECEIVER'};

function hidden(devices: DeviceDescription[], masters: Record<string, Paramset> = {}): Record<string, string> {
    const index = new DeviceIndex('HmIP-RF', devices);
    return Object.fromEntries(hiddenLinkChannels(index, new Map(Object.entries(masters))));
}

describe("hiddenLinkChannels: the device's own sender channels", () => {
    it('hides the internal button of plugs, dimmer plugs and PCB switches as a sender', () => {
        for (const type of [
            'HmIP-PS',
            'HMIP-PS',
            'HmIP-PDT',
            'HmIP-PDT-UK',
            'HmIP-PCBS',
            'HmIP-PCBS-BAT',
            'ELV-SH-SW1-BAT',
        ]) {
            const result = hidden(device('A', type, [KEY, SWITCH_STATE, SWITCH]));
            expect(result, type).toMatchObject({'A:1': 'internal-sender', 'A:2': 'internal-sender'});
            expect(result['A:3'], type).toBeUndefined();
        }
    });

    it('does not take HmIP-PS as a prefix: an HmIP-PSM is not an HmIP-PS', () => {
        const condition: ChannelSpec = {type: 'COND_SWITCH_TRANSMITTER', direction: 1};
        expect(hidden(device('A', 'HmIP-PSM', [KEY, condition, SWITCH], '2.6.2'))).toEqual({'A:1': 'internal-sender'});
    });

    it('hides every sender channel of a measuring plug with a firmware before 2.x, but not on the PSMCO', () => {
        const condition: ChannelSpec = {type: 'COND_SWITCH_TRANSMITTER', direction: 1};
        const channels = [KEY, condition, SWITCH];
        expect(hidden(device('A', 'HmIP-PSM', channels, '1.8.4'))).toEqual({
            'A:1': 'internal-sender',
            'A:2': 'internal-sender',
        });
        expect(hidden(device('A', 'HmIP-PSM-2', channels, '1.0.2'))).toMatchObject({'A:2': 'internal-sender'});
        // the key stays hidden on every measuring plug, the condition channel not on the PSMCO
        expect(hidden(device('A', 'HmIP-PSMCO', channels, '1.0.2'))).toEqual({'A:1': 'internal-sender'});
        // an unknown firmware hides nothing more than the key
        expect(hidden(device('A', 'HmIP-PSM', channels, ''))).toEqual({'A:1': 'internal-sender'});
        // the ELV kit with a measuring channel is not an HmIP-PSM at all
        expect(hidden(device('A', 'ELV-SH-PSMCI', channels, '1.0.2'))).toEqual({});
    });

    it('leaves the senders of other devices alone', () => {
        expect(hidden(device('A', 'HmIP-WRC2', [KEY, KEY]))).toEqual({});
        expect(hidden(device('A', 'HmIP-BSM', [KEY, KEY, SWITCH_STATE, SWITCH]))).toEqual({});
    });
});

describe('hiddenLinkChannels: channel types no link is made with', () => {
    it('hides the week program, the KWL controller and the sabotage "key" of the HmIP-ASIR', () => {
        expect(
            hidden(
                device('A', 'HmIP-BROLL', [{type: 'WEEK_PROGRAM'}, {type: 'KWL_CONTROLLER_TRANSMITTER', direction: 1}]),
            ),
        ).toEqual({'A:1': 'not-for-links', 'A:2': 'not-for-links'});
        expect(hidden(device('A', 'HmIP-ASIR-2', [KEY, {type: 'ALARM_SWITCH_VIRTUAL_RECEIVER'}]))).toEqual({
            'A:1': 'not-for-links',
        });
    });
});

describe('hiddenLinkChannels: the mode a device is set to', () => {
    const rgbw = device('R', 'HmIP-RGBW', [LIGHT, LIGHT, LIGHT, LIGHT]);

    it('shows the channels an HmIP-RGBW uses in its mode', () => {
        const all = {'R:2': 'device-mode', 'R:3': 'device-mode', 'R:4': 'device-mode'};
        expect(hidden(rgbw, {'R:0': {DEVICE_OPERATION_MODE: 0}})).toEqual(all);
        expect(hidden(rgbw, {'R:0': {DEVICE_OPERATION_MODE: 1}})).toEqual(all);
        expect(hidden(rgbw, {'R:0': {DEVICE_OPERATION_MODE: 2}})).toEqual({'R:3': 'device-mode', 'R:4': 'device-mode'});
        expect(hidden(rgbw, {'R:0': {DEVICE_OPERATION_MODE: 3}})).toEqual({});
        // a value as text, as a form or another interface may deliver it
        expect(hidden(rgbw, {'R:0': {DEVICE_OPERATION_MODE: '2'}})).toEqual({
            'R:3': 'device-mode',
            'R:4': 'device-mode',
        });
    });

    it('hides nothing while the mode is not known', () => {
        expect(hidden(rgbw)).toEqual({});
        expect(hidden(rgbw, {'R:0': {}})).toEqual({});
        expect(hidden(rgbw, {'R:0': {DEVICE_OPERATION_MODE: 'TUNABLE_WHITE'}})).toEqual({});
    });

    it('shows the keys the layout of a glass switch has', () => {
        for (const type of ['HmIP-WGS', 'HmIP-WGS-A', 'HmIPW-WGS', 'HmIPW-WGS-A']) {
            const wgs = device('W', type, [KEY, KEY, KEY, KEY]);
            expect(hidden(wgs, {'W:0': {DEVICE_INPUT_LAYOUT_MODE: 0}}), type).toEqual({
                'W:2': 'device-mode',
                'W:3': 'device-mode',
                'W:4': 'device-mode',
            });
            expect(hidden(wgs, {'W:0': {DEVICE_INPUT_LAYOUT_MODE: 1}}), type).toEqual({
                'W:3': 'device-mode',
                'W:4': 'device-mode',
            });
            expect(hidden(wgs, {'W:0': {DEVICE_INPUT_LAYOUT_MODE: 2}}), type).toEqual({
                'W:3': 'device-mode',
                'W:4': 'device-mode',
            });
            expect(hidden(wgs, {'W:0': {DEVICE_INPUT_LAYOUT_MODE: 3}}), type).toEqual({});
            expect(hidden(wgs), type).toEqual({});
        }
    });

    it('shows the DALI channels a device or a group is behind', () => {
        const dali = device(
            'D',
            'HmIP-DRG-DALI',
            Array.from({length: 48}, () => LIGHT),
        );
        const result = hidden(dali, {
            'D:1': {DALI_ADDRESS: 0},
            'D:2': {DALI_ADDRESS: 255},
            'D:33': {UNIVERSAL_LIGHT_MAX_CAPABILITIES: 5},
            'D:34': {UNIVERSAL_LIGHT_MAX_CAPABILITIES: 2},
            // not a group channel: the capabilities alone hide nothing
            'D:3': {UNIVERSAL_LIGHT_MAX_CAPABILITIES: 5},
        });
        expect(result).toEqual({'D:2': 'device-mode', 'D:33': 'device-mode'});
    });

    it('says which MASTER paramsets these rules need', () => {
        const index = new DeviceIndex('HmIP-RF', [
            ...rgbw,
            ...device('W', 'HmIPW-WGS', [KEY, KEY]),
            ...device('D', 'HmIP-DRG-DALI', [LIGHT, LIGHT]),
            ...device('P', 'HmIP-PDT', [KEY, DIMMER]),
        ]);
        expect(linkFilterMasters(index).sort()).toEqual(['D:1', 'D:2', 'R:0', 'W:0']);
        expect(linkFilterMasters(new DeviceIndex('HmIP-RF', device('P', 'HmIP-PDT', [KEY, DIMMER])))).toEqual([]);
    });
});

describe('hiddenLinkChannels: expert channels', () => {
    it('shows the first of every three virtual channels of an actuator channel', () => {
        // a DRS8 as the lab has it: the state channel, then its three virtual channels, per output
        const drs = device('S', 'HmIPW-DRS8', [
            SWITCH_STATE,
            SWITCH,
            SWITCH,
            SWITCH,
            SWITCH_STATE,
            SWITCH,
            SWITCH,
            SWITCH,
        ]);
        expect(hidden(drs)).toEqual({'S:3': 'expert', 'S:4': 'expert', 'S:7': 'expert', 'S:8': 'expert'});
        for (const type of [
            'DIMMER_VIRTUAL_RECEIVER',
            'BLIND_VIRTUAL_RECEIVER',
            'SHUTTER_VIRTUAL_RECEIVER',
            'ACOUSTIC_SIGNAL_VIRTUAL_RECEIVER',
            'SERVO_VIRTUAL_RECEIVER',
        ]) {
            expect(hidden(device('A', 'HmIP-X', [{type}, {type}, {type}])), type).toEqual({
                'A:2': 'expert',
                'A:3': 'expert',
            });
        }
    });

    it('counts per device', () => {
        const result = hidden([
            ...device('A', 'HmIP-X', [SWITCH, SWITCH]),
            ...device('B', 'HmIP-X', [SWITCH, SWITCH, SWITCH]),
        ]);
        expect(result).toEqual({'A:2': 'expert', 'B:2': 'expert', 'B:3': 'expert'});
    });

    it('hides channels 2, 4, 6 and 8 of the HmIP-MIOB and the HmIP-WHS2 instead', () => {
        for (const type of ['HmIP-MIOB', 'HmIP-WHS2']) {
            const result = hidden(
                device('M', type, [SWITCH_STATE, SWITCH, SWITCH, SWITCH, SWITCH_STATE, SWITCH, SWITCH, SWITCH]),
            );
            expect(result, type).toEqual({'M:2': 'expert', 'M:4': 'expert', 'M:6': 'expert', 'M:8': 'expert'});
        }
    });

    it("hides a BidCos dimmer's virtual channels", () => {
        const dimmer = device('B', 'HM-LC-Dim1T-Pl-3', [
            {type: 'DIMMER'},
            {type: 'VIRTUAL_DIMMER'},
            {type: 'VIRTUAL_DIMMER'},
            {type: 'VIRTUAL_DUAL_WHITE_BRIGHTNESS'},
            {type: 'VIRTUAL_DUAL_WHITE_COLOR'},
        ]);
        expect(hidden(dimmer)).toEqual({'B:2': 'expert', 'B:3': 'expert', 'B:4': 'expert', 'B:5': 'expert'});
    });
});

describe('hiddenLinkChannels: the rest', () => {
    it('hides a channel the interface marks invisible', () => {
        expect(hidden(device('A', 'HmIP-X', [KEY, {type: 'SWITCH', flags: 0}, {type: 'SWITCH', flags: 3}]))).toEqual({
            'A:2': 'invisible',
        });
    });

    it('never names the maintenance channel or the device itself', () => {
        const result = hidden(device('A', 'HmIP-PS', [KEY]));
        expect(Object.keys(result)).toEqual(['A:1']);
    });

    it('takes the device type from the device where the channel does not carry it', () => {
        const index = new DeviceIndex('HmIP-RF', [
            {ADDRESS: 'A', TYPE: 'HmIP-PDT', VERSION: 1},
            {ADDRESS: 'A:1', TYPE: 'KEY_TRANSCEIVER', PARENT: 'A', VERSION: 1, DIRECTION: 1},
        ]);
        expect(Object.fromEntries(hiddenLinkChannels(index))).toEqual({
            'A:1': 'internal-sender',
        });
    });
});

describe('isSameDeviceClimatePair', () => {
    const channel = (address: string, type: string): DeviceDescription => ({ADDRESS: address, TYPE: type, VERSION: 1});

    it("is a radiator thermostat's own receiver half", () => {
        const transceiver = channel('RT1:4', 'CLIMATECONTROL_RT_TRANSCEIVER');
        expect(isSameDeviceClimatePair(transceiver, channel('RT1:5', 'CLIMATECONTROL_RT_RECEIVER'))).toBe(true);
        expect(isSameDeviceClimatePair(transceiver, channel('RT2:5', 'CLIMATECONTROL_RT_RECEIVER'))).toBe(false);
        expect(isSameDeviceClimatePair(transceiver, channel('RT1:6', 'CLIMATECONTROL_REGULATOR'))).toBe(false);
        expect(isSameDeviceClimatePair(channel('', 'X'), channel('', 'CLIMATECONTROL_RT_RECEIVER'))).toBe(false);
    });
});
