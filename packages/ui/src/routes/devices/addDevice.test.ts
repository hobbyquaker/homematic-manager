import type {DeviceDescription} from '@homematic-manager/core';
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

    /** Opens the dialog on HmIP-RF once its devices are there. */
    async function openOnHmip(): Promise<void> {
        const {stores} = await mountApp({transport, hash: '#/HmIP-RF/devices'});
        await waitFor(() => {
            expect(stores.devices.devices('HmIP-RF').length).toBeGreaterThan(0);
        });
        await fireEvent.click(screen.getByTestId('devices-add'));
    }

    async function startAnyDevice(): Promise<void> {
        await fireEvent.change(screen.getByTestId('add-device-hmip-mode'), {target: {value: 'ANY'}});
        await waitFor(() => {
            expect(screen.getByTestId<HTMLButtonElement>('add-device-start').disabled).toBe(false);
        });
        await fireEvent.click(screen.getByTestId('add-device-start'));
    }

    /**
     * Task 28: a device whose sticker is unreadable, glued to a wall or gone. The third way needs no
     * field at all - the button is live as soon as it is chosen - and the contract carries `ANY`
     * without a key, which the backend turns into `setInstallMode` with two arguments.
     */
    it('pairs any HmIP device without an SGTIN (task 28)', async () => {
        await openOnHmip();
        expect(screen.getByTestId<HTMLButtonElement>('add-device-start').disabled).toBe(true);

        await fireEvent.change(screen.getByTestId('add-device-hmip-mode'), {target: {value: 'ANY'}});
        await waitFor(() => {
            expect(screen.queryByTestId('add-device-sgtin')).toBeNull();
        });
        expect(screen.queryByTestId('add-device-key')).toBeNull();
        expect(screen.queryByTestId('add-device-scan')).toBeNull();
        expect(screen.getByTestId<HTMLButtonElement>('add-device-start').disabled).toBe(false);

        await fireEvent.click(screen.getByTestId('add-device-start'));
        await waitFor(() => {
            expect(transport.lastCall('devices.installMode.set')).toEqual([
                'HmIP-RF',
                true,
                {seconds: 60, hmipKeyMode: 'ANY'},
            ]);
        });
        expect(screen.getByTestId('add-device-countdown')).toBeTruthy();
    });

    it('says which of the three ways works offline and which needs the key server (task 28)', async () => {
        await openOnHmip();
        const hint = (): string => screen.getByTestId('add-device-hmip-hint').textContent;
        expect(hint()).toContain('Funktioniert offline');

        await fireEvent.change(screen.getByTestId('add-device-hmip-mode'), {target: {value: 'SGTIN'}});
        await waitFor(() => {
            expect(hint()).toContain('Key Server');
        });
        expect(hint()).toContain('Internetzugang');

        await fireEvent.change(screen.getByTestId('add-device-hmip-mode'), {target: {value: 'ANY'}});
        await waitFor(() => {
            expect(hint()).toContain('Werkszustand');
        });
        expect(hint()).toContain('lokale Schlüsselzuordnung');
    });

    /**
     * Task 66: the system's key mode decides which of the three ways can work. `LOCAL` never asks
     * eQ-3's key server, so "SGTIN only" is not offered there and "any device" says that it pairs
     * only a device whose key is on the system, with the count. The other two modes, an older
     * system and a CCU (no answer) change nothing.
     */
    const modeOptions = (): string[] =>
        [...screen.getByTestId<HTMLSelectElement>('add-device-hmip-mode').options].map((option) => option.value);

    it('does not offer "SGTIN only" on a system whose key mode is LOCAL, and says what "any device" does there (task 66)', async () => {
        transport.result('meta.pairing', {keyserver_mode: 'LOCAL', device_keys: 3, offline_pairing: false});
        await openOnHmip();
        await waitFor(() => {
            expect(modeOptions()).toEqual(['KEY', 'ANY']);
        });
        expect(transport.lastCall('meta.pairing')).toEqual([]);

        const hint = (): string => screen.getByTestId('add-device-hmip-hint').textContent;
        await fireEvent.change(screen.getByTestId('add-device-hmip-mode'), {target: {value: 'ANY'}});
        await waitFor(() => {
            expect(hint()).toContain('fragt den Key Server von eQ-3 nie');
        });
        expect(hint()).toContain('3 Geräteschlüssel gespeichert');
        expect(hint()).not.toContain('Internetzugang');

        // the way that always works is untouched
        await fireEvent.change(screen.getByTestId('add-device-hmip-mode'), {target: {value: 'KEY'}});
        await waitFor(() => {
            expect(hint()).toContain('Funktioniert offline');
        });
    });

    it('says "one key" in the singular on a LOCAL system with one stored key (task 66)', async () => {
        transport.result('meta.pairing', {keyserver_mode: 'LOCAL', device_keys: 1, offline_pairing: false});
        await openOnHmip();
        await waitFor(() => {
            expect(modeOptions()).toEqual(['KEY', 'ANY']);
        });
        await fireEvent.change(screen.getByTestId('add-device-hmip-mode'), {target: {value: 'ANY'}});
        await waitFor(() => {
            expect(screen.getByTestId('add-device-hmip-hint').textContent).toContain(
                'ist 1 Geräteschlüssel gespeichert',
            );
        });
    });

    it('falls back from a chosen "SGTIN only" to "SGTIN and key" when the system turns out to be LOCAL (task 66)', async () => {
        // the system's answer arrives after the user has already chosen
        let answer: (value: {keyserver_mode: 'LOCAL'; device_keys: number; offline_pairing: false}) => void = () =>
            undefined;
        transport.respond(
            'meta.pairing',
            () =>
                new Promise((resolve) => {
                    answer = resolve;
                }),
        );
        await openOnHmip();
        expect(modeOptions()).toEqual(['KEY', 'SGTIN', 'ANY']);
        await fireEvent.change(screen.getByTestId('add-device-hmip-mode'), {target: {value: 'SGTIN'}});
        await waitFor(() => {
            expect(screen.queryByTestId('add-device-key')).toBeNull();
        });

        answer({keyserver_mode: 'LOCAL', device_keys: 0, offline_pairing: false});
        await waitFor(() => {
            expect(modeOptions()).toEqual(['KEY', 'ANY']);
        });
        expect(screen.getByTestId<HTMLSelectElement>('add-device-hmip-mode').value).toBe('KEY');
        expect(screen.getByTestId('add-device-key')).toBeTruthy();
        expect(screen.getByTestId('add-device-hmip-hint').textContent).toContain('Funktioniert offline');
    });

    it('offers all three ways on KEYSERVER and KEYSERVER_LOCAL systems, and where nothing answers (task 66)', async () => {
        for (const fact of [
            {keyserver_mode: 'KEYSERVER' as const, device_keys: 0, offline_pairing: true},
            {keyserver_mode: 'KEYSERVER_LOCAL' as const, device_keys: 5, offline_pairing: true},
            null,
        ]) {
            transport = new MockTransport({demo: true});
            transport.result('meta.pairing', fact);
            await openOnHmip();
            expect(modeOptions()).toEqual(['KEY', 'SGTIN', 'ANY']);
            await fireEvent.change(screen.getByTestId('add-device-hmip-mode'), {target: {value: 'ANY'}});
            await waitFor(() => {
                expect(screen.getByTestId('add-device-hmip-hint').textContent).toContain('lokale Schlüsselzuordnung');
            });
            // one more turn of the wheel: the answer has long arrived and changed nothing
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(modeOptions()).toEqual(['KEY', 'SGTIN', 'ANY']);
            document.body.innerHTML = '';
        }
    });

    it('offers everything as before when the pairing request fails (task 66)', async () => {
        transport.fail('meta.pairing', 'the system is down');
        await openOnHmip();
        await waitFor(() => {
            expect(transport.lastCall('meta.pairing')).toEqual([]);
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(modeOptions()).toEqual(['KEY', 'SGTIN', 'ANY']);
        expect(screen.queryByRole('alert')).toBeNull();
    });

    /**
     * Task 28's second trap: hmipserver matches the whitelist as an exact string, so a lower-case
     * SGTIN would silently never match. What reaches the contract is upper case, however it was typed.
     */
    it('hands a lower-case SGTIN to the contract in upper case (task 28)', async () => {
        await openOnHmip();
        await fireEvent.change(screen.getByTestId('add-device-hmip-mode'), {target: {value: 'SGTIN'}});
        await fireEvent.input(screen.getByTestId('add-device-sgtin'), {
            target: {value: '3014f711-a000-0000-0000-0001'},
        });
        await waitFor(() => {
            expect(screen.getByTestId<HTMLButtonElement>('add-device-start').disabled).toBe(false);
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

    it('says why nothing joined once the window has closed by itself (task 28)', async () => {
        // the mock's getInstallMode answers 0, so the first tick of the countdown finds it closed
        await openOnHmip();
        await startAnyDevice();

        const notice = await waitFor(() => screen.getByTestId('add-device-nothing-joined'), {timeout: 3000});
        expect(notice.textContent).toContain('Werkseinstellungen');
        expect(screen.queryByTestId('add-device-countdown')).toBeNull();

        // a new start takes the notice away again
        await fireEvent.click(screen.getByTestId('add-device-start'));
        await waitFor(() => {
            expect(screen.queryByTestId('add-device-nothing-joined')).toBeNull();
        });
    });

    it('does not say nothing joined when the window was stopped by hand, or when a device came', async () => {
        await openOnHmip();
        transport.result('devices.installMode.get', 30);
        await startAnyDevice();
        await waitFor(() => {
            expect(screen.getByTestId('add-device-stop')).toBeTruthy();
        });
        await fireEvent.click(screen.getByTestId('add-device-stop'));
        await new Promise((resolve) => setTimeout(resolve, 1500));
        expect(screen.queryByTestId('add-device-nothing-joined')).toBeNull();

        // a device paired while the window was open: the window then ends quietly
        transport.result('devices.installMode.get', 0);
        await startAnyDevice();
        transport.emit('devices.changed', {interfaceName: 'HmIP-RF', kind: 'new', addresses: ['0009D3C99ABCDE']});
        await waitFor(() => {
            expect(screen.getByTestId('add-device-paired')).toBeTruthy();
        });
        await waitFor(() => {
            expect(screen.queryByTestId('add-device-countdown')).toBeNull();
        });
        expect(screen.queryByTestId('add-device-nothing-joined')).toBeNull();
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

        // task 65: the demo does not know the device, so no channels: its name and `:0`, nothing half-done
        await waitFor(() => {
            expect(transport.lastCall('names.set')).toEqual([
                [
                    {address: 'NEQ0000001', name: 'Neue Lampe'},
                    {address: 'NEQ0000001:0', name: 'Neue Lampe:0'},
                ],
            ]);
        });
    });

    /** Task 65: the rename dialog's box and rule in the *New* section - ticked at every opening. */
    describe('names the channels of a paired device too (task 65)', () => {
        const device = (address: string, channels: number[]): DeviceDescription[] => [
            {ADDRESS: address, TYPE: 'HM-LC-Sw2-FM', CHILDREN: channels.map((index) => `${address}:${String(index)}`)},
            ...channels.map((index) => ({
                ADDRESS: `${address}:${String(index)}`,
                PARENT: address,
                TYPE: index === 0 ? 'MAINTENANCE' : 'SWITCH',
                INDEX: index,
            })),
        ];

        async function pairTwo(): Promise<void> {
            const demoList = transport.handlerFor('devices.list');
            transport.respond('devices.list', (interfaceName) =>
                interfaceName === 'BidCos-RF'
                    ? [
                          ...(demoList(interfaceName) as DeviceDescription[]),
                          ...device('NEQ0000001', [0, 1, 2]),
                          ...device('NEQ0000002', [0, 1]),
                      ]
                    : demoList(interfaceName),
            );
            const {stores} = await mountApp({transport, hash: '#/BidCos-RF/devices'});
            await fireEvent.click(screen.getByTestId('devices-add'));
            expect(screen.queryByTestId('add-device-rename-children')).toBeNull();
            transport.emit('devices.changed', {
                interfaceName: 'BidCos-RF',
                kind: 'new',
                addresses: ['NEQ0000001', 'NEQ0000002'],
            });
            await waitFor(() => {
                expect(stores.devices.channels('BidCos-RF', 'NEQ0000002')).toHaveLength(2);
            });
            await waitFor(() => screen.getByTestId('add-device-paired'));
        }

        it('renames the named device with every channel, and leaves the unnamed one alone', async () => {
            await pairTwo();
            expect(screen.getByTestId<HTMLInputElement>('add-device-rename-children').checked).toBe(true);
            await fireEvent.input(screen.getByLabelText('Name NEQ0000001'), {target: {value: 'Flur'}});
            await fireEvent.click(screen.getByTestId('add-device-name-save'));

            await waitFor(() => {
                expect(transport.lastCall('names.set')).toEqual([
                    [
                        {address: 'NEQ0000001', name: 'Flur'},
                        {address: 'NEQ0000001:0', name: 'Flur:0'},
                        {address: 'NEQ0000001:1', name: 'Flur:1'},
                        {address: 'NEQ0000001:2', name: 'Flur:2'},
                    ],
                ]);
            });
            // the named one leaves the list, the other one waits for its name
            await waitFor(() => {
                expect(screen.queryByLabelText('Name NEQ0000001')).toBeNull();
            });
            expect(screen.getByLabelText('Name NEQ0000002')).toBeTruthy();
        });

        it('renames the device and :0 only with the box unticked, and ticks it again at the next opening', async () => {
            await pairTwo();
            await fireEvent.click(screen.getByTestId('add-device-rename-children'));
            await fireEvent.input(screen.getByLabelText('Name NEQ0000001'), {target: {value: 'Flur'}});
            await fireEvent.input(screen.getByLabelText('Name NEQ0000002'), {target: {value: 'Bad'}});
            await fireEvent.click(screen.getByTestId('add-device-name-save'));

            await waitFor(() => {
                expect(transport.lastCall('names.set')).toEqual([
                    [
                        {address: 'NEQ0000001', name: 'Flur'},
                        {address: 'NEQ0000001:0', name: 'Flur:0'},
                        {address: 'NEQ0000002', name: 'Bad'},
                        {address: 'NEQ0000002:0', name: 'Bad:0'},
                    ],
                ]);
            });

            await fireEvent.click(
                screen.getByTestId('add-device-dialog').querySelector<HTMLElement>('.hmm-dialog-close')!,
            );
            await fireEvent.click(screen.getByTestId('devices-add'));
            transport.emit('devices.changed', {interfaceName: 'BidCos-RF', kind: 'new', addresses: ['NEQ0000001']});
            await waitFor(() => {
                expect(screen.getByTestId<HTMLInputElement>('add-device-rename-children').checked).toBe(true);
            });
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

    it('says that names wait for the inbox while ReGa has not got them, and not after (B-64)', async () => {
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await fireEvent.click(screen.getByTestId('devices-add'));
        expect(screen.queryByTestId('add-device-names-waiting')).toBeNull();

        transport.emit('rega.changed', {enabled: true, reachable: true, names: 3, pendingNames: ['NEW0000001']});
        await waitFor(() => {
            expect(screen.getByTestId('add-device-names-waiting').textContent).toContain('ReGa-Posteingang');
        });
        transport.emit('rega.changed', {enabled: true, reachable: true, names: 5});
        await waitFor(() => {
            expect(screen.queryByTestId('add-device-names-waiting')).toBeNull();
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

    it('nor on a system without ReGaHSS, where there is no inbox (B-62)', async () => {
        transport.result('rega.state', {enabled: false, reachable: false, names: 0, reason: 'openccu-lite'});
        await mountApp({transport, hash: '#/BidCos-RF/devices'});
        await fireEvent.click(screen.getByTestId('devices-add'));
        expect(screen.queryByTestId('add-device-confirm-inbox')).toBeNull();
    });
});

/**
 * Task 28, maintainer 2026-09-11: the way into pairing was a bare `+` the size of every toolbar
 * icon. It is a captioned button now - "Pair device" / "Gerät anlernen" - that opens the same
 * dialog, and it says why where there is nothing to pair.
 */
describe('the "Pair device" button', () => {
    let transport: MockTransport;

    beforeEach(() => {
        transport = new MockTransport({demo: true});
    });

    it('is a captioned button that opens the pairing dialog', async () => {
        await mountApp({transport, hash: '#/HmIP-RF/devices'});
        const button = screen.getByRole<HTMLButtonElement>('button', {name: 'Gerät anlernen'});
        expect(button.getAttribute('data-testid')).toBe('devices-add');
        expect(button.classList.contains('hmm-primary-button')).toBe(true);
        await waitFor(() => {
            expect(screen.getByTestId('devices-add-caption').textContent).toBe('Gerät anlernen');
        });
        expect(button.disabled).toBe(false);

        await fireEvent.click(button);
        await waitFor(() => {
            expect(screen.getByTestId('add-device-dialog').hasAttribute('open')).toBe(true);
        });
    });

    for (const [type, protocol, port] of [
        ['VirtualDevices', 'xmlrpc', 9292],
        ['CUxD', 'binrpc', 8701],
    ] as const) {
        it(`is disabled, and says why, on ${type}, which has no install mode`, async () => {
            transport.result('interfaces.list', [
                {name: type, type, protocol, host: 'demo.local', port, connected: true},
            ]);
            transport.respond('config.get', () => ({
                version: '3.0.0-dev.0',
                connection: {
                    host: 'demo.local',
                    interfaces: [type],
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
            await mountApp({transport, hash: `#/${type}/devices`});

            await waitFor(() => {
                expect(screen.getByTestId<HTMLButtonElement>('devices-add').disabled).toBe(true);
            });
            expect(screen.getByTestId('devices-add-tooltip').getAttribute('data-tooltip')).toBe(
                'Gerät anlernen — Diese Schnittstelle kann keine Geräte anlernen',
            );
        });
    }
});
