// Unmounts rendered components after every test.
import '@testing-library/svelte/vitest';

/**
 * jsdom parity shims. In browser mode all of this exists and nothing below runs; in jsdom the
 * components would throw on `new ResizeObserver(...)`, `matchMedia(...)` or `dialog.showModal()`.
 * The shims are deliberately minimal: no test asserts on them, they only keep jsdom from being a
 * different API surface than a browser.
 */

if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class ResizeObserverStub {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
    } as unknown as typeof ResizeObserver;
}

if (typeof globalThis.matchMedia === 'undefined') {
    globalThis.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener(): void {},
        removeEventListener(): void {},
        addListener(): void {},
        removeListener(): void {},
        dispatchEvent: () => false,
    })) as unknown as typeof globalThis.matchMedia;
}

if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement): void {
        this.open = true;
        this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.show = function show(this: HTMLDialogElement): void {
        this.open = true;
        this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement, returnValue?: string): void {
        this.open = false;
        this.removeAttribute('open');
        if (returnValue !== undefined) {
            this.returnValue = returnValue;
        }
        this.dispatchEvent(new Event('close'));
    };
}

if (typeof Element !== 'undefined' && !Element.prototype.scrollTo) {
    Element.prototype.scrollTo = function scrollTo(this: Element): void {};
}

/**
 * jsdom has no `navigator.mediaDevices` at all, and the QR scanner checks for it before it loads
 * `@zxing/browser` - a page served over plain http (the CCU addon, an LXC over http) has no camera
 * API either, and the component says so instead of failing inside the decoder. Without this shim
 * every scanner test in jsdom would take that branch, while browser mode - where the object exists -
 * would take the other one, and the two runs would not be testing the same thing.
 *
 * `isSecureContext` is the other half of the same check and is not true in jsdom either. The test
 * that covers the branch shadows both of these again.
 */
if (typeof navigator !== 'undefined' && navigator.mediaDevices === undefined) {
    Object.defineProperty(navigator, 'mediaDevices', {
        value: {getUserMedia: () => Promise.reject(new Error('no camera in jsdom'))},
        configurable: true,
        writable: true,
    });
}

if (globalThis.isSecureContext !== true) {
    Object.defineProperty(globalThis, 'isSecureContext', {value: true, configurable: true, writable: true});
}
