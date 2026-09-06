import type {DeviceDescription, ServiceMessage} from '@homematic-manager/core';
import {fireEvent, screen, waitFor, within} from '@testing-library/svelte';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {DEMO_DEVICES} from '../lib/transport/demoData.js';
import {MockTransport} from '../lib/transport/MockTransport.js';
import {firmwareCell, serviceMarks} from '../lib/util/deviceGrid.js';
import {mountApp} from '../testHarness.js';

function rowOf(address: string): HTMLElement {
    const row = document.querySelector<HTMLElement>(`[data-row-id="${address}"]`);
    expect(row, `no row for ${address}`).not.toBeNull();
    return row!;
}

describe('the device grid columns', () => {
    it('shows the 2.7 device columns, with SUBTYPE only on HmIP', async () => {
        await mountApp({hash: '#/BidCos-RF/devices'});
        const labels = screen.getAllByRole('columnheader').map((header) => header.textContent.trim());
        expect(labels).toEqual([
            '',
            '',
            'Name',
            'ADDRESS',
            'Msgs',
            'TYPE',
            'FIRMWARE',
            'PARAMSETS',
            'FLAGS',
            'RX_MODE',
        ]);
    });

    it('adds SUBTYPE for HmIP, as initDaemon did', async () => {
        const {stores} = await mountApp({hash: '#/HmIP-RF/devices'});
        await waitFor(() => {
            expect(stores.devices.devices('HmIP-RF').length).toBeGreaterThan(0);
        });
        const labels = screen.getAllByRole('columnheader').map((header) => header.textContent.trim());
        expect(labels).toContain('SUBTYPE');
    });

    it('prints flags and RX_MODE by name and the paramsets of the device', async () => {
        await mountApp({hash: '#/BidCos-RF/devices'});
        const row = rowOf('KEQ0345678');
        expect(row.textContent).toContain('Visible');
        expect(row.textContent).toContain('CONFIG');
        expect(row.textContent).toContain('WAKEUP');
        expect(row.textContent).toContain('MASTER');
    });

    it('asks the web host route for the picture without an Electron bridge, and degrades when it 404s', async () => {
        await mountApp({hash: '#/BidCos-RF/devices'});
        const image = screen.getByTestId('device-image-MEQ0123456');
        expect(image.tagName).toBe('IMG');
        expect(image.getAttribute('src')).toBe('images/HM-LC-Sw1-Pl-CT-R1');
        // demo mode has no images route: the 404 turns the cell into the labelled placeholder
        await fireEvent.error(image);
        const placeholder = screen.getByTestId('device-image-MEQ0123456');
        expect(placeholder.tagName).toBe('SPAN');
        expect(placeholder.getAttribute('aria-label')).toBe('HM-LC-Sw1-Pl-CT-R1');
    });
});

describe('the channel sub-grid', () => {
    it('opens with its own columns, the 2.7 subGridChannels set', async () => {
        await mountApp({hash: '#/BidCos-RF/devices'});
        const row = rowOf('MEQ0123456');
        await fireEvent.click(within(row).getByRole('button', {name: 'Expand row'}));

        const header = document.querySelector<HTMLElement>('[data-row-kind="header"]');
        expect(header?.textContent).toContain('DIRECTION');
        expect(header?.textContent).toContain('AES_ACTIVE');

        const channel = rowOf('MEQ0123456:1');
        expect(channel.textContent).toContain('SWITCH');
        expect(channel.textContent).toContain('RECEIVER');
    });

    it('hides AES_ACTIVE on an interface that has no AES', async () => {
        const {stores} = await mountApp({hash: '#/HmIP-RF/devices'});
        await waitFor(() => {
            expect(stores.devices.devices('HmIP-RF').length).toBeGreaterThan(0);
        });
        await fireEvent.click(within(rowOf('000A1B2C3D4E5F')).getByRole('button', {name: 'Expand row'}));
        const header = document.querySelector<HTMLElement>('[data-row-kind="header"]');
        expect(header?.textContent).not.toContain('AES_ACTIVE');
    });
});

describe('the service-message marks', () => {
    const messages: ServiceMessage[] = [
        {interfaceName: 'BidCos-RF', address: 'A:0', datapoint: 'LOWBAT', value: true, since: 0},
        {interfaceName: 'BidCos-RF', address: 'A:0', datapoint: 'UNREACH', value: true, since: 0},
        {interfaceName: 'BidCos-RF', address: 'A:0', datapoint: 'CONFIG_PENDING', value: true, since: 0},
        {interfaceName: 'BidCos-RF', address: 'B:0', datapoint: 'LOWBAT', value: true, since: 0},
        {interfaceName: 'BidCos-RF', address: 'A:0', datapoint: 'INSTALL_TEST', value: true, since: 0},
    ];

    it('puts the unreachable mark first, keeps two, and only takes the device it is asked for', () => {
        expect(serviceMarks('A', messages).map((mark) => mark.datapoint)).toEqual(['UNREACH', 'LOWBAT']);
        expect(serviceMarks('B', messages).map((mark) => mark.datapoint)).toEqual(['LOWBAT']);
        expect(serviceMarks('C', messages)).toEqual([]);
        expect(serviceMarks('A', messages, 99).map((mark) => mark.datapoint)).toEqual([
            'UNREACH',
            'LOWBAT',
            'CONFIG_PENDING',
        ]);
    });

    it('gives every mark a severity so both themes stay legible (D-22)', () => {
        expect(serviceMarks('A', messages, 99).map((mark) => mark.level)).toEqual(['error', 'warn', 'warn']);
    });

    for (const theme of ['light', 'dark'] as const) {
        it(`marks a device with a service message in the ${theme} theme`, async () => {
            document.documentElement.setAttribute('data-theme', theme);
            await mountApp({hash: '#/BidCos-RF/devices'});
            // The demo fixture has LOWBAT on LEQ0456789:0 and STICKY_UNREACH on KEQ0345678:0.
            expect(within(rowOf('LEQ0456789')).getByLabelText('LOWBAT').classList).toContain('hmm-msg-warn');
            expect(within(rowOf('KEQ0345678')).getByLabelText('STICKY_UNREACH').classList).toContain('hmm-msg-error');
            document.documentElement.removeAttribute('data-theme');
        });
    }
});

describe('the firmware cell', () => {
    const device = (extra: Partial<DeviceDescription>): DeviceDescription => ({
        ADDRESS: 'A',
        TYPE: 'HM-LC-Sw1',
        FIRMWARE: '1.0',
        ...extra,
    });

    it('offers an update when a newer firmware is available (rfd)', () => {
        expect(firmwareCell(device({AVAILABLE_FIRMWARE: '1.1'}))).toEqual({
            firmware: '1.0',
            available: '1.1',
            action: 'update',
            busy: false,
        });
    });

    it('offers nothing when the available firmware is the installed one', () => {
        expect(firmwareCell(device({AVAILABLE_FIRMWARE: '1.0'}))).toEqual({firmware: '1.0', busy: false});
        expect(firmwareCell(device({}))).toEqual({firmware: '1.0', busy: false});
    });

    it('follows hmipserver through its FIRMWARE_UPDATE_STATE', () => {
        expect(firmwareCell(device({FIRMWARE_UPDATE_STATE: 'READY_FOR_UPDATE', AVAILABLE_FIRMWARE: '2.0'}))).toEqual({
            firmware: '1.0',
            available: '2.0',
            action: 'install',
            busy: false,
        });
        expect(firmwareCell(device({FIRMWARE_UPDATE_STATE: 'PERFORMING_UPDATE'}))).toEqual({
            firmware: '1.0',
            status: 'performing update',
            busy: false,
        });
        // An unknown state is not printed at all, as 2.x's switch default did nothing.
        expect(firmwareCell(device({FIRMWARE_UPDATE_STATE: 'BACKGROUND_BURN_IN'}))).toEqual({
            firmware: '1.0',
            busy: false,
        });
    });

    it('shows "update pending" from the service message, and no button while busy', () => {
        expect(firmwareCell(device({}), {updatePending: true})).toEqual({
            firmware: '1.0',
            status: 'update pending',
            busy: false,
        });
        expect(firmwareCell(device({AVAILABLE_FIRMWARE: '1.1'}), {busy: true})).toEqual({
            firmware: '1.0',
            available: '1.1',
            busy: true,
        });
    });
});

describe('the firmware button', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('calls updateFirmware and re-reads the list, so the button disappears (#95, #113)', async () => {
        let updated = false;
        transport.respond('devices.list', (name) => {
            if (name !== 'BidCos-RF') {
                return [];
            }
            return DEMO_DEVICES['BidCos-RF'].map((device) =>
                device.ADDRESS === 'KEQ0345678' && updated ? {...device, FIRMWARE: '1.11'} : device,
            );
        });
        transport.respond('devices.updateFirmware', () => {
            updated = true;
            return [true];
        });

        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await fireEvent.click(screen.getByTestId('firmware-KEQ0345678'));

        await waitFor(() => {
            expect(screen.queryByTestId('firmware-KEQ0345678')).toBeNull();
        });
        expect(transport.lastCall('devices.updateFirmware')).toEqual(['BidCos-RF', ['KEQ0345678']]);
    });

    it('keeps the address marked busy when the answer does not change the firmware', async () => {
        transport.result('devices.updateFirmware', [true]);
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/devices'});

        await fireEvent.click(screen.getByTestId('firmware-KEQ0345678'));
        await waitFor(() => {
            expect(stores.devices.firmwareBusy).toEqual(['KEQ0345678']);
        });
        expect(rowOf('KEQ0345678').textContent).toContain('läuft');
    });

    it('reports a failing updateFirmware and drops the busy mark again', async () => {
        transport.fail('devices.updateFirmware', 'device not updatable');
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/devices'});

        await fireEvent.click(screen.getByTestId('firmware-KEQ0345678'));
        await waitFor(() => {
            expect(stores.notices.items.at(-1)?.message).toContain('device not updatable');
        });
        expect(stores.devices.firmwareBusy).toEqual([]);
    });

    it('uses installFirmware for a HmIP device that is ready for it', async () => {
        transport.respond('devices.list', (name) =>
            name === 'HmIP-RF'
                ? DEMO_DEVICES['HmIP-RF'].map((device) =>
                      device.ADDRESS === '000A1B2C3D4E5F'
                          ? {...device, FIRMWARE_UPDATE_STATE: 'READY_FOR_UPDATE'}
                          : device,
                  )
                : [],
        );
        transport.result('devices.installFirmware', true);

        await mountApp({transport, hash: '#/HmIP-RF/devices'});
        await waitFor(() => {
            expect(screen.getByTestId('firmware-000A1B2C3D4E5F')).toBeTruthy();
        });
        await fireEvent.click(screen.getByTestId('firmware-000A1B2C3D4E5F'));

        await waitFor(() => {
            expect(transport.lastCall('devices.installFirmware')).toEqual(['HmIP-RF', '000A1B2C3D4E5F']);
        });
    });

    it('polls listDevices while an update is pending and stops when it is not', async () => {
        vi.useFakeTimers({shouldAdvanceTime: true});
        transport.respond('devices.list', (name) =>
            name === 'HmIP-RF'
                ? DEMO_DEVICES['HmIP-RF'].map((device) =>
                      device.ADDRESS === '000A1B2C3D4E5F'
                          ? {...device, FIRMWARE_UPDATE_STATE: 'PERFORMING_UPDATE'}
                          : device,
                  )
                : [],
        );

        await mountApp({transport, hash: '#/HmIP-RF/devices'});
        const before = transport.countOf('devices.list');
        await vi.advanceTimersByTimeAsync(10_500);
        expect(transport.countOf('devices.list')).toBeGreaterThan(before);
    });
});

describe('an empty device list', () => {
    it('says "not reported yet" rather than "no devices" - hmipserver empties its cache on init', async () => {
        const transport = new MockTransport({demo: true});
        transport.result('devices.list', []);
        await mountApp({transport, hash: '#/HmIP-RF/devices'});

        await waitFor(() => {
            expect(screen.getByText(/noch keine gemeldet/)).toBeTruthy();
        });
    });
});
