import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import type {WriteLogEntry} from '@homematic-manager/core';

import type {RpcCallRecord} from '../rpc/client.js';
import {WRITE_METHODS, WriteLog, isWriteMethod} from './log.js';

let dir: string;

beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-writelog-'));
});

afterEach(async () => {
    await fs.rm(dir, {recursive: true, force: true});
});

const record = (overrides: Partial<RpcCallRecord> = {}): RpcCallRecord => ({
    interfaceName: 'HmIP-RF',
    method: 'putParamset',
    params: ['ABC1:1', 'MASTER', {LOGGING: true}],
    ok: true,
    result: '',
    durationMs: 12,
    timestamp: 1_700_000_000_000,
    ...overrides,
});

describe('isWriteMethod', () => {
    it('knows the calls that change something', () => {
        expect(isWriteMethod('putParamset')).toBe(true);
        expect(isWriteMethod('setValue')).toBe(true);
        expect(isWriteMethod('addLink')).toBe(true);
        expect(isWriteMethod('setBidcosInterface')).toBe(true);
    });

    it('lets the reads past', () => {
        for (const method of ['getParamset', 'getParamsetDescription', 'listDevices', 'rssiInfo', 'ping', 'getLinks']) {
            expect(isWriteMethod(method)).toBe(false);
        }
        expect(WRITE_METHODS.has('getValue')).toBe(false);
    });
});

describe('WriteLog', () => {
    it('records a write and hands out the entry', () => {
        const appended: WriteLogEntry[] = [];
        const log = new WriteLog({onAppended: (entry) => appended.push(entry)});
        const entry = log.append(record());
        expect(entry).toEqual({
            id: 1,
            timestamp: 1_700_000_000_000,
            interfaceName: 'HmIP-RF',
            method: 'putParamset',
            params: ['ABC1:1', 'MASTER', {LOGGING: true}],
            ok: true,
            result: '',
            durationMs: 12,
        });
        expect(appended).toEqual([entry]);
        expect(log.size).toBe(1);
    });

    it('ignores a read', () => {
        const log = new WriteLog();
        expect(log.append(record({method: 'getParamset'}))).toBeUndefined();
        expect(log.size).toBe(0);
    });

    it('keeps the error of a failed write', () => {
        const log = new WriteLog();
        const failed: RpcCallRecord = {...record(), ok: false, error: 'fault -7'};
        delete (failed as {result?: unknown}).result;
        const entry = log.append(failed);
        expect(entry?.ok).toBe(false);
        expect(entry?.error).toBe('fault -7');
        expect(entry?.result).toBeUndefined();
    });

    it('gives every entry its own id and keeps the newest ones', () => {
        const log = new WriteLog({capacity: 3});
        for (let i = 0; i < 5; i += 1) {
            log.append(record({params: [i]}));
        }
        expect(log.list().map((entry) => entry.id)).toEqual([3, 4, 5]);
        expect(log.list(2).map((entry) => entry.id)).toEqual([4, 5]);
        expect(log.list(99)).toHaveLength(3);
    });

    it('clears', () => {
        const log = new WriteLog();
        log.append(record());
        log.clear();
        expect(log.list()).toEqual([]);
    });

    it('persists and reloads across a session', async () => {
        const file = path.join(dir, 'write-log.json');
        const first = new WriteLog({file, writeDelayMs: 0});
        first.append(record());
        first.append(record({method: 'setValue'}));
        await first.flush();

        const second = new WriteLog({file});
        await second.load();
        expect(second.list().map((entry) => entry.method)).toEqual(['putParamset', 'setValue']);
        // ids continue where the previous session stopped
        expect(second.append(record())?.id).toBe(3);
    });

    it('survives a log file that is not a list', async () => {
        const file = path.join(dir, 'write-log.json');
        await fs.writeFile(file, JSON.stringify({nope: true}), 'utf8');
        const log = new WriteLog({file});
        await log.load();
        expect(log.list()).toEqual([]);
    });

    it('loads nothing when it keeps no file', async () => {
        const log = new WriteLog();
        await log.load();
        await log.flush();
        expect(log.list()).toEqual([]);
    });

    it('writes the 2.x rpcLogFolder dump for putParamset only', async () => {
        const log = new WriteLog({rpcLogFolder: dir});
        log.append(record());
        log.append(record({method: 'setValue'}));
        await new Promise((resolve) => setTimeout(resolve, 20));
        const files = await fs.readdir(dir);
        expect(files).toEqual(['1700000000000_HmIP-RF_putParamset.json']);
        const content = JSON.parse(await fs.readFile(path.join(dir, files[0] as string), 'utf8')) as unknown;
        expect(content).toEqual(['ABC1:1', 'MASTER', {LOGGING: true}]);
    });

    it('reports a dump that cannot be written instead of throwing', async () => {
        const onError = vi.fn();
        const log = new WriteLog({rpcLogFolder: path.join(dir, 'does-not-exist'), onError});
        log.append(record());
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(onError).toHaveBeenCalledOnce();
    });

    it('can switch the dump folder on and off', async () => {
        const log = new WriteLog();
        log.append(record());
        log.setRpcLogFolder(dir);
        log.append(record({timestamp: 1_700_000_000_001}));
        log.setRpcLogFolder('');
        log.append(record({timestamp: 1_700_000_000_002}));
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(await fs.readdir(dir)).toEqual(['1700000000001_HmIP-RF_putParamset.json']);
    });
});
