/**
 * "Events, filtered". The events tab is the one place where the callback server is visible to the
 * user: the interface process calls back, the backend forwards the event and the grid grows. The
 * spec raises real events in the simulator and then filters for them.
 *
 * The grid does not start empty. `init` makes the interface process answer with `newDevices`, and
 * that is an RPC event like any other - 2.7 listed it too. The counts below are therefore relative
 * to whatever the connection itself produced.
 */

import {HMIP_DIMMER, expect, simulatorReady, test} from './fixtures.js';

const CHANNEL = `${HMIP_DIMMER}:3`;
const MAINTENANCE = `${HMIP_DIMMER}:0`;

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
});

test('an event from the interface process arrives and the filters narrow it down', async ({page, host, sim}) => {
    await page.goto(`${host.url}#/HmIP-RF/events`);
    await expect(page.getByTestId('events-table')).toBeVisible();
    const rows = page.locator('[data-row-kind="row"]');
    const seeded = await rows.count();

    sim.fireEvent('hmip', CHANNEL, 'STATE', true);
    sim.fireEvent('hmip', MAINTENANCE, 'RSSI_DEVICE', -55);

    await expect(rows).toHaveCount(seeded + 2);
    await expect(page.getByTestId('events-table')).toContainText('STATE');
    await expect(page.getByTestId('events-table')).toContainText('RSSI_DEVICE');

    // Filters are plain search inputs, matched as a case-insensitive substring, no debounce.
    await page.getByTestId('events-filter-datapoint').fill('rssi');
    await expect(rows).toHaveCount(1);
    await expect(page.getByTestId('events-table')).toContainText('RSSI_DEVICE');

    await page.getByTestId('events-filter-datapoint').fill('');
    await page.getByTestId('events-filter-address').fill(':3');
    await expect(rows).toHaveCount(1);
    await expect(page.getByTestId('events-table')).toContainText('STATE');

    await page.getByTestId('events-filter-address').fill('nothing-matches-this');
    await expect(rows).toHaveCount(0);
});

test('pausing freezes the grid and unpausing catches up', async ({page, host, sim}) => {
    await page.goto(`${host.url}#/HmIP-RF/events`);
    await expect(page.getByTestId('events-table')).toBeVisible();

    // Only the two STATE events, so the `newDevices` of the connection cannot blur the counting.
    await page.getByTestId('events-filter-datapoint').fill('STATE');
    const rows = page.locator('[data-row-kind="row"]');
    await expect(rows).toHaveCount(0);

    sim.fireEvent('hmip', CHANNEL, 'STATE', true);
    await expect(rows).toHaveCount(1);

    await page.getByTestId('events-pause').click();
    await expect(page.getByTestId('events-paused')).toBeVisible();

    sim.fireEvent('hmip', CHANNEL, 'STATE', false);
    // The frozen snapshot does not grow. `toHaveCount` retries, so this can only pass by staying 1.
    await expect(rows).toHaveCount(1);

    await page.getByTestId('events-pause').click();
    await expect(page.getByTestId('events-paused')).toHaveCount(0);
    await expect(rows).toHaveCount(2);
});
