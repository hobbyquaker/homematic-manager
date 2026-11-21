import type {DeviceDescription} from '@homematic-manager/core';
import {fireEvent, screen, waitFor} from '@testing-library/svelte';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {MockTransport} from '../../lib/transport/MockTransport.js';
import {mountApp} from '../../testHarness.js';

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
        // B-72: the key as the sticker prints it (made up), dashes and case as typed
        await fireEvent.input(screen.getByTestId('add-device-key'), {
            target: {value: '1TGJ8-Y1FAE-4UW1R-1EFFF-9e9ehz'},
        });

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
                    hmipKey: {sgtin: '3014F711A000000000000001', key: '1TGJ8Y1FAE4UW1R1EFFF9E9EHZ'},
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
    async function openOnHmip(language?: 'de' | 'en'): Promise<void> {
        const {stores} = await mountApp({transport, hash: '#/HmIP-RF/devices'});
        if (language !== undefined) {
            stores.i18n.language = language;
        }
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

    /*
     * Task 88: an HmIP device that answers with a key hmipserver declines. An openccu-lite without
     * the pairing route (before 2.0.0-beta.11) shows that only as its warning `hmip-key-declined`;
     * the dialog takes what the system knew when the window opened, asks again every fifth tick, and
     * a decline that is new is this window's: the device did answer, so "nothing joined" is not said.
     */
    const SGTIN = '3014F711A000000000000088';
    const OLD_DECLINE = {sgtin: '3014F711A000000000000002', variant: '3014F711A000000000000002@2026-10-03T09:00:00Z'};
    const DECLINE = {
        sgtin: SGTIN,
        address: '00000000000088',
        at: '2026-10-03T10:45:12Z',
        variant: `${SGTIN}@2026-10-03T10:45:12Z`,
    };

    async function startWithKey(): Promise<void> {
        await fireEvent.input(screen.getByTestId('add-device-sgtin'), {target: {value: SGTIN}});
        // B-72: a printed key (made up)
        await fireEvent.input(screen.getByTestId('add-device-key'), {
            target: {value: '1TGJ8-Y1FAE-4UW1R-1EFFF-9E9EHZ'},
        });
        await waitFor(() => {
            expect(screen.getByTestId<HTMLButtonElement>('add-device-start').disabled).toBe(false);
        });
        await fireEvent.click(screen.getByTestId('add-device-start'));
    }

    it('says the device key does not match when a system without the pairing route declined it during the window (task 88)', async () => {
        vi.useFakeTimers({shouldAdvanceTime: true, toFake: ['setInterval', 'clearInterval']});
        try {
            let left = 60;
            transport.respond('devices.installMode.get', () => {
                left -= 1;
                return left;
            });
            // the system already knew a decline of another device when the window opened
            let declines: unknown[] = [OLD_DECLINE];
            transport.respond('meta.keyDeclines', () => declines as never);
            await openOnHmip('de');
            await startWithKey();
            await waitFor(() => {
                expect(screen.getByTestId('add-device-countdown')).toBeTruthy();
            });
            expect(transport.countOf('meta.keyDeclines')).toBe(1);

            // five ticks: asked again, only the old decline - nothing to say
            await vi.advanceTimersByTimeAsync(5000);
            await waitFor(() => {
                expect(transport.countOf('meta.keyDeclines')).toBe(2);
            });
            expect(screen.queryByTestId('add-device-pairing-failed')).toBeNull();

            // the device asks and is declined: the next fifth tick says so, the window keeps running
            declines = [OLD_DECLINE, DECLINE];
            await vi.advanceTimersByTimeAsync(5000);
            const block = await waitFor(() => screen.getByTestId('add-device-pairing-failed'));
            expect(block.dataset['reason']).toBe('key-mismatch');
            expect(block.textContent).toContain('Der Geräteschlüssel passt nicht');
            expect(block.textContent).toContain(
                `Das Gerät ${SGTIN} hat geantwortet, aber der dem System dafür angegebene Schlüssel (beim Anlernen eingegeben oder auf der Seite Schlüssel gespeichert) passt nicht zu ihm.`,
            );
            expect(screen.getByTestId('add-device-countdown')).toBeTruthy();

            // to the key entry: the window is stopped, the SGTIN kept, the key field focused
            await fireEvent.click(screen.getByTestId('add-device-key-declined-enter'));
            await waitFor(() => {
                expect(transport.lastCall('devices.installMode.set')).toEqual(['HmIP-RF', false, undefined]);
            });
            await waitFor(() => {
                expect(document.activeElement).toBe(screen.getByTestId('add-device-key'));
            });
            expect(screen.getByTestId<HTMLInputElement>('add-device-sgtin').value).toBe(SGTIN);
            expect(screen.queryByTestId('add-device-countdown')).toBeNull();
            expect(screen.getByTestId('add-device-pairing-failed')).toBeTruthy();
            expect(screen.queryByTestId('add-device-nothing-joined')).toBeNull();

            // a new start takes it away; the decline it knew is the new window's baseline
            await fireEvent.click(screen.getByTestId('add-device-start'));
            await waitFor(() => {
                expect(screen.queryByTestId('add-device-pairing-failed')).toBeNull();
            });
            await vi.advanceTimersByTimeAsync(5000);
            await waitFor(() => {
                expect(transport.countOf('meta.keyDeclines')).toBeGreaterThanOrEqual(5);
            });
            expect(screen.queryByTestId('add-device-pairing-failed')).toBeNull();
            // the route was asked once per window, and its answer (none) sent the dialog to the warnings
            expect(transport.countOf('meta.pairingAttempts')).toBe(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('says the decline instead of nothing joined when the window closes on it (task 88)', async () => {
        // getInstallMode answers 0: the first tick finds the window closed, and the last look finds the decline
        let declines: unknown[] = [];
        transport.respond('meta.keyDeclines', () => declines as never);
        await openOnHmip();
        await startAnyDevice();
        await waitFor(() => {
            expect(transport.countOf('meta.keyDeclines')).toBe(1);
        });
        declines = [DECLINE];
        const block = await waitFor(() => screen.getByTestId('add-device-pairing-failed'), {timeout: 3000});
        expect(block.textContent).toContain(SGTIN);
        expect(screen.queryByTestId('add-device-nothing-joined')).toBeNull();

        // the button leads to the key entry, from "any device" to "with SGTIN and key"
        await fireEvent.click(screen.getByTestId('add-device-key-declined-enter'));
        await waitFor(() => {
            expect(screen.getByTestId<HTMLSelectElement>('add-device-hmip-mode').value).toBe('KEY');
        });
        expect(screen.getByTestId<HTMLInputElement>('add-device-sgtin').value).toBe(SGTIN);
        // the window had closed already: nothing is stopped
        expect(transport.countOf('devices.installMode.set')).toBe(1);
    });

    it('names the key as a cause when a key was given and nothing can say it was declined (task 88)', async () => {
        // a CCU: no pairing route, no warnings API, so nothing is asked during the window
        await openOnHmip('de');
        await startWithKey();
        const notice = await waitFor(() => screen.getByTestId('add-device-nothing-joined'), {timeout: 3000});
        expect(notice.textContent).toContain('passt der angegebene Schlüssel nicht zu ihm');
        expect(notice.textContent).toContain('Werkseinstellungen');
        expect(transport.countOf('meta.keyDeclines')).toBe(1);
        expect(transport.countOf('meta.pairingAttempts')).toBe(1);

        // without a key, the old text
        await startAnyDevice();
        await waitFor(() => {
            expect(screen.getByTestId('add-device-nothing-joined').textContent).not.toContain('Schlüssel');
        });
        expect(screen.queryByTestId('add-device-pairing-failed')).toBeNull();
    });

    /*
     * Task 88: openccu-lite 2.0.0-beta.11 and later say why a pairing failed: `GET
     * /api/system/v1/radio/hmip/pairing` (occulited task 158). The dialog keeps the route's `now` when
     * the window opens, passes it back as `since` every fifth tick and once more as the window
     * closes, and shows one block per device of the window with the reason in the system's words.
     */
    const NOW = '2026-11-21T10:45:00.5+01:00';
    function attempt(sgtin: string, reason: string | undefined, extra: Record<string, unknown> = {}): unknown {
        return {
            sgtin,
            address: sgtin.slice(-14),
            outcome: reason ?? 'included',
            ...(reason === undefined ? {} : {reason}),
            failed: reason !== undefined && !['other-device', 'no-install-mode', 'incomplete'].includes(reason),
            ...extra,
        };
    }

    it("shows the system's reason for a failed pairing during the window, and passes its own clock back (task 88)", async () => {
        vi.useFakeTimers({shouldAdvanceTime: true, toFake: ['setInterval', 'clearInterval']});
        try {
            let left = 60;
            transport.respond('devices.installMode.get', () => {
                left -= 1;
                return left;
            });
            let attempts: unknown[] = [];
            const since: unknown[] = [];
            transport.respond('meta.pairingAttempts', (...params: unknown[]) => {
                since.push(params[0]);
                return {now: since.length === 1 ? NOW : '2026-11-21T10:46:00Z', attempts} as never;
            });
            await openOnHmip('de');
            await startWithKey();
            await waitFor(() => {
                expect(since).toEqual([undefined]);
            });

            // a device that is still asking, and one that asked while no window was open: nothing to say yet
            attempts = [attempt(SGTIN, 'incomplete'), attempt('3014F711A000000000000009', 'no-install-mode')];
            await vi.advanceTimersByTimeAsync(5000);
            await waitFor(() => {
                expect(since).toEqual([undefined, NOW]);
            });
            expect(screen.queryByTestId('add-device-pairing-failed')).toBeNull();

            // the key server was not reached: said at the next fifth tick, the window keeps running
            attempts = [attempt(SGTIN, 'key-server-unreachable')];
            await vi.advanceTimersByTimeAsync(5000);
            const block = await waitFor(() => screen.getByTestId('add-device-pairing-failed'));
            expect(since).toEqual([undefined, NOW, NOW]);
            expect(block.dataset['reason']).toBe('key-server-unreachable');
            expect(block.dataset['sgtin']).toBe(SGTIN);
            expect(block.textContent).toContain('Der Schlüsselserver von eQ-3 wurde nicht erreicht');
            expect(block.textContent).toContain(
                `Das Gerät ${SGTIN} wollte sich anmelden, aber das System hat den Schlüsselserver von eQ-3 nicht erreicht (secgtw.homematic.com, Port 8443).`,
            );
            // only a wrong key has the way to the key entry
            expect(screen.queryByTestId('add-device-key-declined-enter')).toBeNull();
            expect(screen.getByTestId('add-device-countdown')).toBeTruthy();

            // it tried again and was paired: its block goes with the next answer
            attempts = [attempt(SGTIN, undefined)];
            await vi.advanceTimersByTimeAsync(5000);
            await waitFor(() => {
                expect(screen.queryByTestId('add-device-pairing-failed')).toBeNull();
            });
            expect(transport.countOf('meta.keyDeclines')).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    const REASONS: {reason: string; extra?: Record<string, unknown>; de: string[]; en: string[]}[] = [
        {
            reason: 'key-mismatch',
            de: ['Der Geräteschlüssel passt nicht', 'passt nicht zu ihm. Den Schlüssel prüfen (QR-Code oder KEY'],
            en: ['The device key does not match', 'does not match it. Check the key (QR code or KEY on its sticker)'],
        },
        {
            reason: 'key-invalid',
            de: ['Der gespeicherte Schlüssel ist ungültig', 'ist kein gültiger Geräteschlüssel (falsche Länge)'],
            en: ['The stored key is not valid', 'is no valid device key (wrong length)'],
        },
        {
            reason: 'other-device',
            de: ['für eine andere SGTIN geöffnet', 'Die beim Anlernen eingegebene SGTIN mit dem Aufkleber'],
            en: ['The pairing was open for another SGTIN', 'Compare the SGTIN entered for the pairing'],
        },
        {
            reason: 'no-key',
            de: ['Das System hat keinen Schlüssel für das Gerät', 'im lokalen Schlüsselmodus'],
            en: ['The system has no key for the device', "in local key mode eQ-3's key server is never asked"],
        },
        {
            reason: 'key-server-refused',
            de: ['hat das Gerät abgelehnt', 'noch an einer anderen Zentrale angelernt'],
            en: ["eQ-3's key server refused the device", 'still paired with another central unit'],
        },
        {
            reason: 'key-server-unreachable',
            de: ['wurde nicht erreicht', 'Die Internetverbindung, die DNS-Einstellungen und die Firewall prüfen'],
            en: [
                "eQ-3's key server was not reached",
                'Check the internet connection, the DNS settings and the firewall',
            ],
        },
        {
            reason: 'key-server-unreachable',
            extra: {http_status: 503},
            de: ['wurde nicht erreicht', 'hat mit dem HTTP-Status 503 statt mit dem Schlüssel'],
            en: ["eQ-3's key server was not reached", 'answered with HTTP status 503 instead of the device'],
        },
        {
            reason: 'unsupported-device',
            de: ['Der Gerätetyp ist noch nicht bekannt', 'Ein System-Update mit einer neueren HmIP-Software'],
            en: ['The device type is not known yet', 'A system update with a newer HmIP software brings it'],
        },
        {
            reason: 'incomplete',
            de: ['Das Anlernen wurde nicht abgeschlossen', 'Das Gerät nahe am System in den Anlernmodus bringen'],
            en: ['The pairing did not complete', 'Keep it close to the system'],
        },
        {
            // a reason a newer system knows: its own sentence, in the UI's language
            reason: 'duty-cycle',
            extra: {
                message: {en: `The radio was too busy for ${SGTIN}.`, de: `Der Funk war für ${SGTIN} ausgelastet.`},
            },
            de: ['Das Anlernen ist fehlgeschlagen', 'Der Funk war für'],
            en: ['The pairing failed', 'The radio was too busy for'],
        },
    ];

    for (const {reason, extra, de, en} of REASONS) {
        for (const [language, texts] of [
            ['de', de],
            ['en', en],
        ] as const) {
            it(`says ${reason}${extra?.['http_status'] === undefined ? '' : ' with a status'} in ${language} as the window closes (task 88)`, async () => {
                // getInstallMode answers 0: the first tick finds the window closed, the last look finds the reason
                let attempts: unknown[] = [];
                transport.respond('meta.pairingAttempts', () => ({now: NOW, attempts}) as never);
                await openOnHmip(language);
                await startAnyDevice();
                await waitFor(() => {
                    expect(transport.countOf('meta.pairingAttempts')).toBe(1);
                });
                attempts = [attempt(SGTIN, reason, extra), attempt('3014F711A000000000000002', undefined)];
                const block = await waitFor(() => screen.getByTestId('add-device-pairing-failed'), {timeout: 3000});
                expect(block.dataset['reason']).toBe(reason);
                expect(block.textContent).toContain(SGTIN);
                for (const text of texts) {
                    expect(block.textContent).toContain(text);
                }
                // one block: the device that was paired has none
                expect(screen.getAllByTestId('add-device-pairing-failed')).toHaveLength(1);
                expect(screen.queryByTestId('add-device-nothing-joined')).toBeNull();
                expect(screen.queryByTestId('add-device-key-declined-enter') !== null).toBe(reason === 'key-mismatch');
                expect(transport.countOf('meta.keyDeclines')).toBe(0);
            });
        }
    }

    it("says nothing joined when the route has nothing for the window, and the key entry for the route's key mismatch (task 88)", async () => {
        let attempts: unknown[] = [];
        transport.respond('meta.pairingAttempts', () => ({now: NOW, attempts}) as never);
        await openOnHmip('en');
        await startAnyDevice();
        const notice = await waitFor(() => screen.getByTestId('add-device-nothing-joined'), {timeout: 3000});
        expect(notice.textContent).toContain('no device has joined');
        expect(screen.queryByTestId('add-device-pairing-failed')).toBeNull();

        // a request at the wrong moment is no reason: still nothing joined
        attempts = [attempt('3014F711A000000000000009', 'no-install-mode')];
        await startAnyDevice();
        await waitFor(() => {
            expect(transport.countOf('meta.pairingAttempts')).toBeGreaterThanOrEqual(4);
        });
        await waitFor(() => screen.getByTestId('add-device-nothing-joined'), {timeout: 3000});
        expect(screen.queryByTestId('add-device-pairing-failed')).toBeNull();

        // the key mismatch from the route leads to the key entry
        attempts = [attempt(SGTIN, 'key-mismatch')];
        await startAnyDevice();
        await waitFor(() => screen.getByTestId('add-device-pairing-failed'), {timeout: 3000});
        await fireEvent.click(screen.getByTestId('add-device-key-declined-enter'));
        await waitFor(() => {
            expect(screen.getByTestId<HTMLSelectElement>('add-device-hmip-mode').value).toBe('KEY');
        });
        expect(screen.getByTestId<HTMLInputElement>('add-device-sgtin').value).toBe(SGTIN);
        await waitFor(() => {
            expect(document.activeElement).toBe(screen.getByTestId('add-device-key'));
        });
    });

    /**
     * Task 76: a BidCos device that holds another system's security key does ask to join; rfd
     * refuses it quietly and only `getKeyMismatchDevice(true)` tells. The dialog asks every fifth
     * countdown tick, stops the window when a serial comes back, asks for the other system's key,
     * sends it with `setTempKey` before the next start, and clears it once the device has arrived.
     */
    async function openOnBidcos(): Promise<ReturnType<typeof mountApp>> {
        const mounted = mountApp({transport, hash: '#/BidCos-RF/devices'});
        await mounted;
        await fireEvent.click(screen.getByTestId('devices-add'));
        return mounted;
    }

    it("asks for the other system's key when rfd refuses a device during the install mode, and retries with it (task 76)", async () => {
        vi.useFakeTimers({shouldAdvanceTime: true, toFake: ['setInterval', 'clearInterval']});
        try {
            // a real interface counts down, which re-runs the countdown effect every second
            let left = 60;
            transport.respond('devices.installMode.get', () => {
                left -= 1;
                return left;
            });
            transport.result('devices.installMode.keyMismatch', 'LEQ0000009');
            await openOnBidcos();
            await fireEvent.click(screen.getByTestId('add-device-start'));
            await waitFor(() => {
                expect(screen.getByTestId('add-device-countdown')).toBeTruthy();
            });

            // four ticks: the countdown runs, nothing is asked about keys yet
            await vi.advanceTimersByTimeAsync(4000);
            expect(transport.countOf('devices.installMode.keyMismatch')).toBe(0);
            expect(screen.queryByTestId('add-device-key-mismatch')).toBeNull();

            // the fifth tick: rfd names the device; the window is stopped and the question opens
            await vi.advanceTimersByTimeAsync(1000);
            const question = await waitFor(() => screen.getByTestId('add-device-key-mismatch'));
            expect(question.textContent).toContain('LEQ0000009');
            expect(question.textContent).toContain('Sicherheitsschlüssel des anderen Systems');
            await waitFor(() => {
                expect(transport.lastCall('devices.installMode.set')).toEqual(['BidCos-RF', false, undefined]);
            });
            expect(screen.queryByTestId('add-device-countdown')).toBeNull();
            expect(transport.countOf('devices.installMode.keyMismatch')).toBe(1);
            expect(document.activeElement).toBe(screen.getByTestId('add-device-temp-key'));

            // the retry needs a key; with one it goes out before the same install mode as before
            const retry = screen.getByTestId<HTMLButtonElement>('add-device-key-retry');
            expect(retry.disabled).toBe(true);
            transport.result('devices.installMode.keyMismatch', '');
            await fireEvent.input(screen.getByTestId('add-device-temp-key'), {target: {value: ' other-system '}});
            await waitFor(() => {
                expect(retry.disabled).toBe(false);
            });
            await fireEvent.click(retry);
            await waitFor(() => {
                expect(transport.lastCall('devices.installMode.set')).toEqual([
                    'BidCos-RF',
                    true,
                    {seconds: 60, mode: 1, tempKey: 'other-system'},
                ]);
            });
            expect(screen.queryByTestId('add-device-key-mismatch')).toBeNull();
            await waitFor(() => {
                expect(screen.getByTestId('add-device-countdown')).toBeTruthy();
            });

            // the device comes: the key was for this pairing and is cleared again
            expect(transport.countOf('devices.installMode.tempKey')).toBe(0);
            transport.emit('devices.changed', {interfaceName: 'BidCos-RF', kind: 'new', addresses: ['LEQ0000009']});
            await waitFor(() => {
                expect(transport.lastCall('devices.installMode.tempKey')).toEqual(['BidCos-RF', '']);
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('turns a refused addDevice into the key question instead of an error notice (task 76)', async () => {
        transport.fail('devices.installMode.set', {
            message: 'addDevice failed',
            kind: 'rpc',
            faultCode: -1,
            faultString: 'Failure',
        });
        transport.result('devices.installMode.keyMismatch', 'LEQ0000009');
        const {stores} = await openOnBidcos();
        await fireEvent.input(screen.getByTestId('add-device-serial'), {target: {value: 'LEQ0000009'}});
        await waitFor(() => {
            expect(screen.getByTestId<HTMLButtonElement>('add-device-serial-start').disabled).toBe(false);
        });
        await fireEvent.click(screen.getByTestId('add-device-serial-start'));

        const question = await waitFor(() => screen.getByTestId('add-device-key-mismatch'));
        expect(question.textContent).toContain('LEQ0000009');
        expect(stores.notices.items).toEqual([]);
        expect(transport.countOf('devices.installMode.keyMismatch')).toBe(1);

        // with the key, the same addDevice again - the key first
        transport.result('devices.installMode.set', null);
        transport.result('devices.installMode.keyMismatch', '');
        await fireEvent.input(screen.getByTestId('add-device-temp-key'), {target: {value: 'other-system'}});
        await fireEvent.click(screen.getByTestId('add-device-key-retry'));
        await waitFor(() => {
            expect(transport.lastCall('devices.installMode.set')).toEqual([
                'BidCos-RF',
                true,
                {seconds: 60, mode: 1, address: 'LEQ0000009', tempKey: 'other-system'},
            ]);
        });
        expect(screen.queryByTestId('add-device-key-mismatch')).toBeNull();
        expect(screen.queryByTestId('add-device-countdown')).toBeNull();
    });

    it('keeps reporting any other addDevice failure as a notice (task 76)', async () => {
        transport.fail('devices.installMode.set', {message: 'Unknown device', kind: 'rpc', faultCode: -2});
        const {stores} = await openOnBidcos();
        await fireEvent.input(screen.getByTestId('add-device-serial'), {target: {value: 'LEQ0000009'}});
        await waitFor(() => {
            expect(screen.getByTestId<HTMLButtonElement>('add-device-serial-start').disabled).toBe(false);
        });
        await fireEvent.click(screen.getByTestId('add-device-serial-start'));

        await waitFor(() => {
            expect(stores.notices.items.map((notice) => notice.message)).toEqual([
                'setInstallMode: Unknown device (Unknown device, -2)',
            ]);
        });
        expect(transport.countOf('devices.installMode.keyMismatch')).toBe(1);
        expect(screen.queryByTestId('add-device-key-mismatch')).toBeNull();
    });

    it('tells a BidCos user about the key case when nothing joined, and clears a sent key (task 76)', async () => {
        // getInstallMode answers 0: the first tick finds the window closed
        await openOnBidcos();
        await fireEvent.input(screen.getByTestId('add-device-temp-key'), {target: {value: 'other-system'}});
        await fireEvent.click(screen.getByTestId('add-device-start'));
        await waitFor(() => {
            expect(transport.lastCall('devices.installMode.set')).toEqual([
                'BidCos-RF',
                true,
                {seconds: 60, mode: 1, tempKey: 'other-system'},
            ]);
        });

        const notice = await waitFor(() => screen.getByTestId('add-device-nothing-joined'), {timeout: 3000});
        expect(notice.textContent).toContain('Sicherheitsschlüssel eines anderen Systems');
        expect(notice.textContent).not.toContain('auf Werkseinstellungen zurücksetzen');
        // the key went out with the start and is cleared with the window
        await waitFor(() => {
            expect(transport.lastCall('devices.installMode.tempKey')).toEqual(['BidCos-RF', '']);
        });
        expect(transport.countOf('devices.installMode.tempKey')).toBe(1);

        // a start without a key leaves nothing to clear
        await fireEvent.input(screen.getByTestId('add-device-temp-key'), {target: {value: ''}});
        await fireEvent.click(screen.getByTestId('add-device-start'));
        await waitFor(() => screen.getByTestId('add-device-nothing-joined'), {timeout: 3000});
        expect(transport.countOf('devices.installMode.tempKey')).toBe(1);
    });

    it('clears a sent key when the window is stopped or the dialog closed (task 76)', async () => {
        transport.result('devices.installMode.get', 42);
        await openOnBidcos();
        await fireEvent.input(screen.getByTestId('add-device-temp-key'), {target: {value: 'other-system'}});
        await fireEvent.click(screen.getByTestId('add-device-start'));
        await waitFor(() => {
            expect(screen.getByTestId('add-device-stop')).toBeTruthy();
        });
        await fireEvent.click(screen.getByTestId('add-device-stop'));
        await waitFor(() => {
            expect(transport.lastCall('devices.installMode.tempKey')).toEqual(['BidCos-RF', '']);
        });

        // sent again, then the dialog is closed with the window still open
        await fireEvent.click(screen.getByTestId('add-device-start'));
        await waitFor(() => {
            expect(transport.countOf('devices.installMode.set')).toBe(3);
        });
        await fireEvent.click(screen.getByTestId('add-device-dialog').querySelector('.hmm-dialog-close') as Element);
        await waitFor(() => {
            expect(transport.countOf('devices.installMode.tempKey')).toBe(2);
        });
        // the field starts empty at the next opening
        await fireEvent.click(screen.getByTestId('devices-add'));
        expect(screen.getByTestId<HTMLInputElement>('add-device-temp-key').value).toBe('');
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
