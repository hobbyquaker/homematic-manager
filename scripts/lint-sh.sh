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
# ShellCheck itself is not on every machine. Without it the script still runs `sh -n` and says, in one
# line, that the static analysis did not happen. CI has it (it ships with the GitHub Ubuntu image),
# so the full check always runs there.

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

if command -v shellcheck >/dev/null 2>&1; then
    # `-x` follows `.`-sourced files, which the addon's scripts use for `default.env`.
    # one call for all of them, so a failure lists everything at once
    # shellcheck disable=SC2086
    if ! shellcheck -x -S warning $files; then
        status=1
    fi
elif [ "${LINT_SH_REQUIRE_SHELLCHECK:-}" = '1' ]; then
    # CI sets this: the whole point of the step is the static analysis, and a runner image that
    # quietly stopped shipping shellcheck must not turn into a green check that tested nothing.
    echo 'lint:sh: shellcheck is not installed and LINT_SH_REQUIRE_SHELLCHECK=1'
    status=1
else
    echo 'lint:sh: WARNING - shellcheck is not installed, only the syntax was checked.'
    echo 'lint:sh:           Debian/Ubuntu: apt-get install shellcheck   macOS: brew install shellcheck'
    echo 'lint:sh:           Set LINT_SH_REQUIRE_SHELLCHECK=1 to make this a failure.'
fi

exit $status
