#!/bin/sh
# Runs an addon test command where its tools are: on this machine when it has tclsh and shellcheck,
# otherwise inside the `hmm-addon-test` image built from the Dockerfile next to this file (B-50).
#
#   apps/ccu-addon/test/in-image.sh apps/ccu-addon/test/cgi-test.sh
#   apps/ccu-addon/test/in-image.sh apps/ccu-addon/test/package-test.sh <package.tar.gz>
#   HMM_TEST_IN=image apps/ccu-addon/test/in-image.sh shellcheck -x <files>
#
# `npm run test:cgi -w apps/ccu-addon` and `npm run test:package -w apps/ccu-addon -- <package>` call
# it, and `npm run lint:sh` uses it for shellcheck. A plain WSL Debian has neither tool, and a test
# that is skipped locally is a test that first fails in CI.
#
# HMM_TEST_IN picks the place: `auto` (the default) as above, `host` always here, `image` always in
# the container. The checkout is mounted at its own path and the working directory is kept, so
# relative and absolute paths inside the checkout mean the same in both. The command runs as the
# calling user, so nothing it writes into the checkout ends up owned by root.
#
# Needs docker only when the command goes into the image; without it this fails and says what to
# install instead.

set -eu

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
root=$(CDPATH='' cd -- "$here/../../.." && pwd)
image=hmm-addon-test

if [ "$#" -eq 0 ]; then
    echo "usage: $0 <command> [arguments]" >&2
    exit 2
fi

where=${HMM_TEST_IN:-auto}
case $where in
auto)
    where=image
    if command -v tclsh >/dev/null 2>&1 && command -v shellcheck >/dev/null 2>&1; then
        where=host
    fi
    ;;
host | image) ;;
*)
    echo "in-image: HMM_TEST_IN must be auto, host or image, not '$where'" >&2
    exit 2
    ;;
esac

if [ "$where" = host ]; then
    exec "$@"
fi

if ! command -v docker >/dev/null 2>&1; then
    echo "in-image: this needs tclsh and shellcheck on the machine, or docker to run it in the $image image." >&2
    echo "in-image:   Debian/Ubuntu: apt-get install tcl shellcheck   macOS: brew install tcl-tk shellcheck" >&2
    exit 1
fi

case $PWD in
"$root" | "$root"/*) ;;
*)
    echo "in-image: run it from inside the checkout ($root); only that is mounted" >&2
    exit 2
    ;;
esac

# The build is cached, so after the first time this takes a second. Its output only matters when it
# fails.
log=$(mktemp)
if ! docker build -t "$image" "$here" >"$log" 2>&1; then
    cat "$log" >&2
    rm -f "$log"
    echo "in-image: docker build of $image failed" >&2
    exit 1
fi
rm -f "$log"

echo "in-image: running in the $image image: $*" >&2
exec docker run --rm --init \
    -u "$(id -u):$(id -g)" -e HOME=/tmp -e HMM_TEST_IN=host \
    -e SKIP_SHELLCHECK -e LINT_SH_REQUIRE_SHELLCHECK \
    -v "$root:$root" -w "$PWD" \
    "$image" "$@"
