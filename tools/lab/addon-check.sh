#!/bin/sh
# Post-install checklist for the Homematic Manager CCU addon, one box at a time.
#
# Run it after installing or updating the addon on a lab CCU, and read the output. It only reads:
# no `rm`, no restart, no configuration change - so it is safe to run on a box someone is using.
#
#   HMM_LAB_SSH=<ssh target>  HMM_LAB_URL=https://<ccu>  [HMM_LAB_SID=<webui session id>] \
#   [HMM_LAB_ADDON=hmm]  sh tools/lab/addon-check.sh
#
# **Every value comes from the environment.** There is no default host, no alias and no credential
# in this file, and there must never be one: the lab's addresses and logins live in the maintainer's
# private note (AGENTS.md). `HMM_LAB_SSH` is whatever `ssh` accepts - normally an alias from
# `~/.ssh/config`, so the key and the user stay there too. `HMM_LAB_SID` is the ten-character WebUI
# session id; without it the checks that need a session are skipped rather than guessed at.
#
# This is deliberately a checklist and not a test: it prints what it found and never decides that a
# box is broken. A CCU3 with the firmware's own lighttpd, an OpenCCU and a container each answer a
# little differently, and the person reading the output is the one who knows which is which.
#
# Status: written by task 14 alongside the addon of task 13, first run against hardware in task 17
# on 2026-09-05 - which is where the paths below come from. What it got wrong before that run, and
# what the corrected version therefore looks for now:
#
#   * the version is in `versions` (`VERSION_ADDON=`), there is no `VERSION` file
#   * the lighttpd rule is `lighttpd/hmm.conf`, not a fragment under `lighttpd/conf.d/`
#   * monit reads `/usr/local/etc/monit-hmm.cfg`, and `monit status` is what says whether the check
#     is armed at all - `monit_local.cfg` is the platform's own file and never mentions an addon
#   * the profile is `/usr/local/hmm`; `/usr/local/addons/hmm` is the tree an update replaces
#   * the addon's own log is `<addon>/var/hmm.log`; syslog only carries the start and stop lines
#   * `curl -w` does not take printf arguments, so the three HTTP checks fetched nonsense URLs and
#     printed the format string
#   * the Zusatzsoftware list is `cp_software.cgi` and needs a session id

set -u

ADDON=${HMM_LAB_ADDON:-hmm}
SSH_TARGET=${HMM_LAB_SSH:-}
URL=${HMM_LAB_URL:-}
SID=${HMM_LAB_SID:-}

if [ -z "$SSH_TARGET" ]; then
    echo 'HMM_LAB_SSH is not set - see the header of this file.' >&2
    exit 2
fi

on_ccu() {
    # BatchMode: never sit at a password prompt in a script somebody walked away from
    ssh -n -o BatchMode=yes -o ConnectTimeout=10 "$SSH_TARGET" "$@" 2>&1
}

section() {
    echo
    echo "== $1"
}

# -k: a CCU serves its own self-signed certificate, and this is a lab box on a local network
http_code() {
    curl -k -s -o /dev/null -w '%{http_code}' "$1"
}

section "the box"
on_ccu 'cat /boot/VERSION 2>/dev/null || cat /VERSION 2>/dev/null || uname -a; uname -m'

section "is the addon installed, and which build"
on_ccu "ls -l /usr/local/etc/config/rc.d/$ADDON 2>/dev/null; \
        cat /usr/local/addons/$ADDON/versions 2>/dev/null || echo 'no versions file'"

section "is it running"
# `ps w` because busybox `ps` has no `-f`; the grep is quoted so it does not match itself
on_ccu "/usr/local/etc/config/rc.d/$ADDON status 2>&1; ps w | grep '[$ADDON]/app/dist' || echo 'no process'"

section "does monit watch it"
# The link is what update_script makes; `monit status` is the only thing that says whether the
# check is armed. "Not monitored" means none of the alerts in monit.cfg can fire (see monit.cfg).
on_ccu "ls -l /usr/local/etc/monit-$ADDON.cfg 2>/dev/null || echo 'no monit-$ADDON.cfg (expected on the CCU3 firmware)'; \
        monit status $ADDON 2>/dev/null | head -8 || echo 'no monit on this box'"

section "the lighttpd rule"
on_ccu "ls -l /usr/local/etc/config/lighttpd/ 2>/dev/null; \
        cat /usr/local/etc/config/lighttpd/$ADDON.conf 2>/dev/null || echo 'no lighttpd rule'"

section "the addon tree and the profile"
on_ccu "echo '-- tree (replaced by an update):'; ls -la /usr/local/addons/$ADDON/ 2>/dev/null; \
        echo '-- profile (survives an update):'; ls -la /usr/local/$ADDON/ 2>/dev/null"

section "the last 20 lines of the addon's own log"
on_ccu "tail -n 20 /usr/local/addons/$ADDON/var/$ADDON.log 2>/dev/null || echo 'no log file yet'"

section "what syslog has about it"
on_ccu "grep ' $ADDON:' /var/log/messages 2>/dev/null | tail -n 5 || echo 'nothing in /var/log/messages'"

section "listening ports"
on_ccu "netstat -tlnp 2>/dev/null | grep -E '8090|node' || echo 'netstat says nothing'"

if [ -z "$URL" ]; then
    section "the web side"
    echo 'HMM_LAB_URL is not set, skipping the HTTP checks'
    exit 0
fi

section "does the addon answer under its prefix"
echo "GET $URL/addons/$ADDON/            -> $(http_code "$URL/addons/$ADDON/")   (200)"
echo "GET $URL/addons/$ADDON             -> $(http_code "$URL/addons/$ADDON")   (301, the slash)"
echo "GET $URL/addons/$ADDON/data/manifest.json -> $(http_code "$URL/addons/$ADDON/data/manifest.json")   (200)"

section "the session check (settings.cgi)"
echo "no sid at all        -> $(curl -k -s "$URL/addons/$ADDON/settings.cgi" |
    grep -c 'ung.ltig\|Invalid session') line(s) saying the session is invalid"
echo "a wrong sid          -> $(curl -k -s "$URL/addons/$ADDON/settings.cgi?sid=%40aaaaaaaaaa%40" |
    grep -c 'ung.ltig\|Invalid session') line(s) saying the session is invalid"
if [ -z "$SID" ]; then
    echo 'a valid sid          -> HMM_LAB_SID is not set, skipped'
else
    echo "a valid sid          -> $(http_code "$URL/addons/$ADDON/settings.cgi?sid=%40$SID%40")   (302 into the UI)"
    echo '-- the cookie it hands out (Path, Secure, HttpOnly, SameSite):'
    curl -k -si "$URL/addons/$ADDON/settings.cgi?sid=%40$SID%40" | grep -i '^set-cookie' |
        sed 's/=[0-9a-f]\{16,\}/=<token>/'
    section "the CGIs are not proxied into the backend"
    curl -k -s "$URL/addons/$ADDON/service.cgi?sid=%40$SID%40&cmd=status" | head -c 300
    echo
    section "does Systemsteuerung list the addon"
    curl -k -s "$URL/config/cp_software.cgi?sid=%40$SID%40" | grep -ic 'homematic manager' |
        sed 's/^/mentions: /'
fi

section "a device picture, and where it came from"
# X-Hmm-Image-Source: ccu means the chain to the CCU's own image directory works (task 13/15);
# `bundled` means it fell back to the small webp subset.
curl -k -sI "$URL/addons/$ADDON/images/HmIP-PDT" | tr -d '\r' |
    grep -iE 'HTTP/|content-type|content-length|x-hmm-image-source' || echo 'no answer'

echo
echo 'Done. Nothing above decides anything - read it.'
