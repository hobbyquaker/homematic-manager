import {fireEvent, waitFor, within} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';

import {mountApp} from '../testHarness.js';

/**
 * Task 47: which columns of which grid carry the copy button - every cell that shows a device's, a
 * channel's or an interface's own name or address. What the button does is `DataTable`'s and is
 * tested there; here only that each page switched it on where it belongs, and nowhere else. The app
 * starts in German in this harness, so the labels are the German ones.
 */

const NAME = 'Namen kopieren';
const ADDRESS = 'Adresse kopieren';

/** `column: label` of every copy button in a row, in the order they are drawn. */
function copyButtonsOf(row: Element): string[] {
    return [...row.querySelectorAll<HTMLButtonElement>('button.hmm-copy')].map(
        (button) =>
            `${button.closest<HTMLElement>('[data-column-key]')?.dataset['columnKey'] ?? '?'}: ${button.getAttribute('aria-label') ?? ''}`,
    );
}

async function rowOf(id: string, within_: ParentNode = document): Promise<HTMLElement> {
    let row: HTMLElement | null = null;
    await waitFor(() => {
        row = within_.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`);
        expect(row, `no row ${id}`).not.toBeNull();
    });
    return row!;
}

describe('the copy button on names and addresses (task 47)', () => {
    it('is on Name and ADDRESS of a device and of its channels in the device grid', async () => {
        await mountApp({hash: '#/BidCos-RF/devices'});
        const device = await rowOf('MEQ0123456');
        expect(copyButtonsOf(device)).toEqual([`name: ${NAME}`, `ADDRESS: ${ADDRESS}`]);

        await fireEvent.click(within(device).getByRole('button', {name: 'Expand row'}));
        expect(copyButtonsOf(await rowOf('MEQ0123456:1'))).toEqual([`name: ${NAME}`, `ADDRESS: ${ADDRESS}`]);
        // the sub-grid's label row has none
        expect(copyButtonsOf(document.querySelector('[data-row-kind="header"]')!)).toEqual([]);
    });

    it('is on the name and the address of both ends of a link, not on the link’s own name', async () => {
        await mountApp({hash: '#/BidCos-RF/links'});
        expect(copyButtonsOf(await rowOf('JEQ0234567:1->MEQ0123456:1'))).toEqual([
            `senderName: ${NAME}`,
            `SENDER: ${ADDRESS}`,
            `receiverName: ${NAME}`,
            `RECEIVER: ${ADDRESS}`,
        ]);
    });

    it('is on a gateway’s address, and on the name and address of a device and of its peers in the Funk grid', async () => {
        await mountApp({hash: '#/BidCos-RF/rssi'});
        const gateways = document.querySelector<HTMLElement>('[data-testid="radio-gateways"]')!;
        await waitFor(() => {
            expect(gateways.querySelector('[data-row-id]')).not.toBeNull();
        });
        expect(copyButtonsOf(gateways.querySelector('[data-row-id]')!)).toEqual([`ADDRESS: ${ADDRESS}`]);

        const table = document.querySelector<HTMLElement>('[data-testid="radio-table"]')!;
        const device = await rowOf('MEQ0123456', table);
        // not on INTERFACE: the receiver a device is routed through is not the row's own address
        expect(copyButtonsOf(device)).toEqual([`name: ${NAME}`, `ADDRESS: ${ADDRESS}`]);

        await fireEvent.click(within(device).getByRole('button', {name: 'Expand row'}));
        await waitFor(() => {
            expect(table.querySelector('.hmm-tr-child')).not.toBeNull();
        });
        expect(copyButtonsOf(table.querySelector('.hmm-tr-child')!)).toEqual([`name: ${NAME}`, `ADDRESS: ${ADDRESS}`]);
    });

    it('is on the name and the address of the device a service message is about', async () => {
        await mountApp({hash: '#/BidCos-RF/messages'});
        expect(copyButtonsOf(await rowOf('LEQ0456789:0/LOWBAT'))).toEqual([`name: ${NAME}`, `address: ${ADDRESS}`]);
    });

    it('is on the name and the address of an event', async () => {
        await mountApp({hash: '#/BidCos-RF/events'});
        await waitFor(() => {
            expect(document.querySelector('[data-row-id]')).not.toBeNull();
        });
        expect(copyButtonsOf(document.querySelector('[data-row-id]')!)).toEqual([
            `name: ${NAME}`,
            `address: ${ADDRESS}`,
        ]);
    });
});
