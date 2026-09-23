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
 * lists the paramset and the interface describes it with parameters - and SERVICE never on a channel, which is the
 * maintainer's decision after the lab's answer.
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
    // a device whose SERVICE is listed and described empty
    expect(await offered(HMIP_BUTTON)).toEqual(['MASTER']);
    // channel 0 lists SERVICE and has it described - still no button on a channel
    expect(await offered(`${HMIP_DIMMER}:0`)).toEqual(['MASTER', 'VALUES']);
    // a channel that does not list it; LINK is the Links tab
    expect(await offered(`${HMIP_DIMMER}:3`)).toEqual(['MASTER', 'VALUES']);
    // another channel that lists it
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

/**
 * Task 67, the maintainer: the raw rows of the expert view were a box with its own scroller under the options - "just
 * list them and grow the dialog content so we only have one vertical scroller", and in the raw mode only the raw
 * values. The dialog's body is the one scroller; the option row stays at its top and the buttons at the bottom, at
 * 1280x800 and on a 412 px phone.
 */
for (const size of [
    {width: 1280, height: 800},
    {width: 412, height: 915},
]) {
    test(`the expert view is one scroller with the options and buttons in reach at ${size.width} px (task 67)`, async ({
        page,
        host,
    }) => {
        await page.setViewportSize(size);
        await page.goto(`${host.url}#/HmIP-RF/devices`);
        await page.locator(`[data-row-id="${HMIP_BUTTON}"]`).getByRole('button', {name: 'Expand row'}).click();
        await page.getByTestId(`paramset-${HMIP_BUTTON}:1-MASTER`).click();

        const dialog = page.getByTestId('paramset-dialog');
        await expect(page.getByTestId('paramset-easy-form')).toBeVisible();
        // the duration editor of task 10 is not shown beside the form that edits the same pair
        await expect(page.getByTestId('duration-REPEATED_LONG_PRESS_TIMEOUT')).toHaveCount(0);
        await page.getByTestId('paramset-expert').check();
        await expect(page.getByTestId('param-TEST_PARAMETER_59')).toBeAttached();
        // raw only: no form, no device editor
        await expect(page.getByTestId('paramset-easy-form')).toHaveCount(0);
        await expect(page.getByTestId('duration-REPEATED_LONG_PRESS_TIMEOUT')).toHaveCount(0);

        const scrollers = await dialog.evaluate((element) =>
            [element, ...element.querySelectorAll('*')]
                .filter(
                    (node) =>
                        ['auto', 'scroll'].includes(getComputedStyle(node).overflowY) &&
                        node.scrollHeight > node.clientHeight,
                )
                .map((node) => node.className),
        );
        expect(scrollers).toHaveLength(1);
        expect(scrollers[0]).toContain('hmm-dialog-body');

        const body = dialog.locator('.hmm-dialog-body');
        for (const where of ['middle', 'end'] as const) {
            await body.evaluate((element, to) => {
                element.scrollTop = to === 'end' ? element.scrollHeight : element.scrollHeight / 2;
            }, where);
            await expect(page.getByTestId('paramset-expert')).toBeInViewport();
            await expect(page.getByTestId('paramset-preview')).toBeInViewport();
        }
        await expect(page.getByTestId('param-TEST_PARAMETER_59')).toBeInViewport();
        const sideways = await body.evaluate((element) => element.scrollWidth > element.clientWidth);
        expect(sideways).toBe(false);
    });
}
