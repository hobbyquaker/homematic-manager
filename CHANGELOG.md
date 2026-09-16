# Changelog

All notable changes to the Homematic Manager. Grouped by what a user notices rather than by
component; the numbers in brackets are GitHub issues and pull requests.

Versions before 3.0 are in the [releases](https://github.com/hobbyquaker/homematic-manager/releases);
2.7.1 (2023-01-28) is the last 2.x release.

## [3.0.0-beta.19] — 2026-09-16

### New

- **A favicon.** The browser tab shows the Homematic Manager logo (16, 32 and 48 px, taken from the desktop app's
  icon). The login page stays without it: it loads nothing but itself.

### Fixed

- **With no callback address chosen, the CCU calls back on the address that reaches it.** Without a chosen address the
  app used to take the first address of the machine, and on a Mac with a VPN, a virtual-machine bridge, a second adapter
  or a link-local address listed first that was not one the CCU could reach: the interfaces showed as connected, no
  events arrived and the device list never loaded. The automatic address is now this machine's address in the CCU's
  network, otherwise the one the route to the CCU leaves from, otherwise the first one that is not link-local, and it is
  worked out again at every connect, so a new network or lease is followed. The settings dialog names it and why
  (_Automatic (192.168.1.20, in the CCU's network)_) and marks the addresses outside the CCU's network. A chosen address
  that is no address of this machine any more is replaced by the automatic one; it, and a chosen address outside the
  CCU's network, get a warning in the settings dialog and beside the interface picker, with a one-click **Use
  automatic**. The CCU addon and a callback address set at start or in a container are unchanged. (#162, #165,
  @Herbert-Testmann, @ChrWi)
- **The desktop app's "Download" in the update bar finds the file, and a failed update says so.** The in-app download
  never worked from any release on macOS, Windows or the AppImage: the update manifests named the files
  `Homematic-Manager-…`, the release carried them as `Homematic.Manager-…`, and the app asked GitHub for a file that
  did not exist. The bar then vanished without a word. The installers are now called `Homematic-Manager-…` everywhere
  (the x64 AppImage `Homematic-Manager-<version>-x86_64.AppImage`), the build checks every manifest entry against the
  files, and a failed check or download stays in the bar with its reason and a link to the releases. Installed
  Windows and AppImage copies of the earlier betas can take this version from the bar. **On macOS, download the dmg
  of this version from the release by hand:** the Mac build is not signed, macOS installs an update only into a
  signed app, and the earlier betas do not know the download link below yet. (#163, @Herbert-Testmann)
- **On macOS and Windows, "Download" in the update bar opens the installer in your browser.** The app no longer tries
  to download and install an update it cannot install unsigned: from this version on, the bar's "Download" (and the
  one in _Check for Updates…_) opens the matching file of the new release - the universal dmg on macOS, the Setup
  exe on Windows, the portable exe of your architecture when you run the portable one, and the deb of your
  architecture on a deb install - or the release page if that file is missing. The AppImage keeps updating itself:
  download in the bar, install on quit. (#163, @Herbert-Testmann)
- **The desktop app's update downloads go to a folder called `homematic-manager-updater`.** Up to beta.18 it was
  `@homematic-managerelectron-updater`, after an internal package name, in the user's cache directory
  (`%LOCALAPPDATA%` on Windows, `~/Library/Caches` on macOS, `~/.cache` on Linux). The old folder stays where it is
  and can be deleted; on Windows it holds a copy of the previously installed Setup exe.

## [3.0.0-beta.18] — 2026-09-15

### New

- **The RPC log shows every outgoing call, and the RPC console has no history of its own.** The drawer used to list
  the writes and nothing else; now every call the app makes is in it - `init` and de-init, the keep-alive `ping`,
  `listDevices`, the descriptions and paramsets, `setValue`, `getServiceMessages`, the console's calls - each with
  its time, interface, method, parameters, duration, result or fault, and where it came from: console, UI, or
  background. The background calls are the bulk of it and are drawn muted; "Hide background calls" in the drawer's
  header takes them out of view without taking them out of the log. Every entry has "open in console", which puts
  that call - anybody's, not only the console's - back into the console's form; that replaces the history list the
  console kept under its response field, and the response takes the whole column now. What bounds the log on a CCU:
  1000 entries, 4 MiB in total, an answer over 8 KiB kept as a preview with its size; a passphrase (`changeKey`,
  `setTempKey`) or a whitelist device key is logged as `***`. Only the writes are still persisted across sessions
  (`write-log.json`) and the 2.x `rpcLogFolder` dump of `putParamset` is unchanged. For the API: `writeLog.*` is
  `rpcLog.*`, the entry carries `origin`, and the drawer's labels are in German now too. (task 48)

- **CCU addon on openccu-lite: the settings page and the Systemsteuerung hand-over take the box's session header.**
  `settings.cgi` (and `service.cgi`) read the `X-Occulite-Session` that openccu-lite's gate sets behind a session it
  validated, confirm it with the box (`GET /api/auth/v1/state` must say `authenticated` and name that very `sid`; an
  API token, another session or a box that cannot be asked mean refused), and only then fall back to `?sid=` and the
  token cookie. With the frontend reading the header since beta.16, the whole addon now works without `?sid=` in its
  URLs, and the openccu-lite addon catalogue can declare `session.header_since` for it, after which the box stops
  putting the session id into the addon's addresses (history, bookmarks, referrers). The header is read on openccu-lite
  only; a CCU passes a client's header through and ignores it. (task 50)
- **A double click on a device or channel name in the device grid opens the rename dialog** for exactly that row -
  the same dialog as the ✎ button and _Rename_ in the row menu. **F2** opens it for the selected row, and so does
  **Enter**. A single click still only selects, the double click neither opens nor closes the channels, and a double
  click anywhere else in the row or on a column edge does what it did before. The `:0` channel, which has no name of
  its own to change, opens nothing. (task 46)
- **A tiny copy button on names and addresses.** Every grid cell with the name or the address of a device, a channel
  or an interface - Devices and its channels, both ends of a link, the Funk tab's gateways, devices and peers, the
  service messages and the events - has a small copy icon at its end. It appears when the pointer is over the row
  (on a touch screen it is always there), copies the whole name or address even when the column cuts it off, and says
  "Copied". It lies over the end of the text, so no column gets wider, and a click on it neither selects the row nor
  opens anything; the name next to it still renames on a double click. From the keyboard, Tab reaches the buttons of
  the selected row and Enter or Space copies. Where the browser has no clipboard access for the page - the CCU addon
  opened over plain HTTP - it copies the old way, and if that fails too it says so and selects the text for Ctrl+C.
  On the way, Space and Enter on a focused button inside a grid (a paramset button, the repair button) press that
  button instead of selecting the row or opening its dialog, and a space can be typed into a column filter again.
  (task 47)

### Changed

- **_Assign to room_ and _Assign to function_ are a list of checkboxes** instead of "Add to" / "Remove from" and a
  small list to pick one room from. The dialog is as tall as its rooms need, up to the window, so every room is seen at
  once; only in a window too short for all of them does the list scroll, and the buttons stay in view. (task 49)
  - **A checkbox per room:** checked when the selected row is in it. For several rows, a room that holds only some of
    them shows a dash; a click puts all of them in, the next takes all out, a third leaves it as it was. A device row
    counts as in a room when all its channels are (the `:0` channel aside).
  - **Apply writes only what was changed.** If the store refuses a room, the dialog stays open, marks that room with
    the reason, and Apply tries just that one again.
  - **With more than ten rooms** a filter field is shown (`kuche` finds _Küche_; Enter there jumps to the list and saves
    nothing). **New room…** makes a room and checks it; it is assigned with Apply.
  - **Keys:** Space toggles, Enter on a checkbox saves, Escape cancels.
  - **On a CCU** (rooms and functions from ReGa), assigning a device row to a room took its channels out of every other
    room and function, and taking a device row out of a room did nothing. Now only that one room changes, channel by
    channel.
- **CCU addon on openccu-lite: the addon's settings page and `service.cgi` are for administrators.** Any account signed
  in to the box could open `settings.cgi?cmd=config`, switch the addon's login mode (which restarts it) and start,
  stop or restart the service through `service.cgi`. On openccu-lite both now want a session the box names as `admin`:
  the gate's `X-Occulite-Session`, confirmed with `GET /api/auth/v1/state`, which has to say `"role": "admin"` - or,
  where the box does not confirm the header, the session id in `?sid=`. The session's legacy alias in `?sid=` and the
  addon's `hmm_token` cookie cannot tell whose role they carry, so they do not open these pages there. Any other
  session gets a 403 page, "Nur für Administratoren / Administrators only", and nothing is changed. The hand-over into
  the app (`settings.cgi` without `?cmd=config`) is unchanged, and so is a CCU or OpenCCU, where any WebUI session
  keeps its access. (B-37)
- **RSSI values are coloured in eight steps instead of three, with signal bars.** Until now nearly every real link
  (-40 to -90 dBm) was the same yellow "medium", because the steps came from the 2.x gradient (good from -20 dBm, bad
  below -100). The new scale has a step every 10 dB from -30 to -90 dBm, and OpenCCU's edges at -70 and -90 dBm are
  edges of it too. (#161, @Baxxy13, @Herbert-Testmann)
  - **The pill** shows the value without its unit and up to four bars, so the step can be read without telling the
    colours apart; the unit stays in the column head (`← dBm` / `→ dBm`), and the pill is narrower than before.
  - **The tooltip** names value, unit and band, e.g. "-65 dBm · Ausreichend".
  - **The colours** are the same in the light and the dark theme; the text and bars on them are dark or white,
    whichever reads better, at a contrast of at least 4.5 : 1.
  - The same pill is used in the Funk grid, its peer sub-grid, the setBidcosInterface dialog and the best-receiver
    dialog.

### Fixed

- **Escape closes a dialog on the Devices and the Links tab again.** While one of those two tabs was shown, Escape
  closed no dialog at all - rename, create link, and the settings dialog as well - in the browser and in the desktop
  app alike; only the ✕ button and Cancel did. The row menu of the two grids took every Escape, also while it was not
  open. It now takes Escape only when it is open. (B-38)

- **CCU addon on openccu-lite: an `HMM_AUTH_MODE=token` left in `etc/hmm.env` by a CCU install no longer keeps the
  addon out of the box's login.** Every install from the CCU days has that line, `hmm.env` survives updates, and a
  `/usr/local` upgraded from CCU firmware to openccu-lite therefore ran the backend in token mode, where the box's
  shell could not open the addon (every socket from the frame was refused).
  - **The rule:** `HMM_AUTH_MODE` is the CCU's setting and is not read on openccu-lite. openccu-lite reads
    `HMM_AUTH_MODE_LITE` — `occulite`, the box's own login, unless it says `token` — and a CCU does not read that one,
    so the same `/usr/local` can move between the firmwares and each keeps its own choice. A lite value that is neither
    `token` nor `occulite` runs `occulite`, and the syslog says so.
  - **The settings page** (`settings.cgi?cmd=config`) writes the line of the firmware it runs on and, on openccu-lite,
    names a CCU line it found in the file.
  - **If you chose `token` on an openccu-lite box with 3.0.0-beta.17 or earlier**, that choice was written as
    `HMM_AUTH_MODE=token`, which is indistinguishable from the CCU's line: the box runs `occulite` after this update, and
    the settings page puts `token` back as `HMM_AUTH_MODE_LITE=token`. (B-22)
- **On openccu-lite the addon takes the session of the box's gate before a `?sid=` on the URL.**
  - **Before:** a `?sid=` was checked first. Since openccu-lite's session ids have 26 characters, the ten-character
    `?sid=` its shell put on the URL is only an alias the box's API refuses, so Homematic Manager sent its frame back to
    the box's start page, although the same request carried a valid `X-Occulite-Session`. openccu-lite no longer puts a
    `?sid=` on the addon's URL; this makes the addon independent of that.
  - **Now:** a request whose gate header the box confirms is signed in, whatever `?sid=` says, and the `?sid=` comes off
    the URL. Without a confirmed header the `?sid=` hand-over works as before, for boxes from before the header.
  - **Not asked at all:** a `?sid=` or header that cannot be an openccu-lite session (neither 26 characters of base32
    nor ten alphanumerics, an API token among them), and a ten-character `?sid=` next to a header of the long shape.
    (B-36)
- **On openccu-lite the gear of Homematic Manager opens the addon settings, not the app.** The install and
  `rc.d/hmm info` name `/addons/hmm/settings.cgi?cmd=config` as the Config-Url there, because openccu-lite's shell
  frames the Config-Url behind the gear and the _Settings_ button, and the app has its own entry in the addon menu. On
  a CCU the Systemsteuerung button still opens the app. (B-36)
- **The device grid offers only the paramsets that have something in them.**
  - **The rule:** a button in the PARAMSETS column, and an entry in the context menu of a device or a channel, is there
    when the device or channel lists the paramset and the interface describes it with parameters.
  - **Before:** the buttons followed the list alone, and the context menu offered a fixed set per kind of row, so a
    MASTER button opened an empty dialog: the MASTER of every HmIP device is empty, and so is the MASTER of the virtual
    keys of the CCU's own radio module.
  - **SERVICE is offered on devices only.** hmipserver lists it on most HmIP channels too and describes it there with the
    device's own five service parameters, so a channel, channel 0 included, gets no SERVICE button or menu entry.
  - **Channel 0 of an HmIP device** keeps its MASTER button when the dialog has service messages to suppress.
  - **One description per kind of device and channel** is asked for, only for the rows on screen. A description that
    cannot be read keeps its button, and the dialog says why. (B-33)
- **The Msgs column of the device grid is wide enough for two service-message marks and the repair button**, which it
  used to cut off.
  - **Resizing:** it can be dragged wider like the other columns, keeps its width over a reload, and "Reset column
    widths" includes it.
  - **Never narrower than the marks and the button:** neither a narrow window nor a drag makes it narrower than that,
    like the PARAMSETS column, so the repair button stays whole and takes its click. A width stored narrower by an
    earlier build of this version is drawn at that minimum.
  - **Tooltip:** a cell that is cut off shows its content when the pointer rests on it. (B-34)
- **The PARAMSETS column of the device grid can be resized** (#157, @Herbert-Testmann).
  - **Resizing:** it can be dragged wider, keeps its width over a reload, and "Reset column widths" and "Fit column to
    content" include it.
  - **Its buttons stay whole:** the column is never narrower than the buttons a row offers, neither in a narrow window
    nor after a drag, so every button still takes its click.
  - **The other columns that could not be resized** now can: the Links count of the channel sub-grid, FLAGS on the
    Links tab, the Devices and Channels counts of the metadata store, and the suppress button of the HmIP service
    messages. That button column is never narrower than its button either, and now fits the German
    "Unterdrückung aufheben", which it used to cut off.
  - **Still fixed:** the device pictures and the receiver marks of the Funk tab. (B-35)

## [3.0.0-beta.17] — 2026-09-13

**A hotfix for the CCU addon of 3.0.0-beta.16, which could not be opened on openccu-lite.** beta.16 started the addon's
backend with `--lite-mode`, and that flag broke every web request the backend makes itself. **If you stay on beta.16
for now**, set `HMM_NODE_FLAGS=` (empty) in `/usr/local/addons/hmm/etc/hmm.env` and restart the addon. **After the
update to this version**, remove that line again: the update keeps an empty `HMM_NODE_FLAGS=`, and without the line
the addon uses its new memory flags.

### Fixed

- **The CCU addon can be opened on openccu-lite again, and the backend's own web requests work again everywhere.**
  beta.16 started node with `--lite-mode` to save memory. That flag switches off WebAssembly, and node's built-in
  `fetch` needs it, so every request of the backend failed with `fetch failed`. On openccu-lite the addon asks the box
  with such a request whether a session is valid: it refused every session, and the box's start page appeared in the
  addon's frame instead of the Homematic Manager. On every firmware the device pictures the addon fetches from the CCU
  fell back to the bundled ones. The addon now starts node with `--max-semi-space-size=1 --optimize-for-size`, which
  keep WebAssembly and still save memory: measured with the addon's own runtime against a simulated CCU, about 30 MiB
  less PSS after the start and 5–35 MiB less with a page open, about the same after the idle unsubscribe, and far less
  scatter from garbage collection (the addon's README, "Memory"). `--lite-mode` and `--jitless` are dropped from
  `HMM_NODE_FLAGS` wherever they are set, with a line in the log, and the update takes them out of `etc/hmm.env`; any
  other flag set there stays, and so does an empty `HMM_NODE_FLAGS=`. (B-32)

## [3.0.0-beta.16] — 2026-09-12

Thanks to @Herbert-Testmann for reports and ideas.

**Docker: the image's callback ports move to 2031/2032.** If you publish `-p 2126:2126 -p 2127:2127`, change the
mapping to `-p 2031:2031 -p 2032:2032`, or no events arrive after the update (see _Changed_). The CCU addon's backend
runs with `--lite-mode` and uses less memory, "Check for Updates..." in the desktop app answers every outcome (#160),
the Funk tab's dBm columns can be resized from the header row (#157), an interface that does not answer in time is no
longer shown as "not present", and on openccu-lite the addon also takes the session from the box's gate.

### New

- **On openccu-lite the addon also takes the session from the box's gate.** openccu-lite's web server passes the
  session it let through to the addon as the `X-Occulite-Session` header and removes any copy a browser sent. The
  addon asks the box to confirm that session (`/api/auth/v1/state`) and then lets the request in, so a bookmark, or
  a reload after the addon's own login expired, opens the UI instead of going back to the box's start page. The
  `?sid=` hand-over from the box's menu and the addon's cookie work as before, so openccu-lite images without the
  header keep working; on a CCU and OpenCCU the header is not read at all. It needs an openccu-lite image that sets
  the header.

### Changed

- **Breaking for the Docker image: its callback ports are now 2031/2032 instead of 2126/2127.** That is the pair the
  CCU addon uses, so every install type that fixes its callback ports uses the same one, and it no longer collides
  with hm2mqtt.js, whose default is 2126/2127. **If you publish `-p 2126:2126 -p 2127:2127`**, change the mapping to
  `-p 2031:2031 -p 2032:2032`, or keep the old ports with `HMM_CALLBACK_XMLRPC_PORT=2126` and
  `HMM_CALLBACK_BINRPC_PORT=2127`; otherwise the CCU calls back on a port that is not published and no events
  arrive. With `--network host` nothing has to change. `compose.yml` and `docs/install-docker.md` are updated.
- **The CCU addon's backend uses less memory.** Node runs with `--lite-mode`, V8 without its optimising compilers.
  Measured with the addon's own runtime against a simulated CCU, that is about 30–50 MiB less while it is
  subscribed or a page is open and 15–18 MiB less after the idle unsubscribe, and the figure no longer jumps with
  garbage collection (the addon's README, "Memory"). `HMM_NODE_FLAGS=` in `etc/hmm.env` switches it off.

### Fixed

- **An interface that does not answer in time is no longer shown as "not present".** A user-defined interface
  such as CCU-Jack or a remote CUxD that was slow at the start, or briefly unreachable, was marked "not present"
  by the background port probe, which never asked it at all, and a built-in interface whose probe timed out was
  marked the same way. Only a port that refuses the connection means "not present" now. One that times out, or
  whose host cannot be reached, is shown as "Not answering" ("Antwortet nicht") in the interface popup, stays
  configured and is tried again; a "Retry now" button under the list tries it at once.
- **On a touch screen a tap near the right edge of a column label sorts again.** Since the resize handle got a
  finger-sized area in beta.15, a tap on the right part of a label landed on the handle and did nothing. Under a
  finger or a pen only a drag resizes a column now; a tap sorts, as it does on the rest of the label, and the
  double tap does not fit the column. A mouse works as before.
- **"Check for Updates..." in the desktop app always answers.** A check that found no newer version, or that failed,
  showed nothing at all: the bar at the top of the window only appears when there is something to download or
  install. The menu entry now answers in a message box: the app is up to date, a newer version is available (the bar
  offers the download), or the check failed and why. A version you dismissed earlier is offered again when you check
  from the menu (#160, @Herbert-Testmann).
- **The Funk tab's ← dBm / → dBm columns can be resized from the header row.** They only have values in an expanded
  device, and their resize handle was only in the expanded device's own label row; the gap they leave in the header
  row between ADDRESS and TYPE had none. That gap now has the handle too, whether a device is expanded or not, and a
  right click there offers "Fit column to content" and "Reset column widths" for those columns. The same holds for
  the columns only the channel rows of the devices table have, such as DIRECTION (#157, @Herbert-Testmann).

## [3.0.0-beta.15] — 2026-09-12

Thanks to @Baxxy13, @Herbert-Testmann and @FraatTailscale for reports and ideas.

The addon's log moves to `/var/log` on a CCU and OpenCCU, with the addon directory as a choice (#159), and to the
journal on openccu-lite. CUxD is no longer asked for service messages every five minutes (#158), an extra interface
such as CCU-Jack can be switched on in the settings dialog (#135), and the columns of the expanded sub-grids can be
resized too (#157).

### New

- **The columns only a sub-grid has can be resized too.** These are DIRECTION (and AES_ACTIVE on BidCos-RF) in the
  channel rows of the devices table, and ← dBm / → dBm in the peer rows of the Funk tab. The handle works as in the
  header: drag, double click to fit, arrow keys and Enter, and the right-click menu. One width applies to every
  expanded sub-grid, so the rows stay aligned, and "Reset column widths" there resets only the sub-grid's columns
  (#157, @Herbert-Testmann).
- **A cut-off column label, or a button in a cut-off cell, shows its full text on keyboard focus too**, not only
  on hover. Escape hides it (#157, @Herbert-Testmann).
- **The column resize handle is easier to hit on a touch screen**: a finger-sized area around the thin line, which
  stays as it is for a mouse (#157, @Herbert-Testmann).

### Changed

- **On openccu-lite the CCU addon logs to the journal instead of a file.** This follows openccu-lite's rule that
  everything logs to the journal. The backend's output goes there under `addon-hmm`: the box's Log page shows it
  with that unit chosen, and `journalctl -t addon-hmm` on the box. The old `var/hmm.log` on the SD card is removed
  at the first start. There, `service.cgi?…&cmd=log` and the addon's settings page lead to the Log page. On a CCU
  and OpenCCU the log stays a file, see the next entry.
- **On a CCU and OpenCCU the addon's log is now `/var/log/hmm.log`.** That is where a CCU keeps its logs,
  in memory, so the addon no longer writes its log to the SD card; the log is empty after a reboot. To keep it
  across reboots, the new _Log_ section on the addon's settings page moves it back to the addon directory
  (`/usr/local/addons/hmm/var/hmm.log`, or `HMM_ADDON_LOG=addon` in `etc/hmm.env`). Both are rotated at 1 MB. The
  file at the other location is removed at the next start. The settings page shows the last lines of the log, and
  `service.cgi?…&cmd=log` follows the setting. When `/var/log` cannot be written, the log goes to the addon
  directory. On openccu-lite the log stays in the journal, and the settings page only says so (#159, @Baxxy13).

### Fixed

- **CUxD no longer writes a warning into the CCU's log every five minutes.** The app asked every
  interface for its service messages every five minutes, including CUxD, which has no such method. CUxD
  logged `called unknown request method 'getServiceMessages'` each time, and the app logged the refusal
  just as often, because it did not recognise CUxD's wording of it. CUxD is no longer asked. An interface
  you configured yourself is asked only if its own list of methods names `getServiceMessages`; if it has
  no such list, it is asked once, as before. A service-message read that keeps failing for another reason
  is logged once, not every five minutes, and once more when it works again (#158, @Baxxy13).
- **An extra interface such as CCU-Jack can be switched on.** A CCU-Jack added under "Extra interfaces" never
  connected. Only the interfaces ticked under "Configured interfaces" are
  connected, and that list offered the built-in interfaces and whatever was ticked already, never an extra
  interface. It now lists every extra interface that has a name, after the built-in ones. One added in the dialog is
  ticked by itself as soon as it has a name, a rename keeps the tick, and removing it removes the tick. An extra
  interface that is already saved without a tick stays as it is: tick it once under "Configured interfaces"
  ("Konfigurierte Schnittstellen") and save (#135, @FraatTailscale, @Baxxy13).

## [3.0.0-beta.14] — 2026-09-12

Herbert-Testmann's two requests on beta.13 (#157, #147), the addon's start that said OK when nothing
started, and the callback settings of the Docker image that the settings dialog could quietly undo.

### New

- **Grid columns can be resized** (#157). In every table — devices, links, Funk, service messages,
  events, the metadata pages — the right edge of a column header can be dragged, and a double click on
  it fits the column to its content. The arrow keys move a focused edge, Enter fits.
- **Column widths are remembered** per table and connection profile, in this browser or app, and the
  right-click menu on the column headers resets them ("Reset column widths") or fits one column.
- **A cell whose text is cut off shows its full text as a tooltip** (#157), only where something is
  actually cut off, with the app's own tooltip rather than the browser's.

### Changed

- **Callback address and ports set at start win over the settings dialog.** In the Docker image
  (`HMM_CALLBACK_XMLRPC_PORT`, `HMM_CALLBACK_BINRPC_PORT`, `HMM_CALLBACK_IP`) or with `--callback-*`
  on the command line, the dialog now shows them read-only with the option that set them. Until now
  a port changed there moved the listener away from the port the container publishes at once, and
  was silently overwritten again at the next start. `config.json` keeps the value you saved.
- **The interface popup shows the callback URL each interface was given**, and in the Docker image
  adds "Publish this port unchanged" beside it. The image's ports are unchanged (2126/2127).
- **The automatic acknowledgement's one-time question is easier to read** (#147). It says what is
  already there and what happens from now on — "1 STICKY_UNREACH message is already listed. New ones
  are acknowledged automatically from now on." — and its buttons say which messages they mean:
  "Acknowledge existing" and "Only new ones" ("Vorhandene bestätigen" / "Nur neue").

### Fixed

- **A fixed callback port that is already in use is a clear error.** The log names the port and the
  option that set it, and the interface popup says "Callback port N is in use". The interfaces of the
  other protocol keep working, and a reconnect tries again. Before, a bare `EADDRINUSE` left every
  interface disconnected. There is still no fallback to a free port for a fixed port — in a container
  that is the port nobody published; the CCU addon's default ports keep theirs.

- **The CCU addon says so when its backend did not start.** `rc.d/hmm start` answered "OK" as soon
  as the process was forked, so a backend that could not run looked started: on openccu-lite, where
  the addon runs as its own user, a pidfile left behind by root after a live install kept it from
  starting after a crash, and the service page, the Zusatzsoftware list and systemd all showed it as
  running. The start now refuses with the reason when the stale pidfile cannot be removed or the
  addon's `var/` cannot be written, checks that the backend is still alive three seconds after the
  start, and otherwise reports FAILED with the last lines of `var/hmm.log` and exit code 1.

## [3.0.0-beta.13] — 2026-09-12

The decisions of the issue round of 2026-09-12 (#147, #144, #150), the two reports that came in on
beta.12 (#156, #150), and the maintainer's wishes for the link dialog, the pairing and link buttons
and the RPC console.

### Fixed

- **A thermostat's fault report is a service message** (#150). The CCU WebUI lists
  "Kommunikationsstörung" for an HM-CC-RT-DN; that is `FAULT_REPORTING` on its thermostat channel,
  which the app dropped because it was not on its list of service-message datapoints. It is listed
  now, marked in the device grid, and shown with the CCU's own text for its value instead of a bare
  number. Like in the WebUI it cannot be acknowledged; it clears when the device reports
  `NO_FAULT`.
- **Refresh on the service messages tab no longer drops the other interfaces' messages** until
  their next event.
- **The Funk tab counts HmIP outages too.** The periodic status read of HmIP devices now feeds the
  unreach counter the way the BidCos poll does, so an outage that no event reported is counted as
  well. Nothing is acknowledged on HmIP; there is nothing to acknowledge there.
- **Umlauts in a link's name and description** (#156): "StandardverknÃ¼pfung" reads
  "Standardverknüpfung" again. rfd hands these two fields back as the UTF-8 bytes their writer sent,
  and the app read them as ISO-8859-1 like every other answer. They are now read again as UTF-8 —
  only when they really are UTF-8, so real ISO-8859-1 text such as `°C` stays as it is.

### Changed

- **The CCU addon uses fixed callback ports: 2031 for XML-RPC, 2032 for BIN-RPC** (#144). Until now
  every start took a free port from the kernel and so registered a new callback URL; the process
  behind VirtualDevices keeps its handlers by URL and does not drop the entry of an HMM that ended
  hard (kill, power loss), so each such start left one more entry. With a fixed port the next start
  overwrites its own. A taken port is logged once and replaced by a free one for that start. Ports
  set in the settings dialog always win and survive updates; `etc/hmm.env` can move the defaults, or
  set `0` for the old behaviour. On the CCU the callback servers listen on the loopback only. The
  desktop app, npm and Docker keep a free port.
- **Switching on the automatic acknowledgement asks about the messages already there** (#147). The
  option acknowledged a `STICKY_UNREACH` only at the moment it appeared while the app was running,
  so messages older than the tick — or older than the last restart — stayed in the list for good.
  Switching it on now asks once whether the `STICKY_UNREACH` messages already listed should be
  acknowledged as well, and says what that costs: the list no longer shows which devices were away,
  while the unreach counter in the Funk tab keeps it. "Acknowledge them" sends one acknowledgement
  per message after _Save & Restart_, the same write the acknowledge button does, with progress and
  errors in the RPC log; "only new ones" keeps today's behaviour. The label now reads "Acknowledge
  STICKY_UNREACH automatically as they occur".
- **"Saving and reconnecting…" stands out** (#149): a highlighted status with a spinner beside the
  buttons of the settings dialog, announced by screen readers, instead of grey text that was easy
  to miss.
- **The RPC console's response field uses the height of the window** instead of a fixed 220 px box;
  the history stays below it with a capped height, and a long method help scrolls on its own.
- **The service messages band counts the whole box** (#150): "4 of 7 on this box" while other
  interfaces have messages too. The list stays per interface, as the maintainer decided; a click on
  the total switches to the next interface that has messages, and its tooltip lists them. "First
  reported" from ReGa, the other half of that decision, is not in this release.
- **The "Create link" dialog is larger**: at least 650 px tall and 920 px wide, clamped to the
  window; its buttons wrap on a phone instead of running off the screen.
- **The link dialog's channel lists are easier to read**: each entry shows the channel's name, the
  device's name after it, and the channel index with its type on a second line
  (`3: VIRTUAL_SWITCH_TRANSMITTER`). The address is no longer printed; the filter still finds a
  channel by it.
- **"Pair device" and "Add link" are real buttons** (the maintainer's wish): larger than the toolbar
  icons, with the `+` and a caption ("Pair device" / "Gerät anlernen", "Add link" / "Verknüpfung
  anlegen"), in the accent colour at the start of the band. When the band runs out of room they
  shrink to their icon. "Pair device" is disabled on VirtualDevices and CUxD, which have no install
  mode; "Add link" is disabled where no channel can send.

### New

- **HmIP devices can be paired without their SGTIN**: the pairing dialog offers a third way, "Any
  device (no SGTIN)", next to "SGTIN and key" and "SGTIN only". It arms the interface for whatever
  device in factory state asks to join next, the way the CCU WebUI does it. The dialog says what each
  way needs — only "SGTIN and key" works without eQ-3's key server — and, when the window runs out
  with nothing paired, why that can happen (a device paired elsewhere sends no request).
- HmIP interfaces no longer receive BidCos's install-mode parameter as a third argument; hmipserver
  ignores the whole call when it gets one.

### Known issues

- "First reported" (the WebUI's "Erste Meldung") is still the time this app first saw a message,
  not the CCU's own time (#150).

## [3.0.0-beta.12] — 2026-09-11

The cause of #143, found in the reporter's own developer console, and the two small things the
beta.11 round left over. Fixes only, nothing new.

- **The device list of VirtualDevices is there** (#143, open since beta.5). His console had the
  answer: `(row(...).PARAMSETS ?? []).filter is not a function`, nine times, out of the grid's
  reactivity. The CCU's group process sends `PARAMSETS` as a plain string on his box, and
  `CHILDREN` as an empty string on every box; `?? []` catches null and undefined, not a string, so
  the grid threw while it drew. That is why the list stayed on "Loading Homematic Manager..." while
  the device count beside it said 31 — the two numbers came from different places, one of which had
  already crashed. Two causes were found and fixed before this one (the column filter in beta.7,
  the room and function filter in beta.9); they were real, and they were not what he was seeing.
  The list fields of a description — `CHILDREN`, `PARAMSETS`, `TEAM_CHANNELS` — are made into lists
  in the backend now, once, for every interface, and the grid uses the same helper where it
  iterates over them.

- **A tab that cannot be drawn says so** instead of leaving an empty page behind. One bad value used
  to take the whole page with it, and what a user saw was a loading text that never went away. A
  fault in a tab is now a sentence with the reason and a button to try again, one tab wide; the
  rest of the window keeps working.

- **"Save & Restart" says that it is working** (#149). It rebuilds the whole connection — on the
  reporter's CCU eleven seconds passed before the dialog closed, with nothing to show for it. It
  says "Saving and reconnecting…" while it runs. Saving itself was never broken, which is what he
  established: his settings had been saved all along.

### Changed

- **The metadata store is an entry of the interface picker with pages of its own** (the maintainer,
  2026-09-10: "mach ReGaHSS doch zu einem eigenen interface"). The store line under the host in the
  picker — `ReGaHSS`, `occulited`, "This profile" — is selectable now, like an interface: half the
  height of an interface item, with its dot and its state in the tooltip, reached by the arrow keys
  above the first interface, and marked as current when it is the selection. A store that does not
  answer is still shown, greyed, with the reason in its title. Selecting it loads nothing of the
  interfaces and shows the store's tabs instead of the device tabs; going back to an interface
  gives it the tab it had. The hash is `#/%23store/<tab>` and works as a bookmark.
- **ReGaHSS has two tabs, "Rooms" and "Functions"**: one row per room or function in the grid the
  device tab uses — name, devices, channels, the path in the address font — with add, rename,
  delete and refresh on the toolbar. Enter or a double click on a row renames it; a deletion
  asks first and lists what is still assigned there, then removes node and assignments in one
  revision. Refresh reads ReGaHSS again — it has no change stream, so a room made in the WebUI
  arrives here on request.
- **occulited has one tab, "Metadata"**: the whole tree. Every taxonomy is a row, its nodes sit
  under it to any depth with the depth drawn as indentation, and both levels are edited: a new
  taxonomy from a name, rename and delete of a taxonomy with everything in it, add, add below,
  rename, move (a dialog that picks the new parent) and delete of a node. The profile's own store
  is the same document model and gets the same tab. The editor is self-contained (`MetadataEditor`
  takes the trees, the objects, a translator and callbacks; the row building, indentation and
  move targets are plain functions in `lib/util/metaTree.ts`) so that occulited's own web UI can
  carry it over.
- **The "Rooms and functions" dialog of the device grid is gone**; its toolbar button opens the
  store's pages instead. The rooms and functions columns, the filters and "assign to room /
  function" of the device grid are unchanged.

### Known issues

- **#150 is half open**: the "Since" column survives a refresh since beta.11, but the service
  message list still differs from the CCU's. Three are missing on the reporter's box: two
  `STICKY_UNREACH` and one "Kommunikationsstörung" on a device channel rather than the maintenance
  channel. What settles it is the answer of `getServiceMessages` on his BidCos-RF, which the RPC
  console shows.
- Everything under beta.11's "Known issues" that is not named above still applies.

## [3.0.0-beta.11] — 2026-09-10

Two reports from Baxxy13 against beta.10 and one change the maintainer asked for. Fixes only,
nothing new.

- **RSSI values that cannot be a receive level are read for what they are** (#154). A level in dBm
  is always negative, and yet the grid showed `37 dBm`, elsewhere `-208` and `-128`. Three
  different things arrive in that field. eQ-3's placeholders: `65536` ("keine Informationen", as
  the WebUI's own API documents it), `0` and `1` for "nothing received in this direction since the
  start", `±256` and `-65536` in the same role. The radio chip's `128` / `-128` (`0x80`), which
  means "no RSSI available". And real levels that lost their sign or carry an offset of 256 on the
  way through ReGaHss, which creates the maintenance datapoints as an unsigned byte although the
  paramset says `INTEGER`. They are separated now: `130…255` is `value - 256`, `-255…-130` is
  `-value - 256`, a bare `2…126` is the level without its minus, and every placeholder becomes
  "no value" — the dash the grid already drew for `65536`. The reported `37 dBm` is -37 dBm, next
  to the -38 dBm of the other direction; a `-208` is -48 dBm. The mapping is the one Home
  Assistant's `aiohomematic` applies; OpenCCU's WebUI does the `- 256` half of it in its
  maintenance dialog. What no eQ-3 source confirms is the last rule, that a small positive value is
  only a missing minus — if a positive value ever turns up that is nonsense as a negative one, it
  belongs in the issue.

- **The Funk tab is back for HmIP** (#155). It was BidCos-RF's alone, on the assumption that HmIP
  has no RSSI matrix. It has: hmipserver answers no `rssiInfo`, but the levels sit in the
  maintenance channel as `RSSI_DEVICE` and `RSSI_PEER`, arrive as events, and the matrix behind the
  tab has been built from them all along — 2.x showed exactly that, and OpenCCU's WebUI assembles
  its HmIP list the same way. The tab is offered again, with the access point above and the level
  pair below, and without the parts that exist only on BidCos: `setBidcosInterface`, the receiver
  marker, the `INTERFACE` and `ROAMING` columns and "assign the best receiver".

### Changed

- **The store the names come from is said inside the interface picker** (the maintainer). It was a
  second control beside the picker — a dot and one word. It is now one line inside the picker,
  under the host it belongs to and above the interfaces, half the height of an interface item and
  separated by a rule: something to read, not to click. The settings, where the store is chosen,
  stay one click away on the gear.
- **The stores are called by their own names**: `occulited` instead of "openccu-lite" and `ReGaHSS`
  instead of "ReGa", in the picker and in the settings. Those are the programs; the other two are
  the products they are part of.

### Known issues

- Everything under beta.10's "Known issues" still applies: #143 is not fixed, #149 and #150 are
  half fixed and wait on the reporter, and "Since" of a service message is still the moment this
  app first saw it.

## [3.0.0-beta.10] — 2026-09-10

Six reports from the beta.9 testers, all of one day: Herbert-Testmann on the Funk tab (#151), the
service messages (#150), the settings dialog (#149) and the device grid on VirtualDevices (#143),
Baxxy13 on the interface table (#152) and on a firmware offer (#153). Fixes only, nothing new.

- **The Funk tab reads the levels again after a start** (#151). It decided whether to ask the
  interface for `rssiInfo` by looking at whether the list of BidCos interfaces was already there -
  and the Devices tab fills exactly that list on its own, because it needs the receivers' names for
  its own column. The Devices tab is drawn first, so the answer was always "already there", the
  matrix was never read, and the Funk grid showed every device with empty dBm columns until the
  user pressed Refresh. The gateway list and the matrix are now tracked apart, and the tab reads
  the matrix once per interface.

- **The Refresh button of the service messages keeps the "Since" column** (#150). The refresh threw
  away what was stored for the interface and rebuilt it from the fresh `getServiceMessages` answer,
  which stamped every row with the moment of the refresh - a message from last week suddenly read
  "today, 09:52". A message that is still there with the same value keeps the time it was first
  seen; only a changed value or a new message gets the current time.

- **The settings dialog says why a save failed** (#149). It is a modal dialog, which the browser
  draws in a layer above everything else - including the notices. A `config.set` that failed was
  therefore reported into a stack nobody could see: the button went grey for a moment and, from the
  outside, nothing happened at all. The reason now stands in the dialog itself, next to the
  buttons. And "Save & Restart" is only live when something was actually changed, so a click on an
  untouched dialog no longer looks like a button that does nothing.

- **A column label stands over its own column** (#152). Where the values are centred or
  right-aligned - CONNECTED, DEFAULT and DUTY_CYCLE in the interface table of the Funk tab, and
  every centred column of the other grids - the label stayed on the left, because a sortable label
  is a button and the button did not take the column's alignment. It does now.

- **Firmware `0.0.0` is not offered for installation** (#153). hmipserver reports
  `AVAILABLE_FIRMWARE` `0.0.0` for HmIP access points and for the CCU's own radio module - "none",
  not a version - and pairs it with the state that means "ready". The grid took both at face value
  and offered to install 0.0.0 over a working 4.4.18. `0.0.0` now counts as nothing on offer.

- **A device list that could not be read says so** (#143). When `listDevices` failed there was
  neither an index nor a request in flight, and the grid showed "Loading Homematic Manager..." for
  that state - for good. It now says that the list could not be read and points at Refresh. This is
  a diagnostic improvement, not the cause of #143: the empty grid on VirtualDevices is still open
  and the reporter has been asked for four details.

### Known issues

- **#143 is not fixed.** The grid stays empty for one reporter on VirtualDevices while the app
  counts 31 devices. Two causes were found and fixed before (the column filter in beta.7, the room
  and function filter in beta.9); what is left does not fit together yet - the device count and the
  count over the grid come from the same loaded list, so with no filter set the grid cannot be
  empty. Four questions are on the issue.
- **#149 and #150 are half fixed.** Why the save failed on the reporter's Mac is unknown - the
  dialog now shows the reason, which is what the next report needs. And the service message count
  differs from the CCU's: the list is per interface where the CCU WebUI merges them all, and
  whether two `STICKY_UNREACH` rows are missing depends on what `getServiceMessages` answers on
  that box, which has been asked for.
- **"Since" of a service message** is the moment this app first saw it, not the CCU's own first
  occurrence: after a restart of the app it is the restart's time. The CCU's own column comes from
  ReGa's bookkeeping, which the app does not read today.
- None of the six fixes has been on a CCU; they are guarded by unit and component tests and by the
  e2e suite against hm-simulator.
- Everything under beta.9's "Known issues" still applies.

## [3.0.0-beta.9] — 2026-09-09

Five reports from the beta.8 testers, all of one evening: Herbert-Testmann on the device grid on
VirtualDevices (#143), the tooltips (#145), the refresh button (#146) and a dot in the Funk grid
(#148), Baxxy13 on the callback registrations of the addon (#144). Fixes only, nothing new.

- **On the CCU the interface processes are told to call back on `127.0.0.1`** (#144). Running as
  the addon, the app registered its callback server under the box's LAN address - the one address
  that changes, while an `init` registration outlives the change in the interface process's
  handler list, and the one address that stands out in that list, where every other local
  subscriber is on the loopback. A callback address configured by hand still wins, and nothing
  changes for an installation that talks to a CCU over the network.

- **The tooltips of the toolbar buttons are the app's own** (#145). They were the browser's
  `title`, which means the browser decides how long the pointer has to rest: four to five seconds
  on the reporter's macOS against a few hundred milliseconds elsewhere - and on a **disabled**
  button there was no tooltip at all, because a disabled control dispatches no pointer events. The
  text that never appeared was therefore exactly the one that matters most: the reason a button is
  greyed out. A toolbar button now draws its own tooltip after 300 ms, at once when it is reached
  with the keyboard, on disabled buttons as well, positioned so no toolbar can clip it and closed
  by Escape, a click or the pointer leaving.

- **The room and the function filter belong to the interface they were set on** (#143). B-1 gave
  the column filters of a grid to their interface in 3.0.0-beta.7; the two selects above the
  device grid still outlived a switch, and they are applied to the rows before the table sees
  them, so not even the table's own "0 von 31" could report them. A grid narrowed to a room of
  BidCos-RF was therefore empty on VirtualDevices, whose groups are in no room - and the empty
  grid said the interface had reported nothing. Both are cleared with the interface now, and when
  a filter is what empties the grid the text says so. The filter a caller sets from outside (#25
  opens the Links tab narrowed to a channel) is cleared with the interface for the same reason.

- **The refresh button of the service-message tab reads the CCU again** (#146). It asked
  `serviceMessages.list`, which the backend answers out of its cache - that cache is filled by the
  events and by a poll every five minutes, so the button could not change anything about the list
  it was looking at. There is a `serviceMessages.refresh` now that makes the round trip
  (`getServiceMessages` per BidCos interface, the `:0` sweep on HmIP) and answers with the fresh
  list. Both refresh buttons - the Funk tab's as well - turn while they work and cannot be pressed
  twice, so an action that takes a moment is visible; the Funk one re-reads the device list too,
  because which receiver a device is configured for is part of its description.

- **The Funk grid no longer draws a dot behind every receiver marker** (#148). The marker column
  was 30 px wide for a 22 px button, so the cell overflowed and the browser abbreviated it with an
  ellipsis - of which one dot was visible, in every row of both marker columns. The track is now
  the marker plus the cell's padding (`--hmm-mark-size`, the arithmetic the picture column already
  used), and a cell of a fixed column - a picture, a glyph, a control, never running text - clips
  instead of abbreviating.

### Known issues

- The pile-up of `init` registrations in the VirtualDevices group process (#144) is only half
  addressed: the loopback address keeps the LAN address out of a registration that outlives it, but
  the callback port still defaults to `0`, so every start registers under a new port - and the
  group process does not drop a handler on `init(url, '')` (an eQ-3 defect the reporter documented),
  so the old entries stay. Fixed ports are configurable under settings → Callback; whether they
  become the default is an open decision.
- The automatic acknowledgement of `STICKY_UNREACH` (#147) fires on the edge of the unreach counter
  while the app runs - never for a message that was already in the list when the option was ticked,
  never after a restart, and never for an HmIP message that came from the `:0` sweep. Whether it
  should also clear what is already there is a product decision; nothing changed for it in this
  release.
- None of the five fixes has been on a CCU: the loopback address is guarded by a unit test, the
  filter, the tooltips and the marker by component tests, the refresh against hm-simulator.
- Everything under beta.8's "Known issues" still applies.

## [3.0.0-beta.8] — 2026-09-09

Two reports from Baxxy13 against the CCU addon on OpenCCU (#140, #141), both in the addon's
packaging scripts, the oldest open wish of the tracker (#69) in the Funk tab, and CCU-Jack
confirmed as a user-defined interface (#135).

- **Assign the best receiver** (#69). The Funk tab has a button next to `setBidcosInterface` that
  proposes, for every BidCos-RF device, the interface that receives it best - from the levels the
  interfaces last measured, as a list the user confirms and never as a write on its own. A device
  whose best interface clears the configured one by at least the margin (6 dB by default, the
  noise between two reads of the same link; changeable in the dialog) is ticked, one that is
  better by less is listed unticked and says so, one whose configured receiver has no level of it
  while another has is listed unticked as well; devices already on their best receiver, devices no
  interface has measured and devices that roam are a line of counts. Each ticked device is one
  `setBidcosInterface` with roaming off, in order, with a progress line; the device list and the
  levels are re-read afterwards, a refused write leaves the dialog open with the device still in
  it. With a single interface the button is off. Core's `proposeReceivers` is the pure part, with
  its own tests; the dialog is tested against the mock transport. Not tried against hardware with
  two receivers - the lab has none.
- **The Zusatzsoftware page shows the addon's umlauts as `GerÃ¤te`** (#140, `BUGS.md` B-3). The
  WebUI reads an addon's `rc.d/<name> info` lines through a Tcl pipe whose system encoding is
  Latin-1 on the CCU3 and OpenCCU alike and prints them into its Latin-1 page as they are, so the
  UTF-8 umlauts of the `Info:` line - and of the description in `hm_addons.cfg`, which the
  Systemsteuerung page renders the same way - came out as two characters each. Both now spell
  their umlauts as HTML entities (`Ger&auml;te`), which every encoding survives; the package test
  and the container test check that nothing outside ASCII is in either.
- **The WebUI now reports an addon update as finished** (#141, `BUGS.md` B-4). On OpenCCU the
  WebUI runs `/bin/install_addon` inside its own `cp_software.cgi` request and shows its
  "installation successful" popup only when that has returned. The addon's `update_script` ran
  `/etc/init.d/S50lighttpd restart` on every install - even an update whose proxy rule was byte
  for byte the same - and that restart cut the very connection the popup goes out on: the browser
  never heard back and the Zusatzsoftware dialog sat there until an F5. The rule is now compared
  with the installed one and lighttpd is left alone when nothing changed; when the rule is new or
  changed, lighttpd is told with `S50lighttpd reload` - a graceful restart on both firmwares
  (SIGUSR1 with `server.graceful-restart-bg` on OpenCCU, SIGHUP to lighttpd-angel on the CCU3
  firmware), so the running request finishes and the new rule is live at once - and where an init
  script has no `reload`, with a detached restart a few seconds later. The uninstall, which the
  WebUI runs the same way, does the same. The container test now runs lighttpd the way OpenCCU
  does (under lighttpd-angel, with its `S50lighttpd`) and drives the install and the uninstall
  through a stand-in for `cp_software.cgi`: against the beta.6 package every one of those requests
  died with an empty reply, against this one they are answered.

- **CCU-Jack as a user-defined interface works** (#135). Verified for the first time, against a
  CCU-Jack built from its `master` with two virtual devices and no CCU behind it: host, port 2121,
  XML-RPC, path `/RPC3` - `init` with the callback, the `newDevices` callback, the device list,
  paramset descriptions and values, `setValue` and the event it raises, `ping` and its `PONG`; the
  watchdog keeps the interface connected. No code changed for it; `docs/migration-from-2.x.md`
  names the five fields.

### Known issues

- Neither addon fix has been on a CCU yet: the encoding was reproduced from the WebUI's own `cp_software.cgi`
  and Tcl's system encoding on the lab boxes, the lost answer in the container with the real
  installer flow. The first update from beta.7 to the release that carries this still goes through
  beta.7's `update_script`, which is the old one - the popup appears from the update _after_ that.
- The best-receiver dialog has only met the mock transport: the lab has one BidCos-RF receiver
  per box, so no CCU with a LAN gateway has confirmed the proposals yet.
- Everything under beta.7's "Known issues" still applies.

## [3.0.0-beta.7] — 2026-09-08

Two reports from the first tester of beta.5 (NickHM, in the forum thread of the announcement and
then as #142 and #143), both about what the grids say - fixed the way 2.7 had it.

- **The receiver of a BidCos-RF device is named in the device grid and over its Funk columns**
  (#142, `BUGS.md` B-2). The device grid on BidCos-RF has an `INTERFACE` column that names the
  receiver a device is routed through - the CCU's own radio module, a LAN gateway - as
  `listBidcosInterfaces` describes it, and by serial when the gateway has no description; `⇄`
  behind it says roaming is on. The Funk grid has 2.7's second header row back: one cell per
  interface over its `← dBm` / `→ dBm` columns with the serial and, in small print, the
  description (the serials had been squeezed into every dBm label, where they were cut off), and
  next to the two levels the marker of the configured receiver - `◉` for the one the device is
  set to, `○` for the others; clicking a marker opens `setBidcosInterface` on that gateway. In
  that dialog the bold row is now the configured receiver; it was the one heard best, which is
  still named under the table. HmIP and Wired have no receivers and show none of this.
- **VirtualDevices: the grid lists what the header counts** (#143, `BUGS.md` B-1). A filter typed
  into a column of the device grid outlived the switch to another interface: the reporter's 31
  groups were counted in the popup, hidden by a filter typed for BidCos-RF addresses, and the
  empty grid said the interface had reported nothing. The column filters and the scroll position
  now belong to the interface they were typed for and are cleared on a switch, the device grid
  drops its selection with them, and while a filter hides rows the count says "Showing 0 of 31"
  and the grid says that no row matches, with a button to clear the filter - in every grid that
  has a filter row. The groups themselves were never the problem: 31 of them in the exact shape
  a CCU3 sends render in the component test, and one goes through the real XML-RPC path in the
  backend and e2e suites.

### Known issues

- The receiver names, the header row and the marker have met hm-simulator's one interface and the
  demo data; a CCU with a LAN gateway has not shown them yet. The VirtualDevices fix reproduces
  the reporter's screenshot in a test, not on his CCU.
- #140 (umlauts in the addon overview) and #141 (no feedback when an addon update has finished),
  both reported against the CCU addon on OpenCCU, are open and not in this release.
- Everything under beta.6's "Known issues" still applies.

## [3.0.0-beta.6] — 2026-09-08

Rooms and functions - in the grids, in a dialog, and on a CCU straight from ReGa - plus the
reworked HmIP service-message suppression, and the Docker cookie question answered.

- **Rooms and functions can be edited** (task 25, D-40). The device and channel grids gain a
  _Rooms_ and a _Functions_ column; select rows and use _Assign to room_ / _Assign to function_
  (toolbar or context menu) to put them into, or take them out of, a node - one write for the
  whole selection. A filter by room and by function sits above the grid; a floor - a room with
  rooms below it - matches everything under it. The new _Rooms and functions_ dialog adds,
  renames, moves and deletes nodes and lists what is still assigned before a non-empty node
  goes. Beside the interface mark a small indicator says where names and rooms come from (this
  profile, an openccu-lite box, or ReGa) and whether the store answers and takes writes; the
  settings dialog has a _Names and rooms_ section for the provider choice and the API token.
- **Rooms and functions on a CCU come from ReGa** (task 27). With ReGa switched on and no
  openccu-lite box, the rooms and functions are the CCU's own - read and written through ReGa's
  objects, so what is assigned here is what the WebUI shows, and the other way round. ReGa's
  rooms are a flat list: the dialog says so and offers no floors there. A ⟳ in the dialog reads
  the CCU's lists again (ReGa announces no changes by itself). `metaProvider` accepts `rega` to
  insist on it. Tried against a CCU3 (firmware 3.89.8) on 2026-09-08: create, rename, assign,
  read back, remove and delete all did what ReGa's own objects then showed; the roadmap archive
  has the run. Found there and fixed: the rooms and functions a CCU comes with are stored under
  translation keys (`roomKitchen`), which the WebUI translates on display - the list here now
  shows them the same way (German, or English when the profile's language is English).
- **The Docker image's cookie default is decided (D-41, OQ-15):** the image keeps
  `HMM_ISSUE_COOKIE=true`, and the host now prints one warning line at start whenever it hands
  the token cookie to every browser on a non-loopback bind - whoever reaches that port is in -
  with the three ways to lock it down. `HMM_ISSUE_COOKIE=false` silences it.

- **HmIP service-message suppression, reworked after the maintainer's look at beta.5.** The
  _Service messages_ box on top of the VALUES dialog is gone. Instead, the paramset dialog of
  channel 0 on an HmIP interface shows a _suppressed_ checkbox per service parameter inside the
  parameter table: in the MASTER dialog as rows of their own at the end (the parameters live in
  the VALUES paramset), in the VALUES dialog on the datapoints' own rows. A checkbox sends nothing;
  _Apply_ under the table opens the write preview with the exact `suppressServiceMessages`
  calls, one per changed checkbox, and sends them on confirmation. The service-messages tab has a
  _Suppress_ / _Unsuppress_ action per row on HmIP. The RPC console draws the argument form for
  `suppressServiceMessages` and `getSuppressedServiceMessages` once the interface lists them.
- **Removed: the "quiet mode" of the service-messages tab** (#102's bell button). It only muted
  the toast for a new message and was stored in the browser; Homematic has no such state for a
  service message, and the suppression above is what the interface really offers.

- **Fixed (found by the e2e suite before the tag):** with ReGa switched on but not answering the
  rooms-and-functions script - hm-simulator's ReGa, or a ReGa that runs no script - the automatic
  choice took ReGa as the store anyway, showed it as unreachable, and a rename never reached the
  CCU. `auto` now falls back to the profile's store after a failed first read (`metaProvider:
rega` still insists), and a rename goes through the name service for every object the ReGa store
  does not hold. And the _PARAMSETS_ column no longer shrinks with the window: the new _Rooms_ and
  _Functions_ columns had squeezed it until the VALUES button sat under the next cell.

### Known issues

- **Not seen on hardware yet:** the suppression checkboxes and the per-row action (task 26) have
  only met the demo transport - no real HmIP server has answered `getSuppressedServiceMessages`
  here - and `ROUTING_TABLE` has not been read from a real router. The rooms and functions dialog
  (task 25) was not clicked through against a CCU; the ReGa provider behind it was.
- **ReGa behind the CCU's firewall:** a desktop or Docker install reaches ReGa's port 8181 only
  from a network the CCU's firewall lists (`restricted` is the CCU's default for that port). The
  header's indicator then says ReGa did not answer, and rooms and functions stay in the profile.
- A `°` from `rfd` or CUxD over **BIN-RPC** still arrives as U+FFFD (`binrpc@4.2` decodes strings
  as UTF-8); addon and CUxD paths only.

## [3.0.0-beta.5] — 2026-09-08

The first beta that talks to the HmIP addendum, and a smaller change for a box.

- **HmIP service messages can be suppressed.** The VALUES dialog of a channel on an HmIP
  interface shows a _Service messages_ section: one checkbox per service datapoint (`UNREACH`,
  `LOWBAT`, the `ERROR*` family…), _Suppress all_ / _Unsuppress all_, backed by eQ-3's
  `getSuppressedServiceMessages` and `suppressServiceMessages`. A suppressed message is one
  whose parameter reports a value that raises none — the CCU shows it as inactive. An interface
  that does not offer the methods (BidCos, Homegear) shows nothing. Not yet tried against a
  real HmIP server; the demo transport has no such method.
- **An HmIP router's routing table, as a graph.** Opening `ROUTING_TABLE` on a device with the
  router module enabled draws the router in the middle, its neighbours and next hops on a ring,
  what is routed through them outside, hops and RSSI on the edges, static routes dashed, with the
  full table underneath. Read once when the dialog opens: every read goes to the device over the
  air. Not yet seen with a real router.
- **`127.0.0.1` is offered as a callback address.** On an openccu-lite box the interface
  processes bind the loopback only, so for the Homematic Manager running on the box it is the
  one address they can call back; it was never in the list. Appended last, so nothing that took
  the first candidate changes.
- **Fixed:** a name written to a metadata store may no longer contain control characters
  (openccu-lite refuses them; the store now says so before the box does).

## [3.0.0-beta.4] — 2026-09-06

- **Fixed:** stopping the backend did not wait for the metadata detection, so a store that
  finished loading afterwards could write a cache file back into a profile directory its owner had
  already deleted. Nothing a user would have seen, everything CI saw: three unrelated suites failed
  with `ENOTEMPTY` on 3.0.0-beta.3, whose npm package was therefore never published.

## [3.0.0-beta.3] — 2026-09-06

Rooms and functions, and openccu-lite (D-40, task 24).

- **Rooms, functions, floors — and any other taxonomy you make.** The Homematic Manager now keeps a
  taxonomy of its own in the profile (`meta.json`), so a user on Homegear, on a bare `rfd` or on
  the desktop has one for the first time. It is reachable through the API today; the grid column,
  the "assign to room" of a multi-selection and the tree dialog are task 25.
- **[openccu-lite](docs/openccu-lite.md) support.** On that CCU firmware without ReGaHSS, names,
  rooms and functions come from the box's metadata store and are **written back** to it: a rename
  in the grid, a new room, a channel moved into one. A change made anywhere else on the box is in
  the grid within a second, over the box's change stream. Which store is used is decided at
  runtime by one call (`GET /api/meta/v1/version`) on the host that is configured — a profile that
  moves between a CCU and a box needs no edit, and on a CCU nothing about ReGa changes (D-2).
- **The addon's login on openccu-lite** (`--auth-mode occulite`, the default there): the box's
  shell hands the addon the user's session, the addon checks it against the box and takes it from
  there; there is no second login page, because the users are the box's. Reads use the box's
  read-only local token, writes use that user's session — so a rename is attributed to a person.
  The ReGa login of D-32 on a CCU is untouched.
- Off the box (desktop, npm, Docker) the store needs an API token from the box's _Users_ page,
  pasted into the connection settings; without one the app runs on its own names and says so.
- New connection options: `metaProvider` (`auto`, `local`, `occulite`), `metaToken`, `metaUrl`.
- **Fixed:** a connection option added by a newer version was silently dropped when the profile was
  loaded or saved, because the connection is rebuilt field by field. Found while testing this.

## [3.0.0-beta.2] — 2026-09-06

The second public pre-release, cut from `master` (D-38). Everything of beta.0 plus:

- No "unknown method setReadyConfig" notices at start: the callback every interface process sends
  after `init` is known now, and a genuinely unknown method is reported once per session.
- The RPC log drawer takes half the window and can be dragged; the page itself never scrolls any
  more, only the grid inside a tab, and the header stays put (the app shell bounds itself to the
  viewport instead of trusting its mount element).
- The settings dialog is grouped into titled sections (connection, callback, interfaces, ReGa,
  behaviour) in a two-column form; version, device data and licence sit at its foot.
- A GitHub icon in the header opens the project page; the "?" menu and the About dialog are gone.
- beta.1 (not released): the two fixes above for the start-up notices and the drawer.

## [3.0.0-beta.0] — 2026-09-06

The first public pre-release of the rebuild, for testers: install with
`npm install -g homematic-manager@next`, the addon packages and the desktop installers from the
GitHub release, `ghcr.io/hobbyquaker/homematic-manager:3.0.0-beta.0`. Everything below is what
3.0.0 will contain; "Known issues" is what is still open at the beta.

**A complete rebuild.** The 2.7.1 code (Electron 4 from 2019, jQuery, free-jqgrid, no tests) was
replaced by a tested TypeScript core, a Svelte 5 user interface and a Node backend. The tabs, grids,
dialogs and workflows are deliberately the same as 2.7 — the implementation changed, not the design.
The 2.7.1 sources stay under `legacy/` for reference until 3.0 ships.

Development runs on `master` (D-38) with the `3.0.0-beta.n` counter. **3.0.0-beta.0 is a
published pre-release** (2026-09-06) with the desktop installers, the CCU addon packages and the
Docker image; the beta's npm package follows. What a 2.x user should read first is
[docs/migration-from-2.x.md](docs/migration-from-2.x.md).

### Delivery: four install types instead of one

2.x was a desktop app. 3.0 runs the same backend and the same UI in four places, sharing one
`config.json` format so a user can move between them:

- **CCU addon** for CCU3 firmware ≥ 3.61.5, ELV-Charly and OpenCCU, in three architectures
  (`armv7l`, `aarch64`, `x86_64`) — on the CCU itself, behind its own lighttpd, opened from
  _Systemsteuerung_, with no address to configure and no port to open.
- **Desktop app** for Windows 10+ (x64, arm64), macOS 12+ (universal — Apple Silicon, #139) and
  Linux glibc 2.31+ (x64, arm64) [#115].
- **npm package** with `--install`, which creates a system user, a hardened systemd unit and a state
  directory, with a Proxmox LXC as the recommended server deployment.
- **Docker image** for `amd64`, `arm64` and `arm/v7`.

**32-bit ARM desktop builds are gone**: Electron 44 publishes no `linux-armv7l` binary. Such a
machine runs the CCU addon or the npm package, both of which are plain Node [#115, #139].

The **npm package is `homematic-manager`** (D-33) — the name 2.x had on npm. `npm install -g
homematic-manager` used to give the 2.x desktop app and now gives the server; the desktop app is an
installer from the release. The 1.x versions under that name stay deprecated, and until 3.0.0 moves
the `latest` tag a pre-release has to be asked for by name: `npm install -g homematic-manager@next`.

### Safety: the paramset write path

This is the change with the largest consequence, and it comes out of a measurement on real hardware
(the study is [docs/config-pending.md](docs/config-pending.md)).

- **`putParamset` sends only changed, validated parameters**, and every write shows a preview of the
  exact `putParamset(address, paramset, struct)` call first, with a reason for every parameter that
  was dropped [#98].
- **Multi-apply is restricted to channels with an identical paramset description.** 2.x matched by
  channel _type_, and `MAINTENANCE` has 23, 21 or 9 MASTER parameters depending on the device.
  Channels that do not qualify are listed with the reason instead of being silently included [#98].
- **Every write is read back**, because `rfd` answers `ok` to writes it silently ignores (a `FLOAT`
  sent as a plain integer) or clamps (an `INTEGER` above `MAX`).
- **The two meanings of `CONFIG_PENDING` are distinguished**: a BidCos device with a queued
  configuration that will take it at its next wake-up, versus an HmIP channel that rejected
  something. Only the second gets a repair action.
- **`devices.repairConfig`** dry-runs first, lists the corrections it can make, offers the
  BidCos-only recoveries (`clearConfigCache`, `restoreConfigToDevice`, `determineParameter` — all of
  which answer `-1` on hmipserver) and says plainly when a channel is beyond repair and needs
  re-pairing.
- **ENUM values are sent as their index** everywhere. Both interface processes were measured to
  accept both encodings and to read back the index, so an enum no longer looks changed on every
  write.

### Devices

- The 2.7 grid with its channel sub-grid, device images, decoded flags, `RX_MODE` and `SUBTYPE`
  columns with the rules of 2.x (`SUBTYPE` on HmIP only, `RX_MODE` not on BidCos-Wired).
- The firmware column's update button really disappears when the update has arrived [#95, #113].
- Rename (device, `:0` and optionally every channel), delete with the two flag dropdowns, replace
  through `listReplaceableDevices`, `restoreConfigToDevice`, `clearConfigCache` and repair.
- `reportValueUsage` over a whole selection of channels [#18, PR #138].
- Naming a device right after it pairs [#24].
- BidCos install mode with mode, serial and **temporary key** [#20]; `searchDevices` on
  BidCos-Wired; HmIP with SGTIN and key or key server; a QR scanner that works more than once,
  loaded lazily and started only on request [#112]. The scanner says that it needs https instead
  of failing inside the decoder — a browser hands out no camera on a plain-http page.
- A link count per channel, and "create a link as sender / as receiver" straight from the channel
  sub-grid [#25].
- An **unreach counter per device**, edge-triggered and persisted per CCU, plus an opt-in automatic
  `STICKY_UNREACH` acknowledgement [#26].
- **Smoke-detector teams** on BidCos through `listTeams` / `setTeam` [#97]. HmIP smoke groups are
  built through the group process on `/groups`, outside the RPC catalogue, and are therefore out of
  scope by D-1.

### Paramset editor

- The control for each parameter is decided from the description alone, with the generated device
  metadata layered on top: display order, conditional visibility, option presets, cross-validation,
  labels, enum value names and help texts.
- "Not used" / "infinite" comes from the parameter's own `SPECIAL` entry instead of the hard-coded
  111600 s, which was the BidCos-RF value and wrong on BidCos-Wired (16383000 s) and elsewhere
  [#96].
- A `100%` unit is a fraction on the wire and a percentage on screen.
- `VALUES` has the per-datapoint `setValue` back.
- **Five device-specific editors** on a plug-in point above the generic form: the heating week
  programme (four naming shapes recognised from the description, including the 24-slot
  `TIMEOUT`/`TEMPERATUR` shape a Max! thermostat answers through Homegear) [#100], the HmIP
  switching programme, blind and shutter calibration in seconds beside the raw value, duration
  pickers for every base/factor and HmIP unit/value pair, and plain names for enum values the
  description only knows as numbers. A checkbox shows the raw parameters as well.

### Links

- The grid with both device images and the defective mark the WebUI uses [#79].
- Add through the role matrix, live as the sender selection changes.
- Remove a whole selection at once [#80].
- Play short and long on BidCos-RF only; `setLinkInfo` [#82].
- The link paramset editor with the easy-mode profiles of the receiver/sender pair, the sender's full
  option list with only the profile's _fixed_ parameters greyed out, an expert view that shows
  everything immediately [#105], and `UI_HINT` written on apply so the CCU's own WebUI does not call
  the link "expert".
- **Easy modes for every HmIP receiver** and for WINMATIC, from pinned openccu-data artifacts: 3521
  link profiles over 725 receiver/sender combinations [#50, #22].
- **A name and a description per pair** of a multi-link, instead of one name for the whole set
  [#87].
- **Link profile templates**: a tuned profile saved under a name and applied to another link of the
  same receiver/sender kind. Only templates whose paramset description is identical are offered,
  and applying one fills the form and writes nothing [#21].
- **Changes across several links (and paramsets) staged and written with one Apply** [#124]: a
  review dialog over the paced write queue with progress and cancel; a failed entry keeps its
  reason and stays in the set.

### Radio (RSSI)

- The gateway grid with a receive/send pair per gateway and a peer sub-grid.
- The HmIP matrix built from `RSSI_DEVICE`/`RSSI_PEER` events against the access point.
- "Heard best by" per device [#69].
- `setBidcosInterface` reads the assignment out of the device's own `INTERFACE` and re-reads it
  afterwards, so no interface is falsely marked active while roaming [#122].

### Service messages and events

- Acknowledge one or all — only `STICKY_UNREACH` and `SABOTAGE` can be acknowledged, and the button
  says so when it is off. Where ReGa is available the acknowledgement is also written there, so the
  CCU's own WebUI stops showing the message [#94].
- **Toasts and an RPC log drawer instead of the modal pop-up** [#77], with a persisted quiet mode
  [#102].
- The event view has two filter boxes, a pause that freezes the view, and a per-device counter,
  which is what makes it useful for duty-cycle hunting [#129].

### RPC console

- A generated argument form for the whole 51-method catalogue: struct rows for a paramset, checkboxes
  for a bit field, a select for a fixed value set, the interface's addresses as a datalist [#27].
- The exact tuple is printed above the form, so `device:channel` cannot be lost between the field and
  the call [#136].
- A history that refills the form, and the raw response including faults.

### Configuration and startup

- **The endless "loading"** on a slow or partly reachable CCU is gone: the interface manager has an
  init / ping watchdog / re-init handshake, and the port probe runs in the background and never
  blocks the UI [#121, #126, #134, #93].
- **2.7.1 not starting on Windows 10/11** is answered by the new Electron host [#132, #133]; macOS
  Sonoma likewise [#137].
- **A configuration change no longer restarts the app.** 2.x saved the file, called `app.relaunch()`
  and killed the process; the backend reconnects instead and the open tab survives.
- **Quitting waits for the backend** to de-register its callbacks at the interface processes, bounded
  to eight seconds, instead of racing a 15 s timer against `process.exit(0)`.
- CCU discovery over UDP as a button in the settings dialog.
- **User-defined extra interfaces** (name, host, port, protocol, path) with validation [#135, D-13];
  CUxD and VirtualDevices are configured explicitly instead of only being port-probed [#128].
- **ReGa is optional** [D-2]: a system without it works fully on locally stored names and shows a
  status indicator. A ReGa 401 no longer crashes the app [#127]. Where it is there it can also
  confirm new devices in the inbox [#54].
- **An interface whose port refuses backs off** from 15 seconds to five minutes with one notice per
  outage, is marked as not present in the header, and stops filling the log. BidCos-Wired is
  enabled in the default interface list and does exactly this on every system without a wired
  gateway.
- **The web host and the addon de-register from the interface processes while no browser is
  connected** and re-subscribe on the next page load (`init('')` after five minutes; D-31). Default
  on for the addon, the npm install and Docker, off in the desktop app, and configurable with
  `--idle-unsubscribe` / `HMM_IDLE_UNSUBSCRIBE`.
- Per-interface host, port, TLS and authentication [#106].
- **The CCU addon can ask for a CCU login** (D-32): the button in _Systemsteuerung_ opens the app
  directly as before, but a bookmark straight to `/addons/hmm/` gets a login page checked against
  the CCU's own users, with a session cookie, a logout, and five failed attempts a minute before
  the CCU is asked no further. Off by default, switched on from the addon's own settings page.
- Unhandled errors are always logged, not only when `showUnhandled` was set, and the dialog appears
  once rather than once per error.

### Interface, language and appearance

- **The whole UI is German and English**, with plurals and interpolation, switchable at runtime
  [#119, #29, #28, PR #130]. Turkish easy-mode strings are kept as a fallback locale.
- **Dark mode** follows the OS setting by default, with a manual switch that is remembered; every
  colour that carries meaning (RSSI classes, service-message severity, connection marks) is asserted
  in both themes.
- Cut, copy and paste work on Windows and Linux. 2.x built its Edit menu from macOS-only `selector:`
  strings, so those three items did nothing anywhere else.
- There is a View menu (reload, developer tools, zoom) and a Help menu with the issue tracker and the
  log folder.
- Device pictures come from the connected CCU with a local cache, and a small bundled webp subset
  answers for installations without one (Homegear, a bare `rfd`).

### Updates and releases

- The updater **downloads nothing and installs nothing without being asked**: it notifies, the user
  asks for the download, the user confirms install-on-quit. It can be switched off through
  `host.json` or `HMM_DISABLE_AUTO_UPDATE`. The "install update" exception is gone [#90].
- Every release artefact ships a **CycloneDX 1.6 SBOM** and a signed GitHub attestation, so
  `gh attestation verify` works offline against a downloaded file [D-27]. The SBOMs list the runtime
  that is not an npm dependency — Electron with its Chromium, Node and V8, the bundled Node and
  Alpine packages of the addon, the base image of the Docker build — so a CVE in one of them is
  searchable per release.
- Release notes are generated from the commits [#66].

### Removed

- **The "prefer BIN-RPC" option** and any protocol choice in the settings dialog. No CCU listens for
  BIN-RPC on the LAN: `rfd` and `hs485d` take it on the loopback (32001/32000) and the public ports
  2001/2000 are lighttpd's XML-RPC proxies. Off the CCU everything built-in is XML-RPC; BIN-RPC
  remains for the addon's local mode and for CUxD on 8701 [D-28].
- **Support for the HVL addon** — the project is dead [#123, D-19].
- **Homegear-specific code**, including the `setName` special case. Homegear keeps working through
  the generic XML-RPC path where it behaves like a CCU [#41, #59, #60, #100, #106, D-20].
- **32-bit ARM desktop builds** (see above).
- The 2015 easy-mode conversion, the bundled 34 MB of device images and the hand-maintained string
  table, all replaced by pinned openccu-data artifacts. No receiver type and no sender combination
  was lost; 832 of 837 shared profiles are parameter-identical, and 10 profiles, 1 parameter and 4
  fixed values differ because the CCU's own data moved on since 2015.

### Migration from 2.x

- On the very first start the 2.x configuration is imported **once** — CCU address, TLS,
  authentication, language, RPC pacing, RPC log folder and callback address — from
  `%APPDATA%\hm-manager\config`, `~/Library/Preferences/hm-manager/config` or `~/.hm-manager/config`.
  The 2.x caches are discarded on purpose, and 2.x itself is left untouched [D-17].
- Details, and everything that changed in behaviour, in
  [docs/migration-from-2.x.md](docs/migration-from-2.x.md).

### Licence

- The 3.0 code base is **AGPL-3.0-or-later**; 2.x was GPL-3.0. The 2.x sources under `legacy/` keep
  the contributions of others and stay **GPL-3.0-or-later**, which GPLv3 section 13 lets the AGPL
  work combine with. The generated device data under `data/dist/` is eQ-3 data and stays under the
  **Homematic Software License 2.0** — see [data/NOTICE.md](data/NOTICE.md) [D-26].

### Known issues

- A `°` from `rfd` or CUxD over **BIN-RPC** arrives as U+FFFD: `binrpc@4.2` decodes strings as UTF-8.
  This affects the CCU addon and CUxD, not the XML-RPC path; the fix is a one-line change upstream.
- The **Docker image issues its session cookie on a non-loopback bind** (`HMM_ISSUE_COOKIE=true`),
  so whoever reaches the published port is in. This is still an open question (OQ-15) and
  [docs/install-docker.md](docs/install-docker.md) names three ways to lock it down; the warning line
  the recommendation asks for is not implemented yet.
- The **beta.0 desktop build** shows harmless "unknown method setReadyConfig" notices at start and
  an RPC log drawer that lengthens the page; both are fixed on `master` (beta.1) and ship with the
  next tag.

### Not in this rebuild yet

Automatic best-interface assignment [#69 shows the information, it does not act on it]; HmIP
smoke-detector groups [#97 — they are built through the group process on `/groups`, outside the RPC
catalogue, and are out of scope by D-1]; CCU-Jack as a pre-defined interface [#135 — it serves
XML-RPC on `/RPC3` of port 2121, so a user-defined interface reaches it, but no CCU-Jack was
available to verify that against]; and the extended set of device-specific editors (universal light
effects, RGBW/dual-white, alarm panel, the ESI energy meter, door locks).

[3.0.0-beta.19]: https://github.com/hobbyquaker/homematic-manager/releases/tag/v3.0.0-beta.19
[3.0.0-beta.18]: https://github.com/hobbyquaker/homematic-manager/releases/tag/v3.0.0-beta.18
[3.0.0-beta.17]: https://github.com/hobbyquaker/homematic-manager/releases/tag/v3.0.0-beta.17
[3.0.0-beta.16]: https://github.com/hobbyquaker/homematic-manager/releases/tag/v3.0.0-beta.16
[3.0.0-beta.15]: https://github.com/hobbyquaker/homematic-manager/releases/tag/v3.0.0-beta.15
[3.0.0-beta.14]: https://github.com/hobbyquaker/homematic-manager/releases/tag/v3.0.0-beta.14
[3.0.0-beta.13]: https://github.com/hobbyquaker/homematic-manager/releases/tag/v3.0.0-beta.13
[3.0.0-beta.12]: https://github.com/hobbyquaker/homematic-manager/releases/tag/v3.0.0-beta.12
[3.0.0-beta.11]: https://github.com/hobbyquaker/homematic-manager/releases/tag/v3.0.0-beta.11
[3.0.0-beta.10]: https://github.com/hobbyquaker/homematic-manager/releases/tag/v3.0.0-beta.10
[3.0.0-beta.9]: https://github.com/hobbyquaker/homematic-manager/releases/tag/v3.0.0-beta.9
[3.0.0-beta.8]: https://github.com/hobbyquaker/homematic-manager/releases/tag/v3.0.0-beta.8
[3.0.0-beta.7]: https://github.com/hobbyquaker/homematic-manager/releases/tag/v3.0.0-beta.7
[3.0.0-beta.6]: https://github.com/hobbyquaker/homematic-manager/releases/tag/v3.0.0-beta.6
[3.0.0-beta.5]: https://github.com/hobbyquaker/homematic-manager/releases/tag/v3.0.0-beta.5
[3.0.0-beta.2]: https://github.com/hobbyquaker/homematic-manager/releases/tag/v3.0.0-beta.2
[3.0.0-beta.0]: https://github.com/hobbyquaker/homematic-manager/releases/tag/v3.0.0-beta.0
