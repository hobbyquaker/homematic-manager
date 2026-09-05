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

describe('the secure-context check', () => {
    /**
     * Replaces a property of a global object for one test and puts it back afterwards. Both of
     * these are getters on the prototype, so an own property shadows them; that works the same way
     * in jsdom and in the real Chromium the component tests run in (D-23).
     */
    function shadow(target: object, key: string, value: unknown): () => void {
        const previous = Object.getOwnPropertyDescriptor(target, key);
        Object.defineProperty(target, key, {value, configurable: true, writable: true});
        return () => {
            if (previous) {
                Object.defineProperty(target, key, previous);
            } else {
                Reflect.deleteProperty(target, key);
            }
        };
    }

    it('says what to do instead of failing inside the decoder, and never opens a camera', async () => {
        // http://<ccu>/addons/hmm/ is not a secure context, so `navigator.mediaDevices` is simply
        // not there and @zxing/browser dies on undefined. This is exactly the install where
        // scanning a HomematicIP sticker is most useful.
        const restoreDevices = shadow(navigator, 'mediaDevices', undefined);
        const restoreSecure = shadow(window, 'isSecureContext', false);
        try {
            const onerror = vi.fn();
            const reader = fakeReader();
            const createReader = vi.fn(reader.create);
            render(QrScanner, {
                props: {
                    active: true,
                    onscan: vi.fn(),
                    onerror,
                    createReader,
                    insecureContextMessage: 'Die Kamera braucht https.',
                    testId: 'qr',
                },
            });
            await waitFor(() => {
                expect(onerror).toHaveBeenCalledWith('Die Kamera braucht https.');
            });
            expect(createReader).not.toHaveBeenCalled();
        } finally {
            restoreSecure();
            restoreDevices();
        }
    });

    it('scans as usual in a secure context', async () => {
        const restoreSecure = shadow(window, 'isSecureContext', true);
        try {
            const onerror = vi.fn();
            const onscan = vi.fn();
            const reader = fakeReader();
            render(QrScanner, {props: {active: true, onscan, onerror, createReader: reader.create, testId: 'qr'}});
            await waitFor(() => {
                reader.scan('3014F711A000000000000001');
                expect(onscan).toHaveBeenCalledWith('3014F711A000000000000001');
            });
            expect(onerror).not.toHaveBeenCalled();
        } finally {
            restoreSecure();
        }
    });
});
