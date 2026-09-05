import {fireEvent, screen, waitFor} from '@testing-library/svelte';
import {beforeEach, describe, expect, it} from 'vitest';

import {isDeviceKey, isSgtin, normaliseKeyText, parseHmipCode} from '../../lib/util/hmipKey.js';
import {MockTransport} from '../../lib/transport/MockTransport.js';
import {mountApp} from '../../testHarness.js';

describe('the HmIP pairing data', () => {
    it('accepts what a QR code really contains', () => {
        // plain concatenation, the common eQ-3 form
        expect(parseHmipCode('3014F711A000000000000001' + 'ABCDEFGHJKLMNPQR')).toEqual({
            sgtin: '3014F711A000000000000001',
            key: 'ABCDEFGHJKLMNPQR',
        });
        // with separators and lower case
        expect(parseHmipCode('3014f711-a000-0000-0000-0001 abcdefghjklmnpqr')).toEqual({
            sgtin: '3014F711A000000000000001',
            key: 'ABCDEFGHJKLMNPQR',
        });
        // the labelled form
        expect(parseHmipCode('S:3014F711A000000000000001,K:ABCDEFGHJKLMNPQR')).toEqual({
            sgtin: '3014F711A000000000000001',
            key: 'ABCDEFGHJKLMNPQR',
        });
        // a code that carries the SGTIN only; the key is typed from the sticker
        expect(parseHmipCode('3014F711A000000000000001')).toEqual({
            sgtin: '3014F711A000000000000001',
            key: '',
        });
    });

    it('refuses anything that is not a device code', () => {
        expect(parseHmipCode('https://example.invalid/')).toBeUndefined();
        expect(parseHmipCode('')).toBeUndefined();
        expect(parseHmipCode('3014F711')).toBeUndefined();
    });

    it('validates the two fields on their own', () => {
        expect(isSgtin('3014F711A000000000000001')).toBe(true);
        expect(isSgtin('3014F711A00000000000000')).toBe(false);
        expect(isSgtin('3014G711A000000000000001')).toBe(false);
        expect(isDeviceKey('ABCDEFGHJKLMNPQR')).toBe(true);
        expect(isDeviceKey('ABCDEFGHJKLMNPQ')).toBe(false);
        expect(normaliseKeyText(' ab-cd ')).toBe('ABCD');
    });
});

describe('the add-device dialog', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
    });

    it('starts the BidCos install mode with the mode and the temporary key (#20)', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await fireEvent.click(screen.getByTestId('devices-add'));

        await fireEvent.change(screen.getByTestId('add-device-mode'), {target: {value: '2'}});
        await fireEvent.input(screen.getByTestId('add-device-temp-key'), {target: {value: 'SECRET'}});
        await fireEvent.click(screen.getByTestId('add-device-start'));

        await waitFor(() => {
            expect(transport.lastCall('devices.installMode.set')).toEqual([
                'BidCos-RF',
                true,
                {seconds: 60, mode: 2, tempKey: 'SECRET'},
            ]);
        });
        expect(screen.getByTestId('add-device-countdown')).toBeTruthy();
    });

    it('adds a device by its serial number without opening an install mode, as 2.7 did', async () => {
        // homematic-manager.js:1215 had its own button for this: `addDevice(serial, mode)` alone,
        // no `setInstallMode`, so nothing counts down and the duration is not part of it
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await fireEvent.click(screen.getByTestId('devices-add'));

        expect(screen.getByTestId<HTMLButtonElement>('add-device-serial-start').disabled).toBe(true);
        await fireEvent.change(screen.getByTestId('add-device-mode'), {target: {value: '2'}});
        await fireEvent.input(screen.getByTestId('add-device-serial'), {target: {value: ' MEQ0000009 '}});
        await fireEvent.input(screen.getByTestId('add-device-temp-key'), {target: {value: 'SECRET'}});
        await waitFor(() => {
            expect(screen.getByTestId<HTMLButtonElement>('add-device-serial-start').disabled).toBe(false);
        });
        await fireEvent.click(screen.getByTestId('add-device-serial-start'));

        await waitFor(() => {
            expect(transport.lastCall('devices.installMode.set')).toEqual([
                'BidCos-RF',
                true,
                {seconds: 60, mode: 2, address: 'MEQ0000009', tempKey: 'SECRET'},
            ]);
        });
        expect(screen.queryByTestId('add-device-countdown')).toBeNull();
        expect(screen.queryByTestId('add-device-stop')).toBeNull();
    });

    it('does not send the serial with the timed install mode', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await fireEvent.click(screen.getByTestId('devices-add'));
        await fireEvent.input(screen.getByTestId('add-device-serial'), {target: {value: 'MEQ0000009'}});
        await fireEvent.click(screen.getByTestId('add-device-start'));

        await waitFor(() => {
            expect(transport.lastCall('devices.installMode.set')).toEqual(['BidCos-RF', true, {seconds: 60, mode: 1}]);
        });
    });

    it('leaves the optional BidCos fields out when they are empty', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await fireEvent.click(screen.getByTestId('devices-add'));
        await fireEvent.click(screen.getByTestId('add-device-start'));

        await waitFor(() => {
            expect(transport.lastCall('devices.installMode.set')).toEqual(['BidCos-RF', true, {seconds: 60, mode: 1}]);
        });
    });

    it('stops the install mode again', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await fireEvent.click(screen.getByTestId('devices-add'));
        await fireEvent.click(screen.getByTestId('add-device-start'));
        await waitFor(() => {
            expect(screen.getByTestId('add-device-stop')).toBeTruthy();
        });
        await fireEvent.click(screen.getByTestId('add-device-stop'));

        await waitFor(() => {
            expect(transport.lastCall('devices.installMode.set')).toEqual(['BidCos-RF', false, undefined]);
        });
    });

    it('needs a valid SGTIN and key before it will start an HmIP pairing', async () => {
        const {stores} = await mountApp({transport, hash: '#/HmIP-RF/devices'});
        await waitFor(() => {
            expect(stores.devices.devices('HmIP-RF').length).toBeGreaterThan(0);
        });
        await fireEvent.click(screen.getByTestId('devices-add'));

        expect(screen.getByTestId<HTMLButtonElement>('add-device-start').disabled).toBe(true);
        await fireEvent.input(screen.getByTestId('add-device-sgtin'), {
            target: {value: '3014F711A000000000000001'},
        });
        expect(screen.getByTestId<HTMLButtonElement>('add-device-start').disabled).toBe(true);
        await fireEvent.input(screen.getByTestId('add-device-key'), {target: {value: 'ABCDEFGHJKLMNPQR'}});

        await waitFor(() => {
            expect(screen.getByTestId<HTMLButtonElement>('add-device-start').disabled).toBe(false);
        });
        await fireEvent.click(screen.getByTestId('add-device-start'));
        await waitFor(() => {
            expect(transport.lastCall('devices.installMode.set')).toEqual([
                'HmIP-RF',
                true,
                {
                    seconds: 60,
                    hmipKeyMode: 'KEY',
                    hmipKey: {sgtin: '3014F711A000000000000001', key: 'ABCDEFGHJKLMNPQR'},
                },
            ]);
        });
    });

    it('needs only the SGTIN in key-server mode', async () => {
        const {stores} = await mountApp({transport, hash: '#/HmIP-RF/devices'});
        await waitFor(() => {
            expect(stores.devices.devices('HmIP-RF').length).toBeGreaterThan(0);
        });
        await fireEvent.click(screen.getByTestId('devices-add'));
        await fireEvent.change(screen.getByTestId('add-device-hmip-mode'), {target: {value: 'SGTIN'}});
        await fireEvent.input(screen.getByTestId('add-device-sgtin'), {
            target: {value: '3014F711A000000000000001'},
        });

        await waitFor(() => {
            expect(screen.queryByTestId('add-device-key')).toBeNull();
        });
        await fireEvent.click(screen.getByTestId('add-device-start'));
        await waitFor(() => {
            expect(transport.lastCall('devices.installMode.set')?.[2]).toEqual({
                seconds: 60,
                hmipKeyMode: 'SGTIN',
                hmipKey: {sgtin: '3014F711A000000000000001', key: ''},
            });
        });
    });

    it('does not open the camera until the scanner is switched on, and reports a failure (#112)', async () => {
        const {stores} = await mountApp({transport, hash: '#/HmIP-RF/devices'});
        await waitFor(() => {
            expect(stores.devices.devices('HmIP-RF').length).toBeGreaterThan(0);
        });
        await fireEvent.click(screen.getByTestId('devices-add'));

        // 2.x had the scanner running whenever the dialog was open; here nothing films yet.
        expect(screen.queryByTestId('add-device-video')).toBeNull();

        await fireEvent.click(screen.getByTestId('add-device-scan'));
        await waitFor(() => {
            expect(screen.getByTestId('add-device-video')).toBeTruthy();
        });

        // jsdom has no camera: the failure becomes a message in the dialog, never an exception.
        await waitFor(
            () => {
                expect(screen.getByTestId('add-device-scan-error')).toBeTruthy();
            },
            {timeout: 3000},
        );
    });

    it('names a device that was paired while the dialog was open (#24)', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await fireEvent.click(screen.getByTestId('devices-add'));

        transport.emit('devices.changed', {
            interfaceName: 'BidCos-RF',
            kind: 'new',
            addresses: ['NEQ0000001', 'NEQ0000001:1'],
        });

        const section = await waitFor(() => screen.getByTestId('add-device-paired'));
        expect(section.textContent).toContain('NEQ0000001');
        // The channels are not offered; the device is what gets a name.
        expect(section.textContent).not.toContain('NEQ0000001:1');

        await fireEvent.input(screen.getByLabelText('Name NEQ0000001'), {target: {value: 'Neue Lampe'}});
        await fireEvent.click(screen.getByTestId('add-device-name-save'));

        await waitFor(() => {
            expect(transport.lastCall('names.set')).toEqual([[{address: 'NEQ0000001', name: 'Neue Lampe'}]]);
        });
    });

    it('offers searchDevices instead of an install mode on BidCos-Wired', async () => {
        transport.result('interfaces.list', [
            {
                name: 'BidCos-Wired',
                type: 'BidCos-Wired',
                protocol: 'xmlrpc',
                host: 'demo.local',
                port: 2000,
                connected: true,
            },
        ]);
        transport.respond('config.get', () => ({
            version: '3.0.0-dev.0',
            connection: {
                host: 'demo.local',
                interfaces: ['BidCos-Wired'],
                autoDetect: true,
                extraInterfaces: [],
                tls: false,
                rega: true,
                callback: {ip: '192.168.1.20', xmlrpcPort: 0, binrpcPort: 0},
                language: 'de' as const,
                writePaceMs: 250,
                rpcLogFolder: '',
            },
            localAddresses: [],
            discovered: [],
        }));
        transport.result('devices.list', []);
        await mountApp({transport, hash: '#/BidCos-Wired/devices'});
        await fireEvent.click(screen.getByTestId('devices-add'));

        await waitFor(() => {
            expect(screen.getByTestId('add-device-search')).toBeTruthy();
        });
        expect(screen.queryByTestId('add-device-start')).toBeNull();

        await fireEvent.click(screen.getByTestId('add-device-search'));
        await waitFor(() => {
            expect(transport.lastCall('rpc.call')).toEqual(['BidCos-Wired', 'searchDevices', ['']]);
        });
    });
});

describe('the ReGa inbox (#54)', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
    });

    it('offers to confirm the inbox and says what it confirmed', async () => {
        transport.result('rega.confirmInbox', ['MEQ0123456']);
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await fireEvent.click(screen.getByTestId('devices-add'));

        await fireEvent.click(screen.getByTestId('add-device-confirm-inbox'));
        await waitFor(() => {
            expect(screen.getByTestId('add-device-inbox-result').textContent).toContain('MEQ0123456');
        });
    });

    it('says the inbox is empty rather than nothing at all', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await fireEvent.click(screen.getByTestId('devices-add'));
        await fireEvent.click(screen.getByTestId('add-device-confirm-inbox'));
        await waitFor(() => {
            expect(screen.getByTestId('add-device-inbox-result').textContent).toContain('leer');
        });
    });

    it('is not offered at all without ReGa (D-2)', async () => {
        transport.result('rega.state', {enabled: false, reachable: false, names: 0});
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await fireEvent.click(screen.getByTestId('devices-add'));
        expect(screen.queryByTestId('add-device-confirm-inbox')).toBeNull();
    });
});
