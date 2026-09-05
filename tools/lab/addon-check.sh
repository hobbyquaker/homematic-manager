#!/bin/sh
# Post-install checklist for the Homematic Manager CCU addon, one box at a time.
#
# Run it after installing or updating the addon on a lab CCU, and read the output. It only reads:
# no `rm`, no restart, no configuration change - so it is safe to run on a box someone is using.
#
#   HMM_LAB_SSH=<ssh target>  HMM_LAB_URL=https://<ccu>  [HMM_LAB_USER=<webui user>] \
#   [HMM_LAB_PASS=<webui password>]  [HMM_LAB_ADDON=hmm]  sh tools/lab/addon-check.sh
#
# **Every value comes from the environment.** There is no default host, no alias and no credential
# in this file, and there must never be one: the lab's addresses and logins live in the maintainer's
# private note (AGENTS.md). `HMM_LAB_SSH` is whatever `ssh` accepts - normally an alias from
# `~/.ssh/config`, so the key and the user stay there too.
#
# This is deliberately a checklist and not a test: it prints what it found and never decides that a
# box is broken. A CCU3 with the firmware's own lighttpd, an OpenCCU and a container each answer a
# little differently, and the person reading the output is the one who knows which is which.
#
# Status: written by task 14 alongside the addon of task 13; the checks are what that task's
# `container-test.sh` verifies in a container, asked of a real box instead. Not yet run against
# hardware - the first run is the maintainer's, and anything it gets wrong belongs in this file.

set -u

ADDON=${HMM_LAB_ADDON:-hmm}
SSH_TARGET=${HMM_LAB_SSH:-}
URL=${HMM_LAB_URL:-}
USER_NAME=${HMM_LAB_USER:-}
PASSWORD=${HMM_LAB_PASS:-}

if [ -z "$SSH_TARGET" ]; then
    echo 'HMM_LAB_SSH is not set - see the header of this file.' >&2
    exit 2
fi

on_ccu() {
    # BatchMode: never sit at a password prompt in a script somebody walked away from
    ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_TARGET" "$@" 2>&1
}

section() {
    echo
    echo "== $1"
}

section "the box"
on_ccu 'cat /boot/VERSION 2>/dev/null || cat /VERSION 2>/dev/null || uname -a'

section "is the addon installed"
on_ccu "ls -l /usr/local/etc/config/rc.d/$ADDON 2>/dev/null; \
        cat /usr/local/addons/$ADDON/VERSION 2>/dev/null || echo 'no VERSION file'"

section "is it running"
# `ps w` because busybox `ps` has no `-f`; the grep is quoted so it does not match itself
on_ccu "ps w | grep '[h]omematic-manager\\|[n]ode.*$ADDON' || echo 'no process'"

section "does monit watch it"
on_ccu "cat /usr/local/etc/config/monit_local.cfg 2>/dev/null | grep -A4 '$ADDON' || echo 'not in monit_local.cfg'; \
        monit summary 2>/dev/null | grep -i '$ADDON' || echo 'monit says nothing about it'"

section "the lighttpd rule"
on_ccu "ls -l /usr/local/etc/config/lighttpd/conf.d/ 2>/dev/null; \
        cat /usr/local/etc/config/lighttpd/conf.d/*$ADDON* 2>/dev/null || echo 'no conf.d fragment'"

section "the state directory"
on_ccu "ls -la /usr/local/addons/$ADDON/ 2>/dev/null; \
        ls -la /usr/local/etc/config/addons/$ADDON/ 2>/dev/null || true"

section "the last 40 log lines"
on_ccu "tail -n 40 /var/log/messages 2>/dev/null | grep -i '$ADDON' || echo 'nothing about the addon in /var/log/messages'"

section "listening ports"
on_ccu "netstat -tlnp 2>/dev/null | grep -i 'node\\|8090' || echo 'netstat says nothing'"

if [ -z "$URL" ]; then
    section "the web side"
    echo 'HMM_LAB_URL is not set, skipping the HTTP checks'
    exit 0
fi

auth=''
if [ -n "$USER_NAME" ]; then
    auth="--user $USER_NAME:$PASSWORD"
fi

section "does the addon page answer"
# -k: a CCU serves its own self-signed certificate, and this is a lab box on a local network
# shellcheck disable=SC2086
curl -k -s -o /dev/null -w 'addons/%s -> %s\n' "$ADDON" '%{http_code}\n' $auth "$URL/addons/$ADDON/" ||
    echo 'curl failed'

section "does the settings CGI answer"
# shellcheck disable=SC2086
curl -k -s -w '\n-> %{http_code}\n' $auth "$URL/addons/$ADDON/settings.cgi" | head -n 20

section "does the WebUI list the addon"
# shellcheck disable=SC2086
curl -k -s $auth "$URL/config/cp_maintenance.cgi" | grep -io "$ADDON" | head -n 3 ||
    echo "the maintenance page does not mention $ADDON"

echo
echo 'Done. Nothing above decides anything - read it.'
