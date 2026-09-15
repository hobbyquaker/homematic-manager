/**
 * Task 47: the tiny copy button of the name and address cells, with the real clipboard of the
 * browser. The Devices tab stands in for the look and the full value of a cut-off cell, the Funk
 * grid for a row whose own double click opens a dialog and for the keyboard; the fallback runs with
 * the Clipboard API taken away, as on the addon over plain HTTP.
 *
 * Chromium hands a page the clipboard only when it is granted, so the file asks for it once.
 */

import type {Locator, Page} from '@playwright/test';

import {BIDCOS_SWITCH, HMIP_BUTTON, expect, simulatorReady, test} from './fixtures.js';

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
});

test.use({permissions: ['clipboard-read', 'clipboard-write']});

function clipboardText(page: Page): Promise<string> {
    return page.evaluate(() => navigator.clipboard.readText());
}

async function widthOf(locator: Locator): Promise<number> {
    const box = await locator.boundingBox();
    return Math.round(box?.width ?? 0);
}

/** Presses the handle, moves the mouse by `dx` in steps, as a hand would, and lets go. */
async function drag(page: Page, handle: Locator, dx: number): Promise<void> {
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();
    const x = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx / 2, y, {steps: 6});
    await page.mouse.move(x + dx, y, {steps: 6});
    await page.mouse.up();
}

test('the copy button puts the full name of a cut-off cell and the address on the clipboard, and leaves row and column alone', async ({
    page,
    host,
}) => {
    await page.goto(`${host.url}#/HmIP-RF/devices`);
    const table = page.getByTestId('devices-table');
    const row = table.locator(`[data-row-id="${HMIP_BUTTON}"]`);
    await expect(row).toContainText('Wandtaster');

    // the name cut off, as in columns.spec
    await drag(page, table.getByTestId('devices-table-resize-name'), -600);
    const nameCell = row.locator('.hmm-td[data-column-key="name"]');
    const cutOff = (): Promise<boolean> => nameCell.evaluate((cell) => cell.scrollWidth > cell.clientWidth);
    await expect.poll(cutOff).toBe(true);
    const nameHeader = table.getByRole('columnheader', {name: 'Name', exact: true});
    const width = await widthOf(nameHeader);

    const copyName = row.getByRole('button', {name: 'Copy name'});
    await expect(copyName).toHaveCSS('opacity', '0');
    await row.locator('.hmm-td[data-column-key="TYPE"]').hover();
    await expect(copyName).toHaveCSS('opacity', '1');
    // shown, it takes no room: the column and what is cut off of the name stay as they were
    expect(await widthOf(nameHeader)).toBe(width);
    expect(await cutOff()).toBe(true);
    const cellBox = (await nameCell.boundingBox())!;
    const buttonBox = (await copyName.boundingBox())!;
    expect(Math.round(buttonBox.width)).toBe(16);
    expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(cellBox.x + cellBox.width);

    await copyName.click();
    await expect.poll(() => clipboardText(page)).toBe('Wandtaster');
    await expect(page.getByTestId('devices-table-copied')).toHaveText('Copied');
    await expect(row).toHaveAttribute('aria-selected', 'false');

    // two clicks on it copy twice and open no rename dialog (task 46)
    await copyName.dblclick();
    await expect(page.getByTestId('rename-dialog')).not.toHaveAttribute('open');
    await expect(row).toHaveAttribute('aria-selected', 'false');

    await row.getByRole('button', {name: 'Copy address'}).click();
    await expect.poll(() => clipboardText(page)).toBe(HMIP_BUTTON);
    expect(await widthOf(nameHeader)).toBe(width);
});

test('in the Funk grid Tab reaches the row’s buttons, Enter and Space copy, and neither they nor a double click open the row’s dialog', async ({
    page,
    host,
}) => {
    await page.goto(`${host.url}#/BidCos-RF/rssi`);
    const table = page.getByTestId('radio-table');
    const row = table.locator(`[data-row-id="${BIDCOS_SWITCH}"]`);
    await expect(row).toContainText('Steckdose');
    const dialog = page.getByTestId('set-interface-dialog');
    const typeCell = row.locator('.hmm-td[data-column-key="TYPE"]');

    await typeCell.click();
    await expect(row).toHaveAttribute('aria-selected', 'true');
    // the Funk grid's rows open their peers: the row's expander comes first, then its copy buttons
    await page.keyboard.press('Tab');
    await expect(row.getByRole('button', {name: 'Expand row'})).toBeFocused();
    await page.keyboard.press('Tab');
    const copyName = row.getByRole('button', {name: 'Copy name'});
    await expect(copyName).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(() => clipboardText(page)).toBe('Steckdose');

    await page.keyboard.press('Tab');
    await expect(row.getByRole('button', {name: 'Copy address'})).toBeFocused();
    await page.keyboard.press('Space');
    await expect.poll(() => clipboardText(page)).toBe(BIDCOS_SWITCH);
    await expect(dialog).toBeHidden();
    await expect(row).toHaveAttribute('aria-selected', 'true');

    await copyName.dblclick();
    await expect(dialog).toBeHidden();
    // the row's own double click still opens setBidcosInterface
    await typeCell.dblclick();
    await expect(dialog).toBeVisible();
});

test('without the Clipboard API, as on the addon over plain HTTP, the button copies through a selected text field', async ({
    page,
    host,
}) => {
    await page.addInitScript(() => {
        const real = navigator.clipboard;
        const copies: string[] = [];
        Object.defineProperty(window, 'e2eClipboard', {value: {real, copies}});
        Object.defineProperty(Navigator.prototype, 'clipboard', {get: () => undefined, configurable: true});
        // the copy command fires `copy` on the selection's element; the Clipboard API fires none
        document.addEventListener('copy', (event) => {
            copies.push((event.target as HTMLElement).tagName);
        });
    });
    await page.goto(`${host.url}#/BidCos-RF/devices`);
    const row = page.getByTestId('devices-table').locator(`[data-row-id="${BIDCOS_SWITCH}"]`);
    await expect(row).toContainText('Steckdose');
    expect(await page.evaluate(() => navigator.clipboard === undefined)).toBe(true);

    const copyAddress = row.getByRole('button', {name: 'Copy address'});
    await copyAddress.click();

    await expect(page.getByTestId('devices-table-copied')).toHaveText('Copied');
    type Watch = {e2eClipboard: {real: Clipboard; copies: string[]}};
    expect(await page.evaluate(() => (window as unknown as Watch).e2eClipboard.copies)).toEqual(['TEXTAREA']);
    await expect
        .poll(() => page.evaluate(() => (window as unknown as Watch).e2eClipboard.real.readText()))
        .toBe(BIDCOS_SWITCH);
    // the field is gone and the focus is back on the button
    await expect(page.locator('textarea')).toHaveCount(0);
    await expect(copyAddress).toBeFocused();
    await expect(row).toHaveAttribute('aria-selected', 'false');
});

test.describe('on a touch screen (task 47)', () => {
    test.use({hasTouch: true});

    test('the button is there without a hover, and a tap on it copies without selecting the row', async ({
        page,
        host,
    }) => {
        await page.goto(`${host.url}#/BidCos-RF/devices`);
        const row = page.getByTestId('devices-table').locator(`[data-row-id="${BIDCOS_SWITCH}"]`);
        await expect(row).toContainText('Steckdose');
        expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);

        const copyName = row.getByRole('button', {name: 'Copy name'});
        await expect(copyName).toHaveCSS('opacity', '1');
        expect(Math.round((await copyName.boundingBox())!.width)).toBe(22);

        await copyName.tap();
        await expect.poll(() => clipboardText(page)).toBe('Steckdose');
        await expect(row).toHaveAttribute('aria-selected', 'false');
        await expect(page.getByTestId('rename-dialog')).not.toHaveAttribute('open');
    });
});
