/**
 * "RPC console call". The console is the escape hatch of 2.7: any method of the interface process,
 * with a form generated from the method catalogue. This spec drives one read call end to end and
 * checks that the argument form really built the tuple that went on the wire - and, since task 48,
 * that the call is in the global RPC log with every other outgoing call, that the console has no
 * history of its own, and that a logged call can be opened in the console again.
 */

import type {Locator, Page, TestInfo} from '@playwright/test';

import {HMIP_DIMMER, expect, simulatorReady, test} from './fixtures.js';

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
});

async function boxOf(locator: Locator): Promise<{x: number; y: number; width: number; height: number}> {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    return box!;
}

/** Neither the document nor the console's own page scrolls: only the columns inside it may. */
async function expectNoPageScroll(page: Page): Promise<void> {
    const scrolls = await page.getByTestId('console-output').evaluate((column) => {
        const own = column.closest('.hmm-page');
        const root = document.scrollingElement ?? document.documentElement;
        return {
            document: root.scrollHeight > root.clientHeight,
            page: own === null ? true : own.scrollHeight > own.clientHeight,
        };
    });
    expect(scrolls).toEqual({document: false, page: false});
}

/** Light and dark, attached to the report for a human to look at - not compared (see README.md). */
async function attachThemes(page: Page, testInfo: TestInfo, name: string): Promise<void> {
    await page.emulateMedia({colorScheme: 'light'});
    await testInfo.attach(`${name}-light`, {body: await page.screenshot(), contentType: 'image/png'});
    await page.emulateMedia({colorScheme: 'dark'});
    await testInfo.attach(`${name}-dark`, {body: await page.screenshot(), contentType: 'image/png'});
    await page.emulateMedia({colorScheme: 'light'});
}

async function openConsole(page: Page, url: string): Promise<Locator> {
    await page.goto(`${url}#/HmIP-RF/console`);
    const method = page.getByTestId('console-method');
    // The list is what the interface process answered to `system.listMethods`, so it arrives late.
    await expect(method.locator('option')).not.toHaveCount(1);
    return method;
}

/** The rows of the RPC log drawer for one interface and method, the drawer opened if it is not. */
async function logEntries(page: Page, text: string): Promise<Locator> {
    if ((await page.getByTestId('rpclog').count()) === 0) {
        await page.getByTestId('rpclog-toggle').click();
    }
    return page.getByTestId('rpclog').locator('.hmm-rpclog-entry', {hasText: text});
}

test('a method is chosen, its arguments filled in, the answer shown and the call logged', async ({page, host}) => {
    const method = await openConsole(page, host.url);

    await method.selectOption('getDeviceDescription');
    await expect(page.getByTestId('arg-address')).toBeVisible();
    await page.locator('#arg-input-address').fill(HMIP_DIMMER);

    // `console-params` is an <output>: it shows the exact tuple the call will send.
    await expect(page.getByTestId('console-params')).toHaveText(`getDeviceDescription("${HMIP_DIMMER}")`);

    await page.getByTestId('console-send-button').click();

    // a <textarea>: the answer is its *value*, its text content stays the empty initial one
    await expect(page.getByTestId('console-response')).toHaveValue(/HmIP-PDT/);
    await expect(page.getByTestId('console-error')).toHaveCount(0);

    // task 48: no history under the response - the call is in the global RPC log, as the console's
    await expect(page.getByTestId('console-history')).toHaveCount(0);
    const logged = await logEntries(page, 'HmIP-RF getDeviceDescription');
    await expect(logged).toHaveCount(1);
    await expect(logged.locator('.hmm-rpclog-params')).toHaveText(HMIP_DIMMER);
    await expect(logged.locator('.hmm-rpclog-origin')).toHaveText('console');
    await expect(logged.locator('.hmm-rpclog-status')).toContainText('HmIP-PDT');
});

test('a fault is shown in the response and never as a toast', async ({page, host}) => {
    const method = await openConsole(page, host.url);

    await method.selectOption('getDeviceDescription');
    await page.locator('#arg-input-address').fill('NO-SUCH-DEVICE');
    await page.getByTestId('console-send-button').click();

    await expect(page.getByTestId('console-error')).toBeVisible();
    // A console fault is an answer the user asked for, not an application error: no notice pops up.
    await expect(page.getByTestId('notices')).toBeEmpty();
    // and the fault is in the log, marked as one
    const logged = await logEntries(page, 'HmIP-RF getDeviceDescription');
    await expect(logged).toHaveClass(/hmm-rpclog-failed/);
});

/**
 * Task 48: the backend's own calls are in the log too - the `init` and the `listDevices` sweep of
 * the connection here; the keep-alive `ping` would be, but the test host runs without the
 * watchdog - and they can be hidden without leaving the log.
 */
test('the background calls are in the global log with their origin, and can be hidden', async ({page, host}) => {
    await openConsole(page, host.url);
    await page.getByTestId('rpclog-toggle').click();
    const drawer = page.getByTestId('rpclog');
    const background = drawer.locator('.hmm-rpclog-entry[data-origin="background"]');
    await expect(background.first()).toBeVisible();
    const init = await logEntries(page, 'HmIP-RF init');
    await expect(init.first().locator('.hmm-rpclog-origin')).toHaveText('background');
    await expect(init.first().locator('.hmm-rpclog-params')).toContainText('hmm_HmIP-RF');
    await expect(drawer.locator('.hmm-rpclog-entry', {hasText: 'HmIP-RF listDevices'}).first()).toBeVisible();

    await page.getByTestId('rpclog-hide-background').check();
    await expect(background).toHaveCount(0);
    await page.getByTestId('rpclog-hide-background').uncheck();
    await expect(background.first()).toBeVisible();
});

test('"open in console" puts a logged call back into the form', async ({page, host}) => {
    const method = await openConsole(page, host.url);
    await method.selectOption('getDeviceDescription');
    await page.locator('#arg-input-address').fill(HMIP_DIMMER);
    await page.getByTestId('console-send-button').click();
    await expect(page.getByTestId('console-response')).toHaveValue(/HmIP-PDT/);

    // somewhere else entirely, with the drawer open
    await page.goto(`${host.url}#/HmIP-RF/devices`);
    await expect(page.getByTestId('devices-table')).toBeVisible();
    const logged = await logEntries(page, 'HmIP-RF getDeviceDescription');
    await logged.first().getByRole('button', {name: 'Open in console: getDeviceDescription'}).click();

    await expect(page).toHaveURL(/#\/HmIP-RF\/console$/);
    await expect(page.getByTestId('console-params')).toHaveText(`getDeviceDescription("${HMIP_DIMMER}")`);
    await expect(page.getByTestId('console-method')).toHaveValue('getDeviceDescription');
    // the drawer is still there: the call gets sent and looked at again
    await expect(page.getByTestId('rpclog')).toBeVisible();
    await page.getByTestId('console-send-button').click();
    await expect(page.getByTestId('console-response')).toHaveValue(/HmIP-PDT/);
});

/**
 * Task 37: the response takes the height the column has. It was a 220 px box with a 200 px history
 * under it, and everything below that stayed empty however tall the window was. Task 48: the
 * history is gone, so the response has the whole column.
 */
for (const size of [
    {width: 1280, height: 800},
    {width: 1920, height: 1080},
]) {
    test(`the response fills the column at ${String(size.width)}x${String(size.height)}`, async ({
        page,
        host,
    }, testInfo) => {
        await page.setViewportSize(size);
        const method = await openConsole(page, host.url);
        const column = page.getByTestId('console-output');
        const response = page.getByTestId('console-response');

        // one heading in the column - "Response" - and no list under the field
        await expect(column.locator('h3')).toHaveCount(1);
        // measured with the method chosen: its help text below the columns is part of the layout
        // (`getInstallMode` takes no argument), and it is the same before and after the calls
        await method.selectOption('getInstallMode');
        await expect(page.getByTestId('console-help-section')).toBeVisible();
        const emptyResponse = await boxOf(response);
        const emptyColumn = await boxOf(column);
        // far more than the 220 px it used to be, on either window
        expect(emptyResponse.height).toBeGreaterThan(size.height / 2);
        expect(
            Math.abs(emptyResponse.y + emptyResponse.height - (emptyColumn.y + emptyColumn.height)),
        ).toBeLessThanOrEqual(3);

        // ten calls change nothing about the layout
        for (let call = 1; call <= 10; call += 1) {
            await page.getByTestId('console-send-button').click();
            await expect(response).toHaveValue(/\d/);
        }
        const logged = await logEntries(page, 'HmIP-RF getInstallMode');
        await expect(logged).toHaveCount(10);
        await page.getByTestId('rpclog').getByRole('button', {name: 'Close'}).click();

        const filled = await boxOf(response);
        expect(Math.abs(filled.height - emptyResponse.height)).toBeLessThanOrEqual(3);

        await expectNoPageScroll(page);
        await attachThemes(page, testInfo, `console-${String(size.width)}`);
    });
}

test('a long help text scrolls on its own and leaves the response its floor', async ({page, host}, testInfo) => {
    // hm-simulator's help texts are one line each, so the answer to `rpc.methods` gets a long one
    const LONG_HELP = Array.from({length: 120}, (_entry, index) => `Sentence ${String(index)} of the help.`).join(' ');
    await page.routeWebSocket(/\/api(\?|$)/, (socket) => {
        const server = socket.connectToServer();
        const methodRequests = new Set<number>();
        socket.onMessage((message) => {
            const frame = JSON.parse(String(message)) as {t?: string; id?: number; m?: string};
            if (frame.t === 'req' && frame.m === 'rpc.methods' && typeof frame.id === 'number') {
                methodRequests.add(frame.id);
            }
            server.send(message);
        });
        server.onMessage((message) => {
            const frame = JSON.parse(String(message)) as {t?: string; id?: number; r?: unknown};
            if (frame.t === 'res' && frame.id !== undefined && methodRequests.has(frame.id) && Array.isArray(frame.r)) {
                frame.r = (frame.r as {name: string; help?: string}[]).map((entry) =>
                    entry.name === 'getDeviceDescription' ? {...entry, help: LONG_HELP} : entry,
                );
                socket.send(JSON.stringify(frame));
                return;
            }
            socket.send(message);
        });
    });

    await page.setViewportSize({width: 1280, height: 800});
    const method = await openConsole(page, host.url);
    await method.selectOption('getDeviceDescription');
    const help = page.getByTestId('console-help-section');
    await expect(page.getByTestId('console-help')).toContainText('Sentence 119');

    // the help is capped at a quarter of the window and scrolls inside that
    expect((await boxOf(help)).height).toBeLessThanOrEqual(800 / 4 + 1);
    expect(await help.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    // the response keeps more than its floor, and the columns end above the help
    const response = await boxOf(page.getByTestId('console-response'));
    expect(response.height).toBeGreaterThanOrEqual(120);
    const column = await boxOf(page.getByTestId('console-output'));
    expect(column.y + column.height).toBeLessThanOrEqual((await boxOf(help)).y);

    await expectNoPageScroll(page);
    await attachThemes(page, testInfo, 'console-long-help');
});
