# Task 20: UI second look (done 2026-09-06)

Five commits on `3.0-dev` from `8e22639` to `76b3863` (screenshots).

## What was done

Filters: the brief first said "column filters out, one box per table" (`8e22639`) and the
maintainer corrected it the same day, so `6292add` restores the per-column filter row byte-identical
and removes the tab-wide filter box on every tab instead. The undrawn `filter` prop stays because
issue #25 hands a "links of this channel" narrowing to the Links tab, now shown there as a
clearable chip; the Events tab keeps its two named ADDRESS/PARAM boxes, which are its own controls.
Header band: `DataTable` gained `toolbar` and `status` snippets, the band carries caption and the
actions on the left and the count on the right, the column labels beneath, the filter fields under
those; Devices, Links, RSSI, Service messages and Events feed it, the RPC console keeps its plain
toolbar; every `data-testid` unchanged. Dialogs: `dialogGeometry.ts` holds the pure move, resize,
clamp and per-session geometry map; `Dialog.svelte` drives it with pointer events on four edges and
the corner, handles inside the frame; focus trap and Escape untouched; the minimum size defaults
to a dialog's designed width so a form laid out for it never gets a horizontal scrollbar, with
smaller minimums only for the paramset and link editors whose rows reflow. Screenshots retaken.

## Measured

Band 33 px on all five tabs above the 26 px label row and the 27 px filter row, count 6 px inside
the band's right edge; task 19's column x positions unchanged before and after expanding a device;
the paramset dialog moves by the dragged offset, resizes to 1020×720 from an unmoved position,
clamps to the viewport after a move, and stops at its 520×320 minimum. Workspace 2003 tests in 126
files; UI browser mode 640, jsdom 604 with 36 layout tests skipping themselves; web e2e 23 passed,
1 skipped. Screenshots 70–83 kB each.

## Found

- The Devices band (caption, ten icon buttons, count) is close to full at 1280 px and wraps below
  roughly 1100 px; for the maintainer to judge from the screenshots.
- Real pointer drags (mouse across the backdrop, touch, pen) are untested; the tests use synthetic
  pointer events.
- `apps/backend/src/interfaces/defaults.test.ts` (real callback sockets) flaked once; pre-existing.
