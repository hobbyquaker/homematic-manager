#!/usr/bin/env bash
#
# Unpacks a built addon package into the layout a CCU installs it into - including the
# addons/www/hmm symlink the WebUI reaches the CGIs through - and exercises it the same way
# lighttpd would. The source tree alone never has that symlink, so a CGI can look fine right up to
# being installed.
#
#   apps/ccu-addon/test/package-test.sh apps/ccu-addon/out/hmm-ccu-x86_64-<version>.tar.gz
#
# It also checks the SBOM (D-27) against the package it describes: the Node version in the document
# has to be the version of the binary that is really in there.

set -uo pipefail

PKG="${1:-}"
[ -f "$PKG" ] || {
    echo "usage: $0 <package.tar.gz>" >&2
    exit 1
}
# absolute before the cd, so a path relative to the caller's directory keeps working
PKG="$(cd "$(dirname "$PKG")" && pwd)/$(basename "$PKG")"
cd "$(dirname "$0")/.." || exit 1
ADDON_SRC="$PWD"
command -v tclsh >/dev/null || {
    echo "tclsh is required" >&2
    exit 1
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
STUB="$ADDON_SRC/test/stub.tcl"

mkdir -p "$TMP/usr_local/addons" "$TMP/config/addons/www" "$TMP/state"
tar xzf "$PKG" -C "$TMP/usr_local/addons" hmm
ADDON="$TMP/usr_local/addons/hmm"
ln -sfn "$ADDON/www" "$TMP/config/addons/www/hmm"
cp "$ADDON/etc/default.env" "$ADDON/etc/hmm.env"
printf '0123456789abcdef0123456789abcdef\n' > "$TMP/state/token"

export HMM_ADDON_DIR="$ADDON"
export HMM_STATE_DIR="$TMP/state"
export HMM_PID_FILE="$TMP/hmm.pid"

failed=0
pass() { echo "  ok   - $1"; }
skip() { echo "  skip - $1 ($2)"; }
fail() {
    echo "  FAIL - $1"
    echo "         $2"
    failed=1
}

echo "the package as the CCU unpacks it"
# the listing goes to a file: `tar ... | grep -q` makes tar die of SIGPIPE, and with `pipefail` a
# match would then look like a failure
LISTING="$TMP/listing.txt"
tar tzf "$PKG" > "$LISTING"
for entry in hmm/rc.d/hmm hmm/bin/node hmm/bin/update_addon hmm/www/settings.cgi hmm/www/service.cgi \
    hmm/www/update_check.cgi hmm/www/lib/session.tcl hmm/etc/lighttpd.conf hmm/etc/monit.cfg \
    hmm/etc/default.env hmm/app/dist/cli.js hmm/app/ui/index.html hmm/app/data/manifest.json \
    hmm/app/node_modules/ws/package.json hmm/versions update_script hmm.cfg; do
    if grep -qxF "$entry" "$LISTING"; then
        pass "contains $entry"
    else
        fail "contains $entry" "not in the archive"
    fi
done
mode="$(tar tvzf "$PKG" | awk '$NF == "update_script" {print $1}')"
case "$mode" in
    *x*) pass "update_script is executable inside the archive" ;;
    *) fail "update_script is executable inside the archive" "mode $mode" ;;
esac
for dir in bin app www; do
    if grep -qxF "hmm/$dir/.nobackup" "$LISTING"; then
        pass "hmm/$dir is excluded from the CCU backup"
    else
        fail "hmm/$dir is excluded from the CCU backup" "no .nobackup"
    fi
done
if grep -q '^hmm/app/node_modules/@homematic-manager/backend/' "$LISTING"; then
    pass "the bundled backend and core of D-29 are inside app/"
else
    fail "the bundled backend and core of D-29 are inside app/" "no @homematic-manager/backend"
fi

echo "the CGIs, through the symlink and with an absolute path"
page="$(cd / && QUERY_STRING='sid=@1234567890@' tclsh "$STUB" "$TMP/config/addons/www/hmm/settings.cgi" 2>&1)"
case "$page" in
    *'Set-Cookie: hmm_token=0123456789abcdef0123456789abcdef;'*) pass "settings.cgi hands out the token" ;;
    *) fail "settings.cgi hands out the token" "$page" ;;
esac
run() { (cd "$TMP/config/addons/www/hmm" && QUERY_STRING="$1" tclsh "$STUB" "$2" 2>&1 | tail -1); }
out="$(run 'sid=%401234567890%40&cmd=status' service.cgi)"
case "$out" in
    *'"VERSION_ADDON"'*) pass "service.cgi reports the version" ;;
    *) fail "service.cgi reports the version" "$out" ;;
esac

echo "the generated metadata is minified (OQ-13)"
if head -c 200 "$ADDON/app/data/manifest.json" | grep -q '^{"'; then
    pass "data/manifest.json has no pretty-printing"
else
    fail "data/manifest.json has no pretty-printing" "$(head -c 80 "$ADDON/app/data/manifest.json")"
fi

echo "the bundled runtime"
# The runtime has to start from where the package puts it - checkable only on a Linux host of the
# package's own architecture. The armv7l and aarch64 packages are built on x86_64 runners, so there
# the binary is inspected rather than run.
description="$(file -b "$ADDON/bin/node" 2>/dev/null)"
case "$description" in
    *x86-64*) package_arch=x86_64 ;;
    *aarch64*) package_arch=aarch64 ;;
    *ARM*) package_arch=armv7l ;;
    *) package_arch=unknown ;;
esac
node_version=""
if [ "$(uname -s)" = Linux ] && [ "$package_arch" = "$(uname -m)" ]; then
    if node_version="$("$ADDON/bin/node" --version 2>/dev/null)"; then
        pass "the bundled node runs ($node_version)"
    else
        node_version=""
        fail "the bundled node runs" "$description"
    fi
elif [ "$package_arch" = unknown ]; then
    fail "the bundled node is an executable" "$description"
else
    skip "running the bundled node" "$package_arch package on $(uname -s)/$(uname -m)"
    case "$description" in
        *ELF*executable*) pass "the bundled node is an $package_arch ELF executable" ;;
        *) fail "the bundled node is an ELF executable" "$description" ;;
    esac
fi
declared="$(sed -n 's/^NODE_VERSION="\(.*\)"$/\1/p' "$ADDON/versions")"
if [ -n "$node_version" ]; then
    if [ "$node_version" = "$declared" ]; then
        pass "versions says the same as the binary ($declared)"
    else
        fail "versions says the same as the binary" "versions: $declared, node -v: $node_version"
    fi
fi

echo "the SBOM (D-27)"
# Reading the document needs a JSON parser. The build machine usually has node on the PATH; where it
# has not (the test container has none on purpose - a CCU has none either), the package's own
# runtime does the job whenever it can run here.
NODE="$(command -v node 2>/dev/null)"
if [ -z "$NODE" ] && [ -n "$node_version" ]; then
    NODE="$ADDON/bin/node"
fi
SBOM="$PKG.cdx.json"
if [ ! -f "$SBOM" ]; then
    fail "there is an SBOM next to the package" "$SBOM is missing"
elif [ -z "$NODE" ]; then
    pass "there is an SBOM next to the package"
    skip "reading the SBOM" "no runnable node on this host"
else
    pass "there is an SBOM next to the package"
    sbom_node="$("$NODE" -e '
const fs = require("node:fs");
const sbom = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const node = (sbom.components || []).find((component) => component.name === "node");
process.stdout.write(node ? `v${node.version}` : "");
' "$SBOM")"
    # what the package really carries: `node -v` where it can run, the versions file otherwise
    expected="${node_version:-$declared}"
    if [ "$sbom_node" = "$expected" ]; then
        pass "the SBOM's node component is $sbom_node, the runtime's own version"
    else
        fail "the SBOM's node component matches the runtime" "sbom: $sbom_node, runtime: $expected"
    fi
    for wanted in '@homematic-manager/backend' '@homematic-manager/core' 'ws'; do
        if "$NODE" -e '
const fs = require("node:fs");
const sbom = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const wanted = process.argv[2];
const names = (sbom.components || []).map((c) => (c.group ? `${c.group}/${c.name}` : c.name));
process.exit(names.includes(wanted) ? 0 : 1);
' "$SBOM" "$wanted"; then
            pass "the SBOM lists $wanted"
        else
            fail "the SBOM lists $wanted" "not among the components"
        fi
    done
    if [ "$package_arch" = armv7l ]; then
        if grep -q 'pkg:apk/alpine/' "$SBOM"; then
            pass "the SBOM lists the Alpine packages of the musl runtime"
        else
            fail "the SBOM lists the Alpine packages of the musl runtime" "no pkg:apk/alpine component"
        fi
    fi
    if grep -q "$(basename "$PKG")" "$SBOM"; then
        pass "the SBOM names this package as its subject"
    else
        fail "the SBOM names this package as its subject" "$(basename "$PKG") not referenced"
    fi
fi

echo "size and inodes (the CCU3 has 96k inodes on /usr/local)"
printf '  installed size:   %s\n' "$(du -sh "$ADDON" | cut -f1)"
printf '  installed inodes: %s\n' "$(find "$ADDON" | wc -l | tr -d ' ')"
printf '  package:          %s\n' "$(ls -lh "$PKG" | awk '{print $5}')"

echo
if [ "$failed" = 0 ]; then
    echo "package looks installable"
else
    echo "package test failed"
fi
exit $failed
