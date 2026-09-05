import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {
    browserWindowBounds,
    isVisible,
    normalise,
    WindowStateKeeper,
    type Rectangle,
    type WindowStateOptions,
} from './windowState.js';

const LAPTOP: Rectangle = {x: 0, y: 0, width: 1920, height: 1080};
const SECOND: Rectangle = {x: 1920, y: 0, width: 2560, height: 1440};

let dir: string;

const options = (overrides: Partial<WindowStateOptions> = {}): WindowStateOptions => ({
    dir,
    defaultWidth: 1280,
    defaultHeight: 960,
    minWidth: 1024,
    minHeight: 620,
    displays: () => [LAPTOP],
    ...overrides,
});

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hmm-window-'));
});

afterEach(() => {
    fs.rmSync(dir, {recursive: true, force: true});
});

describe('WindowStateKeeper', () => {
    it('starts with the defaults and no position when nothing was stored', () => {
        const keeper = new WindowStateKeeper(options());
        expect(keeper.state).toEqual({x: Number.NaN, y: Number.NaN, width: 1280, height: 960, maximised: false});
        expect(browserWindowBounds(keeper.state, options())).toEqual({width: 1280, height: 960});
    });

    it('writes the geometry and reads it back on the next start', () => {
        const keeper = new WindowStateKeeper(options());
        keeper.update({x: 100, y: 50, width: 1400, height: 900}, false);
        keeper.save();
        expect(JSON.parse(fs.readFileSync(keeper.file, 'utf8'))).toEqual({
            x: 100,
            y: 50,
            width: 1400,
            height: 900,
            maximised: false,
        });
        expect(new WindowStateKeeper(options()).state).toEqual({
            x: 100,
            y: 50,
            width: 1400,
            height: 900,
            maximised: false,
        });
    });

    it('debounces the write and stops the pending one when save is called', () => {
        vi.useFakeTimers();
        try {
            const keeper = new WindowStateKeeper(options());
            keeper.update({x: 10, y: 10, width: 1300, height: 800}, false);
            keeper.update({x: 20, y: 20, width: 1310, height: 810}, false);
            expect(fs.existsSync(keeper.file)).toBe(false);
            vi.advanceTimersByTime(600);
            expect(JSON.parse(fs.readFileSync(keeper.file, 'utf8')).x).toBe(20);
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps the restored size when the window is maximised', () => {
        const keeper = new WindowStateKeeper(options());
        keeper.update({x: 100, y: 50, width: 1400, height: 900}, false);
        keeper.update({x: 0, y: 0, width: 1920, height: 1080}, true);
        expect(keeper.state).toEqual({x: 100, y: 50, width: 1400, height: 900, maximised: true});
    });

    it('never goes below the minimum size', () => {
        const keeper = new WindowStateKeeper(options());
        keeper.update({x: 0, y: 0, width: 300, height: 200}, false);
        expect(keeper.state).toMatchObject({width: 1024, height: 620});
    });

    it('drops the position of a window that is not on any display any more', () => {
        const keeper = new WindowStateKeeper(options());
        keeper.update({x: 2400, y: 300, width: 1400, height: 900}, false);
        keeper.save();
        const reopened = new WindowStateKeeper(options());
        expect(reopened.state).toMatchObject({width: 1400, height: 900});
        expect(Number.isNaN(reopened.state.x)).toBe(true);
    });

    it('keeps the position when the second display is still there', () => {
        const keeper = new WindowStateKeeper(options());
        keeper.update({x: 2400, y: 300, width: 1400, height: 900}, false);
        keeper.save();
        expect(new WindowStateKeeper(options({displays: () => [LAPTOP, SECOND]})).state.x).toBe(2400);
    });

    it('falls back to the defaults for a corrupt file', () => {
        fs.writeFileSync(path.join(dir, 'window-state.json'), '{ this is not json');
        expect(new WindowStateKeeper(options()).state).toMatchObject({width: 1280, height: 960});
    });

    it('falls back to the defaults for a file with the wrong shape', () => {
        fs.writeFileSync(path.join(dir, 'window-state.json'), '"a string"');
        const state = new WindowStateKeeper(options()).state;
        expect(browserWindowBounds(state, options())).toEqual({width: 1280, height: 960});
    });

    it('does not throw when the directory cannot be written', () => {
        const keeper = new WindowStateKeeper(options({dir: path.join(dir, 'file.txt', 'nested')}));
        fs.writeFileSync(path.join(dir, 'file.txt'), 'not a directory');
        expect(() => {
            keeper.update({x: 1, y: 1, width: 1200, height: 800}, false);
            keeper.save();
        }).not.toThrow();
    });

    it('uses a name of its own when one is given', () => {
        expect(new WindowStateKeeper(options({file: 'geometry.json'})).file).toBe(path.join(dir, 'geometry.json'));
    });
});

describe('normalise', () => {
    it('accepts a good record', () => {
        expect(normalise({x: 1, y: 2, width: 1300, height: 800, maximised: true}, {minWidth: 800, minHeight: 600})) //
            .toEqual({x: 1, y: 2, width: 1300, height: 800, maximised: true});
    });

    it('rejects non-numbers and infinities field by field', () => {
        const state = normalise(
            {x: 'left', y: Number.POSITIVE_INFINITY, width: 1300, height: null},
            {minWidth: 800, minHeight: 600},
        );
        expect(Number.isNaN(state.x)).toBe(true);
        expect(Number.isNaN(state.y)).toBe(true);
        expect(state.width).toBe(1300);
        expect(Number.isNaN(state.height)).toBe(true);
        expect(state.maximised).toBe(false);
    });
});

describe('isVisible', () => {
    const state = (x: number, y: number) => ({x, y, width: 1280, height: 960, maximised: false});

    it('accepts a window well inside a display', () => {
        expect(isVisible(state(100, 100), [LAPTOP])).toBe(true);
    });

    it('rejects a window whose title bar is above the display', () => {
        expect(isVisible(state(100, -200), [LAPTOP])).toBe(false);
    });

    it('rejects a window that is off to the right', () => {
        expect(isVisible(state(1900, 100), [LAPTOP])).toBe(false);
    });

    it('rejects a window that is off to the left', () => {
        expect(isVisible(state(-1260, 100), [LAPTOP])).toBe(false);
    });

    it('rejects a window below the display', () => {
        expect(isVisible(state(100, 1060), [LAPTOP])).toBe(false);
    });

    it('rejects a state without a position', () => {
        expect(isVisible({x: Number.NaN, y: Number.NaN, width: 100, height: 100, maximised: false}, [LAPTOP])).toBe(
            false,
        );
    });

    it('accepts a window on the second display', () => {
        expect(isVisible(state(2000, 200), [LAPTOP, SECOND])).toBe(true);
    });

    it('rejects everything when no display is connected', () => {
        expect(isVisible(state(100, 100), [])).toBe(false);
    });
});
