/**
 * Window size, position and maximised state across restarts.
 *
 * 2.x used `electron-window-state`, which was last published in 2018, still reaches for
 * `screen.getDisplayMatching()` through the old remote API and would have to be trusted with the
 * one file that decides whether the app is visible at all. It is 80 lines; this is those 80 lines,
 * with a test, without a dependency, and with the one thing the old package got wrong for people
 * who unplug a monitor: a window that ends up outside every display is put back on the primary one
 * instead of opening off-screen.
 *
 * Nothing here imports Electron. The displays are injected as plain rectangles, the file is read
 * and written through `node:fs`, and every failure is swallowed: a corrupt state file must cost a
 * remembered window size, never a start.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface Rectangle {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface WindowState extends Rectangle {
    maximised: boolean;
}

export interface WindowStateOptions {
    /** Where to keep the file, normally `app.getPath('userData')`. */
    readonly dir: string;
    /** File name inside {@link WindowStateOptions.dir}. */
    readonly file?: string;
    readonly defaultWidth: number;
    readonly defaultHeight: number;
    readonly minWidth: number;
    readonly minHeight: number;
    /** The work areas of the connected displays; `screen.getAllDisplays()` in main. */
    readonly displays: () => Rectangle[];
}

/** How much of a window has to be on a display for it to count as visible. */
const VISIBLE_MARGIN = 40;

/**
 * The remembered window geometry, and a place to put the next one.
 *
 * `state` is what `new BrowserWindow()` gets; `remember()` is called from the window's `resize`,
 * `move`, `maximize`, `unmaximize` and `close` handlers and writes at most once per idle turn.
 */
export class WindowStateKeeper {
    readonly file: string;

    readonly #options: WindowStateOptions;
    #state: WindowState;
    #timer: ReturnType<typeof setTimeout> | undefined;

    constructor(options: WindowStateOptions) {
        this.#options = options;
        this.file = path.join(options.dir, options.file ?? 'window-state.json');
        this.#state = this.#load();
    }

    /** The geometry to open with: remembered, clamped to a display, or the default. */
    get state(): WindowState {
        return {...this.#state};
    }

    /**
     * Takes the geometry of a window as it is now. `maximised` is passed separately because a
     * maximised window reports the screen size as its bounds, which must not overwrite the size
     * the user restores to.
     */
    update(bounds: Rectangle, maximised: boolean): void {
        this.#state = maximised
            ? {...this.#state, maximised: true}
            : {
                  x: Math.round(bounds.x),
                  y: Math.round(bounds.y),
                  width: Math.max(this.#options.minWidth, Math.round(bounds.width)),
                  height: Math.max(this.#options.minHeight, Math.round(bounds.height)),
                  maximised: false,
              };
        this.#schedule();
    }

    /** Writes the state now and cancels a pending write. Called on `close`. */
    save(): void {
        if (this.#timer !== undefined) {
            clearTimeout(this.#timer);
            this.#timer = undefined;
        }
        try {
            fs.mkdirSync(path.dirname(this.file), {recursive: true});
            fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.#state, null, 2));
            fs.renameSync(`${this.file}.tmp`, this.file);
        } catch {
            // A profile directory we cannot write is a problem the backend reports; not here.
        }
    }

    #schedule(): void {
        if (this.#timer !== undefined) {
            return;
        }
        this.#timer = setTimeout(() => {
            this.#timer = undefined;
            this.save();
        }, 500);
    }

    #load(): WindowState {
        const fallback: WindowState = {
            x: Number.NaN,
            y: Number.NaN,
            width: this.#options.defaultWidth,
            height: this.#options.defaultHeight,
            maximised: false,
        };
        let stored: unknown;
        try {
            stored = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        } catch {
            return fallback;
        }
        const state = normalise(stored, this.#options);
        if (state === undefined) {
            return fallback;
        }
        return isVisible(state, this.#options.displays()) ? state : {...state, x: Number.NaN, y: Number.NaN};
    }
}

/** A stored value as a state, or `undefined` when it is not one. */
export function normalise(stored: unknown, options: Pick<WindowStateOptions, 'minWidth' | 'minHeight'>): WindowState {
    const value = (typeof stored === 'object' && stored !== null ? stored : {}) as Record<string, unknown>;
    const number = (key: string): number => {
        const raw = value[key];
        return typeof raw === 'number' && Number.isFinite(raw) ? raw : Number.NaN;
    };
    const width = number('width');
    const height = number('height');
    return {
        x: number('x'),
        y: number('y'),
        width: Number.isNaN(width) ? Number.NaN : Math.max(options.minWidth, Math.round(width)),
        height: Number.isNaN(height) ? Number.NaN : Math.max(options.minHeight, Math.round(height)),
        maximised: value['maximised'] === true,
    };
}

/**
 * Is enough of this window on one of the displays? A window whose title bar is off-screen cannot
 * be moved back with the mouse, which is exactly the state an unplugged monitor leaves behind.
 */
export function isVisible(state: WindowState, displays: Rectangle[]): boolean {
    if (Number.isNaN(state.x) || Number.isNaN(state.y)) {
        return false;
    }
    return displays.some(
        (display) =>
            state.x + state.width > display.x + VISIBLE_MARGIN &&
            state.x < display.x + display.width - VISIBLE_MARGIN &&
            state.y + VISIBLE_MARGIN < display.y + display.height &&
            state.y >= display.y - 1,
    );
}

/** The options `new BrowserWindow()` wants; the position is left out when it is not remembered. */
export function browserWindowBounds(
    state: WindowState,
    defaults: Pick<WindowStateOptions, 'defaultWidth' | 'defaultHeight'>,
): Partial<Rectangle> {
    const size = {
        width: Number.isNaN(state.width) ? defaults.defaultWidth : state.width,
        height: Number.isNaN(state.height) ? defaults.defaultHeight : state.height,
    };
    if (Number.isNaN(state.x) || Number.isNaN(state.y)) {
        return size;
    }
    return {...size, x: state.x, y: state.y};
}
