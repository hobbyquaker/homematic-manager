#!/bin/sh
# Syntax and static analysis of every shell script in the repository.
#
#   npm run lint:sh
#
# Why this exists at all: the CCU addon's scripts run under busybox `ash` on a box with no package
# manager, no `bash` and a read-only root. A syntax error in `rc.d/hmm` does not fail loudly - the
# addon simply never starts, monit restarts nothing, and the WebUI shows a page that is not there.
# `sh -n` catches the syntax and shellcheck catches the rest: an unquoted `$1` with a space in it, a
# `[ x = y ]` that busybox reads differently, a `local` outside a function.
#
# What it checks: `*.sh` anywhere outside `node_modules`, plus any file whose shebang names a POSIX
# shell. That second rule is what covers `apps/ccu-addon/files/hmm/rc.d/hmm` and `bin/update_addon`,
# which have no extension - and what keeps the `.cgi` files out, because those are tclsh.
#
# Directories that do not exist are skipped, not an error: `apps/ccu-addon` was being written while
# this was, and a checkout without it must still lint.
#
# ShellCheck itself is not on every machine. Without it the script runs shellcheck inside the addon's
# test image (`apps/ccu-addon/test/in-image.sh`, needs docker), and without docker either it FAILS
# (B-50): a green lint that only checked the syntax is how beta.8's `echo -n` reached CI unseen, and
# the fix is one `apt-get install shellcheck`. A contributor who can do neither sets
# SKIP_SHELLCHECK=1 and gets the old syntax-only run with a warning - a choice made on the command
# line, not a skip nobody notices. CI has shellcheck on the runner and sets
# LINT_SH_REQUIRE_SHELLCHECK=1, which allows neither the image nor the opt-out.

set -eu

root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"

roots=''
for candidate in apps/ccu-addon tools scripts; do
    if [ -d "$candidate" ]; then
        roots="$roots $candidate"
    else
        echo "lint:sh: $candidate does not exist, skipping"
    fi
done

if [ -z "$roots" ]; then
    echo 'lint:sh: nothing to check'
    exit 0
fi

# `roots` is a deliberate word list of directory names, so it must not be quoted
# shellcheck disable=SC2086
files=$(
    find $roots -type f \
        ! -path '*/node_modules/*' ! -path '*/out/*' ! -path '*/dist/*' \
        \( -name '*.sh' -o -exec sh -c 'head -c 60 "$1" | head -n 1 | grep -Eq "^#!.*(^|/| )(sh|ash|dash|bash)( |$)"' _ {} \; \) \
        -print | sort
)

if [ -z "$files" ]; then
    echo 'lint:sh: no shell scripts found'
    exit 0
fi

count=$(printf '%s\n' "$files" | wc -l | tr -d ' ')
echo "lint:sh: $count shell scripts"

status=0

# `sh` is dash on Debian and ash on the CCU; neither is bash, which is the point. A script that
# only parses in bash has to say so in its shebang, and then it is checked as bash below.
for file in $files; do
    shell='sh'
    case $(head -n 1 "$file") in
    *bash*) shell='bash' ;;
    esac
    if ! $shell -n "$file"; then
        echo "lint:sh: $file does not parse"
        status=1
    fi
done

# `-x` follows `.`-sourced files, which the addon's scripts use for `default.env`; one call for all
# of them, so a failure lists everything at once.
in_image=apps/ccu-addon/test/in-image.sh
if command -v shellcheck >/dev/null 2>&1; then
    # shellcheck disable=SC2086
    if ! shellcheck -x -S warning $files; then
        status=1
    fi
elif [ "${LINT_SH_REQUIRE_SHELLCHECK:-}" = '1' ]; then
    # CI sets this: the whole point of the step is the static analysis, and a runner image that
    # quietly stopped shipping shellcheck must not turn into a green check that tested nothing.
    echo 'lint:sh: shellcheck is not installed and LINT_SH_REQUIRE_SHELLCHECK=1'
    status=1
elif [ "${SKIP_SHELLCHECK:-}" = '1' ]; then
    echo 'lint:sh: WARNING - SKIP_SHELLCHECK=1: shellcheck did NOT run, only the syntax was checked.'
    echo 'lint:sh:           CI runs it and will fail where this passed.'
elif [ -f "$in_image" ] && command -v docker >/dev/null 2>&1; then
    echo 'lint:sh: shellcheck is not installed here, running it in the hmm-addon-test image'
    # shellcheck disable=SC2086
    if ! HMM_TEST_IN=image sh "$in_image" shellcheck -x -S warning $files; then
        status=1
    fi
else
    echo 'lint:sh: FAIL - shellcheck is not installed and there is no docker to run it in the test image.'
    echo 'lint:sh:        Debian/Ubuntu: apt-get install shellcheck   macOS: brew install shellcheck'
    echo 'lint:sh:        SKIP_SHELLCHECK=1 checks only the syntax (CI still runs shellcheck).'
    status=1
fi

exit $status
