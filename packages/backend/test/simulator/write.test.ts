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

    /*
     * The four tests below run against the simulator's `hmip` mode, which is what hmipserver 3.89.8
     * was measured to do on 2026-09-05 (task 6, docs/config-pending.md). They are the regression
     * tests for the provocations that mattered: a wrong type, an unknown parameter, and the two
     * recoveries.
     */
    it('hmip mode: a wrong type sticks in CONFIG_PENDING, and the write path never sends one', async () => {
        const {sim, harness} = await connected();
        // what 2.x would send: a value the parameter cannot hold
        await harness.backend
            .request('rpc.call', 'HmIP-RF', 'putParamset', [PDT, 'MASTER', {DIM_STEP: 'not-a-number'}])
            .catch(() => undefined);
        expect((sim.getConfigPending('hmip') as {address: string; sticky: boolean}[]).map((e) => e.address)).toEqual([
            '0001D3C99ABCDE',
        ]);

        // devices.repairConfig: a valid full MASTER write per channel, built from the description
        const repair = await harness.backend.request('devices.repairConfig', 'HmIP-RF', PDT);
        expect(repair.configPendingBefore).toBe(true);
        expect(repair.configPendingAfter).toBe(false);
        expect(repair.unrepairable).toEqual([]);
        const channel = repair.channels.find((entry) => entry.address === PDT);
        expect(channel?.corrected.map((entry) => entry.parameter)).toContain('DIM_STEP');
        expect(sim.getConfigPending('hmip')).toEqual([]);

        // and the write path itself would never have produced it: an ENUM value that is in neither
        // form is exactly what left the lab device stuck, and it is refused before the wire
        const results = await harness.backend.request('paramset.put', 'HmIP-RF', [PDT], 'MASTER', {MODE: 'NOPE'});
        expect(results[0]?.ok).toBe(false);
        expect(results[0]?.problems[0]?.parameter).toBe('MODE');
        expect(sim.getConfigPending('hmip')).toEqual([]);

        // a string in a FLOAT is the one case the cast rescues instead of refusing: it becomes a
        // number the parameter can hold, so the device is safe either way
        const rescued = await harness.backend.request('paramset.put', 'HmIP-RF', [PDT], 'MASTER', {
            DIM_STEP: 'not-a-number',
        });
        expect(rescued[0]?.ok).toBe(true);
        expect(typeof (await harness.backend.request('paramset.get', 'HmIP-RF', PDT, 'MASTER'))['DIM_STEP']).toBe(
            'number',
        );
        expect(sim.getConfigPending('hmip')).toEqual([]);
    });

    it('hmip mode: an unknown parameter poisons the channel for good, and we never send one', async () => {
        const {sim, harness} = await connected();
        await harness.backend
            .request('rpc.call', 'HmIP-RF', 'putParamset', [PDT, 'MASTER', {NOT_A_PARAMETER: 1}])
            .catch(() => undefined);
        expect(sim.getPoisonedChannels('hmip')).toEqual([PDT]);
        // no CONFIG_PENDING: nothing the device knows about changed, so nothing is pending - the
        // channel is silently broken, which is what made issue #98 so hard to see
        expect(sim.getConfigPending('hmip')).toEqual([]);

        const repair = await harness.backend.request('devices.repairConfig', 'HmIP-RF', PDT);
        expect(repair.unrepairable).toEqual([PDT]);
        const channel = repair.channels.find((entry) => entry.address === PDT);
        expect(channel?.unknown).toEqual(['NOT_A_PARAMETER']);
        expect(channel?.write.ok).toBe(false);
        expect(channel?.write.faultCode).toBe(-5);
        // the repair does not write the unknown parameter back
        expect(Object.keys(channel?.write.sent ?? {})).not.toContain('NOT_A_PARAMETER');

        // the write path drops it before it reaches the wire, so this can never happen through us
        const before = (sim.getWriteLog() as unknown[]).length;
        const results = await harness.backend.request('paramset.put', 'HmIP-RF', ['0002D3C99ABCDE:1'], 'MASTER', {
            NOT_A_PARAMETER: 1,
        });
        expect(results[0]?.ok).toBe(false);
        expect((sim.getWriteLog() as unknown[]).length).toBe(before);
        expect(sim.getPoisonedChannels('hmip')).toEqual([PDT]);
    });

    it('repairConfig offers no BidCos maintenance method on HmIP and does nothing on a dry run', async () => {
        const {sim, harness} = await connected();
        const before = (sim.getWriteLog() as unknown[]).length;
        const dry = await harness.backend.request('devices.repairConfig', 'HmIP-RF', PDT, {dryRun: true});
        expect((sim.getWriteLog() as unknown[]).length).toBe(before);
        expect(dry.channels.every((entry) => entry.write.skipped === true)).toBe(true);

        // clearConfigCache and restoreConfigToDevice answer -1 Generic error on hmipserver, so the
        // repair does not call them whatever it is asked for
        const asked = await harness.backend.request('devices.repairConfig', 'HmIP-RF', PDT, {
            bidcosRecovery: 'clearConfigCache',
        });
        expect(asked.bidcosRecovery).toBeUndefined();
    });

    it('repairConfig uses the BidCos recovery on a BidCos device', async () => {
        const {sim, harness} = await connected();
        const result = await harness.backend.request('devices.repairConfig', 'BidCos-RF', 'LEQ0000001:1', {
            bidcosRecovery: 'restoreConfigToDevice',
        });
        expect(result.bidcosRecovery).toBe('restoreConfigToDevice');
        expect(result.unrepairable).toEqual([]);
        const log = await harness.backend.request('writeLog.list');
        expect(log.map((entry) => entry.method)).toContain('restoreConfigToDevice');
        expect(sim.getConfigPending('rfd')).toEqual([]);
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

    it('sends an ENUM as its index on every interface (A-1, refuted in the lab)', async () => {
        const {sim, harness} = await connected();
        // A-1 said hmipserver wants the name. It takes both, answers `getParamset` with the index,
        // and so does rfd - so the index is the only encoding a changed-only diff can compare
        // against (task 6, docs/config-pending.md).
        await harness.backend.request('paramset.put', 'HmIP-RF', [PDT], 'MASTER', {MODE: 'AUTO'});
        const written = sim.getWriteLog() as {values: Record<string, unknown>}[];
        expect(written.at(-1)?.values).toEqual({MODE: 2});
        expect(await harness.backend.request('paramset.get', 'HmIP-RF', PDT, 'MASTER')).toMatchObject({MODE: 2});

        // and writing the same value again sends nothing at all, which is the point
        const again = await harness.backend.request('paramset.put', 'HmIP-RF', [PDT], 'MASTER', {MODE: 'AUTO'});
        expect(again[0]).toMatchObject({ok: true, skipped: true, sent: {}});
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
