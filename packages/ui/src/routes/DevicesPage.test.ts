import type {DeviceDescription, ParamsetDescription, ServiceMessage} from '@homematic-manager/core';
import {fireEvent, screen, waitFor, within} from '@testing-library/svelte';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {DEMO_DEVICES, isDemoInterface} from '../lib/transport/demoData.js';
import {MockTransport} from '../lib/transport/MockTransport.js';
import {
    firmwareCell,
    offeredParamsets,
    PARAMSETS_COLUMN_WIDTH,
    SERVICE_MARKS_COLUMN_WIDTH,
    serviceMarks,
    type ParamsetContent,
} from '../lib/util/deviceGrid.js';
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
            'Räume',
            'Gewerke',
            // task 58: only because the demo's BidCos-RF has a smoke detector team
            'Rauchmeldergruppe',
            'Msgs',
            'TYPE',
            'FIRMWARE',
            'PARAMSETS',
            'FLAGS',
            'INTERFACE',
            'RX_MODE',
        ]);
    });

    it('names the receiver a BidCos-RF device is routed through, from the gateway list (B-2, #142)', async () => {
        const transport = new MockTransport({demo: true});
        const {stores} = await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await waitFor(() => {
            expect(stores.radio.gateways('BidCos-RF')).toHaveLength(1);
        });
        // INTERFACE is `BidCoS-RF`, the serial of the demo's coprocessor; the grid says its name
        await waitFor(() => {
            expect(screen.getByTestId('receiver-MEQ0123456').textContent).toBe('CCU2-Coprocessor');
        });
        expect(rowOf('MEQ0123456').textContent).not.toContain('⇄');
        // the device grid reads the gateway list alone - the matrix is the Funk tab's business
        expect(transport.countOf('bidcos.interfaces')).toBe(1);
        expect(transport.countOf('rssi.get')).toBe(0);
    });

    it('shows the serial when the gateway has no description, and marks roaming (B-2)', async () => {
        const transport = new MockTransport({demo: true});
        transport.result('bidcos.interfaces', [{ADDRESS: 'OEQ0328853', TYPE: 'HMLGW2', DESCRIPTION: ''}]);
        transport.respond('devices.list', (interfaceName) =>
            isDemoInterface(interfaceName)
                ? DEMO_DEVICES[interfaceName].map((device) =>
                      device.ADDRESS === 'MEQ0123456' ? {...device, INTERFACE: 'OEQ0328853', ROAMING: 1} : device,
                  )
                : [],
        );
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await waitFor(() => {
            expect(screen.getByTestId('receiver-MEQ0123456').textContent).toBe('OEQ0328853');
        });
        expect(within(rowOf('MEQ0123456')).getByLabelText('ROAMING')).toBeTruthy();
        // a device whose receiver the gateway list does not know keeps the serial
        expect(screen.getByTestId('receiver-JEQ0234567').textContent).toBe('BidCoS-RF');
    });

    it('has no INTERFACE column on HmIP, which has no receivers (B-2)', async () => {
        const {stores} = await mountApp({hash: '#/HmIP-RF/devices'});
        await waitFor(() => {
            expect(stores.devices.devices('HmIP-RF').length).toBeGreaterThan(0);
        });
        const labels = screen.getAllByRole('columnheader').map((header) => header.textContent.trim());
        expect(labels).not.toContain('INTERFACE');
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

describe('the paramset buttons (B-33)', () => {
    it('offers what is listed and described with parameters, never LINK, and nothing it has no answer for yet', () => {
        const contents: Record<string, ParamsetContent> = {
            MASTER: 'empty',
            VALUES: 'parameters',
            SERVICE: 'failed',
            LINK: 'parameters',
        };
        expect(offeredParamsets(['MASTER', 'VALUES', 'LINK', 'SERVICE'], (name) => contents[name])).toEqual({
            names: ['VALUES', 'SERVICE'],
            pending: false,
        });
        expect(
            offeredParamsets(['MASTER', 'VALUES'], (name) => (name === 'MASTER' ? undefined : 'parameters')),
        ).toEqual({
            names: ['VALUES'],
            pending: true,
        });
        // #143: a string where a list belongs, and no list at all
        expect(offeredParamsets('MASTER VALUES', () => 'parameters')).toEqual({
            names: ['MASTER', 'VALUES'],
            pending: false,
        });
        expect(offeredParamsets(undefined, () => 'parameters')).toEqual({names: [], pending: false});
    });

    it('never offers SERVICE on a channel, and does not ask about it there (the maintainer, 2026-09-13)', () => {
        const asked: string[] = [];
        const contentOf = (name: string): ParamsetContent => {
            asked.push(name);
            return 'parameters';
        };
        expect(offeredParamsets(['MASTER', 'VALUES', 'SERVICE'], contentOf, {channel: true})).toEqual({
            names: ['MASTER', 'VALUES'],
            pending: false,
        });
        expect(asked).toEqual(['MASTER', 'VALUES']);
        expect(offeredParamsets(['MASTER', 'SERVICE'], () => 'parameters', {channel: false}).names).toEqual([
            'MASTER',
            'SERVICE',
        ]);
    });

    /**
     * The lab's HmIPW-DRS8 on hmipserver 3.89.8 (2026-09-13): the device lists MASTER and SERVICE,
     * and its MASTER is empty; the channels list SERVICE too and describe it with the device's five
     * parameters - and still get no SERVICE button (the maintainer's decision). Channel 4 has an
     * empty VALUES, as on the DRI16's channel 17.
     */
    const DRS8 = '001618A99C5F30';
    const SERVICE: ParamsetDescription = Object.fromEntries(
        ['APPLICATION_VERSION', 'BOOTLOADER_VERSION', 'HARDWARE_VERSION', 'OS_VERSION', 'TEST_STATUS'].map((name) => [
            name,
            {TYPE: 'STRING', OPERATIONS: 1, FLAGS: 1},
        ]),
    );
    const channel = (index: number, type: string, paramsets: string[]): DeviceDescription => ({
        ADDRESS: `${DRS8}:${String(index)}`,
        TYPE: type,
        PARENT: DRS8,
        PARENT_TYPE: 'HmIPW-DRS8',
        INDEX: index,
        PARAMSETS: paramsets,
    });
    const DEVICES: DeviceDescription[] = [
        {
            ADDRESS: DRS8,
            TYPE: 'HmIPW-DRS8',
            VERSION: 1,
            FIRMWARE: '1.2.6',
            CHILDREN: [0, 1, 2, 3, 4].map((index) => `${DRS8}:${String(index)}`),
            PARAMSETS: ['MASTER', 'SERVICE'],
        },
        channel(0, 'MAINTENANCE', ['MASTER', 'VALUES', 'SERVICE']),
        channel(1, 'SWITCH_TRANSMITTER', ['MASTER', 'VALUES', 'SERVICE']),
        channel(2, 'SWITCH_VIRTUAL_RECEIVER', ['MASTER', 'VALUES', 'LINK', 'SERVICE']),
        channel(3, 'SWITCH_VIRTUAL_RECEIVER', ['MASTER', 'VALUES', 'LINK', 'SERVICE']),
        channel(4, 'ALARM_COND_SWITCH_TRANSMITTER', ['MASTER', 'VALUES', 'SERVICE']),
    ];
    const LOGGING = {LOGGING: {TYPE: 'BOOL', OPERATIONS: 7, FLAGS: 1}} satisfies ParamsetDescription;
    const DESCRIPTIONS: Record<string, ParamsetDescription> = {
        '|MASTER': {},
        '|SERVICE': SERVICE,
        // MAINTENANCE MASTER is empty here, but the dialog has service messages to suppress
        'MAINTENANCE|MASTER': {},
        'MAINTENANCE|VALUES': {UNREACH: {TYPE: 'BOOL', OPERATIONS: 5, FLAGS: 9}},
        'MAINTENANCE|SERVICE': SERVICE,
        'SWITCH_TRANSMITTER|MASTER': LOGGING,
        'SWITCH_TRANSMITTER|VALUES': {STATE: {TYPE: 'BOOL', OPERATIONS: 5, FLAGS: 1}},
        'SWITCH_TRANSMITTER|SERVICE': SERVICE,
        'SWITCH_VIRTUAL_RECEIVER|MASTER': LOGGING,
        'SWITCH_VIRTUAL_RECEIVER|VALUES': {STATE: {TYPE: 'BOOL', OPERATIONS: 7, FLAGS: 1}},
        'SWITCH_VIRTUAL_RECEIVER|SERVICE': SERVICE,
        'ALARM_COND_SWITCH_TRANSMITTER|MASTER': LOGGING,
        'ALARM_COND_SWITCH_TRANSMITTER|VALUES': {},
        'ALARM_COND_SWITCH_TRANSMITTER|SERVICE': {},
    };

    async function mountDrs8(): Promise<MockTransport> {
        const transport = new MockTransport({demo: true});
        transport.respond('devices.list', (interfaceName) =>
            interfaceName === 'HmIP-RF' ? DEVICES : isDemoInterface(interfaceName) ? DEMO_DEVICES[interfaceName] : [],
        );
        transport.respond('paramset.description', (_interfaceName, address, paramset) => {
            const type = DEVICES.find((entry) => entry.ADDRESS === address && entry.PARENT !== undefined)?.TYPE ?? '';
            return DESCRIPTIONS[`${type}|${paramset}`] ?? {};
        });
        await mountApp({transport, hash: '#/HmIP-RF/devices'});
        await waitFor(() => {
            expect(rowOf(DRS8)).toBeTruthy();
        });
        await fireEvent.click(within(rowOf(DRS8)).getByRole('button', {name: 'Expand row'}));
        return transport;
    }

    async function offered(address: string): Promise<string[]> {
        const cell = await screen.findByTestId(`paramsets-${address}`);
        await waitFor(() => {
            expect(cell.getAttribute('aria-busy')).toBe('false');
        });
        return within(cell)
            .queryAllByRole('button')
            .map((button) => button.textContent.trim());
    }

    it('follows each row: SERVICE on the device only, and no empty paramset', async () => {
        const transport = await mountDrs8();

        expect(await offered(DRS8)).toEqual(['SERVICE']);
        // a filled SERVICE on every channel, channel 0 included, and no button for it
        expect(await offered(`${DRS8}:0`)).toEqual(['MASTER', 'VALUES']);
        expect(await offered(`${DRS8}:1`)).toEqual(['MASTER', 'VALUES']);
        expect(await offered(`${DRS8}:2`)).toEqual(['MASTER', 'VALUES']);
        expect(await offered(`${DRS8}:3`)).toEqual(['MASTER', 'VALUES']);
        expect(await offered(`${DRS8}:4`)).toEqual(['MASTER']);

        // one description per kind of channel: :2 and :3 are both SWITCH_VIRTUAL_RECEIVER
        const descriptions = transport.calls.filter((call) => call.method === 'paramset.description');
        const receivers = descriptions.filter((call) => /:[23]$/.test(String(call.params[1])));
        expect(receivers.map((call) => call.params[2]).sort()).toEqual(['MASTER', 'VALUES']);
        // the SERVICE of a channel is not even asked for
        expect(descriptions.filter((call) => call.params[2] === 'SERVICE').map((call) => call.params[1])).toEqual([
            DRS8,
        ]);
    });

    it('offers the same paramsets in the context menu, not a fixed set per kind of row', async () => {
        await mountDrs8();
        await offered(DRS8);
        await offered(`${DRS8}:4`);

        await fireEvent.contextMenu(rowOf(DRS8));
        const deviceItems = within(screen.getByTestId('devices-menu'))
            .getAllByRole('menuitem')
            .map((item) => item.textContent.trim());
        expect(deviceItems.slice(0, 2)).toEqual(['Umbenennen', 'SERVICE Parametersatz']);
        expect(deviceItems).not.toContain('MASTER Paramset');

        await fireEvent.contextMenu(rowOf(`${DRS8}:4`));
        await waitFor(() => {
            const labels = within(screen.getByTestId('devices-menu'))
                .getAllByRole('menuitem')
                .map((item) => item.textContent.trim());
            expect(labels.filter((label) => /Param/.test(label))).toEqual(['MASTER Paramset']);
        });

        // channel 0 has a filled SERVICE, and its menu has no entry for it either
        await offered(`${DRS8}:0`);
        await fireEvent.contextMenu(rowOf(`${DRS8}:0`));
        await waitFor(() => {
            const labels = within(screen.getByTestId('devices-menu'))
                .getAllByRole('menuitem')
                .map((item) => item.textContent.trim());
            expect(labels.filter((label) => /Param/.test(label))).toEqual(['MASTER Paramset', 'VALUES Paramset']);
        });
    });
});

describe('the Msgs column (B-34)', () => {
    const cell = (): HTMLElement => rowOf('KEQ0345678').querySelector<HTMLElement>('[data-column-key="msgs"]')!;

    it('is resizable and no fixed column, and never narrower than two marks and the repair button', async () => {
        const {stores} = await mountApp({hash: '#/BidCos-RF/devices'});
        const handle = screen.getByTestId('devices-table-resize-msgs');
        expect(cell().classList.contains('hmm-td-fixed')).toBe(false);
        expect(cell().getBoundingClientRect().width).toBeGreaterThanOrEqual(SERVICE_MARKS_COLUMN_WIDTH);

        // dragged narrow it stops there, like the button columns of B-35: a squeezed repair button
        // slides under the next cell. 30 steps of 10 px take any other column to the table's 40 px.
        for (let step = 0; step < 30; step += 1) {
            await fireEvent.keyDown(handle, {key: 'ArrowLeft'});
        }
        expect(Math.round(cell().getBoundingClientRect().width)).toBe(SERVICE_MARKS_COLUMN_WIDTH);
        expect(stores.app.columnWidths.widths('devices')['msgs']).toBe(SERVICE_MARKS_COLUMN_WIDTH);
    });

    it('draws a width stored below the minimum before it was kept at the minimum, and a wider one as it is', async () => {
        const {stores} = await mountApp({hash: '#/BidCos-RF/devices'});
        // a wider one first, so the narrow one below is seen to be drawn and not merely ignored
        stores.app.columnWidths.set('devices', 'msgs', 120);
        await waitFor(() => {
            expect(Math.round(cell().getBoundingClientRect().width)).toBe(120);
        });
        // what a drag left in the storage while the column could still go below its minimum
        stores.app.columnWidths.set('devices', 'msgs', 50);
        await waitFor(() => {
            expect(Math.round(cell().getBoundingClientRect().width)).toBe(SERVICE_MARKS_COLUMN_WIDTH);
        });
    });
});

/**
 * B-35 (#157), Herbert-Testmann on beta.16: "Die Spalte "Paramsets" kann nicht in der Breite angepasst werden."
 */
describe('the PARAMSETS and Links columns (B-35)', () => {
    it('can be resized, and PARAMSETS never gets narrower than its buttons', async () => {
        await mountApp({hash: '#/BidCos-RF/devices'});
        const handle = screen.getByTestId('devices-table-resize-PARAMSETS');
        // Links is the channel sub-grid's alone: its handle stands over the gap it leaves in the head
        expect(screen.getByTestId('devices-table-resize-links')).toBeTruthy();
        const cell = (): HTMLElement =>
            rowOf('KEQ0345678').querySelector<HTMLElement>('[data-column-key="PARAMSETS"]')!;
        expect(cell().classList.contains('hmm-td-fixed')).toBe(false);
        expect(cell().getBoundingClientRect().width).toBeGreaterThanOrEqual(PARAMSETS_COLUMN_WIDTH);

        // 30 steps of 10 px take any column to the table's 40 px; this one stops at its buttons
        for (let step = 0; step < 30; step += 1) {
            await fireEvent.keyDown(handle, {key: 'ArrowLeft'});
        }
        expect(Math.round(cell().getBoundingClientRect().width)).toBe(PARAMSETS_COLUMN_WIDTH);
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

    it('B-24: marks a thermostat whose transceiver channel reports a fault', () => {
        const fault: ServiceMessage = {
            interfaceName: 'BidCos-RF',
            address: 'LEQ0853419:4',
            datapoint: 'FAULT_REPORTING',
            value: 4,
            since: 0,
        };
        expect(serviceMarks('LEQ0853419', [fault])).toEqual([
            {datapoint: 'FAULT_REPORTING', symbol: '⚠', level: 'error', title: 'FAULT_REPORTING LEQ0853419:4'},
        ]);
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

    it('#143: a PARAMSETS that is a string does not blank the grid', async () => {
        const transport = new MockTransport({demo: true});
        // what the group process sends on the reporter's box: a string where a list belongs
        transport.result('devices.list', [
            {ADDRESS: 'INT0000001', TYPE: 'HM-RCV-50', PARENT: '', CHILDREN: 'INT0000001:1'},
            {
                ADDRESS: 'INT0000001:1',
                TYPE: 'VIRTUAL_KEY',
                PARENT: 'INT0000001',
                PARAMSETS: 'MASTER VALUES',
            },
        ] as never);
        await mountApp({transport, hash: '#/BidCos-RF/devices'});

        // the row is there and the page is not stuck on its loading text
        await waitFor(() => expect(rowOf('INT0000001')).toBeTruthy());
        expect(screen.queryByTestId('page-failed')).toBeNull();
        expect(screen.queryByText('Lade Homematic Manager...')).toBeNull();
    });

    it('#153: 0.0.0 is "no firmware", not one to install over a working version', () => {
        // an HmIP access point and the CCU's own radio module report it, with READY_FOR_UPDATE
        expect(
            firmwareCell(
                device({FIRMWARE: '4.4.18', FIRMWARE_UPDATE_STATE: 'READY_FOR_UPDATE', AVAILABLE_FIRMWARE: '0.0.0'}),
            ),
        ).toEqual({firmware: '4.4.18', busy: false});
        expect(firmwareCell(device({FIRMWARE: '3.0.18', AVAILABLE_FIRMWARE: '0.0.0'}))).toEqual({
            firmware: '3.0.18',
            busy: false,
        });
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
