/**
 * The shared setup of the integration tests: an hm-simulator in the same process, and a `Backend`
 * pointed at it over real sockets.
 *
 * hm-simulator is a devDependency of this package since its 1.0.0 release, so `npm ci` installs it.
 * The import below stays dynamic and the suites stay gated on `simulatorAvailable`, so a tree
 * without dev dependencies is green rather than broken; `SIMULATOR_REQUIRED=1`, which CI sets,
 * turns that skip into a failure so a whole suite cannot vanish from a green run.
 *
 * Every port is `0`: the operating system picks one, `sim.ports` says which, and the backend is
 * told about it through `portOverride`. That is also why the tests can run in parallel and why they
 * do not care that port 8181 is taken on the development machine.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type {ConnectionConfig} from '@homematic-manager/core';

import {Backend, type BackendOptions} from '../../src/index.js';

/* eslint-disable @typescript-eslint/no-explicit-any -- hm-simulator ships no types */

/** The simulator's constructor, or `undefined` when the package is not installed. */
let HmSim: any;
try {
    HmSim = (await import('hm-simulator/sim.mjs')).default;
} catch {
    HmSim = undefined;
}

/** False when hm-simulator is not installed; every suite skips itself with a message. */
export const simulatorAvailable = HmSim !== undefined;

export const SKIP_MESSAGE = 'hm-simulator is not installed - it is a devDependency since 1.0.0, so run `npm ci`';

/**
 * `SIMULATOR_REQUIRED=1` turns the skip into a failure.
 *
 * The skip is what keeps `npm test` green on a machine without hm-simulator, but it is also a way
 * to lose a whole integration suite without anybody noticing. Wherever the package *is* installed -
 * the maintainer's machine, and CI once hm-simulator 1.0 is published - setting this variable makes
 * a missing simulator an error instead of a warning. `apps/web/src/testSupport.ts` reads the same
 * variable; the two are deliberately not shared, because `packages/backend` must not depend on an
 * app.
 */
export const simulatorRequired = process.env.SIMULATOR_REQUIRED === '1';

if (!simulatorAvailable) {
    if (simulatorRequired) {
        throw new Error(`SIMULATOR_REQUIRED=1, but ${SKIP_MESSAGE}`);
    }
    // one line, once, so a green run does not quietly hide that the integration suites did not run
    console.warn(`[backend] skipping the simulator integration tests: ${SKIP_MESSAGE}`);
}

/** A device the fixtures do not have to provide: one BidCos switch actor with two channels. */
export const RFD_DEVICES = {
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
};

/** Two HmIP devices with a sender and a receiver channel, so a link can be written. */
export const HMIP_DEVICES = {
    devices: [
        {
            ADDRESS: '0001D3C99ABCDE',
            TYPE: 'HmIP-PDT',
            VERSION: 1,
            FIRMWARE: '1.4.8',
            CHILDREN: ['0001D3C99ABCDE:0', '0001D3C99ABCDE:3'],
            PARAMSETS: ['MASTER'],
        },
        {
            ADDRESS: '0001D3C99ABCDE:0',
            TYPE: 'MAINTENANCE',
            VERSION: 1,
            PARENT: '0001D3C99ABCDE',
            PARENT_TYPE: 'HmIP-PDT',
            PARAMSETS: ['MASTER', 'VALUES'],
            INDEX: 0,
        },
        {
            ADDRESS: '0001D3C99ABCDE:3',
            TYPE: 'SWITCH_VIRTUAL_RECEIVER',
            VERSION: 1,
            PARENT: '0001D3C99ABCDE',
            PARENT_TYPE: 'HmIP-PDT',
            PARAMSETS: ['MASTER', 'VALUES', 'LINK'],
            LINK_TARGET_ROLES: 'SWITCH',
            DIRECTION: 2,
            INDEX: 3,
        },
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
        // a second HmIP-PDT with another firmware: multi-apply has to refuse it (issue #98)
        {
            ADDRESS: '0003D3C99ABCDE',
            TYPE: 'HmIP-PDT',
            VERSION: 1,
            FIRMWARE: '1.6.0',
            CHILDREN: ['0003D3C99ABCDE:0', '0003D3C99ABCDE:3'],
            PARAMSETS: ['MASTER'],
        },
        {
            ADDRESS: '0003D3C99ABCDE:0',
            TYPE: 'MAINTENANCE',
            VERSION: 1,
            PARENT: '0003D3C99ABCDE',
            PARENT_TYPE: 'HmIP-PDT',
            PARAMSETS: ['MASTER', 'VALUES'],
            INDEX: 0,
        },
        {
            ADDRESS: '0003D3C99ABCDE:3',
            TYPE: 'SWITCH_VIRTUAL_RECEIVER',
            VERSION: 1,
            PARENT: '0003D3C99ABCDE',
            PARENT_TYPE: 'HmIP-PDT',
            PARAMSETS: ['MASTER', 'VALUES', 'LINK'],
            LINK_TARGET_ROLES: 'SWITCH',
            DIRECTION: 2,
            INDEX: 3,
        },
    ],
};

/**
 * Paramset descriptions for the fixture devices, keyed the way the simulator wants them
 * (`<interface>/<deviceType>/<firmware>/<version>/<channelType>/<paramset>`).
 */
export const PARAMSET_DESCRIPTIONS: Record<string, unknown> = {
    'BidCos-RF/HM-LC-Sw1-Pl/2.8/1/SWITCH/MASTER': {
        LOGGING: {TYPE: 'BOOL', OPERATIONS: 7, FLAGS: 1, DEFAULT: false, MIN: false, MAX: true},
        TRANSMIT_TRY_MAX: {TYPE: 'INTEGER', OPERATIONS: 7, FLAGS: 1, DEFAULT: 6, MIN: 1, MAX: 10},
    },
    'BidCos-RF/HM-LC-Sw1-Pl/2.8/1/SWITCH/VALUES': {
        STATE: {TYPE: 'BOOL', OPERATIONS: 7, FLAGS: 1, DEFAULT: false, MIN: false, MAX: true},
    },
    'BidCos-RF/HM-LC-Sw1-Pl/2.8/1/MAINTENANCE/VALUES': {
        STICKY_UNREACH: {TYPE: 'BOOL', OPERATIONS: 7, FLAGS: 9, DEFAULT: false, MIN: false, MAX: true},
        UNREACH: {TYPE: 'BOOL', OPERATIONS: 5, FLAGS: 9, DEFAULT: false, MIN: false, MAX: true},
        LOWBAT: {TYPE: 'BOOL', OPERATIONS: 5, FLAGS: 9, DEFAULT: false, MIN: false, MAX: true},
    },
    'HmIP-RF/HmIP-PDT/1.4.8/1/SWITCH_VIRTUAL_RECEIVER/MASTER': {
        LOGGING: {TYPE: 'BOOL', OPERATIONS: 7, FLAGS: 1, DEFAULT: false, MIN: false, MAX: true},
        DIM_STEP: {TYPE: 'FLOAT', OPERATIONS: 7, FLAGS: 1, DEFAULT: 0.05, MIN: 0, MAX: 1},
        MODE: {
            TYPE: 'ENUM',
            OPERATIONS: 7,
            FLAGS: 1,
            DEFAULT: 0,
            MIN: 0,
            MAX: 2,
            VALUE_LIST: ['OFF', 'ON', 'AUTO'],
        },
    },
    'HmIP-RF/HmIP-PDT/1.6.0/1/SWITCH_VIRTUAL_RECEIVER/MASTER': {
        LOGGING: {TYPE: 'BOOL', OPERATIONS: 7, FLAGS: 1, DEFAULT: false, MIN: false, MAX: true},
    },
    'HmIP-RF/HmIP-PDT/1.4.8/1/SWITCH_VIRTUAL_RECEIVER/VALUES': {
        STATE: {TYPE: 'BOOL', OPERATIONS: 7, FLAGS: 1, DEFAULT: false, MIN: false, MAX: true},
    },
    'HmIP-RF/HmIP-PDT/1.4.8/1/SWITCH_VIRTUAL_RECEIVER/LINK': {
        SHORT_ON_TIME: {TYPE: 'FLOAT', OPERATIONS: 7, FLAGS: 1, DEFAULT: 1, MIN: 0, MAX: 100},
        UI_HINT: {TYPE: 'INTEGER', OPERATIONS: 7, FLAGS: 1, DEFAULT: 0, MIN: 0, MAX: 100},
    },
    'HmIP-RF/HmIP-PDT/1.4.8/1/MAINTENANCE/VALUES': {
        RSSI_DEVICE: {TYPE: 'INTEGER', OPERATIONS: 5, FLAGS: 1, DEFAULT: 0, MIN: -128, MAX: 127},
        RSSI_PEER: {TYPE: 'INTEGER', OPERATIONS: 5, FLAGS: 1, DEFAULT: 0, MIN: -128, MAX: 127},
        STICKY_UNREACH: {TYPE: 'BOOL', OPERATIONS: 7, FLAGS: 9, DEFAULT: false, MIN: false, MAX: true},
        CONFIG_PENDING: {TYPE: 'BOOL', OPERATIONS: 5, FLAGS: 9, DEFAULT: false, MIN: false, MAX: true},
    },
    'HmIP-RF/HmIP-WRC2/1.4.8/1/KEY_TRANSCEIVER/MASTER': {
        LOGGING: {TYPE: 'BOOL', OPERATIONS: 7, FLAGS: 1, DEFAULT: false, MIN: false, MAX: true},
    },
    'HmIP-RF/HmIP-WRC2/1.4.8/1/KEY_TRANSCEIVER/VALUES': {
        PRESS_SHORT: {TYPE: 'ACTION', OPERATIONS: 6, FLAGS: 1, DEFAULT: false, MIN: false, MAX: true},
    },
    'HmIP-RF/HmIP-WRC2/1.4.8/1/KEY_TRANSCEIVER/LINK': {
        SHORT_ON_TIME: {TYPE: 'FLOAT', OPERATIONS: 7, FLAGS: 1, DEFAULT: 1, MIN: 0, MAX: 100},
        UI_HINT: {TYPE: 'INTEGER', OPERATIONS: 7, FLAGS: 1, DEFAULT: 0, MIN: 0, MAX: 100},
    },
    'HmIP-RF/HmIP-WRC2/1.4.8/1/MAINTENANCE/VALUES': {
        RSSI_DEVICE: {TYPE: 'INTEGER', OPERATIONS: 5, FLAGS: 1, DEFAULT: 0, MIN: -128, MAX: 127},
        STICKY_UNREACH: {TYPE: 'BOOL', OPERATIONS: 7, FLAGS: 9, DEFAULT: false, MIN: false, MAX: true},
    },
};

export const REGA_CHANNELS = [
    {id: 1000, address: 'LEQ0000001', name: 'Steckdose'},
    {id: 1001, address: 'LEQ0000001:1', name: 'Steckdose:1'},
    {id: 2000, address: '0001D3C99ABCDE', name: 'Dimmer'},
];

export interface SimulatorOptions {
    readonly tls?: boolean;
    readonly auth?: {username: string; password: string};
    readonly rega?: boolean;
    /**
     * The CONFIG_PENDING behaviour of the `hmip` interface. Defaults to `hmip`, which is what
     * hmipserver 3.89.8 was measured to do in the lab (task 6, `docs/config-pending.md`);
     * `strict` and `pending` are the two hypotheses that measurement replaced and are still
     * worth testing against.
     */
    readonly configPendingMode?: 'strict' | 'pending' | 'hmip' | 'bidcos';
    /** The same for the `rfd` interface; defaults to `bidcos`, as rfd was measured. */
    readonly rfdConfigPendingMode?: 'strict' | 'pending' | 'hmip' | 'bidcos';
    readonly links?: Record<string, unknown[]>;
    readonly serviceMessages?: Record<string, unknown[]>;
}

/** Starts a simulator with the fixtures above. */
export async function startSimulator(options: SimulatorOptions = {}): Promise<any> {
    const sim = new HmSim({
        devices: {rfd: RFD_DEVICES, hmip: HMIP_DEVICES},
        paramsetDescriptions: PARAMSET_DESCRIPTIONS,
        config: {listenAddress: '127.0.0.1', binrpcListenPort: 0, xmlrpcListenPort: 0},
        behaviorPath: path.join(os.tmpdir(), 'hmm-no-behaviors'),
        ...(options.tls === true ? {tls: true} : {}),
        ...(options.auth ? {auth: options.auth} : {}),
        ...(options.rega === false ? {} : {rega: {port: 0, listenAddress: '127.0.0.1', channels: REGA_CHANNELS}}),
        ...(options.links ? {links: options.links} : {}),
        ...(options.serviceMessages ? {serviceMessages: options.serviceMessages} : {}),
        interfaces: {
            hmip: {configPendingMode: options.configPendingMode ?? 'hmip'},
            rfd: {configPendingMode: options.rfdConfigPendingMode ?? 'bidcos'},
        },
    });
    await sim.whenReady();
    return sim;
}

export interface BackendHarness {
    readonly backend: Backend;
    readonly dataDir: string;
    readonly notices: {level: string; message: string}[];
    close(): Promise<void>;
}

/** Opens a backend against a running simulator and connects it. */
export async function startBackend(
    sim: any,
    options: {
        connection?: Partial<ConnectionConfig>;
        backend?: Partial<BackendOptions>;
        dataDir?: string;
        connect?: boolean;
    } = {},
): Promise<BackendHarness> {
    const dataDir = options.dataDir ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'hmm-sim-')));
    const notices: {level: string; message: string}[] = [];
    const ports: Record<string, number> = {
        'BidCos-RF': sim.ports.rfd as number,
        'HmIP-RF': sim.ports.hmip as number,
    };
    const backend = await Backend.open({
        dataDir,
        importLegacy: false,
        watchdogIntervalMs: 0,
        serviceMessagePollMs: 0,
        hmipSweepDelayMs: 5,
        cacheWriteDelayMs: 0,
        rpcTimeoutMs: 5000,
        localAddresses: () => ['127.0.0.1'],
        callbackHost: '127.0.0.1',
        // without a ReGa mock the port must be one that refuses at once, not one that hangs
        regaOptions: {port: (sim.regaSim?.port as number | undefined) ?? 1, timeoutMs: 1000},
        interfaceManagerOptions: {
            portOverride: (name) => ports[name],
            watchdogIntervalMs: 0,
        },
        ...options.backend,
    });
    backend.on('notice', (notice) => notices.push({level: notice.level, message: notice.message}));

    const close = async (): Promise<void> => {
        await backend.stop();
        await fs.rm(dataDir, {recursive: true, force: true});
    };

    if (options.connect !== false) {
        await backend.request('config.set', {
            host: '127.0.0.1',
            interfaces: ['BidCos-RF', 'HmIP-RF'],
            autoDetect: false,
            // the simulator's rfd speaks BIN-RPC only, like the real rfd on the CCU's loopback: the
            // harness therefore runs in local mode (D-28), ports overridden above
            local: true,
            rega: true,
            callback: {ip: '127.0.0.1', xmlrpcPort: 0, binrpcPort: 0},
            writePaceMs: 0,
            ...options.connection,
        } as ConnectionConfig);
    }

    return {backend, dataDir, notices, close};
}

/** Waits until a predicate holds, or fails after `timeoutMs`. */
export async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!(await predicate())) {
        if (Date.now() > deadline) {
            throw new Error('condition was not met in time');
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}
