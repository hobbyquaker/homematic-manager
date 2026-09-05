/**
 * "Service message acknowledge". A service message is a datapoint with the SERVICE flag that is
 * set; acknowledging one writes `false` back, and only `STICKY_UNREACH` and `SABOTAGE` can be
 * acknowledged at all - `LOWBAT` and `UNREACH` are states of the device, not of the CCU's list.
 */

import {HMIP_DIMMER, expect, simulatorReady, test} from './fixtures.js';

const MAINTENANCE = `${HMIP_DIMMER}:0`;

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
});

test('a pending message is listed, acknowledged and gone', async ({page, host, sim}) => {
    await page.goto(`${host.url}#/HmIP-RF/messages`);
    await expect(page.getByTestId('messages-table')).toBeVisible();

    // The device reports it: an event from the interface process is how a service message really
    // comes into existence, and it has to reach the open page without a reload.
    sim.fireEvent('hmip', MAINTENANCE, 'STICKY_UNREACH', true);

    const row = page.locator(`[data-row-id="${MAINTENANCE}/STICKY_UNREACH"]`);
    await expect(row).toBeVisible();
    // The tab carries the count in brackets (2.7 did the same).
    await expect(page.getByRole('tab', {name: /Service messages/})).toContainText('1');

    // Refresh asks the backend for every interface - which it does by leaving the interface name
    // out. Over JSON that argument arrives as `null`, and until task 14 the backend read it as a
    // filter and answered with nothing, so this button emptied the grid.
    await page.getByTestId('messages-refresh').click();
    await expect(row).toBeVisible();

    await row.click();
    await expect(page.getByTestId('messages-ack')).toBeEnabled();
    await page.getByTestId('messages-ack').click();

    await expect(row).toHaveCount(0);
    expect(sim.getValue('hmip', MAINTENANCE, 'STICKY_UNREACH')).toBe(false);
});

test('quiet mode is a toggle that survives in localStorage', async ({page, host}) => {
    await page.goto(`${host.url}#/HmIP-RF/messages`);
    const quiet = page.getByTestId('messages-quiet');
    await expect(quiet).toHaveAttribute('aria-pressed', 'false');

    await quiet.click();
    await expect(quiet).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('messages-quiet-hint')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('hmm.serviceMessages.quiet'))).toBe('true');
});
