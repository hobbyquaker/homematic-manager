/**
 * The per-datapoint `setValue` of the VALUES paramset (task 19, D-34).
 *
 * The maintainer's first look at a dev build found the button firing a toast that said "setValue"
 * and a datapoint that did not move. The assertion here is deliberately the simulator's own value
 * and not anything the dialog draws: only the interface process knows whether the write happened.
 */

import {BIDCOS_SWITCH, HMIP_DIMMER, expect, simulatorReady, test} from './fixtures.js';

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
});

test('setValue writes the datapoint and the toast names channel, datapoint and value', async ({page, host, sim}) => {
    const channel = `${BIDCOS_SWITCH}:1`;

    await page.goto(`${host.url}#/BidCos-RF/devices`);
    await page.locator(`[data-row-id="${BIDCOS_SWITCH}"]`).getByRole('button', {name: 'Expand row'}).click();
    await page.getByTestId(`paramset-${channel}-VALUES`).click();

    await expect(page.getByTestId('param-STATE')).toBeVisible();
    await page.getByTestId('param-STATE').getByRole('checkbox').check();
    await page.getByTestId('set-STATE').click();

    await expect.poll(() => sim.getValue('rfd', channel, 'STATE')).toBe(true);

    // The toast has to say what was written, not only that something was.
    const notices = page.getByTestId('notices');
    await expect(notices).toContainText(channel);
    await expect(notices).toContainText('STATE');
    await expect(notices).toContainText('true');
});

/**
 * The actual defect. A `FLOAT` came out of the UI as `{explicitDouble: n}`, the backend cast that
 * object a second time, `parseFloat('[object Object]')` is `NaN` and `NaN` becomes `0` - so every
 * `setValue` on a float wrote zero, which on a dimmer that is already off looks like nothing at
 * all happening.
 */
test('setValue writes a FLOAT datapoint as the number it is, not as zero', async ({page, host, sim}) => {
    const channel = `${HMIP_DIMMER}:3`;

    await page.goto(`${host.url}#/HmIP-RF/devices`);
    await page.locator(`[data-row-id="${HMIP_DIMMER}"]`).getByRole('button', {name: 'Expand row'}).click();
    await page.getByTestId(`paramset-${channel}-VALUES`).click();

    await expect(page.getByTestId('param-LEVEL')).toBeVisible();
    await page.getByTestId('param-LEVEL').getByRole('spinbutton').fill('0.5');
    await page.getByTestId('set-LEVEL').click();

    await expect.poll(() => sim.getValue('hmip', channel, 'LEVEL')).toBe(0.5);
    await expect(page.getByTestId('notices')).toContainText('0.5');
});

test('setValue on a read-only datapoint has no button at all', async ({page, host}) => {
    await page.goto(`${host.url}#/BidCos-RF/devices`);
    await page.locator(`[data-row-id="${BIDCOS_SWITCH}"]`).getByRole('button', {name: 'Expand row'}).click();
    await page.getByTestId(`paramset-${BIDCOS_SWITCH}:0-VALUES`).click();

    await expect(page.getByTestId('param-STICKY_UNREACH')).toBeVisible();
    await expect(page.getByTestId('set-STICKY_UNREACH')).toHaveCount(1);
    // UNREACH is OPERATIONS 5 - readable and reported, never writable.
    await expect(page.getByTestId('set-UNREACH')).toHaveCount(0);
});
