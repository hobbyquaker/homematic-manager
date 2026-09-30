/**
 * B-88: the write preview is big enough to read. At 1280x800 it shows ten parameter rows at once and
 * a `putParamset` call with two parameters on one line; on a phone it fits the screen, the page
 * behind it does not scroll sideways, and a long call scrolls in its own line instead of wrapping.
 *
 * Pixel assertions: browser mode only, skipped in jsdom (see dialogLayout.test.ts).
 */

import {render, waitFor, within} from '@testing-library/svelte';
import {beforeEach, describe, expect, it} from 'vitest';
import {page} from 'vitest/browser';

import {forgetDialogGeometry} from '../../lib/components/dialogGeometry.js';
import {storesContext} from '../../lib/stores/context.js';
import {MockTransport} from '../../lib/transport/MockTransport.js';
import type {WritePreview} from '../../lib/util/paramsetForm.js';
import {mountApp} from '../../testHarness.js';
import WritePreviewDialog from './WritePreviewDialog.svelte';

const hasLayout = document.body.getBoundingClientRect().width > 0;

/** The maintainer's example, with HmIP addresses (the longest there are) and the struct as it is sent. */
const TWO_PARAMETERS =
    'putParamset(000A1B2C3D4E5F:4←0001D8A9B7C6D5:1, LINK, {"SHORT_ON_TIME":{"explicitDouble":0.4},"SHORT_ON_TIME_MODE":1})';

function preview(rows: number, calls: readonly string[] = [TWO_PARAMETERS]): WritePreview {
    return {
        targets: ['000A1B2C3D4E5F:4←0001D8A9B7C6D5:1'],
        entries: Array.from({length: rows}, (_, index) => ({
            param: `SHORT_PARAMETER_${String(index).padStart(2, '0')}`,
            from: '0',
            to: String(index + 1),
        })),
        values: {},
        skipped: [],
        problems: [],
        calls,
    };
}

async function open(rows: number, calls?: readonly string[]): Promise<HTMLElement> {
    const {stores} = await mountApp({transport: new MockTransport({demo: true})});
    render(WritePreviewDialog, {
        props: {open: true, preview: preview(rows, calls), paramset: 'LINK', onconfirm: () => undefined},
        context: storesContext(stores),
    });
    // the app mounts its own previews too, closed: this is the open one
    return waitFor(() => {
        const dialog = document.querySelector<HTMLElement>('dialog[open][data-testid="write-preview"]');
        expect(dialog?.querySelector('[data-testid="preview-call-0"]')).toBeTruthy();
        return dialog!;
    });
}

function inside(inner: DOMRect, outer: DOMRect): boolean {
    return (
        Math.round(inner.top) >= Math.round(outer.top) &&
        Math.round(inner.bottom) <= Math.round(outer.bottom) &&
        Math.round(inner.left) >= Math.round(outer.left) &&
        Math.round(inner.right) <= Math.round(outer.right)
    );
}

/** The height of one line of this element's font (`line-height: normal` is about 1.2 em). */
function oneLine(element: HTMLElement): number {
    const style = getComputedStyle(element);
    return Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.25;
}

/** One line: nothing hidden sideways, and no taller than a line of its own font. */
function expectOneLine(call: HTMLElement): void {
    expect(call.scrollWidth).toBeLessThanOrEqual(call.clientWidth);
    expect(call.clientHeight).toBeLessThan(oneLine(call) * 1.5);
}

describe.skipIf(!hasLayout)('the write preview at 1280x800 (B-88)', () => {
    beforeEach(() => {
        expect(window.innerWidth).toBe(1280);
        forgetDialogGeometry();
    });

    it('prints a call with two parameters on one line', async () => {
        const dialog = await open(2);
        expectOneLine(within(dialog).getByTestId('preview-call-0'));
        const body = dialog.querySelector<HTMLElement>('.hmm-dialog-body')!;
        expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth);
    });

    it('shows ten parameter rows at once, without scrolling', async () => {
        const dialog = await open(12);
        const body = dialog.querySelector<HTMLElement>('.hmm-dialog-body')!;
        const bodyBox = body.getBoundingClientRect();
        for (let index = 0; index < 10; index += 1) {
            const row = within(dialog).getByTestId(`preview-SHORT_PARAMETER_${String(index).padStart(2, '0')}`);
            expect(inside(row.getBoundingClientRect(), bodyBox)).toBe(true);
        }
        expect(body.scrollTop).toBe(0);
    });

    it('opens tall enough for ten rows even when it lists one', async () => {
        const dialog = await open(1);
        const body = dialog.querySelector<HTMLElement>('.hmm-dialog-body')!;
        const row = within(dialog).getByTestId('preview-SHORT_PARAMETER_00').getBoundingClientRect();
        expect(Math.round(body.getBoundingClientRect().bottom - row.top)).toBeGreaterThanOrEqual(
            Math.floor(10 * row.height),
        );
        const frame = dialog.getBoundingClientRect();
        expect(Math.round(frame.bottom)).toBeLessThanOrEqual(window.innerHeight);
    });
});

describe.skipIf(!hasLayout)('the write preview on a 390x844 phone (B-88)', () => {
    beforeEach(() => {
        forgetDialogGeometry();
    });

    it('fits the screen, and a long call scrolls in its line instead of wrapping', async () => {
        await page.viewport(390, 844);
        try {
            const dialog = await open(12, [TWO_PARAMETERS, TWO_PARAMETERS.replace('000A1B2C3D4E5F:4←', 'X:1←')]);
            const frame = dialog.getBoundingClientRect();
            expect(Math.round(frame.left)).toBeGreaterThanOrEqual(0);
            expect(Math.round(frame.top)).toBeGreaterThanOrEqual(0);
            expect(Math.round(frame.right)).toBeLessThanOrEqual(390);
            expect(Math.round(frame.bottom)).toBeLessThanOrEqual(844);

            const body = dialog.querySelector<HTMLElement>('.hmm-dialog-body')!;
            expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth);
            expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
            // (the page behind is not checked: the devices grid is wider than a phone by design)

            const call = within(dialog).getByTestId('preview-call-0');
            // wider than the phone: it scrolls sideways, one line tall, nothing broken inside an address
            expect(call.scrollWidth).toBeGreaterThan(call.clientWidth);
            expect(getComputedStyle(call).whiteSpace).toBe('nowrap');
            expect(call.scrollHeight).toBeLessThan(oneLine(call) * 1.5);

            const buttons = dialog.querySelector<HTMLElement>('.hmm-dialog-buttons')!.getBoundingClientRect();
            expect(Math.round(buttons.bottom)).toBeLessThanOrEqual(Math.round(frame.bottom));
            expect(Math.round(buttons.right)).toBeLessThanOrEqual(390);
        } finally {
            await page.viewport(1280, 800);
        }
    });
});
