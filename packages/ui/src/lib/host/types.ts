/**
 * The shape of `window.__HMM_HOST__`.
 *
 * The Electron preload of task 11 puts this object on the window; `apps/web` and the CCU addon do
 * not, and the browser bundle must work exactly the same without it. The types are declared here
 * rather than imported from `apps/electron/src/shared/ipc.ts` because `packages/ui` may not depend
 * on an app - the bridge is structural, and {@link isHostBridge} checks the structure at runtime.
 *
 * Keep in step with `apps/electron/src/shared/ipc.ts`; both sides only ever gain optional members.
 */

/** What the user picked in the theme switch; `system` follows the OS (D-22). */
export type HostThemeSource = 'system' | 'light' | 'dark';

/** Where the update flow stands (D-16). Nothing installs without the user saying so. */
export type HostUpdatePhase =
    'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installOnQuit' | 'error';

export interface HostUpdateState {
    readonly phase: HostUpdatePhase;
    /** The version that is available, being downloaded or ready to install. */
    readonly version?: string;
    /** 0-100 while downloading. */
    readonly percent?: number;
    /** Why the updater is off, or what went wrong. */
    readonly message?: string;
    /** The user dismissed the notice for this version. */
    readonly dismissed: boolean;
}

/** What the About dialog shows about the process the UI runs in. */
export interface HostInfo {
    readonly version: string;
    readonly electron: string;
    readonly chrome: string;
    readonly node: string;
    readonly platform: string;
    readonly arch: string;
    readonly packaged: boolean;
    readonly userData: string;
    readonly logFile: string;
}

/** A menu item only the page can carry out. */
export type HostMenuAction = 'settings';

/** Everything the UI can only get from a host process. */
export interface HostBridge {
    info(): Promise<HostInfo>;
    /** `hmm-image://device/<TYPE>`; the UI puts it straight into an `<img src>` (D-10). */
    deviceImageUrl(deviceType: string): string;
    setTheme(source: HostThemeSource): Promise<void>;
    /** The OS theme, for `system`; fires whenever the OS switches. */
    onSystemTheme(handler: (dark: boolean) => void): () => void;
    onMenuAction(handler: (action: HostMenuAction) => void): () => void;
    update: {
        state(): Promise<HostUpdateState>;
        check(): Promise<HostUpdateState>;
        download(): Promise<HostUpdateState>;
        installOnQuit(): Promise<HostUpdateState>;
        dismiss(): Promise<HostUpdateState>;
        on(handler: (state: HostUpdateState) => void): () => void;
    };
}
