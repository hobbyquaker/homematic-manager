/**
 * Direct links: which channels can be linked to which, and what `getLinks` returns.
 *
 * A link is possible when the sender's `LINK_SOURCE_ROLES` and the receiver's `LINK_TARGET_ROLES`
 * share a role. Both are space-separated lists on the channel description. The 2.x renderer built
 * this from two global role indexes (`initGridLinks`, the `$selectLinkSender.change` handler and
 * `dialogAddLink`, homematic-manager.js:788-812, :2597-2790) and read the current selection back
 * out of the DOM; here it is the device index plus these functions.
 *
 * Three rules the old dialog applied and that are kept: only channels take part (a device has no
 * roles), the maintenance channel `:0` never does, and a channel without the matching role list is
 * not offered at all.
 */

import {isMaintenanceAddress} from '../address/address.js';
import {isChannelDescription, parseRoles, type DeviceDescription, type DeviceIndex} from '../devices/index.js';

/** A link as `getLinks` returns it. */
export interface Link {
    readonly SENDER: string;
    readonly RECEIVER: string;
    readonly NAME?: string;
    readonly DESCRIPTION?: string;
    /** Bit field, see {@link LINK_FLAGS}. */
    readonly FLAGS?: number;
    /** Present when `getLinks` was called with `GL_FLAG_SENDER_PARAMSET`. */
    readonly SENDER_PARAMSET?: Readonly<Record<string, unknown>>;
    /** Present when `getLinks` was called with `GL_FLAG_RECEIVER_PARAMSET`. */
    readonly RECEIVER_PARAMSET?: Readonly<Record<string, unknown>>;
}

/**
 * `FLAGS` of a link record: the interface process marks the side whose configuration it could not
 * write, which is how a link survives as "half done" after a failed transfer.
 *
 * ASSUMPTION (A-3, see packages/core/ASSUMPTIONS.md): these two bits are what the eQ-3 XML-RPC
 * specification documents; 2.x never decoded `FLAGS` at all, so there is no working code to
 * compare against. Task 6 provokes a broken link in the lab and checks the value.
 */
export const LINK_FLAGS = {
    SENDER_BROKEN: 1,
    RECEIVER_BROKEN: 2,
} as const;

export interface DecodedLinkFlags {
    readonly senderBroken: boolean;
    readonly receiverBroken: boolean;
    /** Either side is broken - what the grid marks the row with. */
    readonly broken: boolean;
    readonly unknownBits: number;
}

export function decodeLinkFlags(flags: number | undefined): DecodedLinkFlags {
    const bits = typeof flags === 'number' ? flags : 0;
    const senderBroken = (bits & LINK_FLAGS.SENDER_BROKEN) !== 0;
    const receiverBroken = (bits & LINK_FLAGS.RECEIVER_BROKEN) !== 0;
    return {
        senderBroken,
        receiverBroken,
        broken: senderBroken || receiverBroken,
        unknownBits: bits & ~(LINK_FLAGS.SENDER_BROKEN | LINK_FLAGS.RECEIVER_BROKEN),
    };
}

/** `getLinks` request flags, as the RPC console offers them. */
export const GET_LINKS_FLAGS = {
    GROUP: 1,
    SENDER_PARAMSET: 2,
    RECEIVER_PARAMSET: 4,
} as const;

/** Can this channel be the sender of a direct link? */
export function canSend(description: DeviceDescription): boolean {
    return (
        isChannelDescription(description) &&
        !isMaintenanceAddress(description.ADDRESS) &&
        parseRoles(description.LINK_SOURCE_ROLES).length > 0
    );
}

/** Can this channel be the receiver of a direct link? */
export function canReceive(description: DeviceDescription): boolean {
    return (
        isChannelDescription(description) &&
        !isMaintenanceAddress(description.ADDRESS) &&
        parseRoles(description.LINK_TARGET_ROLES).length > 0
    );
}

/** The roles a sender and a receiver have in common, in the sender's order. */
export function sharedRoles(sender: DeviceDescription, receiver: DeviceDescription): string[] {
    if (!canSend(sender) || !canReceive(receiver)) {
        return [];
    }
    const targets = new Set(parseRoles(receiver.LINK_TARGET_ROLES));
    return parseRoles(sender.LINK_SOURCE_ROLES).filter((role) => targets.has(role));
}

/** Is a direct link between these two channels possible at all? */
export function canLink(sender: DeviceDescription, receiver: DeviceDescription): boolean {
    return sender.ADDRESS !== receiver.ADDRESS && sharedRoles(sender, receiver).length > 0;
}

/** Every channel of the interface that can be the sender of a link, in address order. */
export function linkSenders(index: DeviceIndex): DeviceDescription[] {
    return index.channels().filter((channel) => canSend(channel));
}

/** Every channel of the interface that can be the receiver of a link, in address order. */
export function linkReceivers(index: DeviceIndex): DeviceDescription[] {
    return index.channels().filter((channel) => canReceive(channel));
}

/** The receivers a given sender can be linked to. Empty for an unknown or role-less address. */
export function linkTargetsFor(index: DeviceIndex, senderAddress: string): DeviceDescription[] {
    const sender = index.get(senderAddress);
    if (!sender) {
        return [];
    }
    return linkReceivers(index).filter((receiver) => canLink(sender, receiver));
}

/** The senders that can be linked to a given receiver. */
export function linkSourcesFor(index: DeviceIndex, receiverAddress: string): DeviceDescription[] {
    const receiver = index.get(receiverAddress);
    if (!receiver) {
        return [];
    }
    return linkSenders(index).filter((sender) => canLink(sender, receiver));
}
