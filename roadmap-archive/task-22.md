# Task 22: UI third look, and the beta (UI part done 2026-09-06)

Four commits on `3.0-dev` from `9b94c1d` (pictures and metrics) to `b2c07e9` (screenshots).

## What was done

Device pictures in the dark theme get the filter `invert(1) hue-rotate(180deg) contrast(0.75)
brightness(0.9)` as a theme token applied to the image only, judged on seven real CCU pictures
fetched read-only from the lab web host: white paper lands at `#1d1d1d` against the `#1e1e1e`
surface, black lines at `#c9c9c9` like text, a red device stays red (a plain invert turns paper
black and red cyan). Rows 26 → 30 px, pictures 16 → 20 px, both tokens mirrored in
`metrics.ts` for the virtualiser and the column tracks with a test that parses `app.css` against
them; the picture column was 24 px with clipped cells and cut the 16 px picture to 12 px, now
32 px in all four grids. Language (D-36): choice in this browser → profile → first supported
`navigator.languages` entry → English; the contract gains `language?: Language | 'auto'`, the
backend default writes no language and the 2.x import takes one only if there was one; the
switch left the header for the settings dialog with "Browser language" as its first entry; the
RPC help catalogue and the ReGa client keep German on purpose (eQ-3 texts, CCU-side language);
the web host's login page follows `Accept-Language` with English behind it; the addon needed no
change. The RPC log drawer opens at 50 % of the viewport, has a focusable ARIA separator as its
drag handle (mouse and arrow keys, minimum 120 px, maximum viewport minus header, remembered for
the session) and no longer overflows horizontally (its entry grid had a plain `1fr` track, the
same defect task 21 found in the settings dialog).

## Measured

Workspace 2084 tests in 128 files; UI browser mode 713, jsdom 658 with 55 layout tests skipping
themselves; web e2e 23 passed, 1 skipped. Header band 33 px, column labels 26 px, filter row
27 px, pinned by a test; the device row 30 px with the picture 20×20 inside its cell. Drawer at
1280×800 opens at 400 px, drags by the dragged amount, clamps at 764 and 120, keeps its height
across close and reopen. Screenshots 67–84 kB.

## Found

- Taste is the maintainer's: the filter, the 30/20 px and the drawer's feel are shown in the six
  screenshots.
- Real pointer drags, a real foreign-locale browser and the login page's fallback against a CCU
  are untested here.
- The beta itself (D-37) is the main session's part: version, merge, tag, workflows.
