import {getHostBridge} from '../host/hostBridge.js';
import type {HostBridge, HostInfo, HostMenuAction, HostThemeSource, HostUpdateState} from '../host/types.js';

export interface HostStoreOptions {
    /** Injected by the tests and by a host that hands its bridge over explicitly. */
    readonly bridge?: HostBridge | undefined;
    /** Where to look for `window.__HMM_HOST__`; defaults to `globalThis`. */
    readonly scope?: Record<string, unknown> | undefined;
}

/**
 * Everything the UI can only get from an Electron host - and nothing the UI needs it for.
 *
 * `available` is false in `apps/web`, in the CCU addon and in demo mode, and every method below is
 * then a no-op that resolves: the settings dialog shows the API's version instead of Electron's, the
 * update notice never appears, and a device image falls back to its placeholder. That is the point
 * of the store: the components ask it, never `window`, so "no host" is one branch in one file.
 */
export class HostStore {
    info = $state<HostInfo | undefined>(undefined);
    update = $state<HostUpdateState | undefined>(undefined);
    /** True while the OS reports dark and the theme choice is `system` (D-22). */
    systemDark = $state(false);

    readonly #bridge: HostBridge | undefined;
    readonly #unsubscribe: Array<() => void> = [];

    constructor(options: HostStoreOptions = {}) {
        this.#bridge =
            options.bridge ?? getHostBridge(options.scope ?? (globalThis as unknown as Record<string, unknown>));
        if (this.#bridge) {
            this.#unsubscribe.push(
                this.#bridge.onSystemTheme((dark) => {
                    this.systemDark = dark;
                }),
                this.#bridge.update.on((state) => {
                    this.update = state;
                }),
            );
        }
    }

    /** Is there a host at all? Everything else is safe to call either way. */
    get available(): boolean {
        return this.#bridge !== undefined;
    }

    /**
     * A version notice the user has not dismissed and that is worth showing: `available`,
     * `downloading`, `downloaded` and `installOnQuit`. `disabled`, `idle` and `checking` are not
     * news, and `error` is reported through the notices, not through a banner.
     */
    get updateNotice(): HostUpdateState | undefined {
        const state = this.update;
        if (!state || state.dismissed) {
            return undefined;
        }
        return ['available', 'downloading', 'downloaded', 'installOnQuit'].includes(state.phase) ? state : undefined;
    }

    /**
     * The `<img src>` of a device image (D-10): the host bridge's `hmm-image://` URL in Electron,
     * otherwise the web host's `images/<type>` route relative to the page (the addon and every
     * server install serve it; demo mode answers 404 and the component shows its placeholder).
     */
    deviceImageUrl(deviceType: string): string | undefined {
        if (deviceType === '') {
            return undefined;
        }
        if (!this.#bridge) {
            return `images/${encodeURIComponent(deviceType)}`;
        }
        return this.#bridge.deviceImageUrl(deviceType);
    }

    /** Loads what the settings dialog's info line shows. Does nothing without a host. */
    async load(): Promise<void> {
        if (!this.#bridge) {
            return;
        }
        const [info, update] = await Promise.all([this.#bridge.info(), this.#bridge.update.state()]);
        this.info = info;
        this.update = update;
    }

    /** Tells the host which theme the user picked, so the native chrome follows (D-22). */
    async setTheme(source: HostThemeSource): Promise<void> {
        await this.#bridge?.setTheme(source);
    }

    /** Subscribes to the menu items the page has to carry out; returns the unsubscribe function. */
    onMenuAction(handler: (action: HostMenuAction) => void): () => void {
        return this.#bridge?.onMenuAction(handler) ?? (() => {});
    }

    /**
     * Hands a URL to the host so it opens in the user's own browser, and says whether it did.
     *
     * `false` means there is nobody to ask - `apps/web`, the addon, demo mode, or a preload from a
     * build that predates this command - and the caller then lets the browser follow the link
     * itself. Nothing is validated here: main has the allow-list, because a check in the renderer
     * is a check an XSS bug can walk around.
     */
    async openExternal(url: string): Promise<boolean> {
        const bridge = this.#bridge;
        if (!bridge?.openExternal) {
            return false;
        }
        await bridge.openExternal(url);
        return true;
    }

    async checkForUpdate(): Promise<void> {
        this.update = await this.#bridge?.update.check();
    }

    async downloadUpdate(): Promise<void> {
        this.update = await this.#bridge?.update.download();
    }

    async installUpdateOnQuit(): Promise<void> {
        this.update = await this.#bridge?.update.installOnQuit();
    }

    async dismissUpdate(): Promise<void> {
        this.update = await this.#bridge?.update.dismiss();
    }

    dispose(): void {
        for (const off of this.#unsubscribe) {
            off();
        }
        this.#unsubscribe.length = 0;
    }
}
