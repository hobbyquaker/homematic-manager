import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {afterEach, describe, expect, it, vi} from 'vitest';

import {isMainModule, runCli} from './cli.js';
import type {Logger} from './log.js';
import type {WebOptions} from './options.js';
import type {WebHost} from './server.js';

let temporary: string | undefined;
const started: WebHost[] = [];

afterEach(async () => {
    for (const host of started.splice(0)) {
        await host.close();
    }
    if (temporary !== undefined) {
        await fs.rm(temporary, {recursive: true, force: true});
        temporary = undefined;
    }
});

function capture(): {out: string[]; err: string[]; write: (text: string) => void; writeError: (text: string) => void} {
    const out: string[] = [];
    const err: string[] = [];
    return {out, err, write: (text) => out.push(text), writeError: (text) => err.push(text)};
}

/** A host that is not a host: `runCli` only needs `url`, `token` and `close`. */
function fakeHost(token: string | undefined = 'abc'): WebHost {
    return {url: 'http://127.0.0.1:1234/', token, close: () => Promise.resolve()} as unknown as WebHost;
}

describe('runCli', () => {
    it('prints the help and exits 0', async () => {
        const io = capture();
        const run = await runCli({argv: ['--help'], env: {}, ...io});
        expect(run.code).toBe(0);
        expect(run.host).toBeUndefined();
        expect(io.out.join('')).toContain('--data-dir');
    });

    it('prints the version', async () => {
        const io = capture();
        await runCli({argv: ['--version'], env: {}, version: '9.9.9', ...io});
        expect(io.out.join('')).toBe('9.9.9\n');
    });

    it('prints a JSON schema of every configuration option', async () => {
        const io = capture();
        await runCli({argv: ['--config-schema'], env: {}, version: '9.9.9', ...io});
        const schema = JSON.parse(io.out.join('')) as {title: string; properties: Record<string, unknown>};
        expect(schema.title).toContain('9.9.9');
        expect(schema.properties['port']).toBeDefined();
        expect(schema.properties['help']).toBeUndefined();
    });

    it('reports a usage error on stderr and exits 1', async () => {
        const io = capture();
        const run = await runCli({argv: ['--nope'], env: {}, ...io});
        expect(run.code).toBe(1);
        expect(io.err.join('')).toContain('unknown option');
        expect(io.err.join('')).toContain('--help');
    });

    it('prints a generated token once, and never one it was given (task 13)', async () => {
        const lines: string[] = [];
        const io = capture();
        const write = (level: string, line: string): void => {
            lines.push(`${level} ${line}`);
        };

        await runCli({
            argv: ['--log-level', 'debug'],
            env: {},
            ...io,
            logWrite: write,
            start: () => Promise.resolve(fakeHost('generated')),
            onSignal: () => undefined,
        });
        expect(lines.filter((line) => line.startsWith('info') && line.includes('generated'))).toHaveLength(1);

        lines.length = 0;
        await runCli({
            argv: ['--token', 'S3CRET', '--log-level', 'debug'],
            env: {},
            ...io,
            logWrite: write,
            start: () => Promise.resolve(fakeHost('S3CRET')),
            onSignal: () => undefined,
        });
        // the value appears at debug only; the info line just says a token is in force
        expect(lines.filter((line) => line.startsWith('info') && line.includes('S3CRET'))).toHaveLength(0);
        expect(lines.some((line) => line.startsWith('debug') && line.includes('S3CRET'))).toBe(true);
    });

    it('reports a host that will not start and exits 1', async () => {
        const io = capture();
        const run = await runCli({
            argv: [],
            env: {},
            ...io,
            start: () => Promise.reject(new Error('EADDRINUSE')),
        });
        expect(run.code).toBe(1);
        expect(io.err.join('')).toContain('EADDRINUSE');
    });

    it('passes the parsed options through to the host', async () => {
        const io = capture();
        const start = vi.fn<(options: WebOptions, log: Logger) => Promise<WebHost>>(() => Promise.resolve(fakeHost()));
        await runCli({
            argv: ['--port', '0', '--demo', '--base', '/addons/hmm/', '-a', 'ccu3'],
            env: {HMM_LOG_LEVEL: 'error'},
            ...io,
            start,
            onSignal: () => undefined,
        });
        expect(start.mock.calls[0]?.[0]).toMatchObject({
            port: 0,
            demo: true,
            base: '/addons/hmm/',
            ccu: 'ccu3',
            logLevel: 'error',
        });
    });

    it('runs the shutdown on a signal and reports the exit code', async () => {
        const io = capture();
        const close = vi.fn(() => Promise.resolve());
        const exit = vi.fn();
        let signal: (() => void) | undefined;
        const run = await runCli({
            argv: ['--log-level', 'error'],
            env: {},
            ...io,
            start: () => Promise.resolve({...fakeHost(), close} as unknown as WebHost),
            onSignal: (handler) => {
                signal = handler;
            },
            exit,
        });
        expect(run.code).toBe(0);
        signal?.();
        await run.stop?.();
        // a second signal must not close twice
        await run.stop?.();
        expect(close).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledWith(0);
    });

    it('exits 1 when the shutdown itself fails', async () => {
        const io = capture();
        const exit = vi.fn();
        // the logger of runCli writes to the real stderr; this one line is expected, not noise
        const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
        const run = await runCli({
            argv: ['--log-level', 'error'],
            env: {},
            ...io,
            start: () =>
                Promise.resolve({
                    ...fakeHost(),
                    close: () => Promise.reject(new Error('stuck')),
                } as unknown as WebHost),
            onSignal: () => undefined,
            exit,
        });
        await run.stop?.();
        expect(stderr.mock.calls.join('')).toContain('shutdown failed: stuck');
        stderr.mockRestore();
        expect(exit).toHaveBeenCalledWith(1);
    });

    it('really starts a host, serves the UI and stops again', async () => {
        temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-cli-'));
        const uiDir = path.join(temporary, 'ui');
        await fs.mkdir(uiDir, {recursive: true});
        await fs.writeFile(path.join(uiDir, 'index.html'), '<!doctype html><title>Homematic Manager</title>');
        const io = capture();
        const run = await runCli({
            argv: [
                '--port',
                '0',
                '--log-level',
                'error',
                '--ui-dir',
                uiDir,
                '--data-dir',
                path.join(temporary, 'profile'),
                '--token',
                'zzz',
            ],
            env: {},
            ...io,
            onSignal: () => undefined,
        });
        expect(run.code).toBe(0);
        const host = run.host as WebHost;
        started.push(host);
        expect(host.token).toBe('zzz');
        const answer = await fetch(host.url);
        expect(await answer.text()).toContain('Homematic Manager');
    });
});

describe('the defaults runCli falls back to', () => {
    it('writes to the real stdout and stderr', async () => {
        const written: string[] = [];
        const record = (chunk: unknown): boolean => (written.push(String(chunk)), true);
        const out = vi.spyOn(process.stdout, 'write').mockImplementation(record as never);
        const err = vi.spyOn(process.stderr, 'write').mockImplementation(record as never);
        try {
            await runCli({argv: ['--version'], env: {}, version: '7.7.7'});
            await runCli({argv: ['--nope'], env: {}});
        } finally {
            out.mockRestore();
            err.mockRestore();
        }
        expect(written.join('')).toContain('7.7.7');
        expect(written.join('')).toContain('unknown option');
    });

    it('installs SIGINT and SIGTERM handlers of its own', async () => {
        temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-cli-'));
        const before = new Set([...process.listeners('SIGINT'), ...process.listeners('SIGTERM')]);
        const run = await runCli({
            argv: ['--port', '0', '--log-level', 'error', '--data-dir', path.join(temporary, 'profile'), '--demo'],
            env: {},
            ...capture(),
        });
        const host = run.host as WebHost;
        started.push(host);
        const added = [...process.listeners('SIGINT'), ...process.listeners('SIGTERM')].filter(
            (listener) => !before.has(listener),
        );
        expect(added).toHaveLength(2);
        for (const listener of added) {
            process.off('SIGINT', listener);
            process.off('SIGTERM', listener);
        }
    });
});

describe('isMainModule', () => {
    it('is true only for the file that was started', () => {
        expect(isMainModule('file:///a/cli.js', undefined)).toBe(false);
        expect(isMainModule('file:///a/cli.js', '/does/not/exist')).toBe(false);
        expect(isMainModule('file:///a/cli.js', fileURLToPath(import.meta.url))).toBe(false);
        expect(isMainModule(import.meta.url, fileURLToPath(import.meta.url))).toBe(true);
    });
});
