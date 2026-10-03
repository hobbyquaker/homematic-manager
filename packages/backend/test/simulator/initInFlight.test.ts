/**
 * B-89: VirtualDevices alone, with an `init` that is slow to come back.
 *
 * On an openccu-lite system where the group process ran without HmIP-RF an `init` took about 10 s to
 * come back, and the calls were served one after the other; the app's quick retries and its watchdog
 * sent the next ones before the earlier ones were through, they queued up past the RPC timeout, and
 * the app subscribed again every 10 s. Here the simulator's VirtualDevices gets that shape: one
 * `init` at a time, each held for a while.
 */

import {afterEach, describe, expect, it} from 'vitest';

import {simulatorAvailable, startBackend, startSimulator, VIRTUAL_DEVICES, waitFor, type Simulator} from './helpers.js';

const running: {close: () => unknown}[] = [];

afterEach(async () => {
    for (const item of running.splice(0)) {
        await item.close();
    }
});

type Dispatch = (iface: string, method: string, params: unknown[], callback: (...args: unknown[]) => void) => void;

/**
 * Makes the simulator's VirtualDevices take its subscribing `init` calls one at a time, each held
 * for `holdMs`. Returns how many arrived and the longest queue (the one being served included).
 */
function serialSlowInit(sim: Simulator, holdMs: number): {received: () => number; longestQueue: () => number} {
    const target = sim as unknown as {dispatch: Dispatch};
    const inner = target.dispatch.bind(sim);
    let received = 0;
    let queued = 0;
    let longest = 0;
    let line = Promise.resolve();
    target.dispatch = (iface, method, params, callback) => {
        if (iface !== 'virtual' || method !== 'init' || params[1] === '' || params[1] === undefined) {
            inner(iface, method, params, callback);
            return;
        }
        received += 1;
        queued += 1;
        longest = Math.max(longest, queued);
        line = line.then(
            () =>
                new Promise<void>((resolve) => {
                    setTimeout(() => {
                        queued -= 1;
                        inner(iface, method, params, callback);
                        resolve();
                    }, holdMs);
                }),
        );
    };
    return {received: () => received, longestQueue: () => longest};
}

async function virtualOnly(
    holdMs: number,
    rpcTimeoutMs: number,
): Promise<{
    sim: Simulator;
    harness: Awaited<ReturnType<typeof startBackend>>;
    init: ReturnType<typeof serialSlowInit>;
}> {
    const sim = await startSimulator({virtualDevices: VIRTUAL_DEVICES});
    running.push({close: () => sim.close()});
    const init = serialSlowInit(sim, holdMs);
    const harness = await startBackend(sim, {
        connect: false,
        backend: {
            rpcTimeoutMs,
            // the watchdog every 100 ms instead of 15 s: it must not add an `init` of its own either
            interfaceManagerOptions: {
                portOverride: (name) => (name === 'VirtualDevices' ? (sim.ports.virtual as number) : undefined),
                watchdogIntervalMs: 100,
            },
        },
    });
    running.unshift({close: () => harness.close()});
    return {sim, harness, init};
}

const configure = (harness: Awaited<ReturnType<typeof startBackend>>) =>
    harness.backend.request('config.set', {
        host: '127.0.0.1',
        interfaces: ['VirtualDevices'],
        autoDetect: false,
        local: true,
        rega: false,
        callback: {ip: '127.0.0.1', xmlrpcPort: 0, binrpcPort: 0},
        extraInterfaces: [],
    } as never);

describe.skipIf(!simulatorAvailable)('VirtualDevices with a slow init (B-89)', () => {
    it('subscribes once and waits, while the init takes longer than the RPC timeout', async () => {
        const {harness, init} = await virtualOnly(1500, 1000);
        await configure(harness);
        // the first attempt timed out on our side and is still being served; the next one is due
        // 15 s later, not on the 3 s schedule of a missing process and not at a watchdog round
        await new Promise((resolve) => setTimeout(resolve, 5000));
        expect(init.received()).toBe(1);
        expect(init.longestQueue()).toBe(1);
        // the one that timed out on our side did subscribe: its device callbacks arrived
        expect(await harness.backend.request('devices.list', 'VirtualDevices')).not.toEqual([]);
        expect(harness.notices.filter((notice) => notice.level === 'error')).toEqual([]);
    }, 15_000);

    it('connects with one init that is slow but within the timeout, whatever asks to subscribe meanwhile', async () => {
        const {harness, init} = await virtualOnly(1500, 5000);
        const configured = configure(harness);
        await waitFor(() => init.received() === 1);
        // the user presses "reconnect" while the group process is still busy with the first one
        await harness.backend.request('interfaces.reconnect', 'VirtualDevices');
        await configured;
        await waitFor(async () => (await harness.backend.request('interfaces.list'))[0]?.connected === true);
        await waitFor(async () => (await harness.backend.request('devices.list', 'VirtualDevices')).length > 0);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        expect(init.received()).toBe(1);
        expect(init.longestQueue()).toBe(1);
    }, 15_000);
});
