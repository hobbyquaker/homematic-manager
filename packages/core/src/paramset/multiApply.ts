/**
 * Which other channels a paramset may be written to in one go.
 *
 * 2.x offered every channel with the same `TYPE` and the same device/channel-ness
 * (homematic-manager.js:1860-1875) and never compared the descriptions. `SWITCH_VIRTUAL_RECEIVER`,
 * `DIMMER_VIRTUAL_RECEIVER`, `KEY_TRANSCEIVER` and `SHUTTER_CONTACT` exist on dozens of device
 * types with different `MASTER` parameters and different firmware; multi-selecting across them is
 * exactly what put more than 100 devices into `CONFIG_PENDING` in issue #98.
 *
 * The rule here is the paramset description identity - same interface, device type, firmware,
 * version, channel type and paramset. It is the same key the description cache uses, so equal
 * identity means literally the same description (roadmap task 6.3).
 */

import type {DeviceIndex} from '../devices/index.js';

export type IneligibleReason =
    /** The channel the dialog was opened on. */
    | 'same-channel'
    /** Not in the device index. */
    | 'unknown-address'
    /** A channel whose device is missing, so no identity can be built. */
    | 'no-identity'
    /** A different paramset description: other device type, firmware, version or channel type. */
    | 'different-identity';

export interface IneligibleChannel {
    readonly address: string;
    readonly reason: IneligibleReason;
    /** The channel's own identity, where there is one - the dialog shows it next to the source. */
    readonly identity?: string;
}

export interface MultiApplyEligibility {
    /** The identity every eligible channel shares. */
    readonly identity: string;
    readonly eligible: readonly string[];
    readonly ineligible: readonly IneligibleChannel[];
}

/**
 * Splits the candidates into the ones that carry the same paramset description as `sourceAddress`
 * and the ones that do not, with a reason for each.
 *
 * @param candidates addresses to consider; by default every device and channel of the index.
 * @throws when the source address has no identity - the dialog cannot be open in that case.
 */
export function multiApplyEligibility(
    index: DeviceIndex,
    sourceAddress: string,
    paramset: string,
    candidates?: Iterable<string>,
): MultiApplyEligibility {
    const identity = index.paramsetIdentity(sourceAddress, paramset);
    if (identity === undefined) {
        throw new Error(`no paramset identity for ${sourceAddress} ${paramset} on ${index.interfaceName}`);
    }

    const eligible: string[] = [];
    const ineligible: IneligibleChannel[] = [];

    for (const address of candidates ?? index.all().map((description) => description.ADDRESS)) {
        if (address === sourceAddress) {
            ineligible.push({address, reason: 'same-channel', identity});
            continue;
        }
        if (!index.has(address)) {
            ineligible.push({address, reason: 'unknown-address'});
            continue;
        }
        const candidateIdentity = index.paramsetIdentity(address, paramset);
        if (candidateIdentity === undefined) {
            ineligible.push({address, reason: 'no-identity'});
            continue;
        }
        if (candidateIdentity === identity) {
            eligible.push(address);
        } else {
            ineligible.push({address, reason: 'different-identity', identity: candidateIdentity});
        }
    }

    return {identity, eligible, ineligible};
}
