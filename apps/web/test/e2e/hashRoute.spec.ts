/**
 * B-42: the interface in the URL hash. The address bar, back and forward change only the hash; the
 * Devices tab of the interface they switch to has to fill as it does after the interface picker,
 * rather than stay at "Loading" until something else happens to load that interface.
 */

import {BIDCOS_SWITCH, HMIP_DIMMER, expect, simulatorReady, test} from './fixtures.js';

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
});

test('a hash that names another interface loads its devices, back and forward included (B-42)', async ({
    page,
    host,
}) => {
    await page.goto(`${host.url}#/BidCos-RF/devices`);
    await expect(page.locator(`[data-row-id="${BIDCOS_SWITCH}"]`)).toBeVisible();

    // what typing into the address bar does to a page that is already open
    await page.evaluate(() => {
        location.hash = '#/HmIP-RF/devices';
    });
    await expect(page.locator(`[data-row-id="${HMIP_DIMMER}"]`)).toBeVisible();
    await expect(page.getByRole('button', {name: 'Select an interface'})).toContainText('HmIP-RF');

    await page.goBack();
    await expect(page.locator(`[data-row-id="${BIDCOS_SWITCH}"]`)).toBeVisible();
    await page.goForward();
    await expect(page.locator(`[data-row-id="${HMIP_DIMMER}"]`)).toBeVisible();
});
