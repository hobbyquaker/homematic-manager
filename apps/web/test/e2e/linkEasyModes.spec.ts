/**
 * Task 108 end to end: a wired blind actuator (HmIPW-DRBL4) in a distribution board, run as a shutter, with a
 * link from an input of a wired input module, made on a CCU. The WebUI opens `linkHmIP_BLIND_VIRTUAL_RECEIVER.tcl`,
 * which takes the shutter profiles for an HmIPW actuator (firmware 1.6 or later) unless its `channelMode` says
 * `blind`, and `MULTI_MODE_INPUT_TRANSMITTER.tcl`, which takes the file of the input's `CHANNEL_OPERATION_MODE`. Up
 * to 3.4.0 the dialog looked the profiles up by the raw channel types and offered the expert profile only.
 *
 * hm-simulator has no HmIPW-DRBL4: the actuator here is its lab fixture's HmIP-BBL blind channel description (the same
 * channel type, `BLIND_VIRTUAL_RECEIVER`, as hmipserver 3.89.11 describes it) under the DRBL4's device type and a
 * 1.6 firmware. The input is the lab fixture's HmIPW-DRI16 as it is (`CHANNEL_OPERATION_MODE` `KEY_BEHAVIOR`).
 */

import {createRequire} from 'node:module';

import {
    EasyModeEngine,
    MemoryDataSource,
    type ParamsetDescription,
    type ReceiverProfiles,
} from '@homematic-manager/core';
import {startForTest, type TestHost} from 'homematic-manager';
import type {Page} from '@playwright/test';
import type HmSim from 'hm-simulator/sim.mjs';

import {SIMULATOR_FIXTURE, expect, simulatorReady, test} from './fixtures.js';

interface LabFixture {
    devices: Record<string, {devices: HmSim.DeviceDescription[]}>;
    paramsetDescriptions: Record<string, HmSim.ParamsetDescription>;
}

const require = createRequire(import.meta.url);
const lab = require('hm-simulator/data/fixtures/lab-2026-09.json') as LabFixture;
const shutter = require('../../../../data/dist/profiles/SHUTTER_VIRTUAL_RECEIVER.json') as ReceiverProfiles;

const DRBL4 = '0029DFFF000108';
const RECEIVER = `${DRBL4}:2`;
const FIRMWARE = '1.6.2';
const DRI16_DEVICES = (lab.devices['hmip']?.devices ?? []).filter(
    (device) => device.TYPE === 'HmIPW-DRI16' || device.PARENT_TYPE === 'HmIPW-DRI16',
);
const DRI16 = DRI16_DEVICES.find((device) => !device.PARENT)?.ADDRESS ?? '';
const SENDER = `${DRI16}:1`;
const BBL_LINK = 'HmIP-RF/HmIP-BBL/1.0.2/1/BLIND_VIRTUAL_RECEIVER/LINK';

/** The actuator: maintenance, one blind channel and its virtual receiver, as an HmIPW-DRBL4 lists them. */
const DRBL4_DEVICES = [
    {
        ADDRESS: DRBL4,
        TYPE: 'HmIPW-DRBL4',
        VERSION: 1,
        FIRMWARE,
        CHILDREN: [`${DRBL4}:0`, `${DRBL4}:1`, RECEIVER],
        PARAMSETS: ['MASTER', 'SERVICE'],
    },
    ...[
        ['MAINTENANCE', 0, ['MASTER', 'VALUES']],
        ['BLIND_TRANSMITTER', 1, ['MASTER', 'VALUES']],
        ['BLIND_VIRTUAL_RECEIVER', 2, ['MASTER', 'VALUES', 'LINK']],
    ].map(([type, index, paramsets]) => ({
        ADDRESS: `${DRBL4}:${String(index)}`,
        TYPE: type,
        VERSION: 1,
        PARENT: DRBL4,
        PARENT_TYPE: 'HmIPW-DRBL4',
        INDEX: index,
        PARAMSETS: paramsets,
        ...(type === 'BLIND_VIRTUAL_RECEIVER'
            ? {LINK_TARGET_ROLES: 'REMOTE_CONTROL CONDITIONAL_SWITCH SWITCH LEVEL', DIRECTION: 2}
            : {}),
    })),
] as unknown as HmSim.DeviceDescription[];

function fixture(channelMode: string | undefined): Record<string, unknown> {
    const base = structuredClone(SIMULATOR_FIXTURE) as Record<string, unknown> & {
        devices: Record<string, {devices: HmSim.DeviceDescription[]}>;
        paramsetDescriptions: Record<string, unknown>;
    };
    base.devices['hmip'] = {
        devices: [...(base.devices['hmip']?.devices ?? []), ...structuredClone(DRI16_DEVICES), ...DRBL4_DEVICES],
    };
    const prefix = `HmIP-RF/HmIPW-DRBL4/${FIRMWARE}/1`;
    base.paramsetDescriptions = {
        ...base.paramsetDescriptions,
        ...Object.fromEntries(
            Object.entries(lab.paramsetDescriptions).filter(([key]) => key.includes('/HmIPW-DRI16/')),
        ),
        [`${prefix}//MASTER`]: {},
        [`${prefix}//SERVICE`]: {},
        [`${prefix}/MAINTENANCE/MASTER`]: {},
        [`${prefix}/MAINTENANCE/VALUES`]: {},
        [`${prefix}/BLIND_TRANSMITTER/MASTER`]: {},
        [`${prefix}/BLIND_TRANSMITTER/VALUES`]: {},
        [`${prefix}/BLIND_VIRTUAL_RECEIVER/MASTER`]: {},
        [`${prefix}/BLIND_VIRTUAL_RECEIVER/VALUES`]: {},
        [`${prefix}/BLIND_VIRTUAL_RECEIVER/LINK`]: lab.paramsetDescriptions[BBL_LINK],
    };
    if (channelMode !== undefined) {
        base['metadata'] = {hmip: {[RECEIVER]: {channelMode}}};
    }
    return base;
}

/** What the CCU's WebUI writes for a profile of the key input on a shutter: its presets. */
function writtenBy(key: string): Record<string, unknown> {
    const profile = shutter.senders['MULTI_MODE_INPUT_TRANSMITTER_1']?.find((entry) => entry.key === key);
    if (!profile) throw new Error(`the pipeline no longer ships ${key}`);
    const description = lab.paramsetDescriptions[BBL_LINK] as unknown as ParamsetDescription;
    return new EasyModeEngine(new MemoryDataSource()).applyProfile(profile, {}, description, {keepCurrent: false})
        .values;
}

let host: TestHost | undefined;

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
    expect(DRI16).not.toBe('');
    expect(lab.paramsetDescriptions[BBL_LINK]).toBeDefined();
});

test.afterEach(async () => {
    await host?.close();
    host = undefined;
});

async function openLink(page: Page, channelMode: string | undefined, values: Record<string, unknown>): Promise<void> {
    host = await startForTest({
        simulator: true,
        simulatorOptions: fixture(channelMode),
        connection: {rega: true, language: 'de'},
    });
    const sim = host.simulator as {callMethod(iface: string, method: string, params?: unknown[]): unknown};
    sim.callMethod('hmip', 'addLink', [SENDER, RECEIVER, '', '']);
    sim.callMethod('hmip', 'putParamset', [RECEIVER, SENDER, values]);
    await page.goto(`${host.url}#/HmIP-RF/links`);
    await page.locator(`[data-row-id="${SENDER}->${RECEIVER}"]`).click();
    await page.getByTestId('links-edit').click();
    await expect(page.getByTestId('link-paramset-dialog')).toHaveAttribute('open', '');
}

const options = (page: Page): Promise<string[]> =>
    page
        .getByTestId('link-profile')
        .evaluate((select: HTMLSelectElement) => [...select.options].map((option) => option.textContent?.trim() ?? ''));

test('a CCU-made link from a wired input to a wired shutter shows its easy mode (task 108)', async ({page}) => {
    await openLink(page, undefined, writtenBy('OpenClose_UpDown'));
    const select = page.getByTestId('link-profile');
    await expect(select).toHaveValue('3');
    await expect(select.locator('option:checked')).toHaveText('auf / zu & hoch / herunter');
    expect(await options(page)).toEqual([
        'Experte',
        'auf / hoch',
        'zu / herunter',
        'auf / zu & hoch / herunter',
        'Position anfahren',
        'Toggle',
    ]);
    await expect(page.getByTestId('link-easy-form')).toBeVisible();
    // nothing to write when the link is left as the CCU made it
    await page.getByTestId('link-preview').click();
    await expect(page.getByTestId('write-preview')).toHaveAttribute('open', '');
    await expect(page.getByTestId('write-stage')).toBeDisabled();
});

test('the same actuator set to "blind" in the WebUI gets the blind profiles (task 108)', async ({page}) => {
    await openLink(page, 'blind', writtenBy('OpenClose_UpDown'));
    const blind = require('../../../../data/dist/profiles/BLIND_VIRTUAL_RECEIVER.json') as ReceiverProfiles;
    const names = (blind.senders['MULTI_MODE_INPUT_TRANSMITTER_1'] ?? [])
        .sort((a, b) => a.id - b.id)
        .map((entry) => entry.name['de'] ?? '');
    await expect.poll(() => options(page)).toEqual(names);
});
