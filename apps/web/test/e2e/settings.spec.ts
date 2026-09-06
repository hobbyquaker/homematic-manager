/**
 * "Settings" and the theme switch (D-22).
 *
 * No screenshots: what a theme has to guarantee is that the tokens change and that the elements
 * whose colour carries meaning keep their semantic class, and `packages/ui/src/theme.test.ts`
 * asserts exactly that against the stylesheet. What an e2e adds is that the switch is wired to the
 * document and to `localStorage` in a real browser, and that both themes actually paint.
 */

import {expect, simulatorReady, test} from './fixtures.js';

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
});

test('the settings dialog shows the live configuration and saves it', async ({page, host}) => {
    await page.goto(`${host.url}#/BidCos-RF/devices`);
    await expect(page.getByTestId('devices-table')).toBeVisible();

    await page.getByTestId('settings-button').click();
    const dialog = page.getByTestId('config-dialog');
    await expect(dialog).toHaveAttribute('open', '');
    await expect(page.getByTestId('config-host')).toHaveValue('127.0.0.1');

    // Saving restarts the whole start-up sequence; the grid has to come back.
    await page.getByTestId('config-save').click();
    await expect(dialog).not.toHaveAttribute('open');
    await expect(page.getByTestId('devices-table')).toBeVisible();
    await expect(page.getByTestId('interface-select-summary')).toHaveAttribute('data-mark', 'ok');
});

test('the theme switch cycles system, light and dark and remembers the choice', async ({page, host}) => {
    await page.goto(host.url);
    await expect(page.getByTestId('app')).toBeVisible();

    const html = page.locator('html');
    const switcher = page.getByTestId('theme-switch');
    const background = (): Promise<string> => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    // `system` sets no attribute at all, so the media query decides.
    await expect(html).not.toHaveAttribute('data-theme');

    await switcher.click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    const light = await background();

    await switcher.click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    const dark = await background();
    // Both themes really paint, and they paint differently (D-22).
    expect(dark).not.toBe(light);

    await switcher.click();
    await expect(html).not.toHaveAttribute('data-theme');
    expect(await page.evaluate(() => localStorage.getItem('hmm.theme'))).toBe('system');

    // and the choice survives a reload
    await switcher.click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'light');
});
