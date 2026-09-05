/**
 * "RPC console call". The console is the escape hatch of 2.7: any method of the interface process,
 * with a form generated from the method catalogue. This spec drives one read call end to end and
 * checks that the argument form really built the tuple that went on the wire.
 */

import {HMIP_DIMMER, expect, simulatorReady, test} from './fixtures.js';

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
});

test('a method is chosen, its arguments filled in and the answer shown', async ({page, host}) => {
    await page.goto(`${host.url}#/HmIP-RF/console`);

    const method = page.getByTestId('console-method');
    // The list is what the interface process answered to `system.listMethods`, so it arrives late.
    await expect(method.locator('option')).not.toHaveCount(1);

    await method.selectOption('getDeviceDescription');
    await expect(page.getByTestId('arg-address')).toBeVisible();
    await page.locator('#arg-input-address').fill(HMIP_DIMMER);

    // `console-params` is an <output>: it shows the exact tuple the call will send.
    await expect(page.getByTestId('console-params')).toHaveText(`getDeviceDescription("${HMIP_DIMMER}")`);

    await page.getByTestId('console-send-button').click();

    // a <textarea>: the answer is its *value*, its text content stays the empty initial one
    await expect(page.getByTestId('console-response')).toHaveValue(/HmIP-PDT/);
    await expect(page.getByTestId('console-history').getByRole('button')).toHaveCount(1);
    await expect(page.getByTestId('console-error')).toHaveCount(0);
});

test('a fault is shown in the response and never as a toast', async ({page, host}) => {
    await page.goto(`${host.url}#/HmIP-RF/console`);
    const method = page.getByTestId('console-method');
    await expect(method.locator('option')).not.toHaveCount(1);

    await method.selectOption('getDeviceDescription');
    await page.locator('#arg-input-address').fill('NO-SUCH-DEVICE');
    await page.getByTestId('console-send-button').click();

    await expect(page.getByTestId('console-error')).toBeVisible();
    // A console call that faults is an answer, not an application error: no notice pops up.
    await expect(page.getByTestId('notices')).toBeEmpty();
});
