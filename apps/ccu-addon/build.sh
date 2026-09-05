#!/usr/bin/env bash
#
# Builds the installable Homematic Manager CCU addon package.
#
#   apps/ccu-addon/build.sh <armv7l|aarch64|x86_64>
#
# Produces apps/ccu-addon/out/hmm-ccu-<arch>-<version>.tar.gz, the file that is uploaded in
# Systemsteuerung -> Zusatzsoftware, plus its .sha256. Package layout (everything below
# /usr/local/addons/hmm):
#
#   bin/node          the bundled runtime (build-runtime.sh)
#   bin/update_addon  tcl helper that maintains the Systemsteuerung entry
#   lib/              shared libraries of the runtime (armv7l only)
#   share/icu/        ICU data - node does not start without it (musl build)
#   app/              the packed @homematic-manager/web with its dependencies installed:
#                     dist/ (the host), ui/ (the built UI), data/ (the generated metadata),
#                     node_modules/ (ws, binrpc, homematic-xmlrpc, homematic-rega and the
#                     bundled @homematic-manager/{backend,core} of D-29)
#   etc/              default.env, monit.cfg, lighttpd.conf; hmm.env is created on first install
#   rc.d/hmm          service script
#   www/              the three CGIs and the 503 page
#   var/              log file at runtime
#
# The profile (config.json, caches, the token) is *not* in here: it lives in /usr/local/hmm, so an
# update can replace this tree wholesale and an uninstall can delete it without losing what the user
# configured.
#
# Requires a built workspace (`npm run build` at the repository root) plus curl, tar, node and - for
# armv7l - patchelf.

set -euo pipefail

cd "$(dirname "$0")"
ADDON_SRC="$PWD"
REPO_ROOT="$(cd ../.. && pwd)"

ARCH="${1:-}"
case "$ARCH" in
    armv7l | aarch64 | x86_64) ;;
    *)
        echo "usage: $0 <armv7l|aarch64|x86_64>" >&2
        exit 1
        ;;
esac

ADDON=hmm
PREFIX=/usr/local/addons/$ADDON
VERSION="$(node -p "require('$REPO_ROOT/package.json').version")"
WORK="$ADDON_SRC/out/work/$ARCH/pkg"
TREE="$WORK/$ADDON"
OUT="$ADDON_SRC/out"

echo
echo "building the homematic-manager $VERSION addon package for $ARCH"

rm -rf "$WORK"
mkdir -p "$TREE" "$OUT"

# 1. the runtime
PREFIX="$PREFIX" "$ADDON_SRC/build-runtime.sh" "$ARCH" "$TREE"

# 2. the addon files (rc.d, bin/update_addon, etc, www)
cp -a "$ADDON_SRC/files/$ADDON/." "$TREE/"
cp -a "$ADDON_SRC/files/update_script" "$WORK/update_script"
cp -a "$ADDON_SRC/files/$ADDON.cfg" "$WORK/$ADDON.cfg"
# run-parts ignores files with a dot in the name, and the WebUI calls the rc script through a symlink
chmod +x "$WORK/update_script" "$TREE/rc.d/$ADDON" "$TREE/bin/update_addon" "$TREE"/www/*.cgi
mkdir -p "$TREE/var"

# 3. the app: exactly the npm tarball of apps/web, installed the way a user would install it. That
#    tarball already carries the built UI, the generated metadata and the bundled backend and core
#    (D-29), so this is the same artefact the npm and Docker deliverables run - no second recipe.
echo "packing @homematic-manager/web..."
PACKDIR="$WORK/npm"
mkdir -p "$PACKDIR"
WEB_TGZ="$PACKDIR/$(cd "$REPO_ROOT" && npm pack --silent -w apps/web --pack-destination "$PACKDIR" | tail -1)"
[ -f "$WEB_TGZ" ] || {
    echo "error: npm pack produced no tarball - is the workspace built? (npm run build)" >&2
    exit 1
}

# installed in a scratch directory outside the repository: inside it npm would find the workspace
# root above and refuse to treat this as its own project
echo "installing it and its dependencies..."
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
printf '{"name":"hmm-addon-app","version":"0.0.0","private":true}\n' > "$STAGE/package.json"
(cd "$STAGE" && npm install --silent --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund "$WEB_TGZ" >/dev/null)

WEB="$STAGE/node_modules/@homematic-manager/web"
[ -d "$WEB/dist" ] || {
    echo "error: the installed tarball has no dist/ - did prepack run?" >&2
    exit 1
}
mkdir -p "$TREE/app/node_modules/@homematic-manager"
# the package's own files (dist, ui, data, package.json, README, LICENSE)
find "$WEB" -mindepth 1 -maxdepth 1 ! -name node_modules -exec cp -a {} "$TREE/app/" \;
# its bundled workspace packages, which npm nests inside it
if [ -d "$WEB/node_modules/@homematic-manager" ]; then
    cp -a "$WEB/node_modules/@homematic-manager/." "$TREE/app/node_modules/@homematic-manager/"
fi
# and its registry dependencies, which npm hoists next to it
for entry in "$STAGE/node_modules"/*; do
    name="$(basename "$entry")"
    case "$name" in
        .*) continue ;;
        @homematic-manager)
            for scoped in "$entry"/*; do
                [ "$(basename "$scoped")" = web ] && continue
                cp -a "$scoped" "$TREE/app/node_modules/@homematic-manager/"
            done
            continue
            ;;
    esac
    cp -a "$entry" "$TREE/app/node_modules/"
done
rm -rf "$TREE/app/node_modules/.package-lock.json" "$TREE/app/node_modules/.bin"

# 4. OQ-13: the generated metadata ships minified. Measured on this tree (2026-09-05): 9.62 MB
#    pretty-printed against 7.45 MB minified in the same 199 inodes - the CCU3's scarce resource is
#    inodes, not the 2 GB of /usr/local, and those do not change. Pre-gzipping would save another
#    6.8 MB but needs a Content-Encoding branch in the shared static server of apps/web, and the
#    compressed package is the same size either way (gzip does that work anyway). So: minify, do not
#    pre-compress. The full table is in README.md.
echo "minifying the generated metadata..."
node -e '
const fs = require("node:fs");
const path = require("node:path");
let before = 0;
let after = 0;
const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(file);
        } else if (entry.name.endsWith(".json")) {
            const source = fs.readFileSync(file, "utf8");
            const minified = JSON.stringify(JSON.parse(source));
            before += Buffer.byteLength(source);
            after += Buffer.byteLength(minified);
            fs.writeFileSync(file, minified);
        }
    }
};
walk(process.argv[1]);
console.log(`metadata:    ${(before / 1048576).toFixed(2)} MB -> ${(after / 1048576).toFixed(2)} MB minified`);
' "$TREE/app/data"

# 5. version file, read by the rc.d script, the CGIs and the SBOM
{
    echo "VERSION_ADDON=\"$VERSION\""
    cat "$TREE/versions"
} > "$TREE/versions.new"
mv "$TREE/versions.new" "$TREE/versions"

# 6. keep the bulky, reproducible parts out of the CCU backup (honoured by OpenCCU's createBackup)
for dir in bin lib share app www; do
    [ -d "$TREE/$dir" ] && touch "$TREE/$dir/.nobackup"
done

PKG="$OUT/hmm-ccu-$ARCH-$VERSION.tar.gz"
# GNU tar writes the root ownership the CCU installer expects; bsdtar (macOS, local builds) has no
# --owner, which only matters for a package that is actually shipped - CI runs on Linux
if tar --owner=root --group=root --version >/dev/null 2>&1; then
    tar --owner=root --group=root --exclude=.DS_Store -czf "$PKG" -C "$WORK" "$ADDON" update_script "$ADDON.cfg"
else
    echo "note: GNU tar not available, package ownership will not be root"
    tar --exclude=.DS_Store -czf "$PKG" -C "$WORK" "$ADDON" update_script "$ADDON.cfg"
fi
(cd "$OUT" && sha256sum "$(basename "$PKG")" > "$(basename "$PKG").sha256")

# 7. the SBOM of D-27: the npm tree of app/ merged with the runtime that is not an npm dependency
node "$ADDON_SRC/sbom.mjs" --package "$PKG" --tree "$TREE" --web-tarball "$WEB_TGZ"

echo
du -sh "$TREE" | sed 's/^/installed size: /'
printf 'installed inodes: %s\n' "$(find "$TREE" | wc -l | tr -d ' ')"
ls -lh "$PKG" | awk '{print "package:        " $9 " (" $5 ")"}'
