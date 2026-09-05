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
