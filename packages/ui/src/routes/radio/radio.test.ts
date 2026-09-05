import {fireEvent, render, screen, waitFor, within} from '@testing-library/svelte';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import RssiCell from '../../lib/components/RssiCell.svelte';
import {MockTransport} from '../../lib/transport/MockTransport.js';
import {mountApp} from '../../testHarness.js';

describe('the RSSI cell', () => {
    afterEach(() => {
        document.documentElement.removeAttribute('data-theme');
    });

    it('prints the value with its unit, and a dash for what the interface does not know', () => {
        const {container} = render(RssiCell, {props: {value: -52}});
        expect(container.textContent).toBe('-52 dBm');

        const empty = render(RssiCell, {props: {}});
        expect(empty.container.textContent).toBe('—');
    });

    // D-22: the RSSI colours carry meaning, so they are asserted in both themes. The class is what
    // the theme switches, never the structure - the 2.x inline `#rrgg00` could not do that.
    for (const theme of ['light', 'dark'] as const) {
        it(`keeps the four RSSI classes apart in the ${theme} theme`, () => {
            document.documentElement.setAttribute('data-theme', theme);
            const cases = [
                {value: -10, expected: 'good'},
                {value: -60, expected: 'medium'},
                {value: -110, expected: 'bad'},
                {value: undefined, expected: 'unknown'},
                // 65536 is the interface process' placeholder for "not known".
                {value: 65_536, expected: 'unknown'},
            ];
            for (const {value, expected} of cases) {
                const {container} = render(RssiCell, {props: {value}});
                const cell = container.querySelector('.hmm-rssi');
                expect(cell?.getAttribute('data-rssi'), String(value)).toBe(expected);
                expect(cell?.classList.contains(`hmm-rssi-${expected}`), String(value)).toBe(true);
            }
        });
    }
});

describe('the radio tab', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
    });

    it('lists the BidCos interfaces with the columns of the 2.7 interface grid', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/rssi'});

        const gateways = await waitFor(() => screen.getByTestId('radio-gateways'));
        const labels = within(gateways)
            .getAllByRole('columnheader')
            .map((header) => header.textContent.trim());
        expect(labels).toEqual([
            'ADDRESS',
            'DESCRIPTION',
            'TYPE',
            'FIRMWARE_VERSION',
            'CONNECTED',
            'DEFAULT',
            'DUTY_CYCLE',
            'CARRIER_SENSE_LEVEL',
        ]);
        const row = within(gateways).getByText('CCU2-Coprocessor').closest('[data-row-id]');
        expect(row?.textContent).toContain('2.8.6');
        expect(row?.textContent).toContain('1 %');
    });

    it('draws a receive/send pair per gateway, coloured by the core classes', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/rssi'});

        await waitFor(() => {
            expect(screen.getByTestId('rssi-MEQ0123456-BidCoS-RF-rx')).toBeTruthy();
        });
        expect(screen.getByTestId('rssi-MEQ0123456-BidCoS-RF-rx').textContent).toBe('-52 dBm');
        expect(screen.getByTestId('rssi-MEQ0123456-BidCoS-RF-rx').getAttribute('data-rssi')).toBe('medium');
        // LEQ0456789 is at -112 dBm: bad. Its tx is 65536 and therefore unknown.
        expect(screen.getByTestId('rssi-LEQ0456789-BidCoS-RF-rx').getAttribute('data-rssi')).toBe('bad');
        expect(screen.getByTestId('rssi-LEQ0456789-BidCoS-RF-tx').getAttribute('data-rssi')).toBe('unknown');
    });

    it('opens the peers of a device as the 2.7 RSSI sub-grid', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/rssi'});
        await waitFor(() => {
            expect(document.querySelector('[data-row-id="MEQ0123456"]')).toBeTruthy();
        });

        const row = document.querySelector<HTMLElement>('[data-row-id="MEQ0123456"]')!;
        await fireEvent.click(within(row).getByRole('button', {name: 'Expand row'}));

        await waitFor(() => {
            expect(screen.getByTestId('rssi-MEQ0123456-JEQ0234567-rx')).toBeTruthy();
        });
        expect(screen.getByTestId('rssi-MEQ0123456-JEQ0234567-rx').textContent).toBe('-70 dBm');
    });

    it('builds the HmIP matrix from the RSSI_DEVICE and RSSI_PEER events', async () => {
        transport.result('bidcos.interfaces', [{ADDRESS: 'HmIP-RCV-50', TYPE: 'HMIP_CCU', DEFAULT: true}]);
        const {stores} = await mountApp({transport, hash: '#/HmIP-RF/rssi'});
        await waitFor(() => {
            expect(stores.radio.gateways('HmIP-RF')).toHaveLength(1);
        });

        transport.emit('rpc.event', {
            timestamp: Date.now(),
            interfaceName: 'HmIP-RF',
            method: 'event',
            address: '000A1B2C3D4E5F:0',
            datapoint: 'RSSI_DEVICE',
            value: -61,
        });

        await waitFor(() => {
            expect(stores.radio.pair('HmIP-RF', 'HmIP-RCV-50', '000A1B2C3D4E5F')?.rx).toBe(-61);
        });
        // The same value the other way round: what the device receives from the access point.
        expect(stores.radio.pair('HmIP-RF', '000A1B2C3D4E5F', 'HmIP-RCV-50')?.tx).toBe(-61);
    });

    it('names the interface a device is heard best by (#69)', async () => {
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/rssi'});
        await waitFor(() => {
            expect(stores.radio.gateways('BidCos-RF')).toHaveLength(1);
        });
        expect(stores.radio.bestGatewayFor('BidCos-RF', 'JEQ0234567')).toEqual({
            address: 'BidCoS-RF',
            rx: -60,
            tx: -36,
        });
        expect(stores.radio.bestGatewayFor('BidCos-RF', 'LEQ0456789')).toBeUndefined();
    });
});

describe('setBidcosInterface', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
        transport.result('bidcos.setInterface', null);
    });

    it('shows the assignment the interface reports now, not the one read at start-up (#122)', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/rssi'});
        await waitFor(() => {
            expect(document.querySelector('[data-row-id="MEQ0123456"]')).toBeTruthy();
        });
        await fireEvent.click(document.querySelector('[data-row-id="MEQ0123456"]')!);
        await fireEvent.click(screen.getByTestId('radio-set-interface'));

        await waitFor(() => {
            expect(screen.getByTestId('set-interface-current').textContent).toBe('BidCoS-RF');
        });
        expect(screen.getByTestId<HTMLSelectElement>('set-interface-select').value).toBe('BidCoS-RF');
    });

    it('sends the gateway and the roaming flag, then re-reads the device list', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/rssi'});
        await waitFor(() => {
            expect(document.querySelector('[data-row-id="MEQ0123456"]')).toBeTruthy();
        });
        await fireEvent.click(document.querySelector('[data-row-id="MEQ0123456"]')!);
        await fireEvent.click(screen.getByTestId('radio-set-interface'));
        await waitFor(() => {
            expect(screen.getByTestId('set-interface-confirm')).toBeTruthy();
        });

        await fireEvent.click(screen.getByTestId('set-interface-roaming'));
        const before = transport.countOf('devices.list');
        await fireEvent.click(screen.getByTestId('set-interface-confirm'));

        await waitFor(() => {
            expect(transport.lastCall('bidcos.setInterface')).toEqual(['BidCos-RF', 'MEQ0123456', 'BidCoS-RF', true]);
        });
        await waitFor(() => {
            expect(transport.countOf('devices.list')).toBeGreaterThan(before);
        });
    });

    it('reports a refused setBidcosInterface and keeps the dialog open', async () => {
        transport.fail('bidcos.setInterface', {message: 'Failure', kind: 'rpc', faultCode: -1});
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/rssi'});
        await waitFor(() => {
            expect(document.querySelector('[data-row-id="MEQ0123456"]')).toBeTruthy();
        });
        await fireEvent.click(document.querySelector('[data-row-id="MEQ0123456"]')!);
        await fireEvent.click(screen.getByTestId('radio-set-interface'));
        await waitFor(() => {
            expect(screen.getByTestId('set-interface-confirm')).toBeTruthy();
        });
        await fireEvent.click(screen.getByTestId('set-interface-confirm'));

        await waitFor(() => {
            expect(stores.notices.items.at(-1)?.message).toContain('Failure');
        });
        expect(screen.getByTestId('set-interface-dialog').hasAttribute('open')).toBe(true);
    });
});
