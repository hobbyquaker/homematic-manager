#!/usr/bin/env bash
#
# Assembles the Node.js runtime that ships inside the Homematic Manager CCU addon.
#
#   apps/ccu-addon/build-runtime.sh <armv7l|aarch64|x86_64> [outdir]
#
# Everything lands inside the addon's own directory and refers only to itself: the runtime never
# reads a library, a PATH entry or a Node installation belonging to the CCU or to another addon
# (RedMatic ships its own Node too, and the two must not see each other), and nothing outside
# $PREFIX is created, linked or modified.
#
# Where the binary comes from, per architecture:
#
#   armv7l   CCU3 hardware. The eQ-3 firmware is glibc 2.27 / libstdc++ 6.0.24 (Buildroot 2018.08),
#            while every nodejs.org binary since Node 18 needs GLIBC_2.28 and GLIBCXX_3.4.26 - and
#            nodejs.org stopped building armv7l after v23 entirely. Alpine still builds current Node
#            for armv7 against musl, so we take that binary together with the musl loader and its
#            shared libraries and rewrite its ELF interpreter and RPATH to point inside the addon.
#            The CCU's own libc is then irrelevant: the runtime works on CCU3 firmware and OpenCCU
#            alike.
#   aarch64  OpenCCU only, glibc is current -> stock nodejs.org tarball.
#   x86_64   OpenCCU only, glibc is current -> stock nodejs.org tarball.
#
# Adapted from hm2mqtt.js's `addon/build-runtime.sh` (same author), which was verified on real CCU3
# hardware on 2026-08-31: the Alpine musl build of Node 24 starts, OpenSSL and TLS work, Intl/ICU
# works. Note that child processes only work once the ELF interpreter has been patched, since node
# re-executes itself through `process.execPath`.
#
# Besides the runtime this writes two files the rest of the build reads:
#   <outdir>/versions              NODE_VERSION, NODE_ARCH, NODE_SOURCE, NODE_ICU_DATA, ...
#   <outdir>/alpine-packages.json  the resolved Alpine packages (armv7l only), for the SBOM (D-27)
#
# Requires: curl, tar, node and - for armv7l - patchelf. No container, no emulator.

set -euo pipefail

cd "$(dirname "$0")"
ADDON_SRC="$PWD"

NODE_MAJOR="${NODE_MAJOR:-24}"
PREFIX="${PREFIX:-/usr/local/addons/hmm}"
ALPINE_BRANCH="${ALPINE_BRANCH:-edge}"
ALPINE_MIRROR="${ALPINE_MIRROR:-https://dl-cdn.alpinelinux.org/alpine}"

ARCH="${1:-}"
OUT="${2:-$ADDON_SRC/out/work/$ARCH/runtime}"

case "$ARCH" in
    armv7l | aarch64 | x86_64) ;;
    *)
        echo "usage: $0 <armv7l|aarch64|x86_64> [outdir]" >&2
        exit 1
        ;;
esac

require() {
    for cmd in "$@"; do
        command -v "$cmd" >/dev/null 2>&1 || {
            echo "error: '$cmd' is required but not installed" >&2
            exit 1
        }
    done
}

rm -rf "$OUT"
mkdir -p "$OUT/bin"
# only the musl runtime carries its own shared libraries
[ "$ARCH" = armv7l ] && mkdir -p "$OUT/lib"

if [ "$ARCH" = armv7l ]; then
    require curl tar patchelf node

    # Resolve nodejs and everything it needs, then download and unpack it. No container and no apk
    # binary: an .apk is a gzipped tar, and alpine-packages.js does the dependency resolution from
    # the index.
    PACKAGES="$(node "$ADDON_SRC/alpine-packages.js" nodejs armv7 "$ALPINE_BRANCH" "$ALPINE_MIRROR")"
    [ -n "$PACKAGES" ] || {
        echo "error: could not resolve the nodejs package in alpine/$ALPINE_BRANCH/armv7" >&2
        exit 1
    }
    APK_VERSION="$(echo "$PACKAGES" | sed -n 's|.*/nodejs-\(.*\)\.apk$|\1|p' | head -1)"
    NODE_VERSION="v${APK_VERSION%%-r*}"
    case "$NODE_VERSION" in
        "v$NODE_MAJOR."*) ;;
        *)
            echo "error: alpine/$ALPINE_BRANCH/armv7 ships nodejs $NODE_VERSION, expected ${NODE_MAJOR}.x." >&2
            echo "       Pick another ALPINE_BRANCH or move NODE_MAJOR." >&2
            exit 1
            ;;
    esac
    echo "alpine/$ALPINE_BRANCH/armv7: nodejs $APK_VERSION -> $NODE_VERSION"
    echo "$PACKAGES" | sed 's|.*/||' | tr '\n' ' ' | sed 's/^/packages:    /;s/ $/\n/'

    # the same resolution again as metadata, so the SBOM can name every apk that is in this tree
    node "$ADDON_SRC/alpine-packages.js" nodejs armv7 "$ALPINE_BRANCH" "$ALPINE_MIRROR" --json \
        > "$OUT/alpine-packages.json"

    ROOT="$(dirname "$OUT")/root"
    rm -rf "$ROOT"
    mkdir -p "$ROOT/.apk"
    for url in $PACKAGES; do
        name="$(basename "$url")"
        curl -fsSL --max-time 300 -o "$ROOT/.apk/$name" "$url" || {
            echo "error: could not download $url" >&2
            exit 1
        }
        # an .apk is signature + control + data as concatenated gzip streams; tar reads them all,
        # and the metadata entries it complains about are of no interest here
        tar -xzf "$ROOT/.apk/$name" -C "$ROOT" 2>/dev/null || true
    done
    rm -rf "$ROOT/.apk"

    [ -f "$ROOT/usr/bin/node" ] || {
        echo "error: the nodejs package did not contain usr/bin/node" >&2
        exit 1
    }

    cp -a "$ROOT/usr/bin/node" "$OUT/bin/node"

    # Copy the transitive DT_NEEDED closure, asking patchelf what each object needs. Only these
    # libraries end up in the package - not everything apk happened to unpack.
    copy_lib() {
        local name="$1" dir real base
        [ -e "$OUT/lib/$name" ] && return 0
        for dir in "$ROOT/lib" "$ROOT/usr/lib"; do
            [ -e "$dir/$name" ] || continue
            real="$(readlink -f "$dir/$name")"
            base="$(basename "$real")"
            cp -a "$real" "$OUT/lib/$base"
            [ "$base" = "$name" ] || ln -sfn "$base" "$OUT/lib/$name"
            return 0
        done
        echo "error: shared library $name not found in the staging root" >&2
        return 1
    }

    queue="$OUT/bin/node"
    while [ -n "$queue" ]; do
        current="${queue%% *}"
        queue="${queue#"$current"}"
        queue="${queue# }"
        for needed in $(patchelf --print-needed "$current" 2>/dev/null); do
            if [ ! -e "$OUT/lib/$needed" ]; then
                copy_lib "$needed"
                queue="$queue $(readlink -f "$OUT/lib/$needed")"
            fi
        done
    done

    # ICU data. Alpine builds node against the system ICU, whose libicudata.so is a stub - the real
    # data is a .dat file ICU looks for under a path compiled into the library (/usr/share/icu/<ver>).
    # That path does not exist on a CCU, so the data ships inside the addon and the rc.d script
    # exports ICU_DATA; without it node does not start.
    if [ -d "$ROOT/usr/share/icu" ]; then
        mkdir -p "$OUT/share"
        cp -a "$ROOT/usr/share/icu" "$OUT/share/"
        ICU_VERSION="$(ls "$OUT/share/icu" | head -1)"
    fi

    # the ELF interpreter itself (musl's loader), which is not a DT_NEEDED entry
    LOADER="$(patchelf --print-interpreter "$OUT/bin/node")"
    cp -a "$ROOT$LOADER" "$OUT/lib/$(basename "$LOADER")"

    # Point everything inside the addon: the absolute prefix path first (the installed location),
    # $ORIGIN as well so the tree also works when unpacked somewhere else for testing.
    patchelf --set-interpreter "$PREFIX/lib/$(basename "$LOADER")" \
        --set-rpath "$PREFIX/lib:\$ORIGIN/../lib" "$OUT/bin/node"
    for lib in "$OUT"/lib/*; do
        [ -L "$lib" ] && continue
        case "$(basename "$lib")" in
            ld-musl-*) continue ;;
        esac
        patchelf --set-rpath "$PREFIX/lib:\$ORIGIN" "$lib"
    done

    RUNTIME_SOURCE="alpine/$ALPINE_BRANCH ($APK_VERSION, musl)"
else
    require curl tar

    NODE_VERSION="$(
        curl -fsSL --max-time 120 https://nodejs.org/dist/index.json |
            tr '}' '\n' |
            grep -o "\"version\":\"v$NODE_MAJOR\.[0-9]*\.[0-9]*\"" |
            head -1 |
            sed 's/.*"v/v/;s/"//'
    )"
    [ -n "$NODE_VERSION" ] || {
        echo "error: no Node $NODE_MAJOR release found on nodejs.org" >&2
        exit 1
    }
    case "$ARCH" in
        aarch64) NARCH=arm64 ;;
        x86_64) NARCH=x64 ;;
    esac
    NAME="node-$NODE_VERSION-linux-$NARCH"
    echo "nodejs.org: $NAME"
    WORKDL="$(dirname "$OUT")/dl"
    rm -rf "$WORKDL"
    mkdir -p "$WORKDL"
    curl -fsSL --max-time 900 "https://nodejs.org/dist/$NODE_VERSION/$NAME.tar.xz" | tar -xJ -C "$WORKDL"
    cp -a "$WORKDL/$NAME/bin/node" "$OUT/bin/node"
    cp -a "$WORKDL/$NAME/LICENSE" "$OUT/LICENSE.node"
    rm -rf "$WORKDL"
    RUNTIME_SOURCE="nodejs.org ($NODE_VERSION, glibc)"
fi

# npm is deliberately absent: the addon ships its dependencies pre-installed (there are no build
# tools on a CCU anyway), so the runtime is the node binary and nothing else.

# every value quoted: this file is sourced by the rc.d script, and an unquoted "(" in the source
# description is a syntax error in the CCU's shell
{
    echo "NODE_VERSION=\"$NODE_VERSION\""
    echo "NODE_ARCH=\"$ARCH\""
    echo "NODE_SOURCE=\"$RUNTIME_SOURCE\""
    echo "NODE_PREFIX=\"$PREFIX\""
    [ -n "${ICU_VERSION:-}" ] && echo "NODE_ICU_DATA=\"$PREFIX/share/icu/$ICU_VERSION\""
    echo "BUILD_DATE=\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\""
} > "$OUT/versions"

# Self-check: every library the binary asks for must be part of the tree, and nothing may point
# outside the prefix.
if [ "$ARCH" = armv7l ]; then
    echo
    echo "interpreter: $(patchelf --print-interpreter "$OUT/bin/node")"
    echo "rpath:       $(patchelf --print-rpath "$OUT/bin/node")"
    missing=0
    for needed in $(patchelf --print-needed "$OUT/bin/node"); do
        [ -e "$OUT/lib/$needed" ] || {
            echo "MISSING: $needed" >&2
            missing=1
        }
    done
    [ "$missing" = 0 ] || exit 1
    case "$(patchelf --print-interpreter "$OUT/bin/node")" in
        "$PREFIX"/*) ;;
        *)
            echo "error: interpreter points outside $PREFIX" >&2
            exit 1
            ;;
    esac
    [ -n "${ICU_VERSION:-}" ] || {
        echo "error: no ICU data in the staging root - node would not start" >&2
        exit 1
    }
    echo "icu data:    $PREFIX/share/icu/$ICU_VERSION (export ICU_DATA)"
    echo "libraries:   $(find "$OUT/lib" -maxdepth 1 -type f | wc -l | tr -d ' ') files, all inside $PREFIX/lib"
fi

echo
echo "runtime:     $OUT ($(du -sh "$OUT" | cut -f1)), $RUNTIME_SOURCE"
