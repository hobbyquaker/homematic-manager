# Task 19: UI polish after the first look (done 2026-09-06)

Five commits on `3.0-dev` from `3804423` (setValue) to `54607fb` (look and feel).

## What was done

`setValue` from a VALUES paramset wrote zero for every FLOAT: the dialog cast the value into the
`{explicitDouble}` wrapper and the backend, which owns the cast, cast it again into `NaN`, which
core turns into `0`; the same path hit every edited FLOAT in `putParamset`, and the link e2e had
that failure baked into its expectation. The dialog now sends values uncast and `castValue()`
unwraps a wrapped input, so a second cast is harmless; three e2e specs pin it, including a FLOAT.
Toasts: five on screen, the oldest dropped when a sixth arrives, informational ones expire after
about five seconds, warnings later, errors wait for a click, an "n more" counter. Tables: one set
of column tracks shared by the device rows and the channel sub-grid, measured in browser mode at
1280 px (header and device-row column positions identical before and after expanding, every
channel cell on the pixel of its sub-grid label). Dialogs: a fixed box per dialog class (the
paramset and link dialogs 640 px tall), the content area scrolls vertically, never horizontally,
the easy-mode description under its selector, fifteen browser-mode layout tests; the active tab
is marked by background and an inset underline, never by bold, and a test compares tab widths
across activation. Look and feel (D-34): flat neutral palette after `she`, flat tab bar and
toolbar, table headers as small muted labels without column rules or zebra, 26 px rows, 12 px
cell text against 13 px chrome, 24 px inputs and buttons, thin scrollbars; a theme test forbids
gradients; the browser test viewport is pinned to 1280×800. Screenshots retaken (70–85 kB each).

## Measured

Workspace 1947 tests in 123 files; jsdom run of the UI 579 passed with 20 layout tests skipping
themselves there; web e2e 23 passed, 1 skipped (temporary key until simulator 1.0.1). Web UI CSS
38.6 kB (6.6 kB gzipped); the Electron renderer CSS grew from 54.4 to 60.6 kB over the task.

## Found

- The setValue defect was wider than reported: BOOL datapoints worked, every FLOAT went to zero,
  in `setValue` and in `putParamset` alike.
- Two judgement calls for the maintainer: no zebra striping (as in `she`), and the fixed 640 px
  dialog height that leaves whitespace under a short paramset.
- `apps/web/test/e2e/events.spec.ts` flaked twice under four parallel workers after a cold build
  and passed on every rerun; pre-existing, not investigated.
- Whether the new look is what the maintainer wants is not verifiable here; the six screenshots
  in `docs/` show it.
