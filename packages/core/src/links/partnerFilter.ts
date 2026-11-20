/**
 * Which channels the "create link" dialog offers, beyond the role matrix.
 *
 * The roles (`roles.ts`) say which channels *can* be linked. The CCU's WebUI offers fewer: its
 * channel list for a new link (`ic_selchannel.cgi`, `showHmIPChannel` and `linkIsExpertChannel`,
 * read at OpenCCU 3.89.13) leaves out channels a link makes no sense for or must not be made
 * with - a plug's own button as the sender of a link to another device, the channels a light
 * controller does not use in its mode, the second and third virtual channel of every actuator
 * channel. This module is those rules as data and a few predicates, so the dialog can offer what
 * the CCU offers and still show everything on request.
 *
 * Pure: the rules that depend on how a device is set up need a MASTER paramset, and the caller
 * reads those ({@link linkFilterMasters} says which) and hands them in. A paramset that was not
 * read hides nothing - an unknown mode shows the channel, as the WebUI's rules fall through.
 *
 * Not ported: the display channels of the wall-mount glass displays (`*-WGD`, `*-WGD-PL`). The
 * WebUI picks them by the order of the screens, which it keeps in ReGa's metadata of the device
 * and nowhere on the device itself; there is nothing to read it from on a system without ReGa.
 */

import {tryParseAddress} from '../address/address.js';
import {isChannelDescription, type DeviceDescription, type DeviceIndex} from '../devices/index.js';
import type {Paramset} from '../rpc/values.js';

/** Why a channel is not offered. */
export type LinkChannelHiddenReason =
    /** The device's own key or sensor channel: linked inside the device, not offered to others. */
    | 'internal-sender'
    /** A channel type no link is made with (the week program, an unused key, the KWL controller). */
    | 'not-for-links'
    /** Not in use in the mode or layout the device is set to. */
    | 'device-mode'
    /** The second and third virtual channel of an actuator channel, and the like: expert channels. */
    | 'expert'
    /** The interface marks the channel invisible (`FLAGS` without bit 0). */
    | 'invisible';

/** `DIRECTION` of a channel description. */
const SENDER = 1;

/** `FLAGS` bit 0: the channel is meant to be shown. */
const FLAG_VISIBLE = 1;

/** The virtual receiver channels that come in threes, of which the WebUI shows the first. */
const VIRTUAL_RECEIVER_TYPES: ReadonlySet<string> = new Set([
    'DIMMER_VIRTUAL_RECEIVER',
    'SWITCH_VIRTUAL_RECEIVER',
    'BLIND_VIRTUAL_RECEIVER',
    'SHUTTER_VIRTUAL_RECEIVER',
    'ACOUSTIC_SIGNAL_VIRTUAL_RECEIVER',
    'SERVO_VIRTUAL_RECEIVER',
]);

/** The BidCos dimmers' virtual channels: only with the WebUI's expert mode. */
const BIDCOS_VIRTUAL_TYPES: ReadonlySet<string> = new Set([
    'VIRTUAL_DIMMER',
    'VIRTUAL_DUAL_WHITE_BRIGHTNESS',
    'VIRTUAL_DUAL_WHITE_COLOR',
]);

/** Devices whose channels 2, 4, 6 and 8 are the expert ones (3 and 7 are needed for some links). */
const EVEN_CHANNEL_EXPERT_DEVICES: ReadonlySet<string> = new Set(['HMIP-MIOB', 'HMIP-WHS2']);

/** The wall-mount glass switches whose keys depend on `DEVICE_INPUT_LAYOUT_MODE`. */
const WGS_DEVICES: ReadonlySet<string> = new Set(['HMIP-WGS', 'HMIP-WGS-A', 'HMIPW-WGS', 'HMIPW-WGS-A']);

/** Channel types the WebUI never offers for a link. */
const NEVER_LINKED_TYPES: ReadonlySet<string> = new Set(['WEEK_PROGRAM', 'KWL_CONTROLLER_TRANSMITTER']);

/** The MASTER paramsets the rules were given, by address. */
export type LinkFilterMasters = ReadonlyMap<string, Paramset>;

function deviceTypeOf(channel: DeviceDescription, device: DeviceDescription | undefined): string {
    return (channel.PARENT_TYPE ?? device?.TYPE ?? '').toUpperCase();
}

function channelNumber(channel: DeviceDescription): number | undefined {
    return channel.INDEX ?? tryParseAddress(channel.ADDRESS)?.index;
}

function maintenanceAddress(channel: DeviceDescription): string {
    const device = channel.PARENT ?? tryParseAddress(channel.ADDRESS)?.device ?? channel.ADDRESS;
    return `${device}:0`;
}

/** A number out of a paramset: hmipserver answers an ENUM with its index. A name is not resolved. */
function numberOf(master: Paramset | undefined, param: string): number | undefined {
    const value = master?.[param];
    if (typeof value === 'number') {
        return value;
    }
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
        return Number(value);
    }
    return undefined;
}

/** The major version of a firmware string; `undefined` where there is none. */
function firmwareMajor(firmware: string | undefined): number | undefined {
    const major = Number.parseInt((firmware ?? '').split('.')[0] ?? '', 10);
    return Number.isNaN(major) ? undefined : major;
}

/**
 * The device's own sender channels that are not offered to other devices: the internal button of
 * the plugs and the PCB switches (`HmIP-PS`, `HmIP-PSM*`, `HmIP-PDT*`, `HmIP-PCBS*`,
 * `ELV-SH-SW1-BAT`), and every sender channel of a measuring plug with a firmware before 2.x -
 * its `COND_SWITCH_TRANSMITTER` cannot be linked there - except on the HmIP-PSMCO.
 */
function isInternalSender(
    deviceType: string,
    channel: DeviceDescription,
    device: DeviceDescription | undefined,
): boolean {
    if (channel.DIRECTION !== SENDER) {
        return false;
    }
    if (deviceType === 'HMIP-PS' || deviceType === 'ELV-SH-SW1-BAT') {
        return true;
    }
    if (deviceType.startsWith('HMIP-PDT') || deviceType.startsWith('HMIP-PCBS')) {
        return true;
    }
    if (deviceType.startsWith('HMIP-PSM')) {
        if (channel.TYPE === 'KEY_TRANSCEIVER') {
            return true;
        }
        const major = firmwareMajor(device?.FIRMWARE);
        return major !== undefined && major < 2 && deviceType !== 'HMIP-PSMCO';
    }
    return false;
}

/**
 * The channels a device does not use the way it is set up. `undefined` where no rule of this kind
 * applies to the channel or the paramset it needs was not read; `false` where a rule says "show".
 */
function hiddenByMode(
    deviceType: string,
    channel: DeviceDescription,
    number: number | undefined,
    masters: LinkFilterMasters,
): boolean | undefined {
    if (deviceType === 'HMIP-RGBW' && channel.TYPE === 'UNIVERSAL_LIGHT_RECEIVER') {
        // 0 = RGBW, 1 = RGB: one light on channel 1; 2 = tunable white: two; 3 = PWM: all four
        const mode = numberOf(masters.get(maintenanceAddress(channel)), 'DEVICE_OPERATION_MODE');
        if (mode === 0 || mode === 1) return number !== 1;
        if (mode === 2) return number !== 1 && number !== 2;
        if (mode === 3) return false;
        return undefined;
    }
    if (deviceType === 'HMIP-DRG-DALI') {
        const own = masters.get(channel.ADDRESS);
        const dali = numberOf(own, 'DALI_ADDRESS');
        if (dali !== undefined) {
            // 255: no DALI device behind this channel
            return dali === 255;
        }
        if (number !== undefined && number >= 33 && number <= 48) {
            // a group channel nothing is assigned to
            return numberOf(own, 'UNIVERSAL_LIGHT_MAX_CAPABILITIES') === 5 ? true : undefined;
        }
        return undefined;
    }
    if (WGS_DEVICES.has(deviceType) && channel.TYPE === 'KEY_TRANSCEIVER') {
        // the keys the chosen layout has: one rocker (0), two (1, 2), or all four keys
        const mode = numberOf(masters.get(maintenanceAddress(channel)), 'DEVICE_INPUT_LAYOUT_MODE');
        if (mode === 0 && (number === 2 || number === 3 || number === 4)) return true;
        if ((mode === 1 || mode === 2) && (number === 3 || number === 4)) return true;
        return undefined;
    }
    return undefined;
}

/**
 * Every channel of the interface the WebUI would not offer for a new link, with the reason.
 *
 * The order of the rules is the WebUI's: the device's own senders, the channel types never linked,
 * the device's mode, the expert channels, and last the interface's own "invisible" flag.
 */
export function hiddenLinkChannels(
    index: DeviceIndex,
    masters: LinkFilterMasters = new Map(),
): Map<string, LinkChannelHiddenReason> {
    const hidden = new Map<string, LinkChannelHiddenReason>();
    for (const device of index.devices()) {
        // the virtual channels of one device, counted in threes in channel order
        let virtualCount = 0;
        for (const channel of index.childrenOf(device.ADDRESS)) {
            if (!isChannelDescription(channel)) {
                continue;
            }
            const deviceType = deviceTypeOf(channel, device);
            const number = channelNumber(channel);
            const reason = reasonFor(deviceType, channel, device, number, masters, () => {
                virtualCount = virtualCount >= 3 ? 1 : virtualCount + 1;
                return virtualCount;
            });
            if (reason !== undefined) {
                hidden.set(channel.ADDRESS, reason);
            }
        }
    }
    return hidden;
}

function reasonFor(
    deviceType: string,
    channel: DeviceDescription,
    device: DeviceDescription,
    number: number | undefined,
    masters: LinkFilterMasters,
    nextVirtual: () => number,
): LinkChannelHiddenReason | undefined {
    if (BIDCOS_VIRTUAL_TYPES.has(channel.TYPE)) {
        return 'expert';
    }
    if (isInternalSender(deviceType, channel, device)) {
        return 'internal-sender';
    }
    if (NEVER_LINKED_TYPES.has(channel.TYPE)) {
        return 'not-for-links';
    }
    // the sabotage contact of the HmIP-ASIR is described as a key and is none
    if (deviceType.includes('HMIP-ASIR') && channel.TYPE === 'KEY_TRANSCEIVER') {
        return 'not-for-links';
    }
    const mode = hiddenByMode(deviceType, channel, number, masters);
    if (mode === true) {
        return 'device-mode';
    }
    if (mode === undefined) {
        // a mode rule that says "show" ends the WebUI's function before the expert rule, too
        if (EVEN_CHANNEL_EXPERT_DEVICES.has(deviceType)) {
            if (number === 2 || number === 4 || number === 6 || number === 8) {
                return 'expert';
            }
        } else if (VIRTUAL_RECEIVER_TYPES.has(channel.TYPE) && nextVirtual() !== 1) {
            return 'expert';
        }
    }
    if (channel.FLAGS !== undefined && (channel.FLAGS & FLAG_VISIBLE) === 0) {
        return 'invisible';
    }
    return undefined;
}

/**
 * The MASTER paramsets {@link hiddenLinkChannels} needs to decide the mode rules: the maintenance
 * channel of an HmIP-RGBW and of the glass switches, and every channel of a DALI gateway. Only
 * for channels that take part in links at all; empty on an interface without such devices.
 */
export function linkFilterMasters(index: DeviceIndex): string[] {
    const addresses = new Set<string>();
    for (const channel of index.channels()) {
        if ((channel.LINK_SOURCE_ROLES ?? '') === '' && (channel.LINK_TARGET_ROLES ?? '') === '') {
            continue;
        }
        const deviceType = deviceTypeOf(channel, index.parentOf(channel.ADDRESS));
        if (deviceType === 'HMIP-RGBW' && channel.TYPE === 'UNIVERSAL_LIGHT_RECEIVER') {
            addresses.add(maintenanceAddress(channel));
        } else if (WGS_DEVICES.has(deviceType) && channel.TYPE === 'KEY_TRANSCEIVER') {
            addresses.add(maintenanceAddress(channel));
        } else if (deviceType === 'HMIP-DRG-DALI') {
            addresses.add(channel.ADDRESS);
        }
    }
    return [...addresses];
}

/**
 * A pair the WebUI does not offer although the roles match: a radiator thermostat's own
 * `CLIMATECONTROL_RT_RECEIVER` as the receiver of its own sender channel. The two halves of an
 * HM-CC-RT-DN are meant for the same channels of *other* thermostats.
 */
export function isSameDeviceClimatePair(sender: DeviceDescription, receiver: DeviceDescription): boolean {
    const senderDevice = tryParseAddress(sender.ADDRESS)?.device;
    return (
        senderDevice !== undefined &&
        senderDevice === tryParseAddress(receiver.ADDRESS)?.device &&
        receiver.TYPE === 'CLIMATECONTROL_RT_RECEIVER'
    );
}
