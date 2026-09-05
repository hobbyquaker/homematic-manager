import {render, screen, waitFor} from '@testing-library/svelte';
import {describe, expect, it, vi} from 'vitest';

import QrScanner from './QrScanner.svelte';
import type {QrReader} from './qrReader.js';

/** A reader that hands the test the decode callback instead of opening a camera. */
function fakeReader(): {create: () => Promise<QrReader>; scan(text: string): void; stopped: () => number} {
    let emit: ((text: string) => void) | undefined;
    let stops = 0;
    const reader: QrReader = {
        decodeFromVideoDevice: (_deviceId, _video, callback) => {
            emit = (text: string) => callback({getText: () => text}, undefined);
            return Promise.resolve({
                stop: () => {
                    stops += 1;
                },
            });
        },
    };
    return {
        create: () => Promise.resolve(reader),
        scan: (text: string) => emit?.(text),
        stopped: () => stops,
    };
}

describe('QrScanner', () => {
    it('films nothing while it is off', () => {
        render(QrScanner, {props: {active: false, onscan: vi.fn(), testId: 'qr'}});
        expect(screen.queryByTestId('qr')).toBeNull();
    });

    it('starts the reader when it is switched on and reports what it decoded', async () => {
        const reader = fakeReader();
        const onscan = vi.fn();
        render(QrScanner, {props: {active: true, onscan, createReader: reader.create, testId: 'qr'}});

        expect(screen.getByTestId('qr')).toBeTruthy();
        await waitFor(() => {
            reader.scan('3014F711A000000000000001ABCDEFGHJKLMNPQR');
            expect(onscan).toHaveBeenCalledWith('3014F711A000000000000001ABCDEFGHJKLMNPQR');
        });
    });

    it('stops the camera when it is unmounted', async () => {
        const reader = fakeReader();
        const {unmount} = render(QrScanner, {
            props: {active: true, onscan: vi.fn(), createReader: reader.create, testId: 'qr'},
        });
        await waitFor(() => {
            reader.scan('x');
        });

        unmount();
        await waitFor(() => {
            expect(reader.stopped()).toBeGreaterThan(0);
        });
    });

    it('reports a reader that cannot start rather than throwing', async () => {
        const onerror = vi.fn();
        render(QrScanner, {
            props: {
                active: true,
                onscan: vi.fn(),
                onerror,
                createReader: () => Promise.reject(new Error('NotAllowedError')),
                testId: 'qr',
            },
        });

        await waitFor(() => {
            expect(onerror).toHaveBeenCalledWith('NotAllowedError');
        });
    });
});
