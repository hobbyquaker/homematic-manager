/**
 * Task 97: the HmIP routers, against the real backend and hm-simulator.
 *
 * Its own device set, so the shared fixture's counts stay what the other specs expect: an HmIP-BSM
 * whose router module is on, an HmIP-PSM-2 that could route but does not, and an HmIP-WRC2 that
 * has only `ENABLE_ROUTING` (it may use a router, it is none). The Radio tab's Routers view lists
 * the two capable ones; the switch asks, then writes exactly `ROUTER_MODULE_ENABLED` to channel 0's
 * MASTER (the simulator's write log); the device table marks the device that routes and nothing
 * else.
 */

import {startForTest, type TestHost} from 'homematic-manager';

import {expect, simulatorReady, test} from './fixtures.js';

const BSM = '000A1B2C3D4E01';
const PSM = '0001D709A1B201';
const WRC2 = '0001D8A9B7C601';

const BOOL = {TYPE: 'BOOL', OPERATIONS: 3, FLAGS: 1, DEFAULT: false, MIN: false, MAX: true};

function device(serial: string, type: string, firmware: string, rxMode: number, channel: string): unknown[] {
    return [
        {
            ADDRESS: serial,
            TYPE: type,
            VERSION: 1,
            FIRMWARE: firmware,
            CHILDREN: [`${serial}:0`, `${serial}:1`],
            PARAMSETS: ['MASTER'],
            RX_MODE: rxMode,
        },
        {
            ADDRESS: `${serial}:0`,
            TYPE: 'MAINTENANCE',
            VERSION: 1,
            PARENT: serial,
            PARENT_TYPE: type,
            PARAMSETS: ['MASTER', 'VALUES'],
            INDEX: 0,
        },
        {
            ADDRESS: `${serial}:1`,
            TYPE: channel,
            VERSION: 1,
            PARENT: serial,
            PARENT_TYPE: type,
            PARAMSETS: ['MASTER', 'VALUES'],
            INDEX: 1,
        },
    ];
}

const MAINTENANCE_VALUES = {
    UNREACH: {...BOOL, OPERATIONS: 5, FLAGS: 9},
    RSSI_DEVICE: {TYPE: 'INTEGER', OPERATIONS: 5, FLAGS: 1, DEFAULT: -60, MIN: -128, MAX: 0},
};

const ROUTER_FIXTURE: Record<string, unknown> = {
    devices: {
        rfd: {devices: []},
        hmip: {
            devices: [
                ...device(BSM, 'HmIP-BSM', '2.10.4', 1, 'SWITCH_VIRTUAL_RECEIVER'),
                ...device(PSM, 'HmIP-PSM-2', '1.0.22', 1, 'SWITCH_VIRTUAL_RECEIVER'),
                ...device(WRC2, 'HmIP-WRC2', '1.2.6', 8, 'KEY_TRANSCEIVER'),
            ],
        },
    },
    config: {listenAddress: '127.0.0.1', binrpcListenPort: 0, xmlrpcListenPort: 0},
    paramsetDescriptions: {
        'HmIP-RF/HmIP-BSM/2.10.4/1//MASTER': {},
        // the BSM routes: the simulator starts every value at its default
        'HmIP-RF/HmIP-BSM/2.10.4/1/MAINTENANCE/MASTER': {
            ROUTER_MODULE_ENABLED: {...BOOL, DEFAULT: true},
            ENABLE_ROUTING: {...BOOL, DEFAULT: true},
        },
        'HmIP-RF/HmIP-BSM/2.10.4/1/MAINTENANCE/VALUES': MAINTENANCE_VALUES,
        'HmIP-RF/HmIP-BSM/2.10.4/1/SWITCH_VIRTUAL_RECEIVER/MASTER': {},
        'HmIP-RF/HmIP-BSM/2.10.4/1/SWITCH_VIRTUAL_RECEIVER/VALUES': {STATE: {...BOOL, OPERATIONS: 7}},
        'HmIP-RF/HmIP-PSM-2/1.0.22/1//MASTER': {},
        'HmIP-RF/HmIP-PSM-2/1.0.22/1/MAINTENANCE/MASTER': {
            ROUTER_MODULE_ENABLED: BOOL,
            ENABLE_ROUTING: {...BOOL, DEFAULT: true},
        },
        'HmIP-RF/HmIP-PSM-2/1.0.22/1/MAINTENANCE/VALUES': MAINTENANCE_VALUES,
        'HmIP-RF/HmIP-PSM-2/1.0.22/1/SWITCH_VIRTUAL_RECEIVER/MASTER': {},
        'HmIP-RF/HmIP-PSM-2/1.0.22/1/SWITCH_VIRTUAL_RECEIVER/VALUES': {STATE: {...BOOL, OPERATIONS: 7}},
        'HmIP-RF/HmIP-WRC2/1.2.6/1//MASTER': {},
        // a battery remote: it may talk through a router, it routes for nobody
        'HmIP-RF/HmIP-WRC2/1.2.6/1/MAINTENANCE/MASTER': {ENABLE_ROUTING: {...BOOL, DEFAULT: true}},
        'HmIP-RF/HmIP-WRC2/1.2.6/1/MAINTENANCE/VALUES': MAINTENANCE_VALUES,
        'HmIP-RF/HmIP-WRC2/1.2.6/1/KEY_TRANSCEIVER/MASTER': {},
        'HmIP-RF/HmIP-WRC2/1.2.6/1/KEY_TRANSCEIVER/VALUES': {PRESS_SHORT: {TYPE: 'ACTION', OPERATIONS: 6, FLAGS: 1}},
    },
    rega: {
        port: 0,
        listenAddress: '127.0.0.1',
        channels: [
            {id: 6000, address: BSM, name: 'Schaltaktor Terrasse'},
            {id: 6010, address: PSM, name: 'Steckdose Wohnzimmer'},
            {id: 6020, address: WRC2, name: 'Wandtaster Diele'},
        ],
    },
    interfaces: {hmip: {configPendingMode: 'hmip'}},
};

let host: TestHost;

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
});

test.beforeEach(async () => {
    host = await startForTest({
        simulator: true,
        simulatorOptions: structuredClone(ROUTER_FIXTURE),
        connection: {rega: true, language: 'en'},
    });
});

test.afterEach(async () => {
    await host.close();
});

test('the device table marks the device that routes, and only that one', async ({page}, testInfo) => {
    await page.goto(`${host.url}#/HmIP-RF/devices`);
    const marker = page.getByTestId(`router-${BSM}`);
    await expect(marker).toBeVisible();
    await expect(marker).toHaveAttribute('title', 'Routes for other HmIP devices');
    await expect(page.locator(`[data-row-id="${BSM}"]`)).toContainText('HmIP-BSM');
    await expect(page.locator(`[data-row-id="${PSM}"]`)).toBeVisible();
    await expect(page.getByTestId(`router-${PSM}`)).toHaveCount(0);
    await expect(page.getByTestId(`router-${WRC2}`)).toHaveCount(0);
    await page.getByTestId('devices-table').screenshot({path: testInfo.outputPath('router-marker-light.png')});
    await page.emulateMedia({colorScheme: 'dark'});
    await page.getByTestId('devices-table').screenshot({path: testInfo.outputPath('router-marker-dark.png')});
});

test('the Routers view lists the capable devices and switches one after asking', async ({page}, testInfo) => {
    await page.goto(`${host.url}#/HmIP-RF/rssi`);
    await page.getByTestId('radio-view-routers').click();
    const table = page.getByTestId('routers-table');
    await expect(table.locator(`[data-row-id="${BSM}"]`)).toContainText('Schaltaktor Terrasse');
    await expect(table.locator(`[data-row-id="${PSM}"]`)).toContainText('Steckdose Wohnzimmer');
    await expect(table.locator(`[data-row-id="${BSM}"]`)).toContainText(BSM);
    await expect(table.locator(`[data-row-id="${BSM}"]`)).toContainText('HmIP-BSM');
    await expect(table.locator(`[data-row-id="${WRC2}"]`)).toHaveCount(0);
    await expect(table).toContainText('1 of 2 route');
    await expect(page.getByTestId(`routing-switch-${BSM}`)).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId(`routing-switch-${PSM}`)).toHaveAttribute('aria-checked', 'false');
    // the simulator offers no ROUTING_TABLE for these: nothing to open
    await expect(page.getByTestId(`routing-table-${BSM}`)).toBeDisabled();
    await page.screenshot({path: testInfo.outputPath('routers-light.png')});

    // cancel writes nothing
    const before = (host.simulator.getWriteLog() as unknown[]).length;
    await page.getByTestId(`routing-switch-${PSM}`).click();
    const dialog = page.getByTestId('routing-switch-dialog');
    await expect(dialog).toContainText('Switch routing on?');
    await expect(dialog).toContainText(`Steckdose Wohnzimmer (${PSM})`);
    await page.getByTestId('routing-switch-cancel').click();
    await expect(dialog).toBeHidden();
    expect(host.simulator.getWriteLog()).toHaveLength(before);

    // confirmed: one MASTER write of exactly the switch, on channel 0
    await page.getByTestId(`routing-switch-${PSM}`).click();
    await page.getByTestId('routing-switch-confirm').click();
    await expect(page.getByTestId(`routing-switch-${PSM}`)).toHaveAttribute('aria-checked', 'true');
    await expect(table).toContainText('2 of 2 route');
    const writes = (host.simulator.getWriteLog() as {address: string; paramset: string; values: unknown}[]).slice(
        before,
    );
    expect(writes.map((write) => [write.address, write.paramset, write.values])).toEqual([
        [`${PSM}:0`, 'MASTER', {ROUTER_MODULE_ENABLED: true}],
    ]);

    // the device table now marks it too
    await page.goto(`${host.url}#/HmIP-RF/devices`);
    await expect(page.getByTestId(`router-${PSM}`)).toBeVisible();

    // dark mode and a phone's width: the view still fits and nothing overflows the page
    await page.emulateMedia({colorScheme: 'dark'});
    await page.setViewportSize({width: 390, height: 800});
    await page.goto(`${host.url}#/HmIP-RF/rssi`);
    await page.getByTestId('radio-view-routers').click();
    await expect(page.getByTestId(`routing-switch-${BSM}`)).toBeVisible();
    await page.screenshot({path: testInfo.outputPath('routers-dark-phone.png')});
});
