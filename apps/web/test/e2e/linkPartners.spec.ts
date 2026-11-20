/**
 * Task 112: the create-link dialog offers the channels the CCU's WebUI offers. On hm-simulator's HmIP-Wired
 * devices: a wall switch key as the sender, and of the blind actuator's twelve virtual channels the first of
 * each output's three - all twelve with "Show all channels".
 */

import {createRequire} from 'node:module';

import {startForTest, type TestHost} from 'homematic-manager';
import type * as HmSim from 'hm-simulator';
import type {Locator, Page} from '@playwright/test';

import {SIMULATOR_FIXTURE, expect, simulatorReady, test} from './fixtures.js';

interface WiredFixture {
    devices: {hmip: {devices: HmSim.DeviceDescription[]}};
    paramsetDescriptions: Record<string, HmSim.ParamsetDescription>;
}

const require = createRequire(import.meta.url);
const wired = require('hm-simulator/data/fixtures/hmip-wired.json') as WiredFixture;

const deviceOf = (type: string): string =>
    wired.devices.hmip.devices.find((device) => device.TYPE === type && !device.PARENT)?.ADDRESS ?? '';
const DRBL4 = deviceOf('HmIPW-DRBL4');
const WRC6 = deviceOf('HmIPW-WRC6');

function fixture(): Record<string, unknown> {
    const base = structuredClone(SIMULATOR_FIXTURE) as Record<string, unknown> & {
        devices: Record<string, {devices: HmSim.DeviceDescription[]}>;
        paramsetDescriptions: Record<string, unknown>;
    };
    base.devices['hmip'] = {
        devices: [...(base.devices['hmip']?.devices ?? []), ...structuredClone(wired.devices.hmip.devices)],
    };
    base.paramsetDescriptions = {...base.paramsetDescriptions, ...wired.paramsetDescriptions};
    return base;
}

let host: TestHost | undefined;

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
    expect([DRBL4, WRC6]).not.toContain('');
});

test.afterEach(async () => {
    await host?.close();
    host = undefined;
});

/** A click outside a channel list closes it (the checkbox is one): open it again where it is closed. */
async function openList(picker: Locator): Promise<void> {
    const toggle = picker.getByRole('button').first();
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
        await toggle.click();
    }
}

/** The channel numbers of the blind actuator a list offers, by the `<index>: TYPE` line of its entries. */
async function blindChannels(picker: Locator): Promise<number[]> {
    await openList(picker);
    await picker.getByLabel('Filter').fill(DRBL4);
    const texts = await picker.getByRole('option').allTextContents();
    await picker.getByLabel('Filter').fill('');
    return texts.map((text) => Number(/(\d+): BLIND_VIRTUAL_RECEIVER/.exec(text)?.[1])).sort((a, b) => a - b);
}

async function openDialog(page: Page): Promise<{senders: Locator; receivers: Locator}> {
    host = await startForTest({
        simulator: true,
        simulatorOptions: fixture(),
        connection: {rega: false, language: 'en'},
    });
    await page.goto(`${host.url}#/HmIP-RF/links`);
    await page.getByTestId('links-add').click();
    await expect(page.getByTestId('add-link-dialog')).toHaveAttribute('open', '');
    const senders = page.getByTestId('add-link-senders');
    await senders.getByRole('button').first().click();
    await senders.getByLabel('Filter').fill(`${WRC6}:1`);
    await expect(senders.getByRole('option')).toHaveCount(1);
    await senders.getByRole('option').click();
    await senders.getByLabel('Filter').fill('');
    await senders.getByRole('button').first().click();
    const receivers = page.getByTestId('add-link-receivers');
    await receivers.getByRole('button').first().click();
    return {senders, receivers};
}

test('the receiver list offers the first virtual channel of each output, all three with "Show all channels"', async ({
    page,
}) => {
    const {receivers} = await openDialog(page);
    await expect(page.getByTestId('add-link-show-all')).not.toBeChecked();
    expect(await blindChannels(receivers)).toEqual([2, 6, 10, 14]);
    await expect(page.getByTestId('add-link-hidden-count')).toContainText('left out, as in the CCU');

    await page.getByTestId('add-link-show-all').check();
    expect(await blindChannels(receivers)).toEqual([2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15, 16]);

    // the browser keeps the choice
    await page.reload();
    await page.getByTestId('links-add').click();
    await expect(page.getByTestId('add-link-show-all')).toBeChecked();
});

test('a link to an expert channel is created once it is shown', async ({page}) => {
    const {receivers} = await openDialog(page);
    await page.getByTestId('add-link-show-all').check();
    await openList(receivers);
    await receivers.getByLabel('Filter').fill(`${DRBL4}:3`);
    await expect(receivers.getByRole('option')).toHaveCount(1);
    await receivers.getByRole('option').click();
    await receivers.getByRole('button').first().click();
    // unticking keeps what is chosen
    await page.getByTestId('add-link-show-all').uncheck();
    await page.getByTestId('add-link-create').click();
    await expect(page.getByTestId('add-link-dialog')).not.toHaveAttribute('open');
    await expect(page.locator(`[data-row-id="${WRC6}:1->${DRBL4}:3"]`)).toBeVisible();
});
