import {describe, expect, it} from 'vitest';

import {fullUpdateReason, shortUpdateReason} from './updateReason.js';

/** What electron-updater's `createHttpError` made of the 404 of #163. */
const HTTP_404 = [
    '404 Not Found',
    '"method: GET url: https://github.com/hobbyquaker/homematic-manager/releases/download/v3.0.0-beta.18/Homematic-Manager-3.0.0-beta.18-universal-mac.zip',
    '',
    'Please double check that your authentication token is correct."',
    'Headers: {"server": "github.com", "content-type": "text/plain; charset=utf-8"}',
].join('\n');

describe('the reason the update strip gives (B-47)', () => {
    it('is the first line of an HTTP error', () => {
        expect(shortUpdateReason(HTTP_404)).toBe('404 Not Found');
    });

    it('skips blank lines and trims', () => {
        expect(shortUpdateReason('\n  \n  net::ERR_INTERNET_DISCONNECTED  \nmore')).toBe(
            'net::ERR_INTERNET_DISCONNECTED',
        );
    });

    it('is empty without a message', () => {
        expect(shortUpdateReason(undefined)).toBe('');
        expect(shortUpdateReason('\n\n')).toBe('');
        expect(fullUpdateReason(undefined)).toBe('');
    });

    it('cuts a long line with an ellipsis', () => {
        const reason = shortUpdateReason('x'.repeat(500));
        expect(reason).toHaveLength(160);
        expect(reason.endsWith('…')).toBe(true);
    });

    it('keeps the whole message for the tooltip, without the response headers', () => {
        const full = fullUpdateReason(HTTP_404);
        expect(full).toContain('404 Not Found');
        expect(full).toContain('Homematic-Manager-3.0.0-beta.18-universal-mac.zip');
        expect(full).not.toContain('Headers');
        expect(fullUpdateReason('a\nb')).toBe('a\nb');
        expect(fullUpdateReason('y'.repeat(2000))).toHaveLength(600);
    });
});
