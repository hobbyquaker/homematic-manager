# Task 21: interface popup (done 2026-09-06)

Five commits on `3.0-dev` from `b5ab0a5` (the TLS flag) to `862e22a` (screenshots).

## What was done

`InterfacePopup` replaces the header's `MultiSelect` and takes the connection block with it. The
trigger is a 170 px box with the selected interface and one summary mark: red as soon as an
interface that exists does not answer, amber while one is re-subscribing (D-31), green when
everything answers, a grey dash for a CCU whose interfaces are all absent - a fault wins over
everything, and an absent interface is never a fault (task 13). `ConnectionIndicator` is that mark
and nothing else now, in a fixed 14 px box because ✔, ✕, ↻ and – are four different widths. The
popup has the CCU and the state of the connection to our own backend on top, then one item per
configured interface in configuration order with the tab bar's flat hover and its accent marking
(D-34, an inset accent line on the left instead of underneath), the name, the mark with its words
and a second line: protocol, port, TLS, the device count once that interface has been loaded and
the duty cycle once the Radio tab has read the gateways. Neither is fetched for the popup, and the
one item that is really broken carries the error text as its title. It opens below the trigger,
closes on a selection, Escape and a click outside; arrow keys move (Home and End too), Enter and
Space select, focus goes back to the trigger, roles are a listbox with options, and there is no
filter box (maintainer: a CCU has a handful of interfaces). It stays where 2.7 hid its picker - a
system with one interface - because it is now what says whether that interface answers.

`InterfaceState` gained an optional `tls`, set by the interface manager from the resolved
interface: deriving it in the UI from the connection configuration would have been a guess, because
resolved TLS is off for a local addon install and for an interface without a TLS port. The demo CCU
now has five interfaces, one per mark (`CUxD` subscribing over binrpc, `VirtualDevices` configured
and not answering), and its configured list is the list of its states, which is what the backend
answers with.

## Measured

Workspace 2039 tests in 127 files; UI browser mode 670 (25 of them the popup's own file), jsdom 629
with 41 layout tests skipping themselves; web e2e 23 passed, 1 skipped. The trigger measures
170×24 px and keeps that box and its position across every state change, an empty interface list
and a switch to a longer interface name; the tab bar starts at the same x in all of them.
Screenshots retaken, 68-83 kB each.

## Found

- Five configured interfaces found a real overflow in the settings dialog: its rows are a grid with
  a plain `1fr` track, which grows to the widest thing in it, so the picker's summary - the names,
  comma separated - pushed the dialog into a horizontal scrollbar. Fixed with `minmax(0, 1fr)` and
  an ellipsis on the picker button; it would have hit any CCU with more than two interfaces.
- The maintainer has two things to judge from the screenshots: the demo's red mark in the header
  (the roadmap asks for one interface per state, so the README shots now show a CCU with an
  interface that does not answer), and the summary mark's place - it was moved in front of the name
  in `951bccd` because next to the arrow it read like a button that clears the selection.
- The duty cycle is only in the popup once the Radio tab has been open, because that is where the
  gateway list is read. `InterfaceState` carries no duty cycle, and adding one would mean polling
  `listBidcosInterfaces` in the backend, which task 21 did not ask for.
- `apps/web/test/e2e/events.spec.ts` flaked once and passed on the rerun; pre-existing (task 19).
