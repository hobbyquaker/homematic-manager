/**
 * The HmIP pairing data of a QR code or a device sticker.
 *
 * A HomematicIP device carries an SGTIN (24 hexadecimal digits) and a 16-character key. The QR code
 * on the device prints them one after the other, sometimes with separators and sometimes not, and
 * 2.x expected the user to copy both into two fields by hand (#112). These functions accept what a
 * scanner or a copy-paste really produces and say what is missing rather than sending nonsense to
 * `setInstallMode`.
 */

/** What a scan or a paste yielded. */
export interface HmipKey {
    readonly sgtin: string;
    readonly key: string;
}

export const SGTIN_LENGTH = 24;
export const KEY_LENGTH = 16;

/** Upper case, without spaces and separators - the form both fields are compared in. */
export function normaliseKeyText(text: string): string {
    return text.replace(/[\s-]/g, '').toUpperCase();
}

export function isSgtin(value: string): boolean {
    return new RegExp(`^[0-9A-F]{${String(SGTIN_LENGTH)}}$`).test(normaliseKeyText(value));
}

export function isDeviceKey(value: string): boolean {
    return new RegExp(`^[0-9A-Z]{${String(KEY_LENGTH)}}$`).test(normaliseKeyText(value));
}

/**
 * Splits what a QR code contains into SGTIN and key.
 *
 * The eQ-3 codes seen in the wild are the plain concatenation `<24 hex><16 chars>`, the same with a
 * separator, and a `S:<sgtin>,K:<key>` form. Anything else is reported as `undefined` so the dialog
 * can say "that is not a HomematicIP code" instead of putting rubbish into the fields.
 */
export function parseHmipCode(text: string): HmipKey | undefined {
    const labelled = /S:\s*([0-9A-Fa-f]{24}).*?K:\s*([0-9A-Za-z]{16})/.exec(text);
    if (labelled?.[1] && labelled[2]) {
        return {sgtin: labelled[1].toUpperCase(), key: labelled[2].toUpperCase()};
    }
    const plain = normaliseKeyText(text);
    if (plain.length === SGTIN_LENGTH + KEY_LENGTH) {
        const sgtin = plain.slice(0, SGTIN_LENGTH);
        const key = plain.slice(SGTIN_LENGTH);
        if (isSgtin(sgtin) && isDeviceKey(key)) {
            return {sgtin, key};
        }
    }
    if (isSgtin(plain)) {
        // Some codes carry the SGTIN only; the key is then typed from the sticker.
        return {sgtin: plain, key: ''};
    }
    return undefined;
}
