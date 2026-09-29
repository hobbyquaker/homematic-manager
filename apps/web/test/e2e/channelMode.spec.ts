/**
 * Task 75 end to end (task 78): the WebUI draws a blind channel's MASTER form by the channel's
 * `channelMode` metadata, and so does this application - `getMetadata(channel, 'channelMode')` on
 * hmipserver, asked each time the dialog opens. The shutter way has no slat rule. The device is
 * hm-simulator's HmIP-BBL from its lab fixture (1.2.0, anonymised), with the metadata the 1.3.0
 * simulator answers.
 */

import {createRequire} from 'node:module';

import {startForTest, type TestHost} from 'homematic-manager';
import type HmSim from 'hm-simulator/sim.mjs';

import {SIMULATOR_FIXTURE, expect, simulatorReady, test} from './fixtures.js';

interface LabFixture {
    devices: Record<string, {devices: HmSim.DeviceDescription[]}>;
    paramsetDescriptions: Record<string, HmSim.ParamsetDescription>;
}

const lab = createRequire(import.meta.url)('hm-simulator/data/fixtures/lab-2026-09.json') as LabFixture;
const BBL_DEVICES = lab.devices['hmip']?.devices.filter(
    (device) => device.TYPE === 'HmIP-BBL' || device.PARENT_TYPE === 'HmIP-BBL',
);
const BBL = BBL_DEVICES?.find((device) => !device.PARENT)?.ADDRESS ?? '';
/** The first of the blind actor's three virtual receiver channels. */
const RECEIVER = `${BBL}:4`;

let host: TestHost;

/** A stack whose hmipserver has the blind actor, and the receiver's channelMode set to `mode`. */
async function startWith(mode: string | undefined): Promise<TestHost> {
    const fixture = structuredClone(SIMULATOR_FIXTURE) as {
        devices: Record<string, {devices: HmSim.DeviceDescription[]}>;
        paramsetDescriptions: Record<string, HmSim.ParamsetDescription>;
    } & Record<string, unknown>;
    fixture.devices['hmip'] = {
        devices: [...(fixture.devices['hmip']?.devices ?? []), ...structuredClone(BBL_DEVICES ?? [])],
    };
    fixture.paramsetDescriptions = {
        ...fixture.paramsetDescriptions,
        ...Object.fromEntries(Object.entries(lab.paramsetDescriptions).filter(([key]) => key.includes('/HmIP-BBL/'))),
    };
    if (mode !== undefined) {
        fixture['metadata'] = {hmip: {[RECEIVER]: {channelMode: mode}}};
    }
    return startForTest({simulator: true, simulatorOptions: fixture, connection: {rega: true, language: 'en'}});
}

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
    expect(BBL).not.toBe('');
});

test.afterEach(async () => {
    await host.close();
});

async function openReceiverMaster(page: import('@playwright/test').Page): Promise<import('@playwright/test').Locator> {
    await page.goto(`${host.url}#/HmIP-RF/devices`);
    const row = page.locator(`[data-row-id="${BBL}"]`);
    await expect(row).toBeVisible();
    await row.getByRole('button', {name: 'Expand row'}).click();
    await page.getByTestId(`paramset-${RECEIVER}-MASTER`).click();
    const form = page.getByTestId('paramset-easy-form');
    await expect(form).toBeVisible();
    return form;
}

test('a receiver set to shutter gets the shutter form: no slat rule (task 75)', async ({page}) => {
    host = await startWith('shutter');
    const form = await openReceiverMaster(page);
    // the WebUI's labels: "Connection rule" in the shutter way, "... blind" and "... slat" in the blind way
    await expect(form.getByRole('combobox', {name: 'Connection rule', exact: true})).toBeVisible();
    await expect(form.getByRole('combobox', {name: 'Connection rule slat'})).toHaveCount(0);
});

test('a receiver set to blind, or without the metadata, gets the slat rule too (task 75)', async ({page}) => {
    host = await startWith('blind');
    let form = await openReceiverMaster(page);
    await expect(form.getByRole('combobox', {name: 'Connection rule blind'})).toBeVisible();
    await expect(form.getByRole('combobox', {name: 'Connection rule slat'})).toBeVisible();
    await host.close();

    // hmipserver answers an unset key with an empty value: the WebUI's default, the blind form
    host = await startWith(undefined);
    form = await openReceiverMaster(page);
    await expect(form.getByRole('combobox', {name: 'Connection rule blind'})).toBeVisible();
    await expect(form.getByRole('combobox', {name: 'Connection rule slat'})).toBeVisible();
});
