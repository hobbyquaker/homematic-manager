/**
 * The table header of task 20, measured on the real tabs (the maintainer's second look at
 * `3.0.0-dev.3`):
 *
 * - the per-column filter fields are gone. Every tab has exactly one filter box per table, and the
 *   header rows carry column labels and nothing else.
 * - the tab's toolbar is gone as a strip above the grid. Its actions are the left half of the
 *   table's header band, the row count is the right end of the same band, and the column labels
 *   are the row underneath it.
 *
 * Pixels belong to browser mode; jsdom reports every box as zero, so the measuring block skips
 * itself there rather than passing on nothing.
 */

import {screen} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';

import {MockTransport} from '../lib/transport/MockTransport.js';
import {mountApp} from '../testHarness.js';

const hasLayout = document.body.getBoundingClientRect().width > 0;

/** The tab, the route it lives on, and the tables it draws. */
const TABS: readonly [name: string, hash: string, tables: readonly string[]][] = [
    ['Devices', '#/BidCos-RF/devices', ['devices-table']],
    ['Links', '#/HmIP-RF/links', ['links-table']],
    ['Radio', '#/BidCos-RF/rssi', ['radio-gateways', 'radio-table']],
    ['Service messages', '#/BidCos-RF/messages', ['messages-table']],
    ['Events', '#/BidCos-RF/events', ['events-table']],
];

describe('no per-column filter fields in a table header', () => {
    it.each(TABS)('%s', async (_name, hash, tables) => {
        await mountApp({transport: new MockTransport({demo: true}), hash});

        for (const testId of tables) {
            const table = screen.getByTestId(testId);
            expect(table.querySelectorAll('[role="columnheader"] input')).toHaveLength(0);
            expect(table.querySelector('.hmm-table-filters')).toBeNull();
            // Every remaining input of the table is in its header band, above the column labels.
            const head = table.querySelector('.hmm-table-head')!;
            for (const input of table.querySelectorAll('input')) {
                expect(head.contains(input)).toBe(false);
            }
        }
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
