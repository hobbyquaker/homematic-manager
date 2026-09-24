import type {ServiceMessage} from '@homematic-manager/core';
import {fireEvent, screen, waitFor, within} from '@testing-library/svelte';
import {beforeEach, describe, expect, it} from 'vitest';

import {DEMO_SERVICE_MESSAGES} from '../lib/transport/demoData.js';
import {MockTransport} from '../lib/transport/MockTransport.js';
import {SUPPRESS_COLUMN_WIDTH} from '../lib/util/deviceGrid.js';
import {mountApp} from '../testHarness.js';

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

    /**
     * Issue #146: the button asked `serviceMessages.list`, which the backend answers from its
     * cache - the interfaces themselves are read by an event or by the five-minute poll, so
     * nothing about the list could change and the button looked dead. It now asks for the round
     * trip, and it turns while it waits.
     */
    it('reads the interfaces again when refresh is pressed, and says that it is working', async () => {
        let answer: (value: ServiceMessage[]) => void = () => undefined;
        transport.respond(
            'serviceMessages.refresh',
            () => new Promise<ServiceMessage[]>((resolve) => (answer = resolve)),
        );
        await mountApp({transport, hash: '#/BidCos-RF/messages'});
        const button = screen.getByTestId<HTMLButtonElement>('messages-refresh');
        expect(button.disabled).toBe(false);

        await fireEvent.click(button);
        expect(transport.lastCall('serviceMessages.refresh')).toEqual(['BidCos-RF']);
        await waitFor(() => {
            expect(screen.getByTestId('messages-refresh').getAttribute('aria-busy')).toBe('true');
        });
        expect(screen.getByTestId<HTMLButtonElement>('messages-refresh').disabled).toBe(true);

        answer([sabotage]);
        await waitFor(() => {
            expect(screen.getByTestId('messages-refresh').getAttribute('aria-busy')).toBeNull();
        });
        expect(document.querySelector('[data-row-id="GEQ0567890:0/SABOTAGE"]')).not.toBeNull();
    });

    it('acknowledges only what the CCU lets an application acknowledge', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/messages'});

        // LOWBAT goes away when the battery is changed; STICKY_UNREACH can be written.
        await fireEvent.click(document.querySelector('[data-row-id="LEQ0456789:0/LOWBAT"]')!);
        expect(screen.getByTestId<HTMLButtonElement>('messages-ack').disabled).toBe(true);
        expect(screen.getByTestId('messages-ack-tooltip').getAttribute('data-tooltip')).toContain('STICKY_UNREACH');

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

    /**
     * B-24 (#150): the WebUI lists "Kommunikationsstörung" for an HM-CC-RT-DN, which is
     * `FAULT_REPORTING` = 4 on its transceiver channel. The row shows the CCU's own label for the
     * value, read through the channel's description, and it is not acknowledgeable - the datapoint
     * is not writable, and the WebUI's confirm button is disabled for it too.
     */
    const fault: ServiceMessage = {
        interfaceName: 'BidCos-RF',
        address: 'KEQ0345678:4',
        datapoint: 'FAULT_REPORTING',
        value: 4,
        since: 0,
    };

    it("task 36: Since says whether it is the CCU's first report or this application's first sight", async () => {
        transport.result('serviceMessages.list', [
            {...fault, since: Date.UTC(2026, 8, 1, 10, 0), sinceSource: 'rega'},
            {
                interfaceName: 'BidCos-RF',
                address: 'KEQ0345678:0',
                datapoint: 'STICKY_UNREACH',
                value: true,
                since: Date.UTC(2026, 8, 2),
            },
        ]);
        await mountApp({transport, hash: '#/BidCos-RF/messages'});
        const fromCcu = await screen.findByTestId('message-since-KEQ0345678:4-FAULT_REPORTING');
        expect(fromCcu.getAttribute('title')).toBe('Erste Meldung, von der CCU');
        expect(fromCcu.dataset['source']).toBe('rega');
        expect(fromCcu.textContent).not.toBe('');
        const local = screen.getByTestId('message-since-KEQ0345678:0-STICKY_UNREACH');
        expect(local.getAttribute('title')).toBe('Vom Homematic Manager zuerst gesehen');
        expect(local.dataset['source']).toBe('local');
    });

    it('B-24: shows a FAULT_REPORTING with the label of its value, and cannot acknowledge it', async () => {
        transport.result('serviceMessages.list', [fault]);
        await mountApp({transport, hash: '#/BidCos-RF/messages'});

        await waitFor(() => {
            expect(screen.getByTestId('message-value-KEQ0345678:4-FAULT_REPORTING').textContent).toBe(
                'Kommunikationsstörung',
            );
        });
        const cell = screen.getByTestId('message-value-KEQ0345678:4-FAULT_REPORTING');
        expect(cell.getAttribute('title')).toBe('COMMUNICATION_ERROR (4)');
        expect(
            transport.calls.filter((call) => call.method === 'paramset.description').map((call) => call.params),
        ).toEqual([['BidCos-RF', 'KEQ0345678:4', 'VALUES']]);

        await fireEvent.click(document.querySelector('[data-row-id="KEQ0345678:4/FAULT_REPORTING"]')!);
        expect(screen.getByTestId<HTMLButtonElement>('messages-ack').disabled).toBe(true);
        expect(screen.getByTestId<HTMLButtonElement>('messages-ack-all').disabled).toBe(true);
    });

    it('B-24: keeps the raw value, quietly, where the description cannot be read', async () => {
        transport.result('serviceMessages.list', [fault]);
        transport.fail('paramset.description', 'Unknown instance');
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/messages'});

        await waitFor(() => {
            expect(transport.countOf('paramset.description')).toBe(1);
        });
        const cell = screen.getByTestId('message-value-KEQ0345678:4-FAULT_REPORTING');
        expect(cell.textContent).toBe('4');
        expect(cell.getAttribute('title')).toBeNull();
        expect(stores.notices.items).toHaveLength(0);

        // asked once per channel, not on every change of the list
        transport.emit('serviceMessages.changed', [fault, sabotage]);
        await waitFor(() => {
            expect(document.querySelector('[data-row-id="GEQ0567890:0/SABOTAGE"]')).not.toBeNull();
        });
        expect(transport.countOf('paramset.description')).toBe(1);
    });

    /**
     * Task 36 (#150, D-44): the list stays per interface, the band counts the box. The reporter
     * counted seven in the CCU WebUI and four here, because one device sat on the other interface.
     */
    const hmipLowbat: ServiceMessage = {
        interfaceName: 'HmIP-RF',
        address: '0001D3C99C1234:0',
        datapoint: 'LOW_BAT',
        value: true,
        since: 0,
    };

    it('task 36: shows only the count while the selected interface holds every message', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/messages'});
        expect(screen.getByTestId('messages-table-count').textContent).toBe('2 Servicemeldungen');
        expect(screen.queryByTestId('messages-total')).toBeNull();
    });

    it('task 36: counts the other interfaces in the band and switches to them on a click', async () => {
        transport.result('serviceMessages.list', [...DEMO_SERVICE_MESSAGES, hmipLowbat]);
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/messages'});

        const total = await waitFor(() => screen.getByTestId('messages-total'));
        expect(total.textContent).toBe('2 von 3 auf dieser Zentrale');
        expect(screen.queryByTestId('messages-table-count')).toBeNull();
        expect(screen.getByTestId('messages-total-tooltip').getAttribute('data-tooltip')).toBe(
            'Außerdem auf dieser Zentrale: HmIP-RF (1). Ein Klick wechselt zu HmIP-RF.',
        );
        // the list itself is still the selected interface's
        expect(document.querySelector('[data-row-id="0001D3C99C1234:0/LOW_BAT"]')).toBeNull();

        await fireEvent.click(total);
        await waitFor(() => {
            expect(stores.app.selectedInterface).toBe('HmIP-RF');
        });
        await waitFor(() => {
            expect(document.querySelector('[data-row-id="0001D3C99C1234:0/LOW_BAT"]')).not.toBeNull();
        });
        expect(screen.getByTestId('messages-total').textContent).toBe('1 von 3 auf dieser Zentrale');
    });

    it('task 36: keeps the other interfaces after a refresh of the selected one', async () => {
        transport.result('serviceMessages.list', [...DEMO_SERVICE_MESSAGES, hmipLowbat]);
        // the backend answers a refresh of one interface with that interface's list only
        transport.result('serviceMessages.refresh', [sabotage]);
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/messages'});
        await waitFor(() => {
            expect(screen.getByTestId('messages-total').textContent).toBe('2 von 3 auf dieser Zentrale');
        });

        await fireEvent.click(screen.getByTestId('messages-refresh'));
        await waitFor(() => {
            expect(document.querySelector('[data-row-id="GEQ0567890:0/SABOTAGE"]')).not.toBeNull();
        });
        expect(document.querySelector('[data-row-id="LEQ0456789:0/LOWBAT"]')).toBeNull();
        expect(screen.getByTestId('messages-total').textContent).toBe('1 von 2 auf dieser Zentrale');
        expect(stores.serviceMessages.of('HmIP-RF')).toEqual([hmipLowbat]);
        // a message that was already there is not news
        expect(stores.notices.items.map((notice) => notice.message)).toEqual(['GEQ0567890:0 SABOTAGE']);
    });

    it('B-24: asks no description for a list of booleans', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/messages'});
        expect(document.querySelector('[data-row-id="LEQ0456789:0/LOWBAT"]')).not.toBeNull();
        expect(transport.countOf('paramset.description')).toBe(0);
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

    /**
     * Task 26 (openccu-lite 28.9): eQ-3's suppression, HmIP only. The row offers it once the
     * channel's suppressed list is known, the click is the three-argument call, and the list and
     * the messages are read again afterwards. BidCos has no such method and no such button.
     */
    it('suppresses a message from its row on an HmIP interface, and reads the state back', async () => {
        const lowbat: ServiceMessage = {
            interfaceName: 'HmIP-RF',
            address: '000A1B2C3D4E5F:0',
            datapoint: 'LOWBAT',
            value: true,
            since: 0,
        };
        transport.result('serviceMessages.list', [lowbat]);
        const suppressedNow: string[] = [];
        transport.respond('rpc.call', (_interfaceName, method, params) => {
            if (method === 'suppressServiceMessages') {
                const parameter = params[1];
                suppressedNow.push(typeof parameter === 'string' ? parameter : '');
                return true;
            }
            return method === 'getSuppressedServiceMessages' ? [...suppressedNow] : '';
        });
        const {stores} = await mountApp({transport, hash: '#/HmIP-RF/messages'});

        const button = await waitFor(() => screen.getByTestId<HTMLButtonElement>('suppress-000A1B2C3D4E5F:0-LOWBAT'));
        expect(transport.calls.filter((call) => call.method === 'rpc.call').map((call) => call.params)).toEqual([
            ['HmIP-RF', 'getSuppressedServiceMessages', ['000A1B2C3D4E5F:0']],
        ]);
        expect(stores.serviceMessages.isSuppressed(lowbat)).toBe(false);

        await fireEvent.click(button);
        await waitFor(() => {
            expect(stores.serviceMessages.isSuppressed(lowbat)).toBe(true);
        });
        expect(transport.calls.filter((call) => call.method === 'rpc.call').map((call) => call.params)).toEqual([
            ['HmIP-RF', 'getSuppressedServiceMessages', ['000A1B2C3D4E5F:0']],
            ['HmIP-RF', 'suppressServiceMessages', ['000A1B2C3D4E5F:0', 'LOWBAT', true]],
            ['HmIP-RF', 'getSuppressedServiceMessages', ['000A1B2C3D4E5F:0']],
        ]);
        // the list is read again: a suppressed UNREACH or LOWBAT reports false and leaves it
        expect(transport.countOf('serviceMessages.list')).toBeGreaterThan(1);
        // the same button now lifts the suppression
        await fireEvent.click(screen.getByTestId('suppress-000A1B2C3D4E5F:0-LOWBAT'));
        await waitFor(() => {
            expect(transport.lastCall('rpc.call')).toEqual([
                'HmIP-RF',
                'getSuppressedServiceMessages',
                ['000A1B2C3D4E5F:0'],
            ]);
        });
        expect(
            transport.calls.filter(
                (call) => call.method === 'rpc.call' && call.params[1] === 'suppressServiceMessages',
            ),
        ).toHaveLength(2);
    });

    /**
     * Task 55 (#164): "what does Suppress do?" - the button says it, in the app's tooltip (pointer
     * and keyboard focus) and as its accessible description, naming the parameter and the call,
     * in German and English, and the text follows the button once the suppression is set.
     */
    it('explains the suppress button in a tooltip and as its accessible description', async () => {
        const lowbat: ServiceMessage = {
            interfaceName: 'HmIP-RF',
            address: '000A1B2C3D4E5F:0',
            datapoint: 'LOWBAT',
            value: true,
            since: 0,
        };
        transport.result('serviceMessages.list', [lowbat]);
        const suppressedNow: string[] = [];
        transport.respond('rpc.call', (_interfaceName, method, params) => {
            if (method === 'suppressServiceMessages') {
                const parameter = params[1];
                suppressedNow.push(typeof parameter === 'string' ? parameter : '');
                return true;
            }
            return method === 'getSuppressedServiceMessages' ? [...suppressedNow] : '';
        });
        const {stores} = await mountApp({transport, hash: '#/HmIP-RF/messages'});
        stores.i18n.language = 'en';

        const anchor = (): HTMLElement => screen.getByTestId('suppress-tooltip-000A1B2C3D4E5F:0-LOWBAT');
        const button = await waitFor(() => screen.getByTestId<HTMLButtonElement>('suppress-000A1B2C3D4E5F:0-LOWBAT'));
        const description = (): string =>
            document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent ?? '';
        await waitFor(() => {
            expect(anchor().getAttribute('data-tooltip')).toContain('stops reporting LOWBAT for this channel');
        });
        expect(anchor().getAttribute('data-tooltip')).toContain('suppressServiceMessages');
        expect(anchor().getAttribute('data-tooltip')).toContain('“Unsuppress”');
        expect(description()).toBe(anchor().getAttribute('data-tooltip'));
        // no browser `title` any more: its delay is the browser's (#145)
        expect(button.getAttribute('title')).toBeNull();

        // keyboard focus shows it at once
        button.focus();
        await fireEvent.focusIn(anchor());
        expect((await screen.findByRole('tooltip')).textContent).toBe(anchor().getAttribute('data-tooltip'));
        await fireEvent.focusOut(anchor());

        stores.i18n.language = 'de';
        await waitFor(() => {
            expect(anchor().getAttribute('data-tooltip')).toContain(
                'Die Zentrale meldet LOWBAT für diesen Kanal nicht mehr',
            );
        });
        expect(anchor().getAttribute('data-tooltip')).toContain('„Unterdrückung aufheben“');
        expect(description()).toBe(anchor().getAttribute('data-tooltip'));

        // once suppressed, the button lifts it, and says so
        await fireEvent.click(button);
        await waitFor(() => {
            expect(stores.serviceMessages.isSuppressed(lowbat)).toBe(true);
        });
        await waitFor(() => {
            expect(anchor().getAttribute('data-tooltip')).toContain(
                'Die Zentrale meldet LOWBAT für diesen Kanal wieder',
            );
        });
        expect(anchor().getAttribute('data-tooltip')).toContain('suppress=false');
        expect(
            document.getElementById(
                screen.getByTestId('suppress-000A1B2C3D4E5F:0-LOWBAT').getAttribute('aria-describedby') ?? '',
            )?.textContent,
        ).toBe(anchor().getAttribute('data-tooltip'));
    });

    /**
     * B-35 (#157): the suppress column was fixed at 150 px, which could not be dragged and cut off the
     * German "Unterdrückung aufheben". It is resizable now, down to that button and not below it.
     */
    it('draws the longest suppress button whole, in a column that is resized down to it and no further', async () => {
        const lowbat: ServiceMessage = {
            interfaceName: 'HmIP-RF',
            address: '000A1B2C3D4E5F:0',
            datapoint: 'LOWBAT',
            value: true,
            since: 0,
        };
        transport.result('serviceMessages.list', [lowbat]);
        transport.respond('rpc.call', (_interfaceName, method) =>
            method === 'getSuppressedServiceMessages' ? ['LOWBAT'] : '',
        );
        await mountApp({transport, hash: '#/HmIP-RF/messages'});

        const button = (): HTMLElement => screen.getByTestId('suppress-000A1B2C3D4E5F:0-LOWBAT');
        await waitFor(() => {
            expect(button().textContent.trim()).toBe('Unterdrückung aufheben');
        });
        const cell = (): HTMLElement => button().closest<HTMLElement>('.hmm-td')!;
        expect(cell().classList.contains('hmm-td-fixed')).toBe(false);
        expect(cell().scrollWidth).toBeLessThanOrEqual(cell().clientWidth);

        const handle = screen.getByTestId('messages-table-resize-suppress');
        for (let step = 0; step < 30; step += 1) {
            await fireEvent.keyDown(handle, {key: 'ArrowLeft'});
        }
        expect(Math.round(cell().getBoundingClientRect().width)).toBe(SUPPRESS_COLUMN_WIDTH);
        expect(cell().scrollWidth).toBeLessThanOrEqual(cell().clientWidth);
    });

    it('offers no suppression on BidCos, where the interface has no such method', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/messages'});
        expect(screen.getByTestId('message-LEQ0456789:0-LOWBAT')).toBeTruthy();
        expect(screen.queryByTestId('suppress-LEQ0456789:0-LOWBAT')).toBeNull();
        expect(transport.countOf('rpc.call')).toBe(0);
        // the quiet mode of #102 is gone with task 26: a service message has no such state
        expect(screen.queryByTestId('messages-quiet')).toBeNull();
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
