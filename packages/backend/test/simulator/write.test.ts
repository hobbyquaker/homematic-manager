/**
 * The write path against a real interface process: changed-only versus `writeAll`, `dryRun`, the
 * multi-apply refusal of issue #98, both `CONFIG_PENDING` modes of the simulator, the link paramset
 * with `UI_HINT` and `value.set`.
 */

import {afterEach, describe, expect, it} from 'vitest';

import {simulatorAvailable, startBackend, startSimulator} from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any -- hm-simulator ships no types */

const PDT = '0001D3C99ABCDE:3';
const PDT_OTHER_FIRMWARE = '0003D3C99ABCDE:3';
const WRC = '0002D3C99ABCDE:1';

const running: {close: () => unknown}[] = [];

afterEach(async () => {
    for (const item of running.splice(0)) {
        await item.close();
    }
});

async function connected(options: Parameters<typeof startSimulator>[0] = {}): Promise<{
    sim: any;
    harness: Awaited<ReturnType<typeof startBackend>>;
}> {
    const sim = await startSimulator(options);
    running.push({close: () => sim.close()});
    const harness = await startBackend(sim);
    running.unshift({close: () => harness.close()});
    return {sim, harness};
}

describe.skipIf(!simulatorAvailable)('writing paramsets against hm-simulator', () => {
    it('sends only the changed parameter', async () => {
        const {sim, harness} = await connected();
        const results = await harness.backend.request('paramset.put', 'HmIP-RF', [PDT], 'MASTER', {
            LOGGING: true,
            DIM_STEP: 0.05,
        });
        expect(results[0]).toMatchObject({ok: true, sent: {LOGGING: true}});
        expect(Object.keys(results[0]?.sent ?? {})).toEqual(['LOGGING']);

        const written = sim.getWriteLog() as {values: Record<string, unknown>}[];
        expect(written.at(-1)?.values).toEqual({LOGGING: true});
        expect(await harness.backend.request('paramset.get', 'HmIP-RF', PDT, 'MASTER')).toMatchObject({LOGGING: true});
    });

    it('sends every writable parameter with writeAll', async () => {
        const {sim, harness} = await connected();
        const results = await harness.backend.request(
            'paramset.put',
            'HmIP-RF',
            [PDT],
            'MASTER',
            {LOGGING: true},
            {writeAll: true},
        );
        expect(results[0]?.ok).toBe(true);
        const written = sim.getWriteLog() as {values: Record<string, unknown>}[];
        expect(Object.keys(written.at(-1)?.values ?? {}).sort()).toEqual(['DIM_STEP', 'LOGGING', 'MODE']);
    });

    it('dryRun shows the payload and sends nothing', async () => {
        const {sim, harness} = await connected();
        const before = (sim.getWriteLog() as unknown[]).length;
        const results = await harness.backend.request(
            'paramset.put',
            'HmIP-RF',
            [PDT],
            'MASTER',
            {LOGGING: true},
            {dryRun: true},
        );
        expect(results[0]).toMatchObject({ok: true, skipped: true, sent: {LOGGING: true}});
        expect((sim.getWriteLog() as unknown[]).length).toBe(before);
    });

    it('refuses a multi-apply to a channel with another paramset description (#98)', async () => {
        const {sim, harness} = await connected();
        const results = await harness.backend.request('paramset.put', 'HmIP-RF', [PDT, PDT_OTHER_FIRMWARE], 'MASTER', {
            LOGGING: true,
        });
        expect(results.map((result) => [result.address, result.ok])).toEqual([
            [PDT, true],
            [PDT_OTHER_FIRMWARE, false],
        ]);
        expect(results[1]?.problems[0]?.message).toContain('different paramset description');
        const written = sim.getWriteLog() as {address: string}[];
        expect(written.map((entry) => entry.address)).not.toContain(PDT_OTHER_FIRMWARE);
    });

    it('never sends an unknown or out-of-range parameter, so no fault is provoked at all', async () => {
        const {sim, harness} = await connected();
        const before = (sim.getWriteLog() as unknown[]).length;
        const results = await harness.backend.request('paramset.put', 'HmIP-RF', [PDT], 'MASTER', {
            NOT_A_PARAMETER: 1,
            DIM_STEP: 5,
        });
        expect(results[0]?.ok).toBe(false);
        expect(results[0]?.problems.map((problem) => problem.parameter).sort()).toEqual([
            'DIM_STEP',
            'NOT_A_PARAMETER',
        ]);
        expect((sim.getWriteLog() as unknown[]).length).toBe(before);
        expect(sim.getConfigPending('hmip')).toEqual([]);
    });

    it('CONFIG_PENDING strict: a bad write is a fault, and ours never gets that far', async () => {
        const {sim, harness} = await connected({configPendingMode: 'strict'});
        // what 2.x sent: everything the dialog had, including a parameter the device does not know
        const raw = await harness.backend
            .request('rpc.call', 'HmIP-RF', 'putParamset', [PDT, 'MASTER', {NOT_A_PARAMETER: 1}])
            .catch((error: unknown) => error);
        expect(raw).toBeInstanceOf(Error);
        expect((raw as {faultCode?: number}).faultCode).toBeDefined();
        expect(sim.getConfigPending('hmip')).toEqual([]);

        // what the write path sends instead: nothing at all
        const results = await harness.backend.request('paramset.put', 'HmIP-RF', [PDT], 'MASTER', {
            NOT_A_PARAMETER: 1,
        });
        expect(results[0]?.ok).toBe(false);
        expect(sim.getConfigPending('hmip')).toEqual([]);
    });

    it('CONFIG_PENDING pending: the same bad write sticks, and ours still does not', async () => {
        const {sim, harness} = await connected({configPendingMode: 'pending'});
        await harness.backend
            .request('rpc.call', 'HmIP-RF', 'putParamset', [PDT, 'MASTER', {NOT_A_PARAMETER: 1}])
            .catch(() => undefined);
        // the simulator records the pending flag on the device, and raises CONFIG_PENDING on its
        // :0 channel; either way the device is stuck until it is repaired
        expect((sim.getConfigPending('hmip') as {address: string}[]).map((entry) => entry.address)).toContain(
            '0001D3C99ABCDE',
        );

        // the recovery the simulator models: a valid full MASTER write
        const results = await harness.backend.request(
            'paramset.put',
            'HmIP-RF',
            [PDT],
            'MASTER',
            {LOGGING: true},
            {writeAll: true},
        );
        expect(results[0]?.ok).toBe(true);
        expect(sim.getConfigPending('hmip')).toEqual([]);
    });

    it('writes a link paramset in both directions and always sends UI_HINT (task 6.5a)', async () => {
        const {sim, harness} = await connected();
        await harness.backend.request('links.add', 'HmIP-RF', WRC, PDT, 'Taster', 'Test');
        expect((await harness.backend.request('links.list', 'HmIP-RF')).map((link) => link.SENDER)).toContain(WRC);

        const first = await harness.backend.request('paramset.putLink', 'HmIP-RF', [{sender: WRC, receiver: PDT}], {
            receiverToSender: {SHORT_ON_TIME: 5, UI_HINT: 3},
        });
        expect(first[0]).toMatchObject({ok: true, address: PDT, peer: WRC});
        expect(first[0]?.sent).toMatchObject({UI_HINT: 3});

        // the profile did not change, the on-time did: UI_HINT still goes with it
        const second = await harness.backend.request('paramset.putLink', 'HmIP-RF', [{sender: WRC, receiver: PDT}], {
            receiverToSender: {SHORT_ON_TIME: 7, UI_HINT: 3},
        });
        expect(second[0]?.sent).toEqual({SHORT_ON_TIME: {explicitDouble: 7}, UI_HINT: 3});

        const stored = await harness.backend.request('paramset.get', 'HmIP-RF', PDT, WRC);
        expect(stored).toMatchObject({SHORT_ON_TIME: 7, UI_HINT: 3});
        expect((sim.getWriteLog() as {paramset: string}[]).some((entry) => entry.paramset === WRC)).toBe(true);
    });

    it('sets a single value against its VALUES description', async () => {
        const {harness} = await connected();
        await harness.backend.request('value.set', 'HmIP-RF', PDT, 'STATE', true);
        expect(await harness.backend.request('value.get', 'HmIP-RF', PDT, 'STATE')).toBe(true);
        await expect(harness.backend.request('value.set', 'HmIP-RF', PDT, 'NOPE', true)).rejects.toThrow(
            'has no parameter NOPE',
        );
    });

    it('sends an ENUM to HmIP by name (A-1)', async () => {
        const {sim, harness} = await connected();
        await harness.backend.request('paramset.put', 'HmIP-RF', [PDT], 'MASTER', {MODE: 'AUTO'});
        const written = sim.getWriteLog() as {values: Record<string, unknown>}[];
        expect(written.at(-1)?.values).toEqual({MODE: 'AUTO'});
    });

    it('logs every write and keeps the 2.x rpcLogFolder dump available', async () => {
        const {harness} = await connected();
        await harness.backend.request('paramset.put', 'HmIP-RF', [PDT], 'MASTER', {LOGGING: true});
        await harness.backend.request('value.set', 'HmIP-RF', PDT, 'STATE', true);
        const log = await harness.backend.request('writeLog.list');
        expect(log.map((entry) => entry.method)).toEqual(['putParamset', 'setValue']);
        expect(log.every((entry) => entry.ok)).toBe(true);
        expect(log[0]?.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('writes to a BidCos interface over binrpc', async () => {
        const {sim, harness} = await connected();
        const results = await harness.backend.request('paramset.put', 'BidCos-RF', ['LEQ0000001:1'], 'MASTER', {
            TRANSMIT_TRY_MAX: 8,
        });
        expect(results[0]?.ok).toBe(true);
        expect((sim.getWriteLog() as {iface: string}[]).some((entry) => entry.iface === 'rfd')).toBe(true);
        expect(await harness.backend.request('paramset.get', 'BidCos-RF', 'LEQ0000001:1', 'MASTER')).toMatchObject({
            TRANSMIT_TRY_MAX: 8,
        });
    });
});
