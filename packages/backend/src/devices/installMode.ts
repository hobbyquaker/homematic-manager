/**
 * Switching the install mode on, in all the variants the two radio systems have.
 *
 * BidCos: `setInstallMode(true, seconds, mode)` with mode 1 (normal) or 2 (with a temporary key,
 * issue #20, preceded by `setTempKey`), or `addDevice(serial, mode)` to add a known device by its
 * serial number without any pairing button.
 *
 * HmIP: either the plain `setInstallMode(true, seconds)`, which pairs whatever presses its button,
 * or `setInstallModeWithWhitelist(true, seconds, [{ADDRESS, KEY_MODE, KEY}])` with the SGTIN and
 * the device key from the sticker or the QR code. The key on the sticker is written in eQ-3's
 * 32-character base-32 alphabet and has to be converted to the 32 hex digits the interface wants -
 * `convertHmIPKeyBase32ToBase16()` in `homematic-manager.js:4800`, ported below.
 *
 * The whole thing is a pure function from the options to the calls, so every variant is testable
 * without a CCU; `Backend` only sends what comes out.
 */

import type {InstallModeOptions} from '@homematic-manager/core';

import type {RpcOutValue} from '../rpc/client.js';

/** eQ-3's base-32 alphabet for the HmIP device key: no D, I, O and V. */
export const HMIP_KEY_CHARS = '0123456789ABCEFGHJKLMNPQRSTUWXYZ';

/** The default duration of the install mode, and the maximum the CCU accepts. */
export const DEFAULT_INSTALL_SECONDS = 60;
export const MAX_INSTALL_SECONDS = 300;

/**
 * Converts an HmIP device key from the printed base-32 form to the 32 hex digits
 * `setInstallModeWithWhitelist` expects. A key that is already 32 hex digits is returned unchanged.
 */
export function hmipKeyToHex(key: string): string {
    const value = key.trim().toUpperCase().replace(/-/g, '');
    if (/^[0-9A-F]{32}$/.test(value)) {
        return value;
    }
    const bytes = new Uint8Array(16);
    let accumulator = 0;
    let bits = 0;
    let byteIndex = bytes.length - 1;
    for (let index = value.length - 1; index >= 0; index -= 1) {
        const digit = HMIP_KEY_CHARS.indexOf(value.charAt(index));
        if (digit >= 0) {
            accumulator |= digit << bits;
        }
        bits += 5;
        while (bits > 8 && byteIndex >= 0) {
            bytes[byteIndex] = accumulator & 0xff;
            accumulator >>= 8;
            bits -= 8;
            byteIndex -= 1;
        }
    }
    return [...bytes]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
}

/** An SGTIN as the interface wants it: upper case, without the grouping dashes. */
export function normaliseSgtin(sgtin: string): string {
    return sgtin.trim().toUpperCase().replace(/-/g, '');
}

/** Seconds within the range the CCU accepts. */
export function installSeconds(seconds: number | undefined): number {
    if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
        return DEFAULT_INSTALL_SECONDS;
    }
    return Math.min(MAX_INSTALL_SECONDS, Math.round(seconds));
}

/** One RPC call to make. */
export interface InstallModeCall {
    readonly method: string;
    readonly params: RpcOutValue[];
}

/** The calls that put an interface into (or out of) the install mode. */
export function installModeCalls(on: boolean, options: InstallModeOptions = {}): InstallModeCall[] {
    if (!on) {
        return [{method: 'setInstallMode', params: [false]}];
    }
    const seconds = installSeconds(options.seconds);
    const calls: InstallModeCall[] = [];

    if (options.tempKey !== undefined && options.tempKey !== '') {
        // issue #20: the temporary key has to be set before the install mode opens
        calls.push({method: 'setTempKey', params: [options.tempKey]});
    }

    if (options.address !== undefined && options.address !== '') {
        // BidCos: add a device by its serial number, no pairing button involved
        calls.push({method: 'addDevice', params: [options.address, options.mode ?? 1]});
        return calls;
    }

    const key = options.hmipKey;
    if (key !== undefined && key.sgtin !== '') {
        const entry: Record<string, RpcOutValue> = {ADDRESS: normaliseSgtin(key.sgtin)};
        if (options.hmipKeyMode !== 'SGTIN' && key.key !== '') {
            entry['KEY_MODE'] = 'LOCAL';
            entry['KEY'] = hmipKeyToHex(key.key);
        }
        calls.push({method: 'setInstallModeWithWhitelist', params: [true, seconds, [entry]]});
        return calls;
    }

    calls.push({
        method: 'setInstallMode',
        params: options.mode === undefined ? [true, seconds] : [true, seconds, options.mode],
    });
    return calls;
}
