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

cd "$(dirname "$0")/.."
ADDON_SRC="$PWD"
command -v tclsh >/dev/null || {
    echo "tclsh is required" >&2
    exit 1
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

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
printf '#!/bin/sh\necho "rc.d called with $1"\n' > "$HMM_RC_SCRIPT"
chmod +x "$HMM_RC_SCRIPT"

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
out="$(cgi service.cgi 'sid=@1234567890@&cmd=havoc')"
case "$out" in
    *'unknown command'*) pass "refuses an unknown command" ;;
    *) fail "refuses an unknown command" "$out" ;;
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
