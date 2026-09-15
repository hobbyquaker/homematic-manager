import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import type {RpcLogEntry} from '@homematic-manager/core';

import type {RpcCallRecord} from './client.js';
import {REDACTED, RpcLog, WRITE_METHODS, isWriteMethod, redactParams} from './log.js';

let dir: string;

beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-rpclog-'));
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
    origin: 'ui',
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

describe('redactParams', () => {
    it('hides the passphrase of changeKey and setTempKey', () => {
        expect(redactParams('changeKey', ['my secret'])).toEqual([REDACTED]);
        expect(redactParams('setTempKey', ['temp'])).toEqual([REDACTED]);
    });

    it('hides the device key of a whitelist entry and keeps the rest', () => {
        expect(
            redactParams('setInstallModeWithWhitelist', [
                true,
                60,
                [{ADDRESS: '3014F711A0001234567890AB', KEY_MODE: 'LOCAL', KEY: 'ABCDEF0123456789'}],
            ]),
        ).toEqual([true, 60, [{ADDRESS: '3014F711A0001234567890AB', KEY_MODE: 'LOCAL', KEY: REDACTED}]]);
    });

    it('leaves everything else alone, including an init URL', () => {
        const params = ['http://192.168.1.2:2042', 'hmm_HmIP-RF'];
        expect(redactParams('init', params)).toEqual(params);
        expect(redactParams('putParamset', ['A:1', 'MASTER', {KEY: 1}])).toEqual(['A:1', 'MASTER', {KEY: 1}]);
    });
});

describe('RpcLog', () => {
    it('records a write and hands out the entry', () => {
        const appended: RpcLogEntry[] = [];
        const log = new RpcLog({onAppended: (entry) => appended.push(entry)});
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
            origin: 'ui',
        });
        expect(appended).toEqual([entry]);
        expect(log.size).toBe(1);
    });

    it('records a read too, with its origin (task 48)', () => {
        const log = new RpcLog();
        const entry = log.append(record({method: 'ping', params: ['hmm'], origin: 'background'}));
        expect(entry).toMatchObject({method: 'ping', params: ['hmm'], origin: 'background'});
        expect(log.append(record({method: 'getVersion', params: [], origin: 'console'})).origin).toBe('console');
        expect(log.size).toBe(2);
    });

    it('logs a passphrase as *** and nothing else', () => {
        const log = new RpcLog();
        expect(log.append(record({method: 'changeKey', params: ['secret']})).params).toEqual([REDACTED]);
    });

    it('keeps the error of a failed write', () => {
        const log = new RpcLog();
        const failed: RpcCallRecord = {...record(), ok: false, error: 'fault -7'};
        delete (failed as {result?: unknown}).result;
        const entry = log.append(failed);
        expect(entry.ok).toBe(false);
        expect(entry.error).toBe('fault -7');
        expect(entry.result).toBeUndefined();
    });

    it('gives every entry its own id and keeps the newest ones', () => {
        const log = new RpcLog({capacity: 3});
        for (let i = 0; i < 5; i += 1) {
            log.append(record({params: [i]}));
        }
        expect(log.list().map((entry) => entry.id)).toEqual([3, 4, 5]);
        expect(log.list(2).map((entry) => entry.id)).toEqual([4, 5]);
        expect(log.list(99)).toHaveLength(3);
    });

    it('keeps an answer over the cap as a preview with its size', () => {
        const log = new RpcLog({resultCapBytes: 100});
        const devices = Array.from({length: 20}, (_entry, index) => ({
            ADDRESS: `DEV${String(index)}`,
            TYPE: 'HmIP-PDT',
        }));
        const entry = log.append(record({method: 'listDevices', params: [], result: devices}));
        expect(entry.resultBytes).toBe(JSON.stringify(devices).length);
        expect(typeof entry.result).toBe('string');
        expect(entry.result).toMatch(/^\[\{"ADDRESS":"DEV0"/);
        expect((entry.result as string).endsWith('…')).toBe(true);
        // a small answer stays what it is
        const small = log.append(record({method: 'getValue', params: ['A:1', 'STATE'], result: true}));
        expect(small.result).toBe(true);
        expect(small.resultBytes).toBeUndefined();
    });

    it('evicts the oldest entries when the byte budget is exceeded', () => {
        const log = new RpcLog({budgetBytes: 600});
        for (let i = 0; i < 20; i += 1) {
            log.append(record({method: 'getValue', params: [`ADDRESS${String(i)}:1`, 'STATE'], result: i}));
        }
        expect(log.bytes).toBeLessThanOrEqual(600);
        expect(log.size).toBeLessThan(20);
        expect(log.size).toBeGreaterThan(0);
        // the newest is always there, whatever the budget
        expect(log.list().at(-1)?.params).toEqual(['ADDRESS19:1', 'STATE']);
        const tiny = new RpcLog({budgetBytes: 1});
        tiny.append(record());
        expect(tiny.size).toBe(1);
    });

    it('clears', () => {
        const log = new RpcLog();
        log.append(record());
        log.clear();
        expect(log.list()).toEqual([]);
        expect(log.bytes).toBe(0);
    });

    it('persists the writes and reloads them across a session, never the reads', async () => {
        const file = path.join(dir, 'write-log.json');
        const first = new RpcLog({file, writeDelayMs: 0});
        first.append(record({method: 'listDevices', params: [], origin: 'background'}));
        first.append(record());
        first.append(record({method: 'ping', params: ['hmm'], origin: 'background'}));
        first.append(record({method: 'setValue'}));
        await first.flush();

        const stored = JSON.parse(await fs.readFile(file, 'utf8')) as RpcLogEntry[];
        expect(stored.map((entry) => entry.method)).toEqual(['putParamset', 'setValue']);

        const second = new RpcLog({file});
        await second.load();
        expect(second.list().map((entry) => entry.method)).toEqual(['putParamset', 'setValue']);
        // ids continue where the previous session stopped
        expect(second.append(record()).id).toBe(5);
    });

    it('gives a write persisted before task 48 the ui origin', async () => {
        const file = path.join(dir, 'write-log.json');
        const legacy: Record<string, unknown> = {...record(), id: 7};
        delete legacy['origin'];
        await fs.writeFile(file, JSON.stringify([legacy]), 'utf8');
        const log = new RpcLog({file});
        await log.load();
        expect(log.list()[0]).toMatchObject({id: 7, origin: 'ui'});
    });

    it('survives a log file that is not a list', async () => {
        const file = path.join(dir, 'write-log.json');
        await fs.writeFile(file, JSON.stringify({nope: true}), 'utf8');
        const log = new RpcLog({file});
        await log.load();
        expect(log.list()).toEqual([]);
    });

    it('loads nothing when it keeps no file', async () => {
        const log = new RpcLog();
        await log.load();
        await log.flush();
        expect(log.list()).toEqual([]);
    });

    it('writes the 2.x rpcLogFolder dump for putParamset only', async () => {
        const log = new RpcLog({rpcLogFolder: dir});
        log.append(record());
        log.append(record({method: 'setValue'}));
        log.append(record({method: 'getParamset', params: ['ABC1:1', 'MASTER']}));
        await new Promise((resolve) => setTimeout(resolve, 20));
        const files = await fs.readdir(dir);
        expect(files).toEqual(['1700000000000_HmIP-RF_putParamset.json']);
        const content = JSON.parse(await fs.readFile(path.join(dir, files[0] as string), 'utf8')) as unknown;
        expect(content).toEqual(['ABC1:1', 'MASTER', {LOGGING: true}]);
    });

    it('reports a dump that cannot be written instead of throwing', async () => {
        const onError = vi.fn();
        const log = new RpcLog({rpcLogFolder: path.join(dir, 'does-not-exist'), onError});
        log.append(record());
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(onError).toHaveBeenCalledOnce();
    });

    it('can switch the dump folder on and off', async () => {
        const log = new RpcLog();
        log.append(record());
        log.setRpcLogFolder(dir);
        log.append(record({timestamp: 1_700_000_000_001}));
        log.setRpcLogFolder('');
        log.append(record({timestamp: 1_700_000_000_002}));
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(await fs.readdir(dir)).toEqual(['1700000000001_HmIP-RF_putParamset.json']);
    });
});
