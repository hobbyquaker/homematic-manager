# Homematic Manager as a desktop app

The direct successor of Homematic Manager 2.x: one application on your own machine, the backend
running inside it, nothing to install on the CCU and nothing listening on the network. This is the
install type to pick when you administer a CCU from a workstation now and then.

Contents: [Requirements](#requirements) · [Download](#download) ·
[Windows: the SmartScreen warning](#windows-the-smartscreen-warning) ·
[macOS: signing and notarisation](#macos-signing-and-notarisation) · [Linux](#linux) ·
[Where the app keeps its things](#where-the-app-keeps-its-things) · [Updates](#updates-d-16) ·
[The CCU's firewall](#the-ccus-firewall) · [Troubleshooting](#troubleshooting)

## Requirements

| OS | Minimum | Architectures |
| --- | --- | --- |
| Windows | 10 | x64, arm64 |
| macOS | 12 (Monterey) | universal (Intel and Apple Silicon in one build) |
| Linux | glibc 2.31 (Debian 11, Ubuntu 20.04) | x64, arm64 |

**32-bit ARM Linux is gone.** Issues #115 and #139 asked for it and 2.x had it, but Electron 44
publishes `linux-x64` and `linux-arm64` only — there is no `armv7l` binary to package any more. A
32-bit ARM machine runs the [CCU addon](install-addon.md) or the
[npm package](install-lxc.md) instead; both are plain Node.

> **3.0 is available as a beta.** The installers of [3.0.0-beta.0](https://github.com/hobbyquaker/homematic-manager/releases/tag/v3.0.0-beta.0) are on the release page
> as a pre-release: Windows setup and portable exe (x64, arm64), macOS universal dmg and zip, Linux
> AppImage and deb (x64, arm64), each with its `.cdx.json`. `build.yml` packages the same on every
> push to `master` and keeps the artifacts for 14 days. The packaged app passes its nine-assertion
> smoke test on all three platforms in CI; the beta.0 build still shows two startup findings that
> beta.1 fixed (harmless "unknown method setReadyConfig" notices, and an RPC log drawer that
> lengthens the page).

## Download

From the [latest release](https://github.com/hobbyquaker/homematic-manager/releases/latest):

| OS | File | Notes |
| --- | --- | --- |
| Windows | `Homematic Manager Setup <version>.exe` | NSIS installer, **per user** — no administrator needed, nothing outside your profile is written |
| Windows | `Homematic Manager-<version>-portable-<arch>.exe` | portable, installs nothing |
| macOS | `Homematic Manager-<version>-universal.dmg` | Intel and Apple Silicon |
| macOS | `Homematic Manager-<version>-universal-mac.zip` | the same app, zipped |
| Linux | `Homematic Manager-<version><-arch>.AppImage` | `chmod +x`, then run |
| Linux | `homematic-manager_<version>_<arch>.deb` | `sudo apt install ./homematic-manager_<version>_amd64.deb` |

Every installer has a CycloneDX 1.6 SBOM next to it (`<installer>.cdx.json`, D-27) that lists what
is really inside — including Electron, its Chromium, Node and V8 as separate components, so a CVE
feed can be searched for "chromium 152" rather than for "electron 44" — and both are signed as
GitHub artifact attestations:

```sh
gh attestation verify 'Homematic Manager-3.0.0.AppImage' --repo hobbyquaker/homematic-manager
```

## Windows: the SmartScreen warning

**The Windows builds are not code-signed yet.** Signing goes through
[SignPath](https://signpath.io/) once their open-source project application is accepted (D-9); the
step exists in both workflows, commented out, with the shape it will have.

Until then Windows shows **"Windows protected your PC"** on the first run of the installer and of
the portable build. The way past it:

1. click **More info** (_Weitere Informationen_),
2. then **Run anyway** (_Trotzdem ausführen_).

That is the whole workaround, and it is needed once per downloaded file. Check the
`gh attestation verify` above if you want more assurance than "it came from the releases page".

## macOS: signing and notarisation

The release and build workflows sign and notarise **when the Apple secrets are present**
(`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` and the certificate secrets). D-9 says a
Developer ID is the plan. Without those secrets the build still succeeds and produces **unsigned**
artifacts — which is also what a fork gets.

An unsigned build is opened **once** with right-click → **Open** (_Öffnen_) and confirming the
dialog; double-clicking it produces Gatekeeper's "cannot be opened because the developer cannot be
verified" instead.

Whether the release builds will be notarised depends on the Apple Developer membership; the workflow
is ready for it either way. Issue #137 (macOS Sonoma: 2.7.1 does not open) is answered by this build,
not by a 2.x fix.

## Linux

The AppImage needs nothing installed:

```sh
chmod +x 'Homematic Manager-3.0.0.AppImage'
./'Homematic Manager-3.0.0.AppImage'
```

The `.deb` registers a desktop entry:

```sh
sudo apt install ./homematic-manager_3.0.0_amd64.deb
```

Neither is signed by a distribution key; use the attestation above.

## Where the app keeps its things

Everything is under Electron's `userData` directory for the product name **Homematic Manager**:

| OS | Directory |
| --- | --- |
| Windows | `%APPDATA%\Homematic Manager` |
| macOS | `~/Library/Application Support/Homematic Manager` |
| Linux | `~/.config/Homematic Manager` (or `$XDG_CONFIG_HOME/Homematic Manager`) |

| Path | What it is |
| --- | --- |
| `config.json` | the profile: the CCU connection and nothing else — the same format every install type uses |
| `cache/<host>/*.json` | device descriptions, paramset descriptions, names, write log, one directory per CCU |
| `images/` | device pictures fetched from the CCU (D-10) |
| `logs/main.log` | unhandled errors of the main process, one generation rotated as `.log.1` |
| `window-state.json` | size, position and maximised state of the window |
| `host.json` | host settings; today only `disableAutoUpdate` |

Delete `cache/` to force a full re-read from the CCU; delete `config.json` to start over. **Nothing
outside this directory is written**, which is why the Windows installer is per-user and needs no
administrator.

Coming from 2.x, the configuration is imported once on the very first start — see
[migration-from-2.x.md](migration-from-2.x.md). Moving the profile to a server install or to the CCU
addon is [moving-between-installs.md](moving-between-installs.md).

## Updates (D-16)

`electron-updater` against the GitHub releases of this repository. **It never installs anything by
itself:**

1. it checks ten seconds after the app has settled, and then every six hours;
2. when a newer version exists it says so — and downloads nothing;
3. you ask for the download and watch the progress;
4. you confirm **install on quit**, and the update is installed the next time you quit the app.

`autoDownload` and `autoInstallOnAppQuit`, which `electron-updater` turns on by default, are both
off. The updater is disabled entirely in development and in any unpackaged build.

To switch it off for good:

```jsonc
// <userData>/host.json
{"disableAutoUpdate": true}
```

or set the environment variable `HMM_DISABLE_AUTO_UPDATE=1`, which needs no writable profile — the
form a distribution package or a Nix expression that ships its own update channel wants.

Releases are created as **drafts** and published by the maintainer, because `electron-updater` polls
the latest *published* release: publishing one whose installers are still uploading would offer every
running app an update it cannot download.

## The CCU's firewall

The desktop app talks XML-RPC to the CCU (D-28: BIN-RPC exists on a CCU's loopback only) and the
interface processes push their events **back** to the app, so both directions have to work.

In the CCU's WebUI, `Settings → Control panel → Security → Firewall`:

- **XML-RPC API**: `Restricted access` with this machine's address in the list, or `Full access` on
  a trusted LAN. Without it the interface processes refuse the connection.
- **Remote Homematic-Script API**: the same, *if* ReGa should supply the friendly names. ReGa is
  optional (D-2) — without it the app works fully and uses locally stored names, with a status
  indicator saying so.

The event direction needs nothing opened on the CCU: the CCU connects *out* to the app. What it does
need is that **your machine is reachable from the CCU** — a local firewall on the workstation has to
let the callback ports through. By default they are picked freely at start; the settings dialog can
pin them, and it offers this machine's addresses as callback-address candidates.

## Troubleshooting

| Symptom | Look at |
| --- | --- |
| "Windows protected your PC" on the installer | Expected until the Windows signing is in place; **More info → Run anyway**. See [above](#windows-the-smartscreen-warning). |
| macOS: "cannot be opened because the developer cannot be verified" | Unsigned build; right-click → **Open** once. |
| The app starts but no device list appears | The CCU's XML-RPC API firewall setting, or the wrong address. The settings dialog has a discovery button (UDP broadcast) that finds CCUs on the same subnet. |
| Interfaces show as connected, but nothing ever updates | The callback. The CCU could reach the app but not the other way round: check the local firewall, and pin the callback address in the settings dialog if this machine has several. |
| Names are missing, a ReGa indicator is red | ReGa is optional (D-2): the app carries on with local names. Enable "Remote Homematic-Script API" in the CCU's firewall to get the CCU's names back. |
| `BidCos-Wired` shows as "not present" | `hs485d` runs only on a CCU that has a wired gateway. The app notices the refused port, says so once and stops retrying every 15 s. Untick BidCos-Wired in the settings dialog to hide it. |
| Device pictures are missing | They are fetched from the CCU (D-10). Without a reachable CCU a small bundled set answers instead; with TLS the CCU's self-signed certificate cannot be accepted by the fetch, so the bundled picture is used. |
| Something crashed | `logs/main.log` in the profile directory above; the Help menu opens the folder. |

## See also

- [moving-between-installs.md](moving-between-installs.md) — taking the profile to a server or the CCU
- [migration-from-2.x.md](migration-from-2.x.md) — what changed against 2.7
- [../apps/electron/README.md](../apps/electron/README.md) — how the app is built, signed and packaged
- [../BUILD.md](../BUILD.md) — building the installers yourself
