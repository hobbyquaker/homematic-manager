/**
 * Task 108 end to end: a wired blind actuator (HmIPW-DRBL4) in a distribution board, run as a shutter, with links
 * from the inputs of wired input modules (HmIPW-DRI32, HmIPW-DRI16) and from a wired wall button (HmIPW-WRC6), made on
 * a CCU. The WebUI opens `linkHmIP_BLIND_VIRTUAL_RECEIVER.tcl`, which takes the shutter profiles for an HmIPW actuator
 * (firmware 1.6 or later) unless its `channelMode` says `blind`, and for an input `MULTI_MODE_INPUT_TRANSMITTER.tcl`,
 * which takes the file of the input's `CHANNEL_OPERATION_MODE`. Up to 3.4.0 the dialog looked the profiles up by the
 * raw channel types and offered the expert profile only.
 *
 * The devices, their descriptions and the links are hm-simulator's `hmip-wired` fixture (since 1.5.0): the real
 * descriptions of the four devices, and LINK paramsets holding what the CCU's WebUI writes for the profile chosen.
 */

import {createRequire} from 'node:module';

import type {ReceiverProfiles} from '@homematic-manager/core';
import {startForTest, type TestHost} from 'homematic-manager';
import type {Page} from '@playwright/test';
import type HmSim from 'hm-simulator/sim.mjs';

import {SIMULATOR_FIXTURE, expect, simulatorReady, test} from './fixtures.js';

interface WiredFixture {
    devices: {hmip: {devices: HmSim.DeviceDescription[]}};
    paramsetDescriptions: Record<string, HmSim.ParamsetDescription>;
    links: {hmip: HmSim.Link[]};
    paramsets: {hmip: Record<string, Record<string, Record<string, unknown>>>};
}

const require = createRequire(import.meta.url);
const wired = require('hm-simulator/data/fixtures/hmip-wired.json') as WiredFixture;

const deviceOf = (type: string): string =>
    wired.devices.hmip.devices.find((device) => device.TYPE === type && !device.PARENT)?.ADDRESS ?? '';
const DRBL4 = deviceOf('HmIPW-DRBL4');
const DRI32 = deviceOf('HmIPW-DRI32');
const DRI16 = deviceOf('HmIPW-DRI16');
const WRC6 = deviceOf('HmIPW-WRC6');

const SHUTTER = ['Experte', 'auf / hoch', 'zu / herunter', 'auf / zu & hoch / herunter', 'Position anfahren', 'Toggle'];

/** The e2e fixture with the HmIP-Wired devices, their links and the paramsets the CCU wrote. */
function fixture(channelMode: string | undefined): Record<string, unknown> {
    const base = structuredClone(SIMULATOR_FIXTURE) as Record<string, unknown> & {
        devices: Record<string, {devices: HmSim.DeviceDescription[]}>;
        paramsetDescriptions: Record<string, unknown>;
    };
    base.devices['hmip'] = {
        devices: [...(base.devices['hmip']?.devices ?? []), ...structuredClone(wired.devices.hmip.devices)],
    };
    base.paramsetDescriptions = {...base.paramsetDescriptions, ...wired.paramsetDescriptions};
    base['links'] = structuredClone(wired.links);
    base['paramsets'] = structuredClone(wired.paramsets);
    if (channelMode !== undefined) {
        base['metadata'] = {hmip: {[`${DRBL4}:2`]: {channelMode}}};
    }
    return base;
}

let host: TestHost | undefined;

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
    expect([DRBL4, DRI32, DRI16, WRC6]).not.toContain('');
});

test.afterEach(async () => {
    await host?.close();
    host = undefined;
});

async function openLink(page: Page, sender: string, receiver: string, channelMode?: string): Promise<void> {
    host = await startForTest({
        simulator: true,
        simulatorOptions: fixture(channelMode),
        connection: {rega: true, language: 'de'},
    });
    await page.goto(`${host.url}#/HmIP-RF/links`);
    await page.locator(`[data-row-id="${sender}->${receiver}"]`).click();
    await page.getByTestId('links-edit').click();
    await expect(page.getByTestId('link-paramset-dialog')).toHaveAttribute('open', '');
}

const options = (page: Page): Promise<string[]> =>
    page
        .getByTestId('link-profile')
        .evaluate((select: HTMLSelectElement) => [...select.options].map((option) => option.textContent?.trim() ?? ''));

test('a CCU-made link from a wired input to a wired shutter shows its easy mode (task 108)', async ({page}) => {
    await openLink(page, `${DRI32}:1`, `${DRBL4}:2`);
    const select = page.getByTestId('link-profile');
    await expect(select).toHaveValue('3');
    await expect(select.locator('option:checked')).toHaveText('auf / zu & hoch / herunter');
    expect(await options(page)).toEqual(SHUTTER);
    await expect(page.getByTestId('link-easy-form')).toBeVisible();
    // nothing to write when the link is left as the CCU made it
    await page.getByTestId('link-preview').click();
    await expect(page.getByTestId('write-preview')).toHaveAttribute('open', '');
    await expect(page.getByTestId('write-stage')).toBeDisabled();
});

for (const [name, sender, receiver, profile] of [
    ['an HmIPW-DRI16 input, "auf / hoch"', `${DRI16}:1`, `${DRBL4}:6`, '1'],
    ['an HmIPW-WRC6 button, "auf / zu & hoch / herunter"', `${WRC6}:1`, `${DRBL4}:10`, '3'],
    ['an HmIPW-WRC6 button, "Position anfahren"', `${WRC6}:2`, `${DRBL4}:14`, '4'],
    // B-98: made by the WebUI of firmware 3.87 (the long press 5): "Toggle", whose presets are the same, as the
    // current WebUI shows it
    ['an HmIPW-DRI32 input by the 3.87 WebUI, "auf / zu & hoch / herunter"', `${DRI32}:2`, `${DRBL4}:3`, '5'],
] as const) {
    test(`a CCU-made link from ${name} to the wired shutter shows that profile (task 108)`, async ({page}) => {
        await openLink(page, sender, receiver);
        await expect(page.getByTestId('link-profile')).toHaveValue(profile);
        expect(await options(page)).toEqual(SHUTTER);
    });
}

test('the same actuator set to "blind" in the WebUI gets the blind profiles (task 108)', async ({page}) => {
    await openLink(page, `${DRI32}:1`, `${DRBL4}:2`, 'blind');
    const blind = require('../../../../data/dist/profiles/BLIND_VIRTUAL_RECEIVER.json') as ReceiverProfiles;
    const names = (blind.senders['MULTI_MODE_INPUT_TRANSMITTER_1'] ?? [])
        .sort((a, b) => a.id - b.id)
        .map((entry) => entry.name['de'] ?? '');
    await expect.poll(() => options(page)).toEqual(names);
});
