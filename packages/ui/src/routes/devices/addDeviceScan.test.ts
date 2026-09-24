/**
 * B-72: a scan of the QR code a HomematicIP sticker really carries fills SGTIN and key and lets the
 * pairing start; 3.x's first parser expected a format no device has and refused every real scan.
 * The dialog is mounted on its own so the test can hand it a fake QR reader.
 */
import {fireEvent, render, screen, waitFor} from '@testing-library/svelte';
import {describe, expect, it} from 'vitest';

import {storesContext} from '../../lib/stores/context.js';
import {createStores} from '../../lib/stores/Stores.svelte.js';
import {MockTransport} from '../../lib/transport/MockTransport.js';
import {fakeRouter, MemoryStorage} from '../../testHarness.js';

import AddDeviceDialog from './AddDeviceDialog.svelte';
import type {QrReader} from './qrReader.js';

const SGTIN = '3014F711A000000000001234';
const HEX = '3A7C51E0B94D26F81C05AE7392D4B61F';

/** A reader that hands the test the decode callback instead of opening a camera. */
function fakeReader(): {create: () => Promise<QrReader>; scan(text: string): void; ready: () => boolean} {
    let emit: ((text: string) => void) | undefined;
    const reader: QrReader = {
        decodeFromVideoDevice: (_deviceId, _video, callback) => {
            emit = (text: string) => callback({getText: () => text}, undefined);
            return Promise.resolve({stop: () => undefined});
        },
    };
    return {
        create: () => Promise.resolve(reader),
        scan: (text: string) => emit?.(text),
        ready: () => emit !== undefined,
    };
}

async function openDialog(): Promise<{transport: MockTransport; reader: ReturnType<typeof fakeReader>}> {
    const transport = new MockTransport({demo: true});
    const router = fakeRouter('#/HmIP-RF/devices');
    const stores = createStores(transport, {
        location: router.location,
        onHashChange: router.onHashChange,
        storage: new MemoryStorage(),
        hostScope: {},
    });
    await stores.start();
    const reader = fakeReader();
    render(AddDeviceDialog, {props: {open: true, createReader: reader.create}, context: storesContext(stores)});
    await fireEvent.click(screen.getByTestId('add-device-scan'));
    await waitFor(() => {
        expect(reader.ready()).toBe(true);
    });
    return {transport, reader};
}

describe('the add-device dialog with a real QR code (B-72)', () => {
    it('fills SGTIN and key from EQ01SG…DLK… and starts the whitelist pairing', async () => {
        const {transport, reader} = await openDialog();

        reader.scan(`EQ01SG${SGTIN}DLK${HEX}`);

        await waitFor(() => {
            expect(screen.getByTestId<HTMLInputElement>('add-device-sgtin').value).toBe(SGTIN);
        });
        expect(screen.getByTestId<HTMLInputElement>('add-device-key').value).toBe(HEX);
        expect(screen.queryByTestId('add-device-scan-error')).toBeNull();
        expect(screen.getByTestId<HTMLButtonElement>('add-device-start').disabled).toBe(false);

        await fireEvent.click(screen.getByTestId('add-device-start'));
        await waitFor(() => {
            expect(transport.lastCall('devices.installMode.set')).toEqual([
                'HmIP-RF',
                true,
                {seconds: 60, hmipKeyMode: 'KEY', hmipKey: {sgtin: SGTIN, key: HEX}},
            ]);
        });
    });

    it('says so when the code is not a HomematicIP device code', async () => {
        const {reader} = await openDialog();

        reader.scan('https://example.invalid/');

        await waitFor(() => {
            expect(screen.getByTestId('add-device-scan-error').textContent).toMatch(/HomematicIP/);
        });
        expect(screen.getByTestId<HTMLInputElement>('add-device-sgtin').value).toBe('');
    });

    it('names what the key field takes', async () => {
        await openDialog();
        expect(screen.getByTestId('add-device-key-hint').textContent).toMatch(/26/);
    });

    // openccu-lite task 217: how a HAP or DRAP is paired, said where HmIP devices are paired
    it('says how an access point is paired', async () => {
        await openDialog();
        const hint = screen.getByTestId('add-device-ap-hint').textContent;
        expect(hint).toMatch(/HAP, DRAP/);
        expect(hint).toMatch(/auf Werkseinstellungen zurücksetzen, den Anlernmodus starten, dann mit Strom versorgen/);
    });
});
