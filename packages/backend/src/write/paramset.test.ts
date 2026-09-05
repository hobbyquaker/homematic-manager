import {describe, expect, it, vi} from 'vitest';

import {
    DeviceIndex,
    type DeviceDescription,
    type ParamsetDescription,
    type RpcValue,
    type WriteResult,
} from '@homematic-manager/core';

import {BackendError} from '../errors.js';
import type {RpcOutValue} from '../rpc/client.js';
import {ALWAYS_SENT_LINK_PARAMETERS, ParamsetWriter, type ParamsetWriterDeps} from './paramset.js';

const MASTER: ParamsetDescription = {
    LOGGING: {TYPE: 'BOOL', OPERATIONS: 7, DEFAULT: false},
    TRANSMIT_TRY_MAX: {TYPE: 'INTEGER', OPERATIONS: 7, MIN: 1, MAX: 10, DEFAULT: 6},
    ADDRESS: {TYPE: 'INTEGER', OPERATIONS: 5, DEFAULT: 0},
};

const VALUES: ParamsetDescription = {
    STATE: {TYPE: 'BOOL', OPERATIONS: 7, DEFAULT: false},
    LEVEL: {TYPE: 'FLOAT', OPERATIONS: 7, MIN: 0, MAX: 1, DEFAULT: 0},
    RSSI_DEVICE: {TYPE: 'INTEGER', OPERATIONS: 5, DEFAULT: 0},
};

const LINK: ParamsetDescription = {
    SHORT_ON_TIME: {TYPE: 'FLOAT', OPERATIONS: 7, MIN: 0, MAX: 100, DEFAULT: 1},
    UI_HINT: {TYPE: 'INTEGER', OPERATIONS: 7, MIN: 0, MAX: 100, DEFAULT: 0},
};

const devices: DeviceDescription[] = [
    {ADDRESS: 'ABC1', TYPE: 'HmIP-PDT', FIRMWARE: '1.4.8', VERSION: 1, CHILDREN: ['ABC1:1']},
    {ADDRESS: 'ABC1:1', TYPE: 'SWITCH_TRANSCEIVER', PARENT: 'ABC1', VERSION: 1},
    {ADDRESS: 'DEF1', TYPE: 'HmIP-PDT', FIRMWARE: '1.4.8', VERSION: 1, CHILDREN: ['DEF1:1']},
    {ADDRESS: 'DEF1:1', TYPE: 'SWITCH_TRANSCEIVER', PARENT: 'DEF1', VERSION: 1},
    // same channel type, different firmware: the #98 case
    {ADDRESS: 'GHI1', TYPE: 'HmIP-PDT', FIRMWARE: '1.6.0', VERSION: 1, CHILDREN: ['GHI1:1']},
    {ADDRESS: 'GHI1:1', TYPE: 'SWITCH_TRANSCEIVER', PARENT: 'GHI1', VERSION: 1},
    {ADDRESS: 'ORPHAN:1', TYPE: 'SWITCH_TRANSCEIVER', PARENT: 'NOWHERE', VERSION: 1},
];

interface Harness {
    writer: ParamsetWriter;
    writes: {method: string; params: readonly RpcOutValue[]}[];
    reads: {method: string; params: readonly RpcOutValue[]}[];
    progress: {done: number; total: number; last?: WriteResult}[];
}

function harness(
    options: {
        descriptions?: Record<string, ParamsetDescription>;
        current?: Record<string, Record<string, RpcValue>>;
        onWrite?: (method: string, params: readonly RpcOutValue[]) => Promise<RpcValue>;
        onDescribe?: (address: string, paramset: string) => Promise<ParamsetDescription>;
        onRead?: (method: string, params: readonly RpcOutValue[]) => Promise<RpcValue> | undefined;
    } = {},
): Harness {
    const writes: Harness['writes'] = [];
    const reads: Harness['reads'] = [];
    const progress: Harness['progress'] = [];
    const descriptions = options.descriptions ?? {MASTER, VALUES, LINK};
    const deps: ParamsetWriterDeps = {
        index: (interfaceName) => new DeviceIndex(interfaceName, devices),
        describe: (_interfaceName, address, paramset) => {
            if (options.onDescribe) {
                return options.onDescribe(address, paramset);
            }
            const description = descriptions[paramset] ?? descriptions['LINK'];
            return description
                ? Promise.resolve(description)
                : Promise.reject(new BackendError({message: 'no description', kind: 'rpc'}));
        },
        read: (_interfaceName, method, params) => {
            reads.push({method, params});
            const injected = options.onRead?.(method, params);
            if (injected) {
                return injected;
            }
            const address = String(params[0]);
            return Promise.resolve((options.current?.[address] ?? {}) as RpcValue);
        },
        write: (_interfaceName, method, params) => {
            writes.push({method, params});
            return options.onWrite ? options.onWrite(method, params) : Promise.resolve('');
        },
        onProgress: (entry) => progress.push(entry),
    };
    return {writer: new ParamsetWriter(deps), writes, reads, progress};
}

describe('ParamsetWriter.put', () => {
    it('refuses an empty target list', async () => {
        await expect(harness().writer.put('HmIP-RF', [], 'MASTER', {})).rejects.toThrow('no address to write to');
    });

    it('sends only what changed', async () => {
        const h = harness({current: {'ABC1:1': {LOGGING: false, TRANSMIT_TRY_MAX: 6}}});
        const [result] = await h.writer.put('HmIP-RF', ['ABC1:1'], 'MASTER', {LOGGING: true, TRANSMIT_TRY_MAX: 6});
        expect(result?.ok).toBe(true);
        expect(result?.sent).toEqual({LOGGING: true});
        expect(h.writes).toEqual([{method: 'putParamset', params: ['ABC1:1', 'MASTER', {LOGGING: true}]}]);
        expect(h.reads[0]?.method).toBe('getParamset');
    });

    it('sends every writable parameter with writeAll, and reads nothing first', async () => {
        const h = harness({current: {'ABC1:1': {LOGGING: false, TRANSMIT_TRY_MAX: 6}}});
        const [result] = await h.writer.put('HmIP-RF', ['ABC1:1'], 'MASTER', {LOGGING: false}, {writeAll: true});
        expect(h.reads).toEqual([]);
        expect(result?.sent).toEqual({LOGGING: false, TRANSMIT_TRY_MAX: 6});
        expect(Object.keys(result?.sent ?? {})).not.toContain('ADDRESS');
    });

    it('skips a write where nothing changed', async () => {
        const h = harness({current: {'ABC1:1': {LOGGING: true}}});
        const [result] = await h.writer.put('HmIP-RF', ['ABC1:1'], 'MASTER', {LOGGING: true});
        expect(result).toMatchObject({ok: true, skipped: true, sent: {}});
        expect(h.writes).toEqual([]);
    });

    it('never sends an unknown, read-only or out-of-range parameter', async () => {
        const h = harness();
        const [result] = await h.writer.put('HmIP-RF', ['ABC1:1'], 'MASTER', {
            NONSENSE: 1,
            ADDRESS: 5,
            TRANSMIT_TRY_MAX: 99,
        });
        expect(result?.ok).toBe(false);
        expect(result?.skipped).toBe(true);
        expect(h.writes).toEqual([]);
        expect(result?.problems.map((problem) => problem.parameter).sort()).toEqual([
            'ADDRESS',
            'NONSENSE',
            'TRANSMIT_TRY_MAX',
        ]);
    });

    it('dryRun returns the payload without calling anything', async () => {
        const h = harness({current: {'ABC1:1': {LOGGING: false}}});
        const [result] = await h.writer.put('HmIP-RF', ['ABC1:1'], 'MASTER', {LOGGING: true}, {dryRun: true});
        expect(result).toMatchObject({ok: true, skipped: true, sent: {LOGGING: true}});
        expect(h.writes).toEqual([]);
    });

    it('writes the eligible channels and refuses the ones with another description (#98)', async () => {
        const h = harness();
        const results = await h.writer.put(
            'HmIP-RF',
            ['ABC1:1', 'DEF1:1', 'GHI1:1', 'NOPE:1', 'ORPHAN:1'],
            'MASTER',
            {LOGGING: true},
            {writeAll: false},
        );
        expect(results.map((result) => [result.address, result.ok])).toEqual([
            ['ABC1:1', true],
            ['DEF1:1', true],
            ['GHI1:1', false],
            ['NOPE:1', false],
            ['ORPHAN:1', false],
        ]);
        expect(h.writes.map((write) => write.params[0])).toEqual(['ABC1:1', 'DEF1:1']);
        expect(results[2]?.problems[0]?.message).toContain('different paramset description');
        expect(results[2]?.problems[0]?.message).toContain('1.6.0');
        expect(results[3]?.problems[0]?.message).toContain('not in the device list');
        expect(results[4]?.problems[0]?.message).toContain('device of this channel is unknown');
    });

    it('refuses every extra channel when the source itself has no identity', async () => {
        const h = harness();
        const results = await h.writer.put('HmIP-RF', ['ORPHAN:1', 'ABC1:1'], 'MASTER', {LOGGING: true});
        expect(results[1]?.ok).toBe(false);
        expect(results[1]?.problems[0]?.message).toContain('no paramset identity');
    });

    it('reports progress per target', async () => {
        const h = harness();
        await h.writer.put('HmIP-RF', ['ABC1:1', 'DEF1:1'], 'MASTER', {LOGGING: true});
        expect(h.progress.map((entry) => [entry.done, entry.total])).toEqual([
            [1, 2],
            [2, 2],
        ]);
        expect(h.progress[1]?.last?.address).toBe('DEF1:1');
    });

    it('keeps a fault of the interface with its code', async () => {
        const h = harness({
            onWrite: () =>
                Promise.reject(
                    new BackendError({
                        message: 'HmIP-RF: Value out of range (-7)',
                        kind: 'rpc',
                        faultCode: -7,
                        faultString: 'Value out of range',
                    }),
                ),
        });
        const [result] = await h.writer.put('HmIP-RF', ['ABC1:1'], 'MASTER', {LOGGING: true});
        expect(result?.ok).toBe(false);
        expect(result?.faultCode).toBe(-7);
        expect(result?.faultString).toBe('Value out of range');
        expect(result?.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('stops the bulk when the queue was cancelled', async () => {
        const h = harness({
            onWrite: () => Promise.reject(new BackendError({message: 'the write was cancelled', kind: 'connection'})),
        });
        const results = await h.writer.put('HmIP-RF', ['ABC1:1', 'DEF1:1'], 'MASTER', {LOGGING: true});
        expect(results).toHaveLength(1);
        expect(results[0]?.ok).toBe(false);
    });

    it('reports a description that cannot be fetched', async () => {
        const h = harness({
            onDescribe: () => Promise.reject(new BackendError({message: 'no answer', kind: 'rpc', faultCode: -2})),
        });
        const [result] = await h.writer.put('HmIP-RF', ['ABC1:1'], 'MASTER', {LOGGING: true});
        expect(result?.ok).toBe(false);
        expect(result?.faultCode).toBe(-2);
        expect(result?.problems[0]?.message).toBe('no answer');
    });

    it('reports a getParamset that fails', async () => {
        const h = harness({onRead: () => Promise.reject(new BackendError({message: 'Unknown instance', kind: 'rpc'}))});
        const [result] = await h.writer.put('HmIP-RF', ['ABC1:1'], 'MASTER', {LOGGING: true});
        expect(result?.ok).toBe(false);
        expect(result?.problems[0]?.message).toContain('reading the current values failed');
    });

    it('treats a getParamset answer that is not a struct as empty', async () => {
        const h = harness({onRead: () => Promise.resolve('')});
        const [result] = await h.writer.put('HmIP-RF', ['ABC1:1'], 'MASTER', {LOGGING: true});
        expect(result?.sent).toEqual({LOGGING: true});
    });

    it('ignores non-scalar entries in a getParamset answer', async () => {
        const h = harness({onRead: () => Promise.resolve({LOGGING: true, WEIRD: [1, 2]})});
        const [result] = await h.writer.put('HmIP-RF', ['ABC1:1'], 'MASTER', {LOGGING: true});
        expect(result?.skipped).toBe(true);
    });
});

describe('ParamsetWriter.putLink', () => {
    it('writes both directions with the peer as the paramset key', async () => {
        const h = harness();
        const results = await h.writer.putLink('HmIP-RF', [{sender: 'ABC1:1', receiver: 'DEF1:1'}], {
            senderToReceiver: {SHORT_ON_TIME: 5},
            receiverToSender: {SHORT_ON_TIME: 7},
        });
        expect(h.writes).toEqual([
            {method: 'putParamset', params: ['ABC1:1', 'DEF1:1', {SHORT_ON_TIME: {explicitDouble: 5}}]},
            {method: 'putParamset', params: ['DEF1:1', 'ABC1:1', {SHORT_ON_TIME: {explicitDouble: 7}}]},
        ]);
        expect(results.map((result) => [result.address, result.peer, result.paramset])).toEqual([
            ['ABC1:1', 'DEF1:1', 'LINK'],
            ['DEF1:1', 'ABC1:1', 'LINK'],
        ]);
    });

    it('writes one direction when only one is given', async () => {
        const h = harness();
        await h.writer.putLink('HmIP-RF', [{sender: 'A:1', receiver: 'B:1'}], {receiverToSender: {SHORT_ON_TIME: 2}});
        expect(h.writes.map((write) => write.params[0])).toEqual(['B:1']);
    });

    it('sends UI_HINT even when it did not change (task 6, item 5a)', async () => {
        const h = harness({current: {'B:1': {SHORT_ON_TIME: 1, UI_HINT: 3}}});
        const [result] = await h.writer.putLink('HmIP-RF', [{sender: 'A:1', receiver: 'B:1'}], {
            receiverToSender: {SHORT_ON_TIME: 2, UI_HINT: 3},
        });
        expect(result?.sent).toEqual({SHORT_ON_TIME: {explicitDouble: 2}, UI_HINT: 3});
        expect(ALWAYS_SENT_LINK_PARAMETERS).toContain('UI_HINT');
    });

    it('does not invent a UI_HINT the caller did not send', async () => {
        const h = harness({current: {'B:1': {SHORT_ON_TIME: 1, UI_HINT: 3}}});
        const [result] = await h.writer.putLink('HmIP-RF', [{sender: 'A:1', receiver: 'B:1'}], {
            receiverToSender: {SHORT_ON_TIME: 2},
        });
        expect(result?.sent).toEqual({SHORT_ON_TIME: {explicitDouble: 2}});
    });

    it('drops a UI_HINT that the description does not have or that is invalid', async () => {
        const h = harness({
            descriptions: {LINK: {SHORT_ON_TIME: {TYPE: 'FLOAT', OPERATIONS: 7, MIN: 0, MAX: 100, DEFAULT: 1}}},
        });
        const [withoutDescription] = await h.writer.putLink('HmIP-RF', [{sender: 'A:1', receiver: 'B:1'}], {
            receiverToSender: {SHORT_ON_TIME: 2, UI_HINT: 3},
        });
        expect(withoutDescription?.sent).toEqual({SHORT_ON_TIME: {explicitDouble: 2}});

        const outOfRange = harness({current: {'B:1': {UI_HINT: 3, SHORT_ON_TIME: 1}}});
        const [result] = await outOfRange.writer.putLink('HmIP-RF', [{sender: 'A:1', receiver: 'B:1'}], {
            receiverToSender: {SHORT_ON_TIME: 2, UI_HINT: 999},
        });
        expect(result?.ok).toBe(false);
    });

    it('walks every link and reports progress over both directions', async () => {
        const h = harness();
        await h.writer.putLink(
            'HmIP-RF',
            [
                {sender: 'A:1', receiver: 'B:1'},
                {sender: 'C:1', receiver: 'D:1'},
            ],
            {senderToReceiver: {SHORT_ON_TIME: 2}, receiverToSender: {SHORT_ON_TIME: 2}},
        );
        expect(h.progress.map((entry) => entry.done)).toEqual([1, 2, 3, 4]);
        expect(h.progress[0]?.total).toBe(4);
    });

    it('refuses a call without links or without values', async () => {
        const h = harness();
        await expect(h.writer.putLink('HmIP-RF', [], {senderToReceiver: {}})).rejects.toThrow('no link to write to');
        await expect(h.writer.putLink('HmIP-RF', [{sender: 'A:1', receiver: 'B:1'}], {})).rejects.toThrow(
            'no link paramset values',
        );
    });

    it('stops at a cancelled write', async () => {
        const h = harness({
            onWrite: () => Promise.reject(new BackendError({message: 'the write was cancelled', kind: 'connection'})),
        });
        const results = await h.writer.putLink(
            'HmIP-RF',
            [
                {sender: 'A:1', receiver: 'B:1'},
                {sender: 'C:1', receiver: 'D:1'},
            ],
            {senderToReceiver: {SHORT_ON_TIME: 2}, receiverToSender: {SHORT_ON_TIME: 2}},
        );
        expect(results).toHaveLength(1);
    });
});

describe('ParamsetWriter.setValue', () => {
    it('casts against the VALUES description and sends', async () => {
        const h = harness();
        await h.writer.setValue('HmIP-RF', 'ABC1:1', 'LEVEL', '0.5');
        expect(h.writes).toEqual([{method: 'setValue', params: ['ABC1:1', 'LEVEL', {explicitDouble: 0.5}]}]);
    });

    it('refuses a parameter the description does not have', async () => {
        await expect(harness().writer.setValue('HmIP-RF', 'ABC1:1', 'NOPE', 1)).rejects.toThrow(
            'has no parameter NOPE',
        );
    });

    it('refuses a read-only parameter', async () => {
        await expect(harness().writer.setValue('HmIP-RF', 'ABC1:1', 'RSSI_DEVICE', -60)).rejects.toThrow(
            'is not writable',
        );
    });

    it('refuses a value outside the range', async () => {
        const h = harness();
        await expect(h.writer.setValue('HmIP-RF', 'ABC1:1', 'LEVEL', 5)).rejects.toThrow(/LEVEL/);
        expect(h.writes).toEqual([]);
    });

    it('never puts NaN on the wire: an unparseable number becomes 0', async () => {
        const h = harness();
        await h.writer.setValue('HmIP-RF', 'ABC1:1', 'LEVEL', 'not a number');
        expect(h.writes).toEqual([{method: 'setValue', params: ['ABC1:1', 'LEVEL', {explicitDouble: 0}]}]);
    });

    it('passes a fault of the interface on', async () => {
        const h = harness({onWrite: () => Promise.reject(new BackendError({message: 'nope', kind: 'rpc'}))});
        await expect(h.writer.setValue('HmIP-RF', 'ABC1:1', 'STATE', true)).rejects.toThrow('nope');
    });
});

describe('the enum encoding of the interface (A-1)', () => {
    const description: ParamsetDescription = {
        MODE: {TYPE: 'ENUM', OPERATIONS: 7, VALUE_LIST: ['OFF', 'ON', 'AUTO'], MIN: 0, MAX: 2, DEFAULT: 0},
    };

    it('sends the name to HmIP and the index to BidCos', async () => {
        const hmip = harness({descriptions: {MASTER: description}});
        await hmip.writer.put('HmIP-RF', ['ABC1:1'], 'MASTER', {MODE: 'AUTO'}, {writeAll: true});
        expect(hmip.writes[0]?.params[2]).toEqual({MODE: 'AUTO'});

        const bidcos = harness({descriptions: {MASTER: description}});
        await bidcos.writer.put('BidCos-RF', ['ABC1:1'], 'MASTER', {MODE: 'AUTO'}, {writeAll: true});
        expect(bidcos.writes[0]?.params[2]).toEqual({MODE: 2});
    });

    it('applies the same rule to setValue', async () => {
        const h = harness({descriptions: {VALUES: description}});
        const spy = vi.spyOn(h.writer, 'setValue');
        await h.writer.setValue('BidCos-RF', 'ABC1:1', 'MODE', 'ON');
        expect(h.writes[0]?.params[2]).toBe(1);
        spy.mockRestore();
    });
});
