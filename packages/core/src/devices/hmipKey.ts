/**
 * The HmIP pairing data of a QR code or a device sticker (B-72).
 *
 * A HomematicIP device carries an SGTIN (24 hexadecimal digits) and a 128-bit device key. The
 * sticker shows them twice:
 *
 * - as a QR code, `EQ01SG<SGTIN, 24 hex>DLK<key, 32 hex>` - the form 2.x's scanner parsed
 *   (`legacy/www/js/homematic-manager.js`), with a four-character prefix before `SG`;
 * - printed, the SGTIN in groups of four and the key as 26 characters of eQ-3's base-32 alphabet in
 *   groups of 5-5-5-5-6 (`XXXXX-XXXXX-XXXXX-XXXXX-XXXXXX`).
 *
 * `setInstallModeWithWhitelist` wants the key as 32 hex digits, so the printed form is converted
 * with `hmipKeyToHex()`, as the CCU WebUI does before it sends a key shorter than 32 characters.
 *
 * The SGTIN's prefix is not checked: it is an SGTIN-96 whose company prefix is eQ-3's on most
 * devices but not on all of them - a device sold under another brand carries its own.
 */

/** What a scan or a paste yielded; `key` is empty when the code carried the SGTIN only. */
export interface HmipKey {
    readonly sgtin: string;
    readonly key: string;
}

export const SGTIN_LENGTH = 24;

/** eQ-3's base-32 alphabet for the printed HmIP device key: no D, I, O and V. */
export const HMIP_KEY_CHARS = '0123456789ABCEFGHJKLMNPQRSTUWXYZ';

/** The length of the printed key: 128 bits in 5-bit characters. */
export const PRINTED_KEY_LENGTH = 26;

/** Upper case, without spaces and dashes - the form both fields are compared in. */
export function normaliseKeyText(text: string): string {
    return text.replace(/[\s-]/g, '').toUpperCase();
}

export function isSgtin(value: string): boolean {
    return /^[0-9A-F]{24}$/.test(normaliseKeyText(value));
}

const PRINTED_KEY = new RegExp(`^[0-7][${HMIP_KEY_CHARS}]{${String(PRINTED_KEY_LENGTH - 1)}}$`);

/**
 * The device key as the sticker prints it (26 characters of eQ-3's alphabet) or as the QR code
 * holds it (32 hex digits), dashes, spaces and case as they come. 26 characters carry 130 bits, so
 * the first one is at most `7` - anything above does not fit into 128 bits and is a typo.
 */
export function isDeviceKey(value: string): boolean {
    const key = normaliseKeyText(value);
    return /^[0-9A-F]{32}$/.test(key) || PRINTED_KEY.test(key);
}

/**
 * Splits what a QR code contains into SGTIN and key: `EQ01SG<24 hex>DLK<32 hex>` anywhere in the
 * text, case, spaces and dashes as they come. A text that is an SGTIN and nothing else (a paste) is
 * taken as the SGTIN, the key is then typed from the sticker. Anything else is `undefined`, so the
 * dialog can say "that is not a HomematicIP code" instead of putting rubbish into the fields.
 */
export function parseHmipCode(text: string): HmipKey | undefined {
    const plain = normaliseKeyText(text);
    const code = /[A-Z0-9]{4}SG([0-9A-F]{24})DLK([0-9A-F]{32})/.exec(plain);
    if (code?.[1] && code[2]) {
        return {sgtin: code[1], key: code[2]};
    }
    if (isSgtin(plain)) {
        return {sgtin: plain, key: ''};
    }
    return undefined;
}

/**
 * Converts an HmIP device key from the printed base-32 form to the 32 hex digits
 * `setInstallModeWithWhitelist` expects: the 26 characters are one big-endian base-32 number. A key
 * that is already 32 hex digits is returned unchanged. The port of 2.x's
 * `convertHmIPKeyBase32ToBase16()`.
 */
export function hmipKeyToHex(key: string): string {
    const value = normaliseKeyText(key);
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
