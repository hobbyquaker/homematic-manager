/**
 * `startForTest()`: the whole stack on a free port with a temporary profile directory, for the
 * Playwright suites of task 14 and for anything else that wants a real browser against a real
 * backend without Electron.
 *
 * ```ts
 * const host = await startForTest({simulator: true});
 * await page.goto(host.url);          // the cookie is set by the page load, the socket connects
 * await host.close();                 // backend, simulator and the temporary directory
 * ```
 *
 * `simulator: true` starts an in-process [hm-simulator](https://github.com/hobbyquaker/hm-simulator)
 * and points the backend at it. It is a devDependency since 1.0.0, but it is still imported lazily
 * and `simulatorAvailable()` still says whether it is there - the same `describe.skipIf`
 * arrangement `packages/backend/test/simulator` uses, so a tree without dev dependencies stays
 * green while `SIMULATOR_REQUIRED=1` (which CI sets) makes the skip a failure. Every port is `0`,
 * so several of these can run in parallel and none of them cares what is already listening on the
 * machine.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type {ConnectionConfig} from '@homematic-manager/core';

import {createWebHost, type WebHost, type WebHostOptions} from './server.js';

/* eslint-disable @typescript-eslint/no-explicit-any -- hm-simulator ships no types */

export const SIMULATOR_SKIP_MESSAGE =
    'hm-simulator is not installed - it is a devDependency since 1.0.0, so run `npm ci`';

let simulatorModule: any;
let simulatorLoaded = false;

/** Loads hm-simulator once; `undefined` when the package is not installed. */
export async function loadSimulator(): Promise<any> {
    if (!simulatorLoaded) {
        simulatorLoaded = true;
        // not a literal: hm-simulator is not a dependency, so TypeScript must not try to resolve it
        const specifier = 'hm-simulator/sim.mjs';
        try {
            simulatorModule = (await import(specifier)).default;
        } catch {
            simulatorModule = undefined;
        }
    }
    return simulatorModule;
}

/** Is hm-simulator installed? Suites gate themselves on this. */
export async function simulatorAvailable(): Promise<boolean> {
    return (await loadSimulator()) !== undefined;
}

/**
 * `SIMULATOR_REQUIRED=1` turns the skip into a failure.
 *
 * Skipping keeps a checkout without hm-simulator green, and that is the point - but it also means a
 * whole e2e suite can vanish from a green run. Anywhere the package is expected to be there, this
 * variable says so, and a missing simulator becomes an error. `packages/backend/test/simulator`
 * reads the same variable.
 */
export function simulatorRequired(): boolean {
    return process.env['SIMULATOR_REQUIRED'] === '1';
}

/**
 * The decision itself, as a pure function, so both of its branches are testable on a machine that
 * happens to have hm-simulator installed as well as on one that does not.
 */
export function simulatorGate(available: boolean, required: boolean): boolean {
    if (!available && required) {
        throw new Error(`SIMULATOR_REQUIRED=1, but ${SIMULATOR_SKIP_MESSAGE}`);
    }
    return available;
}

/**
 * `simulatorAvailable()`, but it throws instead of returning false when `SIMULATOR_REQUIRED=1`.
 * Suites call this rather than `simulatorAvailable()` when they mean to skip.
 */
export async function requireSimulator(): Promise<boolean> {
    return simulatorGate(await simulatorAvailable(), simulatorRequired());
}

/**
 * Two devices, enough for every tab of the UI: a BidCos switch actor (sender and receiver) and an
 * HmIP push-button. Deliberately small - the exhaustive fixtures live with the backend's own
 * integration tests, this one only has to make the grids non-empty for an e2e run.
 */
export const SIMULATOR_DEVICES = {
    rfd: {
        devices: [
            {
                ADDRESS: 'LEQ0000001',
                TYPE: 'HM-LC-Sw1-Pl',
                VERSION: 1,
                FIRMWARE: '2.8',
                CHILDREN: ['LEQ0000001:0', 'LEQ0000001:1'],
                PARAMSETS: ['MASTER'],
                RF_ADDRESS: 1,
            },
            {
                ADDRESS: 'LEQ0000001:0',
                TYPE: 'MAINTENANCE',
                VERSION: 1,
                PARENT: 'LEQ0000001',
                PARENT_TYPE: 'HM-LC-Sw1-Pl',
                PARAMSETS: ['MASTER', 'VALUES'],
                INDEX: 0,
            },
            {
                ADDRESS: 'LEQ0000001:1',
                TYPE: 'SWITCH',
                VERSION: 1,
                PARENT: 'LEQ0000001',
                PARENT_TYPE: 'HM-LC-Sw1-Pl',
                PARAMSETS: ['MASTER', 'VALUES', 'LINK'],
                LINK_TARGET_ROLES: 'SWITCH',
                DIRECTION: 2,
                INDEX: 1,
            },
        ],
    },
    hmip: {
        devices: [
            {
                ADDRESS: '0002D3C99ABCDE',
                TYPE: 'HmIP-WRC2',
                VERSION: 1,
                FIRMWARE: '1.4.8',
                CHILDREN: ['0002D3C99ABCDE:0', '0002D3C99ABCDE:1'],
                PARAMSETS: ['MASTER'],
            },
            {
                ADDRESS: '0002D3C99ABCDE:0',
                TYPE: 'MAINTENANCE',
                VERSION: 1,
                PARENT: '0002D3C99ABCDE',
                PARENT_TYPE: 'HmIP-WRC2',
                PARAMSETS: ['MASTER', 'VALUES'],
                INDEX: 0,
            },
            {
                ADDRESS: '0002D3C99ABCDE:1',
                TYPE: 'KEY_TRANSCEIVER',
                VERSION: 1,
                PARENT: '0002D3C99ABCDE',
                PARENT_TYPE: 'HmIP-WRC2',
                PARAMSETS: ['MASTER', 'VALUES', 'LINK'],
                LINK_SOURCE_ROLES: 'SWITCH',
                DIRECTION: 1,
                INDEX: 1,
            },
        ],
    },
};

export const SIMULATOR_PARAMSET_DESCRIPTIONS: Record<string, unknown> = {
    'BidCos-RF/HM-LC-Sw1-Pl/2.8/1/SWITCH/MASTER': {
        LOGGING: {TYPE: 'BOOL', OPERATIONS: 7, FLAGS: 1, DEFAULT: false, MIN: false, MAX: true},
        TRANSMIT_TRY_MAX: {TYPE: 'INTEGER', OPERATIONS: 7, FLAGS: 1, DEFAULT: 6, MIN: 1, MAX: 10},
    },
    'BidCos-RF/HM-LC-Sw1-Pl/2.8/1/SWITCH/VALUES': {
        STATE: {TYPE: 'BOOL', OPERATIONS: 7, FLAGS: 1, DEFAULT: false, MIN: false, MAX: true},
    },
    'HmIP-RF/HmIP-WRC2/1.4.8/1/KEY_TRANSCEIVER/MASTER': {
        LOGGING: {TYPE: 'BOOL', OPERATIONS: 7, FLAGS: 1, DEFAULT: false, MIN: false, MAX: true},
    },
    'HmIP-RF/HmIP-WRC2/1.4.8/1/KEY_TRANSCEIVER/VALUES': {
        PRESS_SHORT: {TYPE: 'ACTION', OPERATIONS: 6, FLAGS: 1, DEFAULT: false, MIN: false, MAX: true},
    },
};

export interface StartForTestOptions extends Omit<WebHostOptions, 'port' | 'dataDir'> {
    /** Start an hm-simulator and connect the backend to it. Ignored when it is not installed. */
    readonly simulator?: boolean;
    /**
     * Merged over the simulator options above, so a suite can bring its own fixture: `devices`,
     * `paramsetDescriptions`, `links`, `serviceMessages`, `rega`, `interfaces`. The two devices
     * here are the smallest thing that makes every grid non-empty; the e2e suite in
     * `apps/web/test/e2e` replaces them with a set that can be linked, renamed and refused.
     */
    readonly simulatorOptions?: Readonly<Record<string, unknown>>;
    /** Merged over the `ConnectionConfig` the host is configured with once the simulator is up. */
    readonly connection?: Partial<ConnectionConfig>;
    /** Overrides the temporary profile directory. */
    readonly dataDir?: string;
    readonly port?: number;
}

export interface TestHost extends WebHost {
    /** The temporary profile directory; removed by `close()` unless it was passed in. */
    readonly dataDir: string;
    /** The hm-simulator, when one was started. */
    readonly simulator: any;
}

/** Starts the web host on a free port with a throw-away profile directory. */
export async function startForTest(options: StartForTestOptions = {}): Promise<TestHost> {
    const {
        simulator: wantsSimulator,
        simulatorOptions,
        connection: connectionOverrides,
        dataDir: givenDataDir,
        ...hostOptions
    } = options;
    const dataDir = givenDataDir ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-web-')));

    let simulator: any;
    if (wantsSimulator === true) {
        // `requireSimulator`, not `loadSimulator`: asking for a simulator and silently getting a
        // host without one is the failure mode SIMULATOR_REQUIRED exists to make loud.
        await requireSimulator();
        const HmSim = await loadSimulator();
        if (HmSim) {
            simulator = new HmSim({
                devices: SIMULATOR_DEVICES,
                paramsetDescriptions: SIMULATOR_PARAMSET_DESCRIPTIONS,
                config: {listenAddress: '127.0.0.1', binrpcListenPort: 0, xmlrpcListenPort: 0},
                behaviorPath: path.join(os.tmpdir(), 'hmm-web-no-behaviors'),
                rega: {port: 0, listenAddress: '127.0.0.1', channels: []},
                interfaces: {hmip: {configPendingMode: 'strict'}, rfd: {configPendingMode: 'strict'}},
                ...simulatorOptions,
            });
            await simulator.whenReady();
        }
    }

    const ports: Record<string, number> = simulator
        ? {'BidCos-RF': simulator.ports.rfd as number, 'HmIP-RF': simulator.ports.hmip as number}
        : {};

    const host = await createWebHost({
        port: 0,
        host: '127.0.0.1',
        dataDir,
        ...hostOptions,
        backendOptions: {
            importLegacy: false,
            watchdogIntervalMs: 0,
            serviceMessagePollMs: 0,
            cacheWriteDelayMs: 0,
            rpcTimeoutMs: 5000,
            localAddresses: () => ['127.0.0.1'],
            callbackHost: '127.0.0.1',
            regaOptions: {port: (simulator?.regaSim?.port as number | undefined) ?? 1, timeoutMs: 1000},
            interfaceManagerOptions: {portOverride: (name: string) => ports[name], watchdogIntervalMs: 0},
            ...hostOptions.backendOptions,
        },
    });

    if (simulator && host.backend) {
        const connection: ConnectionConfig = {
            host: '127.0.0.1',
            interfaces: ['BidCos-RF', 'HmIP-RF'],
            autoDetect: false,
            extraInterfaces: [],
            tls: false,
            // hm-simulator serves rfd over BIN-RPC only, which is what a real rfd offers on the
            // CCU's loopback and nowhere else (D-28) - so this is the addon's `local` mode, and
            // `portOverride` points it at the ports the simulator happened to get
            local: true,
            rega: false,
            callback: {ip: '127.0.0.1', xmlrpcPort: 0, binrpcPort: 0},
            // No language: D-36's default, "the browser decides". A test that wants a fixed one
            // passes it through `connectionOverrides` - the e2e fixture asks for English.
            writePaceMs: 0,
            rpcLogFolder: '',
            ...connectionOverrides,
        };
        await host.backend.request('config.set', connection);
    }

    return {
        ...host,
        dataDir,
        simulator,
        close: async (): Promise<void> => {
            await host.close();
            if (simulator) {
                await simulator.close();
            }
            if (givenDataDir === undefined) {
                await fs.rm(dataDir, {recursive: true, force: true});
            }
        },
    };
}
