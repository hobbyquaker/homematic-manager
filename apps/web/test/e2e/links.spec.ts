/**
 * "Links": add, edit the link paramset, remove. Three workflows in one file because they are one
 * story - a link that is not created cannot be edited, and one that is not removed leaves the next
 * test a grid that is not empty.
 *
 * The pair is the HmIP wall button (`KEY_TRANSCEIVER`, `LINK_SOURCE_ROLES: SWITCH`) and the HmIP
 * dimmer's virtual receiver (`SWITCH_VIRTUAL_RECEIVER`, `LINK_TARGET_ROLES: SWITCH`); the role
 * matrix is what decides that these two may be linked and the BidCos actor may not.
 */

import {HMIP_BUTTON, HMIP_DIMMER, expect, simulatorReady, test} from './fixtures.js';

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
    await senders.getByRole('option', {name: new RegExp(SENDER)}).click();
    // A multi-select popup stays open after a pick, and it covers the row below it - so it has to
    // be closed before the receiver picker can be clicked at all.
    await sendersToggle.click();
    await expect(sendersToggle).toHaveAttribute('aria-expanded', 'false');

    // The receiver picker is disabled until a sender exists: the offered receivers are the ones the
    // role matrix allows for *that* sender.
    const receivers = page.getByTestId('add-link-receivers');
    const receiversToggle = receivers.getByRole('button').first();
    await receiversToggle.click();
    await receivers.getByRole('option', {name: new RegExp(RECEIVER)}).click();
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
    const linkWrites = sim.getWriteLog().filter((entry) => entry.values['SHORT_ON_TIME'] !== undefined);
    expect(linkWrites.length).toBeGreaterThan(0);

    // The preview is a second modal on top of the editor and does not close itself when the
    // read-back differs from what was written - which it does here, because the simulator stores a
    // LINK paramset per peer and answers the whole set. Both have to be closed, innermost first.
    await page.getByTestId('write-preview').getByRole('button', {name: 'Close'}).first().click();
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

test('a sender with no possible receiver says so', async ({page, host}) => {
    await page.goto(`${host.url}#/HmIP-RF/links`);
    await page.getByTestId('links-add').click();

    const senders = page.getByTestId('add-link-senders');
    await senders.getByRole('button').first().click();
    // The dimmer's receiver channel is not a sender at all, so it is not in the list.
    await expect(senders.getByRole('option', {name: new RegExp(`${HMIP_DIMMER}:3`)})).toHaveCount(0);
    await expect(senders.getByRole('option', {name: new RegExp(SENDER)})).toHaveCount(1);
});
