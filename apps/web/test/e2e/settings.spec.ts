/**
 * "Settings" and the theme switch (D-22).
 *
 * No screenshots: what a theme has to guarantee is that the tokens change and that the elements
 * whose colour carries meaning keep their semantic class, and `packages/ui/src/theme.test.ts`
 * asserts exactly that against the stylesheet. What an e2e adds is that the switch is wired to the
 * document and to `localStorage` in a real browser, and that both themes actually paint.
 */

import type {Page} from '@playwright/test';

import {expect, simulatorReady, test} from './fixtures.js';

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
});

/** A theme token as the browser resolves it right now, as an `rgb()` string. */
async function tokenColor(page: Page, token: string): Promise<string> {
    return page.evaluate((name) => {
        const probe = document.createElement('span');
        probe.style.color = `var(${name})`;
        document.body.append(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return value;
    }, token);
}

/**
 * Task 32 (#149): the notice beside the buttons while "Save & Restart" rebuilds the connection. The
 * simulator reconnects in a few milliseconds, so the answer to `config.set` is held on the socket
 * until the notice has been looked at - on the reporter's CCU that wait was eleven seconds.
 */
test('the saving notice stands out while the connection is rebuilt', async ({page, host}, testInfo) => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    await page.routeWebSocket(/\/api(\?|$)/, (socket) => {
        const server = socket.connectToServer();
        const saves = new Set<number>();
        socket.onMessage((message) => {
            const frame = JSON.parse(String(message)) as {t?: string; id?: number; m?: string};
            if (frame.t === 'req' && frame.m === 'config.set' && typeof frame.id === 'number') {
                saves.add(frame.id);
            }
            server.send(message);
        });
        server.onMessage((message) => {
            const frame = JSON.parse(String(message)) as {id?: number};
            if (typeof frame.id === 'number' && saves.has(frame.id)) {
                void held.then(() => socket.send(message));
                return;
            }
            socket.send(message);
        });
    });

    await page.setViewportSize({width: 1280, height: 800});
    await page.goto(`${host.url}#/BidCos-RF/devices`);
    await expect(page.getByTestId('devices-table')).toBeVisible();
    await page.getByTestId('settings-button').click();
    const dialog = page.getByTestId('config-dialog');
    await expect(dialog).toHaveAttribute('open', '');
    await page.getByTestId('config-clear-cache').check();
    await page.getByTestId('config-save').click();

    const notice = page.getByTestId('config-saving');
    const spinner = page.getByTestId('config-saving-spinner');
    await expect(notice).toBeVisible();
    await expect(notice).toHaveText('Saving and reconnecting…');
    await expect(notice).toHaveAttribute('role', 'status');
    await expect(notice).toHaveAttribute('aria-live', 'polite');
    await expect(spinner).toBeVisible();
    await expect(page.getByTestId('config-save')).toBeDisabled();

    const paint = (): Promise<{background: string; border: string; text: string; spin: string}> =>
        Promise.all([
            notice.evaluate((element) => {
                const style = getComputedStyle(element);
                return {background: style.backgroundColor, border: style.borderTopColor, text: style.color};
            }),
            spinner.evaluate((element) => getComputedStyle(element).animationName),
        ]).then(([colours, spin]) => ({...colours, spin}));

    // light: an accent pill with the foreground on it, and the ring turning
    await page.emulateMedia({colorScheme: 'light', reducedMotion: 'no-preference'});
    const light = await paint();
    expect(light).toMatchObject({
        background: await tokenColor(page, '--hmm-accent-bg'),
        border: await tokenColor(page, '--hmm-accent'),
        text: await tokenColor(page, '--hmm-fg'),
    });
    expect(light.spin).not.toBe('none');
    await testInfo.attach('saving-notice-light', {body: await dialog.screenshot(), contentType: 'image/png'});

    // dark: the same roles with the dark tokens
    await page.emulateMedia({colorScheme: 'dark'});
    await expect.poll(async () => (await paint()).background).not.toBe(light.background);
    expect(await paint()).toMatchObject({
        background: await tokenColor(page, '--hmm-accent-bg'),
        border: await tokenColor(page, '--hmm-accent'),
        text: await tokenColor(page, '--hmm-fg'),
    });
    await testInfo.attach('saving-notice-dark', {body: await dialog.screenshot(), contentType: 'image/png'});

    // reduced motion: the ring stands still, the notice stays
    await page.emulateMedia({reducedMotion: 'reduce'});
    await expect.poll(async () => (await paint()).spin).toBe('none');
    await expect(spinner).toBeVisible();

    // a phone: the notice wraps with the button row and stays on the screen
    await page.emulateMedia({colorScheme: 'light', reducedMotion: 'no-preference'});
    await page.setViewportSize({width: 360, height: 640});
    const box = await notice.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
    expect(box!.y + box!.height).toBeLessThanOrEqual(640);
    await testInfo.attach('saving-notice-phone', {body: await page.screenshot(), contentType: 'image/png'});

    // the answer arrives: the dialog closes and the notice is gone with it
    release();
    await expect(dialog).not.toHaveAttribute('open');
    await expect(notice).toHaveCount(0);
    await expect(page.getByTestId('devices-table')).toBeVisible();
});

test('the settings dialog shows the live configuration and saves it', async ({page, host}) => {
    await page.goto(`${host.url}#/BidCos-RF/devices`);
    await expect(page.getByTestId('devices-table')).toBeVisible();

    await page.getByTestId('settings-button').click();
    const dialog = page.getByTestId('config-dialog');
    await expect(dialog).toHaveAttribute('open', '');
    await expect(page.getByTestId('config-host')).toHaveValue('127.0.0.1');

    // #149: nothing changed, nothing to save - the button is live only after an edit.
    await expect(page.getByTestId('config-save')).toBeDisabled();
    await page.getByTestId('config-clear-cache').check();
    await expect(page.getByTestId('config-save')).toBeEnabled();

    // Saving restarts the whole start-up sequence; the grid has to come back.
    await page.getByTestId('config-save').click();
    await expect(dialog).not.toHaveAttribute('open');
    await expect(page.getByTestId('devices-table')).toBeVisible();
    await expect(page.getByTestId('interface-select-summary')).toHaveAttribute('data-mark', 'ok');
});

/**
 * B-38: Escape closes a dialog on every tab. The row menu of the Devices and Links grids listened on
 * the window and took every Escape, so no dialog closed on it while one of those tabs was shown -
 * the settings dialog belongs to the App, not to either page, and was caught all the same.
 */
test('Escape closes the settings dialog on the Devices and the Links tab (B-38)', async ({page, host}) => {
    const dialog = page.getByTestId('config-dialog');
    for (const tab of ['devices', 'links'] as const) {
        await page.goto(`${host.url}#/BidCos-RF/${tab}`);
        await expect(page.getByTestId(`${tab}-table`)).toBeVisible();

        await page.getByTestId('settings-button').click();
        await expect(dialog).toHaveAttribute('open', '');
        await page.keyboard.press('Escape');
        await expect(dialog).not.toHaveAttribute('open');
        // the dialog gave the focus back to the button that opened it
        await expect(page.getByTestId('settings-button')).toBeFocused();
    }
});

/**
 * #135: an extra interface is offered in the interface list and ticked as soon as it has a name,
 * and it leaves the list with its row. Nothing is saved - the simulator has no CCU-Jack to connect.
 */
test('an extra interface is offered and ticked in the interface list once it has a name', async ({page, host}) => {
    await page.goto(`${host.url}#/BidCos-RF/devices`);
    await expect(page.getByTestId('devices-table')).toBeVisible();
    await page.getByTestId('settings-button').click();
    const dialog = page.getByTestId('config-dialog');
    await expect(dialog).toHaveAttribute('open', '');

    await page.getByTestId('config-extra-add').click();
    const row = page.getByTestId('config-extra-0');
    await row.getByLabel('Name 0').fill('CCU-Jack');

    const picker = dialog.getByRole('button', {name: 'Interfaces', exact: true});
    await expect(picker).toContainText('CCU-Jack');
    await picker.click();
    await expect(dialog.getByRole('option', {name: 'CCU-Jack'})).toHaveAttribute('aria-selected', 'true');
    await picker.click();

    await row.getByLabel('Remove 0').click();
    await expect(picker).not.toContainText('CCU-Jack');
    await picker.click();
    await expect(dialog.getByRole('option', {name: 'CCU-Jack'})).toHaveCount(0);
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
