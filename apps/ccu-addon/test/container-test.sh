#!/usr/bin/env bash
#
# Replays the firmware's addon installation in a container and drives the installed addon through a
# real lighttpd, the way ccu-addon-howto/docs/08-testing.md describes it: install, update,
# uninstall, the WebUI session check, the proxy rule and - the one that decides whether this addon
# can work at all - a WebSocket upgrade through lighttpd (D-25, D-28). The install and the
# uninstall go the way the WebUI drives them: from inside a request of that same lighttpd, which
# is running under lighttpd-angel with OpenCCU's S50lighttpd, and the answer has to come back
# (#141).
#
#   apps/ccu-addon/test/container-test.sh [package.tar.gz] [--idle]
#
# Without an argument the newest x86_64 package in out/ is used; it has to be the x86_64 one,
# because this actually runs the bundled node. `--idle` adds the slow check: a WebSocket left quiet
# for 70 seconds, past lighttpd's 60 second `server.max-read-idle`, which only survives because the
# host pings it every 25 s.
#
# Needs docker. Nothing else, and no CCU.

set -uo pipefail

PKG=""
IDLE=0
for argument in "$@"; do
    case "$argument" in
        --idle) IDLE=1 ;;
        # absolute before the cd below, so a path relative to the caller's directory keeps working
        *) PKG="$(cd "$(dirname "$argument")" && pwd)/$(basename "$argument")" ;;
    esac
done

cd "$(dirname "$0")/.." || exit 1
ADDON_SRC="$PWD"

if [ -z "$PKG" ]; then
    PKG="$(ls -t "$ADDON_SRC"/out/hmm-ccu-x86_64-*.tar.gz 2>/dev/null | head -1)"
fi
[ -n "$PKG" ] && [ -f "$PKG" ] || {
    echo "usage: $0 [package.tar.gz] [--idle]" >&2
    echo "       build one first: apps/ccu-addon/build.sh x86_64" >&2
    exit 1
}
PKG="$(cd "$(dirname "$PKG")" && pwd)/$(basename "$PKG")"
command -v docker >/dev/null || {
    echo "docker is required" >&2
    exit 1
}

IMAGE=hmm-addon-test
NAME="hmm-addon-test-$$"
SID=abcdefgh12

failed=0
pass() { echo "  ok   - $1"; }
fail() {
    echo "  FAIL - $1"
    echo "         $2"
    failed=1
}
check() {
    # check <description> <expected substring> <actual>
    case "$3" in
        *"$2"*) pass "$1" ;;
        *) fail "$1" "$3" ;;
    esac
}
absent() {
    case "$3" in
        *"$2"*) fail "$1" "$3" ;;
        *) pass "$1" ;;
    esac
}
none() {
    # none <description> <actual>: passes when there is nothing
    if [ -z "$(printf '%s' "$2" | tr -d ' \n')" ]; then
        pass "$1"
    else
        fail "$1" "$2"
    fi
}

dex() { docker exec "$NAME" sh -c "$1" 2>&1; }

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1; }
trap cleanup EXIT

echo "building the test image"
docker build -q -t "$IMAGE" "$ADDON_SRC/test" >/dev/null || {
    echo "docker build failed" >&2
    exit 1
}

docker run -d --init --name "$NAME" -v "$PKG:/dist/$(basename "$PKG"):ro" \
    -v "$ADDON_SRC/test/ws-probe.mjs:/opt/ws-probe.mjs:ro" \
    -v "$ADDON_SRC/test/ccu-auth-stub.mjs:/opt/ccu-auth-stub.mjs:ro" \
    -v "$ADDON_SRC/test/occulite-stub.mjs:/opt/occulite-stub.mjs:ro" "$IMAGE" >/dev/null

# the stub ReGa treats this session id as live
dex "printf '%s\n' $SID > /tmp/valid-sids" >/dev/null
# a syslog, so the addon scripts' logger lines can be read back (B-32)
docker exec -d "$NAME" busybox syslogd -n -O /tmp/messages
syslog() { dex 'cat /tmp/messages 2>/dev/null'; }

# The package where the WebUI's upload puts it, then the firmware's installer - by hand, the way
# the CCU3 firmware's S00InstallAddon and a self-updater run it ...
install_addon() {
    dex "cp /dist/$(basename "$PKG") /usr/local/tmp/new_addon.tar.gz && /bin/install_addon; echo \"exit \$?\""
}
# ... and through the WebUI, which execs it inside its own cp_software.cgi request and answers
# only when it has returned. The answer is the whole point: an addon that restarts lighttpd on
# the way leaves the browser without one, and the WebUI in its dialog until an F5 (#141).
webui() {
    # webui <install|uninstall>
    if [ "$1" = install ]; then
        dex "cp /dist/$(basename "$PKG") /usr/local/tmp/new_addon.tar.gz" >/dev/null
    fi
    dex "curl -s --max-time 600 -w ' curl=%{exitcode}' 'http://127.0.0.1/config/webui-install.cgi?cmd=$1'"
}
# what the init script was asked to do since the last look
lighttpd_actions() { dex 'cat /tmp/S50lighttpd.log 2>/dev/null; : > /tmp/S50lighttpd.log' | tr '\n' ' '; }

echo
echo "the CCU's lighttpd, up before anything is installed"
dex '/etc/init.d/S50lighttpd start' >/dev/null
sleep 1
check "lighttpd runs under lighttpd-angel, started by S50lighttpd" "OK" "$(dex 'test -f /run/lighttpd.pid && test -f /run/lighttpd-angel.pid && echo OK')"
LIGHTTPD_PID="$(dex 'cat /run/lighttpd.pid')"
check "and the WebUI stand-in answers through it" "unknown command" "$(dex "curl -s http://127.0.0.1/config/webui-install.cgi")"
lighttpd_actions >/dev/null

echo
echo "fresh install, through the WebUI"
out="$(webui install)"
check "the WebUI's request is answered - with update_script's 10, a fresh install (#141)" "installed rc=10 curl=0" "$out"
check "lighttpd was told about the new rule with a reload, not a restart" "reload" "$(lighttpd_actions)"
check "and is the same server as before" "$LIGHTTPD_PID" "$(dex 'cat /run/lighttpd.pid')"
check "the rc.d link exists" "/usr/local/addons/hmm/rc.d/hmm" "$(dex 'readlink /usr/local/etc/config/rc.d/hmm')"
check "the www symlink exists" "/usr/local/addons/hmm/www" "$(dex 'readlink /usr/local/etc/config/addons/www/hmm')"
check "the Systemsteuerung entry was written" "/addons/hmm/settings.cgi" "$(dex 'cat /usr/local/etc/config/hm_addons.cfg')"
check "the lighttpd rule was installed with the port" '"port" => 8090' "$(dex 'cat /usr/local/etc/config/lighttpd/hmm.conf')"
check "the token is root-only" "600" "$(dex 'stat -c %a /usr/local/hmm/token')"
check "the profile directory is root-only" "700" "$(dex 'stat -c %a /usr/local/hmm')"
check "the image cache is excluded from the backup" "OK" "$(dex 'test -f /usr/local/hmm/images/.nobackup && echo OK')"
check "the service was started by the live install" "running" "$(dex '/usr/local/etc/config/rc.d/hmm status')"
# not /var/run: the CCU3 builds a chroot for the install that binds /usr/local but not /var/run,
# so a pidfile there is invisible to update_script exactly when it matters (lab, 2026-09-05)
check "the pidfile is inside the addon tree, where the CCU3 install chroot can see it" "OK" \
    "$(dex 'test -s /usr/local/addons/hmm/var/hmm.pid && echo OK')"
absent "and nothing was written to /var/run" "hmm.pid" "$(dex 'ls /var/run 2>/dev/null')"
# task 43: the backend's output goes to /var/log/hmm.log by default - the CCU's tmpfs, not the SD card
for _ in 1 2 3 4 5 6 7 8 9 10; do
    dex 'grep -q "callback: default ports" /var/log/hmm.log' >/dev/null && break
    sleep 1
done
check "the backend's start line is in /var/log/hmm.log, the default (task 43)" "homematic-manager-web" \
    "$(dex 'cat /var/log/hmm.log')"
check "and there is no var/hmm.log in the addon directory" "gone" \
    "$(dex 'test -e /usr/local/addons/hmm/var/hmm.log || echo gone')"
# task 35: the fixed callback ports travel from rc.d's environment into the host
check "the host takes the addon's fixed callback ports while config.json says 0 (task 35)" \
    "default ports xmlrpc=2031 binrpc=2032" "$(dex 'cat /var/log/hmm.log')"
# B-32 (task 44): node runs with the default flags of the installed rc.d script, passed before the app.
# beta.16's default was --lite-mode, which switches off the WebAssembly node's fetch runs on.
cmdline_of_backend() { dex "tr '\\0' ' ' < /proc/\$(cat /usr/local/addons/hmm/var/hmm.pid)/cmdline"; }
# the literal default only, not the line that filters it (HMM_NODE_FLAGS="$(NodeFlags ...)")
NODE_FLAGS="$(dex "sed -n 's/^    HMM_NODE_FLAGS=\"\\([^\$]*\\)\"\$/\\1/p' /usr/local/addons/hmm/rc.d/hmm")"
EXPECTED_CMDLINE="/usr/local/addons/hmm/bin/node ${NODE_FLAGS:+$NODE_FLAGS }/usr/local/addons/hmm/app/dist/cli.js"
check "the backend runs with the default node flags as shipped: '$NODE_FLAGS' (B-32)" "$EXPECTED_CMDLINE" \
    "$(cmdline_of_backend)"
absent "and without --lite-mode" "--lite-mode" "$(cmdline_of_backend)"
absent "or --jitless" "--jitless" "$(cmdline_of_backend)"
out="$(dex "cp /usr/local/addons/hmm/etc/hmm.env /tmp/hmm.env.t44 && echo 'HMM_NODE_FLAGS=' >> /usr/local/addons/hmm/etc/hmm.env && /usr/local/etc/config/rc.d/hmm restart; echo \"exit \$?\"")"
check "HMM_NODE_FLAGS= in etc/hmm.env: the restart says OK" "Starting hmm: OK" "$out"
check "and node runs without flags" "/usr/local/addons/hmm/bin/node /usr/local/addons/hmm/app/dist/cli.js" \
    "$(cmdline_of_backend)"
out="$(dex 'cp /tmp/hmm.env.t44 /usr/local/addons/hmm/etc/hmm.env && /usr/local/etc/config/rc.d/hmm restart; echo "exit $?"')"
check "and without the line the default flags are back after a restart" "$EXPECTED_CMDLINE" "$(cmdline_of_backend)"
check "which says OK" "Starting hmm: OK" "$out"

echo
echo "the backend's fetch, against a stub openccu-lite box, with the addon started as shipped (B-32)"
# In occulite mode the backend lets a session in only after it fetched /api/meta/v1/enums and
# /api/auth/v1/state from the box. beta.16's --lite-mode made every such fetch fail ("fetch failed",
# cause "WebAssembly is not defined"), and the addon could not be opened on openccu-lite at all.
# wait_for_backend: until the (re)started backend answers on its own port
wait_for_backend() {
    for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
        dex 'curl -s -o /dev/null http://127.0.0.1:8090/addons/hmm/' >/dev/null && break
        sleep 1
    done
}
dex 'cp /opt/occulite-stub.mjs /usr/local/addons/hmm/app/occulite-stub.mjs' >/dev/null
docker exec -d "$NAME" sh -c \
    "HMM_STUB_SID=$SID /usr/local/addons/hmm/bin/node /usr/local/addons/hmm/app/occulite-stub.mjs >/tmp/occulite-stub.log 2>&1"
for _ in 1 2 3 4 5 6 7 8 9 10; do
    dex 'grep -q "occulite stub on" /tmp/occulite-stub.log' >/dev/null && break
    sleep 1
done
check "the stub box is up" "occulite stub on 127.0.0.1:18181" "$(dex 'cat /tmp/occulite-stub.log')"
out="$(dex 'cp /usr/local/addons/hmm/etc/hmm.env /tmp/hmm.env.b32 \
    && printf "HMM_AUTH_MODE=occulite\nHMM_OCCULITE_URL=http://127.0.0.1:18181\n" >> /usr/local/addons/hmm/etc/hmm.env \
    && /usr/local/etc/config/rc.d/hmm restart; echo "exit $?"')"
check "the addon restarts in occulite mode against the stub" "Starting hmm: OK" "$out"
wait_for_backend
check "still with the default node flags" "$EXPECTED_CMDLINE" "$(cmdline_of_backend)"
out="$(dex "curl -si 'http://127.0.0.1/addons/hmm/?sid=%40${SID}%40'")"
check "a session the box confirms is let in, through lighttpd: back to the UI" "Location: /addons/hmm/" "$out"
check "with a session cookie of the addon" "Set-Cookie: hmm_session=" "$out"
check "because the backend's fetch reached the box" "occulite stub: GET /api/meta/v1/enums live" \
    "$(dex 'cat /tmp/occulite-stub.log')"
out="$(dex "curl -si -H 'X-Occulite-Session: $SID' http://127.0.0.1:8090/addons/hmm/")"
check "the gate's X-Occulite-Session is let in too" "200 OK" "$out"
check "with the application shell" 'id="app"' "$out"
check "after the box confirmed it on /api/auth/v1/state" "occulite stub: GET /api/auth/v1/state live" \
    "$(dex 'cat /tmp/occulite-stub.log')"
out="$(dex "curl -si 'http://127.0.0.1/addons/hmm/?sid=%400000000000%40'")"
check "a session the box does not know goes back to the box" "Location: /" "$out"
absent "and gets no cookie" "hmm_session=" "$out"
absent "no fetch failed anywhere in the backend's log" "fetch failed" "$(dex 'cat /var/log/hmm.log')"
# an explicit --lite-mode, as beta.16's README showed it, does not reach node
out="$(dex "echo 'HMM_NODE_FLAGS=\"--lite-mode --max-old-space-size=300\"' >> /usr/local/addons/hmm/etc/hmm.env \
    && /usr/local/etc/config/rc.d/hmm restart; echo \"exit \$?\"")"
check "HMM_NODE_FLAGS=\"--lite-mode --max-old-space-size=300\" in etc/hmm.env: the restart says OK" "Starting hmm: OK" "$out"
wait_for_backend
check "node gets the user's other flag and not --lite-mode" \
    "/usr/local/addons/hmm/bin/node --max-old-space-size=300 /usr/local/addons/hmm/app/dist/cli.js" "$(cmdline_of_backend)"
check "and the start says so in the syslog" "HMM_NODE_FLAGS: dropped --lite-mode" "$(syslog)"
out="$(dex "curl -si 'http://127.0.0.1/addons/hmm/?sid=%40${SID}%40'")"
check "the login still works" "Location: /addons/hmm/" "$out"
absent "and still no fetch failed" "fetch failed" "$(dex 'cat /var/log/hmm.log')"
out="$(dex 'cp /tmp/hmm.env.b32 /usr/local/addons/hmm/etc/hmm.env && /usr/local/etc/config/rc.d/hmm restart; echo "exit $?"')"
check "back to token mode and the default flags" "Starting hmm: OK" "$out"
wait_for_backend

echo
echo "a start that starts nothing says so (B-25)"
# On openccu-lite the unit runs as addon-hmm and met a root-owned pidfile it could not remove: every
# start said "OK" and nothing ran. As root in this container a directory stands in for such a file -
# `rm -f` cannot remove it either.
dex '/usr/local/etc/config/rc.d/hmm stop' >/dev/null
out="$(dex 'mkdir /usr/local/addons/hmm/var/hmm.pid && /usr/local/etc/config/rc.d/hmm start; echo "exit $?"')"
check "a pidfile that cannot be removed: FAILED, naming it" "FAILED (/usr/local/addons/hmm/var/hmm.pid is left over" "$out"
check "and the start exits 1" "exit 1" "$out"
check "and nothing runs" "hmm stopped" "$(dex '/usr/local/etc/config/rc.d/hmm status; rmdir /usr/local/addons/hmm/var/hmm.pid')"
# a backend that exits at once: hmm.env is sourced by Start, so it can point NODE at /bin/false
out="$(dex "cp /usr/local/addons/hmm/etc/hmm.env /tmp/hmm.env.b25 && echo 'NODE=/bin/false' >> /usr/local/addons/hmm/etc/hmm.env && /usr/local/etc/config/rc.d/hmm start; echo \"exit \$?\"")"
check "a backend that exits right after the start: FAILED" "FAILED (the backend exited right after the start" "$out"
check "and the start exits 1" "exit 1" "$out"
check "and nothing runs" "hmm stopped" "$(dex '/usr/local/etc/config/rc.d/hmm status; cp /tmp/hmm.env.b25 /usr/local/addons/hmm/etc/hmm.env')"
out="$(dex '/usr/local/etc/config/rc.d/hmm start; echo "exit $?"')"
check "and with both undone a start works again" "Starting hmm: OK" "$out"
check "with exit 0" "exit 0" "$out"
check "and the service runs" "running" "$(dex '/usr/local/etc/config/rc.d/hmm status')"

echo
echo "openccu-lite: the backend logs to the journal, and there is no var/hmm.log (task 41)"
# The container runs no journald: a systemd-cat stand-in execs the command the way the real one does
# and appends the output to /tmp/journal-<identifier>.log. hmm.env gets the line every install from
# the CCU days has, HMM_AUTH_MODE=token - which B-22 below expects to mean occulite on this box; the
# backend starts in that mode without a box to ask, since nothing is asked until a request comes.
dex 'cp /usr/local/addons/hmm/etc/hmm.env /tmp/hmm.env.t41 \
    && sed -i "s/^#*HMM_AUTH_MODE=.*/HMM_AUTH_MODE=token/" /usr/local/addons/hmm/etc/hmm.env \
    && cp /opt/systemd-cat-stub /usr/bin/systemd-cat && chmod 755 /usr/bin/systemd-cat \
    && printf "VERSION=3.89.8.20260719\nPRODUCT=ova\nPLATFORM=ova\nVARIANT=lite\n" > /VERSION \
    && echo old > /usr/local/addons/hmm/var/hmm.log.1' >/dev/null
# task 43: and the CCU's /var/log/hmm.log out of the way, to see that nothing writes it here either
dex '/usr/local/etc/config/rc.d/hmm stop; rm -f /var/log/hmm.log /var/log/hmm.log.1' >/dev/null
out="$(dex '/usr/local/etc/config/rc.d/hmm start; echo "exit $?"')"
check "a start on openccu-lite says OK" "Starting hmm: OK" "$out"
check "with exit 0" "exit 0" "$out"
for _ in 1 2 3 4 5 6 7 8 9 10; do
    dex 'grep -q "homematic-manager-web" /tmp/journal-addon-hmm.log' >/dev/null && break
    sleep 1
done
check "the backend's output is in the journal, under the unit's identifier addon-hmm" "homematic-manager-web" \
    "$(dex 'cat /tmp/journal-addon-hmm.log')"
check "no var/hmm.log, and the old rotation from the CCU days is gone" "gone" \
    "$(dex 'test -e /usr/local/addons/hmm/var/hmm.log || test -e /usr/local/addons/hmm/var/hmm.log.1 || echo gone')"
check "the recorded pid is the backend's own, not systemd-cat's" "/usr/local/addons/hmm/bin/node" \
    "$(dex "tr '\\0' ' ' < /proc/\$(cat /usr/local/addons/hmm/var/hmm.pid)/cmdline | cut -d' ' -f1")"
out="$(dex '/usr/local/etc/config/rc.d/hmm restart; echo "exit $?"')"
check "a restart on openccu-lite says OK" "Starting hmm: OK" "$out"
for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ "$(dex 'grep -c "homematic-manager-web" /tmp/journal-addon-hmm.log')" -ge 2 ] 2>/dev/null && break
    sleep 1
done
check "and the restarted backend logs to the journal too" "twice" \
    "$(dex 'n=$(grep -c "homematic-manager-web" /tmp/journal-addon-hmm.log); [ "$n" -ge 2 ] && echo twice || echo "$n"')"
check "still without a log file" "gone" "$(dex 'test -e /usr/local/addons/hmm/var/hmm.log || echo gone')"
check "and nothing in /var/log either (task 43)" "gone" "$(dex 'test -e /var/log/hmm.log || echo gone')"
out="$(dex "curl -si 'http://127.0.0.1/addons/hmm/service.cgi?sid=%40${SID}%40&cmd=log'")"
check "service.cgi's log view sends the browser to the box's Log page with the addon's unit" \
    "Location: /log?unit=addon-hmm" "$out"

echo
echo "openccu-lite: a CCU install's HMM_AUTH_MODE=token means occulite, HMM_AUTH_MODE_LITE=token is a choice (B-22)"
# The lab Charly after its upgrade from the CCU3 firmware: its hmm.env said HMM_AUTH_MODE=token from
# the CCU days, the backend ran in token mode and the box's shell could not get in. The start above
# had exactly that file. The journal has the backend's own line for the mode it runs, the syslog the
# rc.d script's; LITE_SETTINGS is the page, which shows the same rule.
LITE_SETTINGS="http://127.0.0.1/addons/hmm/settings.cgi?cmd=config&sid=%40${SID}%40"
# lite_restart: a restart with an empty journal, then wait for the backend's start line
lite_restart() {
    dex ': > /tmp/journal-addon-hmm.log; /usr/local/etc/config/rc.d/hmm restart' >/dev/null
    for _ in 1 2 3 4 5 6 7 8 9 10; do
        dex 'grep -q "homematic-manager-web" /tmp/journal-addon-hmm.log' >/dev/null && break
        sleep 1
    done
}
check "the backend runs in occulite mode: its start line says so" "login: the session openccu-lite hands over is checked against" \
    "$(dex 'cat /tmp/journal-addon-hmm.log')"
check "the rc.d script said which mode it chose" "openccu-lite detected (VARIANT=lite): --auth-mode occulite" "$(syslog)"
check "and that the CCU's line is not read here" "HMM_AUTH_MODE=token in etc/hmm.env is the CCU's setting and is not read on openccu-lite" "$(syslog)"
check "the settings page shows occulite" "current: <b>occulite</b>" "$(dex "curl -s '$LITE_SETTINGS'")"
check "and names the CCU's line" "HMM_AUTH_MODE=token is in the file as well" "$(dex "curl -s '$LITE_SETTINGS'")"
# the choice, written by the page
out="$(dex "curl -s --max-time 90 '$LITE_SETTINGS&auth_mode=token'")"
check "choosing token on the page saves and restarts" "Saved, the service was restarted." "$out"
check "as HMM_AUTH_MODE_LITE=token in etc/hmm.env" "HMM_AUTH_MODE_LITE=token" \
    "$(dex 'grep "^HMM_AUTH_MODE_LITE=" /usr/local/addons/hmm/etc/hmm.env')"
check "next to the CCU's line, which stays" "HMM_AUTH_MODE=token" "$(dex 'grep "^HMM_AUTH_MODE=" /usr/local/addons/hmm/etc/hmm.env')"
check "and the service runs" "running" "$(dex '/usr/local/etc/config/rc.d/hmm status')"
lite_restart
check "the backend runs in token mode now" "openccu-lite detected (VARIANT=lite): --auth-mode token" "$(syslog)"
absent "without the occulite login line" "login: the session openccu-lite hands over" "$(dex 'cat /tmp/journal-addon-hmm.log')"
check "the settings page shows token" "current: <b>token</b>" "$(dex "curl -s '$LITE_SETTINGS'")"
# a value of the lite line that is no lite mode, by hand: occulite, and the syslog says why
dex "sed -i 's/^HMM_AUTH_MODE_LITE=.*/HMM_AUTH_MODE_LITE=rega/' /usr/local/addons/hmm/etc/hmm.env" >/dev/null
lite_restart
check "HMM_AUTH_MODE_LITE=rega, a mode of the CCU's: the backend runs occulite" "login: the session openccu-lite hands over is checked against" \
    "$(dex 'cat /tmp/journal-addon-hmm.log')"
check "and the syslog says the line is no lite mode" "HMM_AUTH_MODE_LITE in etc/hmm.env is neither token nor occulite: --auth-mode occulite" "$(syslog)"
check "the settings page shows occulite" "current: <b>occulite</b>" "$(dex "curl -s '$LITE_SETTINGS'")"
# what the page offers from there is the switch to token, and it replaces the line, whatever it held
# (asking it for occulite writes nothing: that is what runs already)
out="$(dex "curl -s --max-time 90 '$LITE_SETTINGS&auth_mode=token'")"
check "choosing token on the page from there saves and restarts" "Saved, the service was restarted." "$out"
check "and replaces the rega line" "HMM_AUTH_MODE_LITE=token" \
    "$(dex 'grep "^HMM_AUTH_MODE_LITE=" /usr/local/addons/hmm/etc/hmm.env')"
absent "with nothing of it left" "HMM_AUTH_MODE_LITE=rega" "$(dex 'cat /usr/local/addons/hmm/etc/hmm.env')"
# and back to occulite from the page, which writes the line rather than removing it
dex ': > /tmp/journal-addon-hmm.log' >/dev/null
out="$(dex "curl -s --max-time 90 '$LITE_SETTINGS&auth_mode=occulite'")"
check "choosing occulite on the page saves and restarts" "Saved, the service was restarted." "$out"
check "as HMM_AUTH_MODE_LITE=occulite" "HMM_AUTH_MODE_LITE=occulite" \
    "$(dex 'grep "^HMM_AUTH_MODE_LITE=" /usr/local/addons/hmm/etc/hmm.env')"
for _ in 1 2 3 4 5 6 7 8 9 10; do
    dex 'grep -q "login: the session openccu-lite hands over" /tmp/journal-addon-hmm.log' >/dev/null && break
    sleep 1
done
check "and the backend runs occulite again" "login: the session openccu-lite hands over is checked against" \
    "$(dex 'cat /tmp/journal-addon-hmm.log')"
# back to a CCU for everything below, which reads the log file
dex 'rm -f /VERSION /usr/bin/systemd-cat && cp /tmp/hmm.env.t41 /usr/local/addons/hmm/etc/hmm.env \
    && /usr/local/etc/config/rc.d/hmm restart' >/dev/null
for _ in 1 2 3 4 5 6 7 8 9 10; do
    dex 'grep -q "homematic-manager-web" /var/log/hmm.log' >/dev/null && break
    sleep 1
done
check "back on a CCU the backend writes /var/log/hmm.log again" "homematic-manager-web" \
    "$(dex 'cat /var/log/hmm.log')"

echo
echo "the log location on a CCU and OpenCCU: /var/log or the addon directory (task 43)"
SETTINGS="http://127.0.0.1/addons/hmm/settings.cgi?cmd=config&sid=%40${SID}%40"
LOG_VIEW="http://127.0.0.1/addons/hmm/service.cgi?sid=%40${SID}%40&cmd=log"
# wait_for_log <file>: until the (re)started backend has written its start line there
wait_for_log() {
    for _ in 1 2 3 4 5 6 7 8 9 10; do
        dex "grep -q 'homematic-manager-web' $1" >/dev/null && break
        sleep 1
    done
}
out="$(dex "curl -s '$SETTINGS'")"
check "the settings page names the current location" "current: <b>varlog</b>" "$out"
check "and shows the last lines of /var/log/hmm.log" "homematic-manager-web" "$out"
dex 'echo t43-marker-varlog >> /var/log/hmm.log' >/dev/null
check "service.cgi's log view reads /var/log/hmm.log" "t43-marker-varlog" "$(dex "curl -s '$LOG_VIEW'")"
out="$(dex "curl -s --max-time 90 '$SETTINGS&log=addon'")"
check "settings.cgi?cmd=config&log=addon saves and restarts the service" "Saved, the service was restarted." "$out"
check "HMM_ADDON_LOG=addon is in etc/hmm.env" "HMM_ADDON_LOG=addon" \
    "$(dex 'grep ^HMM_ADDON_LOG= /usr/local/addons/hmm/etc/hmm.env')"
check "and the service runs" "running" "$(dex '/usr/local/etc/config/rc.d/hmm status')"
wait_for_log /usr/local/addons/hmm/var/hmm.log
check "the restarted backend writes var/hmm.log in the addon directory" "homematic-manager-web" \
    "$(dex 'cat /usr/local/addons/hmm/var/hmm.log')"
check "and /var/log/hmm.log is gone" "gone" "$(dex 'test -e /var/log/hmm.log || echo gone')"
dex 'echo t43-marker-addon >> /usr/local/addons/hmm/var/hmm.log' >/dev/null
out="$(dex "curl -s '$LOG_VIEW'")"
check "service.cgi's log view follows it" "t43-marker-addon" "$out"
absent "and shows nothing of the old /var/log/hmm.log" "t43-marker-varlog" "$out"
dex 'dd if=/dev/zero bs=1024 count=1100 2>/dev/null >> /usr/local/addons/hmm/var/hmm.log \
    && /usr/local/etc/config/rc.d/hmm restart' >/dev/null
check "a var/hmm.log over 1 MB is rotated at the start" "rotated" \
    "$(dex 'test -s /usr/local/addons/hmm/var/hmm.log.1 && echo rotated')"
wait_for_log /usr/local/addons/hmm/var/hmm.log
out="$(dex "curl -s --max-time 90 '$SETTINGS&log=varlog'")"
check "log=varlog switches back and restarts" "Saved, the service was restarted." "$out"
check "HMM_ADDON_LOG=varlog is in etc/hmm.env" "HMM_ADDON_LOG=varlog" \
    "$(dex 'grep ^HMM_ADDON_LOG= /usr/local/addons/hmm/etc/hmm.env')"
wait_for_log /var/log/hmm.log
check "the restarted backend writes /var/log/hmm.log again" "homematic-manager-web" "$(dex 'cat /var/log/hmm.log')"
check "and var/hmm.log and its rotation are gone" "gone" \
    "$(dex 'test -e /usr/local/addons/hmm/var/hmm.log || test -e /usr/local/addons/hmm/var/hmm.log.1 || echo gone')"
dex 'echo t43-marker-back >> /var/log/hmm.log' >/dev/null
out="$(dex "curl -s '$LOG_VIEW'")"
check "service.cgi's log view follows back" "t43-marker-back" "$out"
absent "and shows nothing of the addon directory's log" "t43-marker-addon" "$out"
dex 'dd if=/dev/zero bs=1024 count=1100 2>/dev/null >> /var/log/hmm.log \
    && /usr/local/etc/config/rc.d/hmm restart' >/dev/null
check "a /var/log/hmm.log over 1 MB is rotated at the start too" "rotated" \
    "$(dex 'test -s /var/log/hmm.log.1 && echo rotated')"
wait_for_log /var/log/hmm.log
# The fallback. As root in this container a directory stands in for a /var/log/hmm.log the start
# cannot write.
dex '/usr/local/etc/config/rc.d/hmm stop; rm -f /var/log/hmm.log /var/log/hmm.log.1; mkdir /var/log/hmm.log' >/dev/null
out="$(dex '/usr/local/etc/config/rc.d/hmm start; echo "exit $?"')"
check "a /var/log/hmm.log that cannot be written does not keep the backend from starting" "Starting hmm: OK" "$out"
check "with exit 0" "exit 0" "$out"
wait_for_log /usr/local/addons/hmm/var/hmm.log
check "it logs to var/hmm.log in the addon directory instead" "homematic-manager-web" \
    "$(dex 'cat /usr/local/addons/hmm/var/hmm.log')"
check "and service.cgi's log view shows that file" "homematic-manager-web" "$(dex "curl -s '$LOG_VIEW'")"
dex '/usr/local/etc/config/rc.d/hmm stop; rmdir /var/log/hmm.log; /usr/local/etc/config/rc.d/hmm start' >/dev/null
wait_for_log /var/log/hmm.log
check "once /var/log/hmm.log can be written, the log is back there" "homematic-manager-web" "$(dex 'cat /var/log/hmm.log')"
check "and the fallback's var/hmm.log is gone" "gone" "$(dex 'test -e /usr/local/addons/hmm/var/hmm.log || echo gone')"

echo
echo "the Zusatzsoftware page (rc.d/hmm info)"
# cp_software.cgi reads these lines through a Tcl pipe in iso8859-1 and writes them into its
# Latin-1 page as they are; an umlaut in UTF-8 came out as "GerÃ¤te" (#140)
out="$(dex '/usr/local/etc/config/rc.d/hmm info')"
check "info names the addon" "Name: Homematic Manager" "$out"
check "and its Update and Config-Url lines" "Update: /addons/hmm/update_check.cgi" "$out"
check "the Info line spells its umlauts as HTML entities" "Ger&auml;te, Verkn&uuml;pfungen" "$out"
absent "and has no byte outside ASCII (#140)" "non-ascii" "$(dex "/usr/local/etc/config/rc.d/hmm info | LC_ALL=C grep -q '[^ -~]' && echo non-ascii")"
absent "neither has the Systemsteuerung entry" "non-ascii" "$(dex "LC_ALL=C grep -q '[^ -~]' /usr/local/etc/config/hm_addons.cfg && echo non-ascii")"
check "which describes the addon with entities too" "Ger&auml;te" "$(dex 'cat /usr/local/etc/config/hm_addons.cfg')"

# wait for the backend: it starts a real Backend, which looks for interface processes that are not
# here, so give it a moment to be listening anyway
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    dex 'curl -sf -o /dev/null http://127.0.0.1:8090/addons/hmm/' >/dev/null && break
    sleep 1
done

echo
echo "the session check (settings.cgi)"
out="$(dex "curl -si 'http://127.0.0.1/addons/hmm/settings.cgi?sid=%40${SID}%40'")"
check "a valid session is redirected into the UI" "302 Found" "$out"
check "and gets the token cookie for the proxied path" "Set-Cookie: hmm_token=" "$out"
check "the cookie is scoped, HttpOnly and SameSite=Strict" "Path=/addons/hmm/; HttpOnly; SameSite=Strict" "$out"
COOKIE="hmm_token=$(printf '%s' "$out" | sed -n 's/.*hmm_token=\([0-9a-f]*\);.*/\1/p' | head -1)"
case "$COOKIE" in
    hmm_token=?*) pass "the token could be read out of the response" ;;
    *) fail "the token could be read out of the response" "$out" ;;
esac
out="$(dex "curl -si 'http://127.0.0.1/addons/hmm/settings.cgi?sid=%400000000000%40'")"
check "a wrong sid is refused" "Sitzung ung" "$out"
absent "and gets no cookie" "Set-Cookie" "$out"
out="$(dex "curl -si 'http://127.0.0.1/addons/hmm/settings.cgi'")"
check "no sid at all is refused" "Sitzung ung" "$out"

echo
echo "the UI through the proxy rule"
out="$(dex "curl -si -b '$COOKIE' http://127.0.0.1/addons/hmm/")"
check "the UI is served under /addons/hmm/" "200 OK" "$out"
check "and it is the built index.html" "<!doctype html>" "$(printf '%s' "$out" | tr 'A-Z' 'a-z')"
out="$(dex "curl -si http://127.0.0.1/addons/hmm")"
check "the bare prefix redirects to the slash" "301" "$out$(dex "curl -so /dev/null -w '%{http_code}' http://127.0.0.1/addons/hmm")"
out="$(dex "curl -si -b '$COOKIE' http://127.0.0.1/addons/hmm/data/manifest.json")"
check "the generated metadata is served under the same prefix" "200 OK" "$out"
out="$(dex "curl -so /dev/null -w '%{http_code}' 'http://127.0.0.1/addons/hmm/service.cgi?sid=%40${SID}%40&cmd=status'")"
check "the CGIs are NOT proxied into the backend" "200" "$out"
out="$(dex "curl -s 'http://127.0.0.1/addons/hmm/service.cgi?sid=%40${SID}%40&cmd=status'")"
check "service.cgi sees the running service" '"running":true' "$out"

echo
echo "the WebSocket through lighttpd (the whole point of the proxy rule)"
dex 'cp /opt/ws-probe.mjs /usr/local/addons/hmm/app/ws-probe.mjs' >/dev/null
probe() {
    dex "/usr/local/addons/hmm/bin/node /usr/local/addons/hmm/app/ws-probe.mjs 'ws://127.0.0.1/addons/hmm/api' '$1' ${2:-0}"
}
out="$(probe "$COOKIE")"
check "the upgrade succeeds through lighttpd" "open" "$out"
check "and an ApiFrame request is answered over it" "res:config.get" "$out"
out="$(probe -)"
check "without the cookie the upgrade is refused with 401" "error:http 401" "$out"
if [ "$IDLE" = 1 ]; then
    out="$(probe "$COOKIE" 70)"
    check "a socket left idle for 70 s survives lighttpd's 60 s idle timeout" "alive" "$out"
else
    echo "  skip - the 70 s idle socket (pass --idle to run it)"
fi

echo
echo "the optional login against ReGa (D-32), through lighttpd"
# the two loopback services a CCU has and a container does not, run by the bundled node
dex 'cp /opt/ccu-auth-stub.mjs /usr/local/addons/hmm/app/ccu-auth-stub.mjs' >/dev/null
docker exec -d "$NAME" sh -c \
    '/usr/local/addons/hmm/bin/node /usr/local/addons/hmm/app/ccu-auth-stub.mjs >/tmp/ccu-stub.log 2>&1'
for _ in 1 2 3 4 5 6 7 8 9 10; do
    dex 'grep -q "auth stub on udp" /tmp/ccu-stub.log' >/dev/null && break
    sleep 1
done
check "the stub CCU services are up (rega 8183, udp 1998)" "auth stub on udp" "$(dex 'cat /tmp/ccu-stub.log')"

# B-22: and openccu-lite's line next to it, which a CCU does not read - the same file after a move
# back from a lite box, where token was chosen. The syslog is emptied first: the lite part above
# has lines about that variable, and the point here is that this start writes none.
dex "sed -i 's/^#*HMM_AUTH_MODE=.*/HMM_AUTH_MODE=rega/; s/^#*HMM_AUTH_MODE_LITE=.*/HMM_AUTH_MODE_LITE=token/' /usr/local/addons/hmm/etc/hmm.env; : > /tmp/messages" >/dev/null
check "HMM_AUTH_MODE=rega is in etc/hmm.env" "HMM_AUTH_MODE=rega" \
    "$(dex 'grep ^HMM_AUTH_MODE= /usr/local/addons/hmm/etc/hmm.env')"
check "and so is HMM_AUTH_MODE_LITE=token (B-22)" "HMM_AUTH_MODE_LITE=token" \
    "$(dex 'grep ^HMM_AUTH_MODE_LITE= /usr/local/addons/hmm/etc/hmm.env')"
dex '/usr/local/etc/config/rc.d/hmm restart' >/dev/null
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    dex 'curl -sf -o /dev/null http://127.0.0.1:8090/addons/hmm/login' >/dev/null && break
    sleep 1
done
check "the host started in rega mode and says so in the log" "CCU credentials required" \
    "$(dex 'tail -40 /var/log/hmm.log')"
absent "the lite line was not read on a CCU (B-22)" "HMM_AUTH_MODE_LITE" "$(syslog)"
absent "and the CCU's line was not questioned" "is the CCU's setting and is not read" "$(syslog)"

out="$(dex "curl -s http://127.0.0.1/addons/hmm/")"
check "a browser without a session gets the login page instead of the UI" 'name="password"' "$out"
absent "and not the application shell" 'id="app"' "$out"
out="$(dex "curl -so /dev/null -w '%{http_code}' http://127.0.0.1/addons/hmm/data/manifest.json")"
check "the metadata is refused with a 401 while there is no session" "401" "$out"

out="$(dex "curl -si -X POST http://127.0.0.1/addons/hmm/login -d 'user=ccuadmin&password=wrong'")"
check "a wrong password is refused" "401" "$out"
absent "and gets no cookie" "hmm_session=" "$out"
out="$(dex "curl -si -X POST http://127.0.0.1/addons/hmm/login -d 'user=nobody&password=a%3Ab%5Cc'")"
check "an unknown user gets the very same answer" "401" "$out"

# the password has a colon and a backslash in it: the datagram splits on the first unescaped colon,
# and this is the escaping RedMatic had to get right
out="$(dex "curl -si -X POST http://127.0.0.1/addons/hmm/login -d 'user=ccuadmin&password=a%3Ab%5Cc'")"
check "the right CCU credentials are accepted" "302 Found" "$out"
check "and get a session cookie" "Set-Cookie: hmm_session=" "$out"
check "scoped, HttpOnly, SameSite=Strict and with the sliding lifetime" \
    "Path=/addons/hmm/; Max-Age=86400; HttpOnly; SameSite=Strict" "$out"
SESSION="hmm_session=$(printf '%s' "$out" | sed -n 's/.*hmm_session=\([0-9a-f]*\);.*/\1/p' | head -1)"
case "$SESSION" in
    hmm_session=?*) pass "the session id could be read out of the response" ;;
    *) fail "the session id could be read out of the response" "$out" ;;
esac
check "the escaping reached the daemon unmangled" 'ccuadmin:a\\:b\\\\c' "$(dex 'cat /tmp/ccu-stub.log')"

out="$(dex "curl -si -b '$SESSION' http://127.0.0.1/addons/hmm/")"
check "with the session the UI is served" "200 OK" "$out"
check "and it is the application shell again" 'id="app"' "$out"
out="$(probe "$SESSION")"
check "the session cookie opens the WebSocket through lighttpd" "open" "$out"
check "and session.info answers on it" "res:session.info" "$(dex "/usr/local/addons/hmm/bin/node /usr/local/addons/hmm/app/ws-probe.mjs 'ws://127.0.0.1/addons/hmm/api' '$SESSION' 0 session.info")"

# the hand-over of task 13 has to keep working while the login is on - it is the primary path
out="$(dex "curl -si 'http://127.0.0.1/addons/hmm/settings.cgi?sid=%40${SID}%40'")"
check "settings.cgi still hands over the token" "Set-Cookie: hmm_token=" "$out"
out="$(dex "curl -si -b '$COOKIE' http://127.0.0.1/addons/hmm/")"
check "and that token bypasses the login page entirely" 'id="app"' "$out"
out="$(probe "$COOKIE")"
check "and still opens the WebSocket" "open" "$out"

out="$(dex "curl -si 'http://127.0.0.1/addons/hmm/settings.cgi?cmd=config&sid=%40${SID}%40'")"
check "the addon settings page shows the mode that is in force" "current: <b>rega</b>" "$out"

out="$(dex "curl -si -b '$SESSION' http://127.0.0.1/addons/hmm/logout")"
check "logout redirects to the login page" "Location: /addons/hmm/login" "$out"
check "and clears the cookie" "Max-Age=0" "$out"
out="$(dex "curl -s -b '$SESSION' http://127.0.0.1/addons/hmm/")"
check "the ended session sees the login page again" 'name="password"' "$out"
out="$(probe "$SESSION")"
check "and its cookie no longer opens the socket" "error:http 401" "$out"

for _ in 1 2 3 4 5; do
    dex "curl -so /dev/null -X POST http://127.0.0.1/addons/hmm/login -d 'user=ccuadmin&password=wrong'" >/dev/null
done
out="$(dex "curl -so /dev/null -w '%{http_code}' -X POST http://127.0.0.1/addons/hmm/login -d 'user=ccuadmin&password=a%3Ab%5Cc'")"
check "the sixth attempt in a minute is refused, right password or not" "429" "$out"

# back to the default for the update and uninstall checks below
dex "sed -i 's/^HMM_AUTH_MODE=rega/HMM_AUTH_MODE=token/' /usr/local/addons/hmm/etc/hmm.env" >/dev/null
dex '/usr/local/etc/config/rc.d/hmm restart' >/dev/null
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    dex "curl -sf -o /dev/null -b '$COOKIE' http://127.0.0.1:8090/addons/hmm/" >/dev/null && break
    sleep 1
done
out="$(dex "curl -so /dev/null -w '%{http_code}' http://127.0.0.1/addons/hmm/")"
check "back in token mode the UI is served without a login again" "200" "$out"

echo
echo "update over the running installation, through the WebUI"
dex "echo '{\"marker\":\"kept\"}' > /usr/local/hmm/marker.json" >/dev/null
TOKEN_BEFORE="$(dex 'cat /usr/local/hmm/token')"
# B-32: what a beta.16 hmm.env can hold - its default.env's comment, which calls --lite-mode the
# default, and the line its README showed
docker exec -i "$NAME" sh -c 'cat >> /usr/local/addons/hmm/etc/hmm.env' <<'EOF'

# Task 44: flags for node itself, read by the rc.d script and not by the host. The default is
# --lite-mode, V8 without its optimising compilers, which keeps the backend's memory down (the
# addon's README, "Memory"). Empty runs node without flags, as before 3.0.0-beta.16.
#HMM_NODE_FLAGS=
HMM_NODE_FLAGS=--lite-mode             # flags for node, read by the rc.d script only - see "Memory"
EOF
lighttpd_actions >/dev/null
out="$(webui install)"
check "the WebUI's request is answered - with update_script's 0, an update (#141)" "installed rc=0 curl=0" "$out"
none "the update took beta.16's HMM_NODE_FLAGS=--lite-mode line out of etc/hmm.env (B-32)" \
    "$(dex 'grep "^HMM_NODE_FLAGS=" /usr/local/addons/hmm/etc/hmm.env')"
none "and beta.16's comment calling --lite-mode the default" \
    "$(dex 'grep "flags for node itself, read by the rc.d script and not by the host. The default is" /usr/local/addons/hmm/etc/hmm.env')"
check "which the current comment replaced" "Unset, node runs with" "$(dex 'cat /usr/local/addons/hmm/etc/hmm.env')"
check "and it says so in the syslog" "etc/hmm.env: removed the line HMM_NODE_FLAGS=--lite-mode" "$(syslog)"
wait_for_backend
check "the updated backend runs with the default node flags" "$EXPECTED_CMDLINE" "$(cmdline_of_backend)"
none "the rule was unchanged, so lighttpd was left alone entirely" "$(lighttpd_actions)"
check "and is still the same server" "$LIGHTTPD_PID" "$(dex 'cat /run/lighttpd.pid')"
check "the profile survived the update" "kept" "$(dex 'cat /usr/local/hmm/marker.json')"
check "and so did the token, so an open browser tab keeps working" "$TOKEN_BEFORE" "$(dex 'cat /usr/local/hmm/token')"
check "the service is running again" "running" "$(dex '/usr/local/etc/config/rc.d/hmm status')"
out="$(dex "curl -so /dev/null -w '%{http_code}' -b '$COOKIE' http://127.0.0.1/addons/hmm/")"
check "the UI answers again after the update" "200" "$out"

echo
echo "the CCU3 firmware's path: an install_addon driven by hand on a running box"
# The CCU3 wraps update_script in a chroot that binds /usr/local, /dev, /proc and /sys - not
# /var/run, where the pidfile used to be. `rc.d/hmm stop` of the *installed* version therefore found
# nothing to stop and the old backend kept running on the replaced tree; the lab had to finish the
# update with a restart by hand. Both halves of that are replayed here: the marker file that makes
# update_script take the firmware's branch, and a pidfile the installed rc.d cannot see.
dex 'mkdir -p /etc/init.d && touch /etc/init.d/S00InstallAddon' >/dev/null
# B-32: a user's own flags next to beta.16's --lite-mode - the update keeps them and takes it out
dex "echo 'HMM_NODE_FLAGS=\"--max-old-space-size=300 --lite-mode\"' >> /usr/local/addons/hmm/etc/hmm.env" >/dev/null
PID_BEFORE="$(dex 'cat /usr/local/addons/hmm/var/hmm.pid')"
dex 'rm -f /usr/local/addons/hmm/var/hmm.pid' >/dev/null
check "the installed rc.d can no longer see its own process, as in the chroot" "stopped" \
    "$(dex '/usr/local/etc/config/rc.d/hmm status')"
out="$(install_addon)"
check "update_script exits 0 on that update too" "exit 0" "$out"
absent "the old backend was stopped, by name, with no pidfile to go by" "hmm/app/dist/cli.js" \
    "$(dex "tr '\\0' ' ' < /proc/$PID_BEFORE/cmdline 2>/dev/null")"
check "and a new one is running, so the update needs no restart by hand" "running" \
    "$(dex '/usr/local/etc/config/rc.d/hmm status')"
absent "with a pid of its own" "$PID_BEFORE" "$(dex 'cat /usr/local/addons/hmm/var/hmm.pid')"
check "the update kept the user's own flag in etc/hmm.env and took --lite-mode out (B-32)" \
    'HMM_NODE_FLAGS="--max-old-space-size=300"' "$(dex 'grep "^HMM_NODE_FLAGS=" /usr/local/addons/hmm/etc/hmm.env')"
check "and says so in the syslog" 'took --lite-mode out of HMM_NODE_FLAGS, now "--max-old-space-size=300"' "$(syslog)"
check "node runs with that flag alone" \
    "/usr/local/addons/hmm/bin/node --max-old-space-size=300 /usr/local/addons/hmm/app/dist/cli.js" "$(cmdline_of_backend)"
dex "sed -i '/^HMM_NODE_FLAGS=/d' /usr/local/addons/hmm/etc/hmm.env" >/dev/null
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    dex "curl -sf -o /dev/null -b '$COOKIE' http://127.0.0.1:8090/addons/hmm/" >/dev/null && break
    sleep 1
done
out="$(dex "curl -so /dev/null -w '%{http_code}' -b '$COOKIE' http://127.0.0.1/addons/hmm/")"
check "and it serves the UI again" "200" "$out"
dex 'rm -f /etc/init.d/S00InstallAddon' >/dev/null
none "the CCU3 path never touches lighttpd (the boot reads the rule)" "$(lighttpd_actions)"

echo
echo "an update after the port was moved in etc/hmm.env"
dex "sed -i 's/^#*HMM_PORT=.*/HMM_PORT=8091/' /usr/local/addons/hmm/etc/hmm.env" >/dev/null
out="$(webui install)"
check "the WebUI's request is answered" "installed rc=0 curl=0" "$out"
check "the rule carries the new port" '"port" => 8091' "$(dex 'cat /usr/local/etc/config/lighttpd/hmm.conf')"
check "and lighttpd was told with a reload" "reload" "$(lighttpd_actions)"
absent "not a restart" "restart" "$(lighttpd_actions)"
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    dex "curl -sf -o /dev/null -b '$COOKIE' http://127.0.0.1:8091/addons/hmm/" >/dev/null && break
    sleep 1
done
out="$(dex "curl -so /dev/null -w '%{http_code}' -b '$COOKIE' http://127.0.0.1/addons/hmm/")"
check "the UI is served through the reloaded rule on the new port" "200" "$out"

echo
echo "uninstall, through the WebUI, on a firmware whose S50lighttpd has no reload"
# the fallback: the restart is detached and delayed, so the WebUI's request is still answered
dex 'touch /tmp/S50lighttpd-no-reload' >/dev/null
lighttpd_actions >/dev/null
out="$(webui uninstall)"
check "the WebUI's request is answered (#141)" "uninstalled rc=0 curl=0" "$out"
check "the addon directory is gone" "gone" "$(dex 'test -d /usr/local/addons/hmm || echo gone')"
check "and so is its log in /var/log (task 43)" "gone" "$(dex 'test -e /var/log/hmm.log || test -e /var/log/hmm.log.1 || echo gone')"
check "the lighttpd rule is gone" "gone" "$(dex 'test -f /usr/local/etc/config/lighttpd/hmm.conf || echo gone')"
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
    case "$(dex 'cat /tmp/S50lighttpd.log')" in
        *restart*) break ;;
    esac
    sleep 1
done
check "reload was tried first, then the delayed restart" "reload restart" "$(lighttpd_actions)"
for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ "$(dex 'cat /run/lighttpd.pid 2>/dev/null')" != "$LIGHTTPD_PID" ] && dex 'test -f /run/lighttpd.pid' >/dev/null && break
    sleep 1
done
# compared whole, not as a substring: the first lighttpd is pid 23 in a fresh container, and a new one
# can well be 2323
NEW_LIGHTTPD_PID="$(dex 'cat /run/lighttpd.pid')"
if [ -n "$NEW_LIGHTTPD_PID" ] && [ "$NEW_LIGHTTPD_PID" != "$LIGHTTPD_PID" ]; then
    pass "which brought a new lighttpd up"
else
    fail "which brought a new lighttpd up" "pid $LIGHTTPD_PID before, '$NEW_LIGHTTPD_PID' now"
fi
out="$(dex "curl -so /dev/null -w '%{http_code}' http://127.0.0.1/addons/hmm/")"
check "that no longer proxies /addons/hmm/" "404" "$out"
dex 'rm -f /tmp/S50lighttpd-no-reload' >/dev/null
check "the www symlink is gone" "gone" "$(dex 'test -e /usr/local/etc/config/addons/www/hmm || echo gone')"
absent "the Systemsteuerung entry is gone" "settings.cgi" "$(dex 'cat /usr/local/etc/config/hm_addons.cfg')"
check "the profile is kept, as an uninstall should" "kept" "$(dex 'cat /usr/local/hmm/marker.json')"

echo
echo "reinstall and purge"
lighttpd_actions >/dev/null
out="$(install_addon)"
check "a reinstall over the kept profile is a fresh install again" "exit 10" "$out"
check "and puts the rule back with a reload" "reload" "$(lighttpd_actions)"
check "and it picks the old profile back up" "kept" "$(dex 'cat /usr/local/hmm/marker.json')"

echo
echo "the Config-Url: the settings page on openccu-lite, the button into the app on a CCU (B-36)"
# openccu-lite's shell frames the Config-Url behind the gear and the Settings button; the Charly's
# /VERSION carries VARIANT=lite and LITE=
dex 'printf "VERSION=3.89.8.20260719\nPRODUCT=rpi3\nPLATFORM=rpi3\nVARIANT=lite\nLITE=1.0.0-alpha.0\n" > /VERSION' >/dev/null
out="$(install_addon)"
check "an update on openccu-lite goes through" "exit 0" "$out"
check "and writes the settings page as the CONFIG_URL into hm_addons.cfg" \
    "CONFIG_URL /addons/hmm/settings.cgi?cmd=config CONFIG_DESCRIPTION" "$(dex 'cat /usr/local/etc/config/hm_addons.cfg')"
check "which keeps its description" "Ger&auml;te" "$(dex 'cat /usr/local/etc/config/hm_addons.cfg')"
check "rc.d/hmm info names the settings page as the Config-Url" "Config-Url: /addons/hmm/settings.cgi?cmd=config" \
    "$(dex '/usr/local/etc/config/rc.d/hmm info')"
dex 'rm -f /VERSION' >/dev/null
out="$(install_addon)"
check "an update on a CCU again goes through" "exit 0" "$out"
check "and the CONFIG_URL is the button into the app again" \
    "CONFIG_URL /addons/hmm/settings.cgi CONFIG_DESCRIPTION" "$(dex 'cat /usr/local/etc/config/hm_addons.cfg')"
check "and so is the Config-Url of rc.d/hmm info" "Config-Url: /addons/hmm/settings.cgi" "$(dex '/usr/local/etc/config/rc.d/hmm info')"
absent "without ?cmd=config" "settings.cgi?cmd=config" "$(dex '/usr/local/etc/config/rc.d/hmm info')"
dex '/usr/local/etc/config/rc.d/hmm uninstall purge' >/dev/null
check "uninstall purge removes the profile too" "gone" "$(dex 'test -d /usr/local/hmm || echo gone')"

echo
if [ "$failed" = 0 ]; then
    echo "container test passed"
else
    echo "container test failed"
fi
exit $failed
