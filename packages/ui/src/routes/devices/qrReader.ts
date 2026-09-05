/**
 * The part of `@zxing/browser`'s `BrowserQRCodeReader` the scanner uses.
 *
 * Declaring it here rather than importing the class keeps the decoder out of every bundle that
 * never scans (the component imports it lazily) and lets a test drive the scanner with a fake.
 */
export interface QrReader {
    decodeFromVideoDevice(
        deviceId: undefined,
        video: HTMLVideoElement,
        callback: (result: {getText(): string} | undefined, error: unknown) => void,
    ): Promise<{stop(): void}>;
}

/** How the scanner obtains its reader; injected by the tests. */
export type CreateQrReader = () => Promise<QrReader>;
