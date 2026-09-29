/**
 * Task 78: what hm-simulator 1.3.0 answers of the interface methods this application calls, against
 * the real backend over real sockets - where the suites used to fake a method on the simulator's
 * table, stand a client in, or leave the path untested (hm-simulator task 15, measured on rfd and
 * hmipserver of firmware 3.89.11).
 */

import {afterEach, describe, expect, it} from 'vitest';

import type {DeviceDescription} from '@homematic-manager/core';

import {simulatorAvailable, startBackend, startSimulator, type Simulator} from './helpers.js';

const running: {close: () => unknown}[] = [];

afterEach(async () => {
    for (const item of running.splice(0)) {
        await item.close();
    }
});

async function connected(
    options: Parameters<typeof startSimulator>[0] = {},
): Promise<{sim: Simulator; harness: Awaited<ReturnType<typeof startBackend>>}> {
    const sim = await startSimulator(options);
    running.push({close: () => sim.close()});
    const harness = await startBackend(sim);
    running.unshift({close: () => harness.close()});
    return {sim, harness};
}

/** A second switch of the fixture's type, under another serial. */
function switchDescriptions(serial: string): DeviceDescription[] {
    return [
        {
            ADDRESS: serial,
            TYPE: 'HM-LC-Sw1-Pl',
            VERSION: 1,
            FIRMWARE: '2.8',
            CHILDREN: [`${serial}:0`, `${serial}:1`],
            PARAMSETS: ['MASTER'],
            RF_ADDRESS: 99,
        },
        {
            ADDRESS: `${serial}:0`,
            TYPE: 'MAINTENANCE',
            VERSION: 1,
            PARENT: serial,
            PARENT_TYPE: 'HM-LC-Sw1-Pl',
            PARAMSETS: ['MASTER', 'VALUES'],
            INDEX: 0,
        },
        {
            ADDRESS: `${serial}:1`,
            TYPE: 'SWITCH',
            VERSION: 1,
            PARENT: serial,
            PARENT_TYPE: 'HM-LC-Sw1-Pl',
            PARAMSETS: ['MASTER', 'VALUES', 'LINK'],
            INDEX: 1,
        },
    ];
}

describe.skipIf(!simulatorAvailable)('the interface methods of hm-simulator 1.3.0 (task 78)', () => {
    it("reads a key mismatch the install mode heard, once, and pairs the device with the other system's key (task 76)", async () => {
        const {sim, harness} = await connected();
        const serial = 'LEQ0000076';
        sim.scriptKeyMismatch('rfd', serial, {key: 'other-system', devices: switchDescriptions(serial)});

        expect(await harness.backend.request('devices.installMode.keyMismatch', 'BidCos-RF')).toBe('');
        await harness.backend.request('devices.installMode.set', 'BidCos-RF', true, {seconds: 60, mode: 1});
        await expect.poll(() => sim.keyMismatch['rfd']).toBe(serial);
        expect(await harness.backend.request('devices.installMode.keyMismatch', 'BidCos-RF')).toBe(serial);
        // read with a reset: the interface process forgets it
        expect(await harness.backend.request('devices.installMode.keyMismatch', 'BidCos-RF')).toBe('');

        await harness.backend.request('devices.installMode.tempKey', 'BidCos-RF', 'other-system');
        await harness.backend.request('devices.installMode.set', 'BidCos-RF', true, {seconds: 60, mode: 1});
        await expect
            .poll(async () =>
                (await harness.backend.request('devices.list', 'BidCos-RF')).some(
                    (device) => device.ADDRESS === serial,
                ),
            )
            .toBe(true);
        await harness.backend.request('devices.installMode.tempKey', 'BidCos-RF', '');
        expect(sim.getTempKey('rfd')).toBe('');
    });

    it('offers the other devices of the same type for a replacement, and replaces (task 8)', async () => {
        const {sim, harness} = await connected();
        sim.addDevice('rfd', ...switchDescriptions('LEQ0000002'));
        await expect
            .poll(async () => (await harness.backend.request('devices.list', 'BidCos-RF')).length)
            .toBeGreaterThanOrEqual(6);

        const replaceable = await harness.backend.request('devices.replaceable', 'BidCos-RF', 'LEQ0000002');
        expect(replaceable.map((device) => device.ADDRESS)).toEqual(['LEQ0000001']);
        // (hm-simulator answers replaceDevice with '' where the specification says a boolean, so the
        // backend's answer is not asserted; what happened on the interface is)
        await harness.backend.request('devices.replace', 'BidCos-RF', 'LEQ0000001', 'LEQ0000002');
        expect(sim.getDevice('rfd', 'LEQ0000001')).toBe(false);
        // hmipserver answers the method with an empty body: no candidates, and no error
        expect(await harness.backend.request('devices.replaceable', 'HmIP-RF', '0001D3C99ABCDE')).toEqual([]);
    });

    it("reads a blind channel's channelMode metadata, and '' where it is not set (task 75)", async () => {
        const {sim, harness} = await connected({metadata: {hmip: {'0001D3C99ABCDE:3': {channelMode: 'shutter'}}}});
        expect(await harness.backend.request('channel.mode', 'HmIP-RF', '0001D3C99ABCDE:3')).toBe('shutter');
        // the WebUI switches it; the next dialog asks again
        await harness.backend.request('rpc.call', 'HmIP-RF', 'setMetadata', [
            '0001D3C99ABCDE:3',
            'channelMode',
            'blind',
        ]);
        expect(await harness.backend.request('channel.mode', 'HmIP-RF', '0001D3C99ABCDE:3')).toBe('blind');
        // hmipserver answers an unset key with an empty value, rfd with a fault: both are ''
        expect(await harness.backend.request('channel.mode', 'HmIP-RF', '0001D3C99ABCDE:0')).toBe('');
        expect(await harness.backend.request('channel.mode', 'BidCos-RF', 'LEQ0000001:1')).toBe('');
        expect(sim.metadata['hmip']?.['0001D3C99ABCDE:3']).toEqual({channelMode: 'blind'});
    });

    it('suppresses an HmIP service message: it leaves the list and stays suppressed (task 26, B-35)', async () => {
        const {sim, harness} = await connected();
        const channel = '0001D3C99ABCDE:0';
        sim.setServiceMessage('hmip', channel, 'STICKY_UNREACH', true);
        await harness.backend.pollServiceMessages();
        expect(
            (await harness.backend.request('serviceMessages.list', 'HmIP-RF')).map((message) => message.datapoint),
        ).toContain('STICKY_UNREACH');

        await harness.backend.request('rpc.call', 'HmIP-RF', 'suppressServiceMessages', [
            channel,
            'STICKY_UNREACH',
            true,
        ]);
        expect(await harness.backend.request('rpc.call', 'HmIP-RF', 'getSuppressedServiceMessages', [channel])).toEqual(
            ['STICKY_UNREACH'],
        );
        await harness.backend.pollServiceMessages();
        expect(
            (await harness.backend.request('serviceMessages.list', 'HmIP-RF')).map((message) => message.datapoint),
        ).not.toContain('STICKY_UNREACH');

        // BidCos has no such method: the console call faults instead of answering nothing
        await expect(
            harness.backend.request('rpc.call', 'BidCos-RF', 'getSuppressedServiceMessages', ['LEQ0000001:0']),
        ).rejects.toThrow();
    });

    it('answers getVersion as measured, and getLGWStatus only where a gateway status is configured', async () => {
        const {harness} = await connected({interfaces: {rfd: {lgwStatus: {CONNECTED: true}}}});
        expect(await harness.backend.request('rpc.call', 'BidCos-RF', 'getVersion', [])).toBe('2.6.0');
        expect(await harness.backend.request('rpc.call', 'HmIP-RF', 'getVersion', [])).toBe('3.89.11.20260919');
        expect(await harness.backend.request('rpc.call', 'BidCos-RF', 'getLGWStatus', [])).toEqual({CONNECTED: true});
        await expect(harness.backend.request('rpc.call', 'HmIP-RF', 'getLGWStatus', [])).rejects.toThrow();
    });

    /**
     * Task 73 seen from the interface process: every callback the simulator made to hmipserver's
     * listener - a pairing of fifty devices (a hundred descriptions), 500 events in multicall batches of 50 - was
     * answered, in time. (HmIP, because the XML-RPC client sends the batches side by side
     * as hmipserver does; hm-simulator's BIN-RPC client holds all but one in a queue it retries every
     * 50 ms, which would be measured instead of the answer.)
     */
    it('answers every callback of a burst in time (task 73)', async () => {
        const {sim} = await connected();
        const start = sim.getCallbackLog().length;
        const serials = Array.from({length: 50}, (_, index) => `0001D3C9900${String(index).padStart(3, '0')}`);
        sim.addDevice(
            'hmip',
            ...serials.flatMap((serial) => [
                {ADDRESS: serial, TYPE: 'HmIP-PS', VERSION: 1, FIRMWARE: '1.0.0', CHILDREN: [`${serial}:3`]},
                {ADDRESS: `${serial}:3`, TYPE: 'SWITCH_VIRTUAL_RECEIVER', VERSION: 1, PARENT: serial},
            ]),
        );
        sim.fireEvents(
            'hmip',
            Array.from(
                {length: 500},
                (_, index) => ['0001D3C99ABCDE:3', 'STATE', index % 2 === 0] as [string, string, boolean],
            ),
            {batch: 50},
        );
        await expect
            .poll(() => {
                const log = sim.getCallbackLog().slice(start);
                return log.length >= 11 && log.every((entry) => entry.answeredAt !== null);
            })
            .toBe(true);
        const log = sim.getCallbackLog().slice(start);
        expect(log.filter((entry) => entry.method === 'newDevices')).toHaveLength(1);
        expect(log.filter((entry) => entry.method === 'system.multicall')).toHaveLength(10);
        expect(log.every((entry) => entry.error === null)).toBe(true);
        const times = log.map((entry) => (entry.answeredAt ?? Infinity) - entry.sentAt);
        // the ten batches arrive side by side and are answered one after another, so the later ones
        // carry the earlier ones' time (and the full unit run's load): every one within 250 ms. The
        // per-answer bound of 50 ms is callbackTiming.test.ts's, which sends one call at a time.
        expect(Math.max(...times), `answer times in ms: ${times.join(' ')}`).toBeLessThan(250);
    });
});
