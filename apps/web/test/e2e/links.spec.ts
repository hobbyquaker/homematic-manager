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
    await expect(page.getByTestId('param-SHORT_ON_TIME')).toBeVisible();

    await page.getByTestId('link-name').fill('Button to dimmer');
    await page.getByTestId('link-description').fill('short press');
    await page.getByTestId('link-info-save').click();

    await page.getByTestId('param-SHORT_ON_TIME').getByRole('spinbutton').fill('12');
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
 * Task 30: the dialog opened a few rows tall and the channel lists unfolded inside that small box.
 * At 1280x800 it is 650 px tall at least and wider than the 760 px it was, and both lists open
 * inside it; on a phone the window bounds it and the buttons stay on the screen.
 */
test('the create-link dialog is tall and wide enough for its lists, and fits a phone', async ({page, host}) => {
    await page.setViewportSize({width: 1280, height: 800});
    await page.goto(`${host.url}#/HmIP-RF/links`);
    await page.getByTestId('links-add').click();
    const dialog = page.getByTestId('add-link-dialog');
    await expect(dialog).toHaveAttribute('open', '');
    const frame = await dialog.boundingBox();
    expect(frame!.height).toBeGreaterThanOrEqual(650);
    expect(frame!.width).toBeGreaterThan(760);
    const body = dialog.locator('.hmm-dialog-body');

    const senders = page.getByTestId('add-link-senders');
    const sendersToggle = senders.getByRole('button').first();
    await sendersToggle.click();
    await expectInside(senders.locator('.hmm-multiselect-menu'), body);
    await pickByAddress(senders, SENDER);
    await sendersToggle.click();

    const receivers = page.getByTestId('add-link-receivers');
    await receivers.getByRole('button').first().click();
    await expect(receivers.getByRole('option').first()).toBeVisible();
    await expectInside(receivers.locator('.hmm-multiselect-menu'), body);
    await receivers.getByRole('button').first().click();
    await dialog.getByRole('button', {name: 'Cancel'}).click();
    await expect(dialog).not.toHaveAttribute('open');

    await page.setViewportSize({width: 360, height: 640});
    await page.getByTestId('links-add').click();
    await expect(dialog).toHaveAttribute('open', '');
    const phone = await dialog.boundingBox();
    expect(phone!.x).toBeGreaterThanOrEqual(0);
    expect(phone!.y).toBeGreaterThanOrEqual(0);
    expect(phone!.x + phone!.width).toBeLessThanOrEqual(360);
    expect(phone!.y + phone!.height).toBeLessThanOrEqual(640);
    for (const button of await dialog.locator('.hmm-dialog-buttons button').all()) {
        const place = await button.boundingBox();
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
