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

/*
 * The bottom drawer - the RPC log panel (task 22, the maintainer's third look).
 *
 * A drawer is not a dialog: it is glued to the bottom edge, it has one dimension the user can
 * change and one handle to change it with. The clamping is the same problem, though, so it is the
 * same arithmetic here rather than a second set of rules in the component: a minimum that keeps
 * the drawer usable, a maximum that leaves the application visible, and no DOM.
 */

/** Half the window is what the drawer opens at - the maintainer asked for exactly that. */
export const PANEL_DEFAULT_FRACTION = 0.5;

/** Below this the drawer is a title bar with one row under it. */
export const PANEL_MIN_HEIGHT = 120;

/**
 * How tall the drawer may be.
 *
 * The maximum is the viewport minus whatever stays above it - the header - so the drawer can never
 * push the tab bar and the interface picker off the screen. On a window too short for even the
 * minimum the minimum wins: a drawer squeezed to nothing is a drawer that cannot be closed again,
 * because its close button is in the part that was squeezed away.
 */
export function panelLimits(viewportHeight: number, reservedHeight: number): {min: number; max: number} {
    return {min: PANEL_MIN_HEIGHT, max: Math.max(PANEL_MIN_HEIGHT, viewportHeight - reservedHeight)};
}

/** What the drawer opens at: half the viewport, inside the limits. */
export function defaultPanelHeight(viewportHeight: number, reservedHeight: number): number {
    const {min, max} = panelLimits(viewportHeight, reservedHeight);
    return Math.round(clamp(viewportHeight * PANEL_DEFAULT_FRACTION, min, max));
}

/**
 * Dragged by the top edge.
 *
 * The drawer's bottom is the window's bottom, so the top edge moving up by `dy` makes the drawer
 * `dy` taller - hence the minus. A drag that would take it past a limit stops at the limit rather
 * than being ignored, which is what makes the edge feel like it hits a wall instead of sticking.
 */
export function resizePanel(height: number, dy: number, viewportHeight: number, reservedHeight: number): number {
    const {min, max} = panelLimits(viewportHeight, reservedHeight);
    return Math.round(clamp(height - dy, min, max));
}

/** What the drawer was left at, for as long as the page lives - same rule as a dialog's box. */
const rememberedPanels = new Map<string, number>();

export function rememberPanelHeight(key: string, height: number): void {
    rememberedPanels.set(key, height);
}

export function recallPanelHeight(key: string): number | undefined {
    return rememberedPanels.get(key);
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

/** Only for tests: one test's dragged dialog - or drawer - is not the next one's starting point. */
export function forgetDialogGeometry(): void {
    remembered.clear();
    rememberedPanels.clear();
}
