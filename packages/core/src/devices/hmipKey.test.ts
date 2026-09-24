/**
 * B-72: the HmIP pairing data as a device's sticker really carries it - the QR code
 * `EQ01SG<SGTIN>DLK<32 hex>` and the printed 26-character key. The keys here are made up; the
 * printed one is the base-32 form of the hex one, computed independently (a big-endian base-32
 * number over eQ-3's alphabet).
 */
import {describe, expect, it} from 'vitest';

import {
    HMIP_KEY_CHARS,
    hmipKeyToHex,
    isDeviceKey,
    isSgtin,
    normaliseKeyText,
    parseHmipCode,
    PRINTED_KEY_LENGTH,
} from './hmipKey.js';

const SGTIN = '3014F711A000000000001234';
const HEX = '3A7C51E0B94D26F81C05AE7392D4B61F';
const PRINTED = '1TGJ8-Y1FAE-4UW1R-1EFFF-9E9EHZ';
const CODE = `EQ01SG${SGTIN}DLK${HEX}`;

describe('parseHmipCode', () => {
    it('reads the QR code on the sticker', () => {
        expect(parseHmipCode(CODE)).toEqual({sgtin: SGTIN, key: HEX});
    });

    it('takes it in lower case, with whitespace around it and anywhere in the text', () => {
        expect(parseHmipCode(`  ${CODE.toLowerCase()}\n`)).toEqual({sgtin: SGTIN, key: HEX});
        expect(parseHmipCode(`scanned: ${CODE} end`)).toEqual({sgtin: SGTIN, key: HEX});
    });

    it('does not look at the prefix in front of SG or at the SGTIN company prefix', () => {
        // a device sold under another brand carries its own GS1 company prefix
        expect(parseHmipCode(`EQ01SG301503770000000000001234DLK${HEX}`)).toEqual({
            sgtin: '301503770000000000001234',
            key: HEX,
        });
        expect(parseHmipCode(`XY99SG${SGTIN}DLK${HEX}`)).toEqual({sgtin: SGTIN, key: HEX});
    });

    it('takes an SGTIN on its own; the key is then typed from the sticker', () => {
        expect(parseHmipCode('3014-f711-a000-0000-0000-1234')).toEqual({sgtin: SGTIN, key: ''});
    });

    it('refuses anything that is not a device code', () => {
        expect(parseHmipCode('https://example.invalid/')).toBeUndefined();
        expect(parseHmipCode('')).toBeUndefined();
        expect(parseHmipCode('3014F711')).toBeUndefined();
        // a key one digit short, and the invented 24 + 16 form 3.x once expected
        expect(parseHmipCode(`EQ01SG${SGTIN}DLK${HEX.slice(1)}`)).toBeUndefined();
        expect(parseHmipCode(`${SGTIN}ABCEFGHJKLMNPQRS`)).toBeUndefined();
    });
});

describe('isDeviceKey', () => {
    it('accepts the printed key with or without dashes and spaces, in any case', () => {
        expect(isDeviceKey(PRINTED)).toBe(true);
        expect(isDeviceKey(PRINTED.replace(/-/g, ''))).toBe(true);
        expect(isDeviceKey(PRINTED.replace(/-/g, ' ').toLowerCase())).toBe(true);
    });

    it("accepts the QR code's 32 hex digits", () => {
        expect(isDeviceKey(HEX)).toBe(true);
        expect(isDeviceKey(HEX.toLowerCase())).toBe(true);
    });

    it('refuses the wrong length, letters outside the alphabet and more than 128 bits', () => {
        expect(isDeviceKey('ABCEFGHJKLMNPQRS')).toBe(false);
        expect(isDeviceKey(PRINTED.slice(0, -1))).toBe(false);
        expect(isDeviceKey(`${PRINTED}0`)).toBe(false);
        for (const letter of ['D', 'I', 'O', 'V']) {
            expect(isDeviceKey(`1TGJ8Y1FAE4UW1R1EFFF9E9EH${letter}`)).toBe(false);
        }
        // 26 characters carry 130 bits: a first character above 7 is a typo
        expect(isDeviceKey('7ZZZZZZZZZZZZZZZZZZZZZZZZZ')).toBe(true);
        expect(isDeviceKey('8000000000000000000000000Z')).toBe(false);
        expect(isDeviceKey(`${HEX.slice(1)}G`)).toBe(false);
    });
});

describe('isSgtin and normaliseKeyText', () => {
    it('validates an SGTIN', () => {
        expect(isSgtin(SGTIN)).toBe(true);
        expect(isSgtin('3014-f711-a000-0000-0000-1234')).toBe(true);
        expect(isSgtin('3014F711A00000000000123')).toBe(false);
        expect(isSgtin('3014G711A000000000001234')).toBe(false);
        expect(normaliseKeyText(' ab-cd ef ')).toBe('ABCDEF');
    });
});

describe('hmipKeyToHex', () => {
    it('keeps a key that is already 32 hex digits', () => {
        expect(hmipKeyToHex(HEX)).toBe(HEX);
        expect(hmipKeyToHex(HEX.toLowerCase())).toBe(HEX);
    });

    it("converts the printed key to the QR code's hex, dashes, spaces and case ignored", () => {
        expect(hmipKeyToHex(PRINTED)).toBe(HEX);
        expect(hmipKeyToHex(PRINTED.toLowerCase().replace(/-/g, ' '))).toBe(HEX);
        expect(hmipKeyToHex('7ZZZZZZZZZZZZZZZZZZZZZZZZZ')).toBe('F'.repeat(32));
        expect(hmipKeyToHex('0'.repeat(PRINTED_KEY_LENGTH))).toBe('0'.repeat(32));
    });

    it('is the inverse of the base-32 form for any key', () => {
        for (let seed = 1; seed < 200; seed += 1) {
            let value = 0n;
            for (let byte = 0; byte < 16; byte += 1) {
                value = (value << 8n) | BigInt((seed * 37 + byte * 101) % 256);
            }
            const hex = value.toString(16).toUpperCase().padStart(32, '0');
            let printed = '';
            for (let index = 0; index < PRINTED_KEY_LENGTH; index += 1) {
                printed = HMIP_KEY_CHARS.charAt(Number(value % 32n)) + printed;
                value /= 32n;
            }
            expect(isDeviceKey(printed)).toBe(true);
            expect(hmipKeyToHex(printed)).toBe(hex);
        }
    });

    it('skips a character the alphabet does not contain', () => {
        expect(hmipKeyToHex('ADA')).toMatch(/^[0-9A-F]{32}$/);
        expect(HMIP_KEY_CHARS).not.toMatch(/[DIOV]/);
        expect(HMIP_KEY_CHARS).toHaveLength(32);
    });
});
