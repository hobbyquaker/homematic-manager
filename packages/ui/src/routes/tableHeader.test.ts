/**
 * The table header of task 20, measured on the real tabs (the maintainer's second look at
 * `3.0.0-dev.3`):
 *
 * - the per-column filter fields are what a grid filters with, and the tab-wide "filter everything"
 *   box above them is gone. So the header band draws no filter input, and the row under the column
 *   labels draws one per filterable column.
 * - the tab's toolbar is gone as a strip above the grid. Its actions are the left half of the
 *   table's header band, the row count is the right end of the same band, and the column labels
 *   are the row underneath it.
 *
 * Pixels belong to browser mode; jsdom reports every box as zero, so the measuring block skips
 * itself there rather than passing on nothing.
 */

import {screen} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';

import {DEVICE_IMAGE_SIZE, ROW_HEIGHT} from '../lib/components/metrics.js';
import {MockTransport} from '../lib/transport/MockTransport.js';
import {mountApp} from '../testHarness.js';

const hasLayout = document.body.getBoundingClientRect().width > 0;

/** The tab, the route it lives on, and the tables it draws that filter per column. */
const TABS: readonly [name: string, hash: string, tables: readonly string[]][] = [
    ['Devices', '#/BidCos-RF/devices', ['devices-table']],
    ['Links', '#/HmIP-RF/links', ['links-table']],
    ['Radio', '#/BidCos-RF/rssi', ['radio-table']],
    ['Service messages', '#/BidCos-RF/messages', ['messages-table']],
    ['Events', '#/BidCos-RF/events', ['events-table']],
];

describe('a table filters per column, and has no box that filters everything', () => {
    it.each(TABS)('%s', async (_name, hash, tables) => {
        await mountApp({transport: new MockTransport({demo: true}), hash});

        for (const testId of tables) {
            const table = screen.getByTestId(testId);
            expect(table.querySelectorAll('.hmm-table-filters input').length).toBeGreaterThan(0);
            // The tab-wide box is gone: nothing the DataTable itself draws sits in the band.
            expect(table.querySelector('.hmm-table-filter')).toBeNull();
            expect(table.querySelector('.hmm-table-band .hmm-tf-input')).toBeNull();
        }
    });

    /**
     * The RSSI tab's gateway list is three rows in 110 px and always has been unfiltered; the
     * device table underneath it is the one with the fields.
     */
    it('leaves the gateway list of the RSSI tab without a filter row', async () => {
        await mountApp({transport: new MockTransport({demo: true}), hash: '#/BidCos-RF/rssi'});
        expect(screen.getByTestId('radio-gateways').querySelector('.hmm-table-filters')).toBeNull();
    });

    /**
     * The Events tab keeps the two named boxes 2.x had - ADDRESS and PARAM over core's event
     * filter. They are not the "filter everything" box; they are the tab's own controls, and they
     * are now part of the header band.
     */
    it('keeps the two named event filters, in the band', async () => {
        await mountApp({transport: new MockTransport({demo: true}), hash: '#/BidCos-RF/events'});
        const band = screen.getByTestId('events-table').querySelector('.hmm-table-band')!;
        expect(band.contains(screen.getByTestId('events-filter-address'))).toBe(true);
        expect(band.contains(screen.getByTestId('events-filter-datapoint'))).toBe(true);
    });
});

/** The tab, its route, the table that carries the toolbar, and one action of that toolbar. */
const BANDS: readonly [name: string, hash: string, table: string, action: string][] = [
    ['Devices', '#/BidCos-RF/devices', 'devices-table', 'devices-add'],
    ['Links', '#/HmIP-RF/links', 'links-table', 'links-add'],
    ['Radio', '#/BidCos-RF/rssi', 'radio-table', 'radio-refresh'],
    ['Service messages', '#/BidCos-RF/messages', 'messages-table', 'messages-refresh'],
    ['Events', '#/BidCos-RF/events', 'events-table', 'events-pause'],
];

describe('the toolbar is the table header band', () => {
    it.each(BANDS)('%s puts its actions and its count in one band', async (_name, hash, table, action) => {
        await mountApp({transport: new MockTransport({demo: true}), hash});

        const grid = screen.getByTestId(table);
        const band = grid.querySelector<HTMLElement>('.hmm-table-band')!;
        expect(band).not.toBeNull();

        // The action is in the band, not in a strip of its own above the grid.
        expect(band.contains(screen.getByTestId(action))).toBe(true);
        expect(band.contains(screen.getByTestId(`${table}-count`))).toBe(true);
        expect(document.querySelectorAll('.hmm-toolbar')).toHaveLength(0);
        expect(band.querySelector('[role="toolbar"]')).not.toBeNull();
    });

    it.skipIf(!hasLayout).each(BANDS)(
        '%s: actions left, count right, column labels underneath',
        async (_name, hash, table, action) => {
            await mountApp({transport: new MockTransport({demo: true}), hash});

            const grid = screen.getByTestId(table);
            const band = grid.querySelector<HTMLElement>('.hmm-table-band')!.getBoundingClientRect();
            const head = grid.querySelector<HTMLElement>('.hmm-table-head')!.getBoundingClientRect();
            const actions = grid.querySelector<HTMLElement>('.hmm-table-actions')!.getBoundingClientRect();
            const first = screen.getByTestId(action).getBoundingClientRect();
            const count = screen.getByTestId(`${table}-count`).getBoundingClientRect();

            // One band, above the column labels, both inside the table's frame.
            expect(Math.round(band.bottom)).toBeLessThanOrEqual(Math.round(head.top) + 1);
            expect(Math.round(band.left)).toBe(Math.round(head.left));
            expect(band.height).toBeGreaterThan(0);

            // Actions on the left: the first one starts in the left half and the whole group ends
            // before the count begins.
            expect(first.left).toBeLessThan(band.left + band.width / 2);
            expect(Math.round(actions.right)).toBeLessThanOrEqual(Math.round(count.left));

            // The count is right-aligned inside the band: 6 px of padding, no more.
            expect(band.right - count.right).toBeLessThanOrEqual(7);
            expect(count.right).toBeLessThanOrEqual(band.right);
            expect(count.left).toBeGreaterThan(band.left + band.width / 2);
        },
    );

    /**
     * The band belongs to the head: the body is the only part that scrolls, so both stay where
     * they are and the column labels never slide under the actions.
     */
    it.skipIf(!hasLayout)('keeps the band and the labels in place while the body scrolls', async () => {
        await mountApp({transport: new MockTransport({demo: true}), hash: '#/BidCos-RF/devices'});
        const grid = screen.getByTestId('devices-table');
        const body = grid.querySelector<HTMLElement>('.hmm-table-body')!;
        const bandTop = grid.querySelector<HTMLElement>('.hmm-table-band')!.getBoundingClientRect().top;
        const headTop = grid.querySelector<HTMLElement>('.hmm-table-head')!.getBoundingClientRect().top;

        body.scrollTop = 200;
        body.dispatchEvent(new Event('scroll'));

        expect(grid.querySelector<HTMLElement>('.hmm-table-band')!.getBoundingClientRect().top).toBe(bandTop);
        expect(grid.querySelector<HTMLElement>('.hmm-table-head')!.getBoundingClientRect().top).toBe(headTop);
    });
});

/**
 * Task 22, the maintainer's third look: the rows grew from 26 to 30 px and the picture in them
 * from 16 to 20, so the numbers task 20 measured are re-measured here and pinned.
 *
 * The three rows of the header are what did *not* change - they are chrome, not data - and that is
 * worth an assertion of its own: growing a data row must not push the band, the column labels or
 * the filter fields around.
 */
describe.skipIf(!hasLayout)('the grid metrics of the third look', () => {
    it('draws 30 px rows with a 20 px picture inside the picture column', async () => {
        await mountApp({transport: new MockTransport({demo: true}), hash: '#/BidCos-RF/devices'});
        const row = screen.getByTestId('devices-table').querySelector<HTMLElement>('.hmm-tr')!;
        expect(Math.round(row.getBoundingClientRect().height)).toBe(ROW_HEIGHT);

        const picture = row.querySelector<HTMLElement>('.hmm-device-image')!.getBoundingClientRect();
        expect(Math.round(picture.width)).toBe(DEVICE_IMAGE_SIZE);
        expect(Math.round(picture.height)).toBe(DEVICE_IMAGE_SIZE);

        // The cell clips (`overflow: hidden`), so a track too narrow for the picture would cut it
        // off silently - which is what the 24 px column of the 16 px picture did.
        const cell = row.querySelector<HTMLElement>('[role="gridcell"]')!.getBoundingClientRect();
        expect(Math.round(picture.left)).toBeGreaterThanOrEqual(Math.round(cell.left));
        expect(Math.round(picture.right)).toBeLessThanOrEqual(Math.round(cell.right));
    });

    it.each(BANDS)('%s keeps its header band, label row and filter row', async (_name, hash, table) => {
        await mountApp({transport: new MockTransport({demo: true}), hash});
        const grid = screen.getByTestId(table);
        const heightOf = (selector: string): number =>
            Math.round(grid.querySelector<HTMLElement>(selector)!.getBoundingClientRect().height);

        // Task 20's numbers, unchanged: the header is chrome and does not follow the row height.
        expect(heightOf('.hmm-table-band')).toBe(33);
        expect(heightOf('.hmm-table-head')).toBe(26);
        expect(heightOf('.hmm-table-filters')).toBe(27);
    });
});
