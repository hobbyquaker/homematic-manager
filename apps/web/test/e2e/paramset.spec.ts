/**
 * "Paramset edit with preview and write" - the workflow the whole write-safety work of task 6 is
 * about. What matters here is not that a dialog opens but that **only the changed parameter**
 * reaches the interface process: the simulator's write log is the assertion.
 */

import {BIDCOS_SWITCH, HMIP_BUTTON, HMIP_DIMMER, expect, simulatorReady, test} from './fixtures.js';

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
});

test('the preview shows only what changed, and the write sends only that', async ({page, host, sim}) => {
    await page.goto(`${host.url}#/BidCos-RF/devices`);
    await page.locator(`[data-row-id="${BIDCOS_SWITCH}"]`).getByRole('button', {name: 'Expand row'}).click();
    // The PARAMSETS cell renders one inline button per paramset, testid `paramset-<addr>-<name>`.
    await page.getByTestId(`paramset-${BIDCOS_SWITCH}:1-MASTER`).click();

    await expect(page.getByTestId('paramset-dialog')).toHaveAttribute('open', '');
    await expect(page.getByTestId('param-TRANSMIT_TRY_MAX')).toBeVisible();
    await expect(page.getByTestId('param-LOGGING')).toBeVisible();

    await page.getByTestId('param-TRANSMIT_TRY_MAX').getByRole('spinbutton').fill('8');

    await page.getByTestId('paramset-preview').click();
    const preview = page.getByTestId('write-preview');
    await expect(preview).toHaveAttribute('open', '');
    await expect(page.getByTestId('preview-TRANSMIT_TRY_MAX')).toBeVisible();
    // LOGGING was not touched, so it must not be in the call at all (task 6: never widen a write)
    await expect(page.getByTestId('preview-LOGGING')).toHaveCount(0);
    await expect(page.getByTestId(`preview-call-${BIDCOS_SWITCH}:1`)).toBeVisible();

    await page.getByTestId('write-confirm').click();
    await expect(page.getByTestId('preview-results')).toContainText(`${BIDCOS_SWITCH}:1`);

    const master = sim.getWriteLog().filter((entry) => entry.paramset === 'MASTER');
    expect(master).toHaveLength(1);
    expect(master[0]?.address).toBe(`${BIDCOS_SWITCH}:1`);
    expect(master[0]?.values).toEqual({TRANSMIT_TRY_MAX: 8});
});

/**
 * B-33, the maintainer: "service paramset buttons are shown for channels. but afaik the service paramsets only exists
 * for devices!" - and then "i think they are empty". The lab showed otherwise (hmipserver lists SERVICE on most HmIP
 * channels and fills it), and showed what is empty: the MASTER of every HmIP device. A button is there when the row
 * lists the paramset and the interface describes it with parameters.
 */
test('the PARAMSETS buttons follow what each row lists and the interface describes (B-33)', async ({page, host}) => {
    await page.goto(`${host.url}#/HmIP-RF/devices`);
    const table = page.getByTestId('devices-table');
    for (const device of [HMIP_DIMMER, HMIP_BUTTON]) {
        await table.locator(`[data-row-id="${device}"]`).getByRole('button', {name: 'Expand row'}).click();
    }
    const offered = async (address: string): Promise<string[]> => {
        const cell = page.getByTestId(`paramsets-${address}`);
        await expect(cell).toHaveAttribute('aria-busy', 'false');
        return cell.getByRole('button').allTextContents();
    };

    // the device: SERVICE has parameters, MASTER is empty
    expect(await offered(HMIP_DIMMER)).toEqual(['SERVICE']);
    // a channel that lists SERVICE and has it described
    expect(await offered(`${HMIP_DIMMER}:0`)).toEqual(['MASTER', 'VALUES', 'SERVICE']);
    // a channel that does not list it; LINK is the Links tab
    expect(await offered(`${HMIP_DIMMER}:3`)).toEqual(['MASTER', 'VALUES']);
    // a channel that lists it, described empty
    expect(await offered(`${HMIP_BUTTON}:1`)).toEqual(['MASTER', 'VALUES']);

    await page.getByTestId(`paramset-${HMIP_DIMMER}-SERVICE`).click();
    await expect(page.getByTestId('paramset-dialog')).toHaveAttribute('open', '');
    await expect(page.getByTestId('param-APPLICATION_VERSION')).toBeVisible();
});

test('nothing changed means nothing is written', async ({page, host, sim}) => {
    await page.goto(`${host.url}#/BidCos-RF/devices`);
    await page.locator(`[data-row-id="${BIDCOS_SWITCH}"]`).getByRole('button', {name: 'Expand row'}).click();
    await page.getByTestId(`paramset-${BIDCOS_SWITCH}:1-MASTER`).click();

    await page.getByTestId('paramset-preview').click();
    await expect(page.getByTestId('preview-empty')).toBeVisible();
    await expect(page.getByTestId('write-confirm')).toBeDisabled();
    expect(sim.getWriteLog()).toEqual([]);
});
