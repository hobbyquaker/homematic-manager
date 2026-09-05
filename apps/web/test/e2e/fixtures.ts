/**
 * The world the web e2e suite runs in: an hm-simulator with devices that can be renamed, linked,
 * refused and repaired, and a Playwright fixture that starts the whole stack per test.
 *
 * Each test gets its own host, backend, simulator and profile directory on port 0, so the specs are
 * independent and the suite runs in parallel. That costs about a second per test and buys the one
 * thing an e2e is for: nothing is shared, so nothing leaks between workflows.
 *
 * The fixture set is the one `packages/backend/test/simulator/helpers.ts` uses, for the same
 * reasons - a BidCos switch actor, an HmIP dimmer (receiver) and an HmIP wall button (sender) so a
 * link has two ends, plus a second dimmer on another firmware so multi-apply has something to
 * refuse (issue #98). It lives here rather than in `apps/web/src` because it is test scaffolding
 * for one suite, and `apps/web` is a published package.
 */

import {requireSimulator, startForTest, type TestHost} from '@homematic-manager/web';
import {test as base, expect} from '@playwright/test';

export {expect};

export const BIDCOS_SWITCH = 'LEQ0000001';
export const HMIP_DIMMER = '0001D3C99ABCDE';
export const HMIP_BUTTON = '0002D3C99ABCDE';
/** A second HmIP-PDT on firmware 1.6.0: the target multi-apply has to refuse. */
export const HMIP_DIMMER_OTHER_FIRMWARE = '0003D3C99ABCDE';

const RFD_DEVICES = {
    devices: [
        {
            ADDRESS: BIDCOS_SWITCH,
            TYPE: 'HM-LC-Sw1-Pl',
            VERSION: 1,
            FIRMWARE: '2.8',
            CHILDREN: [`${BIDCOS_SWITCH}:0`, `${BIDCOS_SWITCH}:1`],
            PARAMSETS: ['MASTER'],
            RF_ADDRESS: 1,
        },
        {
            ADDRESS: `${BIDCOS_SWITCH}:0`,
            TYPE: 'MAINTENANCE',
            VERSION: 1,
            PARENT: BIDCOS_SWITCH,
            PARENT_TYPE: 'HM-LC-Sw1-Pl',
            PARAMSETS: ['MASTER', 'VALUES'],
            INDEX: 0,
        },
        {
            ADDRESS: `${BIDCOS_SWITCH}:1`,
            TYPE: 'SWITCH',
            VERSION: 1,
            PARENT: BIDCOS_SWITCH,
            PARENT_TYPE: 'HM-LC-Sw1-Pl',
            PARAMSETS: ['MASTER', 'VALUES', 'LINK'],
            LINK_TARGET_ROLES: 'SWITCH',
            DIRECTION: 2,
            INDEX: 1,
        },
    ],
};

const HMIP_DEVICES = {
    devices: [
        {
            ADDRESS: HMIP_DIMMER,
            TYPE: 'HmIP-PDT',
            VERSION: 1,
            FIRMWARE: '1.4.8',
            CHILDREN: [`${HMIP_DIMMER}:0`, `${HMIP_DIMMER}:3`],
            PARAMSETS: ['MASTER'],
        },
        {
            ADDRESS: `${HMIP_DIMMER}:0`,
            TYPE: 'MAINTENANCE',
            VERSION: 1,
            PARENT: HMIP_DIMMER,
            PARENT_TYPE: 'HmIP-PDT',
            PARAMSETS: ['MASTER', 'VALUES'],
            INDEX: 0,
        },
        {
            ADDRESS: `${HMIP_DIMMER}:3`,
            TYPE: 'SWITCH_VIRTUAL_RECEIVER',
            VERSION: 1,
            PARENT: HMIP_DIMMER,
            PARENT_TYPE: 'HmIP-PDT',
            PARAMSETS: ['MASTER', 'VALUES', 'LINK'],
            LINK_TARGET_ROLES: 'SWITCH',
            DIRECTION: 2,
            INDEX: 3,
        },
        {
            ADDRESS: HMIP_BUTTON,
            TYPE: 'HmIP-WRC2',
            VERSION: 1,
            FIRMWARE: '1.4.8',
            CHILDREN: [`${HMIP_BUTTON}:0`, `${HMIP_BUTTON}:1`],
            PARAMSETS: ['MASTER'],
        },
        {
            ADDRESS: `${HMIP_BUTTON}:0`,
            TYPE: 'MAINTENANCE',
            VERSION: 1,
            PARENT: HMIP_BUTTON,
            PARENT_TYPE: 'HmIP-WRC2',
            PARAMSETS: ['MASTER', 'VALUES'],
            INDEX: 0,
        },
        {
            ADDRESS: `${HMIP_BUTTON}:1`,
            TYPE: 'KEY_TRANSCEIVER',
            VERSION: 1,
            PARENT: HMIP_BUTTON,
            PARENT_TYPE: 'HmIP-WRC2',
            PARAMSETS: ['MASTER', 'VALUES', 'LINK'],
            LINK_SOURCE_ROLES: 'SWITCH',
            DIRECTION: 1,
            INDEX: 1,
        },
        {
            ADDRESS: HMIP_DIMMER_OTHER_FIRMWARE,
            TYPE: 'HmIP-PDT',
            VERSION: 1,
            FIRMWARE: '1.6.0',
            CHILDREN: [`${HMIP_DIMMER_OTHER_FIRMWARE}:0`, `${HMIP_DIMMER_OTHER_FIRMWARE}:3`],
            PARAMSETS: ['MASTER'],
        },
        {
            ADDRESS: `${HMIP_DIMMER_OTHER_FIRMWARE}:0`,
            TYPE: 'MAINTENANCE',
            VERSION: 1,
            PARENT: HMIP_DIMMER_OTHER_FIRMWARE,
            PARENT_TYPE: 'HmIP-PDT',
            PARAMSETS: ['MASTER', 'VALUES'],
            INDEX: 0,
        },
        {
            ADDRESS: `${HMIP_DIMMER_OTHER_FIRMWARE}:3`,
            TYPE: 'SWITCH_VIRTUAL_RECEIVER',
            VERSION: 1,
            PARENT: HMIP_DIMMER_OTHER_FIRMWARE,
            PARENT_TYPE: 'HmIP-PDT',
            PARAMSETS: ['MASTER', 'VALUES', 'LINK'],
            LINK_TARGET_ROLES: 'SWITCH',
            DIRECTION: 2,
            INDEX: 3,
        },
    ],
};

const PARAMSET_DESCRIPTIONS: Record<string, unknown> = {
    'BidCos-RF/HM-LC-Sw1-Pl/2.8/1/SWITCH/MASTER': {
        LOGGING: {TYPE: 'BOOL', OPERATIONS: 7, FLAGS: 1, DEFAULT: false, MIN: false, MAX: true},
        TRANSMIT_TRY_MAX: {TYPE: 'INTEGER', OPERATIONS: 7, FLAGS: 1, DEFAULT: 6, MIN: 1, MAX: 10},
    },
    'BidCos-RF/HM-LC-Sw1-Pl/2.8/1/SWITCH/VALUES': {
        STATE: {TYPE: 'BOOL', OPERATIONS: 7, FLAGS: 1, DEFAULT: false, MIN: false, MAX: true},
    },
    'BidCos-RF/HM-LC-Sw1-Pl/2.8/1/SWITCH/LINK': {
        SHORT_ON_TIME: {TYPE: 'FLOAT', OPERATIONS: 7, FLAGS: 1, DEFAULT: 1, MIN: 0, MAX: 100},
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
    // firmware 1.6.0 describes the same channel differently - that is what multi-apply refuses
    'HmIP-RF/HmIP-PDT/1.6.0/1/SWITCH_VIRTUAL_RECEIVER/MASTER': {
        LOGGING: {TYPE: 'BOOL', OPERATIONS: 7, FLAGS: 1, DEFAULT: false, MIN: false, MAX: true},
    },
    'HmIP-RF/HmIP-PDT/1.4.8/1/SWITCH_VIRTUAL_RECEIVER/VALUES': {
        STATE: {TYPE: 'BOOL', OPERATIONS: 7, FLAGS: 1, DEFAULT: false, MIN: false, MAX: true},
    },
    'HmIP-RF/HmIP-PDT/1.6.0/1/SWITCH_VIRTUAL_RECEIVER/VALUES': {
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
    'HmIP-RF/HmIP-PDT/1.6.0/1/MAINTENANCE/VALUES': {
        RSSI_DEVICE: {TYPE: 'INTEGER', OPERATIONS: 5, FLAGS: 1, DEFAULT: 0, MIN: -128, MAX: 127},
        STICKY_UNREACH: {TYPE: 'BOOL', OPERATIONS: 7, FLAGS: 9, DEFAULT: false, MIN: false, MAX: true},
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

/** The friendly names ReGa hands out (D-2); the grid shows these instead of the addresses. */
const REGA_CHANNELS = [
    {id: 1000, address: BIDCOS_SWITCH, name: 'Steckdose'},
    {id: 1001, address: `${BIDCOS_SWITCH}:1`, name: 'Steckdose:1'},
    {id: 2000, address: HMIP_DIMMER, name: 'Dimmer'},
    {id: 2003, address: `${HMIP_DIMMER}:3`, name: 'Dimmer:3'},
    {id: 3000, address: HMIP_BUTTON, name: 'Wandtaster'},
    {id: 3001, address: `${HMIP_BUTTON}:1`, name: 'Wandtaster:1'},
];

/**
 * The simulator options for one test.
 *
 * `configPendingMode` is left at the measured defaults (`hmip` / `bidcos`, task 6): a write in the
 * e2e should behave the way the lab measured hmipserver and rfd behaving, not the way the strict
 * hypothesis of hm-simulator 1.0 did.
 */
export const SIMULATOR_FIXTURE: Record<string, unknown> = {
    devices: {rfd: RFD_DEVICES, hmip: HMIP_DEVICES},
    paramsetDescriptions: PARAMSET_DESCRIPTIONS,
    rega: {port: 0, listenAddress: '127.0.0.1', channels: REGA_CHANNELS},
    interfaces: {hmip: {configPendingMode: 'hmip'}, rfd: {configPendingMode: 'bidcos'}},
};

/**
 * The part of hm-simulator's scenario API the specs use.
 *
 * The package ships no types, and `TestHost.simulator` is therefore `any`. Writing the handful of
 * methods down here is the one cast in the whole suite, and it doubles as the list of what a spec
 * is allowed to reach around the UI for: raise an event the device would have sent, script a
 * pairing, and read back what the interface process really stored.
 */
export interface Simulator {
    /** What a device reports: an `event` callback to every connected logic layer. */
    fireEvent(iface: string, address: string, datapoint: string, value: unknown): void;
    getValue(iface: string, address: string, datapoint: string): unknown;
    /** Every `putParamset` the simulator accepted, oldest first. */
    getWriteLog(): {iface: string; address: string; paramset: string; values: Record<string, unknown>}[];
    getLinks(iface: string, params: unknown[]): unknown[];
    /** Remaining seconds of the install mode, 0 when it is off. */
    getInstallMode(iface: string): number;
    /** Devices that appear the next time the install mode is switched on. */
    scriptNewDevices(iface: string, devices: unknown[], delay?: number): void;
    /** The ReGa mock; `renames` is every `dom.GetObject(id).Name(...)` script it was sent. */
    regaSim: {renames: {id: number; name: string; script: string}[]};
}

export interface E2eFixtures {
    /** The web host, backend and simulator of this test; closed when the test ends. */
    host: TestHost;
    /** The simulator behind that host. */
    sim: Simulator;
}

/**
 * `test` with a running stack. The suite skips itself, once and loudly, when hm-simulator is not
 * installed - and `SIMULATOR_REQUIRED=1` turns that skip into a failure.
 */
export const test = base.extend<E2eFixtures>({
    // Playwright reads the destructuring pattern of the first argument to work out what a fixture
    // depends on, and refuses any other form - so the empty pattern is required here, not sloppy.
    // eslint-disable-next-line no-empty-pattern
    host: async ({}, use) => {
        const host = await startForTest({
            simulator: true,
            simulatorOptions: SIMULATOR_FIXTURE,
            // English, so the assertions read as what a user sees rather than as translation keys;
            // `settings.spec.ts` is the one that exercises the language switch itself.
            connection: {rega: true, language: 'en'},
        });
        await use(host);
        await host.close();
    },
    sim: async ({host}, use) => {
        await use(host.simulator as Simulator);
    },
});

let announced = false;

/**
 * Is there a simulator to run against? Every spec asks this in a `test.beforeAll` and skips itself
 * when the answer is no - once, with one warning line, so that a green run cannot quietly hide that
 * the whole suite did not execute. `SIMULATOR_REQUIRED=1` makes it throw instead.
 */
export async function simulatorReady(): Promise<boolean> {
    const available = await requireSimulator();
    if (!available && !announced) {
        announced = true;
        const reason =
            'hm-simulator is not installed - run `npm install --no-save ../hm-simulator` from the ' +
            'repository root, or set SIMULATOR_REQUIRED=1 to make this a failure';
        console.warn(`[e2e] skipping the web end-to-end suite: ${reason}`);
        if (process.env['CI'] !== undefined) {
            // A skipped suite is invisible in a green log; an annotation is not.
            console.log(`::warning title=web e2e skipped::${reason}`);
        }
    }
    return available;
}
