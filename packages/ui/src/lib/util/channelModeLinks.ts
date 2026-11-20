import type {ParamsetDescription} from '@homematic-manager/core';
import {isWritable} from '@homematic-manager/core';

/**
 * Task 118: a channel's mode and its direct links.
 *
 * The CCU's WebUI locks a channel's mode while the channel has a direct link (or a program): the
 * profiles of those links belong to the mode, and after a change they no longer fit what the
 * channel does. `check_RF_links` in `ic_deviceparameters.cgi` and `RF_existsLink` /
 * `showHintPrgLink` in `easymodes/js/ic_functions.js` disable the selection of an HmIP multi-mode
 * input (`CHANNEL_OPERATION_MODE`, also the HmIP-WGT's switch channels) and of the HM-MOD-EM-8
 * (`CHANNEL_FUNCTION`; OpenCCU-Base eacd676 made its unlock work); `HMW_existsLink` does the same
 * for the Wired I/O modules (`BEHAVIOUR`). The Homematic Manager does not lock - nothing may become
 * unreachable here - but says what the change does before it is written.
 */

/** The parameters that switch what a channel is. */
export const CHANNEL_MODE_PARAMETERS: readonly string[] = ['CHANNEL_OPERATION_MODE', 'CHANNEL_FUNCTION', 'BEHAVIOUR'];

/**
 * Devices whose multi-mode inputs keep the mode free when the only link is the device's own
 * internal one (`arDevMultiModeException` in `RF_existsLink`): the WebUI shows a hint then, but no
 * lock.
 */
export const INTERNAL_LINK_MODE_EXCEPTIONS: ReadonlySet<string> = new Set([
    'HmIP-FSI16',
    'HmIP-FSI16-2',
    'HmIP-DRDI3',
    'HmIP-BDT-I',
    'HmIP-UDI-PB2',
    'HmIP-UDI-PB2-A',
    'HmIP-UDI-SMI55',
    'HmIP-UDI-SMI55-A',
]);

/** The mode parameters a description has and lets one write. */
export function modeParameters(description: ParamsetDescription | undefined): string[] {
    if (!description) {
        return [];
    }
    return CHANNEL_MODE_PARAMETERS.filter((param) => {
        const parameter = description[param];
        return parameter !== undefined && isWritable(parameter);
    });
}

function deviceOf(address: string): string {
    const colon = address.indexOf(':');
    return colon < 0 ? address : address.slice(0, colon);
}

/**
 * The link peers that make a mode change a problem. A link with a channel of the same device (an
 * internal link) counts too, except on the devices of {@link INTERNAL_LINK_MODE_EXCEPTIONS} when it
 * is the only one, as in the WebUI.
 */
export function modeBlockingPeers(address: string, deviceType: string, peers: readonly string[]): string[] {
    const own = deviceOf(address);
    const internalOnly = peers.length > 0 && peers.every((peer) => deviceOf(peer) === own);
    return internalOnly && INTERNAL_LINK_MODE_EXCEPTIONS.has(deviceType) ? [] : [...peers];
}

/** The mode parameters the user changed from what the device answered. */
export function changedModeParameters(
    params: readonly string[],
    original: Readonly<Record<string, unknown>>,
    edited: Readonly<Record<string, unknown>>,
): string[] {
    return params.filter((param) => param in edited && String(edited[param]) !== String(original[param]));
}
