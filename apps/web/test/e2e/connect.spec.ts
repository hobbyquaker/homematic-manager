/**
 * "Connect and see devices": the first workflow of the inventory, and the one every other spec
 * depends on. The whole chain runs for real here - browser, WebSocket, backend, XML-RPC/BIN-RPC,
 * hm-simulator - so a failure in this file means none of the others can be trusted.
 */

import {BIDCOS_SWITCH, HMIP_BUTTON, HMIP_DIMMER, expect, simulatorReady, test} from './fixtures.js';

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
});

test('the app connects and lists the devices of both interfaces', async ({page, host}) => {
    await page.goto(host.url);

    await expect(page.getByTestId('app')).toBeVisible();
    await expect(page.getByTestId('loader')).toBeHidden();
    // The indicator is the one thing that says the backend really reached the interface processes.
    await expect(page.getByTestId('connection-indicator')).not.toContainText('Not connected');

    // The interface picker is a MultiSelect (a button plus a listbox), not a native <select>, and
    // it only exists because two interfaces are configured.
    const picker = page.getByTestId('interface-select');
    await picker.getByRole('button').first().click();
    await picker.getByRole('option', {name: 'BidCos-RF'}).click();

    await expect(page.getByTestId('devices-table')).toBeVisible();
    await expect(page.locator(`[data-row-id="${BIDCOS_SWITCH}"]`)).toBeVisible();
    // The friendly name comes from ReGa (D-2), not from the interface process.
    await expect(page.locator(`[data-row-id="${BIDCOS_SWITCH}"]`)).toContainText('Steckdose');
    await expect(page.locator(`[data-row-id="${BIDCOS_SWITCH}"]`)).toContainText('HM-LC-Sw1-Pl');

    await picker.getByRole('button').first().click();
    await picker.getByRole('option', {name: 'HmIP-RF'}).click();
    await expect(page.locator(`[data-row-id="${HMIP_DIMMER}"]`)).toBeVisible();
    await expect(page.locator(`[data-row-id="${HMIP_BUTTON}"]`)).toBeVisible();
    // and the BidCos device is gone with its interface
    await expect(page.locator(`[data-row-id="${BIDCOS_SWITCH}"]`)).toHaveCount(0);
});

test('a device opens its channel sub-grid', async ({page, host}) => {
    await page.goto(`${host.url}#/BidCos-RF/devices`);
    await expect(page.getByTestId('devices-table')).toBeVisible();

    const device = page.locator(`[data-row-id="${BIDCOS_SWITCH}"]`);
    // "Expand row" is one of the two strings the DataTable does not translate.
    await device.getByRole('button', {name: 'Expand row'}).click();

    await expect(page.locator(`[data-row-id="${BIDCOS_SWITCH}:1"]`)).toContainText('SWITCH');
    await expect(page.locator(`[data-row-id="${BIDCOS_SWITCH}:0"]`)).toContainText('MAINTENANCE');
});
