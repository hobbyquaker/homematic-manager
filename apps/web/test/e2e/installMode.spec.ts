/**
 * "Install mode". `setInstallMode` on BidCos takes the mode, an optional serial and the temporary
 * key of issue #20; the countdown then polls `getInstallMode` once a second. The spec also pairs a
 * device while the dialog is open, which is issue #24: the newly paired device must be offered for
 * a name right there.
 */

import {startForTest} from 'homematic-manager';

import {BIDCOS_SWITCH, SIMULATOR_FIXTURE, expect, simulatorReady, test} from './fixtures.js';
import {STUB_TOKEN, startOcculiteStub} from './occuliteStub.js';
import {expectPrimaryToolbarButton} from './primaryButton.js';

const NEW_DEVICE = 'LEQ0000009';

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
});

test('the install mode opens for a while and can be stopped again', async ({page, host, sim}) => {
    await page.goto(`${host.url}#/BidCos-RF/devices`);
    await page.getByTestId('devices-add').click();
    await expect(page.getByTestId('add-device-dialog')).toHaveAttribute('open', '');

    // Mode 2 is "write the MASTER defaults and delete the existing links". The serial number has
    // its own button (`addDevice` alone, which never opens an install mode) and the temporary key
    // of issue #20 has its own case below.
    await page.getByTestId('add-device-mode').selectOption('2');
    await page.getByTestId('add-device-start').click();

    await expect(page.getByTestId('add-device-countdown')).toBeVisible();
    expect(sim.getInstallMode('rfd')).toBeGreaterThan(0);

    await page.getByTestId('add-device-stop').click();
    await expect(page.getByTestId('add-device-countdown')).toHaveCount(0);
    expect(sim.getInstallMode('rfd')).toBe(0);
});

test('the temporary key is set before the install mode opens (#20)', async ({page, host, sim}) => {
    // A device taught in with a passphrase only pairs again when the same passphrase is offered.
    // 2.7 had no field for it at all; the dialog sends `setTempKey` and then `setInstallMode`.
    // Feature-detected, not version-pinned: `setTempKey` arrived in hm-simulator 1.0.1.
    test.skip(
        typeof sim.getTempKey !== 'function',
        'the installed hm-simulator has no setTempKey (it arrived in 1.0.1)',
    );

    await page.goto(`${host.url}#/BidCos-RF/devices`);
    await page.getByTestId('devices-add').click();
    await page.getByTestId('add-device-temp-key').fill('Geheim123');
    await page.getByTestId('add-device-start').click();

    await expect(page.getByTestId('add-device-countdown')).toBeVisible();
    // the key first, then the install mode - the interface applies it to the pairings that follow
    expect(sim.getTempKey?.('rfd')).toBe('Geheim123');
    expect(sim.getInstallMode('rfd')).toBeGreaterThan(0);

    await page.getByTestId('add-device-stop').click();
});

test('a device paired while the dialog is open can be named right there (#24)', async ({page, host, sim}) => {
    sim.scriptNewDevices(
        'rfd',
        [
            {
                ADDRESS: NEW_DEVICE,
                TYPE: 'HM-LC-Sw1-Pl',
                VERSION: 1,
                FIRMWARE: '2.8',
                CHILDREN: [`${NEW_DEVICE}:0`, `${NEW_DEVICE}:1`],
                PARAMSETS: ['MASTER'],
                RF_ADDRESS: 9,
            },
            {
                ADDRESS: `${NEW_DEVICE}:0`,
                TYPE: 'MAINTENANCE',
                VERSION: 1,
                PARENT: NEW_DEVICE,
                PARENT_TYPE: 'HM-LC-Sw1-Pl',
                PARAMSETS: ['MASTER', 'VALUES'],
                INDEX: 0,
            },
            {
                ADDRESS: `${NEW_DEVICE}:1`,
                TYPE: 'SWITCH',
                VERSION: 1,
                PARENT: NEW_DEVICE,
                PARENT_TYPE: 'HM-LC-Sw1-Pl',
                PARAMSETS: ['MASTER', 'VALUES', 'LINK'],
                LINK_TARGET_ROLES: 'SWITCH',
                DIRECTION: 2,
                INDEX: 1,
            },
        ],
        100,
    );

    await page.goto(`${host.url}#/BidCos-RF/devices`);
    await page.getByTestId('devices-add').click();
    await page.getByTestId('add-device-start').click();

    const paired = page.getByTestId('add-device-paired');
    await expect(paired).toBeVisible();
    // Channels are filtered out; only the device itself is offered.
    await expect(paired).toContainText(NEW_DEVICE);
    await expect(paired).not.toContainText(`${NEW_DEVICE}:1`);

    // task 65: one box for the section, ticked when the dialog opens - the channels are named too
    await expect(page.getByTestId('add-device-rename-children')).toBeChecked();
    await paired.getByLabel(`Name ${NEW_DEVICE}`).fill('New socket');
    await page.getByTestId('add-device-name-save').click();
    await expect(paired).toHaveCount(0);

    // The modal is in the top layer and swallows every click behind it.
    await page.getByTestId('add-device-dialog').getByRole('button', {name: 'Close'}).first().click();
    await page.getByTestId('devices-refresh').click();
    const row = page.locator(`[data-row-id="${NEW_DEVICE}"]`);
    await expect(row).toContainText('New socket');
    await row.getByRole('button', {name: 'Expand row'}).click();
    await expect(page.locator(`[data-row-id="${NEW_DEVICE}:0"]`)).toContainText('New socket:0');
    await expect(page.locator(`[data-row-id="${NEW_DEVICE}:1"]`)).toContainText('New socket:1');
});

/**
 * Task 28: an HmIP device without its SGTIN. The third way needs nothing typed, and on the wire it
 * is `setInstallMode` with exactly two parameters - hmipserver's third one is a String, and a mode
 * integer there opens nothing - which is what the RPC log has to show.
 */
test('an HmIP interface is armed for any device without an SGTIN (task 28)', async ({page, host, sim}) => {
    await page.goto(`${host.url}#/HmIP-RF/devices`);
    await page.getByTestId('devices-add').click();
    const dialog = page.getByTestId('add-device-dialog');
    await expect(dialog).toHaveAttribute('open', '');

    await expect(page.getByTestId('add-device-start')).toBeDisabled();
    await page.getByTestId('add-device-hmip-mode').selectOption('ANY');
    await expect(page.getByTestId('add-device-sgtin')).toHaveCount(0);
    await expect(page.getByTestId('add-device-hmip-hint')).toContainText("eQ-3's key server");
    await page.getByTestId('add-device-start').click();

    await expect(page.getByTestId('add-device-countdown')).toBeVisible();
    expect(sim.getInstallMode('hmip')).toBeGreaterThan(0);

    await page.getByTestId('add-device-stop').click();
    await expect(page.getByTestId('add-device-countdown')).toHaveCount(0);
    expect(sim.getInstallMode('hmip')).toBe(0);

    await dialog.locator('.hmm-dialog-close').click();
    await page.getByTestId('rpclog-toggle').click();
    const calls = page
        .getByTestId('rpclog')
        .locator('.hmm-rpclog-entry', {hasText: 'HmIP-RF setInstallMode'})
        .locator('.hmm-rpclog-params');
    await expect.poll(async () => (await calls.allTextContents()).sort()).toEqual(['false', 'true, 60']);
});

/**
 * Task 28, maintainer 2026-09-11: "Pair device" / "Gerät anlernen" is a captioned, larger button
 * with the `+` icon at the start of the band, the same one the Links tab's "Add link" is (task 33).
 */
test('"Pair device" is the captioned main action of the Devices tab (task 28)', async ({page, host}) => {
    await page.goto(`${host.url}#/HmIP-RF/devices`);
    await expect(page.getByTestId('devices-table')).toBeVisible();
    await expectPrimaryToolbarButton(page, {
        testId: 'devices-add',
        neighbour: 'devices-rename',
        dialog: 'add-device-dialog',
        captions: {en: 'Pair device', de: 'Gerät anlernen'},
    });
});

test('"Pair device" is disabled with its reason where there is no install mode (task 28)', async ({page, host}) => {
    // the CCU's group process makes its groups itself; there is nothing to pair
    await page.goto(`${host.url}#/VirtualDevices/devices`);
    await expect(page.getByTestId('devices-table')).toBeVisible();
    await expect(page.getByTestId('devices-add')).toBeDisabled();
    await expect(page.getByTestId('devices-add-tooltip')).toHaveAttribute(
        'data-tooltip',
        'Pair device — This interface cannot pair devices',
    );

    await page.goto(`${host.url}#/HmIP-RF/devices`);
    await expect(page.getByTestId('devices-add')).toBeEnabled();
});

/**
 * Task 66: the system's key mode decides which of the three HmIP ways can work. On a CCU - the
 * ordinary fixture, nothing answers `/api/meta/v1/version` - all three are offered, as always.
 */
test('a CCU offers all three HmIP pairing modes (task 66)', async ({page, host}) => {
    await page.goto(`${host.url}#/HmIP-RF/devices`);
    await page.getByTestId('devices-add').click();
    const select = page.getByTestId('add-device-hmip-mode');
    await expect(select).toBeVisible();
    await expect(select.locator('option')).toHaveText([
        'With SGTIN and key',
        'With SGTIN only (key server)',
        'Any device (no SGTIN)',
    ]);
});

/**
 * Task 66, the other half: an openccu-lite system whose key mode is `LOCAL` never asks eQ-3's key
 * server, so "SGTIN only" is not offered there and "any device" says that it pairs only a device
 * whose key is on the system - with the count the system reports, never a key.
 */
test('a LOCAL openccu-lite system offers two HmIP pairing modes and counts its device keys (task 66)', async ({
    page,
}) => {
    const stub = await startOcculiteStub({
        devices: [{address: BIDCOS_SWITCH, type: 'HM-LC-Sw1-Pl', name: 'Steckdose'}],
        hmip: {keyserver_mode: 'LOCAL', device_keys: 4, offline_pairing: false},
    });
    const box = await startForTest({
        simulator: true,
        simulatorOptions: structuredClone(SIMULATOR_FIXTURE),
        connection: {rega: true, language: 'en', metaUrl: stub.url, metaToken: STUB_TOKEN},
    });
    try {
        await page.goto(`${box.url}#/HmIP-RF/devices`);
        await page.getByTestId('devices-add').click();
        const select = page.getByTestId('add-device-hmip-mode');
        await expect(select.locator('option')).toHaveText(['With SGTIN and key', 'Any device (no SGTIN)']);
        await select.selectOption('ANY');
        const hint = page.getByTestId('add-device-hmip-hint');
        await expect(hint).toContainText("never asks eQ-3's key server");
        await expect(hint).toContainText('4 device keys are stored on the system');
        await expect(hint).not.toContainText('internet access');
    } finally {
        await box.close();
        await stub.close();
    }
});

/**
 * B-72: the key as the sticker prints it (26 characters of eQ-3's alphabet, typed with its dashes)
 * is accepted and goes out in `setInstallModeWithWhitelist` with `KEY_MODE: LOCAL`. The RPC log
 * masks the key itself; that it is the 32 hex digits the QR code holds is the backend's unit test
 * (`installMode.test.ts`). The key is made up.
 */
test('the printed HmIP key starts the whitelist pairing (B-72)', async ({page, host}) => {
    await page.goto(`${host.url}#/HmIP-RF/devices`);
    await page.getByTestId('devices-add').click();
    const dialog = page.getByTestId('add-device-dialog');
    await expect(dialog).toHaveAttribute('open', '');

    await page.getByTestId('add-device-hmip-mode').selectOption('KEY');
    await page.getByTestId('add-device-sgtin').fill('3014-F711-A000-0000-0000-1234');
    await page.getByTestId('add-device-key').fill('1TGJ8-Y1FAE-4UW1R-1EFFF-9E9EHZ');
    await expect(page.getByTestId('add-device-start')).toBeEnabled();
    await page.getByTestId('add-device-start').click();

    await dialog.locator('.hmm-dialog-close').click();
    await page.getByTestId('rpclog-toggle').click();
    const call = page
        .getByTestId('rpclog')
        .locator('.hmm-rpclog-entry', {hasText: 'HmIP-RF setInstallModeWithWhitelist'})
        .locator('.hmm-rpclog-params');
    await expect(call.first()).toContainText(
        'true, 60, [{"ADDRESS":"3014F711A000000000001234","KEY_MODE":"LOCAL","KEY":"***"}]',
    );
});
