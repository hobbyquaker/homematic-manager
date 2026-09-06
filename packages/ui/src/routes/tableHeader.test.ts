/**
 * The table header of task 20, measured on the real tabs (the maintainer's second look at
 * `3.0.0-dev.3`):
 *
 * - the per-column filter fields are gone. Every tab has exactly one filter box per table, and the
 *   header rows carry column labels and nothing else.
 *
 * Pixels belong to browser mode; jsdom reports every box as zero, so the measuring block skips
 * itself there rather than passing on nothing.
 */

import {screen} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';

import {MockTransport} from '../lib/transport/MockTransport.js';
import {mountApp} from '../testHarness.js';

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
