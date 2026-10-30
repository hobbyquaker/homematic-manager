/**
 * Task 109: the sender side of a link has a form of its own where the CCU's WebUI has one - `ic_setprofiles.cgi`
 * sources `<sender paramid>.tcl`, the id being `getParamsetId(sender, LINK)`. Here a weather station HM-WDS100-C6-O-2
 * (`wds100_ch_link`): its storm thresholds as "Sturmschwelle" on a Beaufort scale, copied into the switch actuator's
 * `SHORT_COND_VALUE_LO` / `_HI` as the WebUI's form does. Its descriptions are the ones hm-simulator ships; the paramset
 * id is what hm-simulator 1.5's rfd answers from the device files.
 */

import {createRequire} from 'node:module';

import {startForTest, type TestHost} from 'homematic-manager';
import type {Page} from '@playwright/test';

import {BIDCOS_GATEWAY, expect, simulatorReady, test} from './fixtures.js';

const require = createRequire(import.meta.url);
const bundled = require('hm-simulator/data/paramset-descriptions.json') as Record<string, unknown>;

const STATION = 'LEQ0000211';
const SWITCH = 'LEQ0000212';
const SENDER = `${STATION}:1`;
const RECEIVER = `${SWITCH}:1`;
const WDS = 'BidCos-RF/HM-WDS100-C6-O-2/1.6/18';

function device(
    address: string,
    type: string,
    firmware: string,
    version: number,
    channelType: string,
    roles: Record<string, string | number>,
): unknown[] {
    return [
        {
            ADDRESS: address,
            TYPE: type,
            VERSION: version,
            FIRMWARE: firmware,
            CHILDREN: [`${address}:0`, `${address}:1`],
            PARAMSETS: ['MASTER'],
            RF_ADDRESS: 1,
            INTERFACE: BIDCOS_GATEWAY,
            ROAMING: 0,
        },
        {
            ADDRESS: `${address}:0`,
            TYPE: 'MAINTENANCE',
            VERSION: version,
            PARENT: address,
            PARENT_TYPE: type,
            PARAMSETS: ['MASTER', 'VALUES'],
            INDEX: 0,
        },
        {
            ADDRESS: `${address}:1`,
            TYPE: channelType,
            VERSION: version,
            PARENT: address,
            PARENT_TYPE: type,
            PARAMSETS: ['MASTER', 'VALUES', 'LINK'],
            INDEX: 1,
            ...roles,
        },
    ];
}

const CONDITION = {TYPE: 'INTEGER', OPERATIONS: 7, FLAGS: 1, MIN: 0, MAX: 255};

const FIXTURE: Record<string, unknown> = {
    devices: {
        rfd: {
            devices: [
                ...device(STATION, 'HM-WDS100-C6-O-2', '1.6', 18, 'WEATHER', {
                    DIRECTION: 1,
                    LINK_SOURCE_ROLES: 'CONDITIONAL_SWITCH',
                }),
                ...device(SWITCH, 'HM-LC-Sw1-FM', '1.0', 1, 'SWITCH', {
                    DIRECTION: 2,
                    LINK_TARGET_ROLES: 'SWITCH CONDITIONAL_SWITCH',
                }),
            ],
        },
    },
    config: {listenAddress: '127.0.0.1', binrpcListenPort: 0, xmlrpcListenPort: 0},
    paramsetDescriptions: {
        ...Object.fromEntries(Object.entries(bundled).filter(([key]) => key.startsWith(`${WDS}/`))),
        [`${WDS}/MAINTENANCE/MASTER`]: {},
        'BidCos-RF/HM-LC-Sw1-FM/1.0/1//MASTER': {},
        'BidCos-RF/HM-LC-Sw1-FM/1.0/1/MAINTENANCE/VALUES': {},
        'BidCos-RF/HM-LC-Sw1-FM/1.0/1/SWITCH/MASTER': {},
        'BidCos-RF/HM-LC-Sw1-FM/1.0/1/SWITCH/VALUES': {},
        'BidCos-RF/HM-LC-Sw1-FM/1.0/1/SWITCH/LINK': {
            SHORT_COND_VALUE_LO: {...CONDITION, DEFAULT: 50},
            SHORT_COND_VALUE_HI: {...CONDITION, DEFAULT: 100},
        },
    },
    links: {rfd: [{SENDER, RECEIVER, FLAGS: 0, NAME: '', DESCRIPTION: ''}]},
    // as the CCU left it: "Sturmschwelle", on at grade 6 (39), off at grade 4 (20 on this station)
    paramsets: {rfd: {[SENDER]: {[RECEIVER]: {STORM_UPPER_THRESHOLD: 39, STORM_LOWER_THRESHOLD: 20}}}},
    interfaces: {rfd: {configPendingMode: 'bidcos'}},
};

type Sim = {callMethod(iface: string, method: string, params?: unknown[]): unknown};

let host: TestHost | undefined;

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
    expect(bundled[`${WDS}/WEATHER/LINK`]).toBeDefined();
});

test.afterEach(async () => {
    await host?.close();
    host = undefined;
});

async function openLink(page: Page): Promise<Sim> {
    host = await startForTest({
        simulator: true,
        simulatorOptions: structuredClone(FIXTURE),
        connection: {rega: false, language: 'de'},
    });
    await page.goto(`${host.url}#/BidCos-RF/links`);
    await page.locator(`[data-row-id="${SENDER}->${RECEIVER}"]`).click();
    await page.getByTestId('links-edit').click();
    await expect(page.getByTestId('link-paramset-dialog')).toHaveAttribute('open', '');
    return host.simulator as Sim;
}

test("a weather station's storm thresholds are its own form, copied into the actuator (task 109)", async ({page}) => {
    const sim = await openLink(page);
    expect(sim.callMethod('rfd', 'getParamsetId', [SENDER, 'LINK'])).toBe('wds100_ch_link');

    await expect(page.getByTestId('link-sender-profile')).toHaveValue('1');
    await expect(page.getByTestId('link-sender-profile').locator('option:checked')).toHaveText('Sturmschwelle');
    const upper = page.getByTestId('link-sender-STORM_UPPER_THRESHOLD');
    const lower = page.getByTestId('link-sender-STORM_LOWER_THRESHOLD');
    await expect(upper.locator('option:checked')).toHaveText('Windstärke 6 - starker Wind');
    await expect(lower.locator('option:checked')).toHaveText('Windstärke 4 - mäßige Brise');
    await expect(page.getByTestId('link-sender-params')).toHaveCount(0);

    await lower.selectOption('29');
    await page.getByTestId('link-preview').click();
    await expect(page.getByTestId('write-preview')).toHaveAttribute('open', '');
    const calls = page.locator('[data-testid^="preview-call-"]');
    await expect(calls).toHaveCount(2);
    await expect(calls).toContainText([
        `putParamset(${RECEIVER}←${SENDER}, LINK, {"SHORT_COND_VALUE_LO":29})`,
        `putParamset(${SENDER}←${RECEIVER}, LINK, {"STORM_LOWER_THRESHOLD":29})`,
    ]);
    await page.getByTestId('write-confirm').click();
    await expect(page.getByTestId('link-results')).toContainText(SENDER);
    expect(sim.callMethod('rfd', 'getParamset', [SENDER, RECEIVER])).toMatchObject({
        STORM_UPPER_THRESHOLD: 39,
        STORM_LOWER_THRESHOLD: 29,
    });
    expect(sim.callMethod('rfd', 'getParamset', [RECEIVER, SENDER])).toMatchObject({SHORT_COND_VALUE_LO: 29});
});

test('the expert profile of the sender shows its parameters raw (task 109)', async ({page}) => {
    await openLink(page);
    await page.getByTestId('link-sender-profile').selectOption('0');
    await expect(page.getByTestId('link-sender-params').getByTestId('param-PEER_NEEDS_BURST')).toBeVisible();
    await expect(page.getByTestId('link-sender-form')).toHaveCount(0);
});
