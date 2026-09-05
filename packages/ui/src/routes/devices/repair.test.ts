import type {ServiceMessage} from '@homematic-manager/core';
import {fireEvent, screen, waitFor, within} from '@testing-library/svelte';
import {beforeEach, describe, expect, it} from 'vitest';

import {MockTransport} from '../../lib/transport/MockTransport.js';
import {offersRepair, serviceMessageExplanation} from '../../lib/util/deviceGrid.js';
import {readBack} from '../../lib/util/paramsetForm.js';
import {mountApp} from '../../testHarness.js';

/**
 * What the lab measured in task 6 (`docs/config-pending.md`), as far as the UI is concerned:
 * CONFIG_PENDING means two different things, only one of them is repairable, and a BidCos `ok`
 * says nothing about what was really stored.
 */

const configPending = (interfaceName: string, address: string): ServiceMessage => ({
    interfaceName,
    address,
    datapoint: 'CONFIG_PENDING',
    value: true,
    since: Date.parse('2026-09-05T10:00:00Z'),
});

describe('the two meanings of CONFIG_PENDING', () => {
    it('explains a queued configuration on BidCos and a failed transfer on HmIP', () => {
        expect(serviceMessageExplanation('CONFIG_PENDING', false)).toBe(
            'A configuration is queued; the device takes it when it next wakes up',
        );
        expect(serviceMessageExplanation('CONFIG_PENDING', true)).toBe(
            'The configuration could not be transferred to the device',
        );
        expect(serviceMessageExplanation('LOWBAT', true)).toBeUndefined();
    });

    it('offers the repair only for the HmIP meaning', () => {
        expect(offersRepair('CONFIG_PENDING', true)).toBe(true);
        expect(offersRepair('CONFIG_PENDING', false)).toBe(false);
        expect(offersRepair('UNREACH', true)).toBe(false);
    });

    it('puts the BidCos explanation in the tooltip and offers no repair button there', async () => {
        const transport = new MockTransport({demo: true});
        transport.result('serviceMessages.list', [configPending('BidCos-RF', 'MEQ0123456:0')]);
        await mountApp({transport, hash: '#/BidCos-RF/devices'});

        const row = document.querySelector<HTMLElement>('[data-row-id="MEQ0123456"]')!;
        await waitFor(() => {
            expect(within(row).getByLabelText('CONFIG_PENDING')).toBeTruthy();
        });
        expect(within(row).getByLabelText('CONFIG_PENDING').getAttribute('title')).toContain('Aufwachen');
        expect(screen.queryByTestId('repair-MEQ0123456')).toBeNull();
    });

    it('offers the repair button on HmIP and says the transfer failed', async () => {
        const transport = new MockTransport({demo: true});
        transport.result('serviceMessages.list', [configPending('HmIP-RF', '000A1B2C3D4E5F:0')]);
        const {stores} = await mountApp({transport, hash: '#/HmIP-RF/devices'});
        await waitFor(() => {
            expect(stores.devices.devices('HmIP-RF').length).toBeGreaterThan(0);
        });

        const row = document.querySelector<HTMLElement>('[data-row-id="000A1B2C3D4E5F"]')!;
        await waitFor(() => {
            expect(within(row).getByLabelText('CONFIG_PENDING')).toBeTruthy();
        });
        expect(within(row).getByLabelText('CONFIG_PENDING').getAttribute('title')).toContain('übertragen');
        expect(screen.getByTestId('repair-000A1B2C3D4E5F')).toBeTruthy();
    });
});

describe('the repair dialog', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
    });

    it('works the repair out without writing, and only writes when it is confirmed', async () => {
        const {stores} = await mountApp({transport, hash: '#/HmIP-RF/devices'});
        await waitFor(() => {
            expect(stores.devices.devices('HmIP-RF').length).toBeGreaterThan(0);
        });
        await fireEvent.click(document.querySelector('[data-row-id="000A1B2C3D4E5F"]')!);
        await fireEvent.click(screen.getByTestId('devices-repair'));

        await waitFor(() => {
            expect(screen.getByTestId('repair-corrections')).toBeTruthy();
        });
        expect(transport.lastCall('devices.repairConfig')).toEqual(['HmIP-RF', '000A1B2C3D4E5F', {dryRun: true}]);
        expect(screen.getByTestId('repair-corrections').textContent).toContain('TRANSMIT_TRY_MAX');
        expect(screen.getByTestId('repair-corrections').textContent).toContain('above MAX 10');

        await fireEvent.click(screen.getByTestId('repair-confirm'));
        await waitFor(() => {
            expect(screen.getByTestId('repair-results')).toBeTruthy();
        });
        expect(transport.lastCall('devices.repairConfig')).toEqual(['HmIP-RF', '000A1B2C3D4E5F', {}]);
        expect(screen.getByTestId('repair-pending-after').textContent).toBe('false');
    });

    it('says plainly that an unrepairable channel needs re-pairing', async () => {
        transport.respond('devices.repairConfig', (interfaceName, address) => ({
            interfaceName,
            address,
            channels: [],
            unrepairable: [`${address}:2`],
        }));
        const {stores} = await mountApp({transport, hash: '#/HmIP-RF/devices'});
        await waitFor(() => {
            expect(stores.devices.devices('HmIP-RF').length).toBeGreaterThan(0);
        });
        await fireEvent.click(document.querySelector('[data-row-id="000A1B2C3D4E5F"]')!);
        await fireEvent.click(screen.getByTestId('devices-repair'));

        await waitFor(() => {
            expect(screen.getByTestId('repair-unrepairable')).toBeTruthy();
        });
        expect(screen.getByTestId('repair-unrepairable').textContent).toContain('neu angelernt');
        expect(screen.getByTestId('repair-nothing')).toBeTruthy();
    });

    it('offers the two BidCos recoveries only on BidCos, and passes the choice on', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await fireEvent.click(document.querySelector('[data-row-id="MEQ0123456"]')!);
        await fireEvent.click(screen.getByTestId('devices-repair'));

        await waitFor(() => {
            expect(screen.getByTestId('repair-bidcos-note')).toBeTruthy();
        });
        const select = screen.getByTestId('repair-recovery') as HTMLSelectElement;
        expect([...select.options].map((option) => option.value)).toEqual([
            'none',
            'clearConfigCache',
            'restoreConfigToDevice',
        ]);

        await fireEvent.change(select, {target: {value: 'restoreConfigToDevice'}});
        await fireEvent.click(screen.getByTestId('repair-confirm'));

        await waitFor(() => {
            expect(transport.lastCall('devices.repairConfig')).toEqual([
                'BidCos-RF',
                'MEQ0123456',
                {bidcosRecovery: 'restoreConfigToDevice'},
            ]);
        });
    });

    it('has no BidCos recovery and no "normal" note on HmIP - those methods answer -1 there', async () => {
        const {stores} = await mountApp({transport, hash: '#/HmIP-RF/devices'});
        await waitFor(() => {
            expect(stores.devices.devices('HmIP-RF').length).toBeGreaterThan(0);
        });
        await fireEvent.click(document.querySelector('[data-row-id="000A1B2C3D4E5F"]')!);
        await fireEvent.click(screen.getByTestId('devices-repair'));

        await waitFor(() => {
            expect(screen.getByTestId('repair-corrections')).toBeTruthy();
        });
        expect(screen.queryByTestId('repair-recovery')).toBeNull();
        expect(screen.queryByTestId('repair-bidcos-note')).toBeNull();
    });
});

describe('the read-back after a write', () => {
    const description = {
        TRANSMIT_TRY_MAX: {TYPE: 'INTEGER', OPERATIONS: 3, MIN: 1, MAX: 10},
        LOGGING: {TYPE: 'ENUM', OPERATIONS: 3, VALUE_LIST: ['OFF', 'ON']},
    };

    it('reports a value the interface silently clamped', () => {
        expect(readBack({TRANSMIT_TRY_MAX: 62}, {TRANSMIT_TRY_MAX: 10}, description)).toEqual([
            {param: 'TRANSMIT_TRY_MAX', sent: '62', stored: '10', differs: true},
        ]);
    });

    it('reports a value the interface dropped altogether', () => {
        expect(readBack({TRANSMIT_TRY_MAX: 6}, {}, description)).toEqual([
            {param: 'TRANSMIT_TRY_MAX', sent: '6', stored: '—', differs: true},
        ]);
    });

    it('is quiet when what came back is what went out, enum names included', () => {
        expect(readBack({LOGGING: 1}, {LOGGING: 1}, description)).toEqual([
            {param: 'LOGGING', sent: 'ON', stored: 'ON', differs: false},
        ]);
    });

    it('shows the read-back in the preview and keeps it open when the values differ', async () => {
        const transport = new MockTransport({demo: true});
        // The write answers ok, but the paramset comes back with a different value - rfd's habit.
        transport.respond('paramset.get', (_interfaceName, _address, paramset) =>
            paramset === 'MASTER' ? {LOGGING: 1, TRANSMIT_TRY_MAX: 6, ON_TIME: 111_600, STATUSINFO_MINDELAY: 2} : {},
        );
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        const parent = document.querySelector<HTMLElement>('[data-row-id="MEQ0123456"]')!;
        await fireEvent.click(within(parent).getByRole('button', {name: 'Expand row'}));
        await fireEvent.click(screen.getByTestId('paramset-MEQ0123456:1-MASTER'));
        await waitFor(() => {
            expect(screen.getByTestId('param-LOGGING')).toBeTruthy();
        });

        await fireEvent.change(within(screen.getByTestId('param-LOGGING')).getByRole('combobox'), {
            target: {value: '0'},
        });
        await fireEvent.click(screen.getByTestId('paramset-preview'));
        await fireEvent.click(screen.getByTestId('write-confirm'));

        await waitFor(() => {
            expect(screen.getByTestId('readback-LOGGING')).toBeTruthy();
        });
        expect(screen.getByTestId('readback-LOGGING').textContent).toContain('OFF');
        expect(screen.getByTestId('readback-LOGGING').textContent).toContain('ON');
        expect(screen.getByTestId('readback-warning')).toBeTruthy();
        expect(screen.getByTestId('write-preview').hasAttribute('open')).toBe(true);
    });

    it('prints the exact struct that goes out, per target', async () => {
        const transport = new MockTransport({demo: true});
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        const parent = document.querySelector<HTMLElement>('[data-row-id="MEQ0123456"]')!;
        await fireEvent.click(within(parent).getByRole('button', {name: 'Expand row'}));
        await fireEvent.click(screen.getByTestId('paramset-MEQ0123456:1-MASTER'));
        await waitFor(() => {
            expect(screen.getByTestId('param-LOGGING')).toBeTruthy();
        });

        await fireEvent.change(within(screen.getByTestId('param-LOGGING')).getByRole('combobox'), {
            target: {value: '0'},
        });
        await fireEvent.click(screen.getByTestId('paramset-preview'));

        await waitFor(() => {
            expect(screen.getByTestId('preview-call-MEQ0123456:1')).toBeTruthy();
        });
        const call = screen.getByTestId('preview-call-MEQ0123456:1').textContent ?? '';
        expect(call).toContain('MEQ0123456:1');
        expect(call).toContain('MASTER');
        expect(call).toContain('{"LOGGING":0}');
    });
});
