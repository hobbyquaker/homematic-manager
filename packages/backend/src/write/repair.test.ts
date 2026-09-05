import {describe, expect, it} from 'vitest';

import {DeviceIndex, type DeviceDescription, type ParamsetDescription, type RpcValue} from '@homematic-manager/core';

import {BackendError} from '../errors.js';
import type {RpcOutValue} from '../rpc/client.js';
import {ConfigRepair, fallbackValue, supportsBidcosMaintenance, type ConfigRepairDeps} from './repair.js';

const DEVICE_MASTER: ParamsetDescription = {
    BUTTON_LOCK: {TYPE: 'BOOL', OPERATIONS: 3, DEFAULT: false},
};

const CHANNEL_MASTER: ParamsetDescription = {
    POWERUP_ONDELAY_VALUE: {TYPE: 'INTEGER', OPERATIONS: 3, MIN: 0, MAX: 31, DEFAULT: 0},
    LOGIC_COMBINATION: {
        TYPE: 'ENUM',
        OPERATIONS: 3,
        DEFAULT: 'LOGIC_OR',
        VALUE_LIST: ['LOGIC_INACTIVE', 'LOGIC_OR', 'LOGIC_AND'],
    },
    ON_TIME: {TYPE: 'FLOAT', OPERATIONS: 3, MIN: 0, MAX: 100, DEFAULT: 0},
    SERIAL: {TYPE: 'STRING', OPERATIONS: 5, DEFAULT: ''},
};

const MAINTENANCE_VALUES: ParamsetDescription = {
    CONFIG_PENDING: {TYPE: 'BOOL', OPERATIONS: 5, DEFAULT: false},
};

const devices: DeviceDescription[] = [
    {ADDRESS: 'ABC1', TYPE: 'HmIPW-DRS8', FIRMWARE: '1.2.4', VERSION: 1, PARAMSETS: ['MASTER']},
    {ADDRESS: 'ABC1:0', TYPE: 'MAINTENANCE', PARENT: 'ABC1', VERSION: 1, PARAMSETS: ['MASTER', 'VALUES']},
    {ADDRESS: 'ABC1:1', TYPE: 'SWITCH_TRANSMITTER', PARENT: 'ABC1', VERSION: 1, PARAMSETS: ['VALUES']},
    {ADDRESS: 'ABC1:2', TYPE: 'SWITCH_VIRTUAL_RECEIVER', PARENT: 'ABC1', VERSION: 1, PARAMSETS: ['MASTER', 'VALUES']},
];

interface Harness {
    repair: ConfigRepair;
    writes: {method: string; params: readonly RpcOutValue[]}[];
    reads: {method: string; params: readonly RpcOutValue[]}[];
    progress: {done: number; total: number}[];
}

function harness(
    options: {
        stored?: Record<string, Record<string, RpcValue>>;
        onWrite?: (method: string, params: readonly RpcOutValue[]) => Promise<RpcValue>;
        onDescribe?: (address: string, paramset: string) => Promise<ParamsetDescription>;
    } = {},
): Harness {
    const writes: Harness['writes'] = [];
    const reads: Harness['reads'] = [];
    const progress: Harness['progress'] = [];
    const deps: ConfigRepairDeps = {
        index: (interfaceName) => new DeviceIndex(interfaceName, devices),
        describe: (_interfaceName, address, paramset) => {
            if (options.onDescribe) {
                return options.onDescribe(address, paramset);
            }
            if (paramset === 'VALUES') {
                return Promise.resolve(MAINTENANCE_VALUES);
            }
            return Promise.resolve(address === 'ABC1' ? DEVICE_MASTER : CHANNEL_MASTER);
        },
        read: (_interfaceName, method, params) => {
            reads.push({method, params});
            const key = `${params[0] as string}/${params[1] as string}`;
            return Promise.resolve((options.stored?.[key] ?? {}) as RpcValue);
        },
        write: (_interfaceName, method, params) => {
            writes.push({method, params});
            return options.onWrite ? options.onWrite(method, params) : Promise.resolve('');
        },
        onProgress: (entry) => progress.push({done: entry.done, total: entry.total}),
    };
    return {repair: new ConfigRepair(deps), writes, reads, progress};
}

describe('supportsBidcosMaintenance', () => {
    it('is false for HmIP, where the methods answer -1 Generic error', () => {
        expect(supportsBidcosMaintenance('HmIP-RF')).toBe(false);
        expect(supportsBidcosMaintenance('BidCos-RF')).toBe(true);
        expect(supportsBidcosMaintenance('BidCos-Wired')).toBe(true);
    });
});

describe('fallbackValue', () => {
    it('prefers the DEFAULT', () => {
        expect(fallbackValue({TYPE: 'INTEGER', OPERATIONS: 3, MIN: 1, MAX: 10, DEFAULT: 6})).toBe(6);
        expect(fallbackValue({TYPE: 'ENUM', OPERATIONS: 3, DEFAULT: 'B', VALUE_LIST: ['A', 'B']})).toBe(1);
    });

    it('falls back to MIN when the DEFAULT is outside the range', () => {
        expect(fallbackValue({TYPE: 'INTEGER', OPERATIONS: 3, MIN: 5, MAX: 10, DEFAULT: 99})).toBe(5);
    });

    it('has an answer for every type', () => {
        expect(fallbackValue({TYPE: 'BOOL', OPERATIONS: 3})).toBe(false);
        expect(fallbackValue({TYPE: 'STRING', OPERATIONS: 3})).toBe('');
        expect(fallbackValue({TYPE: 'ENUM', OPERATIONS: 3, VALUE_LIST: ['A', 'B']})).toBe(0);
        expect(fallbackValue({TYPE: 'FLOAT', OPERATIONS: 3, MIN: 0, MAX: 1})).toEqual({explicitDouble: 0});
    });
});

describe('ConfigRepair', () => {
    it('refuses a device the index does not know', async () => {
        await expect(harness().repair.repair('HmIP-RF', 'NOPE')).rejects.toThrow('not in the device list');
    });

    it('writes a valid full MASTER paramset per channel', async () => {
        const h = harness({
            stored: {
                'ABC1/MASTER': {BUTTON_LOCK: false},
                'ABC1:0/VALUES': {CONFIG_PENDING: true},
                'ABC1:0/MASTER': {POWERUP_ONDELAY_VALUE: 0, LOGIC_COMBINATION: 1, ON_TIME: 0},
                'ABC1:2/MASTER': {POWERUP_ONDELAY_VALUE: 3, LOGIC_COMBINATION: 1, ON_TIME: 5, SERIAL: 'x'},
            },
        });
        const result = await h.repair.repair('HmIP-RF', 'ABC1:2');

        // the whole device is repaired, not only the channel the dialog was opened on
        expect(result.address).toBe('ABC1');
        expect(result.channels.map((entry) => entry.address)).toEqual(['ABC1', 'ABC1:0', 'ABC1:2']);
        expect(result.unrepairable).toEqual([]);
        const channel = result.channels.find((entry) => entry.address === 'ABC1:2');
        // SERIAL is read-only and is not sent; FLOAT goes out as an explicit double
        expect(channel?.write.sent).toEqual({
            POWERUP_ONDELAY_VALUE: 3,
            LOGIC_COMBINATION: 1,
            ON_TIME: {explicitDouble: 5},
        });
        expect(channel?.corrected).toEqual([]);
        expect(h.writes.map((entry) => entry.params[0])).toEqual(['ABC1', 'ABC1:0', 'ABC1:2']);
        expect(h.progress.at(-1)).toEqual({done: 3, total: 3});
    });

    it('replaces a stored value that is not valid for its parameter', async () => {
        const h = harness({
            stored: {
                'ABC1:2/MASTER': {
                    // exactly what hmipserver keeps after a rejected write, measured in the lab
                    POWERUP_ONDELAY_VALUE: 'not-a-number',
                    LOGIC_COMBINATION: 99,
                    ON_TIME: 5,
                },
            },
        });
        const result = await h.repair.repair('HmIP-RF', 'ABC1:2', {channels: ['ABC1:2']});
        const channel = result.channels[0];
        expect(channel?.corrected.map((entry) => [entry.parameter, entry.stored, entry.replacement])).toEqual([
            ['POWERUP_ONDELAY_VALUE', 'not-a-number', 0],
            ['LOGIC_COMBINATION', 99, 1],
        ]);
        expect(channel?.write.sent).toEqual({
            POWERUP_ONDELAY_VALUE: 0,
            LOGIC_COMBINATION: 1,
            ON_TIME: {explicitDouble: 5},
        });
        expect(channel?.write.ok).toBe(true);
    });

    it('reports a channel with an unknown parameter as unrepairable and still writes what it can', async () => {
        const h = harness({
            stored: {
                'ABC1:2/MASTER': {POWERUP_ONDELAY_VALUE: 0, LOGIC_COMBINATION: 1, ON_TIME: 0, HMM_LAB_NO_SUCH_PARAM: 1},
            },
            onWrite: (method) =>
                method === 'putParamset'
                    ? Promise.reject(
                          new BackendError({
                              message: 'Invalid parameter or value',
                              kind: 'rpc',
                              faultCode: -5,
                              faultString: 'Invalid parameter or value',
                          }),
                      )
                    : Promise.resolve(''),
        });
        const result = await h.repair.repair('HmIP-RF', 'ABC1:2', {channels: ['ABC1:2']});
        expect(result.unrepairable).toEqual(['ABC1:2']);
        expect(result.channels[0]?.unknown).toEqual(['HMM_LAB_NO_SUCH_PARAM']);
        // the unknown parameter is never written back - it cannot be, and writing it would only
        // repeat the mistake that created it
        expect(Object.keys(result.channels[0]?.write.sent ?? {})).not.toContain('HMM_LAB_NO_SUCH_PARAM');
        expect(result.channels[0]?.write.ok).toBe(false);
        expect(result.channels[0]?.write.faultCode).toBe(-5);
    });

    it('reports CONFIG_PENDING before and after', async () => {
        const pending: Record<string, Record<string, RpcValue>> = {'ABC1:0/VALUES': {CONFIG_PENDING: true}};
        const h = harness({
            stored: pending,
            onWrite: (method, params) => {
                if (method === 'putParamset' && params[0] === 'ABC1:2') {
                    pending['ABC1:0/VALUES'] = {CONFIG_PENDING: false};
                }
                return Promise.resolve('');
            },
        });
        const result = await h.repair.repair('HmIP-RF', 'ABC1');
        expect(result.configPendingBefore).toBe(true);
        expect(result.configPendingAfter).toBe(false);
    });

    it('writes nothing on a dry run', async () => {
        const h = harness({stored: {'ABC1:2/MASTER': {POWERUP_ONDELAY_VALUE: 99, LOGIC_COMBINATION: 1, ON_TIME: 0}}});
        const result = await h.repair.repair('HmIP-RF', 'ABC1:2', {channels: ['ABC1:2'], dryRun: true});
        expect(h.writes).toEqual([]);
        expect(result.channels[0]?.write.skipped).toBe(true);
        expect(result.channels[0]?.write.sent).toMatchObject({POWERUP_ONDELAY_VALUE: 0});
        expect(result.channels[0]?.corrected).toHaveLength(1);
    });

    it('calls a BidCos recovery only on a BidCos interface', async () => {
        const bidcos = harness({stored: {'ABC1:2/MASTER': {POWERUP_ONDELAY_VALUE: 0}}});
        const result = await bidcos.repair.repair('BidCos-RF', 'ABC1:2', {
            channels: ['ABC1:2'],
            bidcosRecovery: 'clearConfigCache',
        });
        expect(result.bidcosRecovery).toBe('clearConfigCache');
        expect(bidcos.writes.map((entry) => entry.method)).toContain('clearConfigCache');

        const hmip = harness({stored: {'ABC1:2/MASTER': {POWERUP_ONDELAY_VALUE: 0}}});
        const hmipResult = await hmip.repair.repair('HmIP-RF', 'ABC1:2', {
            channels: ['ABC1:2'],
            bidcosRecovery: 'restoreConfigToDevice',
        });
        expect(hmipResult.bidcosRecovery).toBeUndefined();
        expect(hmip.writes.map((entry) => entry.method)).not.toContain('restoreConfigToDevice');
    });

    it('reports a channel whose description cannot be fetched instead of failing the repair', async () => {
        const h = harness({
            onDescribe: (address, paramset) => {
                if (address === 'ABC1:2' && paramset === 'MASTER') {
                    return Promise.reject(new BackendError({message: 'Invalid device', kind: 'rpc', faultCode: -2}));
                }
                return Promise.resolve(address === 'ABC1' ? DEVICE_MASTER : MAINTENANCE_VALUES);
            },
        });
        const result = await h.repair.repair('HmIP-RF', 'ABC1');
        const failed = result.channels.find((entry) => entry.address === 'ABC1:2');
        expect(failed?.write.ok).toBe(false);
        expect(failed?.write.problems[0]?.message).toContain('Invalid device');
        expect(result.channels).toHaveLength(3);
    });

    it('skips a channel whose MASTER has nothing writeable', async () => {
        const h = harness({onDescribe: () => Promise.resolve({})});
        const result = await h.repair.repair('HmIP-RF', 'ABC1', {channels: ['ABC1:2']});
        expect(h.writes).toEqual([]);
        expect(result.channels[0]?.write).toMatchObject({ok: true, skipped: true, sent: {}});
    });
});
