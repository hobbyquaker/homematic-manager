/**
 * The tokens in `app.css` are the source of truth for the grid metrics; `metrics.ts` is the copy
 * JavaScript can read. This is what keeps the two from drifting apart - a row height changed in
 * the theme and not in the virtualiser leaves the rows overlapping their own scroll offsets, and
 * nothing else in the suite would notice.
 */

import {describe, expect, it} from 'vitest';

import appCss from '../../app.css?raw';
import {DEVICE_IMAGE_SIZE, ICON_COLUMN_WIDTH, ROW_HEIGHT} from './metrics.js';

function pixels(token: string): number {
    const match = new RegExp(`${token}:\\s*(\\d+)px;`).exec(appCss);
    expect(match, `${token} is not declared in app.css`).not.toBeNull();
    return Number(match![1]);
}

describe('the grid metrics', () => {
    it('takes the row height from --hmm-row-height', () => {
        expect(ROW_HEIGHT).toBe(pixels('--hmm-row-height'));
    });

    it('takes the picture size from --hmm-device-image-size', () => {
        expect(DEVICE_IMAGE_SIZE).toBe(pixels('--hmm-device-image-size'));
    });

    /**
     * Task 22: the maintainer's third look said the pictures are too small, so both grew by four -
     * 26 -> 30 px rows, 16 -> 20 px pictures. Pinned, because the picture has to stay smaller than
     * the row it sits in and both numbers are easy to change one at a time.
     */
    it('grew the row and the picture together, and keeps the picture inside the row', () => {
        expect(ROW_HEIGHT).toBe(30);
        expect(DEVICE_IMAGE_SIZE).toBe(20);
        expect(DEVICE_IMAGE_SIZE).toBeLessThan(ROW_HEIGHT);
    });

    /** A grid cell clips, so the track is the picture plus the cell's 6 px of padding per side. */
    it('makes the picture column wide enough that the cell does not cut the picture off', () => {
        expect(ICON_COLUMN_WIDTH).toBe(DEVICE_IMAGE_SIZE + 12);
    });
});
