#!/usr/bin/env bash
#
# Replays the firmware's addon installation in a container and drives the installed addon through a
# real lighttpd, the way ccu-addon-howto/docs/08-testing.md describes it: install, update,
# uninstall, the WebUI session check, the proxy rule and - the one that decides whether this addon
# can work at all - a WebSocket upgrade through lighttpd (D-25, D-28).
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

cd "$(dirname "$0")/.."
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

dex() { docker exec "$NAME" sh -c "$1" 2>&1; }

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1; }
trap cleanup EXIT

echo "building the test image"
docker build -q -t "$IMAGE" "$ADDON_SRC/test" >/dev/null || {
    echo "docker build failed" >&2
    exit 1
}

docker run -d --init --name "$NAME" -v "$PKG:/dist/$(basename "$PKG"):ro" \
    -v "$ADDON_SRC/test/ws-probe.mjs:/opt/ws-probe.mjs:ro" "$IMAGE" >/dev/null

# the firmware's own web root: /www/addons is a symlink to /etc/config/addons/www
dex 'mkdir -p /www && ln -sfn /etc/config/addons/www /www/addons' >/dev/null
# the stub ReGa treats this session id as live
dex "printf '%s\n' $SID > /tmp/valid-sids" >/dev/null

# Exactly what OpenCCU's /bin/install_addon does with an uploaded archive.
install_addon() {
    dex "dir=\$(mktemp -d -p /usr/local/tmp) && tar -C \$dir --no-same-owner --no-same-permissions -xzf /dist/$(basename "$PKG") && cd \$dir && ./update_script HM-RASPBERRYMATIC; rc=\$?; cd /; rm -rf \$dir; echo \"exit \$rc\""
}

echo
echo "fresh install"
out="$(install_addon)"
check "update_script exits 10 on a fresh install (the WebUI then offers a reboot)" "exit 10" "$out"
check "the rc.d link exists" "/usr/local/addons/hmm/rc.d/hmm" "$(dex 'readlink /usr/local/etc/config/rc.d/hmm')"
check "the www symlink exists" "/usr/local/addons/hmm/www" "$(dex 'readlink /usr/local/etc/config/addons/www/hmm')"
check "the Systemsteuerung entry was written" "/addons/hmm/settings.cgi" "$(dex 'cat /usr/local/etc/config/hm_addons.cfg')"
check "the lighttpd rule was installed with the port" '"port" => 8090' "$(dex 'cat /usr/local/etc/config/lighttpd/hmm.conf')"
check "the token is root-only" "600" "$(dex 'stat -c %a /usr/local/hmm/token')"
check "the profile directory is root-only" "700" "$(dex 'stat -c %a /usr/local/hmm')"
check "the image cache is excluded from the backup" "OK" "$(dex 'test -f /usr/local/hmm/images/.nobackup && echo OK')"
check "the service was started by the live install" "running" "$(dex '/usr/local/etc/config/rc.d/hmm status')"

echo
echo "the CCU's lighttpd in front of it"
dex 'lighttpd -f /etc/lighttpd/lighttpd-ccu.conf' >/dev/null
sleep 1
check "lighttpd started with the addon's rule" "OK" "$(dex 'test -f /run/lighttpd.pid && echo OK')"

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
echo "update over the running installation"
dex "echo '{\"marker\":\"kept\"}' > /usr/local/hmm/marker.json" >/dev/null
TOKEN_BEFORE="$(dex 'cat /usr/local/hmm/token')"
out="$(install_addon)"
check "update_script exits 0 on an update" "exit 0" "$out"
check "the profile survived the update" "kept" "$(dex 'cat /usr/local/hmm/marker.json')"
check "and so did the token, so an open browser tab keeps working" "$TOKEN_BEFORE" "$(dex 'cat /usr/local/hmm/token')"
check "the service is running again" "running" "$(dex '/usr/local/etc/config/rc.d/hmm status')"
out="$(dex "curl -so /dev/null -w '%{http_code}' -b '$COOKIE' http://127.0.0.1/addons/hmm/")"
check "the UI answers again after the update" "200" "$out"

echo
echo "uninstall"
out="$(dex '/usr/local/etc/config/rc.d/hmm uninstall')"
check "the addon directory is gone" "gone" "$(dex 'test -d /usr/local/addons/hmm || echo gone')"
check "the lighttpd rule is gone" "gone" "$(dex 'test -f /usr/local/etc/config/lighttpd/hmm.conf || echo gone')"
check "the www symlink is gone" "gone" "$(dex 'test -e /usr/local/etc/config/addons/www/hmm || echo gone')"
absent "the Systemsteuerung entry is gone" "settings.cgi" "$(dex 'cat /usr/local/etc/config/hm_addons.cfg')"
check "the profile is kept, as an uninstall should" "kept" "$(dex 'cat /usr/local/hmm/marker.json')"

echo
echo "reinstall and purge"
out="$(install_addon)"
check "a reinstall over the kept profile is a fresh install again" "exit 10" "$out"
check "and it picks the old profile back up" "kept" "$(dex 'cat /usr/local/hmm/marker.json')"
dex '/usr/local/etc/config/rc.d/hmm uninstall purge' >/dev/null
check "uninstall purge removes the profile too" "gone" "$(dex 'test -d /usr/local/hmm || echo gone')"

echo
if [ "$failed" = 0 ]; then
    echo "container test passed"
else
    echo "container test failed"
fi
exit $failed
