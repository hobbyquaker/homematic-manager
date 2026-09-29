/**
 * B-80 and B-81 on the maintainer's own link: a BidCos weather sensor (`WEATHER`) to a blind actuator (`BLIND`), profile
 * "up / down". The WebUI's form of that profile (`easymodes/BLIND/WEATHER.tcl`) draws the time in the state "up" as the
 * LENGTH_OF_STAY combo box and the up-delay as the DELAY one; the profile's own values (111600, 0) are where they start,
 * not a lock - hmm greyed both out. `SHORT_ON_TIME` is a BidCos time with a `NOT_USED` special (111600) above its
 * range, which the expert view showed as a disabled number beside a select reading `NOT_USED`, and whose way back to a
 * number was an unlabelled `—` that wrote `MIN` at once.
 */

import {startForTest, type TestHost} from 'homematic-manager';
import type {Page} from '@playwright/test';

import {BIDCOS_GATEWAY, expect, simulatorReady, test} from './fixtures.js';

const SENSOR = 'LEQ0000101';
const BLIND = 'LEQ0000102';
const SENDER = `${SENSOR}:1`;
const RECEIVER = `${BLIND}:1`;

function device(address: string, type: string, channelType: string, direction: number): unknown[] {
    return [
        {
            ADDRESS: address,
            TYPE: type,
            VERSION: 1,
            FIRMWARE: '1.0',
            CHILDREN: [`${address}:0`, `${address}:1`],
            PARAMSETS: ['MASTER'],
            RF_ADDRESS: 1,
            INTERFACE: BIDCOS_GATEWAY,
            ROAMING: 0,
        },
        {
            ADDRESS: `${address}:0`,
            TYPE: 'MAINTENANCE',
            VERSION: 1,
            PARENT: address,
            PARENT_TYPE: type,
            PARAMSETS: ['MASTER', 'VALUES'],
            INDEX: 0,
        },
        {
            ADDRESS: `${address}:1`,
            TYPE: channelType,
            VERSION: 1,
            PARENT: address,
            PARENT_TYPE: type,
            PARAMSETS: ['MASTER', 'VALUES', 'LINK'],
            INDEX: 1,
            DIRECTION: direction,
        },
    ];
}

/** A BidCos time as rfd describes it: seconds, a range, and 111600 as "not used" above it. */
const TIME = {TYPE: 'FLOAT', OPERATIONS: 7, FLAGS: 1, UNIT: 's', MIN: 0, MAX: 108000, DEFAULT: 111600};
const NOT_USED = [{ID: 'NOT_USED', VALUE: 111600}];

const FIXTURE: Record<string, unknown> = {
    devices: {
        rfd: {
            devices: [
                ...device(SENSOR, 'HM-WDS100-C6-O', 'WEATHER', 1),
                ...device(BLIND, 'HM-LC-Bl1PBU-FM', 'BLIND', 2),
            ],
        },
        hmip: {devices: []},
    },
    config: {listenAddress: '127.0.0.1', binrpcListenPort: 0, xmlrpcListenPort: 0},
    paramsetDescriptions: {
        'BidCos-RF/HM-WDS100-C6-O/1.0/1//MASTER': {},
        'BidCos-RF/HM-WDS100-C6-O/1.0/1/MAINTENANCE/VALUES': {},
        'BidCos-RF/HM-WDS100-C6-O/1.0/1/WEATHER/MASTER': {},
        'BidCos-RF/HM-WDS100-C6-O/1.0/1/WEATHER/VALUES': {},
        'BidCos-RF/HM-WDS100-C6-O/1.0/1/WEATHER/LINK': {
            STORM_UPPER_THRESHOLD: {TYPE: 'INTEGER', OPERATIONS: 7, FLAGS: 1, MIN: 0, MAX: 255, DEFAULT: 0},
            STORM_LOWER_THRESHOLD: {TYPE: 'INTEGER', OPERATIONS: 7, FLAGS: 1, MIN: 0, MAX: 255, DEFAULT: 0},
        },
        'BidCos-RF/HM-LC-Bl1PBU-FM/1.0/1//MASTER': {},
        'BidCos-RF/HM-LC-Bl1PBU-FM/1.0/1/MAINTENANCE/VALUES': {},
        'BidCos-RF/HM-LC-Bl1PBU-FM/1.0/1/BLIND/MASTER': {},
        'BidCos-RF/HM-LC-Bl1PBU-FM/1.0/1/BLIND/VALUES': {},
        'BidCos-RF/HM-LC-Bl1PBU-FM/1.0/1/BLIND/LINK': {
            UI_HINT: {TYPE: 'STRING', OPERATIONS: 7, FLAGS: 1, DEFAULT: ''},
            SHORT_ON_TIME: {...TIME, SPECIAL: NOT_USED},
            LONG_ON_TIME: {...TIME, SPECIAL: NOT_USED},
            SHORT_ONDELAY_TIME: {...TIME, MAX: 111600, DEFAULT: 0},
            // the profile sets it and its form does not draw it: absent from the easy view, editable in the expert one
            SHORT_JT_ONDELAY: {TYPE: 'INTEGER', OPERATIONS: 7, FLAGS: 1, MIN: 0, MAX: 9, DEFAULT: 2},
        },
    },
    rega: {
        port: 0,
        listenAddress: '127.0.0.1',
        channels: [
            {id: 6000, address: SENSOR, name: 'Wetterstation'},
            {id: 6001, address: SENDER, name: 'Wetterstation:1'},
            {id: 6010, address: BLIND, name: 'Markise'},
            {id: 6011, address: RECEIVER, name: 'Markise:1'},
        ],
    },
    interfaces: {rfd: {configPendingMode: 'bidcos'}},
};

let host: TestHost | undefined;

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
});

test.afterEach(async () => {
    await host?.close();
    host = undefined;
});

/** The stack in `language`, the link made as the WebUI makes it (profile 1 in `UI_HINT`), its editor open. */
async function openLink(page: Page, language: 'de' | 'en'): Promise<TestHost> {
    host = await startForTest({
        simulator: true,
        simulatorOptions: structuredClone(FIXTURE),
        connection: {rega: true, language},
    });
    const sim = host.simulator as {callMethod(iface: string, method: string, params?: unknown[]): unknown};
    sim.callMethod('rfd', 'addLink', [SENDER, RECEIVER, '', '']);
    sim.callMethod('rfd', 'putParamset', [RECEIVER, SENDER, {UI_HINT: '1'}]);
    await page.goto(`${host.url}#/BidCos-RF/links`);
    const row = page.locator(`[data-row-id="${SENDER}->${RECEIVER}"]`);
    await row.click();
    await page.getByTestId('links-edit').click();
    await expect(page.getByTestId('link-paramset-dialog')).toHaveAttribute('open', '');
    return host;
}

const selected = (page: Page, testId: string) =>
    page
        .getByTestId(testId)
        .evaluate((select: HTMLSelectElement) => select.selectedOptions[0]?.textContent?.trim() ?? '');

for (const [language, words] of [
    ['en', {unlimited: 'continuously', none: 'none', unused: 'Unused', enter: 'Enter value'}],
    ['de', {unlimited: 'unendlich', none: 'keine', unused: 'Nicht benutzt', enter: 'Wert eingeben'}],
] as const) {
    test(`the easy view offers the CCU's time presets, editable, with 111600 as "${words.unlimited}" (B-80, B-81, ${language})`, async ({
        page,
    }) => {
        await openLink(page, language);
        await expect(page.getByTestId('link-easy-form')).toBeVisible();

        const onTime = page.getByTestId('easy-preset-select-SHORT_ON_TIME');
        await expect(onTime).toBeEnabled();
        await expect.poll(() => selected(page, 'easy-preset-select-SHORT_ON_TIME')).toBe(words.unlimited);
        const delay = page.getByTestId('easy-preset-select-SHORT_ONDELAY_TIME');
        await expect(delay).toBeEnabled();
        await expect.poll(() => selected(page, 'easy-preset-select-SHORT_ONDELAY_TIME')).toBe(words.none);
        // what the profile sets and its form does not draw is not in the easy view at all
        await expect(page.getByTestId('param-SHORT_JT_ONDELAY')).toHaveCount(0);

        // "Enter value" in the combo box opens the number - prefilled, not the special's select alone
        await onTime.selectOption({label: words.enter});
        const free = page.getByTestId('param-SHORT_ON_TIME');
        await expect(free.getByRole('spinbutton')).toBeEnabled();
        await expect(free.getByRole('spinbutton')).toHaveValue('0');
    });

    test(`the expert view names a special, hides its number, and "${words.enter}" opens it without writing (B-80, B-81, ${language})`, async ({
        page,
    }) => {
        const stack = await openLink(page, language);
        await page.getByTestId('link-expert').check();
        const row = page.getByTestId('link-receiver-params').getByTestId('param-SHORT_ON_TIME');
        const special = row.locator('.hmm-param-special');
        await expect(special).toBeEnabled();
        await expect(special.locator('option:checked')).toHaveText(words.unused);
        await expect(special.locator('option').first()).toHaveText(words.enter);
        await expect(row.getByRole('spinbutton')).toHaveCount(0);
        await expect(row.locator('.hmm-param-range')).toHaveCount(0);
        await expect(row.locator('.hmm-param-default')).toContainText(words.unused);

        // every parameter raw and editable - the up-delay, and the one the profile sets without drawing it
        const delay = page.getByTestId('link-receiver-params').getByTestId('param-SHORT_ONDELAY_TIME');
        await expect(delay.getByRole('spinbutton')).toBeEnabled();
        await expect(
            page.getByTestId('link-receiver-params').getByTestId('param-SHORT_JT_ONDELAY').getByRole('spinbutton'),
        ).toBeEnabled();

        const writes = (): number => (stack.simulator as {getWriteLog(): unknown[]}).getWriteLog().length;
        const before = writes();
        await special.selectOption({label: words.enter});
        const number = row.getByRole('spinbutton');
        await expect(number).toBeEnabled();
        await expect(number).toBeFocused();
        // the default is the special itself, so the free field starts at MIN - and nothing is written for it
        await expect(number).toHaveValue('0');
        await expect(row.locator('.hmm-param-range')).toBeVisible();
        await expect(row).not.toHaveClass(/hmm-param-changed/);

        await number.fill('60');
        await page.getByTestId('link-preview').click();
        await expect(page.getByTestId('preview-SHORT_ON_TIME')).toBeVisible();
        await page.getByTestId('write-confirm').click();
        await expect(page.getByTestId('link-results')).toBeVisible();
        const log = (stack.simulator as {getWriteLog(): Array<{values: Record<string, unknown>}>}).getWriteLog();
        expect(log.length).toBeGreaterThan(before);
        expect(log.at(-1)?.values['SHORT_ON_TIME']).toBe(60);
    });
}
