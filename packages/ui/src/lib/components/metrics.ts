/**
 * The three grid metrics that exist as a number as well as as a token.
 *
 * `app.css` is where the metrics of this app are declared (`--hmm-row-height`,
 * `--hmm-device-image-size`), and everything that CSS can do reads them from there. These three
 * cannot: the table virtualiser computes a scroll offset from the row height, `DeviceImage` writes
 * the picture's box into `width`/`height`, and a column track is a number in a column definition.
 * So they are mirrored here, and `metrics.test.ts` parses `app.css` and fails when the two drift -
 * the token stays the source of truth, this file is the copy that JavaScript can read.
 *
 * Task 22, the maintainer's third look at `3.0.0-dev.6`: the rows were 26 px with a 16 px picture
 * in them, which is smaller than the CCU's own line drawings survive. Both grew by four.
 */

/** `--hmm-row-height`. One row of every grid; the virtualiser needs it to be uniform. */
export const ROW_HEIGHT = 30;

/** `--hmm-device-image-size`. The device picture in a grid row. */
export const DEVICE_IMAGE_SIZE = 20;

/**
 * The width of the picture column.
 *
 * A grid cell clips (`.hmm-td { overflow: hidden }`), so a track narrower than the picture plus the
 * cell's 6 px of padding on each side cuts the picture off rather than letting it stick out - which
 * is what the 24 px track of the 16 px picture did before task 22.
 */
export const ICON_COLUMN_WIDTH = DEVICE_IMAGE_SIZE + 12;
