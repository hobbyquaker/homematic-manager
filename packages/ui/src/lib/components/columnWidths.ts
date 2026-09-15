/**
 * The widths a user gives the columns of a grid (task 40, #157).
 *
 * "In den Spalten Räume / Gewerke / RX-Mode sind die Namen teilweise abgeschnitten. Es wäre schön,
 * wenn die Spaltenbreite anpassbar wäre" - and a few minutes later, "das Problem besteht wohl in
 * allen Spalten". So every text column of the shared `DataTable` has a drag handle on the right edge
 * of its label, a double click on that handle fits the column to what it shows, and the result is
 * kept per table.
 *
 * A width set here is a pixel width that replaces the column's proportional weight
 * ({@link tableLayout}); every column the user has not touched keeps its weight and shares the rest.
 * The arithmetic - the limits and what "fit" means for a set of measured cells - is here, without
 * a DOM, so it is tested directly.
 */

import type {DataTableColumn} from './tableModel.js';

/** Column key -> width in CSS pixels, for one table. */
export type ColumnWidths = Readonly<Record<string, number>>;

/**
 * The narrowest a user can drag a column. The cell's padding is 6 px on each side and the handle
 * sits in the right one, which leaves room for two or three characters and the ellipsis - enough to
 * see that there is something in it, and the tooltip says what.
 */
export const MIN_COLUMN_WIDTH = 40;

/** The widest a drag or a stored value may make one column. */
export const MAX_COLUMN_WIDTH = 1200;

/**
 * The widest a double click makes a column. A FLAGS or a firmware cell with a long status would
 * otherwise push every other column out of the window for one row's sake.
 */
export const FIT_MAX_WIDTH = 600;

/** One arrow key press on a focused handle. */
export const RESIZE_KEY_STEP = 10;

/** Pixels, whole ones, between the limits; anything that is not a number is the minimum. */
export function clampColumnWidth(width: number, min = MIN_COLUMN_WIDTH, max = MAX_COLUMN_WIDTH): number {
    if (!Number.isFinite(width)) {
        return min;
    }
    return Math.round(Math.min(Math.max(width, min), Math.max(min, max)));
}

/**
 * What a double click on the handle makes of a column: as wide as the widest of the measured
 * natural widths - the label and every rendered cell - rounded up so that a fractional pixel does
 * not bring the ellipsis back, and kept between the minimum and {@link FIT_MAX_WIDTH}.
 *
 * `undefined` when nothing was measured: a table that is not on the screen has nothing to fit to,
 * and a guess would be stored as if the user had chosen it.
 */
export function fitColumnWidth(
    naturalWidths: readonly number[],
    min = MIN_COLUMN_WIDTH,
    max = FIT_MAX_WIDTH,
): number | undefined {
    const measured = naturalWidths.filter((width) => Number.isFinite(width) && width > 0);
    if (measured.length === 0) {
        return undefined;
    }
    return clampColumnWidth(Math.ceil(Math.max(...measured)), min, max);
}

/**
 * Picture and marker columns keep their pixels (`fixed`): they have nothing more to say when they
 * are wider, and their size is computed from the picture (#148). A column of buttons is resizable
 * down to its own minimum instead ({@link minimumColumnWidth}, B-35).
 */
export function isResizable<T>(column: DataTableColumn<T>): boolean {
    return column.fixed !== true && column.hidden !== true;
}

/**
 * The narrowest a user can make this column: {@link MIN_COLUMN_WIDTH}, or the column's own
 * `minWidth` when it keeps it (`keepMinWidth`, B-35: the PARAMSETS buttons, which a narrower column
 * put under the next cell).
 */
export function minimumColumnWidth<T>(column: DataTableColumn<T>): number {
    if (column.keepMinWidth !== true || column.minWidth === undefined) {
        return MIN_COLUMN_WIDTH;
    }
    return Math.max(MIN_COLUMN_WIDTH, Math.round(column.minWidth));
}

/**
 * The widths of one table from untrusted JSON - `localStorage` is edited by hand, and by older and
 * newer versions of this app. Keeps the finite numbers, clamped; drops everything else.
 */
export function sanitizeColumnWidths(value: unknown): Record<string, number> {
    const widths: Record<string, number> = {};
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return widths;
    }
    for (const [key, width] of Object.entries(value as Record<string, unknown>)) {
        if (typeof width === 'number' && Number.isFinite(width)) {
            widths[key] = clampColumnWidth(width);
        }
    }
    return widths;
}
