import type {ThemeChoice} from './AppStore.svelte.js';

/**
 * Task 71: whether the page runs inside openccu-lite's shell - the system's menu chrome around an
 * addon page - and what theme the shell shows.
 *
 * The shell frames an addon's page as an iframe of the same origin and tells it the look: the URL
 * carries `theme=system|light|dark` (and `lang`) for the first paint, and the shell posts
 * `{type: "openccu-lite:theme", theme, lang}` to the frame on load and on every change (the
 * system's embedding contract). Inside that frame the shell has the user, the logout and the theme
 * of its own, so the header leaves its three buttons out and follows the shell's theme.
 *
 * Being on openccu-lite is not enough: the same page opened full screen in a tab of its own, the
 * addon on a CCU, the desktop app and the web host keep every button. So "inside the shell" is a
 * framed page whose parent is of its own origin, *and* the shell's theme on the URL or the shell's
 * message from that parent - a CCU or any other frame sends neither.
 */
export class ShellEmbedding {
    /** Inside openccu-lite's shell: the header drops user, logout and theme. */
    embedded = $state(false);
    /** The shell's theme while embedded; `undefined` outside, where the app's own choice applies. */
    theme = $state<ThemeChoice | undefined>(undefined);

    readonly #win: Window | undefined;
    readonly #onMessage = (event: MessageEvent): void => {
        this.#message(event);
    };

    constructor(win: Window | undefined = typeof window === 'undefined' ? undefined : window) {
        this.#win = win;
        if (!win || !framedBySameOrigin(win)) {
            return;
        }
        const fromUrl = themeOf(/[?&]theme=([a-z]+)/u.exec(win.location.search)?.[1]);
        if (fromUrl !== undefined) {
            this.embedded = true;
            this.theme = fromUrl;
        }
        win.addEventListener('message', this.#onMessage);
    }

    #message(event: MessageEvent): void {
        const win = this.#win;
        if (!win || event.origin !== win.location.origin || event.source !== win.parent) {
            return;
        }
        const data = event.data as {type?: unknown; theme?: unknown} | null;
        if (data === null || typeof data !== 'object' || data.type !== 'openccu-lite:theme') {
            return;
        }
        this.embedded = true;
        this.theme = themeOf(data.theme) ?? this.theme ?? 'system';
    }

    dispose(): void {
        this.#win?.removeEventListener('message', this.#onMessage);
    }
}

function themeOf(value: unknown): ThemeChoice | undefined {
    return value === 'system' || value === 'light' || value === 'dark' ? value : undefined;
}

/** A frame whose parent is a page of this origin; a cross-origin parent throws on `location`. */
function framedBySameOrigin(win: Window): boolean {
    try {
        return win.self !== win.top && win.parent.location.origin === win.location.origin;
    } catch {
        return false;
    }
}
