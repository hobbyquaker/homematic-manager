/**
 * Task 47: a text onto the clipboard, from the copy button of a grid cell.
 *
 * `navigator.clipboard` exists only in a secure context - HTTPS, `localhost`, the Electron window.
 * The CCU addon is usually opened over plain HTTP (`http://<ccu>/addons/hmm/`), where the property
 * is simply missing, and an embedding frame without `clipboard-write` makes `writeText` refuse. So
 * the old way is kept behind it: the text in a field of its own, selected, and the browser's `copy`
 * command, which still works from the click that asked for it.
 */

/** Which way the text went: the Clipboard API, the selected field, or neither. */
export type CopyOutcome = 'clipboard' | 'selection' | 'failed';

export interface CopyOptions {
    /**
     * Where the fallback's field is put for the moment of the copy - inside the grid, so a modal
     * dialog or an `inert` elsewhere cannot stand between the field and the command. The body when
     * absent.
     */
    readonly host?: HTMLElement | undefined;
}

interface ClipboardLike {
    writeText(text: string): Promise<void>;
}

/** Read at the moment of the copy: the property is absent where the page is not a secure context. */
function clipboardOf(): ClipboardLike | undefined {
    return (globalThis.navigator as {clipboard?: ClipboardLike} | undefined)?.clipboard;
}

export async function copyText(text: string, options: CopyOptions = {}): Promise<CopyOutcome> {
    const clipboard = clipboardOf();
    if (typeof clipboard?.writeText === 'function') {
        try {
            await clipboard.writeText(text);
            return 'clipboard';
        } catch {
            // refused - no permission, a frame without clipboard-write: the selection below still can
        }
    }
    return copyBySelection(text, options.host) ? 'selection' : 'failed';
}

/**
 * The fallback: a read-only field holding the text, selected, `document.execCommand('copy')`, and
 * the field gone again. The focus goes back where it was - the copy button - so the grid's keyboard
 * position is not lost.
 */
export function copyBySelection(text: string, host: HTMLElement = document.body): boolean {
    const owner = host.ownerDocument;
    const previous = owner.activeElement;
    const field = owner.createElement('textarea');
    field.value = text;
    field.readOnly = true;
    field.tabIndex = -1;
    field.setAttribute('aria-hidden', 'true');
    // in the window, or `select()` does nothing in some browsers; invisible, and out of the layout
    Object.assign(field.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '1px',
        height: '1px',
        padding: '0',
        border: '0',
        opacity: '0',
        pointerEvents: 'none',
    });
    host.append(field);
    try {
        field.focus({preventScroll: true});
        field.select();
        // iOS selects nothing in a read-only field without the explicit range
        field.setSelectionRange(0, text.length);
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- the only copy there is outside a secure context
        return owner.execCommand('copy');
    } catch {
        return false;
    } finally {
        field.remove();
        if (previous instanceof HTMLElement || previous instanceof SVGElement) {
            previous.focus({preventScroll: true});
        }
    }
}
