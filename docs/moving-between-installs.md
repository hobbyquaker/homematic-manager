# Moving between install types

All four install types of D-25 — the [CCU addon](install-addon.md), the
[desktop app](install-electron.md), the [npm/systemd server](install-lxc.md) and the
[Docker image](install-docker.md) — run the same backend and the same UI, and they keep their state
in **one profile format**. Moving from one to another is copying a single file.

## The profile directory

Everything a running Homematic Manager owns lives in one directory, and every install type differs
only in where that directory is:

| Install type | Profile directory | Set by |
| --- | --- | --- |
| CCU addon | `/usr/local/hmm/` | fixed by the addon (`--data-dir`), outside the addon tree so it survives update and uninstall |
| Desktop app, Windows | `%APPDATA%\Homematic Manager\` | Electron's `userData` |
| Desktop app, macOS | `~/Library/Application Support/Homematic Manager/` | Electron's `userData` |
| Desktop app, Linux | `~/.config/Homematic Manager/` (or `$XDG_CONFIG_HOME/…`) | Electron's `userData` |
| npm with `--install` | `/var/lib/homematic-manager/` | systemd `StateDirectory=` |
| npm run by hand | `~/.config/homematic-manager/` | `--data-dir` / `HMM_DATA_DIR` default |
| Docker | `/data/` in the container (a volume or bind mount) | `HMM_DATA_DIR=/data` in the image |

Inside it:

| Path | What | Portable? |
| --- | --- | --- |
| `config.json` | the profile: CCU address, interfaces, TLS, auth, ReGa, callback, language, write pace, RPC log folder, user-defined interfaces | **yes**, with the exceptions below |
| `cache/<host>/devices.json` | device descriptions per interface | yes, but pointless — it is re-read from the CCU in seconds |
| `cache/<host>/descriptions.json` | paramset descriptions, keyed by description identity | same |
| `cache/<host>/names.json` | local names and the ReGa object ids | **worth copying** if you renamed devices locally without ReGa |
| `cache/<host>/write-log.json` | the write log of the session | yes, if you want the history |
| `link-templates.json` | the saved link profile templates (#21) | **yes** — they are your own work |
| `images/` | device pictures fetched from the CCU | no need — they are fetched again |
| `token` (addon only) | the API token | **no**, see below |

RSSI, service messages and the event ring are not persisted at all: each is a snapshot of the
radio's current state, and a stale one is worse than none.

## Copying it

Stop both sides first — two backends against the same interface processes fight over the callbacks.

```sh
# desktop app (Linux) -> a server install
sudo systemctl stop homematic-manager
sudo install -o homematic-manager -g homematic-manager -m 600 \
    ~/.config/'Homematic Manager'/config.json /var/lib/homematic-manager/config.json
sudo systemctl start homematic-manager
```

```sh
# a server install -> the CCU addon
/usr/local/etc/config/rc.d/hmm stop
scp /var/lib/homematic-manager/config.json root@ccu:/usr/local/hmm/config.json
ssh root@ccu /usr/local/etc/config/rc.d/hmm start
```

```sh
# anything -> Docker
docker stop homematic-manager
docker cp config.json homematic-manager:/data/config.json
docker start homematic-manager
```

The file is plain JSON and is read at start. There is no import step and no version dance: the
`version` field in it is the version that wrote it, and an older one is read as it is.

## What does not travel

Four things are about *where* the program runs, not about *what* it manages. Copy the file, then fix
these in the settings dialog of the new installation (or before copying, in an editor):

1. **The token is not in `config.json` and is not portable.** Each install type gets its own:
   - the addon generates one at install time into `/usr/local/hmm/token` (mode 600) and hands it to
     the browser through `settings.cgi` after checking the WebUI session;
   - the npm installer generates one into `/etc/homematic-manager/config.env` and **prints it once**
     at install;
   - Docker takes `HMM_TOKEN`, or issues a cookie to whoever loads the page
     (`HMM_ISSUE_COOKIE=true` in the image — see [install-docker.md](install-docker.md));
   - the desktop app has no token at all: its UI talks to the backend over Electron IPC, not over a
     socket.

   Never copy a token between installations, and do not put one into `config.json` — it does not
   belong there.

2. **`connection.callback.ip`** is the address the CCU's interface processes are told to push events
   to. It is the address of the *machine that runs the app*, so it is wrong the moment the app moves.
   Clear it (the backend then finds the address itself and the settings dialog offers the
   candidates), except where the host cannot see its own reachable address — a bridge-networked
   container, where `HMM_CALLBACK_IP` is what fixes it.

   `connection.callback.xmlrpcPort` and `.binrpcPort` are `0` by default, which means "pick a free
   port". Only pin them when a firewall rule or a container port mapping needs fixed numbers.

3. **`connection.local`** is the addon's flag: "we run on the CCU itself, talk to the interface
   processes on the loopback past lighttpd". It is set by the addon's command line, not by the
   settings dialog, and it must be false everywhere else. If you copy a profile *off* the CCU, make
   sure `local` is not left true and that `host` is the CCU's LAN address rather than `127.0.0.1`.

4. **`connection.rpcLogFolder`** is a path on the old machine. Either clear it or point it somewhere
   that exists on the new one.

Two more things that are not settings but are worth knowing:

- **`cache/<host>/`** is keyed by the CCU host string. Change the address (from `ccu3.local` to an
  IP, or from `127.0.0.1` on the addon to the LAN name) and the new installation starts with an
  empty cache and re-reads everything. That is correct behaviour, not a fault.
- **`localAddresses` and `discovered`** in `config.json` are runtime findings — the machine's own
  addresses and the CCUs a UDP discovery answered from. They are rewritten at start; there is no
  point in curating them.

## Running two installations at once

You can, but not against the same CCU at the same time for long. Every interface process accepts a
list of event subscribers, and each `init` from a second manager with the same identifier replaces
the first one's registration. Two Homematic Managers against one CCU will take the event stream from
each other in turn, and both will look half-alive.

For a migration that means: stop the old one, then start the new one. If you want to keep the old
installation around as a fallback, leave it stopped rather than running.

The one combination that is fine is a **desktop app and a CCU addon that are not used at the same
time** — the addon talks to the loopback and the desktop app to the LAN, so their registrations are
distinct, but the same rule about who currently owns the event stream applies while both run.

## Reverse-proxy setups

Nothing in `config.json` knows about a reverse proxy: the base path, the bind address, the token and
the cookie policy are host options (`--base`, `--host`, `--token`, `--issue-cookie` and their `HMM_*`
mirrors), not profile content. Moving a profile therefore never breaks a proxy setup and never
carries one along. The working examples are
[lighttpd](lighttpd-homematic-manager.conf), [nginx](nginx-homematic-manager.conf) and
[Caddy](Caddyfile-homematic-manager).

## See also

- [install-addon.md](install-addon.md) · [install-electron.md](install-electron.md) ·
  [install-lxc.md](install-lxc.md) · [install-docker.md](install-docker.md)
- [migration-from-2.x.md](migration-from-2.x.md) — coming from 2.x, which is a different move: 2.x's
  configuration is imported once, automatically, and its caches are discarded
