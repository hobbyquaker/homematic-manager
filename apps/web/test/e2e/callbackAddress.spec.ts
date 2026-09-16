/**
 * B-53 (#162, #165): with no callback address set, the settings dialog says which address is used
 * and why, and a saved address that is no address of this machine is replaced by the automatic one,
 * with a warning in the interface popup and in the dialog and a one-click way back to automatic.
 *
 * Its own host per test, not in `local` mode: on the CCU itself (`local`) nothing is second-guessed.
 * HmIP-RF alone, because the simulator's rfd speaks BIN-RPC only, which a remote host never uses
 * (D-28). The host's address list is the loopback (`startForTest`), so the CCU on 127.0.0.1 is
 * called back on the loopback and any other set address is "not on this machine".
 */

import {startForTest, type TestHost} from 'homematic-manager';

import {expect, SIMULATOR_FIXTURE, simulatorReady, test} from './fixtures.js';

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
});

function remoteHost(language: 'de' | 'en', ip: string): Promise<TestHost> {
    return startForTest({
        simulator: true,
        simulatorOptions: structuredClone(SIMULATOR_FIXTURE),
        connection: {
            local: false,
            interfaces: ['HmIP-RF'],
            language,
            callback: {ip, xmlrpcPort: 0, binrpcPort: 0},
        },
    });
}

const WORDS = {
    en: {
        auto: 'Automatic (127.0.0.1, the CCU is on this machine)',
        gone: 'The callback address 10.254.254.254 is not an address of this machine; 127.0.0.1 is used instead',
        use: 'Use automatic',
    },
    de: {
        auto: 'Automatisch (127.0.0.1, die CCU ist auf diesem Rechner)',
        gone: 'Die Callback-Adresse 10.254.254.254 ist keine Adresse dieses Rechners; stattdessen wird 127.0.0.1 verwendet',
        use: 'Automatisch verwenden',
    },
} as const;

for (const language of ['en', 'de'] as const) {
    test(`the settings dialog names the automatic callback address (${language})`, async ({page}) => {
        const host = await remoteHost(language, '');
        try {
            await page.goto(host.url);
            await expect(page.getByTestId('interface-select-summary')).toHaveAttribute('data-mark', 'ok');
            await expect(page.getByTestId('interface-select-callback-warning')).toHaveCount(0);

            await page.getByTestId('interface-select-trigger').click();
            await expect(page.getByTestId('interface-callback-HmIP-RF')).toHaveText(/^http:\/\/127\.0\.0\.1:\d+$/);
            await expect(page.getByTestId('interface-callback-warning')).toHaveCount(0);
            await page.keyboard.press('Escape');

            await page.getByTestId('settings-button').click();
            const dialog = page.getByTestId('config-dialog');
            const select = dialog.getByTestId('config-callback-ip');
            await expect(select).toHaveValue('');
            await expect(dialog.getByTestId('config-callback-ip-auto')).toHaveText(WORDS[language].auto);
            await expect(dialog.getByTestId('config-callback-ip-warning')).toHaveCount(0);
        } finally {
            await host.close();
        }
    });

    test(`a saved address that is not on this machine is replaced, said and undone in one click (${language})`, async ({
        page,
    }) => {
        const host = await remoteHost(language, '10.254.254.254');
        try {
            // the backend used the automatic address and says why
            const states = (await host.backend?.request('interfaces.list')) ?? [];
            expect(states.map((state) => state.callbackWarning)).toEqual([
                {address: '10.254.254.254', reason: 'notLocal', auto: '127.0.0.1'},
            ]);
            expect(states[0]?.callbackUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

            await page.goto(host.url);
            // events arrive on the automatic address: the interface is connected, not silent
            await expect(page.getByTestId('interface-select-summary')).toHaveAttribute('data-mark', 'ok');
            const mark = page.getByTestId('interface-select-callback-warning');
            await expect(mark).toHaveAttribute('title', WORDS[language].gone);

            // the dialog says the same about the saved address
            await page.getByTestId('settings-button').click();
            const dialog = page.getByTestId('config-dialog');
            await expect(dialog.getByTestId('config-callback-ip')).toHaveValue('10.254.254.254');
            await expect(dialog.getByTestId('config-callback-ip-warning')).toContainText(WORDS[language].gone);
            await expect(dialog.getByTestId('config-callback-ip-use-auto')).toHaveText(WORDS[language].use);
            await page.keyboard.press('Escape');
            await expect(dialog).toBeHidden();

            // and the popup's button saves "automatic"
            await page.getByTestId('interface-select-trigger').click();
            await expect(page.getByTestId('interface-callback-warning')).toContainText(WORDS[language].gone);
            await page.getByTestId('interface-callback-use-auto').click();
            await expect.poll(async () => (await host.backend?.request('config.get'))?.connection.callback.ip).toBe('');
            await expect(mark).toHaveCount(0);
            await expect(page.getByTestId('interface-select-summary')).toHaveAttribute('data-mark', 'ok');
        } finally {
            await host.close();
        }
    });
}
