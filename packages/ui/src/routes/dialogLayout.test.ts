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
 * Task 20 adds the other half of that rule: the *user* may change the box, by dragging the title
 * bar or an edge, and what the user chose is then what the dialog keeps - while it is open, and for
 * the rest of the session when the same dialog class is opened again.
 *
 * These are pixel assertions, so they belong to browser mode. jsdom has no layout and reports every
 * box as zero, so the file skips them there rather than passing on nothing.
 */

import {fireEvent, screen, waitFor, within} from '@testing-library/svelte';
import {beforeEach, describe, expect, it} from 'vitest';

import {forgetDialogGeometry, recallPanelHeight} from '../lib/components/dialogGeometry.js';
import type {Stores} from '../lib/stores/Stores.svelte.js';
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

function frame(dialog: HTMLElement): {left: number; top: number; width: number; height: number} {
    const rect = dialog.getBoundingClientRect();
    return {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
    };
}

/**
 * One pointer drag on a handle: down on the handle, move and up on the window, which is where the
 * component listens once a gesture has started.
 */
async function drag(handle: HTMLElement, dx: number, dy: number): Promise<void> {
    const rect = handle.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const options = {bubbles: true, pointerId: 1, button: 0, buttons: 1};
    handle.dispatchEvent(new PointerEvent('pointerdown', {...options, clientX: x, clientY: y}));
    window.dispatchEvent(new PointerEvent('pointermove', {...options, clientX: x + dx, clientY: y + dy}));
    window.dispatchEvent(new PointerEvent('pointerup', {...options, clientX: x + dx, clientY: y + dy}));
    await waitFor(() => {
        expect(handle.isConnected).toBe(true);
    });
}

const titleBarOf = (dialog: HTMLElement): HTMLElement => dialog.querySelector<HTMLElement>('.hmm-dialog-titlebar')!;
const handleOf = (dialog: HTMLElement, edge: string): HTMLElement =>
    dialog.querySelector<HTMLElement>(`[data-resize="${edge}"]`)!;

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
        forgetDialogGeometry();
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

/**
 * Task 20, the third point: the user moves and resizes a dialog, and nothing else does.
 *
 * The paramset editor is the one measured here because it is the dialog with the most inside it -
 * a fixed 900x640 box, a scrolling parameter list, and the one whose size the maintainer looked at
 * first.
 */
/**
 * The RPC log drawer (task 22, the maintainer's third look at `3.0.0-dev.6`).
 *
 * It used to be a 240 px box that nothing could change, which is two rows of a real log. It opens
 * at half the window now, is dragged by its upper edge, remembers what the user left it at for the
 * session, and - task 19's rule, which the maintainer asked to apply here as well - never grows a
 * horizontal scrollbar whatever is in it.
 */
describe.skipIf(!hasLayout)('the RPC log drawer', () => {
    /** The `--hmm-header-height` of the theme: what stays above the drawer and bounds it. */
    const HEADER = 36;
    const MINIMUM = 120;

    beforeEach(() => {
        forgetDialogGeometry();
        expect(window.innerHeight).toBe(800);
    });

    async function openDrawer(): Promise<{panel: HTMLElement; handle: HTMLElement; stores: Stores}> {
        const {stores} = await mountApp({transport: new MockTransport({demo: true}), hash: '#/BidCos-RF/devices'});
        await fireEvent.click(screen.getByTestId('rpclog-toggle'));
        const panel = await waitFor(() => {
            const found = screen.getByTestId('rpclog');
            expect(found.getBoundingClientRect().height).toBeGreaterThan(0);
            return found;
        });
        return {panel, handle: screen.getByTestId('rpclog-resize'), stores};
    }

    const heightOf = (panel: HTMLElement): number => Math.round(panel.getBoundingClientRect().height);

    it('opens at half the viewport', async () => {
        const {panel} = await openDrawer();
        expect(heightOf(panel)).toBe(Math.round(window.innerHeight / 2));
        expect(heightOf(panel)).toBe(400);
    });

    it('changes its height by exactly what the handle was dragged', async () => {
        const {panel, handle} = await openDrawer();

        // Up is taller: the drawer is glued to the bottom edge.
        await drag(handle, 0, -100);
        expect(heightOf(panel)).toBe(500);

        await drag(handle, 0, 100);
        expect(heightOf(panel)).toBe(400);
    });

    it('stops at the window minus the header, and at its minimum', async () => {
        const {panel, handle} = await openDrawer();

        await drag(handle, 0, -5000);
        expect(heightOf(panel)).toBe(window.innerHeight - HEADER);

        await drag(handle, 0, 5000);
        expect(heightOf(panel)).toBe(MINIMUM);
    });

    it('remembers the height for the session, and opens at it again', async () => {
        const {panel, handle} = await openDrawer();
        await drag(handle, 0, -150);
        expect(heightOf(panel)).toBe(550);
        expect(recallPanelHeight('rpclog')).toBe(550);

        await fireEvent.click(screen.getByTestId('rpclog-toggle'));
        await waitFor(() => expect(screen.queryByTestId('rpclog')).toBeNull());

        await fireEvent.click(screen.getByTestId('rpclog-toggle'));
        const reopened = await waitFor(() => screen.getByTestId('rpclog'));
        expect(heightOf(reopened)).toBe(550);
    });

    it('never scrolls sideways, whatever is in it', async () => {
        const {panel, stores} = await openDrawer();
        stores.writeLog.entries = [
            {
                id: 1,
                timestamp: Date.parse('2026-09-06T10:00:00Z'),
                interfaceName: 'BidCos-RF',
                method: 'putParamset',
                // The case that pushed the old drawer sideways: one `putParamset` with a paramset
                // in it, on a `1fr` track that grew to its content instead of ellipsising it.
                params: ['MEQ0123456:1', 'MASTER', {['LONG_PARAMETER_NAME_'.repeat(40)]: 'x'.repeat(400)}],
                ok: true,
                result: '',
                durationMs: 12,
            },
        ];

        await waitFor(() => expect(panel.querySelectorAll('.hmm-rpclog-entry')).toHaveLength(1));
        expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);

        const list = panel.querySelector<HTMLElement>('.hmm-rpclog-list')!;
        expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth);
        // and the page behind it does not scroll sideways either
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
    });

    /** The one control a pointer-less user has: the handle is a separator, not a decoration. */
    it('resizes with the arrow keys as well', async () => {
        const {panel, handle} = await openDrawer();
        await fireEvent.keyDown(handle, {key: 'ArrowUp'});
        expect(heightOf(panel)).toBe(420);
        await fireEvent.keyDown(handle, {key: 'ArrowDown'});
        expect(heightOf(panel)).toBe(400);
        // anything else is not a resize
        await fireEvent.keyDown(handle, {key: 'Enter'});
        expect(heightOf(panel)).toBe(400);
    });
});

describe.skipIf(!hasLayout)('a dialog the user has moved or resized', () => {
    beforeEach(() => {
        expect(window.innerWidth).toBe(1280);
        forgetDialogGeometry();
    });

    it('follows the title bar and keeps its size', async () => {
        const dialog = await openParamset();
        const before = frame(dialog);

        await drag(titleBarOf(dialog), 100, 50);

        expect(frame(dialog)).toEqual({
            left: before.left + 100,
            top: before.top + 50,
            width: before.width,
            height: before.height,
        });
        expectNoOverflow(dialog);
    });

    it('reports the new box after a drag on the bottom-right corner', async () => {
        const dialog = await openParamset();
        const before = frame(dialog);

        await drag(handleOf(dialog, 'se'), 120, 80);

        const after = frame(dialog);
        expect(after.left).toBe(before.left);
        expect(after.top).toBe(before.top);
        expect(after.width).toBe(before.width + 120);
        expect(after.height).toBe(before.height + 80);
    });

    it('resizes from an edge and leaves the opposite one where it was', async () => {
        const dialog = await openParamset();
        const before = frame(dialog);

        await drag(handleOf(dialog, 'w'), -80, 0);

        const after = frame(dialog);
        expect(after.width).toBe(before.width + 80);
        expect(after.left).toBe(before.left - 80);
        expect(after.left + after.width).toBe(before.left + before.width);
        expect(after.height).toBe(before.height);
    });

    /** 520x320 is what the paramset editor asks for; below that its rows stop being readable. */
    it('stops at the minimum of its dialog class, however far the pointer goes', async () => {
        const dialog = await openParamset();

        await drag(handleOf(dialog, 'se'), -2000, -2000);

        expect(box(dialog)).toEqual({width: 520, height: 320});
        expectNoOverflow(dialog);
    });

    it('is bounded by the viewport, however far the pointer goes the other way', async () => {
        const dialog = await openParamset();

        await drag(handleOf(dialog, 'se'), 2000, 2000);

        const after = frame(dialog);
        expect(after.left + after.width).toBeLessThanOrEqual(window.innerWidth);
        expect(after.top + after.height).toBeLessThanOrEqual(window.innerHeight);
        expectNoOverflow(dialog);
    });

    it('keeps the box the user chose when the content grows', async () => {
        const dialog = await openParamset();
        await drag(handleOf(dialog, 'se'), 120, 80);
        const chosen = frame(dialog);

        await fireEvent.click(screen.getByTestId('paramset-write-all'));
        const hidden = screen.queryByTestId('paramset-show-hidden');
        if (hidden) {
            await fireEvent.click(hidden);
            await waitFor(() => {
                expect(screen.getAllByTestId(/^param-/).length).toBeGreaterThan(0);
            });
        }
        expect(frame(dialog)).toEqual(chosen);
    });

    /** Task 19's rule survives the resize: down the content area, never across it. */
    it('never scrolls horizontally after a resize, whatever the user squeezed it to', async () => {
        const dialog = await openParamset();
        await drag(handleOf(dialog, 'se'), -2000, -2000);

        const body = dialog.querySelector<HTMLElement>('.hmm-dialog-body')!;
        const list = dialog.querySelector<HTMLElement>('.hmm-paramset-list')!;
        expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
        expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth);
        expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth);
        expect(getComputedStyle(list).overflowX).toBe('hidden');
        expect(getComputedStyle(list).overflowY).toBe('auto');
    });

    /**
     * And the vertical half of it: the settings dialog squeezed to the default minimum is far
     * shorter than what is in it, and the content area is what takes the scrollbar.
     */
    it('scrolls its content vertically after a resize', async () => {
        await mountApp({transport: new MockTransport({demo: true})});
        await fireEvent.click(screen.getByTestId('settings-button'));
        const dialog = await waitFor(() => screen.getByTestId('config-dialog'));

        await drag(handleOf(dialog, 'se'), -2000, -2000);
        // 560 px is the width the settings form was laid out for, and its minimum for that reason.
        expect(box(dialog)).toEqual({width: 560, height: 160});

        const body = dialog.querySelector<HTMLElement>('.hmm-dialog-body')!;
        expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
        expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth);
        expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
    });

    it('opens again where it was left, for the rest of the session', async () => {
        const dialog = await openParamset();
        await drag(titleBarOf(dialog), 100, 50);
        await drag(handleOf(dialog, 'se'), 120, 80);
        const chosen = frame(dialog);

        await fireEvent.click(within(dialog).getByRole('button', {name: 'Close'}));
        await waitFor(() => {
            expect(screen.getByTestId<HTMLDialogElement>('paramset-dialog').open).toBe(false);
        });

        await fireEvent.click(screen.getByTestId(`paramset-${SWITCH_CHANNEL}-MASTER`));
        const again = await waitFor(() => {
            const reopened = screen.getByTestId<HTMLDialogElement>('paramset-dialog');
            expect(reopened.open).toBe(true);
            return reopened;
        });
        expect(frame(again)).toEqual(chosen);
    });

    /**
     * The native `<dialog>` still does the modality, and the handles are `aria-hidden` divs with no
     * tab stop and no accessible name, so nothing a keyboard or a screen reader sees has changed:
     * the focus is trapped inside the open dialog, a drag does not take it out, and ESC closes.
     */
    it('keeps the focus trap and ESC of the native dialog', async () => {
        const first = (await openParamset()) as HTMLDialogElement;
        for (const handle of first.querySelectorAll('[data-resize]')) {
            expect(handle.getAttribute('aria-hidden')).toBe('true');
            expect(handle.getAttribute('tabindex')).toBeNull();
            expect(handle.textContent).toBe('');
        }
        // ESC on a modal dialog is the platform's, and it arrives as `cancel`.
        first.dispatchEvent(new Event('cancel', {cancelable: true}));
        await waitFor(() => {
            expect(first.open).toBe(false);
        });

        // Again, this time opened from a focused button, the way a keyboard user opens it.
        const opener = screen.getByTestId(`paramset-${SWITCH_CHANNEL}-MASTER`);
        opener.focus();
        await fireEvent.click(opener);
        const dialog = await waitFor(() => {
            const reopened = screen.getByTestId<HTMLDialogElement>('paramset-dialog');
            expect(reopened.open).toBe(true);
            return reopened;
        });
        expect(dialog.contains(document.activeElement)).toBe(true);

        await drag(titleBarOf(dialog), 100, 50);
        expect(dialog.contains(document.activeElement)).toBe(true);
        expect(dialog.open).toBe(true);

        dialog.dispatchEvent(new Event('cancel', {cancelable: true}));
        await waitFor(() => {
            expect(dialog.open).toBe(false);
        });
        expect(document.activeElement).toBe(opener);
    });
});
