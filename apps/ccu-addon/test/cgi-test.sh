#!/usr/bin/env bash
#
# Exercises the addon's CGIs against a throwaway copy of the addon tree. Needs tclsh, nothing else -
# no CCU, no web server, no package.
#
#   apps/ccu-addon/test/cgi-test.sh
#
# On a machine without tclsh (a plain WSL Debian has none), run it inside the test image:
#
#   docker build -t hmm-addon-test apps/ccu-addon/test
#   docker run --rm -v "$PWD:/repo" -w /repo hmm-addon-test apps/ccu-addon/test/cgi-test.sh

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
ADDON_SRC="$PWD"
command -v tclsh >/dev/null || {
    echo "tclsh is required" >&2
    exit 1
}

TMP="$(mktemp -d)"
STATE_STUB_PID=""
trap 'if [ -n "$STATE_STUB_PID" ]; then kill "$STATE_STUB_PID" 2>/dev/null; fi; rm -rf "$TMP"' EXIT

TREE="$TMP/hmm"
STATE="$TMP/state"
mkdir -p "$TREE/etc" "$TREE/var" "$STATE"
cp -a "$ADDON_SRC/files/hmm/www" "$TREE/www"
cp -a "$ADDON_SRC/files/hmm/etc/default.env" "$TREE/etc/hmm.env"
cat > "$TREE/versions" <<'VERSIONS'
VERSION_ADDON="3.0.0-dev.0"
NODE_VERSION="v24.18.1"
NODE_ARCH="x86_64"
VERSIONS
printf 'line one\nline two\n' > "$TREE/var/hmm.log"
printf 'deadbeefcafebabe0123456789abcdef\n' > "$STATE/token"
chmod 600 "$STATE/token"

export HMM_ADDON_DIR="$TREE"
export HMM_STATE_DIR="$STATE"
export HMM_PID_FILE="$TMP/hmm.pid"
export HMM_RC_SCRIPT="$TMP/rc.d-hmm"
# the calls are also recorded, for the settings page, which does not show the script's output
RC_CALLS="$TMP/rc.d-calls"
printf '#!/bin/sh\necho "rc.d called with $1"\necho "$1" >> "%s"\n' "$RC_CALLS" > "$HMM_RC_SCRIPT"
chmod +x "$HMM_RC_SCRIPT"
# task 43: /var/log, where the log goes by default, stands in as a directory of its own
export HMM_SYSTEM_LOG_DIR="$TMP/varlog"
mkdir -p "$HMM_SYSTEM_LOG_DIR"

failed=0
pass() { echo "  ok   - $1"; }
skip() { echo "  skip - $1 ($2)"; }
fail() {
    echo "  FAIL - $1"
    echo "         $2"
    failed=1
}

STUB="$ADDON_SRC/test/stub.tcl"

# how the CCU serves the pages: /usr/local/etc/config/addons/www/hmm is a symlink to the addon's www
# directory, and lighttpd invokes the CGI through it
mkdir -p "$TMP/config/addons/www"
ln -sfn "$TREE/www" "$TMP/config/addons/www/hmm"

# cgi <script> <query>
# Invoked the way lighttpd does: the working directory is the script's own and the script is named
# relative to it. Passing an absolute path instead would hide whether the addon can find itself.
cgi() {
    (cd "$TREE/www" && QUERY_STRING="$2" tclsh "$STUB" "$1" 2>&1)
}

# The openccu-lite box a CGI asks about a session (task 50): GET /api/auth/v1/state, answered by
# occulite-state-stub.tcl on a port of its own that HMM_OCCULITE_URL points the CGI at. It logs every
# call, so the cases where no call may be made - a CCU, a malformed id - are checked against the log
# and not only against the answer. Started before the first openccu-lite page: since B-37 the
# settings page and service.cgi need an administrator the box confirms there.
STATE_PORT_FILE="$TMP/state-port"
STATE_LOG="$TMP/state-log"
tclsh "$ADDON_SRC/test/occulite-state-stub.tcl" "$STATE_PORT_FILE" "$STATE_LOG" &
STATE_STUB_PID=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ -s "$STATE_PORT_FILE" ] && break
    sleep 1
done
if [ -s "$STATE_PORT_FILE" ]; then
    pass "the stub state endpoint is up"
else
    fail "the stub state endpoint is up" "no port file after 10 s"
fi
STATE_URL="http://127.0.0.1:$(cat "$STATE_PORT_FILE" 2>/dev/null || echo 1)"
# the ids of occulite-state-stub.tcl: LIVE is an administrator's session, OLD a user's of an image
# from before occulited's task 125, OLDADMIN an administrator's of such an image, USERSID a user's
LIVE=ABCDEFGHIJKLMNOPQRSTUVWXYZ
OLD=abcdefgh12
NOSID=NOSIDNOSIDNOSIDNOSIDNOSI22
OTHER=OTHERSESSIONOTHERSESSION22
BROKEN=BROKENBROKENBROKENBROKEN22
GARBAGE=GARBAGEGARBAGEGARBAGEGAR22
OLDADMIN=oldadmin12
USERSID=USERSESSIONUSERSESSIONUS22
NOROLE=NOROLENOROLENOROLENOROLE22
ADMINCASE=ADMINCASEADMINCASEADMINC22
ESCROLE=ESCAPEDROLEESCAPEDROLEES22
FAKEROLE=FAKEROLEFAKEROLEFAKEROLE22
# state_calls: the stub's log since the last look
state_calls() {
    cat "$STATE_LOG" 2>/dev/null
    : > "$STATE_LOG"
}

echo "settings.cgi as lighttpd serves it (through the addons/www symlink)"
for style in relative absolute; do
    if [ "$style" = relative ]; then
        out="$(cd "$TMP/config/addons/www/hmm" && QUERY_STRING='sid=@1234567890@' tclsh "$STUB" settings.cgi 2>&1)"
    else
        out="$(cd / && QUERY_STRING='sid=@1234567890@' tclsh "$STUB" "$TMP/config/addons/www/hmm/settings.cgi" 2>&1)"
    fi
    case "$out" in
        *'Status: 302 Found'*) pass "settings.cgi redirects into the UI ($style through the symlink)" ;;
        *) fail "settings.cgi redirects into the UI ($style through the symlink)" "$out" ;;
    esac
done

echo "the token cookie"
out="$(cgi settings.cgi 'sid=@1234567890@')"
case "$out" in
    *'Set-Cookie: hmm_token=deadbeefcafebabe0123456789abcdef;'*) pass "carries the token from the profile directory" ;;
    *) fail "carries the token from the profile directory" "$out" ;;
esac
for attribute in 'Path=/addons/hmm/' 'HttpOnly' 'SameSite=Strict'; do
    case "$out" in
        *"$attribute"*) pass "the cookie is $attribute" ;;
        *) fail "the cookie is $attribute" "$out" ;;
    esac
done
case "$out" in
    *'Secure'*) fail "no Secure attribute over plain http" "$out" ;;
    *) pass "no Secure attribute over plain http (the WebUI is reachable over http)" ;;
esac
case "$out" in
    *'Location: /addons/hmm/'*) pass "and it redirects to the UI under the proxied base path" ;;
    *) fail "and it redirects to the UI under the proxied base path" "$out" ;;
esac
out="$(cd "$TREE/www" && QUERY_STRING='sid=@1234567890@' HTTPS=on tclsh "$STUB" settings.cgi 2>&1)"
case "$out" in
    *'; Secure'*) pass "over https the cookie is Secure" ;;
    *) fail "over https the cookie is Secure" "$out" ;;
esac
# The https path has to land on a working UI: the QR scanner needs a secure context, so https is
# what a user is told to open. A Location with a scheme in it would send them back to http.
case "$out" in
    *'Location: http'*) fail "the https redirect stays on the same origin" "$out" ;;
    *'Location: /addons/hmm/'*) pass "the https redirect stays on the same origin" ;;
    *) fail "the https redirect stays on the same origin" "$out" ;;
esac

echo "session"
out="$(HMM_TEST_SESSION=invalid cgi settings.cgi 'sid=@1234567890@')"
case "$out" in
    *'Sitzung ungültig'*) pass "an expired session gets the German notice" ;;
    *) fail "an expired session gets the German notice" "$out" ;;
esac
case "$out" in
    *'Invalid session'*) pass "and the English one below it" ;;
    *) fail "and the English one below it" "$out" ;;
esac
case "$out" in
    *deadbeefcafebabe*) fail "an expired session never sees the token" "$out" ;;
    *) pass "an expired session never sees the token" ;;
esac
out="$(cgi settings.cgi 'sid=nonsense')"
case "$out" in
    *'Sitzung ungültig'*) pass "a malformed sid is refused" ;;
    *) fail "a malformed sid is refused" "$out" ;;
esac
# the WebUI percent-encodes the @ of a session id when it builds the settings URL
out="$(cgi settings.cgi 'sid=%401234567890%40')"
case "$out" in
    *'Set-Cookie: hmm_token='*) pass "a percent-encoded sid is accepted" ;;
    *) fail "a percent-encoded sid is accepted" "$out" ;;
esac
out="$(cgi service.cgi 'sid=@1234567890@&cmd=status')"
case "$out" in
    *'"running"'*) pass "service.cgi answers a valid session" ;;
    *) fail "service.cgi answers a valid session" "$out" ;;
esac
out="$(HMM_TEST_SESSION=invalid cgi service.cgi 'sid=@1234567890@&cmd=status')"
case "$out" in
    *'"error":"invalid session"'*) pass "service.cgi refuses an expired session" ;;
    *) fail "service.cgi refuses an expired session" "$out" ;;
esac

# the decoder must not execute what it decodes: the usual regsub+subst idiom would run this
rm -f /tmp/hmm-cgi-pwned
out="$(cgi service.cgi 'sid=%40%5Bexec%20touch%20%2Ftmp%2Fhmm-cgi-pwned%5D%40')"
if [ -e /tmp/hmm-cgi-pwned ]; then
    fail "a query string cannot execute commands" "the decoder ran [exec ...]"
    rm -f /tmp/hmm-cgi-pwned
else
    pass "a query string cannot execute commands"
fi
case "$out" in
    *'invalid session'*) pass "and such a sid is refused" ;;
    *) fail "and such a sid is refused" "$out" ;;
esac

echo "service.cgi"
out="$(cgi service.cgi 'sid=@1234567890@&cmd=status')"
case "$out" in
    *'"running":false'*) pass "reports a stopped service" ;;
    *) fail "reports a stopped service" "$out" ;;
esac
case "$out" in
    *'"VERSION_ADDON":"3.0.0-dev.0"'*) pass "reports the addon version" ;;
    *) fail "reports the addon version" "$out" ;;
esac
case "$out" in
    *'"port":"8090"'*) pass "reports the port from etc/hmm.env" ;;
    *) fail "reports the port from etc/hmm.env" "$out" ;;
esac
case "$out" in
    *'"url":"/addons/hmm/"'*) pass "reports where the UI is" ;;
    *) fail "reports where the UI is" "$out" ;;
esac
# with a live pid the status has to carry real memory and uptime - busybox ps has no -p, which is
# how "0 MB" and an empty uptime got shipped in another addon
echo $$ > "$HMM_PID_FILE"
out="$(cgi service.cgi 'sid=@1234567890@&cmd=status')"
case "$out" in
    *'"running":true'*) pass "reports a running service" ;;
    *) fail "reports a running service" "$out" ;;
esac
if [ -r "/proc/$$/status" ]; then
    rss="$(printf '%s' "$out" | sed -n 's/.*"rss":"\([0-9]*\)".*/\1/p')"
    if [ -n "$rss" ] && [ "$rss" -gt 0 ] 2>/dev/null; then
        pass "reports resident memory ($rss kB)"
    else
        fail "reports resident memory" "$out"
    fi
    case "$out" in
        *'"uptime":""'*) fail "reports an uptime" "$out" ;;
        *'"uptime":"'*) pass "reports an uptime" ;;
        *) fail "reports an uptime" "$out" ;;
    esac
else
    skip "reports resident memory and uptime" "no /proc on this host"
fi
rm -f "$HMM_PID_FILE"
out="$(cgi service.cgi 'sid=@1234567890@&cmd=restart')"
case "$out" in
    *'rc.d called with restart'*) pass "passes start/stop/restart to the rc.d script" ;;
    *) fail "passes start/stop/restart to the rc.d script" "$out" ;;
esac
out="$(cgi service.cgi 'sid=@1234567890@&cmd=log')"
case "$out" in
    *'line two'*) pass "returns the log" ;;
    *) fail "returns the log" "$out" ;;
esac
# task 41: on openccu-lite the backend writes no file, and the log view is the box's Log page
LOG_LITE_VERSION="$TMP/VERSION-lite-log"
printf 'VERSION=3.89.8.20260719\nPRODUCT=ova\nPLATFORM=ova\nVARIANT=lite\n' > "$LOG_LITE_VERSION"
LOG_CCU_VERSION="$TMP/VERSION-ccu-log"
printf 'VERSION=3.83.5.20250401\nPRODUCT=HM-RASPBERRYMATIC\nPLATFORM=oci\n' > "$LOG_CCU_VERSION"
mv "$TREE/var/hmm.log" "$TMP/hmm.log.aside"
out="$(cd "$TREE/www" && QUERY_STRING='sid=@1234567890@&cmd=log' HMM_VERSION_FILE="$LOG_LITE_VERSION" HMM_OCCULITE_URL="$STATE_URL" HTTP_X_OCCULITE_SESSION="$LIVE" tclsh "$STUB" service.cgi 2>&1)"
case "$out" in
    *'Location: /log?unit=addon-hmm'*) pass "on openccu-lite the log view sends the browser to the box's Log page (task 41)" ;;
    *) fail "on openccu-lite the log view sends the browser to the box's Log page (task 41)" "$out" ;;
esac
out="$(cd "$TREE/www" && QUERY_STRING='sid=@1234567890@&cmd=log' HMM_VERSION_FILE="$LOG_CCU_VERSION" tclsh "$STUB" service.cgi 2>&1)"
case "$out" in
    *'Location:'*) fail "a CCU without a log file is not sent anywhere" "$out" ;;
    *'no log yet'*) pass "a CCU without a log file is not sent anywhere" ;;
    *) fail "a CCU without a log file is not sent anywhere" "$out" ;;
esac
mv "$TMP/hmm.log.aside" "$TREE/var/hmm.log"
out="$(cd "$TREE/www" && QUERY_STRING='sid=@1234567890@&cmd=log' HMM_VERSION_FILE="$LOG_LITE_VERSION" HMM_OCCULITE_URL="$STATE_URL" HTTP_X_OCCULITE_SESSION="$LIVE" tclsh "$STUB" service.cgi 2>&1)"
case "$out" in
    *'line two'*) pass "a lite box that still has the file (no systemd-cat) shows the file" ;;
    *) fail "a lite box that still has the file (no systemd-cat) shows the file" "$out" ;;
esac
# task 43: the log view reads the file HMM_ADDON_LOG chooses - /var/log/hmm.log when it is unset or
# varlog, the addon directory's with addon - and whichever one exists when the chosen one does not
printf 'varlog one\nvarlog two\n' > "$HMM_SYSTEM_LOG_DIR/hmm.log"
log_view() {
    # log_view <description> <expected> <not expected>
    out="$(cgi service.cgi 'sid=@1234567890@&cmd=log')"
    case "$out" in
        *"$3"*) fail "$1" "$out" ;;
        *"$2"*) pass "$1" ;;
        *) fail "$1" "$out" ;;
    esac
}
log_view "unset: the log view reads /var/log/hmm.log (task 43)" 'varlog two' 'line two'
printf 'HMM_ADDON_LOG=varlog\n' >> "$TREE/etc/hmm.env"
log_view "HMM_ADDON_LOG=varlog: the log view reads /var/log/hmm.log" 'varlog two' 'line two'
printf 'HMM_ADDON_LOG=addon\n' >> "$TREE/etc/hmm.env"
log_view "HMM_ADDON_LOG=addon: the log view reads the addon directory's var/hmm.log" 'line two' 'varlog two'
mv "$TREE/var/hmm.log" "$TMP/hmm.log.aside"
log_view "addon chosen but only /var/log/hmm.log there: that one is shown" 'varlog two' 'no log yet'
mv "$TMP/hmm.log.aside" "$TREE/var/hmm.log"
cp -a "$ADDON_SRC/files/hmm/etc/default.env" "$TREE/etc/hmm.env"
mv "$HMM_SYSTEM_LOG_DIR/hmm.log" "$TMP/varlog.aside"
log_view "varlog chosen but only var/hmm.log there (the fallback of rc.d/hmm): that one is shown" 'line two' 'no log yet'
mv "$TMP/varlog.aside" "$HMM_SYSTEM_LOG_DIR/hmm.log"
out="$(cgi service.cgi 'sid=@1234567890@&cmd=havoc')"
case "$out" in
    *'unknown command'*) pass "refuses an unknown command" ;;
    *) fail "refuses an unknown command" "$out" ;;
esac

echo "the addon settings page (D-32)"
out="$(cgi settings.cgi 'sid=@1234567890@&cmd=config')"
case "$out" in
    *'Anmeldung / Login'*) pass "settings.cgi?cmd=config shows the settings page" ;;
    *) fail "settings.cgi?cmd=config shows the settings page" "$out" ;;
esac
case "$out" in
    *'Status: 302'*) fail "the settings page is not the hand-over" "$out" ;;
    *) pass "the settings page is not the hand-over" ;;
esac
case "$out" in
    *'current: <b>token</b>'*) pass "and reports the default mode, token" ;;
    *) fail "and reports the default mode, token" "$out" ;;
esac
# the hand-over is what the Systemsteuerung button uses and must be untouched by any of this
out="$(cgi settings.cgi 'sid=@1234567890@')"
case "$out" in
    *'Status: 302 Found'*) pass "and the hand-over still redirects into the UI" ;;
    *) fail "and the hand-over still redirects into the UI" "$out" ;;
esac
out="$(HMM_TEST_SESSION=invalid cgi settings.cgi 'sid=@1234567890@&cmd=config')"
case "$out" in
    *'Sitzung ungültig'*) pass "an expired session gets no settings page either" ;;
    *) fail "an expired session gets no settings page either" "$out" ;;
esac
# a browser that already holds the token cookie has passed the same session check, which is what
# makes the page reachable from the Systemsteuerung entry's link, where there is no sid
out="$(cd "$TREE/www" && QUERY_STRING='cmd=config' HTTP_COOKIE='a=1; hmm_token=deadbeefcafebabe0123456789abcdef' HMM_TEST_SESSION=invalid tclsh "$STUB" settings.cgi 2>&1)"
case "$out" in
    *'Anmeldung / Login'*) pass "the token cookie opens the settings page without a sid" ;;
    *) fail "the token cookie opens the settings page without a sid" "$out" ;;
esac
out="$(cd "$TREE/www" && QUERY_STRING='cmd=config' HTTP_COOKIE='hmm_token=wrong' HMM_TEST_SESSION=invalid tclsh "$STUB" settings.cgi 2>&1)"
case "$out" in
    *'Sitzung ungültig'*) pass "a wrong token cookie does not" ;;
    *) fail "a wrong token cookie does not" "$out" ;;
esac

out="$(cgi settings.cgi 'sid=@1234567890@&cmd=config&auth_mode=rega')"
case "$out" in
    *'current: <b>rega</b>'*) pass "switching to rega is saved" ;;
    *) fail "switching to rega is saved" "$out" ;;
esac
case "$(grep '^HMM_AUTH_MODE' "$TREE/etc/hmm.env")" in
    'HMM_AUTH_MODE=rega') pass "and written into etc/hmm.env, replacing the commented-out line" ;;
    *) fail "and written into etc/hmm.env, replacing the commented-out line" "$(grep -c '^#*HMM_AUTH_MODE' "$TREE/etc/hmm.env") lines" ;;
esac
# the commented-out line of default.env is replaced, not left next to the new one - a second
# assignment further down the file would win when the rc.d script sources it
if [ "$(grep -cE '^ *#? *HMM_AUTH_MODE=' "$TREE/etc/hmm.env")" = 1 ]; then
    pass "exactly one HMM_AUTH_MODE line is left"
else
    fail "exactly one HMM_AUTH_MODE line is left" "$(grep -nE '^ *#? *HMM_AUTH_MODE=' "$TREE/etc/hmm.env")"
fi
case "$(grep -c '^HMM_PORT=8090' "$TREE/etc/hmm.env")" in
    1) pass "and everything else in the file survived the write" ;;
    *) fail "and everything else in the file survived the write" "$(cat "$TREE/etc/hmm.env")" ;;
esac
out="$(cgi settings.cgi 'sid=@1234567890@&cmd=config&auth_mode=token')"
case "$out" in
    *'current: <b>token</b>'*) pass "and switching back works" ;;
    *) fail "and switching back works" "$out" ;;
esac
out="$(cgi settings.cgi 'sid=@1234567890@&cmd=config&auth_mode=oauth')"
case "$out" in
    *'Unbekannter Wert'*) pass "a mode that does not exist is refused" ;;
    *) fail "a mode that does not exist is refused" "$out" ;;
esac
case "$(grep '^HMM_AUTH_MODE' "$TREE/etc/hmm.env")" in
    'HMM_AUTH_MODE=token') pass "and nothing was written for it" ;;
    *) fail "and nothing was written for it" "$(grep 'HMM_AUTH_MODE' "$TREE/etc/hmm.env")" ;;
esac

echo "the log location on the addon settings page (task 43)"
cp -a "$ADDON_SRC/files/hmm/etc/default.env" "$TREE/etc/hmm.env"
printf 'varlog one\n<script>alert("x")</script> & more\n' > "$HMM_SYSTEM_LOG_DIR/hmm.log"
: > "$RC_CALLS"
out="$(cgi settings.cgi 'sid=@1234567890@&cmd=config')"
case "$out" in
    *'<h2>Log</h2>'*'<b>varlog</b>'*'<b>addon</b>'*) pass "a CCU gets the Log section with both locations" ;;
    *) fail "a CCU gets the Log section with both locations" "$out" ;;
esac
case "$out" in
    *'current: <b>varlog</b>'*) pass "unset means varlog, /var/log/hmm.log" ;;
    *) fail "unset means varlog, /var/log/hmm.log" "$out" ;;
esac
case "$out" in
    *'settings.cgi?cmd=config&amp;log=addon&amp;sid=@1234567890@'*) pass "and the link switches to the addon directory" ;;
    *) fail "and the link switches to the addon directory" "$out" ;;
esac
case "$out" in
    *'keine Schreibzugriffe auf die SD-Karte'*'no writes to the SD card'*'schreibt dafür auf die SD-Karte'*'writes to the SD card'*) pass "each with its trade-off, in German and English" ;;
    *) fail "each with its trade-off, in German and English" "$out" ;;
esac
case "$out" in
    *'<pre>varlog one'*'&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; more'*'</pre>'*) pass "the last lines of /var/log/hmm.log are shown, HTML-escaped" ;;
    *) fail "the last lines of /var/log/hmm.log are shown, HTML-escaped" "$out" ;;
esac
case "$out" in
    *'<script>alert'*) fail "and no log line reaches the page as markup" "$out" ;;
    *) pass "and no log line reaches the page as markup" ;;
esac
case "$out" in
    *'occulited'*) fail "and no journal line on a CCU" "$out" ;;
    *) pass "and no journal line on a CCU" ;;
esac
out="$(cgi settings.cgi 'sid=@1234567890@&cmd=config&log=addon')"
case "$out" in
    *'current: <b>addon</b>'*) pass "switching to the addon directory is saved" ;;
    *) fail "switching to the addon directory is saved" "$out" ;;
esac
case "$(grep -E '^ *#? *HMM_ADDON_LOG=' "$TREE/etc/hmm.env")" in
    'HMM_ADDON_LOG=addon') pass "as the one HMM_ADDON_LOG line of etc/hmm.env, replacing the commented-out one" ;;
    *) fail "as the one HMM_ADDON_LOG line of etc/hmm.env, replacing the commented-out one" "$(grep -n 'HMM_ADDON_LOG' "$TREE/etc/hmm.env")" ;;
esac
case "$(cat "$RC_CALLS")" in
    restart) pass "and the service is restarted through rc.d" ;;
    *) fail "and the service is restarted through rc.d" "$(cat "$RC_CALLS")" ;;
esac
case "$out" in
    *'Saved, the service was restarted.'*) pass "and the page says so" ;;
    *) fail "and the page says so" "$out" ;;
esac
case "$out" in
    *'&amp;log=varlog'*) pass "the link now switches back to /var/log" ;;
    *) fail "the link now switches back to /var/log" "$out" ;;
esac
case "$out" in
    *'<pre>line one'*'line two'*'</pre>'*) pass "and the log shown follows the setting" ;;
    *) fail "and the log shown follows the setting" "$out" ;;
esac
: > "$RC_CALLS"
cgi settings.cgi 'sid=@1234567890@&cmd=config&log=addon' >/dev/null
if [ -s "$RC_CALLS" ]; then
    fail "choosing the location that is already set restarts nothing" "$(cat "$RC_CALLS")"
else
    pass "choosing the location that is already set restarts nothing"
fi
out="$(cgi settings.cgi 'sid=@1234567890@&cmd=config&log=syslog')"
case "$out" in
    *'Unbekannter Wert'*) pass "a location that does not exist is refused" ;;
    *) fail "a location that does not exist is refused" "$out" ;;
esac
if [ "$(grep '^HMM_ADDON_LOG' "$TREE/etc/hmm.env")" = 'HMM_ADDON_LOG=addon' ] && [ ! -s "$RC_CALLS" ]; then
    pass "and nothing was written or restarted for it"
else
    fail "and nothing was written or restarted for it" "$(grep 'HMM_ADDON_LOG' "$TREE/etc/hmm.env"; cat "$RC_CALLS")"
fi
out="$(cgi settings.cgi 'sid=@1234567890@&cmd=config&log=varlog')"
if [ "$(grep '^HMM_ADDON_LOG' "$TREE/etc/hmm.env")" = 'HMM_ADDON_LOG=varlog' ] && [ "$(cat "$RC_CALLS")" = restart ]; then
    pass "switching back to /var/log writes varlog and restarts"
else
    fail "switching back to /var/log writes varlog and restarts" "$(grep 'HMM_ADDON_LOG' "$TREE/etc/hmm.env"; cat "$RC_CALLS")"
fi
case "$out" in
    *'current: <b>varlog</b>'*'<pre>varlog one'*) pass "and the page shows /var/log/hmm.log again" ;;
    *) fail "and the page shows /var/log/hmm.log again" "$out" ;;
esac
rm -f "$HMM_SYSTEM_LOG_DIR/hmm.log"

echo "the addon settings page on openccu-lite (D-40)"
# The firmware's own file, with the extra line openccu-lite identifies itself by (their D-17). The
# CGI reads it at every request, so the same package shows the mode that fits the box it is on.
LITE_VERSION="$TMP/VERSION-lite"
printf 'VERSION=3.89.8.20260719\nPRODUCT=ova\nPLATFORM=ova\nVARIANT=lite\n' > "$LITE_VERSION"
CCU_VERSION="$TMP/VERSION-ccu"
printf 'VERSION=3.83.5.20250401\nPRODUCT=HM-RASPBERRYMATIC\nPLATFORM=oci\n' > "$CCU_VERSION"

# start from a file with no HMM_AUTH_MODE at all, which is what "unset" means on both firmwares
cp -a "$ADDON_SRC/files/hmm/etc/default.env" "$TREE/etc/hmm.env"
out="$(cd "$TREE/www" && QUERY_STRING='sid=@1234567890@&cmd=config' HMM_VERSION_FILE="$LITE_VERSION" HMM_OCCULITE_URL="$STATE_URL" HTTP_X_OCCULITE_SESSION="$LIVE" tclsh "$STUB" settings.cgi 2>&1)"
case "$out" in
    *'current: <b>occulite</b>'*) pass "unset means occulite on a box with VARIANT=lite" ;;
    *) fail "unset means occulite on a box with VARIANT=lite" "$out" ;;
esac
case "$out" in
    *'?sid=@...@'*) pass "and the page explains the hand-over instead of the ReGa login" ;;
    *) fail "and the page explains the hand-over instead of the ReGa login" "$out" ;;
esac
case "$out" in
    *'auth_mode=rega'*) fail "and rega is not offered there" "$out" ;;
    *) pass "and rega is not offered there" ;;
esac
case "$out" in
    *'href="/log?unit=addon-hmm"'*) pass "and it links the box's Log page for the addon's log (task 41)" ;;
    *) fail "and it links the box's Log page for the addon's log (task 41)" "$out" ;;
esac
case "$out" in
    *"Auf openccu-lite steht das Log im Journal der Box; wo es gespeichert wird, stellt man"*"On openccu-lite the log is in the box's journal; its storage is configured in"*) pass "with the journal line, in German and English (task 43)" ;;
    *) fail "with the journal line, in German and English (task 43)" "$out" ;;
esac
case "$out" in
    *'log=addon'* | *'log=varlog'* | *'<b>varlog</b>'* | *'<pre>'*) fail "and no location to choose, no log file shown" "$out" ;;
    *) pass "and no location to choose, no log file shown" ;;
esac
: > "$RC_CALLS"
out="$(cd "$TREE/www" && QUERY_STRING='sid=@1234567890@&cmd=config&log=addon' HMM_VERSION_FILE="$LITE_VERSION" HMM_OCCULITE_URL="$STATE_URL" HTTP_X_OCCULITE_SESSION="$LIVE" tclsh "$STUB" settings.cgi 2>&1)"
case "$out" in
    *'nichts umzustellen'*) pass "a switch of the log location is refused on a lite box" ;;
    *) fail "a switch of the log location is refused on a lite box" "$out" ;;
esac
if grep -q '^HMM_ADDON_LOG' "$TREE/etc/hmm.env" || [ -s "$RC_CALLS" ]; then
    fail "and nothing was written or restarted for it" "$(grep 'HMM_ADDON_LOG' "$TREE/etc/hmm.env"; cat "$RC_CALLS")"
else
    pass "and nothing was written or restarted for it"
fi
out="$(cd "$TREE/www" && QUERY_STRING='sid=@1234567890@&cmd=config' HMM_VERSION_FILE="$CCU_VERSION" tclsh "$STUB" settings.cgi 2>&1)"
case "$out" in
    *'current: <b>token</b>'*) pass "unset means token on a CCU, exactly as before" ;;
    *) fail "unset means token on a CCU, exactly as before" "$out" ;;
esac
case "$out" in
    *'auth_mode=rega'*) pass "and rega is what is offered there" ;;
    *) fail "and rega is what is offered there" "$out" ;;
esac
case "$out" in
    *'/log?unit=addon-hmm'*) fail "and no Log page link on a CCU" "$out" ;;
    *) pass "and no Log page link on a CCU" ;;
esac
# a mode that belongs to the other firmware is refused rather than written into hmm.env
out="$(cd "$TREE/www" && QUERY_STRING='sid=@1234567890@&cmd=config&auth_mode=rega' HMM_VERSION_FILE="$LITE_VERSION" HMM_OCCULITE_URL="$STATE_URL" HTTP_X_OCCULITE_SESSION="$LIVE" tclsh "$STUB" settings.cgi 2>&1)"
case "$out" in
    *'Unbekannter Wert'*) pass "rega is refused on a lite box" ;;
    *) fail "rega is refused on a lite box" "$out" ;;
esac
if grep -q '^HMM_AUTH_MODE' "$TREE/etc/hmm.env"; then
    fail "and nothing was written for it" "$(grep '^HMM_AUTH_MODE' "$TREE/etc/hmm.env")"
else
    pass "and nothing was written for it"
fi
# choosing what is already the effective mode writes nothing: unset is the better state, because it
# is the one that still fits after the same /usr/local has been moved to the other firmware
out="$(cd "$TREE/www" && QUERY_STRING='sid=@1234567890@&cmd=config&auth_mode=occulite' HMM_VERSION_FILE="$LITE_VERSION" HMM_OCCULITE_URL="$STATE_URL" HTTP_X_OCCULITE_SESSION="$LIVE" tclsh "$STUB" settings.cgi 2>&1)"
if grep -q '^HMM_AUTH_MODE' "$TREE/etc/hmm.env"; then
    fail "choosing the mode that is already effective writes nothing" "$(grep '^HMM_AUTH_MODE' "$TREE/etc/hmm.env")"
else
    pass "choosing the mode that is already effective writes nothing"
fi
out="$(cd "$TREE/www" && QUERY_STRING='sid=@1234567890@&cmd=config&auth_mode=token' HMM_VERSION_FILE="$LITE_VERSION" HMM_OCCULITE_URL="$STATE_URL" HTTP_X_OCCULITE_SESSION="$LIVE" tclsh "$STUB" settings.cgi 2>&1)"
case "$out" in
    *'current: <b>token</b>'*) pass "switching a lite box to token works" ;;
    *) fail "switching a lite box to token works" "$out" ;;
esac
# B-22: as the firmware's own line, HMM_AUTH_MODE_LITE, replacing its commented-out default; the CCU's
# HMM_AUTH_MODE is left as it was, for the day the same /usr/local is moved back to a CCU
case "$(grep '^HMM_AUTH_MODE_LITE=' "$TREE/etc/hmm.env")" in
    'HMM_AUTH_MODE_LITE=token') pass "and is written into etc/hmm.env as HMM_AUTH_MODE_LITE (B-22)" ;;
    *) fail "and is written into etc/hmm.env as HMM_AUTH_MODE_LITE (B-22)" "$(grep 'HMM_AUTH_MODE' "$TREE/etc/hmm.env")" ;;
esac
if [ "$(grep -cE '^ *#? *HMM_AUTH_MODE_LITE=' "$TREE/etc/hmm.env")" = 1 ]; then
    pass "exactly one HMM_AUTH_MODE_LITE line is left"
else
    fail "exactly one HMM_AUTH_MODE_LITE line is left" "$(grep -nE '^ *#? *HMM_AUTH_MODE_LITE=' "$TREE/etc/hmm.env")"
fi
if grep -q '^HMM_AUTH_MODE=' "$TREE/etc/hmm.env"; then
    fail "and the CCU's HMM_AUTH_MODE line is not touched" "$(grep 'HMM_AUTH_MODE' "$TREE/etc/hmm.env")"
else
    pass "and the CCU's HMM_AUTH_MODE line is not touched"
fi
case "$out" in
    *'This writes HMM_AUTH_MODE_LITE to'*) pass "and the page names the line it writes" ;;
    *) fail "and the page names the line it writes" "$out" ;;
esac
out="$(cd "$TREE/www" && QUERY_STRING='sid=@1234567890@&cmd=config&auth_mode=occulite' HMM_VERSION_FILE="$LITE_VERSION" HMM_OCCULITE_URL="$STATE_URL" HTTP_X_OCCULITE_SESSION="$LIVE" tclsh "$STUB" settings.cgi 2>&1)"
case "$(grep '^HMM_AUTH_MODE_LITE=' "$TREE/etc/hmm.env")" in
    'HMM_AUTH_MODE_LITE=occulite') pass "and back to occulite, which is written this time" ;;
    *) fail "and back to occulite, which is written this time" "$(grep 'HMM_AUTH_MODE' "$TREE/etc/hmm.env")" ;;
esac
case "$out" in
    *'current: <b>occulite</b>'*) pass "and the page says so" ;;
    *) fail "and the page says so" "$out" ;;
esac

echo "a CCU install's HMM_AUTH_MODE=token on an openccu-lite box (B-22)"
# The file every install from the CCU days has (task 13's default.env wrote the line, and so does the
# CCU's settings page): moved to openccu-lite with the upgrade, it kept the addon in token mode, where
# the box's shell can never get in. The page shows what rc.d/hmm runs: occulite, and says why.
cp -a "$ADDON_SRC/files/hmm/etc/default.env" "$TREE/etc/hmm.env"
printf 'HMM_AUTH_MODE=token\n' >> "$TREE/etc/hmm.env"
: > "$RC_CALLS"
out="$(cd "$TREE/www" && QUERY_STRING='sid=@1234567890@&cmd=config' HMM_VERSION_FILE="$LITE_VERSION" HMM_OCCULITE_URL="$STATE_URL" HTTP_X_OCCULITE_SESSION="$LIVE" tclsh "$STUB" settings.cgi 2>&1)"
case "$out" in
    *'current: <b>occulite</b>'*) pass "HMM_AUTH_MODE=token from the CCU days shows occulite on a lite box" ;;
    *) fail "HMM_AUTH_MODE=token from the CCU days shows occulite on a lite box" "$out" ;;
esac
case "$out" in
    *'HMM_AUTH_MODE=token is in the file as well'*"is a CCU's setting and is not read on openccu-lite"*) pass "and the page says the CCU's line is not read here" ;;
    *) fail "and the page says the CCU's line is not read here" "$out" ;;
esac
out="$(cd "$TREE/www" && QUERY_STRING='sid=@1234567890@&cmd=config&auth_mode=occulite' HMM_VERSION_FILE="$LITE_VERSION" HMM_OCCULITE_URL="$STATE_URL" HTTP_X_OCCULITE_SESSION="$LIVE" tclsh "$STUB" settings.cgi 2>&1)"
if grep -q '^HMM_AUTH_MODE_LITE' "$TREE/etc/hmm.env" || [ -s "$RC_CALLS" ]; then
    fail "choosing occulite there writes nothing, it is what runs" "$(grep 'HMM_AUTH_MODE' "$TREE/etc/hmm.env"; cat "$RC_CALLS")"
else
    pass "choosing occulite there writes nothing, it is what runs"
fi
# a token deliberately chosen on a lite box: the marker line, which the page writes (above) and a
# user may write by hand
printf 'HMM_AUTH_MODE_LITE=token\n' >> "$TREE/etc/hmm.env"
out="$(cd "$TREE/www" && QUERY_STRING='sid=@1234567890@&cmd=config' HMM_VERSION_FILE="$LITE_VERSION" HMM_OCCULITE_URL="$STATE_URL" HTTP_X_OCCULITE_SESSION="$LIVE" tclsh "$STUB" settings.cgi 2>&1)"
case "$out" in
    *'current: <b>token</b>'*) pass "HMM_AUTH_MODE_LITE=token shows token on a lite box" ;;
    *) fail "HMM_AUTH_MODE_LITE=token shows token on a lite box" "$out" ;;
esac
# the same file on a CCU: the lite line is not read, the CCU's own line is - rega here
sed -i 's/^HMM_AUTH_MODE=token$/HMM_AUTH_MODE=rega/' "$TREE/etc/hmm.env"
out="$(cd "$TREE/www" && QUERY_STRING='sid=@1234567890@&cmd=config' HMM_VERSION_FILE="$CCU_VERSION" tclsh "$STUB" settings.cgi 2>&1)"
case "$out" in
    *'current: <b>rega</b>'*) pass "on a CCU the same file means rega: HMM_AUTH_MODE_LITE is not read there" ;;
    *) fail "on a CCU the same file means rega: HMM_AUTH_MODE_LITE is not read there" "$out" ;;
esac
case "$out" in
    *"is a CCU's setting and is not read"*) fail "and no note about the CCU's line on a CCU" "$out" ;;
    *) pass "and no note about the CCU's line on a CCU" ;;
esac
# a value of the lite line that is not a lite mode: rega, a typo, nothing - occulite, exactly as
# rc.d/hmm runs it
for value in rega occulite2 ''; do
    sed -i "s/^HMM_AUTH_MODE_LITE=.*/HMM_AUTH_MODE_LITE=$value/" "$TREE/etc/hmm.env"
    out="$(cd "$TREE/www" && QUERY_STRING='sid=@1234567890@&cmd=config' HMM_VERSION_FILE="$LITE_VERSION" HMM_OCCULITE_URL="$STATE_URL" HTTP_X_OCCULITE_SESSION="$LIVE" tclsh "$STUB" settings.cgi 2>&1)"
    case "$out" in
        *'current: <b>occulite</b>'*) pass "HMM_AUTH_MODE_LITE=$value shows occulite on a lite box" ;;
        *) fail "HMM_AUTH_MODE_LITE=$value shows occulite on a lite box" "$out" ;;
    esac
done
cp -a "$ADDON_SRC/files/hmm/etc/default.env" "$TREE/etc/hmm.env"

echo "no update of the addon's own on the settings page (task 54)"
# On openccu-lite the box updates its addons (openccu-lite task 140), so the addon offers no update
# check, download or installer of its own - and none on a CCU either, where the WebUI's
# Zusatzsoftware page asks update_check.cgi, not this page. The settings page shows no version, so
# it has no line pointing at the box's Addons page either. Checked on the whole output.
UPDATE_WORDS='update|download|herunterlad|aktualisier|install|github|releases'
# no_update_action <name> <output>
no_update_action() {
    if printf '%s' "$2" | grep -qiE "$UPDATE_WORDS"; then
        fail "$1" "$(printf '%s' "$2" | grep -iE "$UPDATE_WORDS")"
    else
        pass "$1"
    fi
}
out="$(cd "$TREE/www" && QUERY_STRING='cmd=config' HMM_VERSION_FILE="$LITE_VERSION" HMM_OCCULITE_URL="$STATE_URL" \
    HTTP_X_OCCULITE_SESSION="$LIVE" tclsh "$STUB" settings.cgi 2>&1)"
case "$out" in
    *'Anmeldung / Login'*) no_update_action "VARIANT=lite: the settings page offers no update, download or installer" "$out" ;;
    *) fail "VARIANT=lite: the settings page offers no update, download or installer" "the page did not render: $out" ;;
esac
out="$(cd "$TREE/www" && QUERY_STRING='sid=@1234567890@&cmd=config' HMM_VERSION_FILE="$CCU_VERSION" tclsh "$STUB" settings.cgi 2>&1)"
case "$out" in
    *'Anmeldung / Login'*) no_update_action "on a CCU it offers none either" "$out" ;;
    *) fail "on a CCU it offers none either" "the page did not render: $out" ;;
esac
# the hand-over on a lite box is a redirect into the UI and nothing else
out="$(cd "$TREE/www" && QUERY_STRING='' HMM_VERSION_FILE="$LITE_VERSION" HMM_OCCULITE_URL="$STATE_URL" \
    HTTP_X_OCCULITE_SESSION="$LIVE" tclsh "$STUB" settings.cgi 2>&1)"
case "$out" in
    *'Location: /addons/hmm/'*) no_update_action "VARIANT=lite: the hand-over redirects into the UI, with no update in it" "$out" ;;
    *) fail "VARIANT=lite: the hand-over redirects into the UI, with no update in it" "$out" ;;
esac
# service.cgi's status names the versions and offers nothing to do with them
out="$(cd "$TREE/www" && QUERY_STRING='cmd=status' HMM_VERSION_FILE="$LITE_VERSION" HMM_OCCULITE_URL="$STATE_URL" \
    HTTP_X_OCCULITE_SESSION="$LIVE" tclsh "$STUB" service.cgi 2>&1)"
case "$out" in
    *'"VERSION_ADDON":"3.0.0-dev.0"'*) no_update_action "VARIANT=lite: service.cgi's status carries no update action" "$out" ;;
    *) fail "VARIANT=lite: service.cgi's status carries no update action" "$out" ;;
esac

echo "the openccu-lite session header on settings.cgi and service.cgi (task 50)"
# The box's gate hands a CGI the validated session as HTTP_X_OCCULITE_SESSION. The stub started at
# the top is the box the CGI asks about it (GET /api/auth/v1/state with the id as Bearer). ReGa
# refuses every ?sid= in this section (HMM_TEST_SESSION=invalid), so only the header can admit,
# unless a case says otherwise.
# lite_cgi <script> <query> <header>: the CGI on a lite box, the header as the gate sets it
lite_cgi() {
    (cd "$TREE/www" && QUERY_STRING="$2" HMM_VERSION_FILE="$LITE_VERSION" HMM_OCCULITE_URL="$STATE_URL" \
        HTTP_X_OCCULITE_SESSION="$3" HMM_TEST_SESSION=invalid tclsh "$STUB" "$1" 2>&1)
}
# the settings pages above asked about their administrator's header
state_calls >/dev/null

out="$(lite_cgi settings.cgi '' "$LIVE")"
case "$out" in
    *'Status: 302 Found'*) pass "a header the box confirms: the hand-over redirects into the UI without ?sid=" ;;
    *) fail "a header the box confirms: the hand-over redirects into the UI without ?sid=" "$out" ;;
esac
case "$out" in
    *'Set-Cookie: hmm_token=deadbeefcafebabe0123456789abcdef; Path=/addons/hmm/; HttpOnly; SameSite=Strict'*) pass "with the same token cookie as the ?sid= hand-over" ;;
    *) fail "with the same token cookie as the ?sid= hand-over" "$out" ;;
esac
case "$out" in
    *'Location: /addons/hmm/'*) pass "to the UI, where the frontend reads the header itself" ;;
    *) fail "to the UI, where the frontend reads the header itself" "$out" ;;
esac
calls="$(state_calls)"
if [ "$calls" = "GET /api/auth/v1/state Bearer $LIVE" ]; then
    pass "the box was asked exactly once, with the id as Bearer"
else
    fail "the box was asked exactly once, with the id as Bearer" "$calls"
fi
out="$(lite_cgi settings.cgi 'cmd=config' "$LIVE")"
case "$out" in
    *'Anmeldung / Login'*) pass "and ?cmd=config renders the settings page with the header alone" ;;
    *) fail "and ?cmd=config renders the settings page with the header alone" "$out" ;;
esac
case "$out" in
    *'&amp;sid='* | *'settings.cgi?sid='*) fail "whose links carry no sid" "$out" ;;
    *) pass "whose links carry no sid" ;;
esac
case "$out" in
    *'href="/addons/hmm/">Homematic Manager'*) pass "and whose open link goes to the UI directly" ;;
    *) fail "and whose open link goes to the UI directly" "$out" ;;
esac
state_calls >/dev/null
out="$(lite_cgi settings.cgi 'sid=@1234567890@' "$LIVE")"
case "$out" in
    *'Status: 302 Found'*) pass "the header comes first: a ?sid= ReGa refuses next to a confirmed header is let in" ;;
    *) fail "the header comes first: a ?sid= ReGa refuses next to a confirmed header is let in" "$out" ;;
esac
state_calls >/dev/null
out="$(lite_cgi service.cgi 'cmd=status' "$LIVE")"
case "$out" in
    *'"running"'*) pass "service.cgi takes the header too (the log view is a page the shell opens)" ;;
    *) fail "service.cgi takes the header too (the log view is a page the shell opens)" "$out" ;;
esac
state_calls >/dev/null
# an image from before occulited's task 125 hands out ten-character ids, and the gate sends those
out="$(lite_cgi settings.cgi '' "$OLD")"
case "$out" in
    *'Status: 302 Found'*) pass "a ten-character session id of an older image is asked about and let in" ;;
    *) fail "a ten-character session id of an older image is asked about and let in" "$out" ;;
esac
calls="$(state_calls)"
if [ "$calls" = "GET /api/auth/v1/state Bearer $OLD" ]; then
    pass "with that id as Bearer"
else
    fail "with that id as Bearer" "$calls"
fi

# what the box does not confirm is refused, and every failure is a refusal
for case in "UNKNOWNUNKNOWNUNKNOWNUNK22:an id the box does not know" "$NOSID:a state without a sid (what a box answers for an API token)" \
    "$OTHER:a state that names another session" "$BROKEN:a 500 from the box" "$GARBAGE:an answer that is no JSON"; do
    id="${case%%:*}"
    what="${case#*:}"
    out="$(lite_cgi settings.cgi '' "$id")"
    case "$out" in
        *'Sitzung ungültig'*) pass "$what is refused" ;;
        *) fail "$what is refused" "$out" ;;
    esac
    case "$out" in
        *deadbeefcafebabe*) fail "and never sees the token" "$out" ;;
        *) pass "and never sees the token" ;;
    esac
    calls="$(state_calls)"
    case "$calls" in
        "GET /api/auth/v1/state Bearer $id") pass "after the box was asked" ;;
        *) fail "after the box was asked" "$calls" ;;
    esac
done
out="$(lite_cgi service.cgi 'cmd=status' "UNKNOWNUNKNOWNUNKNOWNUNK22")"
case "$out" in
    *'"error":"invalid session"'*) pass "service.cgi refuses an unconfirmed header" ;;
    *) fail "service.cgi refuses an unconfirmed header" "$out" ;;
esac
state_calls >/dev/null
out="$(cd "$TREE/www" && QUERY_STRING='' HMM_VERSION_FILE="$LITE_VERSION" HMM_OCCULITE_URL="http://127.0.0.1:1" \
    HTTP_X_OCCULITE_SESSION="$LIVE" HMM_TEST_SESSION=invalid tclsh "$STUB" settings.cgi 2>&1)"
case "$out" in
    *'Sitzung ungültig'*) pass "a box that cannot be asked (connection refused) means refused, not admitted" ;;
    *) fail "a box that cannot be asked (connection refused) means refused, not admitted" "$out" ;;
esac

# a value that cannot be an openccu-lite session id on any image never reaches the box (the
# frontend's shapes, B-36): only 26 of [A-Z2-7] or ten alphanumerics go into an Authorization header
crlf="$(printf '%s\r\nX-Injected: 1' "$LIVE")"
for case in "@$LIVE@:an @-wrapped id" "$crlf:an id with a line break" "$LIVE $LIVE:two ids" "$LIVE:x:an id with a colon" \
    "olt_0123456789abcdef0123456789abcdef:an API token of the box's shape" "abcdefghijklmnopqrstuvwxyz:26 lower-case letters" \
    "ABCDEFGHIJKLMNOPQRSTUVWXY:25 characters" "ABCDEFGHIJKLMNOPQRSTUVWXYZ2:27 characters" "abcdefgh123:eleven alphanumerics" \
    "abcdefgh1:nine alphanumerics" ":an empty header"; do
    id="${case%:*}"
    what="${case##*:}"
    out="$(lite_cgi settings.cgi '' "$id")"
    case "$out" in
        *'Sitzung ungültig'*) pass "$what is refused" ;;
        *) fail "$what is refused" "$out" ;;
    esac
    calls="$(state_calls)"
    if [ -z "$calls" ]; then
        pass "without asking the box"
    else
        fail "without asking the box" "$calls"
    fi
done

# the fallbacks stay: ?sid= through ReGa when the box does not confirm the header (as the
# frontend does, B-36), and the token cookie
out="$(cd "$TREE/www" && QUERY_STRING='sid=@1234567890@' HMM_VERSION_FILE="$LITE_VERSION" HMM_OCCULITE_URL="$STATE_URL" \
    HTTP_X_OCCULITE_SESSION="UNKNOWNUNKNOWNUNKNOWNUNK22" tclsh "$STUB" settings.cgi 2>&1)"
case "$out" in
    *'Status: 302 Found'*) pass "an unconfirmed header falls through to a ?sid= ReGa confirms" ;;
    *) fail "an unconfirmed header falls through to a ?sid= ReGa confirms" "$out" ;;
esac
state_calls >/dev/null
# (the hand-over: on openccu-lite the settings page takes no cookie since B-37, see below)
out="$(cd "$TREE/www" && QUERY_STRING='' HMM_VERSION_FILE="$LITE_VERSION" HMM_OCCULITE_URL="$STATE_URL" \
    HTTP_X_OCCULITE_SESSION="UNKNOWNUNKNOWNUNKNOWNUNK22" HTTP_COOKIE='hmm_token=deadbeefcafebabe0123456789abcdef' \
    HMM_TEST_SESSION=invalid tclsh "$STUB" settings.cgi 2>&1)"
case "$out" in
    *'Status: 302 Found'*) pass "and to the token cookie" ;;
    *) fail "and to the token cookie" "$out" ;;
esac
state_calls >/dev/null

# a CCU passes a client's header straight through to the CGI, so there it is not looked at at all
for case in "$CCU_VERSION:a CCU" "$TMP/no-such-VERSION:a firmware without /VERSION"; do
    file="${case%%:*}"
    what="${case#*:}"
    out="$(cd "$TREE/www" && QUERY_STRING='' HMM_VERSION_FILE="$file" HMM_OCCULITE_URL="$STATE_URL" \
        HTTP_X_OCCULITE_SESSION="$LIVE" HMM_TEST_SESSION=invalid tclsh "$STUB" settings.cgi 2>&1)"
    case "$out" in
        *'Sitzung ungültig'*) pass "$what ignores the header: the confirmed id is refused there" ;;
        *) fail "$what ignores the header: the confirmed id is refused there" "$out" ;;
    esac
    calls="$(state_calls)"
    if [ -z "$calls" ]; then
        pass "and no state call is made"
    else
        fail "and no state call is made" "$calls"
    fi
    out="$(cd "$TREE/www" && QUERY_STRING='sid=@1234567890@' HMM_VERSION_FILE="$file" HMM_OCCULITE_URL="$STATE_URL" \
        HTTP_X_OCCULITE_SESSION="$LIVE" tclsh "$STUB" settings.cgi 2>&1)"
    case "$out" in
        *'Status: 302 Found'*) pass "while ?sid= works there as before" ;;
        *) fail "while ?sid= works there as before" "$out" ;;
    esac
    state_calls >/dev/null
done
echo "on openccu-lite the settings page and service.cgi are for administrators (B-37)"
# D-49: the role comes from the box's state answer and from nothing else - for the session in the
# header, or, where the box does not confirm the header, for the id in ?sid=. ReGa (on a box the
# tclrega shim) confirms a session and knows no role, and the token cookie is one secret for
# everybody the hand-over let in, so on openccu-lite neither opens these two pages. The hand-over
# itself and a CCU are unchanged. The fourth argument says whether ReGa confirms the ?sid=.
cp -a "$ADDON_SRC/files/hmm/etc/default.env" "$TREE/etc/hmm.env"
ENV_BEFORE="$TMP/hmm.env.b37"
cp -a "$TREE/etc/hmm.env" "$ENV_BEFORE"
TOKEN_COOKIE='hmm_token=deadbeefcafebabe0123456789abcdef'
UNKNOWN=UNKNOWNUNKNOWNUNKNOWNUNK22
# b37 <script> <query> <header> [<HMM_TEST_SESSION>] [<cookie>] [<box URL>]: the CGI on a lite box
b37() {
    (cd "$TREE/www" && QUERY_STRING="$2" HMM_VERSION_FILE="$LITE_VERSION" HMM_OCCULITE_URL="${6:-$STATE_URL}" \
        HTTP_X_OCCULITE_SESSION="$3" HMM_TEST_SESSION="${4:-invalid}" HTTP_COOKIE="${5:-}" tclsh "$STUB" "$1" 2>&1)
}
# admin_only <description> <output>: the settings page's 403 in German and English, and nothing of the page
admin_only() {
    case "$2" in
        *'Status: 403 Forbidden'*'Nur für Administratoren.'*'Es wurde nichts geändert.'*'Administrators only.'*'Nothing was changed.'*) pass "$1" ;;
        *) fail "$1" "$2" ;;
    esac
    case "$2" in
        *'Anmeldung / Login'* | *deadbeefcafebabe* | *'Set-Cookie'* | *'Gespeichert'*) fail "  without the settings, the token or a change" "$2" ;;
        *) pass "  without the settings, the token or a change" ;;
    esac
}
# service_refused <description> <output>: service.cgi's 403, and nothing it would answer otherwise
service_refused() {
    case "$2" in
        *'Status: 403 Forbidden'*'{"error":"administrators only"}'*) pass "$1" ;;
        *) fail "$1" "$2" ;;
    esac
    case "$2" in
        *'"running"'* | *'rc.d called'* | *'Location:'* | *'line two'*) fail "  and answers nothing else" "$2" ;;
        *) pass "  and answers nothing else" ;;
    esac
}
# unchanged <description>: etc/hmm.env as it was, and no rc.d call
unchanged() {
    if cmp -s "$ENV_BEFORE" "$TREE/etc/hmm.env" && [ ! -s "$RC_CALLS" ]; then
        pass "$1"
    else
        fail "$1" "$(diff "$ENV_BEFORE" "$TREE/etc/hmm.env"; cat "$RC_CALLS")"
    fi
}
# asked <description> <the ids the box was asked about, in order, space-separated; empty for none>
asked() {
    got="$(state_calls | sed 's|^GET /api/auth/v1/state Bearer ||' | tr '\n' ' ')"
    got="${got% }"
    if [ "$got" = "$2" ]; then
        pass "$1"
    else
        fail "$1" "asked about: '$got'"
    fi
}
state_calls >/dev/null
: > "$RC_CALLS"

# the header, the session the gate validated
out="$(b37 settings.cgi 'cmd=config' "$LIVE")"
case "$out" in
    *'Anmeldung / Login'*) pass "an administrator's session in the header opens the settings page" ;;
    *) fail "an administrator's session in the header opens the settings page" "$out" ;;
esac
asked "  after one question to the box" "$LIVE"
out="$(b37 settings.cgi 'cmd=config' "$USERSID")"
admin_only "a user's session in the header gets the administrators-only page instead" "$out"
asked "  after one question to the box" "$USERSID"
out="$(b37 settings.cgi 'cmd=config&auth_mode=token' "$USERSID")"
admin_only "a user's session in the header cannot switch the mode" "$out"
out="$(b37 settings.cgi 'cmd=config&log=addon' "$USERSID")"
admin_only "nor the log location" "$out"
unchanged "  nothing written, nothing restarted"
state_calls >/dev/null
out="$(b37 service.cgi 'cmd=status' "$USERSID")"
service_refused "service.cgi refuses a user's session in the header: status" "$out"
for cmd in restart stop start log havoc; do
    out="$(b37 service.cgi "cmd=$cmd" "$USERSID")"
    service_refused "  and $cmd" "$out"
done
unchanged "  nothing started, stopped or restarted"
state_calls >/dev/null
out="$(b37 service.cgi 'cmd=restart' "$LIVE")"
case "$out" in
    *'rc.d called with restart'*) pass "an administrator's session in the header restarts the service" ;;
    *) fail "an administrator's session in the header restarts the service" "$out" ;;
esac
: > "$RC_CALLS"
out="$(b37 settings.cgi 'cmd=config&auth_mode=token' "$LIVE")"
if [ "$(grep '^HMM_AUTH_MODE_LITE=' "$TREE/etc/hmm.env")" = 'HMM_AUTH_MODE_LITE=token' ] && [ "$(cat "$RC_CALLS")" = restart ]; then
    pass "and switches the mode: written and restarted"
else
    fail "and switches the mode: written and restarted" "$(grep 'HMM_AUTH_MODE' "$TREE/etc/hmm.env"; cat "$RC_CALLS")"
fi
cp -a "$ENV_BEFORE" "$TREE/etc/hmm.env"
: > "$RC_CALLS"
state_calls >/dev/null

# a header the box confirms decides, and what it does not name as admin is not
out="$(b37 settings.cgi "cmd=config&sid=@$OLDADMIN@" "$USERSID")"
admin_only "a user's confirmed header decides: an administrator's id in ?sid= next to it does not lift it" "$out"
asked "  and ?sid= is not asked" "$USERSID"
for case in "$OLD:a user's ten-character session id of an older image" "$NOROLE:an answer that names no role" \
    "$ADMINCASE:the role Admin, spelled another way" "$ESCROLE:a role with a JSON escape in it" \
    "$FAKEROLE:a user whose name spells \"role\":\"admin\" inside its escaped quotes"; do
    id="${case%%:*}"
    what="${case#*:}"
    out="$(b37 settings.cgi 'cmd=config' "$id")"
    admin_only "$what: administrators only" "$out"
    asked "  after one question" "$id"
done

# every failure of the role lookup is a refusal, whatever else the request carries
for case in "$UNKNOWN:a header the box does not know" "$NOSID:a state without a sid (a token)" \
    "$OTHER:a state that names another session" "$BROKEN:a 500 from the box" "$GARBAGE:an answer that is no JSON"; do
    id="${case%%:*}"
    what="${case#*:}"
    out="$(b37 settings.cgi 'cmd=config&sid=@1234567890@' "$id" valid)"
    admin_only "$what, next to a ?sid= ReGa confirms: administrators only" "$out"
    asked "  after asking about the header, then the ?sid=" "$id 1234567890"
done
out="$(b37 settings.cgi 'cmd=config&sid=@1234567890@' "$LIVE" valid '' 'http://127.0.0.1:1')"
admin_only "a box that cannot be asked (connection refused), next to a ?sid= ReGa confirms: administrators only" "$out"
out="$(b37 settings.cgi 'cmd=config' "$UNKNOWN")"
case "$out" in
    *'Status: 403'*) fail "without any session it stays the invalid-session page, not a 403" "$out" ;;
    *'Sitzung ungültig'*) pass "without any session it stays the invalid-session page, not a 403" ;;
    *) fail "without any session it stays the invalid-session page, not a 403" "$out" ;;
esac
out="$(b37 service.cgi 'cmd=restart' "$UNKNOWN")"
case "$out" in
    *'Status: 403'*) fail "and service.cgi says invalid session, as before" "$out" ;;
    *'{"error":"invalid session"}'*) pass "and service.cgi says invalid session, as before" ;;
    *) fail "and service.cgi says invalid session, as before" "$out" ;;
esac
unchanged "  nothing restarted"
state_calls >/dev/null

# ?sid=, where there is no header the box confirms
out="$(b37 settings.cgi "cmd=config&sid=@$OLDADMIN@" '')"
case "$out" in
    *'Anmeldung / Login'*) pass "no header, ?sid= with an administrator's session id (an image from before task 125): the settings page" ;;
    *) fail "no header, ?sid= with an administrator's session id (an image from before task 125): the settings page" "$out" ;;
esac
asked "  after asking the box about that id" "$OLDADMIN"
out="$(b37 settings.cgi "cmd=config&sid=%40$USERSID%40" '')"
admin_only "no header, ?sid= with a user's session id: administrators only" "$out"
asked "  after asking the box about that id" "$USERSID"
out="$(b37 settings.cgi "cmd=config&sid=@$OLDADMIN@" "$UNKNOWN")"
case "$out" in
    *'Anmeldung / Login'*) pass "a header the box does not confirm falls through to an administrator's ?sid=" ;;
    *) fail "a header the box does not confirm falls through to an administrator's ?sid=" "$out" ;;
esac
asked "  after asking about both" "$UNKNOWN $OLDADMIN"
out="$(b37 settings.cgi 'cmd=config&auth_mode=token&sid=@1234567890@' '' valid)"
admin_only "?sid= with an alias the shim confirms and the box's API refuses: administrators only" "$out"
asked "  after asking the box, which cannot tell the alias's role" "1234567890"
unchanged "  nothing written, nothing restarted"
out="$(b37 service.cgi 'cmd=restart&sid=@1234567890@' '' valid)"
service_refused "service.cgi refuses the same alias" "$out"
unchanged "  nothing restarted"
state_calls >/dev/null
# the gate puts the alias it let a request in by into the header
out="$(b37 settings.cgi 'cmd=config&sid=@1234567890@' 1234567890 valid)"
admin_only "the alias as the header and in ?sid=: administrators only" "$out"
asked "  after one question about it, not two" "1234567890"

# the token cookie
out="$(b37 settings.cgi 'cmd=config&auth_mode=token' '' invalid "a=1; $TOKEN_COOKIE")"
admin_only "the token cookie alone does not open the settings page on openccu-lite" "$out"
unchanged "  nothing written, nothing restarted"
asked "  and the box was not asked" ""
out="$(b37 settings.cgi 'cmd=config' "$USERSID" invalid "$TOKEN_COOKIE")"
admin_only "nor next to a user's session in the header" "$out"
state_calls >/dev/null
out="$(b37 settings.cgi 'cmd=config' '' invalid 'hmm_token=wrong')"
case "$out" in
    *'Status: 403'*) fail "a wrong token cookie gets the invalid-session page" "$out" ;;
    *'Sitzung ungültig'*) pass "a wrong token cookie gets the invalid-session page" ;;
    *) fail "a wrong token cookie gets the invalid-session page" "$out" ;;
esac
out="$(b37 service.cgi 'cmd=restart' '' invalid "$TOKEN_COOKIE")"
case "$out" in
    *'{"error":"invalid session"}'*) pass "service.cgi never took the cookie, and still does not" ;;
    *) fail "service.cgi never took the cookie, and still does not" "$out" ;;
esac
unchanged "  nothing restarted"

# the hand-over is not the settings page: unchanged, a user's session keeps it (what it gets in the
# app is task 52's question)
out="$(b37 settings.cgi '' "$USERSID")"
case "$out" in
    *'Status: 302 Found'*"Set-Cookie: $TOKEN_COOKIE;"*) pass "the hand-over still lets a user's session into the app" ;;
    *) fail "the hand-over still lets a user's session into the app" "$out" ;;
esac
out="$(b37 settings.cgi '' '' invalid "$TOKEN_COOKIE")"
case "$out" in
    *'Status: 302 Found'*) pass "and a browser with the token cookie" ;;
    *) fail "and a browser with the token cookie" "$out" ;;
esac
state_calls >/dev/null

# a CCU and OpenCCU: any WebUI session, as before - ReGa names a user and no level, and no box is asked
# ccu_b37 <VERSION file> <script> <query> <HMM_TEST_SESSION> [<cookie>]: with a client-sent header of a user's session
ccu_b37() {
    (cd "$TREE/www" && QUERY_STRING="$3" HMM_VERSION_FILE="$1" HMM_OCCULITE_URL="$STATE_URL" \
        HTTP_X_OCCULITE_SESSION="$USERSID" HMM_TEST_SESSION="$4" HTTP_COOKIE="${5:-}" tclsh "$STUB" "$2" 2>&1)
}
for case in "$CCU_VERSION:a CCU" "$TMP/no-such-VERSION:a firmware without /VERSION"; do
    file="${case%%:*}"
    what="${case#*:}"
    : > "$RC_CALLS"
    out="$(ccu_b37 "$file" settings.cgi 'cmd=config&sid=@1234567890@' valid)"
    case "$out" in
        *'Status: 403'*) fail "$what: a ?sid= ReGa confirms opens the settings page, as before" "$out" ;;
        *'Anmeldung / Login'*) pass "$what: a ?sid= ReGa confirms opens the settings page, as before" ;;
        *) fail "$what: a ?sid= ReGa confirms opens the settings page, as before" "$out" ;;
    esac
    out="$(ccu_b37 "$file" settings.cgi 'cmd=config' invalid "$TOKEN_COOKIE")"
    case "$out" in
        *'Status: 403'*) fail "  and so does the token cookie" "$out" ;;
        *'Anmeldung / Login'*) pass "  and so does the token cookie" ;;
        *) fail "  and so does the token cookie" "$out" ;;
    esac
    out="$(ccu_b37 "$file" service.cgi 'cmd=restart&sid=@1234567890@' valid)"
    case "$out" in
        *'rc.d called with restart'*) pass "  and service.cgi restarts the service for it" ;;
        *) fail "  and service.cgi restarts the service for it" "$out" ;;
    esac
    asked "  and the box was never asked" ""
done
: > "$RC_CALLS"
cp -a "$ENV_BEFORE" "$TREE/etc/hmm.env"

kill "$STATE_STUB_PID" 2>/dev/null
wait "$STATE_STUB_PID" 2>/dev/null
STATE_STUB_PID=""

echo "rc.d/hmm's LiteAuthMode, the decision itself (B-22)"
# The function as shipped, run under sh with hmm.env's two lines in the environment, the way Start
# has them after sourcing the file. logger goes to a file here.
LITE_AUTH_MODE="$TMP/lite-auth-mode.sh"
sed -n '/^LiteAuthMode() {$/,/^}$/p' "$ADDON_SRC/files/hmm/rc.d/hmm" > "$LITE_AUTH_MODE"
if [ -s "$LITE_AUTH_MODE" ] && grep -q 'printf' "$LITE_AUTH_MODE"; then
    pass "LiteAuthMode could be taken out of rc.d/hmm"
else
    fail "LiteAuthMode could be taken out of rc.d/hmm" "$(cat "$LITE_AUTH_MODE")"
fi
LOGGER_CALLS="$TMP/logger-calls"
# lite_auth_mode <HMM_AUTH_MODE> <HMM_AUTH_MODE_LITE>: prints the mode; the syslog lines go to $LOGGER_CALLS
lite_auth_mode() {
    : > "$LOGGER_CALLS"
    HMM_AUTH_MODE="$1" HMM_AUTH_MODE_LITE="$2" ADDON=hmm sh -c "logger() { printf '%s\n' \"\$*\" >> '$LOGGER_CALLS'; }; . '$LITE_AUTH_MODE'; LiteAuthMode"
}
# lite_case <description> <expected mode> <HMM_AUTH_MODE> <HMM_AUTH_MODE_LITE>
lite_case() {
    got="$(lite_auth_mode "$3" "$4")"
    if [ "$got" = "$2" ]; then
        pass "$1: $2"
    else
        fail "$1: $2" "got '$got'"
    fi
}
lite_case "nothing set" occulite '' ''
lite_case "HMM_AUTH_MODE=token from the CCU days, no lite line" occulite token ''
lite_case "HMM_AUTH_MODE=rega from a CCU, no lite line" occulite rega ''
lite_case "HMM_AUTH_MODE=occulite, what beta.17's page wrote on a lite box" occulite occulite ''
lite_case "HMM_AUTH_MODE=oauth, a value the host would refuse, no lite line" occulite oauth ''
lite_case "a deliberate HMM_AUTH_MODE_LITE=token" token '' token
lite_case "HMM_AUTH_MODE_LITE=token next to the CCU's token" token token token
lite_case "HMM_AUTH_MODE_LITE=token next to the CCU's rega" token rega token
lite_case "HMM_AUTH_MODE_LITE=occulite" occulite '' occulite
lite_case "HMM_AUTH_MODE_LITE=rega, a mode of the CCU's" occulite '' rega
lite_case "HMM_AUTH_MODE_LITE=Token, the wrong case" occulite '' Token
lite_case "HMM_AUTH_MODE_LITE='token ' with a trailing blank inside the quotes" occulite '' 'token '
lite_case "HMM_AUTH_MODE_LITE=token with a Windows line ending" occulite '' "$(printf 'token\r')"
lite_case "HMM_AUTH_MODE_LITE=oauth" occulite '' oauth
lite_case "HMM_AUTH_MODE_LITE=oauth next to the CCU's token" occulite token oauth
lite_auth_mode '' oauth >/dev/null
case "$(cat "$LOGGER_CALLS")" in
    *'HMM_AUTH_MODE_LITE in etc/hmm.env is neither token nor occulite: --auth-mode occulite'*) pass "a value that is no lite mode is said in the syslog" ;;
    *) fail "a value that is no lite mode is said in the syslog" "$(cat "$LOGGER_CALLS")" ;;
esac
case "$(cat "$LOGGER_CALLS")" in
    *oauth*) fail "without the value" "$(cat "$LOGGER_CALLS")" ;;
    *) pass "without the value" ;;
esac
lite_auth_mode token '' >/dev/null
case "$(cat "$LOGGER_CALLS")" in
    *"HMM_AUTH_MODE=token in etc/hmm.env is the CCU's setting and is not read on openccu-lite"*) pass "a CCU's line that would have meant another mode is said in the syslog" ;;
    *) fail "a CCU's line that would have meant another mode is said in the syslog" "$(cat "$LOGGER_CALLS")" ;;
esac
lite_auth_mode occulite '' >/dev/null
if [ -s "$LOGGER_CALLS" ]; then
    fail "a CCU's line that means the same mode is not" "$(cat "$LOGGER_CALLS")"
else
    pass "a CCU's line that means the same mode is not"
fi
# and the line of Start that uses it: on a lite box the answer replaces HMM_AUTH_MODE, on a CCU
# HMM_AUTH_MODE stays what hmm.env made it
case "$(cat "$ADDON_SRC/files/hmm/rc.d/hmm")" in
    *'if grep -q '"'"'^VARIANT=lite$'"'"' /VERSION 2>/dev/null; then
        HMM_AUTH_MODE="$(LiteAuthMode)"'*) pass "Start takes LiteAuthMode's answer as the mode where VARIANT=lite is in /VERSION, and only there" ;;
    *) fail "Start takes LiteAuthMode's answer as the mode where VARIANT=lite is in /VERSION, and only there" "the grep and the assignment are not together in rc.d/hmm" ;;
esac

echo "update_check.cgi"
out="$(cgi update_check.cgi 'cmd=download')"
case "$out" in
    *'github.com/hobbyquaker/homematic-manager/releases/latest'*) pass "the download link points at the releases" ;;
    *) fail "the download link points at the releases" "$out" ;;
esac

echo "tcl 8.2 compatibility (the CCU3 firmware ships 8.2.3)"
# every one of these arrived after 8.2 and fails at runtime on a CCU3, where it would only show up
# as a broken WebUI: dict 8.5, eq/ne 8.4, string is 8.3, {*} 8.5, file normalize 8.4, bare scan 8.4
modern=""
for pattern in 'dict [a-z]' '\{\*\}' 'string is ' '\] eq ' '\] ne ' '\$[a-zA-Z_]* eq ' '\$[a-zA-Z_]* ne ' 'file normalize' 'lassign ' '\[scan [^]]*%[a-z]\]'; do
    hits="$(grep -rnE "$pattern" files/hmm/www/*.cgi files/hmm/www/lib/*.tcl files/hmm/bin/update_addon 2>/dev/null | grep -v '^[^:]*:[0-9]*: *#' || true)"
    [ -n "$hits" ] && modern="$modern$hits\n"
done
if [ -z "$modern" ]; then
    pass "no tcl construct newer than 8.2 in the shipped scripts"
else
    fail "no tcl construct newer than 8.2 in the shipped scripts" "$(printf '%b' "$modern")"
fi

echo "what the Zusatzsoftware page shows (#140)"
# cp_software.cgi reads `rc.d/hmm info` through a Tcl pipe in iso8859-1 and writes the lines into
# its Latin-1 page as they are, and the Systemsteuerung page does the same with hm_addons.cfg: a
# UTF-8 umlaut arrives as "GerÃ¤te". Both have to be ASCII, umlauts as HTML entities.
info="$(sh files/hmm/rc.d/hmm info 2>/dev/null)"
case "$info" in
    *'Ger&auml;te, Verkn&uuml;pfungen'*) pass "the Info line spells its umlauts as entities" ;;
    *) fail "the Info line spells its umlauts as entities" "$info" ;;
esac
if printf '%s' "$info" | LC_ALL=C grep -q '[^ -~]'; then
    fail "rc.d/hmm info is plain ASCII" "$(printf '%s' "$info" | LC_ALL=C grep '[^ -~]')"
else
    pass "rc.d/hmm info is plain ASCII"
fi
if LC_ALL=C grep -q '[^ -~]' files/hmm.cfg; then
    fail "hmm.cfg is plain ASCII" "$(cat files/hmm.cfg)"
else
    pass "hmm.cfg is plain ASCII"
fi
# an unknown command (cp_software.cgi also asks for info.de and info.en) must print nothing on
# stdout: every line of it would be parsed as a Key: value pair
if [ -z "$(sh files/hmm/rc.d/hmm info.de 2>/dev/null)" ]; then
    pass "info.de stays quiet on stdout"
else
    fail "info.de stays quiet on stdout" "$(sh files/hmm/rc.d/hmm info.de 2>/dev/null)"
fi

echo "the shell scripts are POSIX sh (busybox ash runs them)"
for script in files/update_script files/hmm/rc.d/hmm; do
    if sh -n "$script" 2>/dev/null; then
        pass "$script parses as sh"
    else
        fail "$script parses as sh" "$(sh -n "$script" 2>&1)"
    fi
done
if command -v shellcheck >/dev/null 2>&1; then
    for script in files/update_script files/hmm/rc.d/hmm; do
        if out="$(shellcheck -S error -s sh "$script" 2>&1)"; then
            pass "shellcheck -S error is clean on $script"
        else
            fail "shellcheck -S error is clean on $script" "$out"
        fi
    done
else
    skip "shellcheck on the addon scripts" "shellcheck is not installed"
fi

echo "the host is started the way the addon needs it"
rc=files/hmm/rc.d/hmm
for expected in '--local' '--ccu 127.0.0.1' '--base /addons/$ADDON' '--host 127.0.0.1' '--no-issue-cookie' '--data-dir $STATE_DIR'; do
    case "$(cat $rc)" in
        *"$expected"*) pass "rc.d passes $expected" ;;
        *) fail "rc.d passes $expected" "not in $rc" ;;
    esac
done
case "$(cat $rc)" in
    *'--token'*) fail "the token never appears on the command line" "an argument is world-readable in ps" ;;
    *'export HMM_TOKEN'*) pass "the token is handed over in the environment, not in ps" ;;
    *) fail "the token is handed over in the environment" "neither --token nor HMM_TOKEN in $rc" ;;
esac
case "$(cat $rc)" in
    *'export HOME="$ADDON_DIR"'*) pass "HOME is pinned to the addon directory" ;;
    *) fail "HOME is pinned to the addon directory" "rc.d does not export HOME" ;;
esac
case "$(cat $rc)" in
    *'STATE_DIR=/usr/local/hmm'*) pass "the profile lives outside the addon tree" ;;
    *) fail "the profile lives outside the addon tree" "STATE_DIR is not /usr/local/hmm" ;;
esac

echo "the lighttpd rule"
conf=files/hmm/etc/lighttpd.conf
case "$(cat $conf)" in
    *'proxy.header = ("upgrade" => "enable")'*) pass "enables the WebSocket upgrade (RedMatic's proven line)" ;;
    *) fail "enables the WebSocket upgrade" "$(cat $conf)" ;;
esac
case "$(cat $conf)" in
    *'@PORT@'*) pass "the port is substituted at install time" ;;
    *) fail "the port is substituted at install time" "no @PORT@ placeholder" ;;
esac
for name in settings service update_check; do
    case "$(cat $conf)" in
        *"$name\\.cgi"*) pass "$name.cgi stays with lighttpd instead of being proxied" ;;
        *) fail "$name.cgi stays with lighttpd instead of being proxied" "$(cat $conf)" ;;
    esac
done

echo "the addon writes only inside /usr/local"
outside="$(grep -rnE '(^|[^a-zA-Z0-9_/.])(/root|/home|/var/lib|~)/' files/ | grep -v 'var/run' || true)"
if [ -z "$outside" ]; then
    pass "no shipped file points outside /usr/local"
else
    fail "no shipped file points outside /usr/local" "$outside"
fi

echo
if [ "$failed" = 0 ]; then
    echo "all CGI tests passed"
else
    echo "CGI tests failed"
fi
exit $failed
