/**
 * "Multi-apply refusal" (issue #98). Applying a MASTER paramset to several channels at once is
 * only safe when the channels share an identity - interface, device type, firmware, version,
 * channel type and paramset. A channel that does not is offered but disabled, with the reason in
 * its label, rather than quietly left out of the list: the user asked for it and deserves to be
 * told why not.
 */

import {HMIP_DIMMER, HMIP_DIMMER_OTHER_FIRMWARE, expect, simulatorReady, test} from './fixtures.js';

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
});

test('a channel on another firmware is offered disabled, with the reason', async ({page, host}) => {
    await page.goto(`${host.url}#/HmIP-RF/devices`);
    await page.locator(`[data-row-id="${HMIP_DIMMER}"]`).getByRole('button', {name: 'Expand row'}).click();
    await page.getByTestId(`paramset-${HMIP_DIMMER}:3-MASTER`).click();
    await expect(page.getByTestId('paramset-dialog')).toHaveAttribute('open', '');

    const targets = page.getByTestId('paramset-targets');
    await targets.getByRole('button').first().click();

    // The other HmIP-PDT is the same device type and the same channel type, but firmware 1.6.0
    // describes SWITCH_VIRTUAL_RECEIVER/MASTER differently - so it is refused.
    const refused = targets.getByRole('option', {name: new RegExp(`${HMIP_DIMMER_OTHER_FIRMWARE}:3`)});
    await expect(refused).toContainText('other firmware or device type');
    await expect(refused).toBeDisabled();
});

test('the picker is not offered for a VALUES paramset', async ({page, host}) => {
    await page.goto(`${host.url}#/HmIP-RF/devices`);
    await page.locator(`[data-row-id="${HMIP_DIMMER}"]`).getByRole('button', {name: 'Expand row'}).click();
    await page.getByTestId(`paramset-${HMIP_DIMMER}:3-VALUES`).click();
    await expect(page.getByTestId('paramset-dialog')).toHaveAttribute('open', '');

    // Multi-apply is a MASTER feature: a VALUES write is a `setValue` per datapoint, and applying
    // one to several channels at once was never a thing 2.7 offered either.
    await expect(page.getByTestId('paramset-targets')).toHaveCount(0);
});
