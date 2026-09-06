/**
 * Where a dialog sits and how big it is once the user has said so.
 *
 * Task 20, the maintainer's second look: a dialog is dragged by its title bar and resized by its
 * edges and its bottom-right corner, and the geometry it ends up with is remembered *per dialog
 * class* - open the paramset editor again and it is where you left it, the way every window manager
 * behaves. Remembered for the session only: this module is plain module state, nothing writes to
 * `localStorage`, and a reload starts from the designed size again. A geometry that outlived the
 * page would follow a user onto a smaller screen and hide the buttons.
 *
 * The arithmetic is here rather than in the component because it is the part with the rules in it -
 * the minimum that keeps a dialog usable, the viewport that bounds the maximum, and the edge that
 * stays put while the opposite one moves. None of it needs a DOM.
 */

/** A dialog's box in viewport coordinates, in CSS pixels. */
export interface DialogBox {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
}

export interface Viewport {
    readonly width: number;
    readonly height: number;
}

/** Below this a dialog is a frame with no content in it; each dialog class may ask for more. */
export interface SizeLimits {
    readonly minWidth: number;
    readonly minHeight: number;
}

/**
 * The handles. The four edges plus the bottom-right corner is what the maintainer asked for, and
 * `se` is the one corner a pointer finds without aiming.
 */
export type ResizeEdge = 'n' | 'e' | 's' | 'w' | 'se';

export const DEFAULT_LIMITS: SizeLimits = {minWidth: 320, minHeight: 160};

function clamp(value: number, low: number, high: number): number {
    return Math.min(Math.max(value, low), Math.max(low, high));
}

/** Keeps a box inside the viewport without changing its size. */
function place(box: DialogBox, viewport: Viewport): DialogBox {
    return {
        ...box,
        left: Math.round(clamp(box.left, 0, viewport.width - box.width)),
        top: Math.round(clamp(box.top, 0, viewport.height - box.height)),
    };
}

/** Dragged by the title bar: the size never changes, and the box never leaves the viewport. */
export function moveDialog(box: DialogBox, dx: number, dy: number, viewport: Viewport): DialogBox {
    return place({...box, left: box.left + dx, top: box.top + dy}, viewport);
}

/**
 * Dragged by an edge or the corner.
 *
 * The edge the pointer holds is the one that moves; the opposite one stays where it is, which is
 * why `w` and `n` recompute `left`/`top` from the far edge after the size was clamped. The size is
 * bounded below by the dialog class's minimum and above by the viewport, so a dialog can neither be
 * squeezed into a title bar nor be dragged bigger than the window that has to show it.
 */
export function resizeDialog(
    box: DialogBox,
    edge: ResizeEdge,
    dx: number,
    dy: number,
    viewport: Viewport,
    limits: SizeLimits = DEFAULT_LIMITS,
): DialogBox {
    const right = box.left + box.width;
    const bottom = box.top + box.height;
    const west = edge === 'w';
    const north = edge === 'n';
    const horizontal = west || edge === 'e' || edge === 'se';
    const vertical = north || edge === 's' || edge === 'se';

    const maxWidth = Math.max(limits.minWidth, west ? right : viewport.width - box.left);
    const maxHeight = Math.max(limits.minHeight, north ? bottom : viewport.height - box.top);
    const width = horizontal
        ? Math.round(clamp(box.width + (west ? -dx : dx), limits.minWidth, Math.min(maxWidth, viewport.width)))
        : box.width;
    const height = vertical
        ? Math.round(clamp(box.height + (north ? -dy : dy), limits.minHeight, Math.min(maxHeight, viewport.height)))
        : box.height;

    return place(
        {
            left: west ? right - width : box.left,
            top: north ? bottom - height : box.top,
            width,
            height,
        },
        viewport,
    );
}

/**
 * What each dialog class was left at, for as long as the page lives.
 *
 * Keyed by the dialog's `data-testid`, which is the one identifier every dialog in this app already
 * has and which does not change with the device the dialog was opened on - "the paramset editor",
 * not "the paramset editor of MEQ0123456:1".
 */
const remembered = new Map<string, DialogBox>();

export function rememberDialog(key: string, box: DialogBox): void {
    remembered.set(key, box);
}

export function recallDialog(key: string): DialogBox | undefined {
    return remembered.get(key);
}

/** Only for tests: one test's dragged dialog is not the next one's starting point. */
export function forgetDialogGeometry(): void {
    remembered.clear();
}
