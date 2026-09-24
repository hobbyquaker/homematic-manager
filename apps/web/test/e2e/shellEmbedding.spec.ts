/**
 * Task 71: inside openccu-lite's shell - an iframe of the system's origin that the shell tells its
 * theme - the header leaves the user, the logout and the theme to the shell and follows the shell's
 * theme. The same page on its own (a tab, a CCU) keeps them. The shell is a stub page served on the
 * host's origin here, speaking the system's embedding contract: `theme` on the frame's URL and
 * `{type: "openccu-lite:theme", theme, lang}` posted to the frame.
 */

import {expect, simulatorReady, test} from './fixtures.js';

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
});

test("inside the shell the header drops user, logout and theme, and follows the shell's theme", async ({
    page,
    host,
}) => {
    await page.route(`${host.url}shell-stub.html`, (route) =>
        route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><title>shell</title><iframe id="addon" src="./?theme=dark&lang=en#/BidCos-RF/devices" style="width:1200px;height:700px"></iframe>',
        }),
    );
    await page.goto(`${host.url}shell-stub.html`);
    const frame = page.frameLocator('#addon');
    await expect(frame.getByTestId('settings-button')).toBeVisible();
    await expect(frame.getByTestId('theme-switch')).toHaveCount(0);
    await expect(frame.locator('html')).toHaveAttribute('data-theme', 'dark');

    // the shell switches: the page follows
    await page.evaluate(() => {
        const target = (document.getElementById('addon') as HTMLIFrameElement).contentWindow;
        target?.postMessage({type: 'openccu-lite:theme', theme: 'light', lang: 'en'}, location.origin);
    });
    await expect(frame.locator('html')).toHaveAttribute('data-theme', 'light');

    // the same address opened on its own - a tab of its own - keeps the theme switch
    await page.goto(`${host.url}?theme=dark&lang=en#/BidCos-RF/devices`);
    await expect(page.getByTestId('theme-switch')).toBeVisible();
    await expect(page.getByTestId('settings-button')).toBeVisible();
});
