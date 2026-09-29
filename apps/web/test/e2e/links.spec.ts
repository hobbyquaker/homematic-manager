/**
 * "Links": add, edit the link paramset, remove. Three workflows in one file because they are one
 * story - a link that is not created cannot be edited, and one that is not removed leaves the next
 * test a grid that is not empty.
 *
 * The pair is the HmIP wall button (`KEY_TRANSCEIVER`, `LINK_SOURCE_ROLES: SWITCH`) and the HmIP
 * dimmer's virtual receiver (`SWITCH_VIRTUAL_RECEIVER`, `LINK_TARGET_ROLES: SWITCH`); the role
 * matrix is what decides that these two may be linked and the BidCos actor may not.
 */

import type {Locator} from '@playwright/test';

import {HMIP_BUTTON, HMIP_DIMMER, expect, simulatorReady, test} from './fixtures.js';
import {expectPrimaryToolbarButton} from './primaryButton.js';

const SENDER = `${HMIP_BUTTON}:1`;
const RECEIVER = `${HMIP_DIMMER}:3`;
const LINK_ROW = `${SENDER}->${RECEIVER}`;

test.beforeAll(async () => {
    test.skip(!(await simulatorReady()), 'hm-simulator is not installed');
});

test('a link is created, its paramset written and the link removed again', async ({page, host, sim}) => {
    await page.goto(`${host.url}#/HmIP-RF/links`);
    await expect(page.getByTestId('links-table')).toBeVisible();
    await expect(page.locator(`[data-row-id="${LINK_ROW}"]`)).toHaveCount(0);

    /* --- add --------------------------------------------------------------------------- */

    await page.getByTestId('links-add').click();
    await expect(page.getByTestId('add-link-dialog')).toHaveAttribute('open', '');

    const senders = page.getByTestId('add-link-senders');
    const sendersToggle = senders.getByRole('button').first();
    await sendersToggle.click();
    // Since task 31 an entry prints names, not the address; the filter still finds the address.
    await pickByAddress(senders, SENDER);
    // A multi-select popup stays open after a pick, and it covers the row below it - so it has to
    // be closed before the receiver picker can be clicked at all.
    await sendersToggle.click();
    await expect(sendersToggle).toHaveAttribute('aria-expanded', 'false');

    // The receiver picker is disabled until a sender exists: the offered receivers are the ones the
    // role matrix allows for *that* sender.
    const receivers = page.getByTestId('add-link-receivers');
    const receiversToggle = receivers.getByRole('button').first();
    await receiversToggle.click();
    await pickByAddress(receivers, RECEIVER);
    await receiversToggle.click();

    await page.getByTestId('add-link-create').click();
    await expect(page.getByTestId('add-link-dialog')).not.toHaveAttribute('open');

    await page.getByTestId('links-refresh').click();
    const row = page.locator(`[data-row-id="${LINK_ROW}"]`);
    await expect(row).toBeVisible();
    expect(sim.getLinks('hmip', [])).toHaveLength(1);

    /* --- edit -------------------------------------------------------------------------- */

    await row.click();
    await page.getByTestId('links-edit').click();
    const editor = page.getByTestId('link-paramset-dialog');
    await expect(editor).toHaveAttribute('open', '');
    // the receiver's field: since task 80 the sender's parameters are open too, and the button has its own
    const receiverOnTime = page.getByTestId('link-receiver-params').getByTestId('param-SHORT_ON_TIME');
    await expect(receiverOnTime).toBeVisible();

    await page.getByTestId('link-name').fill('Button to dimmer');
    await page.getByTestId('link-description').fill('short press');
    await page.getByTestId('link-info-save').click();

    await receiverOnTime.getByRole('spinbutton').fill('12');
    await page.getByTestId('link-preview').click();
    await expect(page.getByTestId('write-preview')).toHaveAttribute('open', '');
    await expect(page.getByTestId('preview-SHORT_ON_TIME')).toBeVisible();
    await page.getByTestId('write-confirm').click();
    await expect(page.getByTestId('link-results')).toBeVisible();

    // The LINK paramset of a link is stored under the peer's address, not under a paramset name.
    // The value has to arrive as the float it is: until task 19 the dialog cast it into
    // `{explicitDouble: 12}` and the backend cast that a second time into `0`, so every float in a
    // paramset write reached the interface process as zero.
    const linkWrites = sim.getWriteLog().filter((entry) => entry.values['SHORT_ON_TIME'] !== undefined);
    expect(linkWrites.length).toBeGreaterThan(0);
    expect(linkWrites.at(-1)?.values['SHORT_ON_TIME']).toBe(12);

    // The preview closes itself once the write succeeded and the read-back agrees with it; only
    // the editor underneath is left to close.
    await expect(page.getByTestId('write-preview')).not.toHaveAttribute('open');
    await editor.getByRole('button', {name: 'Close'}).first().click();
    await expect(editor).not.toHaveAttribute('open');

    /* --- remove ------------------------------------------------------------------------ */

    await row.click();
    await page.getByTestId('links-delete').click();
    const remove = page.getByTestId('remove-link-dialog');
    await expect(remove).toContainText(SENDER);
    await page.getByTestId('remove-link-confirm').click();
    await expect(remove).not.toHaveAttribute('open');

    await page.getByTestId('links-refresh').click();
    await expect(page.locator(`[data-row-id="${LINK_ROW}"]`)).toHaveCount(0);
});

/** Types the address into an open picker's filter, expects exactly one entry and chooses it. */
async function pickByAddress(picker: Locator, address: string): Promise<void> {
    await picker.getByLabel('Filter').fill(address);
    await expect(picker.getByRole('option')).toHaveCount(1);
    await picker.getByRole('option').click();
    await picker.getByLabel('Filter').fill('');
}

/** `inner` is drawn inside `outer`, and `outer` did not have to scroll to show it. */
async function expectInside(inner: Locator, outer: Locator): Promise<void> {
    const a = await inner.boundingBox();
    const b = await outer.boundingBox();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.y).toBeGreaterThanOrEqual(b!.y - 1);
    expect(a!.y + a!.height).toBeLessThanOrEqual(b!.y + b!.height + 1);
    expect(a!.x + a!.width).toBeLessThanOrEqual(b!.x + b!.width + 1);
    expect(await outer.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true);
}

/**
 * The dialog body holds its content and nothing more: no scrollbar, and no empty band under the
 * last row down to the buttons (task 81).
 */
async function expectFitsContent(dialog: Locator): Promise<void> {
    const gap = await dialog.locator('.hmm-dialog-body').evaluate((body) => {
        const style = getComputedStyle(body);
        const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        const content = [...body.children].reduce((sum, child) => sum + (child as HTMLElement).offsetHeight, 0);
        return {slack: body.clientHeight - padding - content, scrolls: body.scrollHeight > body.clientHeight};
    });
    expect(gap.scrolls).toBe(false);
    expect(gap.slack).toBeLessThanOrEqual(12);
}

/**
 * Task 30 made room for the channel lists with a fixed floor: at least 650 px tall and 920 px wide,
 * which left the dialog empty down to the buttons (task 81). Now it is as tall as its content, grows
 * while a list is open (the lists are inline, not floating), is a form's width, and the name and
 * the description take the row's free width; on a phone the window bounds it and the buttons stay on
 * the screen.
 */
test('the create-link dialog fits its content, grows with an open list, and fits a phone (task 81)', async ({
    page,
    host,
}) => {
    await page.setViewportSize({width: 1280, height: 800});
    await page.goto(`${host.url}#/HmIP-RF/links`);
    await page.getByTestId('links-add').click();
    const dialog = page.getByTestId('add-link-dialog');
    await expect(dialog).toHaveAttribute('open', '');
    const closed = (await dialog.boundingBox())!;
    expect(closed.height).toBeLessThan(300);
    expect(closed.width).toBeGreaterThanOrEqual(600);
    expect(closed.width).toBeLessThanOrEqual(760);
    await expectFitsContent(dialog);
    const body = dialog.locator('.hmm-dialog-body');

    const senders = page.getByTestId('add-link-senders');
    const sendersToggle = senders.getByRole('button').first();
    const before = (await sendersToggle.boundingBox())!;
    await sendersToggle.click();
    await expectInside(senders.locator('.hmm-multiselect-menu'), body);
    expect((await dialog.boundingBox())!.height).toBeGreaterThan(closed.height + 40);
    // it grows downwards: the button just clicked stays under the pointer
    expect((await sendersToggle.boundingBox())!.y).toBeCloseTo(before.y, 0);
    await pickByAddress(senders, SENDER);
    await sendersToggle.click();

    const receivers = page.getByTestId('add-link-receivers');
    const receiversToggle = receivers.getByRole('button').first();
    await receiversToggle.click();
    await expect(receivers.getByRole('option').first()).toBeVisible();
    await expectInside(receivers.locator('.hmm-multiselect-menu'), body);
    await pickByAddress(receivers, RECEIVER);
    await receiversToggle.click();
    await expect(receivers.locator('.hmm-multiselect-menu')).toHaveCount(0);
    await expectFitsContent(dialog);

    // the name and the description fill the row next to their labels, far wider than a channel button
    const grid = (await dialog.locator('.hmm-add-link').boundingBox())!;
    const button = (await sendersToggle.boundingBox())!;
    for (const id of ['add-link-name-all', 'add-link-description-all']) {
        const input = (await page.getByTestId(id).boundingBox())!;
        expect(input.width).toBeGreaterThan(button.width * 2);
        expect(input.x + input.width).toBeGreaterThan(grid.x + grid.width - 2);
    }
    await dialog.getByRole('button', {name: 'Cancel'}).click();
    await expect(dialog).not.toHaveAttribute('open');

    await page.setViewportSize({width: 360, height: 640});
    await page.getByTestId('links-add').click();
    await expect(dialog).toHaveAttribute('open', '');
    await expectFitsContent(dialog);
    await sendersToggle.click();
    await pickByAddress(senders, SENDER);
    await sendersToggle.click();
    await receiversToggle.click();
    await pickByAddress(receivers, RECEIVER);
    // with a list open the dialog stays inside the window and its body scrolls
    const open = (await dialog.boundingBox())!;
    expect(open.y + open.height).toBeLessThanOrEqual(640);
    await receiversToggle.click();
    const phone = (await dialog.boundingBox())!;
    expect(phone.x).toBeGreaterThanOrEqual(0);
    expect(phone.y).toBeGreaterThanOrEqual(0);
    expect(phone.x + phone.width).toBeLessThanOrEqual(360);
    expect(phone.y + phone.height).toBeLessThanOrEqual(640);
    expect(await body.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    for (const id of ['add-link-name-all', 'add-link-description-all']) {
        const input = (await page.getByTestId(id).boundingBox())!;
        expect(input.width).toBeGreaterThan(150);
        expect(input.x + input.width).toBeLessThanOrEqual(phone.x + phone.width);
    }
    for (const place of await Promise.all(
        (await dialog.locator('.hmm-dialog-buttons button').all()).map((entry) => entry.boundingBox()),
    )) {
        expect(place!.x).toBeGreaterThanOrEqual(0);
        expect(place!.x + place!.width).toBeLessThanOrEqual(360);
        expect(place!.y + place!.height).toBeLessThanOrEqual(640);
    }
});

test('a sender with no possible receiver says so', async ({page, host}) => {
    await page.goto(`${host.url}#/HmIP-RF/links`);
    await page.getByTestId('links-add').click();

    const senders = page.getByTestId('add-link-senders');
    await senders.getByRole('button').first().click();
    // The dimmer's receiver channel is not a sender at all, so its address finds nothing here.
    await senders.getByLabel('Filter').fill(`${HMIP_DIMMER}:3`);
    await expect(senders.getByRole('option')).toHaveCount(0);
    await senders.getByLabel('Filter').fill(SENDER);
    await expect(senders.getByRole('option')).toHaveCount(1);
});

/**
 * Task 31: the receiver list shows the channel name, the device name after it and `index: TYPE`
 * under it, not the address; part of the address still finds the channel; a long name is cut with
 * an ellipsis; the muted text follows the theme; and at phone width the list stays on the screen.
 */
test('the channel lists show two-line entries that the filter finds by address', async ({page, host}) => {
    // A device name longer than any list is wide, set the way a user sets one: through ReGa.
    const LONG =
        'Dimmer in the living room on the ground floor next to the terrace door, north wall, ' +
        'behind the sofa and left of the window that looks onto the garden and the old apple tree';
    await page.setViewportSize({width: 1280, height: 800});
    await page.goto(`${host.url}#/HmIP-RF/devices`);
    await page.locator(`[data-row-id="${HMIP_DIMMER}"]`).click();
    await page.getByTestId('devices-rename').click();
    await page.getByTestId('rename-input').fill(LONG);
    // the device alone: its channels keep the short names the list shows (task 65 ticks the box by default)
    await page.getByTestId('rename-children').uncheck();
    await page.getByTestId('rename-save').click();
    await expect(page.getByTestId('rename-dialog')).not.toHaveAttribute('open');

    await page.goto(`${host.url}#/HmIP-RF/links`);
    await page.getByTestId('links-add').click();
    const senders = page.getByTestId('add-link-senders');
    await senders.getByRole('button').first().click();
    await pickByAddress(senders, SENDER);
    await senders.getByRole('button').first().click();

    const receivers = page.getByTestId('add-link-receivers');
    await receivers.getByRole('button').first().click();
    // part of the address, which is no longer printed (the first eight characters: the dimmer on the
    // other firmware shares the end of the address, not the start)
    await receivers.getByLabel('Filter').fill(HMIP_DIMMER.slice(0, 8));
    const entry = receivers.getByRole('option');
    await expect(entry).toHaveCount(1);
    await expect(entry.locator('.hmm-multiselect-label')).toHaveText('Dimmer:3');
    await expect(entry.locator('.hmm-multiselect-hint')).toHaveText(LONG);
    await expect(entry.locator('.hmm-multiselect-description')).toHaveText('3: SWITCH_VIRTUAL_RECEIVER');
    await expect(entry).not.toContainText(HMIP_DIMMER);
    await expect(entry.locator('.hmm-multiselect-line')).toHaveAttribute('title', `Dimmer:3 ${LONG}`);

    // the long device name is cut, not wrapped: the row is two lines tall
    const hint = entry.locator('.hmm-multiselect-hint');
    expect(await hint.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    expect(await hint.evaluate((element) => getComputedStyle(element).textOverflow)).toBe('ellipsis');
    const row = await entry.boundingBox();
    expect(row!.height).toBeLessThan(48);

    // the muted text is the theme's, in light and in dark
    const muted = async (): Promise<string> => hint.evaluate((element) => getComputedStyle(element).color);
    const light = await muted();
    await page.emulateMedia({colorScheme: 'dark'});
    await expect.poll(muted).not.toBe(light);
    const menuBackground = await receivers
        .locator('.hmm-multiselect-menu')
        .evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(menuBackground).not.toBe('rgb(255, 255, 255)');

    // phone width: the open list stays inside the screen
    await page.setViewportSize({width: 360, height: 640});
    const menu = await receivers.locator('.hmm-multiselect-menu').boundingBox();
    expect(menu!.x).toBeGreaterThanOrEqual(0);
    expect(menu!.x + menu!.width).toBeLessThanOrEqual(360);
});

/**
 * Task 33: the way into creating a link was a bare `+` among the toolbar icons, named only by its
 * tooltip. It is the same captioned main action as the Devices tab's "Pair device" now.
 */
test('"Add link" is the captioned main action of the Links tab (task 33)', async ({page, host}) => {
    await page.goto(`${host.url}#/HmIP-RF/links`);
    await expect(page.getByTestId('links-table')).toBeVisible();
    await expectPrimaryToolbarButton(page, {
        testId: 'links-add',
        neighbour: 'links-edit',
        dialog: 'add-link-dialog',
        captions: {en: 'Add link', de: 'Verknüpfung anlegen'},
    });
});

/**
 * Task 80: the sender's link parameters (a weather sensor's wind thresholds, say) were collapsed behind a `+` and went
 * unnoticed. The editor opens with them visible now; the toggle still closes them.
 */
test('the link editor opens with the sender parameters visible (task 80)', async ({page, host, sim}) => {
    sim.callMethod('hmip', 'addLink', [SENDER, RECEIVER, '', '']);
    await page.goto(`${host.url}#/HmIP-RF/links`);
    const row = page.locator(`[data-row-id="${LINK_ROW}"]`);
    await expect(row).toBeVisible();
    await row.click();
    await page.getByTestId('links-edit').click();
    await expect(page.getByTestId('link-paramset-dialog')).toHaveAttribute('open', '');

    const toggle = page.getByTestId('link-sender-toggle');
    const senderParams = page.getByTestId('link-sender-params');
    await expect(senderParams.getByTestId('param-SHORT_ON_TIME')).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveText('−');

    await toggle.click();
    await expect(senderParams).toHaveCount(0);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveText('+');
});
