# Task 23: Settings dialog and the help menu (done 2026-09-06)

Four commits on `master` from `66c4fb1` (the shell is the window) to `95d166f` (screenshots).

## What was done

The page-scroll defect the maintainer saw on the beta: `.hmm-app` asked for `height: 100%`, which
only holds when the mount element keeps that promise; where it does not, the whole column falls to
auto, the grid renders every row and the page scrolls with the header. `8be12c5` had fixed one
host's mount element; the shell now measures itself against the viewport (`100dvh`, overflow
hidden), so no ancestor can get it wrong. The layout tests had never seen it because
testing-library mounts into an unbounded div; `mountApp` now mounts into `#app` like the hosts,
and eight browser-mode tests assert per tab, with the drawer open and with an unbounded mount,
that the document never exceeds the window and only the grid scrolls. Settings dialog: five
titled sections (Verbindung, Rückruf, Schnittstellen, ReGa, Verhalten) in a two-column form grid,
right-aligned 210 px labels, help text under the field, widths by type, four spacing tokens, the
sections side by side so neither scrolling nor navigation is needed; every `data-testid` kept.
The "?" menu and the About dialog are gone; a 16 px GitHub mark in the header opens the project
page, in the browser as a normal `target=_blank rel=noopener` link, in Electron through a new
optional bridge command whose main-process allow-list accepts exactly one URL and refuses the
tracker, a trailing slash, a fork, `file:` and `javascript:`. Version, data manifest, licence,
copyright and the eQ-3 trademark line sit at the foot of the settings dialog, with the host's
Electron, Chromium, Node, platform and log-file line where a host exists (kept for bug reports).
The update notice is untouched; the manual update check stays in the application menu.

## Measured

Settings dialog 960×648 at 1280×800 in both themes, no scrollbar, `scrollWidth` equal to
`clientWidth`. Workspace 2100 tests in 129 files; UI browser mode 730, jsdom 660 with 64 layout
tests skipping themselves; Electron unit tests 145; web e2e 23 passed, 1 skipped. Screenshots
67–84 kB.

## Found

- The unbounded-mount test fails without the fix (the app grew to 9234 px on the events tab).
- Whether the lab box's symptom had the same cause could not be confirmed from here; the shell
  is self-bounding now either way.
- `shell.openExternal` is covered by unit tests of the preload call and the allow-list; the
  `ipcMain.handle` switch in main has no unit test, as before.
- The two-column 960 px dialog and the GitHub mark beside the other header icons are for the
  maintainer to judge on the next build.
