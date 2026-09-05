/**
 * What every dialog has to do at 1280x800, whatever is inside it (D-34):
 *
 * - never overflow horizontally. A value that is too long wraps or is ellipsised, a grid inside a
 *   dialog scrolls in its own box; nothing is pushed past the right edge, which is where the link
 *   editor's "save as template" and "delete template" buttons used to end up.
 * - fit the viewport, so the page behind it never grows a scrollbar of its own.
 * - keep its box while it is open. Loading its content, switching an easy-mode profile or turning
 *   the expert view on changes what is inside; it must not change the size of the frame around it.
 *
 * These are pixel assertions, so they belong to browser mode. jsdom has no layout and reports every
 * box as zero, so the file skips them there rather than passing on nothing.
 */

import {fireEvent, screen, waitFor, within} from '@testing-library/svelte';
import {beforeEach, describe, expect, it} from 'vitest';

import {MockTransport} from '../lib/transport/MockTransport.js';
import {mountApp} from '../testHarness.js';

const hasLayout = document.body.getBoundingClientRect().width > 0;

const SWITCH = 'MEQ0123456';
const SWITCH_CHANNEL = `${SWITCH}:1`;
const LINK_ROW = '0001D8A9B7C6D5:1->000A1B2C3D4E5F:4';

/** Nothing sticks out sideways, and the whole dialog is inside the window. */
function expectNoOverflow(dialog: HTMLElement): void {
    const body = dialog.querySelector<HTMLElement>('.hmm-dialog-body');
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
    expect(body).not.toBeNull();
    expect(body!.scrollWidth).toBeLessThanOrEqual(body!.clientWidth);

    const box = dialog.getBoundingClientRect();
    expect(box.width).toBeGreaterThan(0);
    expect(Math.round(box.left)).toBeGreaterThanOrEqual(0);
    expect(Math.round(box.right)).toBeLessThanOrEqual(window.innerWidth);
    expect(Math.round(box.top)).toBeGreaterThanOrEqual(0);
    expect(Math.round(box.bottom)).toBeLessThanOrEqual(window.innerHeight);

    // And the page behind it stays where it was.
    const page = document.documentElement;
    expect(page.scrollWidth).toBeLessThanOrEqual(page.clientWidth);
}

function box(dialog: HTMLElement): {width: number; height: number} {
    const rect = dialog.getBoundingClientRect();
    return {width: Math.round(rect.width), height: Math.round(rect.height)};
}

async function openParamset(): Promise<HTMLElement> {
    await mountApp({transport: new MockTransport({demo: true}), hash: '#/BidCos-RF/devices'});
    const parent = document.querySelector<HTMLElement>(`[data-row-id="${SWITCH}"]`)!;
    await fireEvent.click(within(parent).getByRole('button', {name: 'Expand row'}));
    await fireEvent.click(screen.getByTestId(`paramset-${SWITCH_CHANNEL}-MASTER`));
    return waitFor(() => {
        const dialog = screen.getByTestId('paramset-dialog');
        expect(dialog.querySelector('[data-testid^="param-"]')).not.toBeNull();
        return dialog;
    });
}

async function openLinkParamset(): Promise<HTMLElement> {
    await mountApp({transport: new MockTransport({demo: true}), hash: '#/HmIP-RF/links'});
    const row = await waitFor(() => document.querySelector<HTMLElement>(`[data-row-id="${LINK_ROW}"]`)!);
    await fireEvent.click(row);
    await fireEvent.click(screen.getByTestId('links-edit'));
    return waitFor(() => {
        const dialog = screen.getByTestId('link-paramset-dialog');
        expect(screen.getByTestId('link-profile')).toBeTruthy();
        return dialog;
    });
}

describe.skipIf(!hasLayout)('dialogs at 1280x800', () => {
    beforeEach(() => {
        expect(window.innerWidth).toBe(1280);
    });

    it('the settings dialog fits', async () => {
        await mountApp({transport: new MockTransport({demo: true})});
        await fireEvent.click(screen.getByTestId('settings-button'));
        const dialog = await waitFor(() => screen.getByTestId('config-dialog'));
        expectNoOverflow(dialog);
    });

    it('the about dialog fits', async () => {
        await mountApp({transport: new MockTransport({demo: true})});
        await fireEvent.click(screen.getByTestId('about-button'));
        const dialog = await waitFor(() => screen.getByTestId('about-dialog'));
        expectNoOverflow(dialog);
    });

    it('the paramset editor and its write preview fit', async () => {
        const dialog = await openParamset();
        expectNoOverflow(dialog);

        await fireEvent.click(screen.getByTestId('paramset-preview'));
        const preview = await waitFor(() => screen.getByTestId('write-preview'));
        expectNoOverflow(preview);
        // Still true for the one underneath: a second modal must not resize the first.
        expectNoOverflow(dialog);
    });

    it('the paramset editor keeps its box when the parameter list changes', async () => {
        const dialog = await openParamset();
        const before = box(dialog);

        // "Show hidden parameters" adds rows; the frame may not grow with them.
        await fireEvent.click(screen.getByTestId('paramset-write-all'));
        const hidden = screen.queryByTestId('paramset-show-hidden');
        if (hidden) {
            await fireEvent.click(hidden);
            await waitFor(() => {
                expect(screen.getAllByTestId(/^param-/).length).toBeGreaterThan(0);
            });
        }
        expect(box(dialog)).toEqual(before);
        expectNoOverflow(dialog);
    });

    it('the link editor fits, with the profile controls on their own lines', async () => {
        const dialog = await openLinkParamset();
        expectNoOverflow(dialog);
    });

    /**
     * The easy-mode description belongs *underneath* the profile selector, not beside it - it sat
     * at the end of one long flex row, which is also what pushed the template buttons out of the
     * dialog.
     */
    it('puts the easy-mode description under the profile selector', async () => {
        const dialog = await openLinkParamset();
        await fireEvent.click(screen.getByTestId('link-expert'));
        await fireEvent.click(screen.getByTestId('link-expert'));
        await fireEvent.change(screen.getByTestId('link-profile'), {target: {value: '2'}});

        const description = await waitFor(() => screen.getByTestId('link-profile-description'));
        const selector = screen.getByTestId('link-profile').getBoundingClientRect();
        const text = description.getBoundingClientRect();
        expect(text.top).toBeGreaterThanOrEqual(selector.bottom - 1);
        expect(Math.round(text.left)).toBeLessThanOrEqual(Math.round(selector.left));
        expectNoOverflow(dialog);
    });

    it('the link editor keeps its box when the easy-mode profile changes', async () => {
        const dialog = await openLinkParamset();
        const before = box(dialog);

        await fireEvent.change(screen.getByTestId('link-profile'), {target: {value: '2'}});
        await waitFor(() => {
            expect(screen.getByTestId('link-receiver-params')).toBeTruthy();
        });
        expect(box(dialog)).toEqual(before);

        // The expert view shows every parameter of the LINK paramset - the biggest jump there is.
        await fireEvent.click(screen.getByTestId('link-expert'));
        await waitFor(() => {
            expect(screen.getByTestId('link-receiver-params')).toBeTruthy();
        });
        expect(box(dialog)).toEqual(before);
        expectNoOverflow(dialog);
    });

    it('the add-link dialog fits', async () => {
        await mountApp({transport: new MockTransport({demo: true}), hash: '#/HmIP-RF/links'});
        await fireEvent.click(screen.getByTestId('links-add'));
        const dialog = await waitFor(() => screen.getByTestId('add-link-dialog'));
        expectNoOverflow(dialog);
    });

    it('the rename dialog fits', async () => {
        await mountApp({transport: new MockTransport({demo: true}), hash: '#/BidCos-RF/devices'});
        await fireEvent.click(document.querySelector<HTMLElement>(`[data-row-id="${SWITCH}"]`)!);
        await fireEvent.click(screen.getByTestId('devices-rename'));
        const dialog = await waitFor(() => screen.getByTestId('rename-dialog'));
        expectNoOverflow(dialog);
    });

    it('the add-device dialog fits', async () => {
        await mountApp({transport: new MockTransport({demo: true}), hash: '#/BidCos-RF/devices'});
        await fireEvent.click(screen.getByTestId('devices-add'));
        const dialog = await waitFor(() => screen.getByTestId('add-device-dialog'));
        expectNoOverflow(dialog);
    });

    /** The rest of the device toolbar's dialogs, all opened on a selected device. */
    it.each([
        ['devices-delete', 'delete-device-dialog'],
        ['devices-repair', 'repair-dialog'],
        ['devices-replace', 'replace-device-dialog'],
    ])('the %s dialog fits', async (button, testId) => {
        await mountApp({transport: new MockTransport({demo: true}), hash: '#/BidCos-RF/devices'});
        await fireEvent.click(document.querySelector<HTMLElement>(`[data-row-id="${SWITCH}"]`)!);
        await fireEvent.click(screen.getByTestId(button));
        const dialog = await waitFor(() => screen.getByTestId(testId));
        expectNoOverflow(dialog);
    });

    it('the remove-link dialog fits', async () => {
        await mountApp({transport: new MockTransport({demo: true}), hash: '#/HmIP-RF/links'});
        const row = await waitFor(() => document.querySelector<HTMLElement>(`[data-row-id="${LINK_ROW}"]`)!);
        await fireEvent.click(row);
        await fireEvent.click(screen.getByTestId('links-delete'));
        const dialog = await waitFor(() => screen.getByTestId('remove-link-dialog'));
        expectNoOverflow(dialog);
    });

    it('the BidCos interface dialog of the RSSI tab fits', async () => {
        await mountApp({transport: new MockTransport({demo: true}), hash: '#/BidCos-RF/rssi'});
        await fireEvent.click(document.querySelector<HTMLElement>(`[data-row-id="${SWITCH}"]`)!);
        await fireEvent.click(screen.getByTestId('radio-set-interface'));
        const dialog = await waitFor(() => screen.getByTestId('set-interface-dialog'));
        expectNoOverflow(dialog);
    });
});
