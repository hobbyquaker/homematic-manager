import type {ServiceMessage} from '@homematic-manager/core';
import {fireEvent, screen, waitFor, within} from '@testing-library/svelte';
import {beforeEach, describe, expect, it} from 'vitest';

import {QUIET_STORAGE_KEY} from '../lib/stores/ServiceMessagesStore.svelte.js';
import {DEMO_SERVICE_MESSAGES} from '../lib/transport/demoData.js';
import {MockTransport} from '../lib/transport/MockTransport.js';
import {MemoryStorage, mountApp} from '../testHarness.js';

const sabotage: ServiceMessage = {
    interfaceName: 'BidCos-RF',
    address: 'GEQ0567890:0',
    datapoint: 'SABOTAGE',
    value: true,
    since: Date.parse('2026-09-05T07:00:00Z'),
};

describe('the service messages tab', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
    });

    it('lists the messages of the selected interface with device, value and age', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/messages'});

        const row = document.querySelector<HTMLElement>('[data-row-id="LEQ0456789:0/LOWBAT"]');
        expect(row?.textContent).toContain('LOWBAT');
        expect(row?.textContent).toContain('LEQ0456789');
        expect(row?.textContent).toContain('true');
    });

    it('acknowledges only what the CCU lets an application acknowledge', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/messages'});

        // LOWBAT goes away when the battery is changed; STICKY_UNREACH can be written.
        await fireEvent.click(document.querySelector('[data-row-id="LEQ0456789:0/LOWBAT"]')!);
        expect(screen.getByTestId<HTMLButtonElement>('messages-ack').disabled).toBe(true);
        expect(screen.getByTestId('messages-ack').getAttribute('title')).toContain('STICKY_UNREACH');

        await fireEvent.click(document.querySelector('[data-row-id="KEQ0345678:0/STICKY_UNREACH"]')!);
        expect(screen.getByTestId<HTMLButtonElement>('messages-ack').disabled).toBe(false);
        await fireEvent.click(screen.getByTestId('messages-ack'));

        await waitFor(() => {
            expect(transport.lastCall('serviceMessages.ack')).toEqual(['BidCos-RF', 'KEQ0345678:0', 'STICKY_UNREACH']);
        });
    });

    it('acknowledges everything acknowledgeable of the interface at once', async () => {
        transport.result('serviceMessages.list', [...DEMO_SERVICE_MESSAGES, sabotage]);
        await mountApp({transport, hash: '#/BidCos-RF/messages'});

        await fireEvent.click(screen.getByTestId('messages-ack-all'));
        await waitFor(() => {
            expect(transport.countOf('serviceMessages.ack')).toBe(2);
        });
        const acked = transport.calls
            .filter((call) => call.method === 'serviceMessages.ack')
            .map((call) => call.params[2]);
        expect(acked.sort()).toEqual(['SABOTAGE', 'STICKY_UNREACH']);
    });

    it('explains a BidCos CONFIG_PENDING in the list, where the user is looking at it', async () => {
        transport.result('serviceMessages.list', [
            {interfaceName: 'BidCos-RF', address: 'MEQ0123456:0', datapoint: 'CONFIG_PENDING', value: true, since: 0},
        ]);
        await mountApp({transport, hash: '#/BidCos-RF/messages'});

        const row = document.querySelector<HTMLElement>('[data-row-id="MEQ0123456:0/CONFIG_PENDING"]');
        expect(row?.textContent).toContain('Aufwachen');
    });

    it('announces a message that arrives later as a toast, never as a modal (#77)', async () => {
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/messages'});
        expect(stores.notices.items).toHaveLength(0);

        transport.emit('serviceMessages.changed', [...DEMO_SERVICE_MESSAGES, sabotage]);

        await waitFor(() => {
            expect(stores.notices.items.at(-1)?.message).toContain('SABOTAGE');
        });
        // The paramset dialog, if one were open, is untouched: a toast has no modal backdrop.
        expect(document.querySelector('dialog[open]')).toBeNull();
    });

    it('keeps quiet when quiet mode is on, and remembers the choice (#102)', async () => {
        const storage = new MemoryStorage();
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/messages', storage});

        await fireEvent.click(screen.getByTestId('messages-quiet'));
        expect(storage.map.get(QUIET_STORAGE_KEY)).toBe('true');
        expect(screen.getByTestId('messages-quiet-hint')).toBeTruthy();

        transport.emit('serviceMessages.changed', [...DEMO_SERVICE_MESSAGES, sabotage]);
        await waitFor(() => {
            expect(stores.serviceMessages.of('BidCos-RF')).toHaveLength(3);
        });
        // The list and the tab counter still moved; only the toast was suppressed.
        expect(stores.notices.items).toHaveLength(0);
    });

    it('starts quiet when the last session left it quiet', async () => {
        const storage = new MemoryStorage();
        storage.setItem(QUIET_STORAGE_KEY, 'true');
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/messages', storage});
        expect(stores.serviceMessages.quiet).toBe(true);
    });

    it('survives an rfd that answers "" instead of an empty list', async () => {
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/messages'});
        transport.emit('serviceMessages.changed', '' as unknown as ServiceMessage[]);

        await waitFor(() => {
            expect(stores.serviceMessages.messages).toEqual([]);
        });
        expect(screen.getByTestId('messages-table')).toBeTruthy();
    });
});

describe('the events tab', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
    });

    it('shows the live events of the interface, newest first, with the method', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/events'});
        const rows = [...document.querySelectorAll('[data-row-id]')];
        expect(rows.length).toBeGreaterThan(0);
        expect(rows[0]?.textContent).toContain('ACTUAL_TEMPERATURE');
        expect(rows[0]?.textContent).toContain('event');
    });

    it('counts the events per device, which is what #129 asked for', async () => {
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/events'});
        for (let index = 0; index < 3; index += 1) {
            transport.emit('rpc.event', {
                timestamp: Date.now(),
                interfaceName: 'BidCos-RF',
                method: 'event',
                address: 'JEQ0234567:1',
                datapoint: 'PRESS_SHORT',
                value: true,
            });
        }
        await waitFor(() => {
            expect(stores.events.countFor('JEQ0234567:1')).toBe(4);
        });
        const row = document.querySelector<HTMLElement>('[data-row-id]');
        expect(row?.textContent).toContain('4');
    });

    it('narrows by address and by datapoint, through the core filter', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/events'});

        await fireEvent.input(screen.getByTestId('events-filter-address'), {target: {value: 'KEQ'}});
        await waitFor(() => {
            expect(document.querySelectorAll('[data-row-id]')).toHaveLength(1);
        });
        expect(document.querySelector('[data-row-id]')?.textContent).toContain('KEQ0345678:4');

        await fireEvent.input(screen.getByTestId('events-filter-address'), {target: {value: ''}});
        await fireEvent.input(screen.getByTestId('events-filter-datapoint'), {target: {value: 'press'}});
        await waitFor(() => {
            expect(document.querySelectorAll('[data-row-id]')).toHaveLength(1);
        });
        expect(document.querySelector('[data-row-id]')?.textContent).toContain('PRESS_SHORT');
    });

    it('freezes the list while it is paused and catches up when it is not', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/events'});
        const before = document.querySelectorAll('[data-row-id]').length;

        await fireEvent.click(screen.getByTestId('events-pause'));
        expect(screen.getByTestId('events-paused')).toBeTruthy();

        transport.emit('rpc.event', {
            timestamp: Date.now(),
            interfaceName: 'BidCos-RF',
            method: 'event',
            address: 'GEQ0567890:1',
            datapoint: 'LEVEL',
            value: 0.5,
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(document.querySelectorAll('[data-row-id]')).toHaveLength(before);

        await fireEvent.click(screen.getByTestId('events-pause'));
        await waitFor(() => {
            expect(document.querySelectorAll('[data-row-id]')).toHaveLength(before + 1);
        });
    });

    it('clears the buffer here and in the backend', async () => {
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/events'});
        await fireEvent.click(screen.getByTestId('events-clear'));

        await waitFor(() => {
            expect(stores.events.size).toBe(0);
        });
        expect(transport.countOf('events.clear')).toBe(1);
        expect(within(screen.getByTestId('events-table')).getByText('Keine Daten')).toBeTruthy();
    });
});
