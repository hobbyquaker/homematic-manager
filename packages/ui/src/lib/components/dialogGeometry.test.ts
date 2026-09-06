import {beforeEach, describe, expect, it} from 'vitest';

import {
    DEFAULT_LIMITS,
    forgetDialogGeometry,
    moveDialog,
    recallDialog,
    rememberDialog,
    resizeDialog,
    type DialogBox,
} from './dialogGeometry.js';

const viewport = {width: 1280, height: 800};
const box: DialogBox = {left: 200, top: 100, width: 400, height: 300};

describe('moveDialog', () => {
    it('moves by the drag and keeps the size', () => {
        expect(moveDialog(box, 100, 50, viewport)).toEqual({left: 300, top: 150, width: 400, height: 300});
    });

    it('never leaves the viewport', () => {
        expect(moveDialog(box, -1000, -1000, viewport)).toMatchObject({left: 0, top: 0});
        expect(moveDialog(box, 5000, 5000, viewport)).toMatchObject({left: 880, top: 500});
    });

    it('pins a dialog that is bigger than the window to the top left rather than pushing it out', () => {
        const huge: DialogBox = {left: 0, top: 0, width: 2000, height: 1200};
        expect(moveDialog(huge, 300, 300, viewport)).toMatchObject({left: 0, top: 0});
    });
});

describe('resizeDialog', () => {
    it('grows and shrinks by the corner', () => {
        expect(resizeDialog(box, 'se', 120, 80, viewport)).toEqual({left: 200, top: 100, width: 520, height: 380});
        expect(resizeDialog(box, 'se', -50, -40, viewport)).toEqual({left: 200, top: 100, width: 350, height: 260});
    });

    it('moves only the edge that is held', () => {
        expect(resizeDialog(box, 'e', 60, 999, viewport)).toEqual({left: 200, top: 100, width: 460, height: 300});
        expect(resizeDialog(box, 's', 999, 60, viewport)).toEqual({left: 200, top: 100, width: 400, height: 360});
    });

    /** West and north move the near edge; the far one stays on its pixel. */
    it('keeps the opposite edge where it was', () => {
        const west = resizeDialog(box, 'w', -60, 0, viewport);
        expect(west).toEqual({left: 140, top: 100, width: 460, height: 300});
        expect(west.left + west.width).toBe(box.left + box.width);

        const north = resizeDialog(box, 'n', 0, 40, viewport);
        expect(north).toEqual({left: 200, top: 140, width: 400, height: 260});
        expect(north.top + north.height).toBe(box.top + box.height);
    });

    it('never goes under the minimum, whichever edge is dragged', () => {
        const limits = {minWidth: 320, minHeight: 200};
        expect(resizeDialog(box, 'se', -900, -900, viewport, limits)).toMatchObject({width: 320, height: 200});
        const west = resizeDialog(box, 'w', 900, 0, viewport, limits);
        expect(west).toMatchObject({width: 320});
        expect(west.left + west.width).toBe(box.left + box.width);
        const north = resizeDialog(box, 'n', 0, 900, viewport, limits);
        expect(north).toMatchObject({height: 200});
        expect(north.top + north.height).toBe(box.top + box.height);
    });

    it('is bounded by the viewport, so no edge is ever dragged out of the window', () => {
        const wide = resizeDialog(box, 'se', 5000, 5000, viewport);
        expect(wide.left + wide.width).toBeLessThanOrEqual(viewport.width);
        expect(wide.top + wide.height).toBeLessThanOrEqual(viewport.height);
        expect(wide).toMatchObject({width: 1080, height: 700});

        const west = resizeDialog(box, 'w', -5000, 0, viewport);
        expect(west.left).toBe(0);
        expect(west.left + west.width).toBe(box.left + box.width);
    });

    it('has a default minimum that still shows a title bar and a button row', () => {
        expect(DEFAULT_LIMITS.minWidth).toBeGreaterThanOrEqual(240);
        expect(resizeDialog(box, 'se', -5000, -5000, viewport)).toMatchObject({
            width: DEFAULT_LIMITS.minWidth,
            height: DEFAULT_LIMITS.minHeight,
        });
    });
});

describe('what a dialog class is remembered by', () => {
    beforeEach(() => {
        forgetDialogGeometry();
    });

    it('gives back what was put in, per key, and nothing for a key nobody dragged', () => {
        rememberDialog('paramset-dialog', box);
        expect(recallDialog('paramset-dialog')).toEqual(box);
        expect(recallDialog('link-paramset-dialog')).toBeUndefined();
    });

    it('keeps the last geometry of a class, not the first', () => {
        rememberDialog('paramset-dialog', box);
        rememberDialog('paramset-dialog', {...box, left: 0});
        expect(recallDialog('paramset-dialog')).toMatchObject({left: 0});
    });
});
