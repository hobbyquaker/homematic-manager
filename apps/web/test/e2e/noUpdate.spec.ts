/**
 * Task 54: the UI the web host serves - in the CCU addon, on openccu-lite, on any server - offers no
 * update of its own. The update strip (`UpdateNotice.svelte`, B-47, task 53) is Electron's: without
 * a host bridge it draws nothing, so no "Download", no "Install on quit", no error line and no link
 * to the releases. On openccu-lite the box updates its addons (openccu-lite task 140); on a CCU the
 * WebUI's Zusatzsoftware page does.
 *
 * The host here is served under `/addons/hmm/` as the addon's rc.d starts it; `startForTest` already
 * configures the addon's `local` mode on 127.0.0.1. Passing `ccu` and `local` to the host as well
 * made the backend try the real loopback ports before the simulator's were set, 15 s per run.
 */

import {startForTest, type TestHost} from 'homematic-manager';
import {HMIP_DIMMER, SIMULATOR_FIXTURE, expect, simulatorReady, test} from './fixtures.js';

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
});

test('the addon-mode UI has no host bridge and draws no update strip', async ({page}) => {
    const host: TestHost = await startForTest({
        simulator: true,
        simulatorOptions: structuredClone(SIMULATOR_FIXTURE),
        connection: {rega: true, language: 'en'},
        base: '/addons/hmm/',
    });
    try {
        expect(host.url).toMatch(/\/addons\/hmm\/$/);
        await page.goto(`${host.url}#/HmIP-RF/devices`);

        await expect(page.getByTestId('app')).toBeVisible();
        await expect(page.getByTestId('loader')).toBeHidden();
        // the whole app is up - the backend reached the interfaces and the grid is filled - so a
        // strip that were to come would have come by now
        await expect(page.getByTestId('interface-select-summary')).toHaveAttribute('data-mark', 'ok');
        await expect(page.locator(`[data-row-id="${HMIP_DIMMER}"]`)).toBeVisible();

        expect(await page.evaluate(() => '__HMM_HOST__' in window)).toBe(false);
        await expect(page.getByTestId('update-notice')).toHaveCount(0);
        await expect(page.locator('.hmm-update')).toHaveCount(0);
        for (const id of ['update-download', 'update-install', 'update-dismiss', 'update-releases']) {
            await expect(page.getByTestId(id)).toHaveCount(0);
        }

        // nor in the settings dialog, where the version is shown
        await page.getByTestId('settings-button').click();
        const dialog = page.getByTestId('config-dialog');
        await expect(dialog).toHaveAttribute('open', '');
        await expect(dialog.getByRole('button', {name: /update|download|install/i})).toHaveCount(0);
        await expect(dialog.getByRole('link', {name: /update|download|release/i})).toHaveCount(0);
    } finally {
        await host.close();
    }
});
