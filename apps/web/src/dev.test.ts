import type {ChildProcess} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {existsSync} from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type {AddressInfo} from 'node:net';

import {describe, expect, it, vi} from 'vitest';

import {devUrl, freePort, resolveViteBin, runDev, uiPackageDir, waitForPort, type RunDevOptions} from './dev.js';
import type {Logger} from './log.js';

describe('uiPackageDir and devUrl', () => {
    it('point at packages/ui and at the dev server', () => {
        expect(uiPackageDir('/repo/apps/web/dist')).toBe(path.resolve('/repo/packages/ui'));
        expect(uiPackageDir()).toMatch(/packages[\\/]ui$/);
        expect(devUrl(5173)).toBe('http://127.0.0.1:5173');
    });
});

describe('resolveViteBin', () => {
    it('finds vite next to the ui package it belongs to', () => {
        const bin = resolveViteBin(uiPackageDir());
        expect(bin).toMatch(/vite[\\/]bin[\\/]vite\.js$/);
        expect(existsSync(bin)).toBe(true);
    });

    it('says so when there is no such package', () => {
        expect(() => resolveViteBin('/nowhere')).toThrow();
    });
});

describe('runDev', () => {
    function fakeVite(): {child: ChildProcess; killed: string[]} {
        const emitter = new EventEmitter() as ChildProcess;
        const killed: string[] = [];
        emitter.kill = ((signal?: string) => {
            killed.push(signal ?? 'SIGTERM');
            return true;
        }) as ChildProcess['kill'];
        return {child: emitter, killed};
    }

    function quiet(): Logger {
        return {error: () => undefined, warn: () => undefined, info: () => undefined, debug: () => undefined};
    }

    it('starts vite, waits for it and points the host at it', async () => {
        const {child} = fakeVite();
        const spawn = vi.fn(() => child) as unknown as NonNullable<RunDevOptions['spawn']>;
        const run = vi.fn<NonNullable<RunDevOptions['run']>>(() => Promise.resolve({code: 0}));
        await runDev({argv: ['--port', '0'], spawn, run, waitFor: () => Promise.resolve(), log: quiet()});

        const call = vi.mocked(spawn).mock.calls[0];
        expect(call?.[0]).toBe(process.execPath);
        expect((call?.[1] as string[]).join(' ')).toMatch(/vite\.js --port \d+ --strictPort/);
        expect((call?.[2] as {env: Record<string, string>}).env['VITE_HMM_DEMO']).toBe('false');
        const argv = run.mock.calls[0]?.[0]?.argv as string[];
        expect(argv.slice(0, 2)).toEqual(['--port', '0']);
        expect(argv.at(-2)).toBe('--ui-dev-server');
        expect(argv.at(-1)).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    });

    it('stops vite and passes the exit code on when the host will not start', async () => {
        const {child, killed} = fakeVite();
        const exit = vi.fn();
        await runDev({
            spawn: vi.fn(() => child) as unknown as NonNullable<RunDevOptions['spawn']>,
            run: () => Promise.resolve({code: 1}),
            waitFor: () => Promise.resolve(),
            exit,
            log: quiet(),
        });
        expect(killed).toEqual(['SIGTERM']);
        expect(exit).toHaveBeenCalledWith(1);
    });

    it('exits when vite itself dies', async () => {
        const {child} = fakeVite();
        const exit = vi.fn();
        await runDev({
            spawn: vi.fn(() => child) as unknown as NonNullable<RunDevOptions['spawn']>,
            run: () => Promise.resolve({code: 0}),
            waitFor: () => Promise.resolve(),
            exit,
            log: quiet(),
        });
        child.emit('exit', 0);
        expect(exit).not.toHaveBeenCalled();
        child.emit('exit', 3);
        expect(exit).toHaveBeenCalledWith(3);
    });

    it('says what to do when vite cannot be started at all', async () => {
        const errors: string[] = [];
        const exit = vi.fn();
        await runDev({
            spawn: (() => {
                throw new Error('ENOENT');
            }) as unknown as NonNullable<RunDevOptions['spawn']>,
            run: () => Promise.resolve({code: 0}),
            waitFor: () => Promise.resolve(),
            exit,
            log: {...quiet(), error: (...parts: unknown[]) => errors.push(parts.map(String).join(' '))},
        });
        expect(errors.join(' ')).toContain('npm install');
        expect(exit).toHaveBeenCalledWith(1);
    });
});

describe('freePort and waitForPort', () => {
    it('picks a port nothing is listening on, and waits for it to answer', async () => {
        const port = await freePort();
        expect(port).toBeGreaterThan(0);

        const server = http.createServer();
        await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
        try {
            expect((server.address() as AddressInfo).port).toBe(port);
            await expect(waitForPort(port, 2000)).resolves.toBeUndefined();
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });

    it('gives up when nothing ever comes up', async () => {
        const port = await freePort();
        await expect(waitForPort(port, 100)).rejects.toThrow(/did not come up/);
    });
});
