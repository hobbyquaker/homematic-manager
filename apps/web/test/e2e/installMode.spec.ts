/**
 * "Install mode". `setInstallMode` on BidCos takes the mode, an optional serial and the temporary
 * key of issue #20; the countdown then polls `getInstallMode` once a second. The spec also pairs a
 * device while the dialog is open, which is issue #24: the newly paired device must be offered for
 * a name right there.
 */

import {expect, simulatorReady, test} from './fixtures.js';

const NEW_DEVICE = 'LEQ0000009';

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
});

test('the install mode opens for a while and can be stopped again', async ({page, host, sim}) => {
    await page.goto(`${host.url}#/BidCos-RF/devices`);
    await page.getByTestId('devices-add').click();
    await expect(page.getByTestId('add-device-dialog')).toHaveAttribute('open', '');

    // Mode 2 is "write the MASTER defaults and delete the existing links"; without a serial number
    // this is a plain `setInstallMode(true, seconds, mode)`. With one it would be `addDevice`
    // instead - adding a BidCos device by its serial never opens the install mode at all - and the
    // temporary key of issue #20 is left out because hm-simulator 1.0 has no `setTempKey` and
    // faults the call. Both of those are covered by the component tests of the dialog.
    await page.getByTestId('add-device-mode').selectOption('2');
    await page.getByTestId('add-device-start').click();

    await expect(page.getByTestId('add-device-countdown')).toBeVisible();
    expect(sim.getInstallMode('rfd')).toBeGreaterThan(0);

    await page.getByTestId('add-device-stop').click();
    await expect(page.getByTestId('add-device-countdown')).toHaveCount(0);
    expect(sim.getInstallMode('rfd')).toBe(0);
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

    await paired.getByLabel(`Name ${NEW_DEVICE}`).fill('New socket');
    await page.getByTestId('add-device-name-save').click();

    // The modal is in the top layer and swallows every click behind it.
    await page.getByTestId('add-device-dialog').getByRole('button', {name: 'Close'}).first().click();
    await page.getByTestId('devices-refresh').click();
    await expect(page.locator(`[data-row-id="${NEW_DEVICE}"]`)).toContainText('New socket');
});
