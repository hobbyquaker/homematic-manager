/**
 * "Rename": the ReGa path of D-2. The name in the grid comes from ReGa, the rename goes back to
 * ReGa as a script, and the grid has to show the new name without a reload.
 */

import {BIDCOS_SWITCH, expect, simulatorReady, test} from './fixtures.js';

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
});

test('renaming a device changes the name in the grid', async ({page, host, sim}) => {
    await page.goto(`${host.url}#/BidCos-RF/devices`);
    const row = page.locator(`[data-row-id="${BIDCOS_SWITCH}"]`);
    await expect(row).toContainText('Steckdose');

    // The toolbar button needs exactly one selected row; selecting is a plain click.
    await row.click();
    await expect(page.getByTestId('devices-rename')).toBeEnabled();
    await page.getByTestId('devices-rename').click();

    const dialog = page.getByTestId('rename-dialog');
    await expect(dialog).toHaveAttribute('open', '');
    await expect(page.getByTestId('rename-input')).toHaveValue('Steckdose');

    await page.getByTestId('rename-input').fill('Kitchen socket');
    await page.getByTestId('rename-save').click();

    await expect(dialog).not.toHaveAttribute('open');
    await expect(row).toContainText('Kitchen socket');

    // and the ReGa mock really saw the script, rather than the name only living in the local map
    expect(sim.regaSim.renames.some((entry) => entry.name === 'Kitchen socket')).toBe(true);
});

test('an empty name cannot wipe a name out', async ({page, host}) => {
    await page.goto(`${host.url}#/BidCos-RF/devices`);
    await page.locator(`[data-row-id="${BIDCOS_SWITCH}"]`).click();
    await page.getByTestId('devices-rename').click();

    await page.getByTestId('rename-input').fill('   ');
    await expect(page.getByTestId('rename-save')).toBeDisabled();
});
