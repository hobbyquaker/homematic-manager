import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {describe, expect, it} from 'vitest';

import {CALLBACK_DEFAULT_PORTS, PACKAGE} from './index.js';

function file(relative: string): string {
    return readFileSync(new URL(relative, import.meta.url), 'utf8');
}

/**
 * What a CCU3, OpenCCU or openccu-lite box and the addons usually installed beside this one listen on:
 * the table in the README's "Callback ports", measured in the lab on 2026-09-12.
 */
const TAKEN_PORTS: readonly number[] = [
    22, 80, 443, 1880, 1883, 1884, 1885, 1886, 1900, 1998, 1999, 2000, 2001, 2002, 2010, 2121, 2122, 2126, 2127, 5540,
    8088, 8090, 8181, 8182, 8183, 8883, 8884, 9099, 9292, 9293, 9294, 39292, 41999, 43438, 43439, 48181, 49292,
];
const TAKEN_RANGES: readonly (readonly [number, number])[] = [
    // node-red-contrib-ccu picks its callback pair at random in here
    [2040, 2091],
    // hs485d, rfd, hmipserver
    [32000, 32010],
    // the CCU's TLS remote API ports
    [42000, 42010],
    // the kernel's ephemeral range, where every free port comes from
    [32768, 60999],
];

describe('@homematic-manager/ccu-addon', () => {
    it('exports its package name', () => {
        expect(PACKAGE).toBe('@homematic-manager/ccu-addon');
    });
});

/**
 * B-25: on openccu-lite a root-owned pidfile left by a live install kept the confined unit from
 * starting the backend, and `rc.d/hmm start` still said "OK". The container test runs the failures
 * themselves; these hold the shape of `Start()` so a later edit cannot quietly drop the checks.
 */
describe('rc.d/hmm reports a start that started nothing (B-25)', () => {
    const start = /\nStart\(\) \{\n([\s\S]*?)\n\}\n/.exec(file('../files/hmm/rc.d/hmm'))?.[1] ?? '';

    it('refuses a stale pidfile it cannot remove, before anything is started', () => {
        const removed = start.indexOf('rm -f $PIDFILE');
        const refused = start.indexOf('if [ -e $PIDFILE ]; then', removed);
        const daemon = start.indexOf('start-stop-daemon -S');
        expect(removed).toBeGreaterThan(0);
        expect(refused).toBeGreaterThan(removed);
        expect(daemon).toBeGreaterThan(refused);
        expect(start.slice(refused, daemon)).toContain('FAILED');
    });

    it('refuses a var/ it cannot write', () => {
        expect(start).toMatch(/if \[ ! -w \$ADDON_DIR\/var \][^\n]*\n[^\n]*FAILED/);
    });

    it('checks that the backend still runs after start-stop-daemon returned, before it says OK', () => {
        const daemon = start.indexOf('if ! start-stop-daemon -S');
        const check = start.indexOf('if ! Alive; then', daemon);
        const ok = start.lastIndexOf('echo "OK"');
        expect(daemon).toBeGreaterThan(0);
        expect(check).toBeGreaterThan(daemon);
        expect(ok).toBeGreaterThan(check);
        expect(start.slice(check, ok)).toContain('return 1');
    });

    // B-46: the fresh pid is sh → systemd-cat → node, and its cmdline reads empty during each exec;
    // Running()'s grep for the app's path took a live backend for a crashed one, twice in a row at a
    // fast box's boot. The watch after the start asks whether the pid is alive and nothing else.
    it('watches the fresh pid by its liveness, not by its cmdline (B-46)', () => {
        const daemon = start.indexOf('if ! start-stop-daemon -S');
        const ok = start.lastIndexOf('echo "OK"');
        const watch = start.slice(daemon, ok);
        expect(watch).toContain('while [ $i -lt 3 ] && Alive; do');
        // the code, not the comments that explain why Running is not used here
        const code = watch
            .split('\n')
            .filter((line) => !line.trim().startsWith('#'))
            .join('\n');
        expect(code).not.toMatch(/\bRunning\b/);
        const alive = /\nAlive\(\) \{\n([\s\S]*?)\n\}\n/.exec(file('../files/hmm/rc.d/hmm'))?.[1] ?? '';
        expect(alive).toContain('kill -0 "$pid"');
        expect(alive).toContain("grep -q '^State:[[:space:]]*Z' /proc/$pid/status");
        expect(alive).not.toContain('cmdline');
        // a real crash still fails the start, and says which pid is gone
        expect(watch).toContain('why="pid $pid is gone"');
        expect(watch).toContain('exited right after the start: $why');
    });
});

/**
 * Task 41 (openccu-lite D-59): on openccu-lite the backend's output goes to the journal through
 * systemd-cat and no log file is written; on a CCU and OpenCCU the file stays. The container test runs
 * both; these hold the shape of `Start()`.
 */
describe('rc.d/hmm logs to the journal on openccu-lite (task 41)', () => {
    const rc = file('../files/hmm/rc.d/hmm');
    const start = /\nStart\(\) \{\n([\s\S]*?)\n\}\n/.exec(rc)?.[1] ?? '';
    const journalAt = start.indexOf('if [ "$LOG_TARGET" = journal ]; then');
    const elseAt = start.indexOf('\n    else\n', journalAt);
    const fileAt = start.indexOf('RUN="exec $NODE"', journalAt);

    it('chooses the journal only on VARIANT=lite, and only where systemd-cat is', () => {
        const target = /\nLogTarget\(\) \{\n([\s\S]*?)\n\}\n/.exec(rc)?.[1] ?? '';
        expect(target).toContain("grep -q '^VARIANT=lite$' /VERSION");
        expect(target).toContain('command -v systemd-cat');
        expect(start).toContain('LOG_TARGET="$(LogTarget)"');
    });

    it('runs the backend through systemd-cat under the unit identifier, and removes the old file', () => {
        expect(rc).toContain('\nJOURNAL_TAG=addon-$ADDON\n');
        expect(journalAt).toBeGreaterThan(0);
        expect(elseAt).toBeGreaterThan(journalAt);
        expect(fileAt).toBeGreaterThan(elseAt);
        const journal = start.slice(journalAt, elseAt);
        expect(journal).toContain('RUN="exec systemd-cat -t $JOURNAL_TAG $NODE"');
        expect(journal).toContain('OUTPUT=""');
        expect(journal).toContain('rm -f $ADDON_LOG $ADDON_LOG.1');
        expect(journal).not.toContain('mv $LOG');
    });

    it('keeps a file and its rotation everywhere else, and starts the backend with either', () => {
        const other = start.slice(elseAt, start.indexOf('\n    fi\n', fileAt));
        expect(other).toContain('mv $LOG $LOG.1');
        expect(other).toContain('OUTPUT=">>$LOG 2>&1"');
        expect(start).toMatch(
            /start-stop-daemon -S -b -m -p \$PIDFILE -x \/bin\/sh -- -c "\$RUN \$HMM_NODE_FLAGS \$APP/,
        );
        expect(start).toContain('--data-dir $STATE_DIR $OUTPUT"');
    });
});

/** Runs a POSIX shell snippet the way the addon's scripts run, with `logger` writing to stderr. */
function runSh(script: string): {stdout: string; stderr: string; status: number | null} {
    const result = spawnSync('sh', ['-c', `ADDON=hmm\nlogger() { echo "logger $*" >&2; }\n${script}`], {
        encoding: 'utf8',
    });
    return {stdout: result.stdout, stderr: result.stderr, status: result.status};
}

/**
 * What a node started with these flags says about WebAssembly and a fetch of a local HTTP server, stdout and
 * stderr together: without WebAssembly Node 24 rejects the fetch ("fetch failed", cause "WebAssembly is not
 * defined"), while Node 22's undici throws the same ReferenceError uncaught and the process ends before it
 * prints anything.
 */
function probeNode(flags: readonly string[]): string {
    const script = `
        const {createServer} = require('node:http');
        const server = createServer((q, s) => s.end('{"authenticated":true}')).listen(0, '127.0.0.1', async () => {
            let answer;
            try {
                answer = 'fetch ' + (await fetch('http://127.0.0.1:' + server.address().port + '/api/auth/v1/state')).status;
            } catch (error) {
                answer = 'fetch failed: ' + (error.cause?.message ?? error.message);
            }
            console.log('WebAssembly=' + typeof WebAssembly + ' ' + answer);
            server.close();
        });`;
    const result = spawnSync(process.execPath, [...flags, '-e', script], {encoding: 'utf8', timeout: 20_000});
    return `${result.stdout}${result.stderr}`;
}

/** The comment 3.0.0-beta.16's default.env put above `#HMM_NODE_FLAGS=`, and into every hmm.env made from it. */
const BETA16_COMMENT = [
    '# Task 44: flags for node itself, read by the rc.d script and not by the host. The default is',
    "# --lite-mode, V8 without its optimising compilers, which keeps the backend's memory down (the",
    '# addon\'s README, "Memory"). Empty runs node without flags, as before 3.0.0-beta.16.',
].join('\n');

/**
 * B-32 (task 44, D-46): 3.0.0-beta.16 started node with `--lite-mode`, which switches off WebAssembly.
 * Node's fetch parses HTTP with llhttp compiled to WebAssembly, so every fetch of the backend failed, and
 * on openccu-lite no session was let in. The default flags must leave WebAssembly alone, and the two
 * flags that do not are dropped at every start. The container test runs the packaged addon with the
 * shipped flags against a stub box.
 */
describe('rc.d/hmm starts node with flags that keep fetch working (B-32)', () => {
    const rc = file('../files/hmm/rc.d/hmm');
    const start = /\nStart\(\) \{\n([\s\S]*?)\n\}\n/.exec(rc)?.[1] ?? '';
    const defaultLine = /\n {4}HMM_NODE_FLAGS="([^"]*)"\n/.exec(start);
    const defaults = defaultLine?.[1] ?? '';
    const nodeFlags = /\nNodeFlags\(\) \{\n[\s\S]*?\n\}\n/.exec(rc)?.[0] ?? '';

    it('sets a default without --lite-mode or --jitless before etc/hmm.env is read', () => {
        expect(defaultLine).not.toBeNull();
        expect(defaults).not.toMatch(/lite[-_]mode|jitless/);
        expect(start.indexOf('. $ENV_FILE')).toBeGreaterThan(defaultLine?.index ?? Infinity);
    });

    it('filters the flags after etc/hmm.env and passes them to node before the app', () => {
        const sourced = start.indexOf('. $ENV_FILE');
        const filtered = start.indexOf('HMM_NODE_FLAGS="$(NodeFlags "$HMM_NODE_FLAGS")"');
        const runAt = start.indexOf('"$RUN $HMM_NODE_FLAGS $APP');
        expect(filtered).toBeGreaterThan(sourced);
        expect(runAt).toBeGreaterThan(filtered);
        expect(runAt).toBeGreaterThan(start.indexOf('RUN="exec $NODE"'));
        expect(runAt).toBeGreaterThan(start.indexOf('RUN="exec systemd-cat -t $JOURNAL_TAG $NODE"'));
    });

    it('drops --lite-mode and --jitless with a log line each, and keeps every other flag', () => {
        expect(nodeFlags).not.toBe('');
        const dropped = runSh(`${nodeFlags}\nNodeFlags "--lite-mode --max-old-space-size=200 --jitless"`);
        expect(dropped.stdout).toBe('--max-old-space-size=200');
        expect(dropped.stderr).toContain('logger -t hmm -p daemon.warn HMM_NODE_FLAGS: dropped --lite-mode');
        expect(dropped.stderr).toContain('HMM_NODE_FLAGS: dropped --jitless');
        const kept = runSh(`${nodeFlags}\nNodeFlags "${defaults}"`);
        expect(kept.stdout).toBe(defaults);
        expect(kept.stderr).toBe('');
    });

    it('leaves WebAssembly and fetch working in node with the default flags', () => {
        // the probe itself: --lite-mode is exactly what it has to catch, on Node 22 and 24 alike
        const lite = probeNode(['--lite-mode']);
        expect(lite).toContain('WebAssembly is not defined');
        expect(lite).not.toContain('fetch 200');
        expect(probeNode(defaults.split(/\s+/).filter(Boolean))).toContain('WebAssembly=object fetch 200');
    });

    it('documents the switch in default.env, without calling --lite-mode the default', () => {
        const env = file('../files/hmm/etc/default.env');
        expect(env).toContain('\n#HMM_NODE_FLAGS=\n');
        expect(env).not.toContain(BETA16_COMMENT);
    });
});

/**
 * B-32: an update keeps etc/hmm.env, and a beta.16 one may carry `--lite-mode` - in beta.16's comment,
 * or on an `HMM_NODE_FLAGS` line copied from its README. `MigrateNodeFlags` runs here through a real
 * `sh` on such files; the container test runs it inside the update.
 */
describe('update_script takes --lite-mode out of a kept etc/hmm.env (B-32)', () => {
    const script = file('../files/update_script');
    const migrate = /\nMigrateNodeFlags\(\) \{\n[\s\S]*?\n\}\n/.exec(script)?.[0] ?? '';
    const env = file('../files/hmm/etc/default.env');
    const current = env.slice(env.indexOf('# B-32: flags for node itself'), env.indexOf('\n#HMM_NODE_FLAGS=\n'));

    function migrated(content: string): {env: string; log: string; status: number | null} {
        const dir = mkdtempSync(join(tmpdir(), 'hmm-b32-'));
        try {
            const envFile = join(dir, 'hmm.env');
            writeFileSync(envFile, content);
            const out = runSh(`${migrate}\nMigrateNodeFlags '${envFile}'`);
            return {env: readFileSync(envFile, 'utf8'), log: out.stderr, status: out.status};
        } finally {
            rmSync(dir, {recursive: true, force: true});
        }
    }

    it('runs on the kept file once it is back, before anything reads it', () => {
        expect(migrate).not.toBe('');
        const call = script.indexOf('\nMigrateNodeFlags $ADDON_DIR/etc/hmm.env\n');
        expect(call).toBeGreaterThan(script.indexOf('mv /tmp/hmm.env.keep $ADDON_DIR/etc/hmm.env'));
        expect(call).toBeLessThan(script.indexOf('. $ADDON_DIR/etc/hmm.env'));
    });

    it("replaces beta.16's comment with the one default.env carries now, and leaves the rest alone", () => {
        expect(current.length).toBeGreaterThan(100);
        const result = migrated(`HMM_PORT=8090\n\n${BETA16_COMMENT}\n#HMM_NODE_FLAGS=\n\n#HMM_AUTH_MODE=rega\n`);
        expect(result.env).toBe(`HMM_PORT=8090\n\n${current}\n#HMM_NODE_FLAGS=\n\n#HMM_AUTH_MODE=rega\n`);
        expect(result.log).toBe('');
        expect(result.status).toBe(0);
    });

    it("removes the line beta.16's README showed, so the addon's default applies again, and logs it", () => {
        const line =
            'HMM_NODE_FLAGS=--lite-mode             # flags for node, read by the rc.d script only - see "Memory"';
        const result = migrated(`HMM_PORT=8090\n${line}\nHMM_LOG_LEVEL=info\n`);
        expect(result.env).toBe('HMM_PORT=8090\nHMM_LOG_LEVEL=info\n');
        expect(result.log).toContain(
            'etc/hmm.env: removed the line HMM_NODE_FLAGS=--lite-mode: --lite-mode switches off',
        );
    });

    it('keeps the other flags of a line and says what it took out', () => {
        const result = migrated('HMM_NODE_FLAGS="--max-old-space-size=200 --lite-mode --jitless"\nHMM_PORT=8090\n');
        expect(result.env).toBe('HMM_NODE_FLAGS="--max-old-space-size=200"\nHMM_PORT=8090\n');
        expect(result.log).toContain(
            'took --lite-mode --jitless out of HMM_NODE_FLAGS, now "--max-old-space-size=200"',
        );
    });

    it('leaves an empty HMM_NODE_FLAGS=, a user flag and a file without the line exactly as they are', () => {
        for (const content of [
            'HMM_PORT=8090\nHMM_NODE_FLAGS=\n',
            "HMM_NODE_FLAGS='--max-old-space-size=200'\n",
            `HMM_PORT=8090\n${current}\n#HMM_NODE_FLAGS=\n`,
            'HMM_PORT=8090',
        ]) {
            const result = migrated(content);
            expect(result.env).toBe(content);
            expect(result.log).toBe('');
        }
    });
});

/**
 * Task 43 (#159): on a CCU and OpenCCU the backend's output goes to /var/log/hmm.log (tmpfs, no SD-card
 * writes) unless etc/hmm.env says HMM_ADDON_LOG=addon; a /var/log that cannot be written falls back to the
 * addon directory, and the start removes the file at the location not chosen. The container test runs
 * both locations and the fallback; these hold the shape of `LogTarget()` and `Start()`.
 */
describe('rc.d/hmm logs to /var/log or to the addon directory (task 43)', () => {
    const rc = file('../files/hmm/rc.d/hmm');
    const target = /\nLogTarget\(\) \{\n([\s\S]*?)\n\}\n/.exec(rc)?.[1] ?? '';
    const start = /\nStart\(\) \{\n([\s\S]*?)\n\}\n/.exec(rc)?.[1] ?? '';

    it('knows both files, and /var/log/hmm.log is what unset means', () => {
        expect(rc).toContain(
            '\nVARLOG_DIR=/var/log\nVARLOG_LOG=$VARLOG_DIR/hmm.log\nADDON_LOG=$ADDON_DIR/var/hmm.log\n',
        );
        const unset = start.indexOf('\n    HMM_ADDON_LOG=varlog\n');
        const sourced = start.indexOf('. $ENV_FILE');
        expect(unset).toBeGreaterThan(0);
        expect(sourced).toBeGreaterThan(unset);
        expect(start.indexOf('LOG_TARGET="$(LogTarget)"')).toBeGreaterThan(sourced);
        expect(file('../files/hmm/etc/default.env')).toContain('\n#HMM_ADDON_LOG=addon\n');
    });

    it('answers journal, addon or varlog, and nothing else', () => {
        const journal = target.indexOf('echo journal');
        const addon = target.indexOf('echo addon');
        const varlog = target.indexOf('echo varlog');
        expect(journal).toBeGreaterThan(0);
        expect(addon).toBeGreaterThan(journal);
        expect(varlog).toBeGreaterThan(addon);
        expect(target.slice(journal, addon)).toContain('[ "$HMM_ADDON_LOG" = addon ]');
        expect(target.match(/echo /g)).toHaveLength(3);
    });

    it('falls back to the addon directory with a logger line when /var/log cannot be written', () => {
        const fallbackAt = start.indexOf('if [ "$LOG_TARGET" = varlog ]; then');
        const b25 = start.indexOf('if [ ! -w $ADDON_DIR/var ]');
        expect(fallbackAt).toBeGreaterThan(0);
        expect(b25).toBeGreaterThan(fallbackAt);
        const fallback = start.slice(fallbackAt, b25);
        expect(fallback).toContain('mkdir -p $VARLOG_DIR');
        expect(fallback).toContain('[ ! -w $VARLOG_DIR ]');
        expect(fallback).toContain('[ ! -w $VARLOG_LOG ]');
        expect(fallback).toMatch(/logger -t \$ADDON -p daemon\.warn [^\n]*\n\s*LOG_TARGET=addon\n/);
    });

    it('rotates both files at 1 MB, and removes the file at the other location first', () => {
        expect(rc).toContain('\nLOG_MAX=1048576\n');
        expect(start).toMatch(/\n\s*varlog\)\n\s*LOG=\$VARLOG_LOG\n\s*OTHER_LOG=\$ADDON_LOG\n/);
        expect(start).toMatch(/\n\s*\*\)\n\s*LOG=\$ADDON_LOG\n\s*OTHER_LOG=\$VARLOG_LOG\n/);
        const journalAt = start.indexOf('if [ "$LOG_TARGET" = journal ]; then');
        const elseAt = start.indexOf('\n    else\n', journalAt);
        const fileBranch = start.slice(elseAt, start.indexOf('\n    fi\n', start.indexOf('RUN="exec $NODE"')));
        const removed = fileBranch.indexOf('rm -f $OTHER_LOG $OTHER_LOG.1');
        const rotated = fileBranch.indexOf('mv $LOG $LOG.1');
        expect(removed).toBeGreaterThan(0);
        expect(rotated).toBeGreaterThan(removed);
        expect(fileBranch).toContain('OUTPUT=">>$LOG 2>&1"');
    });

    it('takes /var/log/hmm.log along at an uninstall', () => {
        const uninstall = /\n {4}uninstall\)\n([\s\S]*?);;\n/.exec(rc)?.[1] ?? '';
        expect(uninstall).toContain('rm -f $VARLOG_LOG $VARLOG_LOG.1');
    });
});

describe('the callback ports of the addon (task 35)', () => {
    const rc = file('../files/hmm/rc.d/hmm');
    const {xmlrpc, binrpc} = CALLBACK_DEFAULT_PORTS;

    it('are set by rc.d/hmm before it reads hmm.env, so hmm.env can move them', () => {
        const sourced = rc.indexOf('. $ENV_FILE');
        const xmlrpcLine = rc.indexOf(`\n    HMM_CALLBACK_XMLRPC_DEFAULT_PORT=${String(xmlrpc)}\n`);
        const binrpcLine = rc.indexOf(`\n    HMM_CALLBACK_BINRPC_DEFAULT_PORT=${String(binrpc)}\n`);
        expect(xmlrpcLine).toBeGreaterThan(0);
        expect(binrpcLine).toBeGreaterThan(0);
        expect(sourced).toBeGreaterThan(Math.max(xmlrpcLine, binrpcLine));
        // exported, because the host reads them as the HMM_* mirrors of --callback-*-default-port
        expect(rc).toMatch(
            /^ {4}export [^\n]*\bHMM_CALLBACK_XMLRPC_DEFAULT_PORT\b[^\n]*\bHMM_CALLBACK_BINRPC_DEFAULT_PORT\b/m,
        );
    });

    it('are the ones default.env and the README document', () => {
        const env = file('../files/hmm/etc/default.env');
        expect(env).toContain(`#HMM_CALLBACK_XMLRPC_DEFAULT_PORT=${String(xmlrpc)}\n`);
        expect(env).toContain(`#HMM_CALLBACK_BINRPC_DEFAULT_PORT=${String(binrpc)}\n`);
        expect(file('../README.md')).toContain(
            `**fixed by\ndefault: ${String(xmlrpc)} for XML-RPC, ${String(binrpc)} for BIN-RPC**`,
        );
    });

    it('differ from each other and from the port of the host itself', () => {
        const hostPort = Number(/^ {4}HMM_PORT=(\d+)$/m.exec(rc)?.[1]);
        expect(hostPort).toBe(8090);
        expect(new Set([xmlrpc, binrpc, hostPort, hostPort + 1]).size).toBe(4);
    });

    it('stay clear of every port a CCU and its usual neighbours listen on', () => {
        for (const port of [xmlrpc, binrpc]) {
            expect(TAKEN_PORTS).not.toContain(port);
            for (const [low, high] of TAKEN_RANGES) {
                expect(port < low || port > high, `${String(port)} lies in ${String(low)}-${String(high)}`).toBe(true);
            }
        }
    });
});
