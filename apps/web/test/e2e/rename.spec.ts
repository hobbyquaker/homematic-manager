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

test('a double click on a device or a channel name opens the rename dialog for it (task 46)', async ({page, host}) => {
    await page.goto(`${host.url}#/BidCos-RF/devices`);
    const table = page.getByTestId('devices-table');
    const row = table.locator(`[data-row-id="${BIDCOS_SWITCH}"]`);
    const dialog = page.getByTestId('rename-dialog');
    await expect(row).toContainText('Steckdose');

    // a single click on the name selects, as it always did, and opens nothing
    const deviceName = row.locator('[data-column-key="name"]');
    await deviceName.click();
    await expect(row).toHaveAttribute('aria-selected', 'true');
    await expect(dialog).not.toHaveAttribute('open');

    await deviceName.dblclick();
    await expect(dialog).toHaveAttribute('open', '');
    await expect(page.getByTestId('rename-input')).toHaveValue('Steckdose');
    await expect(page.getByTestId('rename-children')).toBeVisible();
    // the word the double click selected in the grid is let go again
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
    // the close button rather than Escape: in this browser Escape leaves the dialog open, however it was opened
    await dialog.getByRole('button', {name: 'Close'}).click();
    await expect(dialog).not.toHaveAttribute('open');

    // a channel: the dialog is the channel's, and the device stays expanded
    await row.getByRole('button', {name: 'Expand row'}).click();
    const channel = table.locator(`[data-row-id="${BIDCOS_SWITCH}:1"]`);
    await channel.locator('[data-column-key="name"]').dblclick();
    await expect(dialog).toHaveAttribute('open', '');
    await expect(dialog).toContainText(`${BIDCOS_SWITCH}:1`);
    await expect(page.getByTestId('rename-input')).toHaveValue('Steckdose:1');
    await expect(page.getByTestId('rename-children')).toHaveCount(0);
    await dialog.getByRole('button', {name: 'Close'}).click();
    await expect(dialog).not.toHaveAttribute('open');
    await expect(row.getByRole('button', {name: 'Collapse row'})).toBeVisible();

    // the dialog gave the focus back to the grid: F2 renames the selected channel from there
    await page.keyboard.press('F2');
    await expect(dialog).toHaveAttribute('open', '');
    await expect(page.getByTestId('rename-input')).toHaveValue('Steckdose:1');
});

test('a double click on the handle of the Name column fits it and renames nothing (task 46)', async ({page, host}) => {
    await page.goto(`${host.url}#/BidCos-RF/devices`);
    const table = page.getByTestId('devices-table');
    await expect(table.locator(`[data-row-id="${BIDCOS_SWITCH}"]`)).toContainText('Steckdose');

    await table.getByTestId('devices-table-resize-name').dblclick();
    await expect(page.getByTestId('rename-dialog')).not.toHaveAttribute('open');
    // the fit stored a width: the head's menu offers to reset it
    await table.getByRole('columnheader', {name: 'ADDRESS', exact: true}).click({button: 'right'});
    await expect(
        page.getByTestId('devices-table-columns-menu').getByRole('menuitem', {name: 'Reset column widths'}),
    ).toBeEnabled();
});

test.describe('on a touch screen (task 46)', () => {
    test.use({hasTouch: true});

    /*
     * A long press is not tested: the protocol Playwright emulates touch with turns one into
     * pointerdown, touchstart, pointerup, touchend and a click - no `contextmenu`, so no row menu
     * either. Two taps do make a `dblclick`.
     */
    test('a tap on a name selects, a double tap opens the rename dialog', async ({page, host}) => {
        await page.goto(`${host.url}#/BidCos-RF/devices`);
        const row = page.getByTestId('devices-table').locator(`[data-row-id="${BIDCOS_SWITCH}"]`);
        const dialog = page.getByTestId('rename-dialog');
        await expect(row).toContainText('Steckdose');
        const box = (await row.locator('[data-column-key="name"]').boundingBox())!;
        const point = {x: box.x + box.width / 2, y: box.y + box.height / 2};

        await page.touchscreen.tap(point.x, point.y);
        await expect(row).toHaveAttribute('aria-selected', 'true');
        await expect(dialog).not.toHaveAttribute('open');

        // longer than a double tap's interval, so the next two taps are a pair of their own
        await page.waitForTimeout(800);
        await page.touchscreen.tap(point.x, point.y);
        await page.touchscreen.tap(point.x, point.y);
        await expect(dialog).toHaveAttribute('open', '');
        await expect(page.getByTestId('rename-input')).toHaveValue('Steckdose');
    });
});

test('an empty name cannot wipe a name out', async ({page, host}) => {
    await page.goto(`${host.url}#/BidCos-RF/devices`);
    await page.locator(`[data-row-id="${BIDCOS_SWITCH}"]`).click();
    await page.getByTestId('devices-rename').click();

    await page.getByTestId('rename-input').fill('   ');
    await expect(page.getByTestId('rename-save')).toBeDisabled();
});
